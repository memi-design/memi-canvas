import { describe, expect, it, vi } from "vitest";

import {
  CanvasDocumentAppendReceiptV3Schema,
  WorkspaceSessionDraftSchemaV1,
  createWorkspaceSessionDraft,
  type CanvasDocumentIdentityV3,
  type CanvasDocumentJournalV3,
  type CanvasDocumentV3PersistencePort,
} from "@memi/protocol";
import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";

import { createLegacyWorkbenchProjection } from "./legacy-workbench-projection.js";
import { workspaceSessionFromWorkbenchState } from "./workspace-session-live-state.js";
import {
  V3WorkbenchSessionController,
} from "./v3-workbench-session-controller.js";

const operationId = "opn_01J00000000000000000000000";

function memoryPort(options: {
  readonly failLoad?: boolean;
} = {}): CanvasDocumentV3PersistencePort {
  let journal: CanvasDocumentJournalV3 | null = null;
  return {
    load: vi.fn(async (_identity: CanvasDocumentIdentityV3) => {
      if (options.failLoad) {
        throw new Error("durable storage is unavailable");
      }
      return journal;
    }),
    initialize: vi.fn(async (snapshot) => {
      journal = {
        schemaVersion: 1,
        kind: "canvas-document-v3-journal",
        identity: snapshot.identity,
        snapshot,
        operations: [],
        operationBytes: 0,
      };
    }),
    append: vi.fn(async (request) => {
      if (journal === null) {
        throw new Error("journal not initialized");
      }
      journal = {
        ...journal,
        operations: [...journal.operations, request.operation],
        operationBytes:
          journal.operationBytes +
          new TextEncoder().encode(JSON.stringify(request.operation)).byteLength,
      };
      return CanvasDocumentAppendReceiptV3Schema.parse({
        schemaVersion: 1,
        identity: request.identity,
        operationId: request.operation.id,
        revision: request.operation.expectedRevision + 1,
        stateHash: request.operation.resultingHash,
      });
    }),
    checkpoint: vi.fn(async () => undefined),
  };
}

function seed() {
  return createCanvasDocumentV3({
    id: "doc_01J00000000000000000000000",
    projectId: "prj_01J00000000000000000000000",
    initialPage: {
      id: "pag_01J00000000000000000000000",
      kind: "design",
      name: "Page 1",
    },
  });
}

function workspace(document = seed()) {
  const initial = createWorkspaceSessionDraft({
    projectId: document.projectId,
    documentId: document.id,
    documentRevision: document.revision,
    sourceRevision: null,
  });
  return WorkspaceSessionDraftSchemaV1.parse({
    ...initial,
    camera: {
      x: 48,
      y: -32,
      zoom: 1.25,
      viewportWidth: 1440,
      viewportHeight: 900,
    },
    panels: {
      layersWidth: 288,
      inspectorWidth: 336,
      workspaceSplitRatio: 0.6,
      layersCollapsed: false,
      inspectorCollapsed: false,
    },
  });
}

function documentWithSecondPage() {
  const document = seed();
  const secondPageId = "pag_01J00000000000000000000001";
  return {
    document: applyCanvasOperationV3(
      document,
      prepareCanvasOperationV3(document, {
        id: "opn_01J00000000000000000000003",
        actor: "human",
        actorId: "local-user",
        occurredAt: "2026-08-01T17:59:00.000Z",
        label: "Create second page",
        action: {
          type: "page.define",
          payload: {
            pageId: secondPageId,
            next: {
              id: secondPageId,
              kind: "design",
              name: "Page 2",
              rootIds: [],
            },
          },
        },
      }),
    ),
    secondPageId,
  } as const;
}

