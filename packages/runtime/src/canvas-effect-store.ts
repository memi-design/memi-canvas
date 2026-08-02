import { hashCanonicalValue } from "@memi/canonical-json";
import {
  CanvasOperationSchema,
  DurableCommandSchema,
  OutboxRecordSchema,
  OutboxTransitionSchema,
  TargetEffectRequestSchema,
  TargetLookupRequestSchema,
  TargetReceiptHashMaterialSchema,
  TargetReceiptSchema,
  type DurableCommand,
  type OutboxRecord,
  type TargetEffectRequest,
  type TargetLookupRequest,
  type TargetLookupResult,
  type TargetReceipt,
} from "../../protocol/src/index.js";

import { AuthorityStore } from "./authority-store.js";
import { RuntimeDatabase } from "./database.js";
import { StaleWorkerClaimError } from "./errors.js";
import { LeaseStore } from "./lease-store.js";
import {
  json,
  parsed,
} from "./runtime-records.js";
import type {
  CommandPolicyValidator,
  WorkerClaim,
} from "./types.js";
import { validateCommandPolicy } from "./policy.js";
import {
  bindRecoveryChallenge,
  RECOVERY_EVIDENCE_FRESHNESS_MS,
} from "./canvas-recovery-evidence.js";
import { recordRecoveryEvidence } from "./canvas-recovery-journal.js";
import type { RecoveryChallengeFactory } from "./types.js";

type EffectAppliedOutbox = OutboxRecord & {
  readonly phase: "effect-applied";
};

export interface PreparedCanvasEffect {
  readonly claim: WorkerClaim;
  readonly command: DurableCommand;
  readonly outbox: OutboxRecord & { readonly phase: "intent" };
  readonly request: TargetEffectRequest;
}

export interface CanvasRecoveryCandidate {
  readonly command: DurableCommand;
  readonly outbox: OutboxRecord & { readonly phase: "intent" };
  readonly lookup: TargetLookupRequest;
  readonly latchState: "blocked-unknown" | "pending-fence";
  readonly workerClaimId: string;
  readonly claimEpoch: number;
  readonly claimExpiresAt: string;
}

export class CanvasEffectStore {
  readonly #database: RuntimeDatabase;
  readonly #authority: AuthorityStore;
  readonly #leases: LeaseStore;
  readonly #clock: () => string;
  readonly #policyValidator: CommandPolicyValidator | undefined;
  readonly #recoveryChallengeFactory: RecoveryChallengeFactory;

  constructor(
    database: RuntimeDatabase,
    authority: AuthorityStore,
    leases: LeaseStore,
    clock: () => string,
    policyValidator: CommandPolicyValidator | undefined,
    recoveryChallengeFactory: RecoveryChallengeFactory,
  ) {
    this.#database = database;
    this.#authority = authority;
    this.#leases = leases;
    this.#clock = clock;
    this.#policyValidator = policyValidator;
    this.#recoveryChallengeFactory = recoveryChallengeFactory;
  }

