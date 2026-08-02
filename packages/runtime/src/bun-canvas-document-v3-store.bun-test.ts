import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
  CanvasDocumentAppendV3Schema,
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
  BunCanvasDocumentV3JournalConflictError,
  BunSqliteCanvasDocumentV3PersistencePort,
  BunSqliteImportJobStore,
} from "./imports/bun-import-stores.js";

const directories: string[] = [];
const persistedAt = "2026-08-01T12:00:00.000Z";

const ids = {
  project: "prj_01J00000000000000000000000",
  document: "doc_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
  node: "nod_01J00000000000000000000000",
  operation: "opn_01J00000000000000000000000",
  staleOperation: "opn_01J00000000000000000000001",
} as const;

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "memi-bun-canvas-v3-store-"));
  directories.push(directory);
  return join(directory, "canvas-v3.sqlite");
}

function document() {
  return createCanvasDocumentV3({
    id: ids.document,
    projectId: ids.project,
    initialPage: { id: ids.page, kind: "design", name: "Page 1" },
  });
}

function identity(): CanvasDocumentIdentityV3 {
  return CanvasDocumentSnapshotV3Schema.shape.identity.parse({
    schemaVersion: 1,
    projectId: ids.project,
    documentId: ids.document,
  });
}

function snapshot(): CanvasDocumentSnapshotV3 {
  return CanvasDocumentSnapshotV3Schema.parse({
    schemaVersion: 1,
    kind: "canvas-document-v3-snapshot",
    identity: identity(),
    document: document(),
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

function createOperation(
  input = document(),
  operationId: string = ids.operation,
) {
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

describe("BunSqliteCanvasDocumentV3PersistencePort", () => {
  it("opens alongside the durable import tables in the shared runtime database", async () => {
    const path = databasePath();
    const imports = new BunSqliteImportJobStore(path);
    const journal = new BunSqliteCanvasDocumentV3PersistencePort(path);

    await journal.initialize(snapshot());
    expect(await journal.load(identity())).toMatchObject({
      identity: identity(),
      operations: [],
    });

    journal.close();
    imports.close();
  });

  it("initializes a WAL-backed journal, appends, and replays after restart", async () => {
    const path = databasePath();
    const first = new BunSqliteCanvasDocumentV3PersistencePort(path);
    const initial = snapshot();
    const operation = createOperation(initial.document);

    expect(first.inspect()).toMatchObject({
      foreignKeys: true,
      journalMode: "wal",
      secureDelete: true,
      synchronous: "full",
      trustedSchema: false,
    });
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
    first.close();

    const reopened = new BunSqliteCanvasDocumentV3PersistencePort(path);
    const journal = await reopened.load(initial.identity);
    expect(journal?.operations).toEqual([operation]);
    expect((journal?.operationBytes ?? 0) > 0).toBe(true);
    expect(
      applyCanvasOperationV3(journal!.snapshot.document, journal!.operations[0]!)
        .nodesById[ids.node]?.name,
    ).toBe("Card");
    reopened.close();
  });

  it("makes duplicate appends idempotent and rejects stale appends without mutation", async () => {
    const port = new BunSqliteCanvasDocumentV3PersistencePort(databasePath());
    const initial = snapshot();
    const accepted = createOperation(initial.document);
    const stale = createOperation(initial.document, ids.staleOperation);
    await port.initialize(initial);
    const receipt = await port.append({
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
        operation: accepted,
      }),
    ).resolves.toEqual(receipt);
    await expect(
      port.append({
        schemaVersion: 1,
        kind: "canvas-document-v3-append",
        identity: initial.identity,
        operation: stale,
      }),
    ).rejects.toBeInstanceOf(BunCanvasDocumentV3JournalConflictError);
    expect((await port.load(initial.identity))?.operations).toEqual([accepted]);
    port.close();
  });

  it("rejects a stale expected hash while retaining the accepted operation", async () => {
    const port = new BunSqliteCanvasDocumentV3PersistencePort(databasePath());
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
        operation: CanvasDocumentAppendV3Schema.shape.operation.parse({
          ...accepted,
          id: stale.id,
          expectedBeforeHash: `sha256:${"f".repeat(64)}`,
        }),
      }),
    ).rejects.toBeInstanceOf(BunCanvasDocumentV3JournalConflictError);
    expect((await port.load(initial.identity))?.operations).toEqual([accepted]);
    port.close();
  });
});
