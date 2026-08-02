import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import {
  applyCanvasOperation,
  hashCanvasDocument,
} from "@memi/canvas-document";
import {
  CanvasDocumentSchema,
  TargetApplyOutcomeSchema,
  TargetEffectRequestSchema,
  TargetFenceActivationRequestSchema,
  TargetReceiptHashMaterialSchema,
  TargetReceiptSchema,
  TARGET_ADAPTER_CONTRACT_VERSION,
  type CanvasDocument,
  type TargetApplyOutcome,
  type TargetEffectRequest,
  type TargetFenceActivationRequest,
  type TargetFenceActivationResult,
  type TargetLookupResult,
  type TargetReceipt,
  type TargetVerificationResult,
} from "@memi/protocol";

import {
  TargetDatabase,
  integer,
  text,
  type SqlRow,
} from "./database.js";
import {
  fenceResult,
  notApplied,
  unknownOutcome,
} from "./results.js";
import { CanvasTargetReader } from "./reader.js";
import type { CanvasTargetAuthorityOptions } from "./types.js";

function json(value: unknown): string {
  return canonicalJson(value);
}

export class CanvasTargetAuthority {
  readonly #database: TargetDatabase;
  readonly #reader: CanvasTargetReader;
  readonly #clock: () => string;
  readonly #faults: CanvasTargetAuthorityOptions["faults"];
  #closeRequested = false;
  #inFlightEffects = 0;

