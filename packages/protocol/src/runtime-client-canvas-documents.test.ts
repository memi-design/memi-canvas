import { describe, expect, it } from "vitest";

import {
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";

import {
  CanvasDocumentSnapshotV3Schema,
  RuntimeRpcRequestSchema,
  RuntimeRpcResponseSchema,
} from "./index.js";

const ids = {
  correlation: "cor_01J00000000000000000000000",
  document: "doc_01J00000000000000000000000",
  node: "nod_01J00000000000000000000000",
  operation: "opn_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
  project: "prj_01J00000000000000000000000",
  request: "prq_01J00000000000000000000000",
} as const;
const now = "2026-08-01T12:00:00.000Z";

function request(method: string, payload: unknown) {
  return {
    schemaVersion: 1,
    requestId: ids.request,
    correlationId: ids.correlation,
    sentAt: now,
    method,
    payload,
  };
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

describe("RuntimeClientV1 CanvasDocumentV3 journal protocol", () => {
  it("accepts exact open, load, initialize, append, and checkpoint envelopes", () => {
    const initial = snapshot();
    const operation = prepareCanvasOperationV3(initial.document, {
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
    const append = {
      schemaVersion: 1,
      kind: "canvas-document-v3-append",
      identity: initial.identity,
      operation,
    } as const;
    const journal = {
      schemaVersion: 1,
      kind: "canvas-document-v3-journal",
      identity: initial.identity,
      snapshot: initial,
      operations: [],
      operationBytes: 0,
    } as const;

    for (const candidate of [
      request("canvasDocuments.open", { snapshot: initial }),
      request("canvasDocuments.load", { identity: initial.identity }),
      request("canvasDocuments.initialize", { snapshot: initial }),
      request("canvasDocuments.append", { append }),
      request("canvasDocuments.checkpoint", { snapshot: initial }),
    ]) {
      expect(RuntimeRpcRequestSchema.safeParse(candidate).success).toBe(true);
    }

    expect(
      RuntimeRpcResponseSchema.safeParse({
        schemaVersion: 1,
        requestId: ids.request,
        correlationId: ids.correlation,
        receivedAt: now,
        method: "canvasDocuments.open",
        ok: true,
        result: { initialized: true, journal },
      }).success,
    ).toBe(true);
  });

  it("rejects document/project mismatches instead of allowing a journal identity bypass", () => {
    const initial = snapshot();
    expect(
      RuntimeRpcRequestSchema.safeParse(
        request("canvasDocuments.open", {
          snapshot: {
            ...initial,
            identity: { ...initial.identity, projectId: "prj_01J00000000000000000000001" },
          },
        }),
      ).success,
    ).toBe(false);
  });
});
