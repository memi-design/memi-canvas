import {
  type CanvasActionIntentV2,
  type CanvasDocumentV2,
  type CanvasNodeId,
  type CanvasNodeV2,
  type OperationId,
} from "@memi/protocol";
import {
  applyCanvasOperationV2,
  createCanvasDocumentV2,
  mapLegacyCanvasIdV2,
  prepareCanvasOperationV2,
} from "@memi/canvas-document";
import { describe, expect, it, vi } from "vitest";

import { createCanonicalCanvasStore } from "./canonical-canvas-store.js";

const ids = {
  document: "doc_01J00000000000000000000000",
  node: [
    "nod_01J00000000000000000000000" as CanvasNodeId,
    "nod_01J00000000000000000000001" as CanvasNodeId,
  ] as const,
  project: "prj_01J00000000000000000000000",
} as const;

function operationId(index: number): OperationId {
  return mapLegacyCanvasIdV2("operation", `test-operation:${index}`)
    .canonicalId as OperationId;
}

function node(
  id: CanvasNodeV2["id"],
  kind: CanvasNodeV2["kind"] = "rectangle",
): CanvasNodeV2 {
  return {
    childIds: [],
    componentBinding: null,
    componentId: null,
    content: null,
    geometry: { height: 100, width: 100 },
    id,
    instanceOverrides: {},
    kind,
    layout: {
      alignCounter: "start",
      alignPrimary: "start",
      gap: 0,
      mode: "none",
      padding: { bottom: 0, left: 0, right: 0, top: 0 },
      sizingHorizontal: "fixed",
      sizingVertical: "fixed",
      wrap: false,
    },
    name: id,
    parentId: null,
    provenance: null,
    referenceBinding: null,
    sourceAnchor: null,
    sourceBinding: null,
    style: {
      cornerRadii: [0, 0, 0, 0],
      fills: [],
      locked: false,
      opacity: 1,
      strokes: [],
      visible: true,
    },
    text:
      kind === "text"
        ? { autoResize: "width-height", characters: "" }
        : null,
    transform: { rotation: 0, scaleX: 1, scaleY: 1, x: 0, y: 0 },
  };
}

function prepare(
  document: CanvasDocumentV2,
  action: CanvasActionIntentV2,
  index: number,
) {
  return prepareCanvasOperationV2(document, {
    action,
    actor: "human",
    actorId: "test-user",
    id: operationId(index),
    occurredAt: new Date(
      Date.UTC(2026, 6, 29, 12, 0, 0, index),
    ).toISOString(),
  });
}

function documentWithNodes(
  nodes: readonly CanvasNodeV2[] = [],
): CanvasDocumentV2 {
  let document = createCanvasDocumentV2({
    id: ids.document,
    projectId: ids.project,
  });
  nodes.forEach((item, index) => {
    document = applyCanvasOperationV2(
      document,
      prepare(
        document,
        {
          payload: { index, node: item, parentId: null },
          type: "node.create",
        },
        index,
      ),
    );
  });
  return document;
}

function storeFor(document: CanvasDocumentV2) {
  let allocation = 10_000;
  return createCanonicalCanvasStore({
    allocateHistoryOperation: () => ({
      actor: "human",
      actorId: "test-user",
      id: operationId(allocation++),
      occurredAt: new Date(
        Date.UTC(2026, 6, 29, 13, 0, 0, allocation),
      ).toISOString(),
    }),
    document,
  });
}