  prepare(claim: WorkerClaim): PreparedCanvasEffect {
    return this.#database.transaction(() => {
      const outbox = this.#assertClaim(claim);
      const command = this.#command(claim.commandId);
      if (command.kind !== "canvas.operation") {
        throw new Error("Canvas target received a non-canvas command.");
      }
      const grant = this.#authority.validateEffect(command);
      const payload = CanvasOperationSchema.parse(
        this.#effectPayload(command.id),
      );
      validateCommandPolicy(
        this.#policyValidator,
        command,
        payload,
        grant,
      );
      const lease = this.#leases.assert({
        projectId: command.projectId,
        targetId: command.target.id,
        leaseId: command.authority.leaseId,
        fencingEpoch: command.authority.fencingEpoch,
      });
      const latch = this.#database.one(
        `SELECT state, worker_claim_id, claim_epoch
         FROM target_schedule_latches WHERE outbox_id = ?`,
        outbox.id,
      );
      if (
        latch === undefined ||
        String(latch.state) !== "pending-fence" ||
        String(latch.worker_claim_id) !== claim.id ||
        Number(latch.claim_epoch) !== claim.fencingEpoch
      ) {
        throw new StaleWorkerClaimError(command.id);
      }
      const request = TargetEffectRequestSchema.parse({
        schemaVersion: 1,
        effectKind: "canvas.operation",
        projectId: command.projectId,
        taskId: command.taskId,
        runId: command.runId,
        issuerId: command.issuerId,
        commandId: command.id,
        outboxId: outbox.id,
        target: command.target,
        idempotencyKey: command.idempotencyKey,
        commandActionDigest: command.actionDigest,
        operationActionDigest: payload.actionDigest,
        payloadHash: command.payloadHash,
        payload,
        capabilityGrantId: command.authority.capabilityGrantId,
        approvalReceiptId: command.authority.approvalReceiptId,
        lease: {
          id: lease.id,
          holderId: lease.holderId,
          fencingEpoch: lease.fencingEpoch,
        },
        workerClaim: {
          id: claim.id,
          fencingEpoch: claim.fencingEpoch,
          expiresAt: claim.expiresAt,
        },
      });
      return { claim, command, outbox, request };
    });
  }

  recordApplied(
    prepared: PreparedCanvasEffect,
    untrustedReceipt: TargetReceipt,
  ): EffectAppliedOutbox {
    const receipt = this.#exactReceipt(
      prepared.request,
      untrustedReceipt,
    );
    return this.#database.transaction(() => {
      const outbox = this.#assertClaim(prepared.claim);
      if (json(outbox) !== json(prepared.outbox)) {
        throw new StaleWorkerClaimError(prepared.command.id);
      }
      const applied = OutboxRecordSchema.parse({
        ...outbox,
        phase: "effect-applied",
        appliedAt: receipt.appliedAt,
        resultingHash: receipt.resultingHash,
      });
      if (applied.phase !== "effect-applied") {
        throw new Error("Canvas effect did not reach effect-applied.");
      }
      OutboxTransitionSchema.parse({ from: outbox, to: applied });
      this.#database.run(
        `INSERT INTO target_receipts (
          command_id, outbox_id, project_id, target_kind, target_id,
          receipt_hash, receipt_json, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        prepared.command.id,
        outbox.id,
        prepared.command.projectId,
        prepared.command.target.kind,
        prepared.command.target.id,
        receipt.receiptHash,
        json(receipt),
        this.#clock(),
      );
      this.#database.run(
        `UPDATE outbox
         SET phase = ?, record_json = ?, worker_id = NULL,
             claim_expires_at = NULL
         WHERE id = ?`,
        applied.phase,
        json(applied),
        applied.id,
      );
      this.#database.run(
        `UPDATE commands SET state = 'effect-applied' WHERE id = ?`,
        prepared.command.id,
      );
      const latchChanges = this.#database.run(
        `UPDATE target_schedule_latches
         SET state = 'pending-commit', recovery_json = NULL,
             updated_at = ?
         WHERE outbox_id = ? AND worker_claim_id = ?
           AND claim_epoch = ?`,
        this.#clock(),
        outbox.id,
        prepared.claim.id,
        prepared.claim.fencingEpoch,
      );
      if (latchChanges !== 1) {
        throw new Error(
          "Target schedule latch pending-commit transition was lost.",
        );
      }
      return applied;
    });
  }

  recordNotApplied(
    prepared: PreparedCanvasEffect,
    message: string,
  ): void {
    this.#database.transaction(() => {
      const outbox = this.#assertClaim(prepared.claim);
      const failed = OutboxRecordSchema.parse({
        ...outbox,
        phase: "failed",
        failedFrom: "intent",
        failedAt: this.#clock(),
        error: {
          code: "EFFECT_NOT_APPLIED",
          message,
          retryable: false,
        },
      });
      OutboxTransitionSchema.parse({ from: outbox, to: failed });
      this.#database.run(
        `UPDATE outbox
         SET phase = ?, record_json = ?, worker_id = NULL,
             claim_expires_at = NULL
         WHERE id = ?`,
        failed.phase,
        json(failed),
        failed.id,
      );
      this.#database.run(
        "UPDATE commands SET state = 'failed' WHERE id = ?",
        prepared.command.id,
      );
      this.#database.run(
        "DELETE FROM target_schedule_latches WHERE outbox_id = ?",
        outbox.id,
      );
    });
  }

  recordUnknown(
    prepared: PreparedCanvasEffect,
    evidence: unknown = {
      status: "outcome-unknown",
      message: "Target effect outcome requires trusted lookup.",
    },
  ): void {
    this.#database.transaction(() => {
      const changes = this.#database.run(
        `UPDATE target_schedule_latches
         SET state = 'blocked-unknown', recovery_json = ?,
             updated_at = ?
         WHERE outbox_id = ? AND worker_claim_id = ?
           AND claim_epoch = ?`,
        json(evidence),
        this.#clock(),
        prepared.outbox.id,
        prepared.claim.id,
        prepared.claim.fencingEpoch,
      );
      if (changes !== 1) {
        throw new Error(
          "Target schedule latch blocked transition was lost.",
        );
      }
    });
  }

  nextRecovery(
    commandId?: DurableCommand["id"],
  ): CanvasRecoveryCandidate | undefined {
    return this.#database.transaction(() => {
      const now = this.#clock();
      const row = this.#database.one(
        `SELECT
           commands.command_json,
           commands.effect_payload_json,
           outbox.record_json,
           outbox.claim_expires_at,
           target_schedule_latches.state AS latch_state,
           target_schedule_latches.worker_claim_id,
           target_schedule_latches.claim_epoch,
           target_schedule_latches.recovery_json
         FROM target_schedule_latches
         JOIN outbox ON outbox.id = target_schedule_latches.outbox_id
         JOIN commands ON commands.id = outbox.command_id
         WHERE outbox.phase = 'intent'
           AND commands.target_kind = 'canvas-document'
           AND (
             (
               ? IS NULL
               AND json_extract(commands.command_json, '$.issuerId')
                 <> 'import-runtime'
             )
             OR commands.id = ?
           )
           AND (
             target_schedule_latches.state = 'blocked-unknown'
             OR (
               target_schedule_latches.state = 'pending-fence'
               AND outbox.claim_expires_at <= ?
             )
           )
         ORDER BY outbox.rowid
         LIMIT 1`,
        commandId ?? null,
        commandId ?? null,
        now,
      );
      if (row === undefined) {
        return undefined;
      }
      const command = DurableCommandSchema.parse(
        parsed(row.command_json),
      );
      const outbox = OutboxRecordSchema.parse(
        parsed(row.record_json),
      );
      if (outbox.phase !== "intent") {
        return undefined;
      }
      const payload = CanvasOperationSchema.parse(
        parsed(row.effect_payload_json),
      );
      const identity = {
        schemaVersion: 1,
        projectId: command.projectId,
        target: command.target,
        idempotencyKey: command.idempotencyKey,
        commandId: command.id,
        commandActionDigest: command.actionDigest,
        operationActionDigest: payload.actionDigest,
        expectedBeforeHash: command.target.expectedBeforeHash,
      } as const;
      const recovery =
        row.recovery_json === null
          ? undefined
          : parsed(row.recovery_json);
      const pending =
        typeof recovery === "object" &&
        recovery !== null &&
        "status" in recovery &&
        recovery.status === "lookup-challenge-pending" &&
        "request" in recovery
          ? TargetLookupRequestSchema.safeParse(recovery.request)
          : undefined;
      const reusable =
        pending?.success === true &&
        (() => {
          const {
            challenge,
            requestDigest,
            ...persistedIdentity
          } = pending.data;
          return (
            json(persistedIdentity) === json(identity) &&
            requestDigest ===
              hashCanonicalValue({
                ...persistedIdentity,
                challenge,
              }) &&
            Date.parse(challenge.issuedAt) <= Date.parse(now) &&
            Date.parse(now) - Date.parse(challenge.issuedAt) <=
              RECOVERY_EVIDENCE_FRESHNESS_MS
          );
        })();
      const lookup =
        reusable
          ? pending.data
          : bindRecoveryChallenge(
              identity,
              this.#recoveryChallengeFactory(),
              now,
            );
      const state =
        String(row.latch_state) === "pending-fence"
          ? "pending-fence"
          : "blocked-unknown";
      const workerClaimId = String(row.worker_claim_id);
      const claimEpoch = Number(row.claim_epoch);
      const changes = this.#database.run(
        `UPDATE target_schedule_latches
         SET recovery_json = ?, updated_at = ?
         WHERE outbox_id = ? AND state = ?
           AND worker_claim_id = ? AND claim_epoch = ?`,
        json({ status: "lookup-challenge-pending", request: lookup }),
        now,
        outbox.id,
        state,
        workerClaimId,
        claimEpoch,
      );
      if (changes !== 1) {
        throw new Error(
          "Target recovery challenge persistence was lost.",
        );
      }
      return {
        command,
        outbox,
        latchState: state,
        workerClaimId,
        claimEpoch,
        claimExpiresAt: String(row.claim_expires_at),
        lookup,
      };
    });
  }

  recordRecoveredApplied(
    candidate: CanvasRecoveryCandidate,
    result: Extract<TargetLookupResult, { readonly status: "found" }>,
  ): EffectAppliedOutbox {
    const request = this.#recoveryEffectRequest(candidate);
    const exactReceipt = this.#exactReceipt(request, result.receipt);
    return this.#database.transaction(() => {
      this.#assertRecovery(candidate);
      recordRecoveryEvidence(
        this.#database,
        this.#clock,
        candidate,
        "accepted-found",
        result,
        hashCanonicalValue(result),
      );
      const applied = OutboxRecordSchema.parse({
        ...candidate.outbox,
        phase: "effect-applied",
        appliedAt: exactReceipt.appliedAt,
        resultingHash: exactReceipt.resultingHash,
      });
      if (applied.phase !== "effect-applied") {
        throw new Error("Recovered canvas effect is not applied.");
      }
      OutboxTransitionSchema.parse({
        from: candidate.outbox,
        to: applied,
      });
      this.#database.run(
        `INSERT INTO target_receipts (
          command_id, outbox_id, project_id, target_kind, target_id,
          receipt_hash, receipt_json, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        candidate.command.id,
        candidate.outbox.id,
        candidate.command.projectId,
        candidate.command.target.kind,
        candidate.command.target.id,
        exactReceipt.receiptHash,
        json(exactReceipt),
        this.#clock(),
      );
      this.#database.run(
        `UPDATE outbox
         SET phase = ?, record_json = ?, worker_id = NULL,
             claim_expires_at = NULL WHERE id = ?`,
        applied.phase,
        json(applied),
        applied.id,
      );
      this.#database.run(
        `UPDATE commands SET state = 'effect-applied' WHERE id = ?`,
        candidate.command.id,
      );
      const latchChanges = this.#database.run(
        `UPDATE target_schedule_latches
         SET state = 'pending-commit', recovery_json = NULL,
             updated_at = ?
         WHERE outbox_id = ? AND state = ?
           AND worker_claim_id = ? AND claim_epoch = ?`,
        this.#clock(),
        candidate.outbox.id,
        candidate.latchState,
        candidate.workerClaimId,
        candidate.claimEpoch,
      );
      if (latchChanges !== 1) {
        throw new Error(
          "Target schedule latch recovery transition was lost.",
        );
      }
      return applied;
    });
  }

  assertRecoveredFound(
    candidate: CanvasRecoveryCandidate,
    result: Extract<TargetLookupResult, { readonly status: "found" }>,
  ): void {
    this.#exactReceipt(
      this.#recoveryEffectRequest(candidate),
      result.receipt,
    );
  }

  releaseVerifiedNotApplied(
    candidate: CanvasRecoveryCandidate,
    result: Extract<
      TargetLookupResult,
      { readonly status: "not-found" }
    >,
  ): void {
    this.#database.transaction(() => {
      this.#assertRecovery(candidate);
      recordRecoveryEvidence(
        this.#database,
        this.#clock,
        candidate,
        "accepted-not-found",
        result,
        hashCanonicalValue(result),
      );
      this.#database.run(
        `UPDATE outbox
         SET worker_id = NULL, claim_expires_at = NULL
         WHERE id = ?`,
        candidate.outbox.id,
      );
      const changes = this.#database.run(
        `UPDATE target_schedule_latches
         SET state = 'retry-ready', worker_claim_id = NULL,
             recovery_json = ?, updated_at = ?
         WHERE outbox_id = ? AND state = ?
           AND worker_claim_id = ? AND claim_epoch = ?`,
        json({
          status: "verified-not-applied",
          expectedBeforeHash:
            candidate.command.target.expectedBeforeHash,
        }),
        this.#clock(),
        candidate.outbox.id,
        candidate.latchState,
        candidate.workerClaimId,
        candidate.claimEpoch,
      );
      if (changes !== 1) {
        throw new Error(
          "Target schedule latch retry transition was lost.",
        );
      }
    });
  }

  recordBlockedEvidence(
    candidate: CanvasRecoveryCandidate,
    result: TargetLookupResult,
  ): void {
    this.#database.transaction(() => {
      this.#assertRecovery(candidate);
      recordRecoveryEvidence(
        this.#database,
        this.#clock,
        candidate,
        "blocked-target",
        result,
        hashCanonicalValue(result),
      );
      const changes = this.#database.run(
        `UPDATE target_schedule_latches
         SET state = 'blocked-unknown', recovery_json = ?,
             updated_at = ?
         WHERE outbox_id = ? AND state = ?
           AND worker_claim_id = ? AND claim_epoch = ?`,
        json(result),
        this.#clock(),
        candidate.outbox.id,
        candidate.latchState,
        candidate.workerClaimId,
        candidate.claimEpoch,
      );
      if (changes !== 1) {
        throw new Error(
          "Target schedule latch recovery evidence was lost.",
        );
      }
    });
  }

  recordRejectedEvidence(
    candidate: CanvasRecoveryCandidate,
    reason: string,
    responseHash: string,
  ): void {
    this.#database.transaction(() => {
      this.#assertRecovery(candidate);
      const rejection = {
        status: "rejected-response",
        reason: reason.slice(0, 256),
        responseHash,
      };
      recordRecoveryEvidence(
        this.#database,
        this.#clock,
        candidate,
        "rejected-response",
        rejection,
        responseHash,
      );
      const changes = this.#database.run(
        `UPDATE target_schedule_latches
         SET state = 'blocked-unknown', recovery_json = ?,
             updated_at = ?
         WHERE outbox_id = ? AND state = ?
           AND worker_claim_id = ? AND claim_epoch = ?`,
        json(rejection),
        this.#clock(),
        candidate.outbox.id,
        candidate.latchState,
        candidate.workerClaimId,
        candidate.claimEpoch,
      );
      if (changes !== 1) {
        throw new Error(
          "Target schedule latch rejection evidence was lost.",
        );
      }
    });
  }

  now(): string {
    return this.#clock();
  }

  getReceipt(
    commandId: DurableCommand["id"],
  ): TargetReceipt | undefined {
    const row = this.#database.one(
      "SELECT receipt_json FROM target_receipts WHERE command_id = ?",
      commandId,
    );
    return row === undefined
      ? undefined
      : TargetReceiptSchema.parse(parsed(row.receipt_json));
  }

  #assertClaim(
    claim: WorkerClaim,
  ): OutboxRecord & { readonly phase: "intent" } {
    const row = this.#database.one(
      `SELECT phase, record_json, worker_id, claim_epoch,
              claim_expires_at
       FROM outbox WHERE id = ? AND command_id = ?`,
      claim.outboxId,
      claim.commandId,
    );
    if (
      row === undefined ||
      String(row.phase) !== "intent" ||
      String(row.worker_id) !== claim.workerId ||
      Number(row.claim_epoch) !== claim.fencingEpoch ||
      String(row.claim_expires_at) !== claim.expiresAt ||
      Date.parse(this.#clock()) >= Date.parse(claim.expiresAt)
    ) {
      throw new StaleWorkerClaimError(claim.commandId);
    }
    const outbox = OutboxRecordSchema.parse(parsed(row.record_json));
    if (outbox.phase !== "intent") {
      throw new StaleWorkerClaimError(claim.commandId);
    }
    return outbox;
  }

  #assertRecovery(candidate: CanvasRecoveryCandidate): void {
    const row = this.#database.one(
      `SELECT state, worker_claim_id, claim_epoch
       FROM target_schedule_latches WHERE outbox_id = ?`,
      candidate.outbox.id,
    );
    if (
      row === undefined ||
      String(row.state) !== candidate.latchState ||
      String(row.worker_claim_id) !== candidate.workerClaimId ||
      Number(row.claim_epoch) !== candidate.claimEpoch
    ) {
      throw new StaleWorkerClaimError(candidate.command.id);
    }
  }

  #command(commandId: string): DurableCommand {
    const row = this.#database.one(
      "SELECT command_json FROM commands WHERE id = ?",
      commandId,
    );
    if (row === undefined) {
      throw new Error(`Command "${commandId}" was not found.`);
    }
    return DurableCommandSchema.parse(parsed(row.command_json));
  }

  #effectPayload(commandId: string): unknown {
    const row = this.#database.one(
      "SELECT effect_payload_json FROM commands WHERE id = ?",
      commandId,
    );
    return parsed(row?.effect_payload_json);
  }

  #recoveryEffectRequest(
    candidate: CanvasRecoveryCandidate,
  ): TargetEffectRequest {
    const payload = CanvasOperationSchema.parse(
      this.#effectPayload(candidate.command.id),
    );
    return TargetEffectRequestSchema.parse({
      schemaVersion: 1,
      effectKind: "canvas.operation",
      projectId: candidate.command.projectId,
      taskId: candidate.command.taskId,
      runId: candidate.command.runId,
      issuerId: candidate.command.issuerId,
      commandId: candidate.command.id,
      outboxId: candidate.outbox.id,
      target: candidate.command.target,
      idempotencyKey: candidate.command.idempotencyKey,
      commandActionDigest: candidate.command.actionDigest,
      operationActionDigest: payload.actionDigest,
      payloadHash: candidate.command.payloadHash,
      payload,
      capabilityGrantId:
        candidate.command.authority.capabilityGrantId,
      approvalReceiptId:
        candidate.command.authority.approvalReceiptId,
      lease: {
        id: candidate.command.authority.leaseId,
        holderId: candidate.command.issuerId,
        fencingEpoch:
          candidate.command.authority.fencingEpoch,
      },
      workerClaim: {
        id: candidate.workerClaimId,
        fencingEpoch: candidate.claimEpoch,
        expiresAt: candidate.claimExpiresAt,
      },
    });
  }

  #exactReceipt(
    request: TargetEffectRequest,
    untrustedReceipt: TargetReceipt,
  ): TargetReceipt {
    const receipt = TargetReceiptSchema.parse(untrustedReceipt);
    const { receiptHash, ...untrustedMaterial } = receipt;
    const material = TargetReceiptHashMaterialSchema.parse(
      untrustedMaterial,
    );
    if (
      receiptHash !== hashCanonicalValue(material) ||
      receipt.projectId !== request.projectId ||
      receipt.taskId !== request.taskId ||
      receipt.runId !== request.runId ||
      receipt.commandId !== request.commandId ||
      receipt.outboxId !== request.outboxId ||
      receipt.target.id !== request.target.id ||
      receipt.idempotencyKey !== request.idempotencyKey ||
      receipt.commandActionDigest !== request.commandActionDigest ||
      receipt.operationActionDigest !== request.operationActionDigest ||
      receipt.payloadHash !== request.payloadHash ||
      receipt.expectedBeforeHash !== request.target.expectedBeforeHash ||
      receipt.leaseId !== request.lease.id ||
      receipt.leaseHolderId !== request.lease.holderId ||
      receipt.fencingEpoch !== request.lease.fencingEpoch ||
      receipt.workerClaimId !== request.workerClaim.id ||
      receipt.workerClaimFencingEpoch !==
        request.workerClaim.fencingEpoch ||
      receipt.operationId !== request.payload.id ||
      receipt.resultingHash !== request.payload.resultingHash
    ) {
      throw new Error(
        "Target receipt does not match the durable effect request.",
      );
    }
    return receipt;
  }
}
