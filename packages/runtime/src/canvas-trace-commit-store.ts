import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import {
  CanvasOperationCommittedEventSchema,
  CanvasOperationSchema,
  CanvasTraceEffectBindingHashMaterialSchema,
  DurableCommandSchema,
  OutboxIdSchema,
  OutboxRecordSchema,
  OutboxTransitionSchema,
  TargetReceiptHashMaterialSchema,
  TargetReceiptSchema,
  validateTargetVerificationEvidence,
  type CanvasCommittedEffectReceipt,
  type DurableCommand,
  type OutboxRecord,
  type TargetReceipt,
  type TargetVerificationRequest,
  type TargetVerificationResult,
} from "../../protocol/src/index.js";
import {
  buildCanvasBinding,
  buildCanvasCommittedReceipt,
  buildCanvasTraceEvent,
} from "./canvas-trace-authority.js";
import { CanvasTraceReader } from "./canvas-trace-reader.js";
import { CanvasVerificationJournal } from "./canvas-verification-journal.js";
import { RuntimeDatabase } from "./database.js";
import {
  EffectVerificationError,
  StaleWorkerClaimError,
} from "./errors.js";
import { LeaseStore } from "./lease-store.js";
import type {
  CommitClaim,
  CommitClaimRequest,
  RecoveryChallengeFactory,
  RuntimeFaults,
  TraceEventIdFactory,
  VerifyAndCommitRequest,
} from "./types.js";

export interface CanvasAuthority {
  readonly command: DurableCommand;
  readonly commandJson: string;
  readonly operation: ReturnType<typeof CanvasOperationSchema.parse>;
  readonly operationJson: string;
  readonly outbox: OutboxRecord & { readonly phase: "effect-applied" };
  readonly outboxJson: string;
  readonly targetReceipt: TargetReceipt;
  readonly targetReceiptJson: string;
  readonly applyWorkerClaimId: string;
  readonly applyClaimEpoch: number;
  readonly latchRecoveryJson: string | null;
}

export interface PreparedCanvasVerification extends CanvasAuthority {
  readonly claim: CommitClaim;
  readonly request: TargetVerificationRequest;
  readonly requestJson: string;
}

function parsed(value: unknown): unknown {
  return JSON.parse(String(value));
}

function same(value: unknown, expected: unknown): boolean {
  return String(value) === String(expected);
}

export class CanvasTraceCommitStore {
  readonly #database: RuntimeDatabase;
  readonly #leases: LeaseStore;
  readonly #clock: () => string;
  readonly #eventIdFactory: TraceEventIdFactory;
  readonly #faults: RuntimeFaults | undefined;
  readonly #reader: CanvasTraceReader;
  readonly #verificationJournal: CanvasVerificationJournal;

