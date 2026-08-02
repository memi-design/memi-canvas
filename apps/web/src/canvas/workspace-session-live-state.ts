import {
  WORKSPACE_SESSION_MAX_CONFLICTED_OVERLAYS,
  WORKSPACE_SESSION_MAX_SELECTED_IDS,
  WorkspaceSessionDraftSchemaV1,
  type WorkspaceSessionDraftV1,
} from "@memi/protocol";

import type { CanvasWorkspaceSessionState } from "./CanvasWorkbench.types.js";

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function boundedSelection(
  state: CanvasWorkspaceSessionState,
): WorkspaceSessionDraftV1["selection"] {
  const selectedIds = state.selection.selectedIds.slice(
    0,
    WORKSPACE_SESSION_MAX_SELECTED_IDS,
  );
  const selected = new Set(selectedIds);
  const included = (id: string | null) =>
    id !== null && selected.has(id) ? id : null;
  return {
    selectedIds,
    anchorId: included(state.selection.anchorId),
    focusedNodeId: included(state.selection.focusedId),
    editingNodeId: included(state.selection.editingId),
  };
}

function boundedActivity(
  state: CanvasWorkspaceSessionState,
  sourceRevision: string | null,
): WorkspaceSessionDraftV1["activity"] {
  const conflictedOverlayIds =
    state.activity.conflictedOverlayIds.slice(
      0,
      WORKSPACE_SESSION_MAX_CONFLICTED_OVERLAYS,
    );
  const active =
    state.activity.activeRunId !== null ||
    state.activity.activeReviewId !== null ||
    state.activity.activeApprovalId !== null ||
    conflictedOverlayIds.length > 0;
  return {
    activeRunId: state.activity.activeRunId,
    activeReviewId: state.activity.activeReviewId,
    activeApprovalId:
      state.activity.activeRunId === null
        ? null
        : state.activity.activeApprovalId,
    conflictedOverlayIds,
    boundDocumentRevision: active ? state.documentRevision : null,
    boundSourceRevision: active ? sourceRevision : null,
  };
}

export function workspaceSessionFromWorkbenchState(
  session: WorkspaceSessionDraftV1,
  state: CanvasWorkspaceSessionState,
): WorkspaceSessionDraftV1 {
  const selection = boundedSelection(state);
  const activity = boundedActivity(state, session.sourceRevision);
  const documentRevision = Math.max(
    session.documentRevision,
    state.documentRevision,
  );
  const camera = {
    x: state.camera.x,
    y: state.camera.y,
    zoom: state.camera.zoom,
    viewportWidth: Math.max(1, Math.round(state.viewportSize.width)),
    viewportHeight: Math.max(1, Math.round(state.viewportSize.height)),
  };
  const panels = state.panels;

  if (
    session.documentRevision === documentRevision &&
    session.camera.x === camera.x &&
    session.camera.y === camera.y &&
    session.camera.zoom === camera.zoom &&
    session.camera.viewportWidth === camera.viewportWidth &&
    session.camera.viewportHeight === camera.viewportHeight &&
    session.panels.layersWidth === panels.layersWidth &&
    session.panels.inspectorWidth === panels.inspectorWidth &&
    session.panels.workspaceSplitRatio === panels.workspaceSplitRatio &&
    session.panels.layersCollapsed === panels.layersCollapsed &&
    session.panels.inspectorCollapsed === panels.inspectorCollapsed &&
    sameValues(session.selection.selectedIds, selection.selectedIds) &&
    session.selection.anchorId === selection.anchorId &&
    session.selection.focusedNodeId === selection.focusedNodeId &&
    session.selection.editingNodeId === selection.editingNodeId &&
    session.activity.activeRunId === activity.activeRunId &&
    session.activity.activeReviewId === activity.activeReviewId &&
    session.activity.activeApprovalId === activity.activeApprovalId &&
    sameValues(
      session.activity.conflictedOverlayIds,
      activity.conflictedOverlayIds,
    ) &&
    session.activity.boundDocumentRevision ===
      activity.boundDocumentRevision &&
    session.activity.boundSourceRevision === activity.boundSourceRevision
  ) {
    return session;
  }

  return WorkspaceSessionDraftSchemaV1.parse({
    ...session,
    documentRevision,
    selection,
    camera,
    panels,
    activity,
  });
}

interface WorkspaceSessionWriterController {
  readonly getSnapshot: () => {
    readonly session: WorkspaceSessionDraftV1;
    readonly dirty: boolean;
  };
  update(
    updater: (
      current: WorkspaceSessionDraftV1,
    ) => WorkspaceSessionDraftV1,
  ): void;
  persist(): Promise<void>;
}

export class WorkspaceSessionLiveWriter {
  readonly #controller: WorkspaceSessionWriterController;
  readonly #onError: (error: unknown) => void;
  readonly #delay: number;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    controller: WorkspaceSessionWriterController,
    onError: (error: unknown) => void,
    delay = 160,
  ) {
    this.#controller = controller;
    this.#onError = onError;
    this.#delay = delay;
  }

  write(state: CanvasWorkspaceSessionState): void {
    const before = this.#controller.getSnapshot().session;
    this.#controller.update((session) =>
      workspaceSessionFromWorkbenchState(session, state),
    );
    if (this.#controller.getSnapshot().session === before) {
      return;
    }
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#controller.persist().catch(this.#onError);
    }, this.#delay);
  }

  async flush(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (!this.#controller.getSnapshot().dirty) {
      return;
    }
    await this.#controller.persist().catch((error: unknown) => {
      this.#onError(error);
      throw error;
    });
  }
}