describe("V3WorkbenchSessionController", () => {
  it("publishes loading then a ready V3 authority without introducing SceneState", async () => {
    const document = seed();
    const controller = new V3WorkbenchSessionController({
      persistence: memoryPort(),
      source: { kind: "seed", document },
      workspace: workspace(document),
    });
    const observed = [controller.getSnapshot().status];
    const unsubscribe = controller.subscribe(() => {
      observed.push(controller.getSnapshot().status);
    });

    expect(controller.getSnapshot()).toMatchObject({
      authority: null,
      error: null,
      status: "loading",
      workspace: {
        camera: { x: 48, zoom: 1.25 },
        panels: { layersWidth: 288 },
      },
    });
    expect(Object.isFrozen(controller.getSnapshot())).toBe(true);
    expect(Object.isFrozen(controller.getSnapshot().workspace.camera)).toBe(true);

    const authority = await controller.open();

    expect(authority).toBe(controller.getSnapshot().authority);
    expect(controller.getSnapshot()).toMatchObject({
      error: null,
      status: "ready",
      workspace: {
        documentRevision: 0,
        selection: { selectedIds: [] },
      },
    });
    expect(observed).toContain("ready");
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("SceneState");
    unsubscribe();
  });

  it("migrates legacy input once and preserves the resulting selection in workspace state", async () => {
    const projection = createLegacyWorkbenchProjection({
      nodes: [
        {
          hidden: false,
          id: "legacy-card",
          kind: "Rectangle",
          locked: false,
          name: "Card",
          parentId: null,
          position: { x: 24, y: 32 },
          size: { width: 320, height: 180 },
        },
      ],
      revision: 7,
      selectedNodeId: "legacy-card",
    });
    const migration = {
      legacyDocumentId: "legacy-design",
      legacyProjectId: "legacy-project",
    } as const;
    const legacyWorkspaceDocument = seed();
    const controller = new V3WorkbenchSessionController({
      persistence: memoryPort(),
      source: {
        kind: "legacy-workbench",
        migration,
        projection,
      },
      workspace: workspace(legacyWorkspaceDocument),
    });

    await controller.open();

    const snapshot = controller.getSnapshot();
    const selectedId = snapshot.workspace.selection.selectedIds[0];
    expect(snapshot).toMatchObject({
      status: "ready",
      workspace: {
        documentRevision: 7,
        selection: {
          anchorId: selectedId,
          focusedNodeId: selectedId,
          selectedIds: [selectedId],
        },
      },
    });
    expect(snapshot.authority?.getSnapshot().document.nodesById[selectedId!]).toMatchObject({
      name: "Card",
    });
  });

  it("restores durable document and selection state through a fresh controller", async () => {
    const document = seed();
    const persistence = memoryPort();
    const first = new V3WorkbenchSessionController({
      persistence,
      source: { kind: "seed", document },
      workspace: workspace(document),
    });
    const authority = await first.open();
    const nodeId = "nod_01J00000000000000000000000";
    await authority.commit(
      {
        id: operationId,
        actor: "human",
        actorId: "local-user",
        occurredAt: "2026-08-01T18:00:00.000Z",
        label: "Create rectangle",
        action: {
          type: "node.create",
          payload: {
            parentId: null,
            index: 0,
            node: {
              id: nodeId,
              pageId: document.pageIds[0]!,
              kind: "rectangle",
              name: "Rectangle",
              parentId: null,
              childIds: [],
              transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
              geometry: { width: 100, height: 100 },
              style: {
                opacity: 1,
                visible: true,
                locked: false,
                fills: [],
                strokes: [],
                cornerRadii: [0, 0, 0, 0],
              },
              layout: {
                mode: "none",
                gap: 0,
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
                alignPrimary: "start",
                alignCounter: "start",
                wrap: false,
                sizingHorizontal: "fixed",
                sizingVertical: "fixed",
              },
              text: null,
              content: null,
              componentId: null,
              instanceOverrides: {},
              componentBinding: null,
              provenance: null,
              referenceBinding: null,
              sourceAnchor: null,
              sourceBinding: null,
            },
          },
        },
      },
      {
        anchorId: nodeId,
        editingId: null,
        focusedId: nodeId,
        selectedIds: [nodeId],
      },
    );
    const restoredWorkspace = first.getSnapshot().workspace;

    const restarted = new V3WorkbenchSessionController({
      persistence,
      source: { kind: "seed", document },
      workspace: restoredWorkspace,
    });
    await restarted.open();

    expect(restarted.getSnapshot()).toMatchObject({
      status: "ready",
      workspace: {
        documentRevision: 1,
        selection: { selectedIds: [nodeId] },
      },
    });
    expect(
      restarted.getSnapshot().authority?.getSnapshot().document.nodesById[nodeId],
    ).toMatchObject({ name: "Rectangle" });

    const renderer = restarted.getRendererSnapshot(document.pageIds[0]!);
    expect(renderer).toMatchObject({
      canRedo: false,
      canUndo: true,
      revision: 1,
      selection: { selectedIds: [nodeId] },
    });
    expect(renderer.nodes).toEqual([
      expect.objectContaining({ id: nodeId, name: "Rectangle" }),
    ]);
    expect(Object.isFrozen(renderer)).toBe(true);
    expect(Object.isFrozen(renderer.nodes)).toBe(true);

    const restoredAuthority = restarted.getSnapshot().authority;
    if (restoredAuthority === null) {
      throw new Error("Restarted V3 authority must be ready.");
    }
    await restoredAuthority.undo({
      actor: "human",
      actorId: "local-user",
      id: "opn_01J00000000000000000000001",
      occurredAt: "2026-08-01T18:01:00.000Z",
    });
    expect(restoredAuthority.getSnapshot()).toMatchObject({
      canRedo: true,
      canUndo: false,
      document: { revision: 2 },
      selection: { selectedIds: [] },
    });
    const restartedAfterUndo = new V3WorkbenchSessionController({
      persistence,
      source: { kind: "seed", document },
      workspace: restarted.getSnapshot().workspace,
    });
    await restartedAfterUndo.open();
    const authorityAfterUndo = restartedAfterUndo.getSnapshot().authority;
    if (authorityAfterUndo === null) {
      throw new Error("Restarted V3 redo authority must be ready.");
    }
    expect(authorityAfterUndo.getSnapshot()).toMatchObject({
      canRedo: true,
      canUndo: false,
      selection: { selectedIds: [] },
    });
    await authorityAfterUndo.redo({
      actor: "human",
      actorId: "local-user",
      id: "opn_01J00000000000000000000002",
      occurredAt: "2026-08-01T18:02:00.000Z",
    });
    expect(authorityAfterUndo.getSnapshot()).toMatchObject({
      canRedo: false,
      canUndo: true,
      document: { revision: 3 },
      selection: { selectedIds: [nodeId] },
    });
  });

  it("keeps the active V3 page across a workspace restart", async () => {
    const { document, secondPageId } = documentWithSecondPage();
    const persistence = memoryPort();
    const baseWorkspace = workspace(document);
    const initialWorkspace = workspaceSessionFromWorkbenchState(
      baseWorkspace,
      {
        activePageId: secondPageId,
        activity: baseWorkspace.activity,
        camera: {
          x: baseWorkspace.camera.x,
          y: baseWorkspace.camera.y,
          zoom: baseWorkspace.camera.zoom,
        },
        documentRevision: document.revision,
        history: { undo: [], redo: [] },
        panels: baseWorkspace.panels,
        selection: {
          anchorId: null,
          editingId: null,
          focusedId: null,
          selectedIds: [],
        },
        viewportSize: {
          width: baseWorkspace.camera.viewportWidth,
          height: baseWorkspace.camera.viewportHeight,
        },
      },
    );
    expect(initialWorkspace.activePageId).toBe(secondPageId);
    const first = new V3WorkbenchSessionController({
      persistence,
      source: { kind: "seed", document },
      workspace: initialWorkspace,
    });
    await first.open();

    const restarted = new V3WorkbenchSessionController({
      persistence,
      source: { kind: "seed", document },
      workspace: first.getSnapshot().workspace,
    });
    await restarted.open();

    expect(restarted.getSnapshot()).toMatchObject({
      status: "ready",
      workspace: { activePageId: secondPageId },
    });
  });

  it("surfaces persistence-open failure as a retryable error snapshot", async () => {
    const document = seed();
    const controller = new V3WorkbenchSessionController({
      persistence: memoryPort({ failLoad: true }),
      source: { kind: "seed", document },
      workspace: workspace(document),
    });

    await expect(controller.open()).rejects.toThrow("durable storage is unavailable");

    expect(controller.getSnapshot()).toMatchObject({
      authority: null,
      error: "durable storage is unavailable",
      status: "error",
    });
  });

  it("rejects a workspace whose identity cannot bind to the opened document", async () => {
    const document = seed();
    const wrongDocument = createCanvasDocumentV3({
      id: "doc_01J00000000000000000000001",
      projectId: document.projectId,
      initialPage: {
        id: "pag_01J00000000000000000000001",
        kind: "design",
        name: "Other page",
      },
    });
    const controller = new V3WorkbenchSessionController({
      persistence: memoryPort(),
      source: { kind: "seed", document },
      workspace: workspace(wrongDocument),
    });

    await expect(controller.open()).rejects.toThrow(/identity/i);

    expect(controller.getSnapshot()).toMatchObject({
      authority: null,
      error: expect.stringMatching(/identity/i),
      status: "error",
    });
  });
});