describe("canonical canvas store", () => {
  it("publishes immutable canonical protocol snapshots", () => {
    const initial = documentWithNodes();
    const store = storeFor(initial);
    const listener = vi.fn();
    store.subscribe(listener);
    const create = prepare(
      initial,
      {
        payload: { index: 0, node: node(ids.node[0]), parentId: null },
        type: "node.create",
      },
      100,
    );

    expect(store.dispatch(create)).toEqual({
      ok: true,
      revision: 1,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(initial.nodesById).toEqual({});
    expect(store.getSnapshot().document.nodesById[ids.node[0]]).toBeDefined();
    expect(Object.isFrozen(store.getSnapshot())).toBe(true);
    expect(Object.isFrozen(store.getSnapshot().document)).toBe(true);
  });

  it("supports fine-grained selectors for useSyncExternalStore consumers", () => {
    const initial = documentWithNodes([node(ids.node[0])]);
    const store = storeFor(initial);
    const revisionListener = vi.fn();
    store.subscribeSelector(
      (snapshot) => snapshot.document.revision,
      revisionListener,
    );

    store.setViewport({
      pointerMode: "idle",
      translation: { x: 40, y: 20 },
      viewportSize: { height: 800, width: 1200 },
      zoom: 2,
    });
    store.setSelection({
      anchorId: ids.node[0],
      editingId: null,
      focusedId: ids.node[0],
      selectedIds: [ids.node[0]],
    });
    expect(revisionListener).not.toHaveBeenCalled();

    store.dispatch(
      prepare(
        initial,
        {
          payload: {
            next: { rotation: 0, scaleX: 1, scaleY: 1, x: 12, y: 24 },
            nodeId: ids.node[0],
          },
          type: "node.transform",
        },
        100,
      ),
    );
    expect(revisionListener).toHaveBeenCalledWith(initial.revision + 1, initial.revision);
  });

  it("stores canonical operations rather than whole-document history", () => {
    const initial = documentWithNodes([
      node(ids.node[0]),
      node(ids.node[1]),
    ]);
    const store = storeFor(initial);
    store.setSelection({
      anchorId: ids.node[0],
      editingId: null,
      focusedId: ids.node[0],
      selectedIds: [ids.node[0]],
    });
    const transform = prepare(
      initial,
      {
        payload: {
          next: { rotation: 0, scaleX: 1, scaleY: 1, x: 50, y: 60 },
          nodeId: ids.node[0],
        },
        type: "node.transform",
      },
      100,
    );

    store.dispatch(transform, {
      selectionAfter: {
        anchorId: ids.node[1],
        editingId: null,
        focusedId: ids.node[1],
        selectedIds: [ids.node[1]],
      },
    });

    const entry = store.getHistorySnapshot().past[0];
    expect(entry?.operation).toEqual(transform);
    expect(entry?.operation).not.toBe(transform);
    expect(entry).not.toHaveProperty("before");
    expect(entry).not.toHaveProperty("after");
    expect(store.undo()).toEqual({
      ok: true,
      revision: initial.revision + 2,
    });
    expect(
      store.getSnapshot().document.nodesById[ids.node[0]]?.transform,
    ).toMatchObject({ x: 0, y: 0 });
    expect(store.getSnapshot().selection.selectedIds).toEqual([ids.node[0]]);
    expect(store.redo()).toEqual({
      ok: true,
      revision: initial.revision + 3,
    });
    expect(
      store.getSnapshot().document.nodesById[ids.node[0]]?.transform,
    ).toMatchObject({ x: 50, y: 60 });
    expect(store.getSnapshot().selection.selectedIds).toEqual([ids.node[1]]);
  });

  it("prepares semantic action intents at the store boundary as one history entry", () => {
    const initial = documentWithNodes([
      node(ids.node[0]),
      node(ids.node[1]),
    ]);
    const store = storeFor(initial);
    const listener = vi.fn();
    store.subscribe(listener);

    const result = store.dispatchIntent(
      {
        payload: {
          actions: [
            {
              payload: {
                next: {
                  rotation: 0,
                  scaleX: 1,
                  scaleY: 1,
                  x: 48,
                  y: 64,
                },
                nodeId: ids.node[0],
              },
              type: "node.transform",
            },
            {
              payload: {
                next: { height: 160, width: 240 },
                nodeId: ids.node[0],
              },
              type: "node.geometry",
            },
          ],
        },
        type: "atomic.batch",
      },
      {
        actor: "human",
        actorId: "test-user",
        historyLabel: "Transform selection",
        id: operationId(101),
        occurredAt: new Date(Date.UTC(2026, 6, 29, 14)).toISOString(),
        selectionAfter: {
          anchorId: ids.node[0],
          editingId: null,
          focusedId: ids.node[0],
          selectedIds: [ids.node[0]],
        },
      },
    );

    expect(result).toEqual({ ok: true, revision: initial.revision + 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getHistorySnapshot().past).toHaveLength(1);
    expect(store.getHistorySnapshot().past[0]?.operation.type).toBe(
      "atomic.batch",
    );
    expect(store.getSnapshot().document.nodesById[ids.node[0]])
      .toMatchObject({
        geometry: { height: 160, width: 240 },
        transform: { x: 48, y: 64 },
      });
  });

  it("keeps pointer gestures and hover state outside durable state", () => {
    const store = storeFor(documentWithNodes([node(ids.node[0])]));
    const durableListener = vi.fn();
    const transientListener = vi.fn();
    store.subscribe(durableListener);
    store.subscribeTransient(transientListener);

    store.setTransient({
      gesture: {
        kind: "move",
        origin: { x: 0, y: 0 },
        pointerId: 7,
      },
      guides: [{ axis: "x", position: 100 }],
      hoveredNodeId: ids.node[0],
      pointer: { x: 12, y: 18 },
    });

    expect(transientListener).toHaveBeenCalledTimes(1);
    expect(durableListener).not.toHaveBeenCalled();
    expect(store.getHistorySnapshot().past).toEqual([]);
  });

  it("does not publish equal session state and validates session boundaries", () => {
    const initial = documentWithNodes([node(ids.node[0])]);
    const store = storeFor(initial);
    const durableListener = vi.fn();
    const transientListener = vi.fn();
    const unsubscribeDurable = store.subscribe(durableListener);
    const unsubscribeTransient = store.subscribeTransient(transientListener);

    store.setSelection({
      anchorId: null,
      editingId: null,
      focusedId: null,
      selectedIds: [],
    });
    store.setViewport({
      pointerMode: "idle",
      translation: { x: 0, y: 0 },
      viewportSize: { height: 0, width: 0 },
      zoom: 1,
    });
    store.setTransient({
      gesture: null,
      guides: [],
      hoveredNodeId: null,
      pointer: null,
    });

    expect(durableListener).not.toHaveBeenCalled();
    expect(transientListener).not.toHaveBeenCalled();
    expect(() =>
      store.setSelection({
        anchorId: "missing",
        editingId: null,
        focusedId: "missing",
        selectedIds: ["missing"],
      }),
    ).toThrow(/missing canonical node/iu);
    expect(() =>
      store.setViewport({
        pointerMode: "idle",
        translation: { x: 0, y: 0 },
        viewportSize: { height: 10, width: 10 },
        zoom: 0,
      }),
    ).toThrow(/viewport/iu);
    expect(store.undo()).toEqual({
      changed: false,
      ok: true,
      revision: initial.revision,
    });
    expect(store.redo()).toEqual({
      changed: false,
      ok: true,
      revision: initial.revision,
    });
    store.acknowledgeSnapshot();

    unsubscribeDurable();
    unsubscribeTransient();
    store.setViewport({
      pointerMode: "idle",
      translation: { x: 1, y: 1 },
      viewportSize: { height: 10, width: 10 },
      zoom: 1,
    });
    store.setTransient({
      gesture: null,
      guides: [],
      hoveredNodeId: ids.node[0],
      pointer: null,
    });
    expect(durableListener).not.toHaveBeenCalled();
    expect(transientListener).not.toHaveBeenCalled();
  });

  it("isolates subscriber failures from committed operation results", () => {
    const initial = documentWithNodes([node(ids.node[0])]);
    const onStoreError = vi.fn();
    const healthySubscriber = vi.fn();
    const store = createCanonicalCanvasStore({
      allocateHistoryOperation: () => ({
        actor: "human",
        actorId: "test-user",
        id: operationId(12_000),
        occurredAt: new Date().toISOString(),
      }),
      document: initial,
      onStoreError,
    });
    store.subscribe(() => {
      throw new Error("subscriber failed");
    });
    store.subscribe(healthySubscriber);
    const operation = prepare(
      initial,
      {
        payload: {
          next: { height: 200, width: 200 },
          nodeId: ids.node[0],
        },
        type: "node.geometry",
      },
      100,
    );

    expect(store.dispatch(operation)).toEqual({
      ok: true,
      revision: initial.revision + 1,
    });
    expect(onStoreError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "subscriber failed" }),
    );
    expect(healthySubscriber).toHaveBeenCalledTimes(1);
  });

  it("rejects stale and conflicting duplicate operations atomically", () => {
    const initial = documentWithNodes([node(ids.node[0])]);
    const store = storeFor(initial);
    const transform = prepare(
      initial,
      {
        payload: {
          next: { rotation: 0, scaleX: 1, scaleY: 1, x: 20, y: 30 },
          nodeId: ids.node[0],
        },
        type: "node.transform",
      },
      100,
    );

    expect(store.dispatch(transform).ok).toBe(true);
    expect(store.dispatch(transform)).toEqual({
      changed: false,
      ok: true,
      revision: initial.revision + 1,
    });
    const stale = prepare(
      initial,
      {
        payload: {
          next: { height: 200, width: 200 },
          nodeId: ids.node[0],
        },
        type: "node.geometry",
      },
      101,
    );
    expect(store.dispatch(stale)).toMatchObject({
      code: "stale-operation",
      ok: false,
    });
    expect(
      store.getSnapshot().document.nodesById[ids.node[0]]?.geometry,
    ).toEqual({ height: 100, width: 100 });
  });

  it("applies and reverses a canonical atomic batch as one history entry", () => {
    const initial = documentWithNodes([node(ids.node[0])]);
    const store = storeFor(initial);
    const batch = prepare(
      initial,
      {
        payload: {
          actions: [
            {
              payload: {
                next: {
                  rotation: 0,
                  scaleX: 1,
                  scaleY: 1,
                  x: 20,
                  y: 30,
                },
                nodeId: ids.node[0],
              },
              type: "node.transform",
            },
            {
              payload: {
                next: { height: 480, width: 640 },
                nodeId: ids.node[0],
              },
              type: "node.geometry",
            },
          ],
        },
        type: "atomic.batch",
      },
      100,
    );

    store.dispatch(batch);
    expect(store.getHistorySnapshot().past).toHaveLength(1);
    expect(store.getSnapshot().document.nodesById[ids.node[0]]).toMatchObject({
      geometry: { height: 480, width: 640 },
      transform: { x: 20, y: 30 },
    });
    store.undo();
    expect(store.getSnapshot().document.nodesById[ids.node[0]]).toMatchObject({
      geometry: { height: 100, width: 100 },
      transform: { x: 0, y: 0 },
    });
  });

  it("requests a durable snapshot after 250 operations and resets after ack", () => {
    const onSnapshotRequired = vi.fn();
    const initial = documentWithNodes([node(ids.node[0])]);
    let allocation = 20_000;
    const store = createCanonicalCanvasStore({
      allocateHistoryOperation: () => ({
        actor: "human",
        actorId: "test-user",
        id: operationId(allocation++),
        occurredAt: new Date().toISOString(),
      }),
      document: initial,
      onSnapshotRequired,
    });

    for (let index = 0; index < 250; index += 1) {
      const current = store.getSnapshot().document;
      const result = store.dispatch(
        prepare(
          current,
          {
            payload: {
              next: {
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                x: index + 1,
                y: index + 1,
              },
              nodeId: ids.node[0],
            },
            type: "node.transform",
          },
          1_000 + index,
        ),
      );
      expect(result.ok).toBe(true);
    }

    expect(store.getSnapshot().snapshot).toMatchObject({
      operationCount: 250,
      required: true,
    });
    expect(onSnapshotRequired).toHaveBeenCalledTimes(1);
    store.acknowledgeSnapshot();
    expect(store.getSnapshot().snapshot).toEqual({
      operationBytes: 0,
      operationCount: 0,
      required: false,
    });
  });

  it("requests a snapshot when canonical operation bytes exceed two megabytes", () => {
    const textNode = {
      ...node(ids.node[0], "text"),
      text: { autoResize: "width-height" as const, characters: "" },
    };
    const initial = documentWithNodes([textNode]);
    const store = storeFor(initial);
    for (let index = 0; index < 4; index += 1) {
      const operation = prepare(
        store.getSnapshot().document,
        {
          payload: {
            next: {
              autoResize: "width-height",
              characters: String.fromCharCode(97 + index).repeat(350_000),
            },
            nodeId: ids.node[0],
          },
          type: "node.text",
        },
        100 + index,
      );
      store.dispatch(operation);
    }

    expect(store.getSnapshot().snapshot.required).toBe(true);
    expect(store.getSnapshot().snapshot.operationBytes).toBeGreaterThanOrEqual(
      2_000_000,
    );
  });
});
