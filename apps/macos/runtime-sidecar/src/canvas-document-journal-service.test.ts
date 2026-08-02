// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CanvasDocumentSnapshotV3Schema,
  CanvasDocumentAppendReceiptV3Schema,
  type CanvasDocumentAppendReceiptV3,
  type CanvasDocumentV3PersistencePort,
} from "@memi/protocol";
import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";
import { SqliteCanvasDocumentV3PersistencePort } from "@memi/runtime";

import { createCanvasDocumentJournalRpcService } from "./canvas-document-journal-service.js";

const directories: string[] = [];
const ids = {
  document: "doc_01J00000000000000000000000",
  node: "nod_01J00000000000000000000000",
  operation: "opn_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
  project: "prj_01J00000000000000000000000",
} as const;
const now = "2026-08-01T12:00:00.000Z";

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "memi-sidecar-v3-journal-"));
  directories.push(directory);
  return join(directory, "runtime.sqlite");
}

function snapshot() {
  const document = createCanvasDocumentV3({
    id: ids.document,
    projectId: ids.project,
    initialPage: { id: ids.page, kind: "design", name: "Page 1" },
  });
  return CanvasDocumentSnapshotV3Schema.parse({
    schemaVersion: 1,
    kind: "canvas-document-v3-snapshot",
    identity: {
      schemaVersion: 1,
      projectId: ids.project,
      documentId: ids.document,
    },
    document,
    persistedAt: now,
  });
}

function operation(initial = snapshot()) {
  return prepareCanvasOperationV3(initial.document, {
    id: ids.operation,
    actor: "human",
    actorId: "local-user",
    occurredAt: now,
    label: "Create card",
    action: {
      type: "node.create",
      payload: {
        node: {
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
        },
        parentId: null,
        index: 0,
      },
    },
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("CanvasDocumentV3 sidecar journal service", () => {
  it("opens once, appends, checkpoints, and restores the same identity after restart", async () => {
    const path = databasePath();
    const firstPort = new SqliteCanvasDocumentV3PersistencePort(path);
    const first = createCanvasDocumentJournalRpcService({ port: firstPort });
    const initial = snapshot();
    const opened = await first.open({ snapshot: initial });
    const append = {
      schemaVersion: 1 as const,
      kind: "canvas-document-v3-append" as const,
      identity: initial.identity,
      operation: operation(initial),
    };

    expect(opened.initialized).toBe(true);
    await expect(first.append({ append })).resolves.toMatchObject({
      receipt: {
        identity: initial.identity,
        operationId: ids.operation,
        revision: 1,
      },
    });
    const resulting = applyCanvasOperationV3(initial.document, append.operation);
    const checkpoint = await first.checkpoint({
      snapshot: {
        ...initial,
        document: resulting,
        persistedAt: "2026-08-01T12:01:00.000Z",
      },
    });
    expect(checkpoint.journal.operations).toEqual([]);
    firstPort.close();

    const reopenedPort = new SqliteCanvasDocumentV3PersistencePort(path);
    const reopened = createCanvasDocumentJournalRpcService({ port: reopenedPort });
    await expect(reopened.load({ identity: initial.identity })).resolves.toMatchObject({
      journal: { identity: initial.identity },
    });
    reopenedPort.close();
  });

  it("rejects a bad append receipt instead of returning a forged durable revision", async () => {
    const initial = snapshot();
    const append = {
      schemaVersion: 1 as const,
      kind: "canvas-document-v3-append" as const,
      identity: initial.identity,
      operation: operation(initial),
    };
    const badReceipt: CanvasDocumentAppendReceiptV3 = CanvasDocumentAppendReceiptV3Schema.parse({
      schemaVersion: 1,
      identity: initial.identity,
      operationId: "opn_01J00000000000000000000001",
      revision: 1,
      stateHash: append.operation.resultingHash,
    });
    const port: CanvasDocumentV3PersistencePort = {
      async load() {
        return null;
      },
      async initialize() {},
      async append() {
        return badReceipt;
      },
      async checkpoint() {},
    };
    const service = createCanvasDocumentJournalRpcService({ port });

    await expect(service.append({ append })).rejects.toThrow(
      /receipt.*identity|receipt.*operation/iu,
    );
  });
});
