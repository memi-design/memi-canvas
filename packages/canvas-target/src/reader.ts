import { hashCanonicalValue } from "@memi/canonical-json";
import { hashCanvasDocument } from "@memi/canvas-document";
import {
  CanvasDocumentIdSchema,
  CanvasDocumentSchema,
  CanvasOperationSchema,
  ProjectIdSchema,
  TargetLookupRequestHashMaterialSchema,
  TargetLookupRequestSchema,
  TargetReceiptSchema,
  TargetVerificationRequestHashMaterialSchema,
  TargetVerificationRequestSchema,
  TARGET_VERIFICATION_FRESHNESS_MS,
  type CanvasDocument,
  type TargetLookupRequest,
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
  lookupResult,
  verificationResult,
} from "./results.js";
import type { CanvasTargetFaults } from "./types.js";

export class TargetCorruptionError extends Error {
  readonly code:
    | "RECEIPT_CORRUPT"
    | "TARGET_CORRUPT"
    | "LEDGER_CORRUPT";

  constructor(
    code: TargetCorruptionError["code"],
    message: string,
  ) {
    super(message);
    this.name = "TargetCorruptionError";
    this.code = code;
  }
}

export class CanvasTargetReader {
  readonly #database: TargetDatabase;
  readonly #faults: CanvasTargetFaults | undefined;
  readonly #clock: () => string;

  constructor(
    database: TargetDatabase,
    faults: CanvasTargetFaults | undefined,
    clock: () => string,
  ) {
    this.#database = database;
    this.#faults = faults;
    this.#clock = clock;
  }

