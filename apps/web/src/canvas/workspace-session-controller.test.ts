import { describe, expect, it, vi } from "vitest";

import {
  WorkspaceSessionSnapshotSchemaV1,
  createWorkspaceSessionDraft,
  type SaveWorkspaceSessionRequestV1,
  type WorkspaceSessionRuntimePortV1,
  type WorkspaceSessionSnapshotV1,
} from "@memi/protocol";
import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";

import type { RuntimeClientV1 } from "../runtime/runtime-client.js";
import {
  WorkspaceSessionController,
  createRuntimeClientWorkspaceSessionPort,
  workspaceSessionFromCanvasDocumentV3,
} from "./workspace-session-controller.js";

const SOURCE_REVISION = "a".repeat(40);

function createRuntime() {
  let session: WorkspaceSessionSnapshotV1 | null = null;
  return {
    load: vi.fn(async () => session),
    save: vi.fn(async (request: SaveWorkspaceSessionRequestV1) => {
      const next = WorkspaceSessionSnapshotSchemaV1.parse({
        ...request.session,
        sessionRevision: (session?.sessionRevision ?? 0) + 1,
        updatedAt: "2026-07-29T12:00:00.000Z",
      });
      session = next;
      return next;
    }),
    migrateLegacy: vi.fn(),
  } satisfies WorkspaceSessionRuntimePortV1;
}

const initial = createWorkspaceSessionDraft({
  projectId: "project-buzzr",
  documentId: "buzzr-mobile",
  documentRevision: 4,
  sourceRevision: SOURCE_REVISION,
});
const runtimeInitial = createWorkspaceSessionDraft({
  ...initial,
  projectId: "prj_01J00000000000000000000000",
});

