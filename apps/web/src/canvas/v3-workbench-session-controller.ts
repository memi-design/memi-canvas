import {
  WorkspaceSessionDraftSchemaV1,
  type CanvasDocumentV3,
  type CanvasDocumentV3PersistencePort,
  type CanvasPageId,
  type WorkspaceSessionDraftV1,
} from "@memi/protocol";
import type { CanvasDocumentV3PersistencePolicy } from "@memi/canvas-document";

import {
  CanonicalWorkbenchAuthorityV3,
  migrateLegacyWorkbenchProjectionToV3,
  type LegacyWorkbenchV3MigrationOptions,
} from "./canonical-workbench-authority-v3.js";
import type { LegacyWorkbenchProjection } from "./legacy-workbench-projection.js";
import type { SelectionState, WorkbenchNode } from "./model.js";
import { projectCanvasDocumentV3ToWorkbench } from "./canvas-v3-workbench-projection.js";
import { workspaceSessionFromCanvasDocumentV3 } from "./workspace-session-controller.js";

type SessionListener = () => void;

export type V3WorkbenchSessionSource =
  | {
      readonly kind: "seed";
      readonly document: CanvasDocumentV3;
      readonly selection?: SelectionState;
    }
  | {
      readonly kind: "legacy-workbench";
      readonly migration: LegacyWorkbenchV3MigrationOptions;
      readonly projection: LegacyWorkbenchProjection;
    };

export interface OpenV3WorkbenchSessionController {
  readonly persistence: CanvasDocumentV3PersistencePort;
  readonly persistencePolicy?: CanvasDocumentV3PersistencePolicy;
  readonly source: V3WorkbenchSessionSource;
  /**
   * Restorable camera, panel, and selection state. This controller only
   * derives its document-bound fields; it never receives or writes SceneState.
   */
  readonly workspace: WorkspaceSessionDraftV1;
}

export interface V3WorkbenchSessionLoadingSnapshot {
  readonly authority: null;
  readonly error: null;
  readonly status: "loading";
  readonly workspace: WorkspaceSessionDraftV1;
}

export interface V3WorkbenchSessionReadySnapshot {
  readonly authority: CanonicalWorkbenchAuthorityV3;
  readonly error: null;
  readonly status: "ready";
  readonly workspace: WorkspaceSessionDraftV1;
}

export interface V3WorkbenchSessionErrorSnapshot {
  readonly authority: null;
  readonly error: string;
  readonly status: "error";
  readonly workspace: WorkspaceSessionDraftV1;
}

export type V3WorkbenchSessionSnapshot =
  | V3WorkbenchSessionLoadingSnapshot
  | V3WorkbenchSessionReadySnapshot
  | V3WorkbenchSessionErrorSnapshot;

/**
 * Read-only V3 document projection for the legacy renderer.
 *
 * This is deliberately not a mutation boundary: renderer changes must travel
 * through V3 semantic intents and the authority's durable journal.
 */
export interface V3WorkbenchRendererSnapshot {
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly nodes: readonly WorkbenchNode[];
  readonly revision: number;
  readonly selection: SelectionState;
}

interface ResolvedV3WorkbenchSource {
  readonly document: CanvasDocumentV3;
  readonly selection: SelectionState;
  readonly workspace: WorkspaceSessionDraftV1;
}

function boundedError(error: unknown): string {
  return (
    error instanceof Error ? error.message : "Canvas V3 workspace failed."
  ).slice(0, 512);
}