  async lookup(input: unknown): Promise<TargetLookupResult> {
    const parsed = TargetLookupRequestSchema.safeParse(input);
    if (!parsed.success) {
      const checkedAt = this.#clock();
      const requestDigest = hashCanonicalValue({
        kind: "invalid-lookup-request",
        issues: parsed.error.issues,
      });
      return lookupResult({
        schemaVersion: 1,
        status: "mismatch",
        code: "RECEIPT_IDENTITY_MISMATCH",
        message: "Lookup request failed strict validation.",
        requestDigest,
        checkedAt,
      });
    }
    const { requestDigest, ...untrustedMaterial } = parsed.data;
    const material =
      TargetLookupRequestHashMaterialSchema.parse(untrustedMaterial);
    if (requestDigest !== hashCanonicalValue(material)) {
      return lookupResult({
        schemaVersion: 1,
        status: "mismatch",
        code: "RECEIPT_IDENTITY_MISMATCH",
        message: "Lookup request digest does not match its identity.",
        requestDigest,
        checkedAt: this.#clock(),
      });
    }
    try {
      return await this.#database.readTransaction(() =>
        this.lookupTrusted(parsed.data),
      );
    } catch (error) {
      if (error instanceof TargetCorruptionError) {
        return lookupResult({
          schemaVersion: 1,
          status: "corrupt",
          code: error.code,
          message: error.message,
          requestDigest: parsed.data.requestDigest,
          checkedAt: this.#clock(),
        });
      }
      return lookupResult({
        schemaVersion: 1,
        status: "unavailable",
        code: "TARGET_UNAVAILABLE",
        message:
          error instanceof Error
            ? error.message
            : "Canvas target is unavailable.",
        requestDigest: parsed.data.requestDigest,
        checkedAt: this.#clock(),
      });
    }
  }

  unavailable(input: unknown, message: string): TargetLookupResult {
    const request = TargetLookupRequestSchema.parse(input);
    return lookupResult({
      schemaVersion: 1,
      status: "unavailable",
      code: "TARGET_UNAVAILABLE",
      message,
      requestDigest: request.requestDigest,
      checkedAt: this.#clock(),
    });
  }

  async verify(input: unknown): Promise<TargetVerificationResult> {
    const parsed = TargetVerificationRequestSchema.safeParse(input);
    if (!parsed.success) {
      const checkedAt = this.#clock();
      const requestDigest = hashCanonicalValue({
        kind: "invalid-verification-request",
        issues: parsed.error.issues,
      });
      return verificationResult({
        schemaVersion: 1,
        status: "mismatch",
        code: "EXPECTED_EVIDENCE_MISMATCH",
        message: "Verification request failed strict validation.",
        requestDigest,
        checkedAt,
      });
    }
    const request = parsed.data;
    const checkedAt = this.#clock();
    const {
      requestDigest,
      ...untrustedRequestMaterial
    } = request;
    const requestMaterial =
      TargetVerificationRequestHashMaterialSchema.parse(
        untrustedRequestMaterial,
      );
    if (requestDigest !== hashCanonicalValue(requestMaterial)) {
      return verificationResult({
        schemaVersion: 1,
        status: "mismatch",
        code: "RECEIPT_IDENTITY_MISMATCH",
        message:
          "Verification request digest does not match its identity.",
        requestDigest,
        checkedAt,
      });
    }
    const issuedAt = Date.parse(request.challenge.issuedAt);
    const observedAt = Date.parse(checkedAt);
    if (
      issuedAt > observedAt ||
      observedAt - issuedAt >
        TARGET_VERIFICATION_FRESHNESS_MS
    ) {
      return verificationResult({
        schemaVersion: 1,
        status: "mismatch",
        code: "EXPECTED_EVIDENCE_MISMATCH",
        message:
          "Verification challenge is outside its freshness window.",
        requestDigest,
        checkedAt,
      });
    }
    const lookupMaterial =
      TargetLookupRequestHashMaterialSchema.parse({
        schemaVersion: request.schemaVersion,
        projectId: request.projectId,
        target: request.target,
        idempotencyKey: request.idempotencyKey,
        commandId: request.commandId,
        commandActionDigest: request.commandActionDigest,
        operationActionDigest: request.operationActionDigest,
        expectedBeforeHash: request.expectedBeforeHash,
        challenge: request.challenge,
      });
    const lookup = await this.lookup({
      ...lookupMaterial,
      requestDigest: hashCanonicalValue(lookupMaterial),
    });
    if (lookup.status === "found") {
      if (
        lookup.receipt.receiptHash !==
          request.expectedReceiptHash ||
        lookup.receipt.resultingHash !==
          request.expectedResultingHash
      ) {
        return verificationResult({
          schemaVersion: 1,
          status: "mismatch",
          code: "EXPECTED_EVIDENCE_MISMATCH",
          message:
            "Trusted receipt differs from expected verification evidence.",
          requestDigest,
          checkedAt: this.#clock(),
        });
      }
      return verificationResult({
        schemaVersion: 1,
        status: "verified-applied",
        receipt: lookup.receipt,
        currentTargetHash: lookup.currentTargetHash,
        requestDigest,
        checkedAt: this.#clock(),
      });
    }
    if (lookup.status === "not-found") {
      return verificationResult({
        schemaVersion: 1,
        status: "verified-not-applied",
        expectedBeforeHash: request.expectedBeforeHash,
        currentTargetHash: lookup.currentTargetHash,
        requestDigest,
        checkedAt: this.#clock(),
      });
    }
    if (lookup.status === "unavailable") {
      return verificationResult({
        schemaVersion: 1,
        status: lookup.status,
        code: lookup.code,
        message: lookup.message,
        requestDigest,
        checkedAt: this.#clock(),
      });
    }
    if (lookup.status === "corrupt") {
      return verificationResult({
        schemaVersion: 1,
        status: lookup.status,
        code: lookup.code,
        message: lookup.message,
        requestDigest,
        checkedAt: this.#clock(),
      });
    }
    return verificationResult({
      schemaVersion: 1,
      status: "mismatch",
      code:
        lookup.code === "TARGET_HASH_MISMATCH"
          ? "TARGET_HASH_MISMATCH"
          : "RECEIPT_IDENTITY_MISMATCH",
      message: lookup.message,
      requestDigest,
      checkedAt: this.#clock(),
    });
  }

  verificationUnavailable(
    input: unknown,
    message: string,
  ): TargetVerificationResult {
    const request = TargetVerificationRequestSchema.parse(input);
    return verificationResult({
      schemaVersion: 1,
      status: "unavailable",
      code: "TARGET_UNAVAILABLE",
      message,
      requestDigest: request.requestDigest,
      checkedAt: this.#clock(),
    });
  }

  readDocument(
    untrustedProjectId: string,
    untrustedTargetId: string,
  ): CanvasDocument {
    const projectId = ProjectIdSchema.parse(untrustedProjectId);
    const targetId = CanvasDocumentIdSchema.parse(untrustedTargetId);
    return this.documentFromRow(
      this.requireDocumentRow(projectId, targetId),
    );
  }

  async lookupTrusted(
    request: TargetLookupRequest,
  ): Promise<TargetLookupResult> {
    const document = this.readDocument(
      request.projectId,
      request.target.id,
    );
    await this.#faults?.afterLookupDocumentRead?.();
    const ledger = this.#database.one(
      `SELECT *
       FROM idempotency_ledger
       WHERE project_id = ? AND target_id = ?
         AND idempotency_key = ?`,
      request.projectId,
      request.target.id,
      request.idempotencyKey,
    );
    if (ledger === undefined) {
      if (document.stateHash !== request.expectedBeforeHash) {
        return lookupResult({
          schemaVersion: 1,
          status: "mismatch",
          code: "TARGET_HASH_MISMATCH",
          message:
            "No receipt exists and the target differs from the baseline.",
          requestDigest: request.requestDigest,
          checkedAt: this.#clock(),
        });
      }
      return lookupResult({
        schemaVersion: 1,
        status: "not-found",
        currentTargetHash: document.stateHash,
        requestDigest: request.requestDigest,
        checkedAt: this.#clock(),
      });
    }
    const receipt = this.receiptForLedger(ledger);
    if (!this.ledgerMatchesLookup(ledger, request)) {
      return lookupResult({
        schemaVersion: 1,
        status: "mismatch",
        code: "RECEIPT_IDENTITY_MISMATCH",
        message: "Target ledger identity differs from the lookup.",
        requestDigest: request.requestDigest,
        checkedAt: this.#clock(),
      });
    }
    if (document.stateHash !== receipt.resultingHash) {
      return lookupResult({
        schemaVersion: 1,
        status: "mismatch",
        code: "TARGET_HASH_MISMATCH",
        message: "Current target differs from the durable receipt.",
        requestDigest: request.requestDigest,
        checkedAt: this.#clock(),
      });
    }
    return lookupResult({
      schemaVersion: 1,
      status: "found",
      receipt,
      currentTargetHash: document.stateHash,
      requestDigest: request.requestDigest,
      checkedAt: this.#clock(),
    });
  }

  receiptForLedger(row: SqlRow): TargetReceipt {
    const receiptRow = this.#database.one(
      `SELECT receipt_hash, project_id, target_id, command_id,
              receipt_json
       FROM receipts
       WHERE receipt_hash = ?`,
      text(row, "receipt_hash"),
    );
    if (receiptRow === undefined) {
      throw new TargetCorruptionError(
        "LEDGER_CORRUPT",
        "Target ledger references a missing receipt.",
      );
    }
    let unknownReceipt: unknown;
    try {
      unknownReceipt = JSON.parse(text(receiptRow, "receipt_json"));
    } catch {
      throw new TargetCorruptionError(
        "RECEIPT_CORRUPT",
        "Target receipt is not valid JSON.",
      );
    }
    const parsed = TargetReceiptSchema.safeParse(unknownReceipt);
    if (!parsed.success) {
      throw new TargetCorruptionError(
        "RECEIPT_CORRUPT",
        "Target receipt failed strict validation.",
      );
    }
    const { receiptHash, ...material } = parsed.data;
    if (
      receiptHash !== text(row, "receipt_hash") ||
      receiptHash !== text(receiptRow, "receipt_hash") ||
      hashCanonicalValue(material) !== receiptHash
    ) {
      throw new TargetCorruptionError(
        "RECEIPT_CORRUPT",
        "Target receipt hash validation failed.",
      );
    }
    if (
      !this.receiptRowMatchesLedger(receiptRow, row) ||
      !this.receiptMatchesLedger(parsed.data, row)
    ) {
      throw new TargetCorruptionError(
        "LEDGER_CORRUPT",
        "Target ledger and receipt identity differ.",
      );
    }
    this.validateOperationForLedger(row, parsed.data);
    return parsed.data;
  }

  documentFromRow(row: SqlRow): CanvasDocument {
    const document = this.parseDocument(text(row, "document_json"));
    if (
      document.revision !== integer(row, "revision") ||
      document.stateHash !== text(row, "state_hash") ||
      hashCanvasDocument(document) !== document.stateHash ||
      hashCanonicalValue(document) !==
        text(row, "document_record_hash")
    ) {
      throw new TargetCorruptionError(
        "TARGET_CORRUPT",
        "Canvas target integrity validation failed.",
      );
    }
    return document;
  }

  parseDocument(serialized: string): CanvasDocument {
    try {
      return CanvasDocumentSchema.parse(JSON.parse(serialized));
    } catch {
      throw new TargetCorruptionError(
        "TARGET_CORRUPT",
        "Canvas target failed strict validation.",
      );
    }
  }

  requireDocumentRow(
    projectId: string,
    targetId: string,
  ): SqlRow {
    const row = this.#database.one(
      `SELECT revision, state_hash, document_record_hash,
              document_json
       FROM documents
       WHERE project_id = ? AND target_id = ?`,
      projectId,
      targetId,
    );
    if (row === undefined) {
      throw new Error(`Canvas target "${targetId}" does not exist.`);
    }
    return row;
  }

  private ledgerMatchesLookup(
    row: SqlRow,
    request: TargetLookupRequest,
  ): boolean {
    return (
      text(row, "command_id") === request.commandId &&
      text(row, "command_action_digest") ===
        request.commandActionDigest &&
      text(row, "operation_action_digest") ===
        request.operationActionDigest &&
      text(row, "expected_before_hash") ===
        request.expectedBeforeHash
    );
  }

  private receiptMatchesLedger(
    receipt: TargetReceipt,
    row: SqlRow,
  ): boolean {
    return (
      receipt.receiptHash === text(row, "receipt_hash") &&
      receipt.projectId === text(row, "project_id") &&
      receipt.target.id === text(row, "target_id") &&
      receipt.idempotencyKey === text(row, "idempotency_key") &&
      receipt.taskId === text(row, "task_id") &&
      receipt.runId === text(row, "run_id") &&
      receipt.outboxId === text(row, "outbox_id") &&
      receipt.commandId === text(row, "command_id") &&
      receipt.commandActionDigest ===
        text(row, "command_action_digest") &&
      receipt.operationActionDigest ===
        text(row, "operation_action_digest") &&
      receipt.payloadHash === text(row, "payload_hash") &&
      receipt.expectedBeforeHash ===
        text(row, "expected_before_hash") &&
      receipt.leaseId === text(row, "lease_id") &&
      receipt.leaseHolderId === text(row, "lease_holder_id") &&
      receipt.fencingEpoch === integer(row, "fencing_epoch") &&
      receipt.workerClaimId === text(row, "worker_claim_id") &&
      receipt.workerClaimFencingEpoch ===
        integer(row, "worker_claim_epoch") &&
      receipt.resultingHash === text(row, "resulting_hash") &&
      receipt.operationId === text(row, "operation_id") &&
      receipt.appliedRevision === integer(row, "applied_revision") &&
      receipt.appliedAt === text(row, "applied_at") &&
      receipt.adapterContractVersion ===
        integer(row, "adapter_contract_version")
    );
  }

  private receiptRowMatchesLedger(
    receiptRow: SqlRow,
    ledgerRow: SqlRow,
  ): boolean {
    return (
      text(receiptRow, "receipt_hash") ===
        text(ledgerRow, "receipt_hash") &&
      text(receiptRow, "project_id") ===
        text(ledgerRow, "project_id") &&
      text(receiptRow, "target_id") ===
        text(ledgerRow, "target_id") &&
      text(receiptRow, "command_id") ===
        text(ledgerRow, "command_id")
    );
  }

  private validateOperationForLedger(
    row: SqlRow,
    receipt: TargetReceipt,
  ): void {
    const operationRow = this.#database.one(
      `SELECT project_id, target_id, operation_id, command_id,
              operation_json, operation_hash, resulting_hash,
              applied_revision, applied_at
       FROM operations
       WHERE project_id = ? AND target_id = ?
         AND operation_id = ? AND command_id = ?`,
      text(row, "project_id"),
      text(row, "target_id"),
      text(row, "operation_id"),
      text(row, "command_id"),
    );
    if (operationRow === undefined) {
      throw new TargetCorruptionError(
        "LEDGER_CORRUPT",
        "Target ledger references a missing operation.",
      );
    }
    let unknownOperation: unknown;
    try {
      unknownOperation = JSON.parse(
        text(operationRow, "operation_json"),
      );
    } catch {
      throw new TargetCorruptionError(
        "LEDGER_CORRUPT",
        "Target operation is not valid JSON.",
      );
    }
    const parsed = CanvasOperationSchema.safeParse(unknownOperation);
    if (!parsed.success) {
      throw new TargetCorruptionError(
        "LEDGER_CORRUPT",
        "Target operation failed strict validation.",
      );
    }
    const operation = parsed.data;
    const operationHash = hashCanonicalValue(operation);
    if (
      text(operationRow, "project_id") !==
        text(row, "project_id") ||
      text(operationRow, "target_id") !==
        text(row, "target_id") ||
      text(operationRow, "operation_id") !==
        text(row, "operation_id") ||
      text(operationRow, "command_id") !==
        text(row, "command_id") ||
      text(operationRow, "operation_hash") !== operationHash ||
      text(row, "operation_hash") !== operationHash ||
      text(row, "payload_hash") !== operationHash ||
      receipt.payloadHash !== operationHash ||
      operation.documentId !== text(row, "target_id") ||
      operation.id !== text(row, "operation_id") ||
      operation.actionDigest !==
        text(row, "operation_action_digest") ||
      operation.actionDigest !== receipt.operationActionDigest ||
      operation.expectedBeforeHash !==
        text(row, "expected_before_hash") ||
      operation.expectedBeforeHash !==
        receipt.expectedBeforeHash ||
      operation.resultingHash !==
        text(operationRow, "resulting_hash") ||
      operation.resultingHash !== text(row, "resulting_hash") ||
      operation.resultingHash !== receipt.resultingHash ||
      integer(operationRow, "applied_revision") !==
        integer(row, "applied_revision") ||
      integer(operationRow, "applied_revision") !==
        receipt.appliedRevision ||
      text(operationRow, "applied_at") !==
        text(row, "applied_at") ||
      text(operationRow, "applied_at") !== receipt.appliedAt
    ) {
      throw new TargetCorruptionError(
        "LEDGER_CORRUPT",
        "Target ledger and operation identity differ.",
      );
    }
  }
}