describe("workspace session controller", () => {
  it("binds the session to the exact V3 document revision and validated selection", () => {
    const document = createCanvasDocumentV3({
      id: "doc_01J00000000000000000000000",
      projectId: "prj_01J00000000000000000000000",
      initialPage: {
        id: "pag_01J00000000000000000000000",
        kind: "design",
        name: "Page 1",
      },
    });
    const session = createWorkspaceSessionDraft({
      projectId: document.projectId,
      documentId: document.id,
      documentRevision: document.revision,
      sourceRevision: null,
    });
    const nodeId = "nod_01J00000000000000000000000";
    const operation = prepareCanvasOperationV3(document, {
      id: "opn_01J00000000000000000000000",
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-31T21:20:00.000Z",
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
    });
    const nextDocument = applyCanvasOperationV3(document, operation);
    const next = workspaceSessionFromCanvasDocumentV3(session, nextDocument, {
      anchorId: nodeId,
      editingId: null,
      focusedId: nodeId,
      selectedIds: [nodeId],
    });

    expect(next).toMatchObject({
      projectId: document.projectId,
      documentId: document.id,
      documentRevision: 1,
      selection: {
        selectedIds: [nodeId],
        anchorId: nodeId,
        focusedNodeId: nodeId,
      },
    });
    expect(Object.isFrozen(next.selection)).toBe(true);
    expect(() =>
      workspaceSessionFromCanvasDocumentV3(next, document, {
        anchorId: null,
        editingId: null,
        focusedId: null,
        selectedIds: [],
      }),
    ).toThrow(/regress/i);
  });

  it("adapts the authenticated runtime client session surface without exposing transport authority", async () => {
    const restored = WorkspaceSessionSnapshotSchemaV1.parse({
      ...runtimeInitial,
      sessionRevision: 3,
      updatedAt: "2026-07-29T12:00:00.000Z",
    });
    const restore = vi.fn(async () => ({ session: restored }));
    const save = vi.fn(async () => ({
      session: WorkspaceSessionSnapshotSchemaV1.parse({
        ...initial,
        projectId: runtimeInitial.projectId,
        sessionRevision: 4,
        updatedAt: "2026-07-29T12:00:01.000Z",
      }),
    }));
    const migrateLegacy = vi.fn();
    const port = createRuntimeClientWorkspaceSessionPort({
      sessions: { migrateLegacy, restore, save },
    } as Pick<RuntimeClientV1, "sessions">);

    await expect(
      port.load(runtimeInitial.projectId, runtimeInitial.documentId),
    ).resolves.toEqual(restored);
    await expect(
      port.save({
        expectedSessionRevision: 3,
        session: runtimeInitial,
      }),
    ).resolves.toMatchObject({ sessionRevision: 4 });
    expect(restore).toHaveBeenCalledWith({
      projectId: runtimeInitial.projectId,
      documentId: runtimeInitial.documentId,
    });
    expect(save).toHaveBeenCalledWith({
      expected: {
        documentRevision: runtimeInitial.documentRevision,
        sourceRevision: runtimeInitial.sourceRevision,
        sessionRevision: 3,
      },
      projectId: runtimeInitial.projectId,
      documentId: runtimeInitial.documentId,
      session: runtimeInitial,
    });
  });

  it("preserves the immutable migration key and source hash through the authenticated runtime", async () => {
    const restore = vi.fn();
    const saved = WorkspaceSessionSnapshotSchemaV1.parse({
      ...initial,
      projectId: runtimeInitial.projectId,
      sessionRevision: 1,
      updatedAt: "2026-07-29T12:00:00.000Z",
    });
    const save = vi.fn();
    const migrateLegacy = vi.fn(async () => ({
      status: "migrated" as const,
      session: saved,
    }));
    const port = createRuntimeClientWorkspaceSessionPort({
      sessions: { migrateLegacy, restore, save },
    } as Pick<RuntimeClientV1, "sessions">);

    await expect(
      port.migrateLegacy({
        migrationKey: "local-storage:document",
        legacyRecordHash: "fnv1a64:0123456789abcdef",
        session: runtimeInitial,
      }),
    ).resolves.toEqual({ status: "migrated", session: saved });
    expect(migrateLegacy).toHaveBeenCalledExactlyOnceWith({
      migrationKey: "local-storage:document",
      legacyRecordHash: "fnv1a64:0123456789abcdef",
      projectId: runtimeInitial.projectId,
      documentId: runtimeInitial.documentId,
      session: runtimeInitial,
    });
    expect(restore).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("publishes immutable validated session updates and persists through the injected port", async () => {
    const runtime = createRuntime();
    const controller = new WorkspaceSessionController(initial, runtime);
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.update((session) => ({
      ...session,
      camera: { ...session.camera, x: 120, zoom: 2 },
      selection: {
        selectedIds: ["button-primary"],
        anchorId: "button-primary",
        focusedNodeId: "button-primary",
        editingNodeId: null,
      },
    }));

    expect(listener).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().session.camera.x).toBe(120);
    expect(Object.isFrozen(controller.getSnapshot().session.camera)).toBe(
      true,
    );
    expect(initial.camera.x).toBe(0);

    await controller.persist();
    expect(runtime.save).toHaveBeenCalledWith({
      expectedSessionRevision: null,
      session: controller.getSnapshot().session,
    });
    expect(controller.getSnapshot()).toMatchObject({
      persistedRevision: 1,
      dirty: false,
      error: null,
    });
  });

  it("keeps edits made during an in-flight save dirty without losing the revision fence", async () => {
    let resolveSave:
      | ((snapshot: WorkspaceSessionSnapshotV1) => void)
      | undefined;
    const runtime = createRuntime();
    runtime.save.mockImplementationOnce(
      (request) =>
        new Promise((resolve) => {
          resolveSave = () =>
            resolve(
              WorkspaceSessionSnapshotSchemaV1.parse({
                ...request.session,
                sessionRevision: 1,
                updatedAt: "2026-07-29T12:00:00.000Z",
              }),
            );
        }),
    );
    const controller = new WorkspaceSessionController(initial, runtime);
    controller.update((session) => ({
      ...session,
      camera: { ...session.camera, x: 10 },
    }));
    const saving = controller.persist();
    controller.update((session) => ({
      ...session,
      camera: { ...session.camera, x: 20 },
    }));
    resolveSave?.(
      WorkspaceSessionSnapshotSchemaV1.parse({
        ...controller.getSnapshot().session,
        camera: { ...controller.getSnapshot().session.camera, x: 10 },
        sessionRevision: 1,
        updatedAt: "2026-07-29T12:00:00.000Z",
      }),
    );
    await saving;

    expect(controller.getSnapshot()).toMatchObject({
      session: { camera: { x: 20 } },
      persistedRevision: 1,
      dirty: true,
    });
    runtime.save.mockResolvedValueOnce(
      WorkspaceSessionSnapshotSchemaV1.parse({
        ...controller.getSnapshot().session,
        sessionRevision: 2,
        updatedAt: "2026-07-29T12:00:01.000Z",
      }),
    );
    await controller.persist();
    expect(runtime.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedSessionRevision: 1 }),
    );
  });

  it("fails closed on invalid updates and never persists transient interaction fields", async () => {
    const runtime = createRuntime();
    const controller = new WorkspaceSessionController(initial, runtime);

    expect(() =>
      controller.update((session) => ({
        ...session,
        pointerGesture: { type: "move" },
      })),
    ).toThrow();
    expect(runtime.save).not.toHaveBeenCalled();
    expect(() =>
      controller.update((session) => ({
        ...session,
        projectId: "other-project",
      })),
    ).toThrow(/identity/iu);
    expect(() =>
      controller.update((session) => ({
        ...session,
        documentRevision: session.documentRevision - 1,
      })),
    ).toThrow(/regress/iu);
  });

  it("restores only the exact project and document session", async () => {
    const runtime = createRuntime();
    runtime.load.mockResolvedValue(
      WorkspaceSessionSnapshotSchemaV1.parse({
        ...initial,
        sessionRevision: 3,
        updatedAt: "2026-07-29T12:00:00.000Z",
      }),
    );
    const controller = new WorkspaceSessionController(initial, runtime);
    await controller.restore();
    expect(controller.getSnapshot()).toMatchObject({
      persistedRevision: 3,
      dirty: false,
    });

    runtime.load.mockResolvedValue({
      ...controller.getSnapshot().session,
      projectId: "other-project",
      sessionRevision: 4,
      updatedAt: "2026-07-29T12:00:00.000Z",
    });
    await expect(controller.restore()).rejects.toThrow(/identity/iu);

    runtime.load.mockResolvedValue(
      WorkspaceSessionSnapshotSchemaV1.parse({
        ...initial,
        documentRevision: 3,
        sessionRevision: 4,
        updatedAt: "2026-07-29T12:00:00.000Z",
      }),
    );
    await expect(controller.restore()).rejects.toThrow(/regress/iu);

    runtime.load.mockResolvedValue(
      WorkspaceSessionSnapshotSchemaV1.parse({
        ...initial,
        sourceRevision: "b".repeat(40),
        sessionRevision: 4,
        updatedAt: "2026-07-29T12:00:00.000Z",
      }),
    );
    await expect(controller.restore()).rejects.toThrow(
      /source revision/iu,
    );

    runtime.load.mockResolvedValue(null);
    await expect(controller.restore()).resolves.toBeUndefined();
  });

  it("rejects a runtime receipt that does not exactly advance the submitted state", async () => {
    const runtime = createRuntime();
    runtime.save.mockResolvedValue(
      WorkspaceSessionSnapshotSchemaV1.parse({
        ...initial,
        camera: { ...initial.camera, x: 999 },
        sessionRevision: 1,
        updatedAt: "2026-07-29T12:00:00.000Z",
      }),
    );
    const controller = new WorkspaceSessionController(initial, runtime);

    await expect(controller.persist()).rejects.toThrow(/mismatched/iu);
    expect(controller.getSnapshot()).toMatchObject({
      dirty: true,
      saving: false,
    });
  });
});