function freezeSnapshot<T extends V3WorkbenchSessionSnapshot>(
  snapshot: T,
): T {
  return Object.freeze(snapshot);
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

function immutableWorkspace(
  workspace: WorkspaceSessionDraftV1,
): WorkspaceSessionDraftV1 {
  return deepFreeze(
    structuredClone(WorkspaceSessionDraftSchemaV1.parse(workspace)),
  );
}

function selectionFromWorkspace(
  workspace: WorkspaceSessionDraftV1,
): SelectionState {
  return Object.freeze({
    anchorId: workspace.selection.anchorId,
    editingId: workspace.selection.editingNodeId,
    focusedId: workspace.selection.focusedNodeId,
    selectedIds: Object.freeze([...workspace.selection.selectedIds]),
  });
}

function resolveSource(
  source: V3WorkbenchSessionSource,
  workspace: WorkspaceSessionDraftV1,
): ResolvedV3WorkbenchSource {
  if (source.kind === "seed") {
    return Object.freeze({
      document: source.document,
      selection: source.selection ?? selectionFromWorkspace(workspace),
      workspace,
    });
  }
  const migration = migrateLegacyWorkbenchProjectionToV3(
    source.projection,
    source.migration,
  );
  return Object.freeze({
    document: migration.document,
    selection: migration.selection,
    workspace: legacyWorkspaceForMigration(
      workspace,
      migration.document,
      migration.selection,
    ),
  });
}

function legacyWorkspaceForMigration(
  workspace: WorkspaceSessionDraftV1,
  document: CanvasDocumentV3,
  selection: SelectionState,
): WorkspaceSessionDraftV1 {
  const hasActiveRecovery = workspace.activity.boundDocumentRevision !== null;
  return immutableWorkspace({
    ...workspace,
    projectId: document.projectId,
    documentId: document.id,
    documentRevision: document.revision,
    selection: {
      selectedIds: [...selection.selectedIds],
      anchorId: selection.anchorId,
      focusedNodeId: selection.focusedId,
      editingNodeId: selection.editingId,
    },
    activity: hasActiveRecovery
      ? {
          ...workspace.activity,
          boundDocumentRevision: document.revision,
        }
      : workspace.activity,
  });
}

/**
 * Async lifecycle seam for the production V3 workbench.
 *
 * React consumers can bind `subscribe` and `getSnapshot` directly to
 * `useSyncExternalStore`. The authority remains the only document mutation
 * path; this controller solely projects its durable document and selection
 * into the small workspace-session record.
 */
export class V3WorkbenchSessionController {
  readonly #input: OpenV3WorkbenchSessionController;
  readonly #listeners = new Set<SessionListener>();
  #authority: CanonicalWorkbenchAuthorityV3 | null = null;
  #authorityUnsubscribe: (() => void) | null = null;
  #disposed = false;
  #opening: Promise<CanonicalWorkbenchAuthorityV3> | null = null;
  #snapshot: V3WorkbenchSessionSnapshot;
  #workspace: WorkspaceSessionDraftV1;

  constructor(input: OpenV3WorkbenchSessionController) {
    this.#input = Object.freeze({
      ...input,
      workspace: immutableWorkspace(input.workspace),
    });
    this.#workspace = this.#input.workspace;
    this.#snapshot = freezeSnapshot({
      authority: null,
      error: null,
      status: "loading",
      workspace: this.#workspace,
    });
  }

  getSnapshot = (): V3WorkbenchSessionSnapshot => this.#snapshot;

  getRendererSnapshot(
    pageId: CanvasPageId,
  ): V3WorkbenchRendererSnapshot {
    const authority = this.#authority;
    if (authority === null) {
      throw new Error("Canvas V3 renderer projection requires a ready session.");
    }
    const snapshot = authority.getSnapshot();
    return deepFreeze({
      canRedo: snapshot.canRedo,
      canUndo: snapshot.canUndo,
      nodes: [...projectCanvasDocumentV3ToWorkbench(snapshot.document, pageId)],
      revision: snapshot.document.revision,
      selection: {
        anchorId: snapshot.selection.anchorId,
        editingId: snapshot.selection.editingId,
        focusedId: snapshot.selection.focusedId,
        selectedIds: [...snapshot.selection.selectedIds],
      },
    });
  }

  subscribe = (listener: SessionListener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  open(): Promise<CanonicalWorkbenchAuthorityV3> {
    if (this.#disposed) {
      return Promise.reject(new Error("Canvas V3 workspace controller is disposed."));
    }
    if (this.#authority !== null) {
      return Promise.resolve(this.#authority);
    }
    if (this.#opening !== null) {
      return this.#opening;
    }
    this.#publish(
      freezeSnapshot({
        authority: null,
        error: null,
        status: "loading",
        workspace: this.#workspace,
      }),
    );
    const opening = this.#openAuthority();
    this.#opening = opening;
    void opening.then(
      () => {
        if (this.#opening === opening) this.#opening = null;
      },
      () => {
        if (this.#opening === opening) this.#opening = null;
      },
    );
    return opening;
  }

  dispose(): void {
    this.#disposed = true;
    this.#authorityUnsubscribe?.();
    this.#authorityUnsubscribe = null;
    this.#listeners.clear();
  }

  async #openAuthority(): Promise<CanonicalWorkbenchAuthorityV3> {
    try {
      const resolved = resolveSource(this.#input.source, this.#workspace);
      const authority = await CanonicalWorkbenchAuthorityV3.open({
        document: resolved.document,
        persistence: this.#input.persistence,
        selection: resolved.selection,
        ...(resolved.workspace.history === undefined
          ? {}
          : { history: resolved.workspace.history }),
        ...(this.#input.persistencePolicy === undefined
          ? {}
          : { persistencePolicy: this.#input.persistencePolicy }),
      });
      if (this.#disposed) {
        throw new Error("Canvas V3 workspace controller is disposed.");
      }
      this.#workspace = resolved.workspace;
      const readySnapshot = this.#readySnapshot(authority);
      this.#authority = authority;
      this.#authorityUnsubscribe = authority.subscribe(() => {
        this.#publishAuthority(authority);
      });
      this.#publish(readySnapshot);
      return authority;
    } catch (error) {
      if (!this.#disposed) {
        this.#publish(
          freezeSnapshot({
            authority: null,
            error: boundedError(error),
            status: "error",
            workspace: this.#workspace,
          }),
        );
      }
      throw error;
    }
  }

  #publishAuthority(authority: CanonicalWorkbenchAuthorityV3): void {
    try {
      this.#publish(this.#readySnapshot(authority));
    } catch (error) {
      this.#authorityUnsubscribe?.();
      this.#authorityUnsubscribe = null;
      this.#authority = null;
      this.#publish(
        freezeSnapshot({
          authority: null,
          error: boundedError(error),
          status: "error",
          workspace: this.#workspace,
        }),
      );
    }
  }

  #readySnapshot(
    authority: CanonicalWorkbenchAuthorityV3,
  ): V3WorkbenchSessionReadySnapshot {
    const authoritySnapshot = authority.getSnapshot();
    this.#workspace = workspaceSessionFromCanvasDocumentV3(
      this.#workspace,
      authoritySnapshot.document,
      authoritySnapshot.selection,
      authority.getHistoryState(),
    );
    return freezeSnapshot({
      authority,
      error: null,
      status: "ready",
      workspace: this.#workspace,
    });
  }

  #publish(snapshot: V3WorkbenchSessionSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
