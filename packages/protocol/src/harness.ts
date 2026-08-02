import { z } from "zod";

import { ContentHashSchema } from "./common.js";

const IdentifierSchema = z.string().trim().min(1).max(160);
const PermissionSchema = z.string().trim().min(1).max(160);

const AssistantDeltaSignalSchema = z.strictObject({
  kind: z.literal("assistant.delta"),
  text: z.string().max(32_768),
});

const ApprovalRequestedSignalSchema = z.strictObject({
  kind: z.literal("approval.requested"),
  approvalId: IdentifierSchema,
  scopes: z.array(PermissionSchema).min(1).max(64),
});

const ApprovalResolvedSignalSchema = z.strictObject({
  kind: z.literal("approval.resolved"),
  approvalId: IdentifierSchema,
  decision: z.enum(["approved", "rejected"]),
  actorId: IdentifierSchema,
});

const DecisionAcceptedSignalSchema = z.strictObject({
  kind: z.literal("decision.accepted"),
  decisionId: IdentifierSchema,
  summary: z.string().trim().min(1).max(4_096),
});

const ArtifactProducedSignalSchema = z.strictObject({
  kind: z.literal("artifact.produced"),
  artifactRef: IdentifierSchema,
});

const CheckpointSavedSignalSchema = z.strictObject({
  kind: z.literal("checkpoint.saved"),
  checkpointId: IdentifierSchema,
});

const EffectRequestedSignalSchema = z.strictObject({
  kind: z.literal("effect.requested"),
  effectKind: z.enum([
    "canvas.operation",
    "artifact.persist",
    "source.proposal",
  ]),
  requiredPermission: PermissionSchema,
  payloadDigest: ContentHashSchema,
});

const UsageRecordedSignalSchema = z.strictObject({
  kind: z.literal("usage.recorded"),
  tokens: z.number().int().nonnegative().safe(),
  costUsdMicros: z.number().int().nonnegative().safe(),
});

const RunCompletedSignalSchema = z.strictObject({
  kind: z.literal("run.completed"),
});

const RunFailedSignalSchema = z.strictObject({
  kind: z.literal("run.failed"),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
  message: z.string().trim().min(1).max(1_024),
});

const RunPausedSignalSchema = z.strictObject({
  kind: z.literal("run.paused"),
  reason: z.string().trim().min(1).max(512),
});

const RunStoppedSignalSchema = z.strictObject({
  kind: z.literal("run.stopped"),
  reason: z.string().trim().min(1).max(512),
});

export const HarnessSignalSchema = z.discriminatedUnion("kind", [
  AssistantDeltaSignalSchema,
  ApprovalRequestedSignalSchema,
  ApprovalResolvedSignalSchema,
  DecisionAcceptedSignalSchema,
  ArtifactProducedSignalSchema,
  CheckpointSavedSignalSchema,
  EffectRequestedSignalSchema,
  UsageRecordedSignalSchema,
  RunCompletedSignalSchema,
  RunFailedSignalSchema,
  RunPausedSignalSchema,
  RunStoppedSignalSchema,
]);
export type HarnessSignal = z.infer<typeof HarnessSignalSchema>;