  constructor(
    database: RuntimeDatabase,
    leases: LeaseStore,
    clock: () => string,
    challengeFactory: RecoveryChallengeFactory,
    eventIdFactory: TraceEventIdFactory,
    faults: RuntimeFaults | undefined,
  ) {
    this.#database = database;
    this.#leases = leases;
    this.#clock = clock;
    this.#eventIdFactory = eventIdFactory;
    this.#faults = faults;
    this.#reader = new CanvasTraceReader(database);
    this.#verificationJournal = new CanvasVerificationJournal(
      database,
      clock,
      challengeFactory,
    );
  }

  handles(commandId: string): boolean {
    const row = this.#database.one(
      "SELECT command_json FROM commands WHERE id = ?",
      commandId,
    );
    if (row === undefined) {
      return false;
    }
    const command = DurableCommandSchema.parse(parsed(row.command_json));
    return (
      command.kind === "canvas.operation" &&
      command.target.kind === "canvas-document"
    );
  }

  hasCanonicalAuthority(commandId: string): boolean {
    return (
      this.#database.one(
        `SELECT 1 AS present
         FROM target_verification_attempts
         WHERE command_id = ? LIMIT 1`,
        commandId,
      ) !== undefined ||
      this.#database.one(
        `SELECT 1 AS present FROM effect_receipts
         WHERE command_id = ?`,
        commandId,
      ) !== undefined
    );
  }

  assertRequest(input: VerifyAndCommitRequest): void {
    if (
      typeof input !== "object" ||
      input === null ||
      Object.keys(input).length !== 1 ||
      !("claim" in input)
    ) {
      throw new Error("Commit request contains caller trace authority.");
    }
  }

  claim(input: CommitClaimRequest): CommitClaim {
    if (
      !Number.isSafeInteger(input.claimTtlMilliseconds) ||
      input.claimTtlMilliseconds <= 0
    ) {
      throw new RangeError("Commit claim TTL must be a positive integer.");
    }
    return this.#database.transaction(() => {
      const authority = this.#loadAuthority(input.commandId);
      this.#assertCanvas(authority.command);
      this.#assertLease(authority.command);
      const row = this.#database.one(
        `SELECT worker_id, claim_epoch, claim_expires_at
         FROM outbox WHERE id = ?`,
        authority.outbox.id,
      )!;
      const now = this.#clock();
      if (
        row.worker_id !== null &&
        Date.parse(now) < Date.parse(String(row.claim_expires_at))
      ) {
        throw new StaleWorkerClaimError(input.commandId);
      }
      const fencingEpoch = Number(row.claim_epoch) + 1;
      const expiresAt = new Date(
        Date.parse(now) + input.claimTtlMilliseconds,
      ).toISOString();
      const changes = this.#database.run(
        `UPDATE outbox SET worker_id = ?, claim_epoch = ?,
           claim_expires_at = ?
         WHERE id = ? AND phase = 'effect-applied'`,
        input.workerId,
        fencingEpoch,
        expiresAt,
        authority.outbox.id,
      );
      if (changes !== 1) {
        throw new StaleWorkerClaimError(input.commandId);
      }
      return {
        commandId: authority.command.id,
        outboxId: OutboxIdSchema.parse(authority.outbox.id),
        workerId: input.workerId,
        fencingEpoch,
        expiresAt,
      };
    });
  }

  prepareVerification(claim: CommitClaim): PreparedCanvasVerification {
    return this.#database.transaction(() => {
      this.#assertClaim(claim);
      const authority = this.#loadAuthority(claim.commandId);
      this.#assertLease(authority.command);
      return this.#verificationJournal.prepare(authority, claim);
    });
  }

  rejectVerification(
    prepared: PreparedCanvasVerification,
    reason: string,
    result?: unknown,
  ): void {
    this.#verificationJournal.reject(prepared, reason, result);
  }

  commit(
    prepared: PreparedCanvasVerification,
    verification: TargetVerificationResult & {
      readonly status: "verified-applied";
    },
  ): CanvasCommittedEffectReceipt {
    return this.#database.transaction(() => {
      const fresh = validateTargetVerificationEvidence(
        prepared.request,
        verification,
        this.#clock(),
      );
      if (
        !fresh.accepted ||
        fresh.result.status !== "verified-applied"
      ) {
        throw new EffectVerificationError(
          "EFFECT_VERIFICATION_MISMATCH",
          "Canvas verification expired before canonical commit.",
        );
      }
      const replay = this.#reader.receipt(prepared.command.id);
      if (replay !== undefined) {
        this.#assertRaceReplay(prepared, verification, replay);
        return replay;
      }
      this.#assertPrepared(prepared);
      const head = this.#head(prepared.command.projectId);
      const event = buildCanvasTraceEvent({
        command: prepared.command,
        outboxId: prepared.outbox.id,
        operation: prepared.operation,
        receipt: prepared.targetReceipt,
        request: prepared.request,
        verification,
        allocation: {
          eventId: this.#eventIdFactory(),
          sequence: head.sequence + 1,
          occurredAt: this.#clock(),
          previousEventHash: head.eventHash,
        },
      });
      this.#insertEvent(event);
      this.#faults?.afterTraceEventInsert?.();
      this.#writeHead(event);
      this.#faults?.afterTraceHeadUpdate?.();
      this.#acceptVerification(prepared, verification);
      const binding = buildCanvasBinding({
        command: prepared.command,
        outboxId: prepared.outbox.id,
        event,
        receipt: prepared.targetReceipt,
        request: prepared.request,
        verification,
      });
      const committedAt = this.#clock();
      this.#insertBinding(
        prepared,
        event,
        binding.digest,
        verification,
        committedAt,
      );
      this.#faults?.afterTraceBindingInsert?.();
      const receipt = buildCanvasCommittedReceipt({
        command: prepared.command,
        outboxId: prepared.outbox.id,
        event,
        targetReceipt: prepared.targetReceipt,
        verification,
        bindingDigest: binding.digest,
        committedAt,
      });
      this.#insertReceipt(prepared, receipt);
      this.#faults?.afterCanonicalReceiptInsert?.();
      this.#database.run(
        `INSERT INTO trace_projection_outbox (
          event_id, project_id, sequence, event_hash, state, created_at
        ) VALUES (?, ?, ?, ?, 'pending', ?)`,
        event.id,
        event.projectId,
        event.sequence,
        event.eventHash,
        committedAt,
      );
      this.#faults?.afterProjectionInsert?.();
      this.#commitOutbox(prepared, event.id, committedAt);
      this.#faults?.afterCommittedOutboxUpdate?.();
      this.#database.run(
        "UPDATE commands SET state = 'committed' WHERE id = ?",
        prepared.command.id,
      );
      const deleted = this.#database.run(
        `DELETE FROM target_schedule_latches
         WHERE outbox_id = ? AND command_id = ?
           AND state = 'pending-commit'
           AND worker_claim_id = ? AND claim_epoch = ?
           AND recovery_json = ?`,
        prepared.outbox.id,
        prepared.command.id,
        prepared.applyWorkerClaimId,
        prepared.applyClaimEpoch,
        prepared.latchRecoveryJson,
      );
      if (deleted !== 1) {
        throw new StaleWorkerClaimError(prepared.command.id);
      }
      return receipt;
    });
  }

  replay(claim: CommitClaim): CanvasCommittedEffectReceipt | undefined {
    const row = this.#database.one(
      `SELECT phase FROM outbox
       WHERE id = ? AND command_id = ?`,
      claim.outboxId,
      claim.commandId,
    );
    if (row === undefined || String(row.phase) !== "committed") {
      return undefined;
    }
    const receipt = this.#reader.receipt(claim.commandId);
    const accepted = this.#database.one(
      `SELECT target_verification_attempts.claim_worker_id,
              target_verification_attempts.claim_epoch,
              target_verification_attempts.claim_expires_at
       FROM trace_effect_bindings
       JOIN target_verification_attempts
         ON target_verification_attempts.id =
              trace_effect_bindings.verification_attempt_id
       WHERE trace_effect_bindings.command_id = ?
         AND target_verification_attempts.state = 'accepted'`,
      claim.commandId,
    );
    if (
      receipt === undefined ||
      accepted === undefined ||
      !same(accepted.claim_worker_id, claim.workerId) ||
      Number(accepted.claim_epoch) !== claim.fencingEpoch ||
      !same(accepted.claim_expires_at, claim.expiresAt)
    ) {
      throw new EffectVerificationError(
        "COMMIT_TRACE_CONFLICT",
        "Committed canvas replay belongs to another claim.",
      );
    }
    return receipt;
  }

  getReceipt(commandId: string): CanvasCommittedEffectReceipt | undefined {
    return this.#reader.receipt(commandId);
  }

  getTrace(commandId: string) {
    return this.#reader.trace(commandId);
  }

  replayProject(projectId: string) {
    return this.#reader.project(projectId);
  }

  audit(): void { this.#reader.audit(); }

  now(): string {
    return this.#clock();
  }

  #loadAuthority(commandId: string): CanvasAuthority {
    const row = this.#database.one(
      `SELECT commands.command_json, commands.effect_payload_json,
              commands.project_id, commands.target_kind,
              commands.target_id, outbox.id AS stored_outbox_id,
              outbox.record_json, outbox.phase,
              target_receipts.receipt_json,
              target_receipts.receipt_hash,
              target_schedule_latches.state AS latch_state,
              target_schedule_latches.worker_claim_id,
              target_schedule_latches.claim_epoch AS apply_claim_epoch,
              target_schedule_latches.recovery_json
       FROM commands
       JOIN outbox ON outbox.command_id = commands.id
       JOIN target_receipts
         ON target_receipts.command_id = commands.id
        AND target_receipts.outbox_id = outbox.id
        AND target_receipts.project_id = commands.project_id
        AND target_receipts.target_kind = commands.target_kind
        AND target_receipts.target_id = commands.target_id
       JOIN target_schedule_latches
         ON target_schedule_latches.command_id = commands.id
        AND target_schedule_latches.outbox_id = outbox.id
        AND target_schedule_latches.project_id = commands.project_id
        AND target_schedule_latches.target_kind = commands.target_kind
        AND target_schedule_latches.target_id = commands.target_id
       WHERE commands.id = ?`,
      commandId,
    );
    if (
      row === undefined ||
      String(row.phase) !== "effect-applied" ||
      String(row.latch_state) !== "pending-commit" ||
      row.worker_claim_id === null
    ) {
      throw new Error(
        `Canvas command "${commandId}" lacks exact pending-commit authority.`,
      );
    }
    const commandJson = String(row.command_json);
    const operationJson = String(row.effect_payload_json);
    const outboxJson = String(row.record_json);
    const targetReceiptJson = String(row.receipt_json);
    const command = DurableCommandSchema.parse(parsed(commandJson));
    this.#assertCanvas(command);
    const operation = CanvasOperationSchema.parse(parsed(operationJson));
    const outbox = OutboxRecordSchema.parse(parsed(outboxJson));
    if (outbox.phase !== "effect-applied") {
      throw new Error("Canvas outbox JSON is not effect-applied.");
    }
    const targetReceipt = this.#exactTargetReceipt(
      TargetReceiptSchema.parse(parsed(targetReceiptJson)),
      command,
      outbox,
      operation,
    );
    if (
      !same(row.project_id, command.projectId) ||
      !same(row.target_kind, command.target.kind) ||
      !same(row.target_id, command.target.id) ||
      !same(row.stored_outbox_id, outbox.id) ||
      !same(row.receipt_hash, targetReceipt.receiptHash) ||
      outbox.commandId !== command.id ||
      outbox.projectId !== command.projectId ||
      outbox.idempotencyKey !== command.idempotencyKey ||
      outbox.actionDigest !== command.actionDigest ||
      outbox.effect.kind !== "canvas.operation" ||
      outbox.effect.targetId !== command.target.id ||
      outbox.effect.expectedBeforeHash !==
        command.target.expectedBeforeHash ||
      outbox.effect.payloadHash !== command.payloadHash ||
      targetReceipt.workerClaimId !== String(row.worker_claim_id) ||
      targetReceipt.workerClaimFencingEpoch !==
        Number(row.apply_claim_epoch)
    ) {
      throw new Error("Canvas command scalar authority is inconsistent.");
    }
    return {
      command,
      commandJson,
      operation,
      operationJson,
      outbox,
      outboxJson,
      targetReceipt,
      targetReceiptJson,
      applyWorkerClaimId: String(row.worker_claim_id),
      applyClaimEpoch: Number(row.apply_claim_epoch),
      latchRecoveryJson:
        row.recovery_json === null
          ? null
          : String(row.recovery_json),
    };
  }

  #assertPrepared(prepared: PreparedCanvasVerification): void {
    this.#assertClaim(prepared.claim);
    const current = this.#loadAuthority(prepared.command.id);
    if (
      current.commandJson !== prepared.commandJson ||
      current.operationJson !== prepared.operationJson ||
      current.outboxJson !== prepared.outboxJson ||
      current.targetReceiptJson !== prepared.targetReceiptJson ||
      current.applyWorkerClaimId !== prepared.applyWorkerClaimId ||
      current.applyClaimEpoch !== prepared.applyClaimEpoch ||
      current.latchRecoveryJson !== prepared.latchRecoveryJson
    ) {
      throw new EffectVerificationError(
        "EFFECT_VERIFICATION_MISMATCH",
        "Canvas authority changed during target verification.",
      );
    }
    this.#assertLease(prepared.command);
    const attempt = this.#database.one(
      `SELECT * FROM target_verification_attempts WHERE id = ?`,
      prepared.request.challenge.id,
    );
    if (
      attempt === undefined ||
      !same(attempt.state, "issued") ||
      !same(attempt.request_digest, prepared.request.requestDigest) ||
      !same(attempt.request_json, prepared.requestJson) ||
      !same(attempt.claim_worker_id, prepared.claim.workerId) ||
      Number(attempt.claim_epoch) !== prepared.claim.fencingEpoch ||
      !same(attempt.claim_expires_at, prepared.claim.expiresAt) ||
      !same(attempt.apply_worker_claim_id, prepared.applyWorkerClaimId) ||
      Number(attempt.apply_claim_epoch) !== prepared.applyClaimEpoch ||
      !same(
        attempt.target_receipt_hash,
        prepared.targetReceipt.receiptHash,
      )
    ) {
      throw new StaleWorkerClaimError(prepared.command.id);
    }
  }

  #assertClaim(claim: CommitClaim): void {
    const row = this.#database.one(
      `SELECT phase, worker_id, claim_epoch, claim_expires_at
       FROM outbox WHERE id = ? AND command_id = ?`,
      claim.outboxId,
      claim.commandId,
    );
    if (
      row === undefined ||
      !same(row.phase, "effect-applied") ||
      !same(row.worker_id, claim.workerId) ||
      Number(row.claim_epoch) !== claim.fencingEpoch ||
      !same(row.claim_expires_at, claim.expiresAt) ||
      Date.parse(this.#clock()) >= Date.parse(claim.expiresAt)
    ) {
      throw new StaleWorkerClaimError(claim.commandId);
    }
  }

  #assertCanvas(command: DurableCommand): void {
    if (
      command.kind !== "canvas.operation" ||
      command.target.kind !== "canvas-document"
    ) {
      throw new Error("Canonical commit requires a canvas operation.");
    }
  }

  #assertLease(command: DurableCommand): void {
    this.#leases.assert({
      projectId: command.projectId,
      targetId: command.target.id,
      leaseId: command.authority.leaseId,
      fencingEpoch: command.authority.fencingEpoch,
    });
  }

  #exactTargetReceipt(
    receipt: TargetReceipt,
    command: DurableCommand,
    outbox: OutboxRecord & { readonly phase: "effect-applied" },
    operation: ReturnType<typeof CanvasOperationSchema.parse>,
  ): TargetReceipt {
    const { receiptHash, ...material } = receipt;
    if (
      receiptHash !==
        hashCanonicalValue(TargetReceiptHashMaterialSchema.parse(material)) ||
      receipt.commandId !== command.id ||
      receipt.outboxId !== outbox.id ||
      receipt.projectId !== command.projectId ||
      receipt.taskId !== command.taskId ||
      receipt.runId !== command.runId ||
      receipt.target.kind !== command.target.kind ||
      receipt.target.id !== command.target.id ||
      receipt.idempotencyKey !== command.idempotencyKey ||
      receipt.commandActionDigest !== command.actionDigest ||
      receipt.operationActionDigest !== operation.actionDigest ||
      receipt.payloadHash !== command.payloadHash ||
      receipt.expectedBeforeHash !== operation.expectedBeforeHash ||
      receipt.resultingHash !== outbox.resultingHash ||
      receipt.appliedAt !== outbox.appliedAt ||
      receipt.operationId !== operation.id ||
      receipt.leaseId !== command.authority.leaseId ||
      receipt.fencingEpoch !== command.authority.fencingEpoch ||
      receipt.workerClaimId.length === 0 ||
      receipt.workerClaimFencingEpoch < 1
    ) {
      throw new Error("Target receipt is not exact canvas authority.");
    }
    return receipt;
  }

  #head(projectId: string): {
    readonly sequence: number;
    readonly eventHash: string | null;
  } {
    const project = this.#reader.project(projectId);
    const last = project.events.at(-1);
    return {
      sequence: last?.sequence ?? 0,
      eventHash: last?.eventHash ?? null,
    };
  }

  #insertEvent(event: ReturnType<typeof CanvasOperationCommittedEventSchema.parse>): void {
    this.#database.run(
      `INSERT INTO trace_events (
        id, project_id, sequence, schema_version, task_id, run_id, family,
        actor_kind, actor_id, command_id, outbox_id, target_kind, target_id,
        idempotency_key, command_action_digest, operation_action_digest,
        expected_before_hash, resulting_hash, target_receipt_hash,
        verification_request_digest, verification_evidence_hash,
        verification_checked_at, operation_id, applied_revision, lease_id,
        fencing_epoch, occurred_at, event_action_digest,
        previous_event_hash, event_hash, event_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event.id, event.projectId, event.sequence, event.schemaVersion,
      event.taskId, event.runId, event.family, event.actor.kind,
      event.actor.id, event.commandId, event.outboxId, event.target.kind,
      event.target.id, event.idempotencyKey, event.commandActionDigest,
      event.operationActionDigest, event.expectedBeforeHash,
      event.resultingHash, event.targetReceiptHash,
      event.verificationRequestDigest, event.verificationEvidenceHash,
      event.verificationCheckedAt, event.operationId, event.appliedRevision,
      event.leaseId, event.fencingEpoch, event.occurredAt,
      event.eventActionDigest, event.previousEventHash, event.eventHash,
      canonicalJson(event),
    );
  }

  #writeHead(event: ReturnType<typeof CanvasOperationCommittedEventSchema.parse>): void {
    this.#database.run(
      `INSERT INTO trace_heads (
        project_id, last_sequence, last_event_id, last_event_hash,
        schema_version
      ) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(project_id) DO UPDATE SET
        last_sequence = excluded.last_sequence,
        last_event_id = excluded.last_event_id,
        last_event_hash = excluded.last_event_hash`,
      event.projectId, event.sequence, event.id, event.eventHash,
    );
  }

  #insertBinding(
    prepared: PreparedCanvasVerification,
    event: ReturnType<typeof CanvasOperationCommittedEventSchema.parse>,
    digest: string,
    verification: TargetVerificationResult & { readonly status: "verified-applied" },
    committedAt: string,
  ): void {
    this.#database.run(
      `INSERT INTO trace_effect_bindings (
        command_id, outbox_id, event_id, project_id, target_kind,
        target_id, verification_attempt_id, verification_attempt_state,
        binding_digest,
        target_receipt_hash, verification_request_digest,
        verification_evidence_hash, resulting_hash, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?, ?)`,
      prepared.command.id, prepared.outbox.id, event.id,
      prepared.command.projectId, prepared.command.target.kind,
      prepared.command.target.id, prepared.request.challenge.id, digest,
      prepared.targetReceipt.receiptHash, prepared.request.requestDigest,
      verification.evidenceHash, prepared.targetReceipt.resultingHash,
      committedAt,
    );
  }

  #acceptVerification(
    prepared: PreparedCanvasVerification,
    verification: TargetVerificationResult & {
      readonly status: "verified-applied";
    },
  ): void {
    const accepted = this.#database.run(
      `UPDATE target_verification_attempts
       SET state = 'accepted', evidence_hash = ?,
           response_json = ?, checked_at = ?, resolved_at = ?
       WHERE id = ? AND state = 'issued'
         AND request_digest = ? AND command_id = ?
         AND outbox_id = ? AND target_receipt_hash = ?`,
      verification.evidenceHash,
      canonicalJson(verification),
      verification.checkedAt,
      this.#clock(),
      prepared.request.challenge.id,
      prepared.request.requestDigest,
      prepared.command.id,
      prepared.outbox.id,
      prepared.targetReceipt.receiptHash,
    );
    if (accepted !== 1) {
      throw new StaleWorkerClaimError(prepared.command.id);
    }
  }

  #assertRaceReplay(
    prepared: PreparedCanvasVerification,
    verification: TargetVerificationResult & {
      readonly status: "verified-applied";
    },
    receipt: CanvasCommittedEffectReceipt,
  ): void {
    const binding = this.#database.one(
      `SELECT verification_attempt_id,
              verification_request_digest,
              verification_evidence_hash, target_receipt_hash,
              resulting_hash, binding_digest
       FROM trace_effect_bindings WHERE command_id = ?`,
      prepared.command.id,
    );
    const material = CanvasTraceEffectBindingHashMaterialSchema.parse({
      schemaVersion: 1,
      projectId: prepared.command.projectId,
      commandId: prepared.command.id,
      outboxId: prepared.outbox.id,
      eventId: receipt.eventId,
      eventHash: receipt.eventHash,
      target: {
        kind: prepared.command.target.kind,
        id: prepared.command.target.id,
      },
      targetReceiptHash: prepared.targetReceipt.receiptHash,
      verificationAttemptId: prepared.request.challenge.id,
      verificationRequestDigest: prepared.request.requestDigest,
      verificationEvidenceHash: verification.evidenceHash,
      resultingHash: prepared.targetReceipt.resultingHash,
    });
    if (
      binding === undefined ||
      !same(
        binding.verification_attempt_id,
        prepared.request.challenge.id,
      ) ||
      !same(
        binding.verification_request_digest,
        prepared.request.requestDigest,
      ) ||
      !same(
        binding.verification_evidence_hash,
        verification.evidenceHash,
      ) ||
      !same(
        binding.target_receipt_hash,
        prepared.targetReceipt.receiptHash,
      ) ||
      !same(
        binding.resulting_hash,
        prepared.targetReceipt.resultingHash,
      ) ||
      !same(binding.binding_digest, hashCanonicalValue(material))
    ) {
      throw new EffectVerificationError(
        "COMMIT_TRACE_CONFLICT",
        "Concurrent canvas commit authority changed.",
      );
    }
  }

  #insertReceipt(
    prepared: PreparedCanvasVerification,
    receipt: CanvasCommittedEffectReceipt,
  ): void {
    this.#database.run(
      `INSERT INTO effect_receipts (
        command_id, outbox_id, event_id, project_id, target_kind,
        target_id, binding_digest, receipt_hash, receipt_json, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      prepared.command.id, prepared.outbox.id, receipt.eventId,
      prepared.command.projectId, prepared.command.target.kind,
      prepared.command.target.id, receipt.bindingDigest,
      receipt.receiptHash, canonicalJson(receipt), receipt.committedAt,
    );
  }

  #commitOutbox(
    prepared: PreparedCanvasVerification,
    eventId: string,
    committedAt: string,
  ): void {
    const committed = OutboxRecordSchema.parse({
      ...prepared.outbox,
      phase: "committed",
      committedAt,
      traceEventId: eventId,
    });
    OutboxTransitionSchema.parse({
      from: prepared.outbox,
      to: committed,
    });
    const changes = this.#database.run(
      `UPDATE outbox SET phase = 'committed', record_json = ?,
         worker_id = NULL, claim_expires_at = NULL
       WHERE id = ? AND command_id = ? AND phase = 'effect-applied'
         AND worker_id = ? AND claim_epoch = ?
         AND claim_expires_at = ? AND record_json = ?`,
      canonicalJson(committed), prepared.outbox.id, prepared.command.id,
      prepared.claim.workerId, prepared.claim.fencingEpoch,
      prepared.claim.expiresAt, prepared.outboxJson,
    );
    if (changes !== 1) {
      throw new StaleWorkerClaimError(prepared.command.id);
    }
  }
}
