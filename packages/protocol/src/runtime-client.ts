import { z } from "zod";
import {
  ContentHashSchema,
  GitRevisionSchema,
  IsoTimestampSchema,
  SafeDisplayLabelSchema,
  SchemaVersionSchema,
} from "./common.js";
import {
  ArtifactIdSchema,
  CheckpointIdSchema,
  CorrelationIdSchema,
  ProjectIdSchema,
  ProcessRequestIdSchema,
  RunIdSchema,
  WorktreeIdSchema,
} from "./ids.js";
import {
  WorkspaceSessionDraftSchemaV1,
  WorkspaceSessionSnapshotSchemaV1,
} from "./workspace-session.js";
import {
  CanvasDocumentAppendReceiptV3Schema,
  CanvasDocumentAppendV3Schema,
  CanvasDocumentIdentityV3Schema,
  CanvasDocumentJournalV3Schema,
  CanvasDocumentSnapshotV3Schema,
} from "./canvas-v3-persistence.js";
import {
  createImportRuntimeRequestSchemas,
  createImportRuntimeSuccessSchemas,
} from "./import-runtime.js";
export const MAX_RUNTIME_RPC_BYTES = 262_144;
const MAX_COLLECTION_ITEMS = 500;
const RuntimeReviewIdSchema = z
  .string()
  .regex(/^rvw_[0-9A-HJKMNP-TV-Z]{26}$/u);
const RuntimePreviewIdSchema = z
  .string()
  .regex(/^pvw_[0-9A-HJKMNP-TV-Z]{26}$/u);
const RuntimePromotionIdSchema = z
  .string()
  .regex(/^prm_[0-9A-HJKMNP-TV-Z]{26}$/u);
const BoundedIdentifierSchema = z.string().trim().min(1).max(160);
const BoundedMessageSchema = z.string().trim().min(1).max(2_048);
const BoundedNodeIdSchema = z.string().trim().min(1).max(512);
const DocumentRevisionSchema = z.number().int().nonnegative().safe();
const ResourceRevisionSchema = z.number().int().nonnegative().safe();
const SourceDocumentBindingSchema = z.strictObject({
  documentRevision: DocumentRevisionSchema,
  sourceRevision: GitRevisionSchema,
});
const ProjectRecordSchema = z.strictObject({
  id: ProjectIdSchema,
  name: SafeDisplayLabelSchema,
  sourceRevision: GitRevisionSchema,
  documentRevision: DocumentRevisionSchema,
  managedWorktreeId: WorktreeIdSchema.nullable(),
  status: z.enum(["opening", "ready", "conflicted", "unavailable"]),
  updatedAt: IsoTimestampSchema,
});
const RunRecordSchema = z.strictObject({
  id: RunIdSchema,
  projectId: ProjectIdSchema,
  revision: ResourceRevisionSchema,
  worktreeId: WorktreeIdSchema.nullable(),
  reviewId: RuntimeReviewIdSchema.nullable(),
  state: z.enum([
    "queued",
    "planning",
    "running",
    "waiting-for-approval",
    "verifying",
    "completed",
    "failed",
    "cancelled",
  ]),
  base: SourceDocumentBindingSchema,
  startedAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
const ReviewRecordSchema = z.strictObject({
  id: RuntimeReviewIdSchema,
  projectId: ProjectIdSchema,
  runId: RunIdSchema,
  revision: ResourceRevisionSchema,
  base: SourceDocumentBindingSchema,
  proposalDigest: ContentHashSchema,
  status: z.enum([
    "pending",
    "approved",
    "changes-requested",
    "rejected",
    "superseded",
  ]),
  artifactIds: z.array(ArtifactIdSchema).max(MAX_COLLECTION_ITEMS),
  changedPaths: z
    .array(z.string().trim().min(1).max(1_024))
    .max(MAX_COLLECTION_ITEMS),
  updatedAt: IsoTimestampSchema,
});
const WorktreeRecordSchema = z.strictObject({
  id: WorktreeIdSchema,
  projectId: ProjectIdSchema,
  runId: RunIdSchema.nullable(),
  revision: ResourceRevisionSchema,
  baseSourceRevision: GitRevisionSchema,
  headSourceRevision: GitRevisionSchema,
  status: z.enum(["creating", "ready", "conflicted", "merged", "removed"]),
  updatedAt: IsoTimestampSchema,
});

const PreviewRecordSchema = z.strictObject({
  id: RuntimePreviewIdSchema,
  projectId: ProjectIdSchema,
  worktreeId: WorktreeIdSchema,
  revision: ResourceRevisionSchema,
  binding: SourceDocumentBindingSchema,
  status: z.enum(["starting", "ready", "failed", "stopped"]),
  artifactIds: z.array(ArtifactIdSchema).max(MAX_COLLECTION_ITEMS),
  localUrl: z
    .string()
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        const loopback =
          url.hostname === "localhost" ||
          url.hostname === "127.0.0.1" ||
          url.hostname === "[::1]";
        return (
          (url.protocol === "http:" || url.protocol === "https:") &&
          loopback &&
          url.port.length > 0 &&
          url.username.length === 0 &&
          url.password.length === 0
        );
      } catch {
        return false;
      }
    }, "Preview URLs require credential-free HTTP(S) loopback with an explicit port.")
    .nullable(),
  updatedAt: IsoTimestampSchema,
});

