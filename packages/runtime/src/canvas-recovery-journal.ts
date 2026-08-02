import type { RuntimeDatabase } from "./database.js";
import { json } from "./runtime-records.js";
import type { CanvasRecoveryCandidate } from "./canvas-effect-store.js";

export type RecoveryEvidenceDisposition =
  | "accepted-found"
  | "accepted-not-found"
  | "blocked-target"
  | "rejected-response";

export function recordRecoveryEvidence(
  database: RuntimeDatabase,
  clock: () => string,
  candidate: CanvasRecoveryCandidate,
  disposition: RecoveryEvidenceDisposition,
  evidence: unknown,
  responseHash: string,
): void {
  const serialized = json(evidence);
  if (Buffer.byteLength(serialized) > 16_384) {
    throw new Error("Target recovery evidence exceeded its bound.");
  }
  const checkedAt =
    typeof evidence === "object" &&
    evidence !== null &&
    "checkedAt" in evidence
      ? String(evidence.checkedAt)
      : null;
  const evidenceHash =
    typeof evidence === "object" &&
    evidence !== null &&
    "evidenceHash" in evidence
      ? String(evidence.evidenceHash)
      : null;
  database.run(
    `INSERT INTO target_recovery_evidence (
      request_digest, challenge_id, command_id, outbox_id,
      disposition, checked_at, evidence_hash, response_hash,
      evidence_json, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    candidate.lookup.requestDigest,
    candidate.lookup.challenge.id,
    candidate.command.id,
    candidate.outbox.id,
    disposition,
    checkedAt,
    evidenceHash,
    responseHash,
    serialized,
    clock(),
  );
}
