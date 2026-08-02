import { z } from "zod";
import {
  ArtifactIdSchema,
  RuntimeCaptureScreenV1Schema,
  type RuntimeCaptureScreenV1,
} from "@memi/protocol";

const ConfidenceBasisSchema = z.enum([
  "runtime-geometry",
  "runtime-hierarchy",
  "computed-style",
  "source-anchor",
  "inferred",
]);

export const RepositoryReconstructionReviewSchema = z
  .strictObject({
    confidenceBySemanticKey: z.record(
      z.string().trim().min(1).max(160),
      z.strictObject({
        basis: z.array(ConfidenceBasisSchema).min(1).max(16),
        score: z.number().finite().min(0).max(1),
      }),
    ),
    fidelity: z.strictObject({
      diffArtifactId: ArtifactIdSchema.nullable(),
      evaluatedAt: z.iso.datetime({ offset: true }).nullable(),
      maximumGeometryDelta: z.number().finite().nonnegative().nullable(),
      ssim: z.number().finite().min(0).max(1).nullable(),
      status: z.enum(["verified", "needs-review"]),
    }),
    schemaVersion: z.literal(1),
  })
  .superRefine(({ fidelity }, context) => {
    if (fidelity.status !== "verified") return;
    if (fidelity.ssim === null || fidelity.ssim < 0.985) {
      context.addIssue({
        code: "custom",
        message: "Verified reconstruction SSIM must be at least 0.985.",
        path: ["fidelity", "ssim"],
      });
    }
    if (
      fidelity.maximumGeometryDelta === null ||
      fidelity.maximumGeometryDelta > 1
    ) {
      context.addIssue({
        code: "custom",
        message: "Verified reconstruction geometry must be within one point.",
        path: ["fidelity", "maximumGeometryDelta"],
      });
    }
    if (fidelity.diffArtifactId === null) {
      context.addIssue({
        code: "custom",
        message: "Verified reconstruction requires a difference artifact.",
        path: ["fidelity", "diffArtifactId"],
      });
    }
    if (fidelity.evaluatedAt === null) {
      context.addIssue({
        code: "custom",
        message: "Verified reconstruction requires an evaluation timestamp.",
        path: ["fidelity", "evaluatedAt"],
      });
    }
  });

export type RepositoryReconstructionReview = z.infer<
  typeof RepositoryReconstructionReviewSchema
>;

const RepositoryReconstructionArtifactSchema = z.strictObject({
  capture: RuntimeCaptureScreenV1Schema,
  review: RepositoryReconstructionReviewSchema,
  schemaVersion: z.literal(1),
});

export interface ParsedRepositoryReconstructionArtifact {
  readonly capture: RuntimeCaptureScreenV1;
  readonly review: RepositoryReconstructionReview | null;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  Object.values(object).forEach((child) => deepFreeze(child, seen));
  return Object.freeze(value);
}

export function parseRepositoryReconstructionArtifact(
  value: unknown,
): ParsedRepositoryReconstructionArtifact {
  const legacy = RuntimeCaptureScreenV1Schema.safeParse(value);
  if (legacy.success) {
    return deepFreeze({ capture: legacy.data, review: null });
  }
  const artifact = RepositoryReconstructionArtifactSchema.parse(value);
  return deepFreeze({
    capture: artifact.capture,
    review: artifact.review,
  });
}
