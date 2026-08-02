import { describe, expect, it } from "vitest";

import {
  CanvasDocumentV3Schema,
  CanvasDocumentV2Schema,
  CanvasNodeV3Schema,
  type CanvasNodeV3,
} from "@memi/protocol";

import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  hashCanvasDocumentV3,
  invertCanvasOperationV3,
  migrateCanvasDocumentV2ToV3,
  prepareCanvasOperationV3,
  revertCanvasOperationV3,
} from "./v3.js";

const ids = {
  project: "prj_01J00000000000000000000000",
  document: "doc_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
  node: "nod_01J00000000000000000000000",
  operation: [
    "opn_01J00000000000000000000000",
    "opn_01J00000000000000000000001",
    "opn_01J00000000000000000000002",
  ],
  component: "cmp_01J00000000000000000000000",
} as const;

function node(pageId: string = ids.page): CanvasNodeV3 {
  return CanvasNodeV3Schema.parse({
    id: ids.node,
    pageId: pageId as CanvasNodeV3["pageId"],
    kind: "rectangle",
    name: "Hero surface",
    parentId: null,
    childIds: [],
    transform: { x: 24, y: 24, rotation: 0, scaleX: 1, scaleY: 1 },
    geometry: { width: 320, height: 240 },
    style: {
      opacity: 1,
      visible: true,
      locked: false,
      fills: [{ type: "solid", color: "oklch(0.7 0.2 18)" }],
      strokes: [],
      cornerRadii: [12, 12, 12, 12],
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

describe("CanvasDocumentV3 engine", () => {
  it("creates a deeply immutable normalized document", () => {
    const document = createCanvasDocumentV3({
      id: ids.document,
      projectId: ids.project,
      initialPage: { id: ids.page, kind: "design", name: "Page 1" },
    });

    expect(CanvasDocumentV3Schema.parse(document)).toEqual(document);
    expect(hashCanvasDocumentV3(document)).toBe(document.stateHash);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.pagesById[ids.page])).toBe(true);
  });

  it("prepares, applies, and inverts one semantic operation without mutating input", () => {
    const empty = createCanvasDocumentV3({
      id: ids.document,
      projectId: ids.project,
      initialPage: { id: ids.page, kind: "design", name: "Page 1" },
    });
    const create = prepareCanvasOperationV3(empty, {
      id: ids.operation[0],
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-31T12:00:00.000Z",
      label: "Create hero surface",
      action: {
        type: "node.create",
        payload: { node: node(), parentId: null, index: 0 },
      },
    });
    const created = applyCanvasOperationV3(empty, create);

    expect(empty.nodesById).toEqual({});
    expect(created.nodesById[ids.node]).toEqual(node());
    expect(created.pagesById[ids.page]?.rootIds).toEqual([ids.node]);
    expect(created.revision).toBe(1);
    expect(create.inverseAction.type).toBe("node.delete");

    const reverted = revertCanvasOperationV3(created, create);
    expect(reverted.stateHash).toBe(empty.stateHash);
    expect(() =>
      revertCanvasOperationV3(
        { ...created, operationCursor: null },
        create,
      ),
    ).toThrow(/exact resulting/i);

    const inverse = invertCanvasOperationV3(created, create, {
      id: ids.operation[1],
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-31T12:00:01.000Z",
    });
    const restored = applyCanvasOperationV3(created, inverse);
    expect(restored.nodesById).toEqual(empty.nodesById);
    expect(restored.pagesById[ids.page]?.rootIds).toEqual([]);
    expect(inverse.undoOf).toBe(create.id);
  });

  it("rejects stale revision preconditions even when the content hash is reused", () => {
    const empty = createCanvasDocumentV3({
      id: ids.document,
      projectId: ids.project,
      initialPage: { id: ids.page, kind: "design", name: "Page 1" },
    });
    const operation = prepareCanvasOperationV3(empty, {
      id: ids.operation[0],
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-31T12:00:00.000Z",
      label: "Create hero surface",
      action: {
        type: "node.create",
        payload: { node: node(), parentId: null, index: 0 },
      },
    });
    expect(() =>
      applyCanvasOperationV3(empty, { ...operation, expectedRevision: 1 }),
    ).toThrow(/revision/i);
  });

  it("targets the page when a root sibling order changes", () => {
    const empty = createCanvasDocumentV3({
      id: ids.document,
      projectId: ids.project,
      initialPage: { id: ids.page, kind: "design", name: "Page 1" },
    });
    const create = prepareCanvasOperationV3(empty, {
      id: ids.operation[0],
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-31T12:00:00.000Z",
      label: "Create hero surface",
      action: {
        type: "node.create",
        payload: { node: node(), parentId: null, index: 0 },
      },
    });
    const created = applyCanvasOperationV3(empty, create);
    const reorder = prepareCanvasOperationV3(created, {
      id: ids.operation[1],
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-31T12:00:01.000Z",
      label: "Reorder root layers",
      action: {
        type: "node.reorder",
        payload: { pageId: ids.page, parentId: null, nextOrder: [ids.node] },
      },
    });

    expect(reorder.targetIds).toEqual([ids.page]);
  });

  it("records node renames as exact semantic operations", () => {
    const empty = createCanvasDocumentV3({
      id: ids.document,
      projectId: ids.project,
      initialPage: { id: ids.page, kind: "design", name: "Page 1" },
    });
    const create = prepareCanvasOperationV3(empty, {
      id: ids.operation[0],
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-08-02T12:00:00.000Z",
      label: "Create hero surface",
      action: {
        type: "node.create",
        payload: { node: node(), parentId: null, index: 0 },
      },
    });
    const created = applyCanvasOperationV3(empty, create);
    const rename = prepareCanvasOperationV3(created, {
      id: ids.operation[1],
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-08-02T12:00:01.000Z",
      label: "Rename hero surface",
      action: {
        type: "node.name",
        payload: { nodeId: ids.node, next: "Renamed hero surface" },
      },
    });
    const renamed = applyCanvasOperationV3(created, rename);

    expect(rename.targetIds).toEqual([ids.node]);
    expect(rename.inverseAction).toMatchObject({
      type: "node.name",
      payload: { prior: "Renamed hero surface", next: "Hero surface" },
    });
    expect(renamed.nodesById[ids.node]?.name).toBe("Renamed hero surface");
  });

  it("migrates V2 deterministically without losing hierarchy, components, or tokens", () => {
    const { pageId: _pageId, ...legacyNode } = node();
    const legacy = CanvasDocumentV2Schema.parse({
      schemaVersion: 2,
      id: ids.document,
      projectId: ids.project,
      revision: 4,
      stateHash: `sha256:${"9".repeat(64)}`,
      operationCursor: ids.operation[2],
      rootIds: [ids.node],
      nodesById: { [ids.node]: legacyNode },
      componentsById: {},
      tokensById: {
        ruby: {
          id: "ruby",
          name: "Ruby",
          type: "color",
          value: "oklch(0.7 0.2 18)",
        },
      },
    });
    const first = migrateCanvasDocumentV2ToV3(legacy);
    const repeated = migrateCanvasDocumentV2ToV3(legacy);

    expect(first).toEqual(repeated);
    expect(first.strategy).toBe("canvas-document-v2-to-v3");
    expect(first.sourceStateHash).toBe(legacy.stateHash);
    expect(first.document.revision).toBe(legacy.revision);
    expect(first.document.pageIds).toHaveLength(1);
    const pageId = first.document.pageIds[0]!;
    expect(first.document.pagesById[pageId]?.rootIds).toEqual([ids.node]);
    expect(first.document.nodesById[ids.node]?.pageId).toBe(pageId);
    expect(first.document.variablesById.ruby?.valuesByMode.default).toBe(
      "oklch(0.7 0.2 18)",
    );
    expect(first.targetStateHash).toBe(first.document.stateHash);
    expect(Object.isFrozen(first.document.nodesById[ids.node])).toBe(true);
  });

  it("preserves a valid V2 component definition whose root predates component node kinds", () => {
    const { pageId: _pageId, ...legacyNode } = node();
    const legacy = CanvasDocumentV2Schema.parse({
      schemaVersion: 2,
      id: ids.document,
      projectId: ids.project,
      revision: 0,
      stateHash: `sha256:${"8".repeat(64)}`,
      operationCursor: null,
      rootIds: [ids.node],
      nodesById: { [ids.node]: legacyNode },
      componentsById: {
        [ids.component]: {
          id: ids.component,
          name: "Legacy card",
          rootNodeId: ids.node,
          propertyKeys: ["label"],
        },
      },
      tokensById: {},
    });

    const migrated = migrateCanvasDocumentV2ToV3(legacy);

    expect(migrated.document.nodesById[ids.node]?.kind).toBe("rectangle");
    expect(migrated.document.componentsById[ids.component]?.rootNodeId).toBe(
      ids.node,
    );
    expect(
      migrated.document.componentsById[ids.component]?.propertyDefinitions.label,
    ).toEqual({ type: "unknown", defaultValue: null });
  });
});
