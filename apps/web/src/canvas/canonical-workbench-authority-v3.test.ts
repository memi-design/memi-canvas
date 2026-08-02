import { describe, expect, it, vi } from "vitest";

import {
  CanvasDocumentAppendReceiptV3Schema,
  type CanvasDocumentIdentityV3,
  type CanvasDocumentJournalV3,
  type CanvasDocumentV3PersistencePort,
} from "@memi/protocol";

import {
  CanonicalWorkbenchAuthorityV3,
  migrateLegacyWorkbenchProjectionToV3,
} from "./canonical-workbench-authority-v3.js";
import { createLegacyWorkbenchProjection } from "./legacy-workbench-projection.js";

const operationId = "opn_01J00000000000000000000000";

function legacyProjection() {
  return createLegacyWorkbenchProjection({
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
}

function memoryPort(options: {
  readonly beforeAppend?: () => Promise<void>;
} = {}): CanvasDocumentV3PersistencePort {
  let journal: CanvasDocumentJournalV3 | null = null;
  return {
    load: vi.fn(async (_identity: CanvasDocumentIdentityV3) => journal),
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
      await options.beforeAppend?.();
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

describe("CanonicalWorkbenchAuthorityV3", () => {
  it("isolates legacy array state in a deterministic migration-only adapter", () => {
    const first = migrateLegacyWorkbenchProjectionToV3(legacyProjection(), {
      legacyDocumentId: "legacy-design",
      legacyProjectId: "legacy-project",
    });
    const second = migrateLegacyWorkbenchProjectionToV3(legacyProjection(), {
      legacyDocumentId: "legacy-design",
      legacyProjectId: "legacy-project",
    });

    expect(first).toEqual(second);
    expect(first.document.schemaVersion).toBe(3);
    expect(first.document.revision).toBe(7);
    expect(first.document.pageIds).toHaveLength(1);
    const canonicalNodeId = first.legacyReceipt.nodeIds["legacy-card"];
    expect(canonicalNodeId).toBeDefined();
    expect(first.selection.selectedIds).toEqual([canonicalNodeId]);
    expect(first.document.nodesById[canonicalNodeId!]).toMatchObject({
      name: "Card",
      pageId: first.document.pageIds[0],
    });
  });

  it("accepts semantic V3 intents and never exposes an array commit boundary", async () => {
    const migration = migrateLegacyWorkbenchProjectionToV3(
      legacyProjection(),
      {
        legacyDocumentId: "legacy-design",
        legacyProjectId: "legacy-project",
      },
    );
    const authority = await CanonicalWorkbenchAuthorityV3.open({
      document: migration.document,
      persistence: memoryPort(),
      selection: migration.selection,
    });
    const nodeId = migration.selection.selectedIds[0];
    const node = nodeId === undefined
      ? undefined
      : authority.getSnapshot().document.nodesById[nodeId];
    expect(node).toBeDefined();

    const operation = await authority.commit({
      id: operationId,
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-31T21:00:00.000Z",
      label: "Move card",
      action: {
        type: "node.transform",
        payload: {
          nodeId: nodeId!,
          next: { ...node!.transform, x: node!.transform.x + 40 },
        },
      },
    });

    expect(operation.type).toBe("node.transform");
    expect(authority.getSnapshot()).toMatchObject({
      document: { revision: 8 },
      selection: { selectedIds: [nodeId] },
    });
    expect(authority.getSnapshot().document.nodesById[nodeId!]?.transform.x).toBe(
      64,
    );
    expect("commitNodes" in authority).toBe(false);
  });

  it("records undo and redo as durable inverse operations instead of restoring a snapshot", async () => {
    const migration = migrateLegacyWorkbenchProjectionToV3(
      legacyProjection(),
      {
        legacyDocumentId: "legacy-design",
        legacyProjectId: "legacy-project",
      },
    );
    const persistence = memoryPort();
    const authority = await CanonicalWorkbenchAuthorityV3.open({
      document: migration.document,
      persistence,
      selection: migration.selection,
    });
    const nodeId = migration.selection.selectedIds[0]!;
    const historyStates: unknown[] = [];
    authority.subscribe(() => {
      const snapshot = authority.getSnapshot();
      if (snapshot.document.revision === 8) {
        historyStates.push({
          canRedo: snapshot.canRedo,
          canUndo: snapshot.canUndo,
        });
      }
    });

    await authority.commit({
      id: operationId,
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-31T21:00:00.000Z",
      label: "Move card",
      action: {
        type: "node.transform",
        payload: {
          nodeId,
          next: {
            ...authority.getSnapshot().document.nodesById[nodeId]!.transform,
            x: 64,
          },
        },
      },
    });
    expect(historyStates).toEqual([{ canRedo: false, canUndo: true }]);

    const undo = await authority.undo({
      id: "opn_01J00000000000000000000001",
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-31T21:00:01.000Z",
    });
    expect(undo).toMatchObject({ undoOf: operationId });
    expect(authority.getSnapshot()).toMatchObject({
      canRedo: true,
      canUndo: false,
      document: { revision: 9 },
    });
    expect(authority.getSnapshot().document.nodesById[nodeId]!.transform.x).toBe(
      24,
    );

    const redo = await authority.redo({
      id: "opn_01J00000000000000000000002",
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-31T21:00:02.000Z",
    });
    expect(redo).toMatchObject({ undoOf: undo.id });
    expect(authority.getSnapshot()).toMatchObject({
      canRedo: false,
      canUndo: true,
      document: { revision: 10 },
    });
    expect(authority.getSnapshot().document.nodesById[nodeId]!.transform.x).toBe(
      64,
    );
    expect(persistence.append).toHaveBeenCalledTimes(3);
  });

  it("rejects selections that are outside the bound V3 document", async () => {
    const migration = migrateLegacyWorkbenchProjectionToV3(
      legacyProjection(),
      {
        legacyDocumentId: "legacy-design",
        legacyProjectId: "legacy-project",
      },
    );
    const authority = await CanonicalWorkbenchAuthorityV3.open({
      document: migration.document,
      persistence: memoryPort(),
      selection: migration.selection,
    });

    expect(() =>
      authority.setSelection({
        anchorId: "missing-node",
        editingId: null,
        focusedId: "missing-node",
        selectedIds: ["missing-node"],
      }),
    ).toThrow(/missing V3 node/i);
  });

  it("commits durably and prunes an invalid post-operation selection", async () => {
    const migration = migrateLegacyWorkbenchProjectionToV3(
      legacyProjection(),
      {
        legacyDocumentId: "legacy-design",
        legacyProjectId: "legacy-project",
      },
    );
    const persistence = memoryPort();
    const authority = await CanonicalWorkbenchAuthorityV3.open({
      document: migration.document,
      persistence,
      selection: migration.selection,
    });
    const nodeId = migration.selection.selectedIds[0]!;

    await expect(
      authority.commit(
        {
          id: operationId,
          actor: "human",
          actorId: "local-user",
          occurredAt: "2026-07-31T21:00:00.000Z",
          label: "Delete card",
          action: { type: "node.delete", payload: { nodeId } },
        },
        migration.selection,
      ),
    ).resolves.toMatchObject({ type: "node.delete" });
    expect(persistence.append).toHaveBeenCalledOnce();
    expect(authority.getSnapshot()).toMatchObject({
      document: { revision: 8 },
      selection: {
        anchorId: null,
        editingId: null,
        focusedId: null,
        selectedIds: [],
      },
    });
  });

  it("publishes a committed document with its post-operation selection atomically", async () => {
    const migration = migrateLegacyWorkbenchProjectionToV3(
      legacyProjection(),
      {
        legacyDocumentId: "legacy-design",
        legacyProjectId: "legacy-project",
      },
    );
    const authority = await CanonicalWorkbenchAuthorityV3.open({
      document: migration.document,
      persistence: memoryPort(),
      selection: migration.selection,
    });
    const nodeId = migration.selection.selectedIds[0]!;
    const observedSelections: unknown[] = [];
    authority.subscribe(() => {
      if (authority.getSnapshot().document.revision === 8) {
        observedSelections.push(authority.getSnapshot().selection);
      }
    });

    await authority.commit(
      {
        id: operationId,
        actor: "human",
        actorId: "local-user",
        occurredAt: "2026-07-31T21:00:00.000Z",
        label: "Move card",
        action: {
          type: "node.transform",
          payload: {
            nodeId,
            next: {
              ...authority.getSnapshot().document.nodesById[nodeId]!.transform,
              x: 64,
            },
          },
        },
      },
      { anchorId: null, editingId: null, focusedId: null, selectedIds: [] },
    );

    expect(observedSelections).toEqual([
      { anchorId: null, editingId: null, focusedId: null, selectedIds: [] },
    ]);
  });

  it("does not overwrite a newer selection when durable commit resolution is delayed", async () => {
    const migration = migrateLegacyWorkbenchProjectionToV3(
      legacyProjection(),
      {
        legacyDocumentId: "legacy-design",
        legacyProjectId: "legacy-project",
      },
    );
    let releaseAppend: (() => void) | undefined;
    const persistence = memoryPort({
      beforeAppend: () =>
        new Promise<void>((resolve) => {
          releaseAppend = resolve;
        }),
    });
    const authority = await CanonicalWorkbenchAuthorityV3.open({
      document: migration.document,
      persistence,
      selection: migration.selection,
    });
    const nodeId = migration.selection.selectedIds[0]!;

    const commit = authority.commit(
      {
        id: operationId,
        actor: "human",
        actorId: "local-user",
        occurredAt: "2026-07-31T21:00:00.000Z",
        label: "Move card",
        action: {
          type: "node.transform",
          payload: {
            nodeId,
            next: {
              ...authority.getSnapshot().document.nodesById[nodeId]!.transform,
              x: 64,
            },
          },
        },
      },
      { anchorId: null, editingId: null, focusedId: null, selectedIds: [] },
    );
    await vi.waitFor(() => expect(persistence.append).toHaveBeenCalledOnce());

    authority.setSelection(migration.selection);
    releaseAppend?.();

    await expect(commit).resolves.toMatchObject({ type: "node.transform" });
    expect(authority.getSnapshot().selection).toEqual(migration.selection);
  });

  it("prunes stale persisted selection identities when opening the durable document", async () => {
    const migration = migrateLegacyWorkbenchProjectionToV3(
      legacyProjection(),
      {
        legacyDocumentId: "legacy-design",
        legacyProjectId: "legacy-project",
      },
    );
    const authority = await CanonicalWorkbenchAuthorityV3.open({
      document: migration.document,
      persistence: memoryPort(),
      selection: {
        anchorId: "stale-node",
        editingId: null,
        focusedId: "stale-node",
        selectedIds: ["stale-node", "stale-node"],
      },
    });

    expect(authority.getSnapshot().selection).toEqual({
      anchorId: null,
      editingId: null,
      focusedId: null,
      selectedIds: [],
    });
  });
});