const PromotionRecordSchema = z
  .strictObject({
    id: RuntimePromotionIdSchema,
    projectId: ProjectIdSchema,
    worktreeId: WorktreeIdSchema,
    reviewId: RuntimeReviewIdSchema,
    expectedOriginalRevision: GitRevisionSchema,
    expectedDirtyFingerprint: ContentHashSchema,
    status: z.enum([
      "requested",
      "blocked",
      "completed",
      "cancelled",
      "failed",
    ]),
    requestedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema.optional(),
    completedRevision: GitRevisionSchema.optional(),
  })
  .superRefine((promotion, context) => {
    const completed = promotion.status === "completed";
    if (
      completed !==
      (promotion.completedAt !== undefined &&
        promotion.completedRevision !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedRevision"],
        message:
          "Only completed promotions require exact completion evidence.",
      });
    }
  });

const requestBase = {
  schemaVersion: SchemaVersionSchema,
  requestId: ProcessRequestIdSchema,
  correlationId: CorrelationIdSchema,
  sentAt: IsoTimestampSchema,
};

function requestBranch<
  const Method extends string,
  Payload extends z.ZodType,
>(method: Method, payload: Payload) {
  return z.strictObject({
    ...requestBase,
    method: z.literal(method),
    payload,
  });
}

const ProjectsListRequestSchema = requestBranch(
  "projects.list",
  z.strictObject({}),
);
const ProjectsGetRequestSchema = requestBranch(
  "projects.get",
  z.strictObject({ projectId: ProjectIdSchema }),
);
const ImportRuntimeRequestSchemas =
  createImportRuntimeRequestSchemas(requestBase);
