import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  CanvasDocumentSnapshotV3Schema,
  CanvasNodeV3Schema,
  type CanvasDocumentIdentityV3,
  type CanvasDocumentSnapshotV3,
  type CanvasNodeV3,
} from "@memi/protocol";
import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";

import {
  CanvasDocumentV3JournalConflictError,
  SqliteCanvasDocumentV3PersistencePort,
} from "./canvas-document-v3-store.js";

const directories: string[] = [];
const persistedAt = "2026-08-01T12:00:00.000Z";

const ids = {
  project: "prj_01J00000000000000000000000",
  otherProject: "prj_01J00000000000000000000001",
  document: "doc_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
  node: "nod_01J00000000000000000000000",
  operation: "opn_01J00000000000000000000000",
  staleOperation: "opn_01J00000000000000000000001",
} as const;

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "memi-canvas-v3-store-"));
  directories.push(directory);
  return join(directory, "canvas-v3.sqlite");
}

function document(projectId: string = ids.project) {
  return createCanvasDocumentV3({
    id: ids.document,
    projectId,
    initialPage: { id: ids.page, kind: "design", name: "Page 1" },
  });
}

function identity(projectId: string = ids.project): CanvasDocumentIdentityV3 {
  return CanvasDocumentSnapshotV3Schema.shape.identity.parse({
    schemaVersion: 1,
    projectId,
    documentId: ids.document,
  });
}

function snapshot(projectId: string = ids.project): CanvasDocumentSnapshotV3 {
  const seed = document(projectId);
  return CanvasDocumentSnapshotV3Schema.parse({
    schemaVersion: 1,
    kind: "canvas-document-v3-snapshot",
    identity: identity(projectId),
    document: seed,
    persistedAt,
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

function createOperation(input = document(), operationId: string = ids.operation) {
  return prepareCanvasOperationV3(input, {
    id: operationId,
    actor: "human",
    actorId: "local-user",
    occurredAt: persistedAt,
    label: "Create card",
    action: {
      type: "node.create",
      payload: { node: node(), parentId: null, index: 0 },
    },
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLite CanvasDocumentV3 journal port", () => {
  it("atomically appends a verified operation and replays it after restart", async () => {
    const path = databasePath();
    const first = new SqliteCanvasDocumentV3PersistencePort(path);
    const initial = snapshot();
    const operation = createOperation(initial.document);

    await first.initialize(initial);
    const receipt = await first.append({
      schemaVersion: 1,
      kind: "canvas-document-v3-append",
      identity: initial.identity,
      operation,
    });

    expect(receipt).toMatchObject({
      operationId: operation.id,
      revision: 1,
      stateHash: operation.resultingHash,
    });
    await expect(
      first.append({
        schemaVersion: 1,
        kind: "canvas-document-v3-append",
        identity: initial.identity,
        operation,
      }),
    ).resolves.toEqual(receipt);
    expect(first.inspect()).toMatchObject({
      foreignKeys: true,
      journalMode: "wal",
      synchronous: "full",
      trustedSchema: false,
    });
    first.close();

    const reopened = new SqliteCanvasDocumentV3PersistencePort(path);
    const journal = await reopened.load(initial.identity);
    expect(journal?.operations).toEqual([operation]);
    expect(journal?.operationBytes).toBeGreaterThan(0);
    const restored = applyCanvasOperationV3(
      journal!.snapshot.document,
      journal!.operations[0]!,
    );
    expect(restored.nodesById[ids.node]?.name).toBe("Card");
    reopened.close();
  });

  it("rejects stale or hash-invalid appends without altering the durable journal", async () => {
    const port = new SqliteCanvasDocumentV3PersistencePort(databasePath());
    const initial = snapshot();
    const accepted = createOperation(initial.document);
    const stale = createOperation(initial.document, ids.staleOperation);
    await port.initialize(initial);
    await port.append({
      schemaVersion: 1,
      kind: "canvas-document-v3-append",
      identity: initial.identity,
      operation: accepted,
    });

    await expect(
      port.append({
        schemaVersion: 1,
        kind: "canvas-document-v3-append",
        identity: initial.identity,
        operation: stale,
      }),
    ).rejects.toBeInstanceOf(CanvasDocumentV3JournalConflictError);
    await expect(
      port.append({
        schemaVersion: 1,
        kind: "canvas-document-v3-append",
        identity: initial.identity,
        operation: {
          ...accepted,
          expectedBeforeHash: `sha256:${"f".repeat(64)}`,
        },
      }),
    ).rejects.toBeInstanceOf(CanvasDocumentV3JournalConflictError);
    expect((await port.load(initial.identity))?.operations).toEqual([accepted]);
    port.close();
  });

  it("checkpoints only the current verified state and compacts the operation journal", async () => {
    const port = new SqliteCanvasDocumentV3PersistencePort(databasePath());
    const initial = snapshot();
    const operation = createOperation(initial.document);
    const resulting = applyCanvasOperationV3(initial.document, operation);
    await port.initialize(initial);
    await port.append({
      schemaVersion: 1,
      kind: "canvas-document-v3-append",
      identity: initial.identity,
      operation,
    });
    await port.checkpoint(
      CanvasDocumentSnapshotV3Schema.parse({
        ...initial,
        document: resulting,
        persistedAt: "2026-08-01T12:01:00.000Z",
      }),
    );

    await expect(
      port.checkpoint({ ...initial, persistedAt: "2026-08-01T12:02:00.000Z" }),
    ).rejects.toBeInstanceOf(CanvasDocumentV3JournalConflictError);
    expect(await port.load(initial.identity)).toMatchObject({
      snapshot: { document: resulting },
      operations: [],
      operationBytes: 0,
    });
    port.close();
  });

  it("keeps identical document IDs isolated by their project identity and refuses replacement initialization", async () => {
    const port = new SqliteCanvasDocumentV3PersistencePort(databasePath());
    const first = snapshot();
    const second = snapshot(ids.otherProject);
    await port.initialize(first);
    await port.initialize(second);

    await expect(port.initialize(first)).resolves.toBeUndefined();
    await expect(
      port.initialize({ ...first, persistedAt: "2026-08-01T12:03:00.000Z" }),
    ).resolves.toBeUndefined();
    await expect(
      port.initialize({
        ...first,
        document: { ...first.document, revision: 1 },
      }),
    ).rejects.toBeInstanceOf(CanvasDocumentV3JournalConflictError);
    expect(await port.load(first.identity)).not.toBeNull();
    expect(await port.load(second.identity)).not.toBeNull();
    port.close();
  });

  it("rejects a legacy-shaped table instead of guessing a document-ID migration", () => {
    const path = databasePath();
    const forged = new DatabaseSync(path);
    forged.exec(`
      CREATE TABLE canvas_document_v3_snapshots (
        document_id TEXT PRIMARY KEY
      ) STRICT;
    `);
    forged.close();

    expect(() => new SqliteCanvasDocumentV3PersistencePort(path)).toThrow(
      /schema.*incompatible/iu,
    );
  });
});
