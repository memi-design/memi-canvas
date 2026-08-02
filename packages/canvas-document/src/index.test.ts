import { describe, expect, it } from "vitest";

import {
  applyCanvasOperation,
  createCanvasDocument,
  hashCanvasDocument,
  materializeScreenMatrix,
  prepareNodeCreateOperation,
} from "./index.js";

const ids = {
  project: "prj_01J00000000000000000000000",
  document: "doc_01J00000000000000000000000",
  route: "rte_01J00000000000000000000000",
  state: "sta_01J00000000000000000000000",
  coverage: [
    "cov_01J00000000000000000000000",
    "cov_01J00000000000000000000001",
    "cov_01J00000000000000000000002",
  ],
  node: [
    "nod_01J00000000000000000000000",
    "nod_01J00000000000000000000001",
    "nod_01J00000000000000000000002",
  ],
  operation: [
    "opn_01J00000000000000000000000",
    "opn_01J00000000000000000000001",
    "opn_01J00000000000000000000002",
  ],
} as const;

function draftNode(id = ids.node[0]) {
  return {
    id,
    kind: "draft-frame" as const,
    authority: "canvas-document" as const,
    evidenceLevel: "proposed" as const,
    coverageHealth: "current" as const,
    parentId: null,
    position: { x: 0, y: 0 },
    size: { width: 320, height: 240 },
  };
}

describe("canvas document", () => {
  it("applies canonical operations immutably and deterministically", () => {
    const original = createCanvasDocument({
      id: ids.document,
      projectId: ids.project,
    });
    const operation = prepareNodeCreateOperation(original, {
      id: ids.operation[0],
      actorId: "local-user",
      occurredAt: "2026-07-28T12:00:00.000Z",
      node: draftNode(),
    });

    const first = applyCanvasOperation(original, operation);

    expect(original.nodes).toEqual([]);
    expect(first.nodes).toHaveLength(1);
    expect(first.stateHash).toBe(hashCanvasDocument(first));
    expect(applyCanvasOperation(first, operation)).toEqual(first);
  });

  it("fails closed for stale, corrupt, and overwriting operations", () => {
    const original = createCanvasDocument({
      id: ids.document,
      projectId: ids.project,
    });
    const operation = prepareNodeCreateOperation(original, {
      id: ids.operation[0],
      actorId: "local-user",
      occurredAt: "2026-07-28T12:00:00.000Z",
      node: draftNode(),
    });
    const applied = applyCanvasOperation(original, operation);

    expect(() =>
      applyCanvasOperation(original, {
        ...operation,
        expectedBeforeHash: `sha256:${"e".repeat(64)}`,
      }),
    ).toThrow(/digest|stale/i);
    expect(() =>
      applyCanvasOperation(applied, {
        ...prepareNodeCreateOperation(applied, {
          id: ids.operation[1],
          actorId: "local-user",
          occurredAt: "2026-07-28T12:00:01.000Z",
          node: draftNode(),
        }),
      }),
    ).toThrow(/already exists/i);
  });

  it("materializes desktop, tablet, and mobile through semantic operations", () => {
    const original = createCanvasDocument({
      id: ids.document,
      projectId: ids.project,
    });
    const viewports = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "tablet", width: 834, height: 1112 },
      { name: "mobile", width: 390, height: 844 },
    ] as const;
    const result = materializeScreenMatrix(original, {
      actorId: "import-compiler",
      occurredAt: "2026-07-28T12:00:00.000Z",
      cells: viewports.map((viewport, index) => ({
        nodeId: ids.node[index]!,
        operationId: ids.operation[index]!,
        routeId: ids.route,
        stateId: ids.state,
        coverageCellId: ids.coverage[index]!,
        viewport,
        evidenceLevel: "inferred" as const,
        coverageHealth: "partial" as const,
      })),
    });

    expect(result.operations).toHaveLength(3);
    expect(result.document.revision).toBe(3);
    expect(result.document.nodes.map((node) => node.viewport?.name)).toEqual([
      "desktop",
      "tablet",
      "mobile",
    ]);
    expect(result.document.appliedOperations).toHaveLength(3);
  });
});