const SessionsRestoreRequestSchema = requestBranch(
  "sessions.restore",
  z.strictObject({
    projectId: ProjectIdSchema,
    documentId: BoundedNodeIdSchema,
  }),
);
const SessionsSaveRequestSchema = requestBranch(
  "sessions.save",
  z
    .strictObject({
      expected: z.strictObject({
        documentRevision: DocumentRevisionSchema,
        sourceRevision: GitRevisionSchema.nullable(),
        sessionRevision: ResourceRevisionSchema.nullable(),
      }),
      projectId: ProjectIdSchema,
      documentId: BoundedNodeIdSchema,
      session: WorkspaceSessionDraftSchemaV1,
    })
    .superRefine(({ documentId, expected, projectId, session }, context) => {
      if (
        projectId !== session.projectId ||
        documentId !== session.documentId ||
        expected.documentRevision !== session.documentRevision ||
        expected.sourceRevision !== session.sourceRevision
      ) {
        context.addIssue({
          code: "custom",
          path: ["expected"],
          message:
            "Session saves must preserve exact project, document, source, and document revision bindings.",
        });
      }
    }),
);
const SessionsMigrateLegacyRequestSchema = requestBranch(
  "sessions.migrateLegacy",
  z
    .strictObject({
      migrationKey: z.string().min(1).max(512).refine(
        (value) => value.trim() === value,
      ),
      legacyRecordHash: z.string().regex(/^fnv1a64:[a-f0-9]{16}$/u),
      projectId: ProjectIdSchema,
      documentId: BoundedNodeIdSchema,
      session: WorkspaceSessionDraftSchemaV1,
    })
    .superRefine(({ documentId, projectId, session }, context) => {
      if (
        projectId !== session.projectId ||
        documentId !== session.documentId
      ) {
        context.addIssue({
          code: "custom",
          path: ["session"],
          message:
            "Session migrations must preserve exact project and document bindings.",
        });
      }
    }),
);
const CanvasDocumentsOpenRequestSchema = requestBranch(
  "canvasDocuments.open",
  z.strictObject({ snapshot: CanvasDocumentSnapshotV3Schema }),
);
const CanvasDocumentsLoadRequestSchema = requestBranch(
  "canvasDocuments.load",
  z.strictObject({ identity: CanvasDocumentIdentityV3Schema }),
);
const CanvasDocumentsInitializeRequestSchema = requestBranch(
  "canvasDocuments.initialize",
  z.strictObject({ snapshot: CanvasDocumentSnapshotV3Schema }),
);
const CanvasDocumentsAppendRequestSchema = requestBranch(
  "canvasDocuments.append",
  z.strictObject({ append: CanvasDocumentAppendV3Schema }),
);
const CanvasDocumentsCheckpointRequestSchema = requestBranch(
  "canvasDocuments.checkpoint",
  z.strictObject({ snapshot: CanvasDocumentSnapshotV3Schema }),
);
const RunsStartRequestSchema = requestBranch(
  "runs.start",
  z.strictObject({
    projectId: ProjectIdSchema,
    expected: SourceDocumentBindingSchema,
    contextHash: ContentHashSchema,
    prompt: z.string().trim().min(1).max(32_768),
    harnessId: BoundedIdentifierSchema,
    modelId: BoundedIdentifierSchema,
    permissionPolicy: z
      .enum(["inspect-only", "approval", "trusted-worktree"])
      .default("approval"),
  }),
);
const RunsGetRequestSchema = requestBranch(
  "runs.get",
  z.strictObject({
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
  }),
);
const RunsCancelRequestSchema = requestBranch(
  "runs.cancel",
  z.strictObject({
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    expected: z.strictObject({
      ...SourceDocumentBindingSchema.shape,
      runRevision: ResourceRevisionSchema,
    }),
  }),
);
const RunMutationBindingSchema = z.strictObject({
  ...SourceDocumentBindingSchema.shape,
  runRevision: ResourceRevisionSchema,
});
const RunsResumeRequestSchema = requestBranch(
  "runs.resume",
  z.strictObject({
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    checkpointId: CheckpointIdSchema,
    expected: RunMutationBindingSchema,
  }),
);
const RunsRetryRequestSchema = requestBranch(
  "runs.retry",
  z.strictObject({
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    expected: RunMutationBindingSchema,
  }),
);
const RunsHandoffRequestSchema = requestBranch(
  "runs.handoff",
  z.strictObject({
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    targetHarnessId: BoundedIdentifierSchema,
    targetModelId: BoundedIdentifierSchema,
    expected: RunMutationBindingSchema,
  }),
);
const RunsCheckpointRequestSchema = requestBranch(
  "runs.checkpoint",
  z.strictObject({
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    label: SafeDisplayLabelSchema,
    expected: RunMutationBindingSchema,
  }),
);
const RunsEventsRequestSchema = requestBranch(
  "runs.events",
  z.strictObject({
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    afterSequence: z.number().int().nonnegative().safe(),
    limit: z.number().int().min(1).max(200),
    expected: RunMutationBindingSchema,
  }),
);
const ReviewsGetRequestSchema = requestBranch(
  "reviews.get",
  z.strictObject({
    projectId: ProjectIdSchema,
    reviewId: RuntimeReviewIdSchema,
  }),
);
const ReviewsResolveRequestSchema = requestBranch(
  "reviews.resolve",
  z
    .strictObject({
      projectId: ProjectIdSchema,
      reviewId: RuntimeReviewIdSchema,
      decision: z.enum(["approve", "request-changes", "reject"]),
      feedback: z.string().trim().min(1).max(8_192).optional(),
      proposalDigest: ContentHashSchema,
      expected: z.strictObject({
        ...SourceDocumentBindingSchema.shape,
        reviewRevision: ResourceRevisionSchema,
      }),
    })
    .superRefine(({ decision, feedback }, context) => {
      if (decision === "request-changes" && feedback === undefined) {
        context.addIssue({
          code: "custom",
          path: ["feedback"],
          message: "Requests for changes require bounded feedback.",
        });
      }
    }),
);
const WorktreesCreateRequestSchema = requestBranch(
  "worktrees.create",
  z.strictObject({
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    expected: SourceDocumentBindingSchema,
  }),
);
const WorktreesGetRequestSchema = requestBranch(
  "worktrees.get",
  z.strictObject({
    projectId: ProjectIdSchema,
    worktreeId: WorktreeIdSchema,
  }),
);
const PreviewsStartRequestSchema = requestBranch(
  "previews.start",
  z.strictObject({
    projectId: ProjectIdSchema,
    worktreeId: WorktreeIdSchema,
    expected: SourceDocumentBindingSchema,
  }),
);
const PreviewsGetRequestSchema = requestBranch(
  "previews.get",
  z.strictObject({
    projectId: ProjectIdSchema,
    previewId: RuntimePreviewIdSchema,
  }),
);
const PromotionsRequestRequestSchema = requestBranch(
  "promotions.request",
  z.strictObject({
    projectId: ProjectIdSchema,
    worktreeId: WorktreeIdSchema,
    reviewId: RuntimeReviewIdSchema,
    proposalDigest: ContentHashSchema,
    expected: z.strictObject({
      ...SourceDocumentBindingSchema.shape,
      reviewRevision: ResourceRevisionSchema,
      worktreeRevision: ResourceRevisionSchema,
      originalRevision: GitRevisionSchema,
      dirtyFingerprint: ContentHashSchema,
    }),
  }),
);
const PromotionsGetRequestSchema = requestBranch(
  "promotions.get",
  z.strictObject({
    projectId: ProjectIdSchema,
    promotionId: RuntimePromotionIdSchema,
  }),
);

