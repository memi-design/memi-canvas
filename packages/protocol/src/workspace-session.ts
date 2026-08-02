import { z } from "zod";

import { GitRevisionSchema } from "./common.js";

export const WORKSPACE_SESSION_MAX_BYTES = 65_536;
export const WORKSPACE_SESSION_MAX_SELECTED_IDS = 100;
export const WORKSPACE_SESSION_MAX_CONFLICTED_OVERLAYS = 32;

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const sourceRevision = GitRevisionSchema.nullable();
const finiteCoordinate = z
  .number()
  .finite()
  .min(-1_000_000_000)
  .max(1_000_000_000);

export const WorkspaceSelectionSchemaV1 = z
  .strictObject({
    selectedIds: z
      .array(identifier)
      .max(WORKSPACE_SESSION_MAX_SELECTED_IDS),
    anchorId: identifier.nullable(),
    focusedNodeId: identifier.nullable(),
    editingNodeId: identifier.nullable(),
  })
  .superRefine((selection, context) => {
    const selected = new Set(selection.selectedIds);
    if (selected.size !== selection.selectedIds.length) {
      context.addIssue({
        code: "custom",
        message: "Workspace selection identities must be unique.",
        path: ["selectedIds"],
      });
    }
    for (const [field, value] of [
      ["anchorId", selection.anchorId],
      ["focusedNodeId", selection.focusedNodeId],
      ["editingNodeId", selection.editingNodeId],
    ] as const) {
      if (value !== null && !selected.has(value)) {
        context.addIssue({
          code: "custom",
          message: `${field} must reference an ordered selected identity.`,
          path: [field],
        });
      }
    }
  });

export const WorkspaceCameraSchemaV1 = z.strictObject({
  x: finiteCoordinate,
  y: finiteCoordinate,
  zoom: z.number().finite().min(0.02).max(8),
  viewportWidth: z.number().int().min(1).max(32_768),
  viewportHeight: z.number().int().min(1).max(32_768),
});

export const WorkspacePanelsSchemaV1 = z.strictObject({
  layersWidth: z.number().int().min(180).max(360),
  inspectorWidth: z.number().int().min(240).max(640),
  workspaceSplitRatio: z.number().finite().min(0.25).max(0.8),
  layersCollapsed: z.boolean(),
  inspectorCollapsed: z.boolean(),
});

export const WorkspaceActivitySchemaV1 = z
  .strictObject({
    activeRunId: identifier.nullable(),
    activeReviewId: identifier.nullable(),
    activeApprovalId: identifier.nullable(),
    conflictedOverlayIds: z
      .array(identifier)
      .max(WORKSPACE_SESSION_MAX_CONFLICTED_OVERLAYS),
    boundDocumentRevision: z.number().int().nonnegative().nullable(),
    boundSourceRevision: sourceRevision,
  })
  .superRefine((activity, context) => {
    const hasRecoveryState =
      activity.activeRunId !== null ||
      activity.activeReviewId !== null ||
      activity.activeApprovalId !== null ||
      activity.conflictedOverlayIds.length > 0;
    if (hasRecoveryState !== (activity.boundDocumentRevision !== null)) {
      context.addIssue({
        code: "custom",
        message:
          "Active workspace recovery identifiers require one document revision binding.",
        path: ["boundDocumentRevision"],
      });
    }
    if (
      new Set(activity.conflictedOverlayIds).size !==
      activity.conflictedOverlayIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Conflicted overlay identities must be unique.",
        path: ["conflictedOverlayIds"],
      });
    }
    if (
      activity.activeApprovalId !== null &&
      activity.activeRunId === null
    ) {
      context.addIssue({
        code: "custom",
        message: "An active approval must remain bound to its active run.",
        path: ["activeApprovalId"],
      });
    }
  });

