import { describe, expect, it, vi } from "vitest";

import {
  CanvasDocumentAppendReceiptV3Schema,
  type CanvasDocumentV3PersistencePort,
} from "@memi/protocol";
import { createCanvasDocumentV3 } from "@memi/canvas-document";

import {
  createEphemeralCanvasDocumentPersistence,
  createRuntimeClientCanvasDocumentPersistence,
} from "./runtime-client-canvas-document-persistence.js";

const now = "2026-08-01T18:00:00.000Z";

function snapshot() {
  const document = createCanvasDocumentV3({
    id: "doc_01J00000000000000000000000",
    projectId: "prj_01J00000000000000000000000",
    initialPage: {
      id: "pag_01J00000000000000000000000",
      kind: "design",
      name: "Page 1",
    },
  });
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
    const operation = {
      id: "opn_01J00000000000000000000000",
      documentId: initial.document.id,
      expectedRevision: 0,
      expectedHash: initial.document.stateHash,
      resultingHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const append = {
      schemaVersion: 1 as const,
      kind: "canvas-document-v3-append" as const,
      identity: initial.identity,
      operation,
    } as never;

    expect(await port.load(initial.identity)).toBeNull();
    await port.initialize(initial);
    expect(await port.append(append)).toMatchObject({
      operationId: "opn_01J00000000000000000000000",
      revision: 1,
    });
    await port.checkpoint(initial);
    const journal = await port.load(initial.identity);
    expect(journal).toMatchObject({
      snapshot: initial,
      operations: [
        expect.objectContaining({
          id: "opn_01J00000000000000000000000",
        }),
      ],
    });
    expect(journal?.operationBytes).toBe(
      new TextEncoder().encode(JSON.stringify(operation)).byteLength,
    );
  });
});