const RuntimeRpcRequestBodySchema = z.discriminatedUnion("method", [
  ProjectsListRequestSchema,
  ProjectsGetRequestSchema,
  ...ImportRuntimeRequestSchemas,
  SessionsRestoreRequestSchema,
  SessionsMigrateLegacyRequestSchema,
  SessionsSaveRequestSchema,
  CanvasDocumentsOpenRequestSchema,
  CanvasDocumentsLoadRequestSchema,
  CanvasDocumentsInitializeRequestSchema,
  CanvasDocumentsAppendRequestSchema,
  CanvasDocumentsCheckpointRequestSchema,
  RunsStartRequestSchema,
  RunsGetRequestSchema,
  RunsCancelRequestSchema,
  RunsResumeRequestSchema,
  RunsRetryRequestSchema,
  RunsHandoffRequestSchema,
  RunsCheckpointRequestSchema,
  RunsEventsRequestSchema,
  ReviewsGetRequestSchema,
  ReviewsResolveRequestSchema,
  WorktreesCreateRequestSchema,
  WorktreesGetRequestSchema,
  PreviewsStartRequestSchema,
  PreviewsGetRequestSchema,
  PromotionsRequestRequestSchema,
  PromotionsGetRequestSchema,
]);

export function runtimeRpcByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function enforcePayloadBound(
  value: unknown,
  context: z.RefinementCtx,
): void {
  if (runtimeRpcByteLength(value) > MAX_RUNTIME_RPC_BYTES) {
    context.addIssue({
      code: "custom",
      message: `Runtime RPC payload exceeds ${MAX_RUNTIME_RPC_BYTES} bytes.`,
    });
  }
}

