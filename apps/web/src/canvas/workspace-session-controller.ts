import {
  WorkspaceSessionDraftSchemaV1,
  WorkspaceSessionSnapshotSchemaV1,
  ProjectIdSchema,
  type MigrateLegacyWorkspaceSessionRequestV1,
  type MigrateLegacyWorkspaceSessionResultV1,
  type CanvasDocumentV3,
  type ProjectId,
  type WorkspaceSessionDraftV1,
  type WorkspaceSessionRuntimePortV1,
  type WorkspaceSessionSnapshotV1,
} from "@memi/protocol";
import { hashCanvasDocumentV3 } from "@memi/canvas-document";

export type WorkspaceRuntimeProjectId = ProjectId;

import type { RuntimeClientV1 } from "../runtime/runtime-client.js";
import type {
  CanvasWorkbenchProject,
  SceneState,
  SelectionState,
} from "./model.js";

export interface WorkspaceSessionControllerSnapshot {
  readonly session: WorkspaceSessionDraftV1;
  readonly persistedRevision: number | null;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly error: string | null;
}

type WorkspaceSessionListener = () => void;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function immutableDraft(value: unknown): WorkspaceSessionDraftV1 {
  return deepFreeze(
    structuredClone(WorkspaceSessionDraftSchemaV1.parse(value)),
  );
}

function draftFromSnapshot(
  snapshot: WorkspaceSessionSnapshotV1,
): WorkspaceSessionDraftV1 {
  return immutableDraft({
    schemaVersion: snapshot.schemaVersion,
    kind: snapshot.kind,
    projectId: snapshot.projectId,
    documentId: snapshot.documentId,
    documentRevision: snapshot.documentRevision,
    sourceRevision: snapshot.sourceRevision,
    selection: snapshot.selection,
    camera: snapshot.camera,
    panels: snapshot.panels,
    activity: snapshot.activity,
  });
}

function boundedError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Workspace session failed.";
  return message.slice(0, 512);
}

function projectSourceRevision(
  project: CanvasWorkbenchProject,
): string | null {
  const revisions = new Set(
    project.document.nodes.flatMap((node) => {
      const values = [
        node.source?.repositoryRevision,
        node.component?.source.repositoryRevision,
      ];
      return values.filter(
        (value): value is string =>
          value !== undefined && /^[a-f0-9]{40}$/u.test(value),
      );
    }),
  );
  return revisions.size === 1 ? [...revisions][0] ?? null : null;
}

