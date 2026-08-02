import { describe, expect, it, vi } from "vitest";

import {
  CanvasDocumentAppendReceiptV3Schema,
  CanvasNodeV3Schema,
  type CanvasDocumentAppendV3,
  type CanvasDocumentIdentityV3,
  type CanvasDocumentJournalV3,
  type CanvasDocumentSnapshotV3,
  type CanvasDocumentV3PersistencePort,
} from "@memi/protocol";
import { createCanvasDocumentV3 } from "@memi/canvas-document";

import { CanonicalCanvasJournalV3 } from "./canonical-canvas-journal-v3.js";

const ids = {
  document: "doc_01J00000000000000000000000",
  nodeA: "nod_01J00000000000000000000000",
  nodeB: "nod_01J00000000000000000000001",
  operationA: "opn_01J00000000000000000000000",
  operationB: "opn_01J00000000000000000000001",
  page: "pag_01J00000000000000000000000",
  project: "prj_01J00000000000000000000000",
} as const;

function seed() {
  return createCanvasDocumentV3({
    id: ids.document,
    projectId: ids.project,
    initialPage: { id: ids.page, kind: "design", name: "Page 1" },
  });
}

function rectangle(id: string, name: string) {
  return CanvasNodeV3Schema.parse({
    id,
    pageId: ids.page,
    kind: "rectangle",
    name,
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
  });
}

function createMemoryPort() {
  const appends: CanvasDocumentAppendV3[] = [];
  const snapshots: CanvasDocumentSnapshotV3[] = [];
  let journal: CanvasDocumentJournalV3 | null = null;
  const port: CanvasDocumentV3PersistencePort = {
    load: vi.fn(async (_identity: CanvasDocumentIdentityV3) => journal),
    initialize: vi.fn(async (snapshot) => {
      snapshots.push(snapshot);
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
      appends.push(request);
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
    checkpoint: vi.fn(async (snapshot) => {
      snapshots.push(snapshot);
      journal = {
        schemaVersion: 1,
        kind: "canvas-document-v3-journal",
        identity: snapshot.identity,
        snapshot,
        operations: [],
        operationBytes: 0,
      };
    }),
  };
  return { appends, port, snapshots };
}

function createIntent(id: string, operationId: string, name: string) {
  return {
    id: operationId,
    actor: "human" as const,
    actorId: "local-user",
    occurredAt: "2026-07-31T20:00:00.000Z",
    label: `Create ${name}`,
    action: {
      type: "node.create" as const,
      payload: { node: rectangle(id, name), parentId: null, index: 0 },
    },
  };
}

describe("CanonicalCanvasJournalV3", () => {
  it("publishes only after an operation-only durable append succeeds", async () => {
    const memory = createMemoryPort();
    const journal = await CanonicalCanvasJournalV3.open(seed(), memory.port);
    const listener = vi.fn();
    journal.subscribe(listener);

    const operation = await journal.commit(
      createIntent(ids.nodeA, ids.operationA, "Card"),
    );

    expect(operation.expectedRevision).toBe(0);
    expect(journal.getSnapshot().document.revision).toBe(1);
    expect(journal.getSnapshot().document.nodesById[ids.nodeA]?.name).toBe(
      "Card",
    );
    expect(memory.appends).toHaveLength(1);
    expect(Object.hasOwn(memory.appends[0]!, "document")).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it("serializes concurrent intents against the latest durable revision", async () => {
    const memory = createMemoryPort();
    const journal = await CanonicalCanvasJournalV3.open(seed(), memory.port);

    await Promise.all([
      journal.commit(createIntent(ids.nodeA, ids.operationA, "Card")),
      journal.commit(createIntent(ids.nodeB, ids.operationB, "Avatar")),
    ]);

    expect(memory.appends.map(({ operation }) => operation.expectedRevision)).toEqual([
      0, 1,
    ]);
    expect(journal.getSnapshot().document.revision).toBe(2);
    expect(Object.keys(journal.getSnapshot().document.nodesById)).toHaveLength(2);
  });

  it("keeps the prior document visible when the persistence receipt fails", async () => {
    const memory = createMemoryPort();
    memory.port.append = vi.fn(async () => {
      throw new Error("disk unavailable");
    });
    const journal = await CanonicalCanvasJournalV3.open(seed(), memory.port);

    await expect(
      journal.commit(createIntent(ids.nodeA, ids.operationA, "Card")),
    ).rejects.toThrow(/disk unavailable/i);
    expect(journal.getSnapshot()).toMatchObject({
      document: { revision: 0, nodesById: {} },
      committing: false,
      error: "disk unavailable",
    });
  });

  it("checkpoints the current V3 document without changing its revision", async () => {
    const memory = createMemoryPort();
    const journal = await CanonicalCanvasJournalV3.open(seed(), memory.port, {
      maxOperations: 1,
    });
    await journal.commit(createIntent(ids.nodeA, ids.operationA, "Card"));
    expect(journal.getSnapshot().snapshotRequired).toBe(true);

    await journal.checkpoint("2026-07-31T20:01:00.000Z");

    expect(memory.snapshots.at(-1)?.document.revision).toBe(1);
    expect(journal.getSnapshot()).toMatchObject({
      document: { revision: 1 },
      snapshotRequired: false,
    });
  });
});