export const RuntimeRpcRequestSchema =
  RuntimeRpcRequestBodySchema.superRefine(enforcePayloadBound);
export type RuntimeRpcRequest = z.infer<typeof RuntimeRpcRequestSchema>;
export type RuntimeRpcMethod = RuntimeRpcRequest["method"];
export type RuntimeRpcRequestFor<Method extends RuntimeRpcMethod> = Extract<
  RuntimeRpcRequest,
  { method: Method }
>;

const responseBase = {
  schemaVersion: SchemaVersionSchema,
  requestId: ProcessRequestIdSchema,
  correlationId: CorrelationIdSchema,
  receivedAt: IsoTimestampSchema,
};

const publicRunEventBase = {
  sequence: z.number().int().positive().safe(),
  runId: RunIdSchema,
  correlationId: CorrelationIdSchema,
  occurredAt: IsoTimestampSchema,
};
const PublicPlanEventSchema = z.strictObject({
  ...publicRunEventBase,
  kind: z.literal("plan"),
  summary: z.string().trim().min(1).max(4_096),
  steps: z
    .array(
      z.strictObject({
        label: SafeDisplayLabelSchema,
        status: z.enum(["pending", "in-progress", "completed", "blocked"]),
      }),
    )
    .max(64),
});
const PublicProgressEventSchema = z.strictObject({
  ...publicRunEventBase,
  kind: z.literal("progress"),
  message: BoundedMessageSchema,
  percent: z.number().finite().min(0).max(100).nullable(),
});
const PublicToolEventSchema = z.strictObject({
  ...publicRunEventBase,
  kind: z.literal("tool"),
  toolName: BoundedIdentifierSchema,
  status: z.enum(["started", "completed", "failed"]),
  publicSummary: BoundedMessageSchema,
  artifactIds: z.array(ArtifactIdSchema).max(64),
});
const PublicChangeEventSchema = z.strictObject({
  ...publicRunEventBase,
  kind: z.literal("change"),
  targetKind: z.enum(["canvas", "source", "artifact"]),
  targetId: BoundedNodeIdSchema,
  status: z.enum(["proposed", "applied", "rejected"]),
  summary: BoundedMessageSchema,
});
const PublicUsageEventSchema = z.strictObject({
  ...publicRunEventBase,
  kind: z.literal("usage"),
  inputTokens: z.number().int().nonnegative().safe(),
  outputTokens: z.number().int().nonnegative().safe(),
  cacheReadTokens: z.number().int().nonnegative().safe(),
  costUsdMicros: z.number().int().nonnegative().safe(),
});
const PublicApprovalEventSchema = z.strictObject({
  ...publicRunEventBase,
  kind: z.literal("approval"),
  reviewId: RuntimeReviewIdSchema,
  state: z.enum(["requested", "approved", "rejected"]),
  scopes: z.array(BoundedIdentifierSchema).min(1).max(64),
});
const PublicVerificationEventSchema = z.strictObject({
  ...publicRunEventBase,
  kind: z.literal("verification"),
  status: z.enum(["passed", "failed", "partial"]),
  checks: z
    .array(
      z.strictObject({
        label: SafeDisplayLabelSchema,
        status: z.enum(["passed", "failed", "skipped"]),
      }),
    )
    .max(128),
});
const PublicFailureEventSchema = z.strictObject({
  ...publicRunEventBase,
  kind: z.literal("failure"),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
  message: BoundedMessageSchema,
  retryable: z.boolean(),
});
const PublicRecoveryEventSchema = z.strictObject({
  ...publicRunEventBase,
  kind: z.literal("recovery"),
  action: z.enum(["resumed", "retried", "checkpointed", "handed-off"]),
  checkpointId: CheckpointIdSchema.nullable(),
  summary: BoundedMessageSchema,
});
export const RuntimePublicRunEventSchema = z.discriminatedUnion("kind", [
  PublicPlanEventSchema,
  PublicProgressEventSchema,
  PublicToolEventSchema,
  PublicChangeEventSchema,
  PublicUsageEventSchema,
  PublicApprovalEventSchema,
  PublicVerificationEventSchema,
  PublicFailureEventSchema,
  PublicRecoveryEventSchema,
]);
export type RuntimePublicRunEvent = z.infer<
  typeof RuntimePublicRunEventSchema