  constructor(options: CanvasTargetAuthorityOptions) {
    this.#database = new TargetDatabase(
      options.databasePath,
      options.faults,
    );
    this.#reader = new CanvasTargetReader(
      this.#database,
      options.faults,
      options.clock,
    );
    this.#clock = options.clock;
    this.#faults = options.faults;
  }

  createDocument(input: CanvasDocument): CanvasDocument {
    this.#assertAcceptingWork();
    const document = CanvasDocumentSchema.parse(input);
    if (hashCanvasDocument(document) !== document.stateHash) {
      throw new Error("Canvas document state hash is invalid.");
    }
    return this.#database.transaction(() => {
      const existing = this.#database.one(
        `SELECT revision, state_hash, document_record_hash,
                document_json
         FROM documents
         WHERE project_id = ? AND target_id = ?`,
        document.projectId,
        document.id,
      );
      if (existing !== undefined) {
        const persisted = this.#reader.documentFromRow(existing);
        if (json(persisted) !== json(document)) {
          throw new Error(
            `Canvas target "${document.id}" already exists with different content.`,
          );
        }
        return persisted;
      }
      this.#database.run(
        `INSERT INTO documents (
          project_id, target_id, revision, state_hash,
          document_record_hash, document_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        document.projectId,
        document.id,
        document.revision,
        document.stateHash,
        hashCanonicalValue(document),
        json(document),
      );
      return document;
    });
  }

  activateFence(
    input: TargetFenceActivationRequest,
  ): TargetFenceActivationResult {
    this.#assertAcceptingWork();
    const request = TargetFenceActivationRequestSchema.parse(input);
    return this.#database.transaction(() => {
      this.#reader.requireDocumentRow(
        request.projectId,
        request.target.id,
      );
      const existing = this.#database.one(
        `SELECT highest_fence, lease_id, holder_id
         FROM target_fences
         WHERE project_id = ? AND target_id = ?`,
        request.projectId,
        request.target.id,
      );
      if (existing === undefined) {
        const result = fenceResult(
          request,
          "activated",
          request.fencingEpoch,
        );
        this.#database.run(
          `INSERT INTO target_fences (
            project_id, target_id, highest_fence, lease_id,
            holder_id, activation_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          request.projectId,
          request.target.id,
          request.fencingEpoch,
          request.leaseId,
          request.holderId,
          json(result),
        );
        return result;
      }

      const highestFence = integer(existing, "highest_fence");
      if (request.fencingEpoch < highestFence) {
        return fenceResult(
          request,
          "rejected",
          highestFence,
          "STALE_FENCE",
        );
      }
      if (request.fencingEpoch === highestFence) {
        const exactIdentity =
          text(existing, "lease_id") === request.leaseId &&
          text(existing, "holder_id") === request.holderId;
        return fenceResult(
          request,
          exactIdentity ? "replayed" : "rejected",
          highestFence,
          exactIdentity ? undefined : "FENCE_IDENTITY_CONFLICT",
        );
      }

      const result = fenceResult(
        request,
        "activated",
        request.fencingEpoch,
      );
      this.#database.run(
        `UPDATE target_fences
         SET highest_fence = ?, lease_id = ?, holder_id = ?,
             activation_json = ?
         WHERE project_id = ? AND target_id = ?`,
        request.fencingEpoch,
        request.leaseId,
        request.holderId,
        json(result),
        request.projectId,
        request.target.id,
      );
      return result;
    });
  }

  async compareAndApply(
    input: unknown,
  ): Promise<TargetApplyOutcome> {
    const parsed = TargetEffectRequestSchema.safeParse(input);
    if (!parsed.success) {
      return notApplied(
        "INVALID_REQUEST",
        "Target effect request failed strict validation.",
        null,
        parsed.error.issues,
      );
    }
    const request = parsed.data;
    if (hashCanonicalValue(request.payload) !== request.payloadHash) {
      return notApplied(
        "INVALID_REQUEST",
        "Canvas payload hash does not match the closed request.",
        null,
      );
    }
    if (this.#closeRequested) {
      return unknownOutcome(
        "INTERNAL_ERROR",
        "Canvas target authority is closed.",
      );
    }
    this.#inFlightEffects += 1;
    try {
      await this.#faults?.beforeTransaction?.();
      const outcome = this.#database.transaction(() =>
        this.#compareAndApplyTransaction(request),
      );
      if (outcome.status === "applied") {
        try {
          await this.#faults?.afterCommit?.(outcome.receipt);
        } catch (error) {
          return unknownOutcome(
            "ACKNOWLEDGEMENT_LOST",
            error instanceof Error
              ? error.message
              : "Target acknowledgement was lost.",
          );
        }
      }
      return outcome;
    } catch (error) {
      return unknownOutcome(
        "INTERNAL_ERROR",
        error instanceof Error
          ? error.message
          : "Canvas target authority failed unexpectedly.",
      );
    } finally {
      this.#inFlightEffects -= 1;
      this.#closeIfDrained();
    }
  }

  async lookup(input: unknown): Promise<TargetLookupResult> {
    if (this.#closeRequested) {
      return this.#reader.unavailable(
        input,
        "Canvas target authority is closed.",
      );
    }
    return this.#reader.lookup(input);
  }

  async verify(input: unknown): Promise<TargetVerificationResult> {
    if (this.#closeRequested) {
      return this.#reader.verificationUnavailable(
        input,
        "Canvas target authority is closed.",
      );
    }
    return this.#reader.verify(input);
  }

  readDocument(
    untrustedProjectId: string,
    untrustedTargetId: string,
  ): CanvasDocument {
    this.#assertAcceptingWork();
    return this.#reader.readDocument(
      untrustedProjectId,
      untrustedTargetId,
    );
  }

  close(): void {
    this.#closeRequested = true;
    this.#closeIfDrained();
  }

  #compareAndApplyTransaction(
    request: TargetEffectRequest,
  ): TargetApplyOutcome {
    const documentRow = this.#database.one(
      `SELECT revision, state_hash, document_record_hash,
              document_json
       FROM documents
       WHERE project_id = ? AND target_id = ?`,
      request.projectId,
      request.target.id,
    );
    if (documentRow === undefined) {
      return notApplied(
        "TARGET_NOT_FOUND",
        "Canvas target does not exist.",
        null,
      );
    }
    const document = this.#reader.documentFromRow(documentRow);
    const ledger = this.#database.one(
      `SELECT *
       FROM idempotency_ledger
       WHERE project_id = ? AND target_id = ?
         AND idempotency_key = ?`,
      request.projectId,
      request.target.id,
      request.idempotencyKey,
    );
    if (ledger !== undefined) {
      const receipt = this.#reader.receiptForLedger(ledger);
      if (!this.#ledgerMatches(ledger, request)) {
        return notApplied(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key is bound to another target action.",
          document.stateHash,
        );
      }
      const rejectedAttempt = this.#rejectedAttempt(
        request,
        document.stateHash,
      );
      if (rejectedAttempt !== undefined) {
        return rejectedAttempt;
      }
      return TargetApplyOutcomeSchema.parse({
        schemaVersion: 1,
        status: "replayed",
        receipt,
      });
    }
    const rejectedAttempt = this.#rejectedAttempt(
      request,
      document.stateHash,
    );
    if (rejectedAttempt !== undefined) {
      return rejectedAttempt;
    }

    if (document.stateHash !== request.target.expectedBeforeHash) {
      return notApplied(
        "STALE_TARGET",
        "Canvas target no longer matches the reviewed baseline.",
        document.stateHash,
      );
    }
    if (
      request.target.baseline.kind === "canvas-revision" &&
      request.target.baseline.revision !== document.revision
    ) {
      return notApplied(
        "STALE_TARGET",
        "Canvas target revision differs from the reviewed baseline.",
        document.stateHash,
      );
    }

    let applied: CanvasDocument;
    try {
      applied = applyCanvasOperation(document, request.payload);
    } catch (error) {
      return notApplied(
        "APPLY_REJECTED",
        error instanceof Error
          ? error.message
          : "Canvas operation was rejected.",
        document.stateHash,
      );
    }
    const appliedAt = this.#clock();
    const material = TargetReceiptHashMaterialSchema.parse({
      schemaVersion: 1,
      adapterContractVersion: TARGET_ADAPTER_CONTRACT_VERSION,
      projectId: request.projectId,
      taskId: request.taskId,
      runId: request.runId,
      commandId: request.commandId,
      outboxId: request.outboxId,
      target: {
        kind: request.target.kind,
        id: request.target.id,
      },
      idempotencyKey: request.idempotencyKey,
      commandActionDigest: request.commandActionDigest,
      operationActionDigest: request.operationActionDigest,
      payloadHash: request.payloadHash,
      expectedBeforeHash: request.target.expectedBeforeHash,
      resultingHash: applied.stateHash,
      leaseId: request.lease.id,
      leaseHolderId: request.lease.holderId,
      fencingEpoch: request.lease.fencingEpoch,
      workerClaimId: request.workerClaim.id,
      workerClaimFencingEpoch:
        request.workerClaim.fencingEpoch,
      operationId: request.payload.id,
      appliedRevision: applied.revision,
      appliedAt,
    });
    const receipt = TargetReceiptSchema.parse({
      ...material,
      receiptHash: hashCanonicalValue(material),
    });

    const changes = this.#database.run(
      `UPDATE documents
       SET revision = ?, state_hash = ?, document_record_hash = ?,
           document_json = ?
       WHERE project_id = ? AND target_id = ?
         AND revision = ? AND state_hash = ?`,
      applied.revision,
      applied.stateHash,
      hashCanonicalValue(applied),
      json(applied),
      request.projectId,
      request.target.id,
      document.revision,
      document.stateHash,
    );
    if (changes !== 1) {
      throw new Error(
        "Canvas target compare-and-apply lost its atomic update.",
      );
    }
    this.#persistApplied(request, receipt, appliedAt);
    return TargetApplyOutcomeSchema.parse({
      schemaVersion: 1,
      status: "applied",
      receipt,
    });
  }

  #persistApplied(
    request: TargetEffectRequest,
    receipt: TargetReceipt,
    appliedAt: string,
  ): void {
    this.#database.run(
      `INSERT INTO operations (
        project_id, target_id, operation_id, command_id,
        operation_json, operation_hash, resulting_hash,
        applied_revision, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      request.projectId,
      request.target.id,
      request.payload.id,
      request.commandId,
      json(request.payload),
      hashCanonicalValue(request.payload),
      receipt.resultingHash,
      receipt.appliedRevision,
      appliedAt,
    );
    this.#database.run(
      `INSERT INTO receipts (
        receipt_hash, project_id, target_id, command_id, receipt_json
      ) VALUES (?, ?, ?, ?, ?)`,
      receipt.receiptHash,
      request.projectId,
      request.target.id,
      request.commandId,
      json(receipt),
    );
    this.#database.run(
      `INSERT INTO idempotency_ledger (
        project_id, target_id, idempotency_key, task_id, run_id,
        outbox_id, command_id,
        command_action_digest, operation_action_digest, payload_hash,
        expected_before_hash, lease_id, lease_holder_id, fencing_epoch,
        worker_claim_id, worker_claim_epoch, resulting_hash,
        operation_id, operation_hash, applied_revision, applied_at,
        receipt_hash, adapter_contract_version
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?
      )`,
      request.projectId,
      request.target.id,
      request.idempotencyKey,
      request.taskId,
      request.runId,
      request.outboxId,
      request.commandId,
      request.commandActionDigest,
      request.operationActionDigest,
      request.payloadHash,
      request.target.expectedBeforeHash,
      request.lease.id,
      request.lease.holderId,
      request.lease.fencingEpoch,
      request.workerClaim.id,
      request.workerClaim.fencingEpoch,
      receipt.resultingHash,
      request.payload.id,
      hashCanonicalValue(request.payload),
      receipt.appliedRevision,
      receipt.appliedAt,
      receipt.receiptHash,
      TARGET_ADAPTER_CONTRACT_VERSION,
    );
  }

  #ledgerMatches(
    row: SqlRow,
    request: TargetEffectRequest,
  ): boolean {
    return (
      text(row, "command_id") === request.commandId &&
      text(row, "command_action_digest") ===
        request.commandActionDigest &&
      text(row, "operation_action_digest") ===
        request.operationActionDigest &&
      text(row, "payload_hash") === request.payloadHash &&
      text(row, "expected_before_hash") ===
        request.target.expectedBeforeHash &&
      text(row, "task_id") === request.taskId &&
      text(row, "run_id") === request.runId &&
      text(row, "outbox_id") === request.outboxId &&
      text(row, "operation_id") === request.payload.id &&
      integer(row, "adapter_contract_version") ===
        TARGET_ADAPTER_CONTRACT_VERSION
    );
  }

  #rejectedAttempt(
    request: TargetEffectRequest,
    currentTargetHash: string,
  ): TargetApplyOutcome | undefined {
    if (
      Date.parse(request.workerClaim.expiresAt) <=
      Date.parse(this.#clock())
    ) {
      return notApplied(
        "STALE_CLAIM",
        "Worker claim expired before the target transaction.",
        currentTargetHash,
      );
    }
    const fence = this.#database.one(
      `SELECT highest_fence, lease_id, holder_id
       FROM target_fences
       WHERE project_id = ? AND target_id = ?`,
      request.projectId,
      request.target.id,
    );
    if (
      fence === undefined ||
      integer(fence, "highest_fence") !==
        request.lease.fencingEpoch ||
      text(fence, "lease_id") !== request.lease.id ||
      text(fence, "holder_id") !== request.lease.holderId
    ) {
      return notApplied(
        "STALE_FENCE",
        "Canvas target fence is not active for this lease.",
        currentTargetHash,
      );
    }
    return undefined;
  }

  #assertAcceptingWork(): void {
    if (this.#closeRequested) {
      throw new Error("Canvas target authority is closed.");
    }
  }

  #closeIfDrained(): void {
    if (this.#closeRequested && this.#inFlightEffects === 0) {
      this.#database.close();
    }
  }

}
