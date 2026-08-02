import { describe, expect, it } from "vitest";
import {
  CanvasDocumentSchema,
  CanvasOperationSchema,
  TraceEventSchema,
} from "../src/index.js";
import {
  canvasDocumentFixture,
  hash,
  ids,
  nextHash,
  timestamp,
  traceEventFixture,
} from "./fixtures.js";

describe("CanvasDocument", () => {
  it("accepts a hashed snapshot with a durable operation cursor", () => {
    expect(CanvasDocumentSchema.parse(canvasDocumentFixture)).toEqual(
      canvasDocumentFixture,
    );
  });

  it("rejects duplicate node IDs and non-positive frame dimensions", () => {
    expect(
      CanvasDocumentSchema.safeParse({
        ...canvasDocumentFixture,
        nodes: [
          canvasDocumentFixture.nodes[0],
          { ...canvasDocumentFixture.nodes[0], kind: "draft-frame" },
        ],
      }).success,
    ).toBe(false);
    expect(
      CanvasDocumentSchema.safeParse({
        ...canvasDocumentFixture,
        nodes: [
          {
            ...canvasDocumentFixture.nodes[0],
            size: { width: 0, height: 900 },
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("CanvasOperation", () => {
  const base = {
    schemaVersion: 1,
    id: ids.operation,
    documentId: ids.canvasDocument,
    actorId: "local-user",
    occurredAt: timestamp,
    actionDigest: hash,
    expectedBeforeHash: hash,
    resultingHash: nextHash,
  } as const;

  it.each([
    {
      ...base,
      type: "node.create",
      payload: {
        node: {
          id: ids.canvasNode,
          kind: "draft-frame",
          authority: "canvas-document",
          evidenceLevel: "proposed",
          coverageHealth: "current",
          parentId: null,
          position: { x: 10, y: 20 },
          size: { width: 320, height: 240 },
        },
      },
    },
    {
      ...base,
      type: "node.move",
      payload: {
        nodeId: ids.canvasNode,
        from: { x: 0, y: 0 },
        to: { x: 10, y: 20 },
      },
    },
    {
      ...base,
      type: "node.delete",
      payload: {
        nodeId: ids.canvasNode,
        deletedNodeHash: hash,
      },
    },
  ])("accepts the $type discriminated operation", (operation) => {
    expect(CanvasOperationSchema.parse(operation)).toEqual(operation);
  });

  it("rejects mutations without an expected-before hash", () => {
    const { expectedBeforeHash: _ignored, ...operation } = {
      ...base,
      type: "node.move",
      payload: {
        nodeId: ids.canvasNode,
        from: { x: 0, y: 0 },
        to: { x: 10, y: 20 },
      },
    } as const;

    expect(CanvasOperationSchema.safeParse(operation).success).toBe(false);
  });

  it("rejects unknown operations and extra payload keys", () => {
    expect(
      CanvasOperationSchema.safeParse({
        ...base,
        type: "shell.execute",
        payload: { command: "rm -rf" },
      }).success,
    ).toBe(false);
    expect(
      CanvasOperationSchema.safeParse({
        ...base,
        type: "node.move",
        payload: {
          nodeId: ids.canvasNode,
          from: { x: 0, y: 0 },
          to: { x: 10, y: 20 },
          providerMetadata: { hidden: true },
        },
      }).success,
    ).toBe(false);
  });
});

describe("TraceEvent", () => {
  it("accepts an append-only semantic event with integrity hashes", () => {
    expect(TraceEventSchema.parse(traceEventFixture)).toEqual(traceEventFixture);
  });

  it("rejects inline binary evidence and private-reasoning fields", () => {
    expect(
      TraceEventSchema.safeParse({
        ...traceEventFixture,
        screenshotBase64: "data:image/png;base64,AAAA",
      }).success,
    ).toBe(false);
    expect(
      TraceEventSchema.safeParse({
        ...traceEventFixture,
        chainOfThought: "private hidden reasoning",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid event families and broken hash formats", () => {
    expect(
      TraceEventSchema.safeParse({
        ...traceEventFixture,
        family: "provider.raw.secret",
      }).success,
    ).toBe(false);
    expect(
      TraceEventSchema.safeParse({
        ...traceEventFixture,
        eventHash: "not-a-content-hash",
      }).success,
    ).toBe(false);
  });
});
