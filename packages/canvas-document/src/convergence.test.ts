import { describe, expect, it } from "vitest";

import {
  applyCanvasOperation,
  compileScreenMatrixOperations,
  createCanvasDocument,
  hashCanvasDocument,
  prepareNodeCreateOperation,
} from "./index.js";

const ids = {
  project: "prj_01J00000000000000000000000",
  document: "doc_01J00000000000000000000000",
  route: "rte_01J00000000000000000000000",
  state: "sta_01J00000000000000000000000",
  coverage: "cov_01J00000000000000000000000",
  node: "nod_01J00000000000000000000000",
  operation: "opn_01J00000000000000000000000",
} as const;

describe("canonical canvas execution", () => {
  it("prepares and applies a protocol-valid semantic operation", () => {
    const document = createCanvasDocument({
      id: ids.document,
      projectId: ids.project,
    });
    const operation = prepareNodeCreateOperation(document, {
      id: ids.operation,
      actorId: "local-user",
      occurredAt: "2026-07-28T12:00:00.000Z",
      node: {
        id: ids.node,
        kind: "code-frame",
        authority: "product-source",
        evidenceLevel: "inferred",
        coverageHealth: "partial",
        parentId: null,
        position: { x: 0, y: 0 },
        size: { width: 1440, height: 900 },
        source: {
          routeId: ids.route,
          stateId: ids.state,
          coverageCellId: ids.coverage,
        },
      },
    });

    const applied = applyCanvasOperation(document, operation);

    expect(document.nodes).toEqual([]);
    expect(applied.revision).toBe(1);
    expect(applied.operationCursor).toBe(ids.operation);
    expect(applied.stateHash).toBe(operation.resultingHash);
    expect(hashCanvasDocument(applied)).toBe(operation.resultingHash);
  });

  it("rejects an idempotency-key reuse with a different action digest", () => {
    const document = createCanvasDocument({
      id: ids.document,
      projectId: ids.project,
    });
    const operation = prepareNodeCreateOperation(document, {
      id: ids.operation,
      actorId: "local-user",
      occurredAt: "2026-07-28T12:00:00.000Z",
      node: {
        id: ids.node,
        kind: "draft-frame",
        authority: "canvas-document",
        evidenceLevel: "proposed",
        coverageHealth: "current",
        parentId: null,
        position: { x: 0, y: 0 },
        size: { width: 320, height: 240 },
      },
    });
    const applied = applyCanvasOperation(document, operation);

    expect(() =>
      applyCanvasOperation(applied, {
        ...operation,
        actionDigest: `sha256:${"f".repeat(64)}`,
      }),
    ).toThrow(/idempotency|digest/i);
  });

  it("rejects a duplicate operation with a forged resulting hash", () => {
    const document = createCanvasDocument({
      id: ids.document,
      projectId: ids.project,
    });
    const operation = prepareNodeCreateOperation(document, {
      id: ids.operation,
      actorId: "local-user",
      occurredAt: "2026-07-28T12:00:00.000Z",
      node: {
        id: ids.node,
        kind: "draft-frame",
        authority: "canvas-document",
        evidenceLevel: "proposed",
        coverageHealth: "current",
        parentId: null,
        position: { x: 0, y: 0 },
        size: { width: 320, height: 240 },
      },
    });
    const applied = applyCanvasOperation(document, operation);

    expect(() =>
      applyCanvasOperation(applied, {
        ...operation,
        resultingHash: `sha256:${"e".repeat(64)}`,
      }),
    ).toThrow(/idempotency|resulting hash/i);
  });

  it("compiles a responsive matrix into ordered semantic operations", () => {
    const document = createCanvasDocument({
      id: ids.document,
      projectId: ids.project,
    });
    const operations = compileScreenMatrixOperations(document, {
      actorId: "import-compiler",
      occurredAt: "2026-07-28T12:00:00.000Z",
      cells: [
        {
          nodeId: ids.node,
          operationId: ids.operation,
          routeId: ids.route,
          stateId: ids.state,
          coverageCellId: ids.coverage,
          viewport: { name: "desktop", width: 1440, height: 900 },
          evidenceLevel: "inferred",
          coverageHealth: "partial",
        },
      ],
    });

    expect(operations).toHaveLength(1);
    expect(operations[0]?.type).toBe("node.create");
    expect(operations[0]?.expectedBeforeHash).toBe(document.stateHash);
    expect(operations[0]?.resultingHash).not.toBe(document.stateHash);
  });
});