export function createCanvasWorkspaceSessionDraft(
  project: CanvasWorkbenchProject,
  runtimeProjectId: string = project.id,
): WorkspaceSessionDraftV1 {
  const draft = immutableDraft({
    ...WorkspaceSessionDraftSchemaV1.parse({
      schemaVersion: 1,
      kind: "memi-workspace-session",
      projectId: runtimeProjectId,
      documentId: project.document.id,
      documentRevision: project.document.revision,
      sourceRevision: projectSourceRevision(project),
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
  });
  const selectedNodeId = project.selectedNodeId;
  if (
    selectedNodeId === null ||
    !project.document.nodes.some(({ id }) => id === selectedNodeId)
  ) {
    return draft;
  }
  return immutableDraft({
    ...draft,
    selection: {
      selectedIds: [selectedNodeId],
      anchorId: selectedNodeId,
      focusedNodeId: selectedNodeId,
      editingNodeId: null,
    },
  });
}

/** @deprecated Migration-only bridge for legacy SceneState autosaves. */
export function workspaceSessionFromScene(
  session: WorkspaceSessionDraftV1,
  scene: SceneState,
): WorkspaceSessionDraftV1 {
  const selectedNodeId =
    scene.selectedNodeId !== null &&
    scene.nodes.some(({ id }) => id === scene.selectedNodeId)
      ? scene.selectedNodeId
      : null;
  if (
    session.documentRevision === scene.revision &&
    session.selection.selectedIds.length ===
      (selectedNodeId === null ? 0 : 1) &&
    session.selection.anchorId === selectedNodeId &&
    session.selection.focusedNodeId === selectedNodeId &&
    session.selection.editingNodeId === null
  ) {
    return session;
  }
  return immutableDraft({
    ...session,
    documentRevision: Math.max(
      session.documentRevision,
      scene.revision,
    ),
    selection: {
      selectedIds:
        selectedNodeId === null ? [] : [selectedNodeId],
      anchorId: selectedNodeId,
      focusedNodeId: selectedNodeId,
      editingNodeId: null,
    },
  });
}

function v3SourceRevision(
  document: CanvasDocumentV3,
  fallback: string | null,
): string | null {
  const revisions = new Set(
    Object.values(document.evidenceById)
      .map(({ sourceRevision }) => sourceRevision)
      .filter((value) => /^[a-f0-9]{40}$/u.test(value)),
  );
  return revisions.size === 1 ? [...revisions][0] ?? fallback : fallback;
}

/**
 * Projects the small restorable workspace session from the canonical V3
 * document. Node arrays never enter this boundary.
 */
export function workspaceSessionFromCanvasDocumentV3(
  session: WorkspaceSessionDraftV1,
  document: CanvasDocumentV3,
  selection: SelectionState,
): WorkspaceSessionDraftV1 {
  if (hashCanvasDocumentV3(document) !== document.stateHash) {
    throw new Error("Workspace CanvasDocumentV3 state hash is corrupt.");
  }
  if (
    session.projectId !== document.projectId ||
    session.documentId !== document.id
  ) {
    throw new Error("Workspace CanvasDocumentV3 identity does not match.");
  }
  if (document.revision < session.documentRevision) {
    throw new Error("Workspace CanvasDocumentV3 revision cannot regress.");
  }
  const selectedIds = [...selection.selectedIds];
  const uniqueIds = new Set(selectedIds);
  if (
    uniqueIds.size !== selectedIds.length ||
    selectedIds.some((id) => document.nodesById[id] === undefined)
  ) {
    throw new Error("Workspace selection references a missing V3 node.");
  }
  for (const id of [
    selection.anchorId,
    selection.focusedId,
    selection.editingId,
  ]) {
    if (id !== null && !uniqueIds.has(id)) {
      throw new Error("Workspace focused V3 identities must be selected.");
    }
  }
  const sourceRevision = v3SourceRevision(document, session.sourceRevision);
  const next = {
    ...session,
    documentRevision: document.revision,
    sourceRevision,
    selection: {
      selectedIds,
      anchorId: selection.anchorId,
      focusedNodeId: selection.focusedId,
      editingNodeId: selection.editingId,
    },
  };
  return JSON.stringify(next) === JSON.stringify(session)
    ? session
    : immutableDraft(next);
}

export function createRuntimeClientWorkspaceSessionPort(
  runtimeClient: Pick<RuntimeClientV1, "sessions">,
): WorkspaceSessionRuntimePortV1 {
  const load = async (
    projectId: string,
    documentId: string,
  ): Promise<WorkspaceSessionSnapshotV1 | null> => {
    const result = await runtimeClient.sessions.restore({
      projectId: ProjectIdSchema.parse(projectId),
      documentId,
    });
    return result.session === null
      ? null
      : WorkspaceSessionSnapshotSchemaV1.parse(result.session);
  };

  const save: WorkspaceSessionRuntimePortV1["save"] = async ({
    expectedSessionRevision,
    session,
  }) => {
    const validated = WorkspaceSessionDraftSchemaV1.parse(session);
    const result = await runtimeClient.sessions.save({
      expected: {
        documentRevision: validated.documentRevision,
        sourceRevision: validated.sourceRevision,
        sessionRevision: expectedSessionRevision,
      },
      projectId: ProjectIdSchema.parse(validated.projectId),
      documentId: validated.documentId,
      session: validated,
    });
    return WorkspaceSessionSnapshotSchemaV1.parse(result.session);
  };

  const migrateLegacy = async (
    request: MigrateLegacyWorkspaceSessionRequestV1,
  ): Promise<MigrateLegacyWorkspaceSessionResultV1> => {
    const validated = WorkspaceSessionDraftSchemaV1.parse(request.session);
    const result = await runtimeClient.sessions.migrateLegacy({
      migrationKey: request.migrationKey,
      legacyRecordHash: request.legacyRecordHash,
      projectId: ProjectIdSchema.parse(validated.projectId),
      documentId: validated.documentId,
      session: validated,
    });
    return {
      status: result.status,
      session:
        result.session === null
          ? null
          : WorkspaceSessionSnapshotSchemaV1.parse(result.session),
    };
  };

  return Object.freeze({ load, save, migrateLegacy });
}

export class WorkspaceSessionController {
  readonly #runtime: WorkspaceSessionRuntimePortV1;
  readonly #listeners = new Set<WorkspaceSessionListener>();
  #changeEpoch = 0;
  #activePersist: Promise<void> | null = null;
  #snapshot: WorkspaceSessionControllerSnapshot;

  constructor(
    initial: WorkspaceSessionDraftV1,
    runtime: WorkspaceSessionRuntimePortV1,
  ) {
    this.#runtime = runtime;
    this.#snapshot = deepFreeze({
      session: immutableDraft(initial),
      persistedRevision: null,
      dirty: false,
      saving: false,
      error: null,
    });
  }

  getSnapshot = (): WorkspaceSessionControllerSnapshot => this.#snapshot;

  subscribe = (listener: WorkspaceSessionListener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  update(
    updater: (
      current: WorkspaceSessionDraftV1,
    ) => WorkspaceSessionDraftV1,
  ): void {
    const current = this.#snapshot.session;
    const candidate = updater(current);
    if (candidate === current) {
      return;
    }
    const next = immutableDraft(candidate);
    if (
      next.projectId !== current.projectId ||
      next.documentId !== current.documentId
    ) {
      throw new Error("Workspace session identity cannot change.");
    }
    if (next.documentRevision < current.documentRevision) {
      throw new Error("Workspace document revision cannot regress.");
    }
    this.#changeEpoch += 1;
    this.#publish({
      ...this.#snapshot,
      session: next,
      dirty: true,
      error: null,
    });
  }

  bindCanvasDocumentV3(
    document: CanvasDocumentV3,
    selection: SelectionState,
  ): void {
    this.update((session) =>
      workspaceSessionFromCanvasDocumentV3(session, document, selection),
    );
  }

  async restore(): Promise<void> {
    const current = this.#snapshot.session;
    const restored = await this.#runtime.load(
      current.projectId,
      current.documentId,
    );
    if (restored === null) {
      return;
    }
    const validated = WorkspaceSessionSnapshotSchemaV1.parse(restored);
    if (
      validated.projectId !== current.projectId ||
      validated.documentId !== current.documentId
    ) {
      throw new Error("Workspace session restore identity does not match.");
    }
    if (validated.sourceRevision !== current.sourceRevision) {
      throw new Error(
        "Workspace session restore source revision does not match.",
      );
    }
    if (validated.documentRevision < current.documentRevision) {
      throw new Error(
        "Workspace session restore would regress the document revision.",
      );
    }
    this.#changeEpoch += 1;
    this.#publish({
      session: draftFromSnapshot(validated),
      persistedRevision: validated.sessionRevision,
      dirty: false,
      saving: false,
      error: null,
    });
  }

  persist(): Promise<void> {
    if (this.#activePersist !== null) {
      return this.#activePersist.then(() => this.persist());
    }
    const operation = this.#persistCurrent();
    this.#activePersist = operation;
    const clear = () => {
      if (this.#activePersist === operation) {
        this.#activePersist = null;
      }
    };
    void operation.then(clear, clear);
    return operation;
  }

  async #persistCurrent(): Promise<void> {
    const session = this.#snapshot.session;
    const expectedSessionRevision = this.#snapshot.persistedRevision;
    const capturedEpoch = this.#changeEpoch;
    this.#publish({ ...this.#snapshot, saving: true, error: null });
    try {
      const saved = WorkspaceSessionSnapshotSchemaV1.parse(
        await this.#runtime.save({
          expectedSessionRevision,
          session,
        }),
      );
      const savedDraft = draftFromSnapshot(saved);
      if (
        saved.projectId !== session.projectId ||
        saved.documentId !== session.documentId ||
        saved.documentRevision !== session.documentRevision ||
        saved.sessionRevision !==
          (expectedSessionRevision === null
            ? 1
            : expectedSessionRevision + 1) ||
        JSON.stringify(savedDraft) !== JSON.stringify(session)
      ) {
        throw new Error(
          "Workspace runtime returned a mismatched session receipt.",
        );
      }
      const changedDuringSave = this.#changeEpoch !== capturedEpoch;
      this.#publish({
        ...this.#snapshot,
        session: changedDuringSave
          ? this.#snapshot.session
          : savedDraft,
        persistedRevision: saved.sessionRevision,
        dirty: changedDuringSave,
        saving: false,
        error: null,
      });
    } catch (error) {
      this.#publish({
        ...this.#snapshot,
        dirty: true,
        saving: false,
        error: boundedError(error),
      });
      throw error;
    }
  }

  #publish(snapshot: WorkspaceSessionControllerSnapshot): void {
    this.#snapshot = deepFreeze({ ...snapshot });
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
