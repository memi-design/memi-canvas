import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import {
  TARGET_VERIFICATION_FRESHNESS_MS,
  TargetVerificationRequestHashMaterialSchema,
  TargetVerificationRequestSchema,
  TargetVerificationEvidenceHashMaterialSchema,
  TargetVerificationResultSchema,
  type TargetVerificationRequest,
  type TargetVerificationResult,
} from "../../protocol/src/index.js";
import { RuntimeDatabase } from "./database.js";
import { StaleWorkerClaimError } from "./errors.js";
import type {
  CanvasAuthority,
  PreparedCanvasVerification,
} from "./canvas-trace-commit-store.js";
import type {
  CommitClaim,
  RecoveryChallengeFactory,
} from "./types.js";

export class CanvasVerificationJournal {
  readonly #database: RuntimeDatabase;
  readonly #clock: () => string;
  readonly #challengeFactory: RecoveryChallengeFactory;

  constructor(
    database: RuntimeDatabase,
    clock: () => string,
    challengeFactory: RecoveryChallengeFactory,
  ) {
    this.#database = database;
    this.#clock = clock;
    this.#challengeFactory = challengeFactory;
  }

  prepare(
    authority: CanvasAuthority,
    claim: CommitClaim,
  ): PreparedCanvasVerification {
    const resumed = this.#resume(authority, claim);
    if (resumed !== undefined) {
      return resumed;
    }
    const issuedAt = this.#clock();
    const requestMaterial =
      TargetVerificationRequestHashMaterialSchema.parse({
        schemaVersion: 1,
        projectId: authority.command.projectId,
        target: authority.command.target,
        idempotencyKey: authority.command.idempotencyKey,
        commandId: authority.command.id,
        commandActionDigest: authority.command.actionDigest,
        operationActionDigest: authority.operation.actionDigest,
        expectedBeforeHash: authority.operation.expectedBeforeHash,
        expectedResultingHash: authority.targetReceipt.resultingHash,
        expectedReceiptHash: authority.targetReceipt.receiptHash,
        challenge: { ...this.#challengeFactory(), issuedAt },
      });
    const request = TargetVerificationRequestSchema.parse({
      ...requestMaterial,
      requestDigest: hashCanonicalValue(requestMaterial),
    });
    const requestJson = canonicalJson(request);
    this.#database.run(
      `INSERT INTO target_verification_attempts (
        id, project_id, command_id, outbox_id, target_kind, target_id,
        claim_worker_id, claim_epoch, claim_expires_at,
        apply_worker_claim_id, apply_claim_epoch, target_receipt_hash,
        request_digest, request_json, state, issued_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?)`,
      request.challenge.id,
      authority.command.projectId,
      authority.command.id,
      authority.outbox.id,
      authority.command.target.kind,
      authority.command.target.id,
      claim.workerId,
      claim.fencingEpoch,
      claim.expiresAt,
      authority.applyWorkerClaimId,
      authority.applyClaimEpoch,
      authority.targetReceipt.receiptHash,
      request.requestDigest,
      requestJson,
      issuedAt,
    );
    const latchRecoveryJson = canonicalJson({
      status: "verification-challenge-pending",
      request,
    });
    const changes = this.#database.run(
      `UPDATE target_schedule_latches
       SET recovery_json = ?, updated_at = ?
       WHERE outbox_id = ? AND command_id = ?
         AND state = 'pending-commit'
         AND worker_claim_id = ? AND claim_epoch = ?
         AND recovery_json IS NULL`,
      latchRecoveryJson,
      issuedAt,
      authority.outbox.id,
      authority.command.id,
      authority.applyWorkerClaimId,
      authority.applyClaimEpoch,
    );
    if (changes !== 1) {
      throw new StaleWorkerClaimError(claim.commandId);
    }
    return {
      ...authority,
      latchRecoveryJson,
      claim,
      request,
      requestJson,
    };
  }

  reject(
    prepared: PreparedCanvasVerification,
    reason: string,
    result?: unknown,
  ): void {
    this.#database.transaction(() => {
      let validResult: TargetVerificationResult | undefined;
      try {
        const candidate = TargetVerificationResultSchema.safeParse(result);
        if (candidate.success) {
          const { evidenceHash, ...material } = candidate.data;
          if (
            evidenceHash ===
            hashCanonicalValue(
              TargetVerificationEvidenceHashMaterialSchema.parse(
                material,
              ),
            )
          ) {
            validResult = candidate.data;
          }
        }
      } catch {
        validResult = undefined;
      }
      const response = validResult ?? {
        status: "rejected-response",
        reason: reason.slice(0, 512),
      };
      const changed = this.#rejectAttempt(
        prepared.request,
        prepared.command.id,
        prepared.outbox.id,
        prepared.targetReceipt.receiptHash,
        response,
        validResult?.evidenceHash ?? hashCanonicalValue(response),
        validResult?.checkedAt ?? this.#clock(),
      );
      const cleared = this.#database.run(
        `UPDATE target_schedule_latches
         SET recovery_json = NULL, updated_at = ?
         WHERE outbox_id = ? AND command_id = ?
           AND state = 'pending-commit'
           AND worker_claim_id = ? AND claim_epoch = ?
           AND recovery_json = ?`,
        this.#clock(),
        prepared.outbox.id,
        prepared.command.id,
        prepared.applyWorkerClaimId,
        prepared.applyClaimEpoch,
        prepared.latchRecoveryJson,
      );
      if (changed !== 1 || cleared !== 1) {
        throw new StaleWorkerClaimError(prepared.command.id);
      }
    });
  }

  #resume(
    authority: CanvasAuthority,
    claim: CommitClaim,
  ): PreparedCanvasVerification | undefined {
    if (authority.latchRecoveryJson === null) {
      return undefined;
    }
    let request: TargetVerificationRequest;
    try {
      const recovery = JSON.parse(authority.latchRecoveryJson) as {
        readonly request: unknown;
      };
      request = TargetVerificationRequestSchema.parse(recovery.request);
      if (
        canonicalJson({
          status: "verification-challenge-pending",
          request,
        }) !== authority.latchRecoveryJson
      ) {
        throw new Error("Pending verification latch is not canonical.");
      }
    } catch {
      throw new Error("Pending verification latch is corrupt.");
    }
    const row = this.#database.one(
      `SELECT state, request_json, command_id, outbox_id,
              target_receipt_hash, claim_worker_id, claim_epoch,
              claim_expires_at, apply_worker_claim_id,
              apply_claim_epoch
       FROM target_verification_attempts
       WHERE id = ? AND request_digest = ?`,
      request.challenge.id,
      request.requestDigest,
    );
    const challengeAge =
      Date.parse(this.#clock()) - Date.parse(request.challenge.issuedAt);
    const fresh =
      challengeAge >= 0 &&
      challengeAge <= TARGET_VERIFICATION_FRESHNESS_MS;
    if (
      row === undefined ||
      String(row.request_json) !== canonicalJson(request) ||
      String(row.command_id) !== authority.command.id ||
      String(row.outbox_id) !== authority.outbox.id ||
      String(row.target_receipt_hash) !==
        authority.targetReceipt.receiptHash ||
      String(row.apply_worker_claim_id) !==
        authority.applyWorkerClaimId ||
      Number(row.apply_claim_epoch) !== authority.applyClaimEpoch
    ) {
      throw new Error(
        "Pending verification attempt does not match its latch.",
      );
    }
    if (
      String(row.state) === "issued" &&
      String(row.claim_worker_id) === claim.workerId &&
      Number(row.claim_epoch) === claim.fencingEpoch &&
      String(row.claim_expires_at) === claim.expiresAt &&
      fresh
    ) {
      return {
        ...authority,
        claim,
        request,
        requestJson: canonicalJson(request),
      };
    }
    if (String(row.state) === "issued") {
      const response = {
        status: "superseded-verification-attempt",
        reason: fresh ? "commit claim changed" : "challenge expired",
      };
      this.#rejectAttempt(
        request,
        authority.command.id,
        authority.outbox.id,
        authority.targetReceipt.receiptHash,
        response,
        hashCanonicalValue(response),
        this.#clock(),
      );
    }
    const cleared = this.#database.run(
      `UPDATE target_schedule_latches
       SET recovery_json = NULL, updated_at = ?
       WHERE outbox_id = ? AND recovery_json = ?`,
      this.#clock(),
      authority.outbox.id,
      authority.latchRecoveryJson,
    );
    if (cleared !== 1) {
      throw new StaleWorkerClaimError(authority.command.id);
    }
    return undefined;
  }

  #rejectAttempt(
    request: TargetVerificationRequest,
    commandId: string,
    outboxId: string,
    receiptHash: string,
    response: unknown,
    evidenceHash: string,
    checkedAt: string,
  ): number {
    return this.#database.run(
      `UPDATE target_verification_attempts
       SET state = 'rejected', evidence_hash = ?,
           response_json = ?, checked_at = ?, resolved_at = ?
       WHERE id = ? AND request_digest = ? AND command_id = ?
         AND outbox_id = ? AND target_receipt_hash = ?
         AND state = 'issued'`,
      evidenceHash,
      canonicalJson(response),
      checkedAt,
      this.#clock(),
      request.challenge.id,
      request.requestDigest,
      commandId,
      outboxId,
      receiptHash,
    );
  }
}
