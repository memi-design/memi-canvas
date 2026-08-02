import { z } from "zod";
import {
  ContentHashSchema,
  GitRevisionSchema,
  IsoTimestampSchema,
  SchemaVersionSchema,
} from "./common.js";
import {
  ArtifactIdSchema,
  CanvasDocumentIdSchema,
  CapabilityGrantIdSchema,
  CapturePlanIdSchema,
  ChangeSetIdSchema,
  CheckpointIdSchema,
  CoverageCellIdSchema,
  DurableCommandIdSchema,
  IdempotencyKeySchema,
  LeaseIdSchema,
  OperationIdSchema,
  OutboxIdSchema,
  ProjectIdSchema,
  RecoveryAttemptIdSchema,
  RunIdSchema,
  TaskIdSchema,
  TraceEventIdSchema,
  WorktreeIdSchema,
} from "./ids.js";

const OutboxEffectSchema = z.strictObject({
  kind: z.enum([
    "canvas.operation",
    "artifact.persist",
    "sandbox.process",
    "git.effect",
    "external.publish",
  ]),
  targetId: z.string().trim().min(1),
  expectedBeforeHash: ContentHashSchema,
  payloadHash: ContentHashSchema,
});

const outboxBase = {
  schemaVersion: SchemaVersionSchema,
  id: OutboxIdSchema,
  commandId: DurableCommandIdSchema,
  projectId: ProjectIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  actionDigest: ContentHashSchema,
  effect: OutboxEffectSchema,
  createdAt: IsoTimestampSchema,
};

const OutboxIntentSchema = z.strictObject({
  ...outboxBase,
  phase: z.literal("intent"),
});

const OutboxEffectAppliedSchema = z.strictObject({
  ...outboxBase,
  phase: z.literal("effect-applied"),
  appliedAt: IsoTimestampSchema,
  resultingHash: ContentHashSchema,
});

const OutboxCommittedSchema = z.strictObject({
  ...outboxBase,
  phase: z.literal("committed"),
  appliedAt: IsoTimestampSchema,
  resultingHash: ContentHashSchema,
  committedAt: IsoTimestampSchema,
  traceEventId: TraceEventIdSchema,
});

const OutboxFailedSchema = z.strictObject({
  ...outboxBase,
  phase: z.literal("failed"),
  failedFrom: z.enum(["intent", "effect-applied"]),
  failedAt: IsoTimestampSchema,
  error: z.strictObject({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
    message: z.string().trim().min(1),
    retryable: z.boolean(),
  }),
});

export const OutboxRecordSchema = z.discriminatedUnion("phase", [
  OutboxIntentSchema,
  OutboxEffectAppliedSchema,
  OutboxCommittedSchema,
  OutboxFailedSchema,
]);
export type OutboxRecord = z.infer<typeof OutboxRecordSchema>;

const OUTBOX_TRANSITIONS: Readonly<
  Record<OutboxRecord["phase"], readonly OutboxRecord["phase"][]>
> = {
  intent: ["effect-applied", "failed"],
  "effect-applied": ["committed", "failed"],
  committed: [],
  failed: [],
};

function outboxIdentity(record: OutboxRecord): string {
  return JSON.stringify({
    schemaVersion: record.schemaVersion,
    id: record.id,
    commandId: record.commandId,
    projectId: record.projectId,
    idempotencyKey: record.idempotencyKey,
    actionDigest: record.actionDigest,
    effect: record.effect,
    createdAt: record.createdAt,
  });
}