const WorkspaceSessionCoreSchemaV1 = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("memi-workspace-session"),
    projectId: identifier,
    documentId: identifier,
    documentRevision: z.number().int().nonnegative(),
    sourceRevision,
    selection: WorkspaceSelectionSchemaV1,
    camera: WorkspaceCameraSchemaV1,
    panels: WorkspacePanelsSchemaV1,
    activity: WorkspaceActivitySchemaV1,
  })
  .superRefine((session, context) => {
    if (
      session.activity.boundDocumentRevision !== null &&
      session.activity.boundDocumentRevision > session.documentRevision
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Workspace recovery state cannot bind to a future document revision.",
        path: ["activity", "boundDocumentRevision"],
      });
    }
    if (
      session.activity.boundDocumentRevision !== null &&
      session.sourceRevision !== null &&
      session.activity.boundSourceRevision === null
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Source-backed workspace recovery state must retain its source revision binding.",
        path: ["activity", "boundSourceRevision"],
      });
    }
    if (
      session.activity.boundDocumentRevision === null &&
      session.activity.boundSourceRevision !== null
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Inactive workspace recovery state cannot retain a source revision binding.",
        path: ["activity", "boundSourceRevision"],
      });
    }
  });

export const WorkspaceSessionDraftSchemaV1 =
  WorkspaceSessionCoreSchemaV1;

export const WorkspaceSessionSnapshotSchemaV1 =
  WorkspaceSessionCoreSchemaV1.safeExtend({
    sessionRevision: z.number().int().positive(),
    updatedAt: z.iso.datetime(),
  });

export type WorkspaceSessionDraftV1 = z.infer<
  typeof WorkspaceSessionDraftSchemaV1
>;
export type WorkspaceSessionSnapshotV1 = z.infer<
  typeof WorkspaceSessionSnapshotSchemaV1
>;

export interface SaveWorkspaceSessionRequestV1 {
  readonly expectedSessionRevision: number | null;
  readonly session: WorkspaceSessionDraftV1;
}

export interface MigrateLegacyWorkspaceSessionRequestV1 {
  readonly migrationKey: string;
  readonly legacyRecordHash: `fnv1a64:${string}`;
  readonly session: WorkspaceSessionDraftV1;
}

export interface MigrateLegacyWorkspaceSessionResultV1 {
  readonly status:
    | "migrated"
    | "already-migrated"
    | "session-exists";
  readonly session: WorkspaceSessionSnapshotV1 | null;
}

export interface WorkspaceSessionRuntimePortV1 {
  load(
    projectId: string,
    documentId: string,
  ): Promise<WorkspaceSessionSnapshotV1 | null>;
  save(
    request: SaveWorkspaceSessionRequestV1,
  ): Promise<WorkspaceSessionSnapshotV1>;
  migrateLegacy(
    request: MigrateLegacyWorkspaceSessionRequestV1,
  ): Promise<MigrateLegacyWorkspaceSessionResultV1>;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function createWorkspaceSessionDraft(input: {
  readonly projectId: string;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly sourceRevision: string | null;
}): WorkspaceSessionDraftV1 {
  return deepFreeze(
    WorkspaceSessionDraftSchemaV1.parse({
      schemaVersion: 1,
      kind: "memi-workspace-session",
      projectId: input.projectId,
      documentId: input.documentId,
      documentRevision: input.documentRevision,
      sourceRevision: input.sourceRevision,
      selection: {
        selectedIds: [],
        anchorId: null,
        focusedNodeId: null,
        editingNodeId: null,
      },
      camera: {
        x: 0,
        y: 0,
        zoom: 1,
        viewportWidth: 1,
        viewportHeight: 1,
      },
      panels: {
        layersWidth: 240,
        inspectorWidth: 320,
        workspaceSplitRatio: 0.5,
        layersCollapsed: false,
        inspectorCollapsed: false,
      },
      activity: {
        activeRunId: null,
        activeReviewId: null,
        activeApprovalId: null,
        conflictedOverlayIds: [],
        boundDocumentRevision: null,
        boundSourceRevision: null,
      },
    }),
  );
}
