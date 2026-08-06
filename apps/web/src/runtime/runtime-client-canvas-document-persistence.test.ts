import { describe, expect, it, vi } from "vitest";

import {
  CanvasDocumentAppendReceiptV3Schema,
  type CanvasDocumentV3PersistencePort,
} from "@memi/protocol";
import {
  applyCanvasOperationV3,
  CanvasDocumentV3PersistenceAdapter,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";

import {
  createEphemeralCanvasDocumentPersistence,
  createRuntimeClientCanvasDocumentPersistence,
} from "./runtime-client-canvas-document-persistence.js";

const now = "2026-08-01T18:00:00.000Z";

function createDocument() {
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

function snapshot(document = createDocument()) {
  return {
    schemaVersion: 1 as const,
    kind: "canvas-document-v3-snapshot" as const,
    identity: {
      schemaVersion: 1 as const,
      projectId: document.projectId,
      documentId: document.id,
    },
    document,
    persistedAt: now,
  };
}

function appendFor(
  document: ReturnType<typeof createDocument>,
  operationId: string,
  pageName: string,
) {
  const pageId = document.pageIds[0]!;
  const page = document.pagesById[pageId]!;
  const operation = prepareCanvasOperationV3(document, {
    id: operationId,
    actor: "human",
    actorId: "local-user",
    occurredAt: now,
    label: `Rename ${page.name}`,
    action: {
      type: "page.define",
      payload: {
        pageId,
        next: { ...page, name: pageName },
      },
    },
  });
  return {
    schemaVersion: 1 as const,
    kind: "canvas-document-v3-append" as const,
    identity: {
      schemaVersion: 1 as const,
      projectId: document.projectId,
      documentId: document.id,
    },
    operation,
  };
}

describe("RuntimeClient CanvasDocumentV3 persistence adapter", () => {
  it("delegates the complete journal lifecycle through authenticated client methods", async () => {
    const initial = snapshot();
    const journal = {
      schemaVersion: 1 as const,
      kind: "canvas-document-v3-journal" as const,
      identity: initial.identity,
      snapshot: initial,
      operations: [],
      operationBytes: 0,
    };
    const receipt = CanvasDocumentAppendReceiptV3Schema.parse({
      schemaVersion: 1,
      identity: initial.identity,
      operationId: "opn_01J00000000000000000000000",
      revision: 1,
      stateHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const client = {
      canvasDocuments: {
        open: vi.fn(async () => ({ initialized: false, journal })),
        load: vi.fn(async () => ({ journal })),
        initialize: vi.fn(async () => ({ journal })),
        append: vi.fn(async () => ({ receipt })),
        checkpoint: vi.fn(async () => ({ journal })),
      },
    };
    const port: CanvasDocumentV3PersistencePort =
      createRuntimeClientCanvasDocumentPersistence(client);
    const append = {
      schemaVersion: 1 as const,
      kind: "canvas-document-v3-append" as const,
      identity: initial.identity,
      operation: {
        id: receipt.operationId,
        documentId: initial.document.id,
        expectedRevision: 0,
        expectedHash: initial.document.stateHash,
        resultingHash: receipt.stateHash,
      },
    } as never;

    expect(await port.load(initial.identity)).toEqual(journal);
    await port.initialize(initial);
    expect(await port.append(append)).toEqual(receipt);
    await port.checkpoint(initial);

    expect(client.canvasDocuments.load).toHaveBeenCalledWith({
      identity: initial.identity,
    });
    expect(client.canvasDocuments.initialize).toHaveBeenCalledWith({
      snapshot: initial,
    });
    expect(client.canvasDocuments.append).toHaveBeenCalledWith({ append });
    expect(client.canvasDocuments.checkpoint).toHaveBeenCalledWith({
      snapshot: initial,
    });
  });

  it("keeps the browser fallback V3-only and in memory", async () => {
    const initial = snapshot();
    const port = createEphemeralCanvasDocumentPersistence();
    const append = appendFor(
      initial.document,
      "opn_01J00000000000000000000000",
      "Saved page",
    );
    const checkpointedDocument = applyCanvasOperationV3(
      initial.document,
      append.operation,
    );

    expect(await port.load(initial.identity)).toBeNull();
    await port.initialize(initial);
    expect(await port.append(append)).toMatchObject({
      operationId: "opn_01J00000000000000000000000",
      revision: 1,
    });
    expect((await port.load(initial.identity))?.operationBytes).toBe(
      new TextEncoder().encode(JSON.stringify(append.operation)).byteLength,
    );
    await port.checkpoint(snapshot(checkpointedDocument));
    const journal = await port.load(initial.identity);
    expect(journal).toMatchObject({
      snapshot: { document: checkpointedDocument },
      operations: [],
    });
    expect(journal?.operationBytes).toBe(0);
  });

  it("rejects the stale append when concurrent authorities commit from one revision", async () => {
    const initial = snapshot();
    const port = createEphemeralCanvasDocumentPersistence();
    const first = appendFor(
      initial.document,
      "opn_01J00000000000000000000001",
      "First authority",
    );
    const second = appendFor(
      initial.document,
      "opn_01J00000000000000000000002",
      "Second authority",
    );

    await port.initialize(initial);
    const results = await Promise.allSettled([port.append(first), port.append(second)]);

    expect(results[0]).toMatchObject({ status: "fulfilled", value: { revision: 1 } });
    expect(results[1]).toMatchObject({ status: "rejected" });
    await expect(port.append(second)).rejects.toThrow(
      "Stale canvas V3 operation expected revision.",
    );
  });

  it("rejects appends with a wrong identity, state hash, or operation cursor", async () => {
    const initial = snapshot();
    const port = createEphemeralCanvasDocumentPersistence();
    const append = appendFor(
      initial.document,
      "opn_01J00000000000000000000003",
      "Fenced page",
    );

    await port.initialize(initial);
    await expect(
      port.append({
        ...append,
        identity: {
          ...append.identity,
          documentId: "doc_01J00000000000000000000001",
        },
      } as never),
    ).rejects.toThrow("Appended operation must target the bound document.");
    await expect(
      port.append({
        ...append,
        operation: {
          ...append.operation,
          expectedBeforeHash:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }),
    ).rejects.toThrow("Stale canvas V3 operation document proof.");
    await expect(
      port.append({
        ...append,
        operation: {
          ...append.operation,
          previousOperationCursor: "opn_01J00000000000000000000004" as never,
        },
      }),
    ).rejects.toThrow("Stale canvas V3 operation document proof.");
  });

  it("compacts the checkpointed journal so the canonical adapter can reopen it", async () => {
    const initial = snapshot();
    const port = createEphemeralCanvasDocumentPersistence();
    const append = appendFor(
      initial.document,
      "opn_01J00000000000000000000005",
      "Checkpointed page",
    );
    const checkpointedDocument = applyCanvasOperationV3(
      initial.document,
      append.operation,
    );

    await port.initialize(initial);
    await port.append(append);
    await port.checkpoint(snapshot(checkpointedDocument));

    expect(await port.load(initial.identity)).toMatchObject({
      snapshot: { document: checkpointedDocument },
      operations: [],
      operationBytes: 0,
    });
    await expect(
      CanvasDocumentV3PersistenceAdapter.open(initial.document, port),
    ).resolves.toMatchObject({ document: checkpointedDocument });
  });

  it("rejects a stale checkpoint without erasing the newer replayable append", async () => {
    const initial = snapshot();
    const port = createEphemeralCanvasDocumentPersistence();
    const append = appendFor(
      initial.document,
      "opn_01J00000000000000000000006",
      "Newer page",
    );
    const currentDocument = applyCanvasOperationV3(
      initial.document,
      append.operation,
    );

    await port.initialize(initial);
    await port.append(append);
    await expect(port.checkpoint(initial)).rejects.toThrow("checkpoint is stale");

    expect(await port.load(initial.identity)).toMatchObject({
      snapshot: initial,
      operations: [expect.objectContaining({ id: append.operation.id })],
    });
    await expect(
      CanvasDocumentV3PersistenceAdapter.open(initial.document, port),
    ).resolves.toMatchObject({ document: currentDocument });
  });
});