>;

const RunCheckpointRecordSchema = z.strictObject({
  id: CheckpointIdSchema,
  runId: RunIdSchema,
  binding: SourceDocumentBindingSchema,
  eventSequence: z.number().int().nonnegative().safe(),
  createdAt: IsoTimestampSchema,
});

const RunEventsResultSchema = z
  .strictObject({
    events: z.array(RuntimePublicRunEventSchema).max(200),
    nextAfterSequence: z.number().int().nonnegative().safe().nullable(),
    runRevision: ResourceRevisionSchema,
  })
  .superRefine(({ events, nextAfterSequence }, context) => {
    const firstRunId = events[0]?.runId;
    for (let index = 1; index < events.length; index += 1) {
      if (events[index]!.sequence <= events[index - 1]!.sequence) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "sequence"],
          message: "Run event pages must be strictly sequence-ordered.",
        });
      }
      if (events[index]!.runId !== firstRunId) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "runId"],
          message: "A run event page cannot mix run identities.",
        });
      }
    }
    if (events.length === 0 && nextAfterSequence !== null) {
      context.addIssue({
        code: "custom",
        path: ["nextAfterSequence"],
        message: "An empty event page cannot advance its cursor.",
      });
    }
    if (
      events.length > 0 &&
      nextAfterSequence !== events[events.length - 1]!.sequence
    ) {
      context.addIssue({
        code: "custom",
        path: ["nextAfterSequence"],
        message: "The next cursor must equal the last returned sequence.",
      });
    }
  });

function successBranch<
  const Method extends RuntimeRpcMethod,
  Result extends z.ZodType,
>(method: Method, result: Result) {
  return z.strictObject({
    ...responseBase,
    method: z.literal(method),
    ok: z.literal(true),
    result,
  });
}

