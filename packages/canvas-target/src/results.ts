import { hashCanonicalValue } from "@memi/canonical-json";
import {
  TargetApplyOutcomeSchema,
  TargetFenceActivationResultSchema,
  TargetLookupEvidenceHashMaterialSchema,
  TargetLookupResultSchema,
  TargetVerificationEvidenceHashMaterialSchema,
  TargetVerificationResultSchema,
  type ContentHash,
  type TargetApplyOutcome,
  type TargetFenceActivationRequest,
  type TargetFenceActivationResult,
  type TargetLookupEvidenceHashMaterial,
  type TargetLookupResult,
  type TargetVerificationEvidenceHashMaterial,
  type TargetVerificationResult,
} from "@memi/protocol";

export function evidenceHash(value: unknown): ContentHash {
  return hashCanonicalValue(value) as ContentHash;
}

export function lookupResult(
  input: TargetLookupEvidenceHashMaterial,
): TargetLookupResult {
  const material =
    TargetLookupEvidenceHashMaterialSchema.parse(input);
  return TargetLookupResultSchema.parse({
    ...material,
    evidenceHash: evidenceHash(material),
  });
}

export function verificationResult(
  input: TargetVerificationEvidenceHashMaterial,
): TargetVerificationResult {
  const material =
    TargetVerificationEvidenceHashMaterialSchema.parse(input);
  return TargetVerificationResultSchema.parse({
    ...material,
    evidenceHash: evidenceHash(material),
  });
}

export function notApplied(
  code:
    | "STALE_TARGET"
    | "STALE_FENCE"
    | "STALE_CLAIM"
    | "IDEMPOTENCY_CONFLICT"
    | "TARGET_NOT_FOUND"
    | "INVALID_REQUEST"
    | "APPLY_REJECTED",
  message: string,
  currentTargetHash: ContentHash | null,
  detail?: unknown,
): TargetApplyOutcome {
  return TargetApplyOutcomeSchema.parse({
    schemaVersion: 1,
    status: "not-applied",
    evidence: {
      code,
      message,
      currentTargetHash,
      evidenceHash: evidenceHash({
        kind: "target-not-applied",
        code,
        message,
        currentTargetHash,
        detail: detail ?? null,
      }),
    },
  });
}

export function unknownOutcome(
  code: "ACKNOWLEDGEMENT_LOST" | "INTERNAL_ERROR",
  message: string,
): TargetApplyOutcome {
  return TargetApplyOutcomeSchema.parse({
    schemaVersion: 1,
    status: "outcome-unknown",
    error: { code, message: message.slice(0, 512) },
  });
}

export function fenceResult(
  request: TargetFenceActivationRequest,
  status: "activated" | "replayed" | "rejected",
  highestFence: number,
  code?: "STALE_FENCE" | "FENCE_IDENTITY_CONFLICT",
): TargetFenceActivationResult {
  return TargetFenceActivationResultSchema.parse({
    ...request,
    status,
    highestFence,
    ...(code === undefined ? {} : { code }),
  });
}
