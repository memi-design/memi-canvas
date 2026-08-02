import { describe, expect, it, vi } from "vitest";

import {
  CanvasDocumentAppendReceiptV3Schema,
  CanvasNodeV3Schema,
  type CanvasDocumentAppendV3,
  type CanvasDocumentIdentityV3,
  type CanvasDocumentJournalV3,
  type CanvasDocumentSnapshotV3,
  type CanvasDocumentV3PersistencePort,
  type CanvasNodeV3,
} from "@memi/protocol";

import {
  CanvasDocumentV3PersistenceAdapter,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "./v3.js";

const ids = {
  project: "prj_01J00000000000000000000000",
  document: "doc_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
  node: "nod_01J00000000000000000000000",
  operation: "opn_01J00000000000000000000000",
} as const;

function seed() {
  return createCanvasDocumentV3({
    id: ids.document,
    projectId: ids.project,
    initialPage: { id: ids.page, kind: "design", name: "Page 1" },
  });
}

function node(): CanvasNodeV3 {
  return CanvasNodeV3Schema.parse({
    id: ids.node,
    pageId: ids.page,
    kind: "rectangle",
    name: "Card",
    parentId: null,
    childIds: [],
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    geometry: { width: 320, height: 180 },
    style: {
      opacity: 1,
      visible: true,
      locked: false,
      fills: [],
      strokes: [],
      cornerRadii: [16, 16, 16, 16],
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
  });
}

function operation(document = seed()) {
  return prepareCanvasOperationV3(document, {
    id: ids.operation,
    actor: "human",
    actorId: "local-user",
    occurredAt: "2026-07-31T20:00:00.000Z",
    label: "Create card",
    action: {
      type: "node.create",
      payload: { node: node(), parentId: null, index: 0 },
    },
  });
}

function memoryPort(input?: {
  readonly journal?: CanvasDocumentJournalV3 | null;
  readonly appendError?: Error;
}) {
  const snapshots: CanvasDocumentSnapshotV3[] = [];
  const appends: CanvasDocumentAppendV3[] = [];
  const port: CanvasDocumentV3PersistencePort = {
    load: vi.fn(async (_identity: CanvasDocumentIdentityV3) =>
      input?.journal ?? null,
    ),
    initialize: vi.fn(async (snapshot) => {
      snapshots.push(snapshot);
    }),
    append: vi.fn(async (request) => {
      if (input?.appendError !== undefined) {
        throw input.appendError;
      }
      appends.push(request);
      return CanvasDocumentAppendReceiptV3Schema.parse({
        schemaVersion: 1,
        identity: request.identity,
        operationId: request.operation.id,
        revision: request.operation.expectedRevision + 1,
        stateHash: request.operation.resultingHash,
      });
    }),
    checkpoint: vi.fn(async (snapshot) => {
      snapshots.push(snapshot);
    }),
  };
  return { appends, port, snapshots };
}

describe("CanvasDocumentV3PersistenceAdapter", () => {
  it("initializes once, appends operations without document snapshots, and checkpoints explicitly", async () => {
    const memory = memoryPort();
    const adapter = await CanvasDocumentV3PersistenceAdapter.open(
      seed(),
      memory.port,
      { maxOperationBytes: 1_000_000, maxOperations: 1 },
    );

    expect(memory.snapshots).toHaveLength(1);
    expect(Object.isFrozen(adapter.document)).toBe(true);
    expect(Object.isFrozen(adapter.identity)).toBe(true);
    const committed = await adapter.commit(operation(adapter.document));

    expect(adapter.document.revision).toBe(0);
    expect(committed.document.revision).toBe(1);
    expect(committed.snapshotRequired).toBe(true);
    expect(memory.appends).toHaveLength(1);
    expect(Object.hasOwn(memory.appends[0]!, "document")).toBe(false);

    const checkpointed = await committed.checkpoint(
      "2026-07-31T20:00:01.000Z",
    );
    expect(memory.snapshots.at(-1)?.document.revision).toBe(1);
    expect(checkpointed.snapshotRequired).toBe(false);
  });

  it("does not publish an in-memory revision when durable append fails", async () => {
    const memory = memoryPort({ appendError: new Error("disk unavailable") });
    const adapter = await CanvasDocumentV3PersistenceAdapter.open(
      seed(),
      memory.port,
    );

    await expect(adapter.commit(operation(adapter.document))).rejects.toThrow(
      /disk unavailable/i,
    );
    expect(adapter.document.revision).toBe(0);
    expect(adapter.document.nodesById).toEqual({});
  });

  it("replays the operation journal against its bound snapshot during restore", async () => {
    const initial = seed();
    const create = operation(initial);
    const identity = {
      schemaVersion: 1 as const,
      projectId: initial.projectId,
      documentId: initial.id,
    };
    const journal = {
      schemaVersion: 1 as const,
      kind: "canvas-document-v3-journal" as const,
      identity,
      snapshot: {
        schemaVersion: 1 as const,
        kind: "canvas-document-v3-snapshot" as const,
        identity,
        document: initial,
        persistedAt: "2026-07-31T20:00:00.000Z",
      },
      operations: [create],
      operationBytes: new TextEncoder().encode(JSON.stringify(create)).byteLength,
    };
    const memory = memoryPort({ journal });
    const adapter = await CanvasDocumentV3PersistenceAdapter.open(
      initial,
      memory.port,
    );

    expect(adapter.document.revision).toBe(1);
    expect(adapter.document.nodesById[ids.node]?.name).toBe("Card");
    expect(memory.snapshots).toHaveLength(0);
  });
});