export const OutboxTransitionSchema = z
  .strictObject({
    from: OutboxRecordSchema,
    to: OutboxRecordSchema,
  })
  .superRefine(({ from, to }, context) => {
    if (outboxIdentity(from) !== outboxIdentity(to)) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Outbox command identity cannot change.",
      });
    }

    if (from.phase === to.phase) {
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        context.addIssue({
          code: "custom",
          path: ["to"],
          message: "Same-phase outbox retries must be byte-equivalent.",
        });
      }
      return;
    }

    if (!OUTBOX_TRANSITIONS[from.phase].includes(to.phase)) {
      context.addIssue({
        code: "custom",
        path: ["to", "phase"],
        message: `Outbox cannot transition from ${from.phase} to ${to.phase}.`,
      });
      return;
    }

    if (to.phase === "failed" && to.failedFrom !== from.phase) {
      context.addIssue({
        code: "custom",
        path: ["to", "failedFrom"],
        message: "Failure evidence must identify the phase that failed.",
      });
    }

    if (
      from.phase === "effect-applied" &&
      to.phase === "committed" &&
      (to.resultingHash !== from.resultingHash ||
        to.appliedAt !== from.appliedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["to", "resultingHash"],
        message: "Committed evidence must preserve the applied result.",
      });
    }

    const fromTime =
      from.phase === "effect-applied"
        ? from.appliedAt
        : from.phase === "committed"
          ? from.committedAt
          : from.phase === "failed"
            ? from.failedAt
            : from.createdAt;
    const toTime =
      to.phase === "effect-applied"
        ? to.appliedAt
        : to.phase === "committed"
          ? to.committedAt
          : to.phase === "failed"
            ? to.failedAt
            : to.createdAt;
    if (Date.parse(toTime) < Date.parse(fromTime)) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Outbox transition time cannot move backwards.",
      });
    }
  });
export type OutboxTransition = z.infer<typeof OutboxTransitionSchema>;

export const CaptureStatusSchema = z.enum([
  "planned",
  "queued",
  "capturing",
  "verified",
  "partial",
  "blocked",
  "unsupported",
  "not_applicable",
  "omitted",
  "stale",
  "invalid",
]);

const CaptureCellSchema = z
  .strictObject({
    coverageCellId: CoverageCellIdSchema,
    priority: z.enum(["critical", "default", "secondary"]),
    status: CaptureStatusSchema,
    reason: z.string().trim().min(1).optional(),
  })
  .superRefine((cell, context) => {
    if (
      (cell.status === "blocked" ||
        cell.status === "omitted" ||
        cell.status === "unsupported" ||
        cell.status === "invalid") &&
      cell.reason === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: `${cell.status} capture cells require a reason.`,
      });
    }
  });

export const CapturePlanSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: CapturePlanIdSchema,
  projectId: ProjectIdSchema,
  sourceRevision: GitRevisionSchema,
  budgets: z.strictObject({
    maxCells: z.number().int().positive(),
    maxRuntimeSeconds: z.number().int().positive(),
    maxConcurrency: z.number().int().positive(),
    maxBrowserStorageBytes: z.number().int().positive(),
    maxArtifactBytes: z.number().int().positive(),
  }),
  cells: z.array(CaptureCellSchema),
});
export type CapturePlan = z.infer<typeof CapturePlanSchema>;

export const ArtifactClassificationSchema = z.enum([
  "public",
  "project-private",
  "sensitive",
  "authentication",
  "prohibited",
]);
export type ArtifactClassification = z.infer<
  typeof ArtifactClassificationSchema
>;

export const ArtifactDescriptorSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: ArtifactIdSchema,
    projectId: ProjectIdSchema,
    contentHash: ContentHashSchema,
    byteLength: z.number().int().nonnegative(),
    mediaType: z.string().trim().min(1),
    classification: ArtifactClassificationSchema,
    storage: z.literal("content-addressed"),
    redaction: z.enum(["complete", "pending"]),
    createdAt: IsoTimestampSchema,
  })
  .superRefine((artifact, context) => {
    if (
      artifact.classification === "authentication" ||
      artifact.classification === "prohibited"
    ) {
      context.addIssue({
        code: "custom",
        path: ["classification"],
        message: `${artifact.classification} material cannot enter the artifact store.`,
      });
    }

    if (
      artifact.classification === "sensitive" &&
      artifact.redaction !== "complete"
    ) {
      context.addIssue({
        code: "custom",
        path: ["redaction"],
        message: "Sensitive artifacts must be redacted before persistence.",
      });
    }
  });
