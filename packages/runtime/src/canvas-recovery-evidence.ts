import { hashCanonicalValue } from "@memi/canonical-json";
import {
  TargetLookupEvidenceHashMaterialSchema,
  TargetLookupRequestHashMaterialSchema,
  TargetLookupRequestSchema,
  TargetLookupResultSchema,
  type TargetLookupRequest,
  type TargetLookupResult,
} from "../../protocol/src/index.js";

import type { RecoveryChallengeSeed } from "./types.js";

export const RECOVERY_EVIDENCE_FRESHNESS_MS = 30_000;
const MAX_RESPONSE_BYTES = 16_384;

export function bindRecoveryChallenge(
  identity: Readonly<Record<string, unknown>>,
  seed: RecoveryChallengeSeed,
  issuedAt: string,
): TargetLookupRequest {
  const material = TargetLookupRequestHashMaterialSchema.parse({
    ...identity,
    challenge: { ...seed, issuedAt },
  });
  return TargetLookupRequestSchema.parse({
    ...material,
    requestDigest: hashCanonicalValue(material),
  });
}

export type LookupValidation =
  | {
      readonly accepted: true;
      readonly result: TargetLookupResult;
      readonly responseHash: string;
    }
  | {
      readonly accepted: false;
      readonly reason: string;
      readonly responseHash: string;
    };

function boundedResponseHash(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (
      serialized === undefined ||
      Buffer.byteLength(serialized) > MAX_RESPONSE_BYTES
    ) {
      return hashCanonicalValue({ kind: "oversized-response" });
    }
    return hashCanonicalValue(JSON.parse(serialized) as unknown);
  } catch {
    return hashCanonicalValue({ kind: "unserializable-response" });
  }
}

export function rejectedLookup(
  value: unknown,
  reason: string,
): LookupValidation {
  return {
    accepted: false,
    reason: reason.slice(0, 256),
    responseHash: boundedResponseHash(value),
  };
}

export function validateLookupEvidence(
  request: TargetLookupRequest,
  value: unknown,
  now: string,
): LookupValidation {
  const responseHash = boundedResponseHash(value);
  const parsed = TargetLookupResultSchema.safeParse(value);
  if (!parsed.success) {
    return {
      accepted: false,
      reason: "Target lookup result failed strict validation.",
      responseHash,
    };
  }
  const result = parsed.data;
  const { evidenceHash, ...untrustedMaterial } = result;
  const material =
    TargetLookupEvidenceHashMaterialSchema.parse(untrustedMaterial);
  if (result.requestDigest !== request.requestDigest) {
    return {
      accepted: false,
      reason: "Target lookup result echoed a different request digest.",
      responseHash,
    };
  }
  if (evidenceHash !== hashCanonicalValue(material)) {
    return {
      accepted: false,
      reason: "Target lookup evidence hash is invalid.",
      responseHash,
    };
  }
  const issuedAt = Date.parse(request.challenge.issuedAt);
  const checkedAt = Date.parse(result.checkedAt);
  const observedAt = Date.parse(now);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(checkedAt) ||
    !Number.isFinite(observedAt)
  ) {
    return rejectedLookup(value, "Target lookup timestamps are invalid.");
  }
  if (checkedAt < issuedAt) {
    return rejectedLookup(
      value,
      "Target lookup evidence predates its recovery challenge.",
    );
  }
  if (
    issuedAt > observedAt ||
    observedAt - issuedAt > RECOVERY_EVIDENCE_FRESHNESS_MS
  ) {
    return rejectedLookup(
      value,
      "Target recovery challenge exceeded the freshness window.",
    );
  }
  if (checkedAt > observedAt) {
    return rejectedLookup(
      value,
      "Target lookup evidence is future dated.",
    );
  }
  if (observedAt - checkedAt > RECOVERY_EVIDENCE_FRESHNESS_MS) {
    return rejectedLookup(
      value,
      "Target lookup evidence exceeded the freshness window.",
    );
  }
  return { accepted: true, result, responseHash };
}