const RuntimeRpcSuccessSchema = z.discriminatedUnion("method", [
  successBranch(
    "projects.list",
    z.strictObject({
      projects: z.array(ProjectRecordSchema).max(MAX_COLLECTION_ITEMS),
    }),
  ),
  successBranch(
    "projects.get",
    z.strictObject({ project: ProjectRecordSchema }),
  ),
  ...createImportRuntimeSuccessSchemas(responseBase),
  successBranch(
    "sessions.restore",
    z.strictObject({
      session: WorkspaceSessionSnapshotSchemaV1.nullable(),
    }),
  ),
  successBranch(
    "sessions.migrateLegacy",
    z.strictObject({
      status: z.enum([
        "migrated",
        "already-migrated",
        "session-exists",
      ]),
      session: WorkspaceSessionSnapshotSchemaV1.nullable(),
    }),
  ),
  successBranch(
    "sessions.save",
    z.strictObject({ session: WorkspaceSessionSnapshotSchemaV1 }),
  ),
  successBranch(
    "canvasDocuments.open",
    z.strictObject({
      initialized: z.boolean(),
      journal: CanvasDocumentJournalV3Schema,
    }),
  ),
  successBranch(
    "canvasDocuments.load",
    z.strictObject({ journal: CanvasDocumentJournalV3Schema.nullable() }),
  ),
  successBranch(
    "canvasDocuments.initialize",
    z.strictObject({ journal: CanvasDocumentJournalV3Schema }),
  ),
  successBranch(
    "canvasDocuments.append",
    z.strictObject({ receipt: CanvasDocumentAppendReceiptV3Schema }),
  ),
  successBranch(
    "canvasDocuments.checkpoint",
    z.strictObject({ journal: CanvasDocumentJournalV3Schema }),
  ),
  successBranch("runs.start", z.strictObject({ run: RunRecordSchema })),
  successBranch("runs.get", z.strictObject({ run: RunRecordSchema })),
  successBranch("runs.cancel", z.strictObject({ run: RunRecordSchema })),
  successBranch("runs.resume", z.strictObject({ run: RunRecordSchema })),
  successBranch("runs.retry", z.strictObject({ run: RunRecordSchema })),
  successBranch("runs.handoff", z.strictObject({ run: RunRecordSchema })),
  successBranch(
    "runs.checkpoint",
    z.strictObject({
      run: RunRecordSchema,
      checkpoint: RunCheckpointRecordSchema,
    }),
  ),
  successBranch("runs.events", RunEventsResultSchema),
  successBranch(
    "reviews.get",
    z.strictObject({ review: ReviewRecordSchema }),
  ),
  successBranch(
    "reviews.resolve",
    z.strictObject({ review: ReviewRecordSchema }),
  ),
  successBranch(
    "worktrees.create",
    z.strictObject({ worktree: WorktreeRecordSchema }),
  ),
  successBranch(
    "worktrees.get",
    z.strictObject({ worktree: WorktreeRecordSchema }),
  ),
  successBranch(
    "previews.start",
    z.strictObject({ preview: PreviewRecordSchema }),
  ),
  successBranch(
    "previews.get",
    z.strictObject({ preview: PreviewRecordSchema }),
  ),
  successBranch(
    "promotions.request",
    z.strictObject({ promotion: PromotionRecordSchema }),
  ),
  successBranch(
    "promotions.get",
    z.strictObject({ promotion: PromotionRecordSchema }),
  ),
]);

export const RuntimeRpcErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_REQUEST",
  "NOT_FOUND",
  "CONFLICT",
  "STALE_REVISION",
  "PAYLOAD_TOO_LARGE",
  "CANCELLED",
  "TIMEOUT",
  "UNAVAILABLE",
  "POLICY_DENIED",
  "PROTOCOL_VIOLATION",
  "INTERNAL",
]);
export type RuntimeRpcErrorCode = z.infer<
  typeof RuntimeRpcErrorCodeSchema
>;

const RuntimeRpcErrorSchema = z.strictObject({
  code: RuntimeRpcErrorCodeSchema,
  message: BoundedMessageSchema,
  retryable: z.boolean(),
  details: z
    .array(
      z.strictObject({
        key: BoundedIdentifierSchema,
        value: z.string().max(2_048),
      }),
    )
    .max(64),
});

const RuntimeRpcFailureSchema = z.strictObject({
  ...responseBase,
  method: z.enum(RuntimeRpcRequestBodySchema.options.map(
    (option) => option.shape.method.value,
  ) as [RuntimeRpcMethod, ...RuntimeRpcMethod[]]),
  ok: z.literal(false),
  error: RuntimeRpcErrorSchema,
});

const RuntimeRpcResponseBodySchema = z.union([
  RuntimeRpcSuccessSchema,
  RuntimeRpcFailureSchema,
]);
export const RuntimeRpcResponseSchema =
  RuntimeRpcResponseBodySchema.superRefine(enforcePayloadBound);
export type RuntimeRpcResponse = z.infer<typeof RuntimeRpcResponseSchema>;
export type RuntimeRpcResponseFor<Method extends RuntimeRpcMethod> = Extract<
  RuntimeRpcResponse,
  { method: Method }
>;
export type RuntimeRpcSuccessFor<Method extends RuntimeRpcMethod> = Extract<
  RuntimeRpcResponseFor<Method>,
  { ok: true }
>;

export interface RuntimePrivateTransportInput {
  readonly authorization: string;
  readonly envelope: RuntimeRpcRequest;
  readonly signal?: AbortSignal;
}

export interface RuntimePrivateTransport {
  exchange(input: RuntimePrivateTransportInput): Promise<unknown>;
}