export type ArtifactDescriptor = z.infer<typeof ArtifactDescriptorSchema>;

export const CapabilitySchema = z.enum([
  "canvas:read",
  "canvas:propose",
  "canvas:apply",
  "source:read",
  "source:propose",
  "source:apply",
  "process:start",
  "network:access",
  "git:commit",
  "git:push",
  "external:publish",
]);
export type Capability = z.infer<typeof CapabilitySchema>;

const MUTATING_CAPABILITIES = new Set([
  "canvas:apply",
  "source:apply",
  "process:start",
  "git:commit",
  "git:push",
  "external:publish",
]);

export const CapabilityGrantSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: CapabilityGrantIdSchema,
    projectId: ProjectIdSchema,
    clientId: z.string().trim().min(1),
    capabilities: z.array(CapabilitySchema).min(1),
    constraints: z.strictObject({
      canonicalPaths: z.array(z.string().startsWith("/")),
      allowedHosts: z.array(z.string().trim().min(1)),
      actionDigest: ContentHashSchema,
      maximumUses: z.number().int().positive(),
    }),
    issuedAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
  })
  .superRefine((grant, context) => {
    if (Date.parse(grant.expiresAt) <= Date.parse(grant.issuedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Capability grants must expire after issuance.",
      });
    }

    const mutatesFilesystem = grant.capabilities.some(
      (capability) =>
        MUTATING_CAPABILITIES.has(capability) && capability !== "canvas:apply",
    );
    if (mutatesFilesystem && grant.constraints.canonicalPaths.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["constraints", "canonicalPaths"],
        message: "Filesystem mutations require canonical path constraints.",
      });
    }
  });
export type CapabilityGrant = z.infer<typeof CapabilityGrantSchema>;

export const LeaseSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: LeaseIdSchema,
    projectId: ProjectIdSchema,
    targetId: z.string().trim().min(1),
    holderId: z.string().trim().min(1),
    fencingEpoch: z.number().int().positive(),
    acquiredAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
  })
  .superRefine((lease, context) => {
    if (Date.parse(lease.expiresAt) <= Date.parse(lease.acquiredAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Leases must expire after acquisition.",
      });
    }
  });
export type Lease = z.infer<typeof LeaseSchema>;

const checkpointBase = {
  schemaVersion: SchemaVersionSchema,
  id: CheckpointIdSchema,
  projectId: ProjectIdSchema,
  createdAt: IsoTimestampSchema,
  canvas: z.strictObject({
    documentId: CanvasDocumentIdSchema,
    operationCursor: OperationIdSchema,
    stateHash: ContentHashSchema,
  }),
  task: z.strictObject({
    taskId: TaskIdSchema,
    runId: RunIdSchema,
    traceSequence: z.number().int().positive(),
  }),
};

const CanvasTaskCheckpointSchema = z.strictObject({
  ...checkpointBase,
  kind: z.literal("canvas-task"),
  source: z.null(),
});

const ChangeSetCheckpointSchema = z.strictObject({
  ...checkpointBase,
  kind: z.literal("changeset"),
  source: z.strictObject({
    changeSetId: ChangeSetIdSchema,
    worktreeId: WorktreeIdSchema,
    baselineCommit: GitRevisionSchema,
    treeHash: ContentHashSchema,
  }),
});

export const CheckpointSchema = z.discriminatedUnion("kind", [
  CanvasTaskCheckpointSchema,
  ChangeSetCheckpointSchema,
]);
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const RecoveryActionSchema = z.enum([
  "replay-read-only",
  "fork-from-checkpoint",
  "restore-pre-commit-worktree",
  "revert-post-commit",
]);

export const RecoveryRecordSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: RecoveryAttemptIdSchema,
  projectId: ProjectIdSchema,
  checkpointId: CheckpointIdSchema,
  action: RecoveryActionSchema,
  requestedAt: IsoTimestampSchema,
  status: z.enum(["requested", "running", "completed", "blocked", "failed"]),
});
export type RecoveryRecord = z.infer<typeof RecoveryRecordSchema>;
