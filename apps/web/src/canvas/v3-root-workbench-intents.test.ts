import { describe, expect, it } from "vitest";

import {
  CanvasPageIdSchema,
  type CanvasPageId,
} from "@memi/protocol";
import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";

import {
  createRootWorkbenchIntentV3,
  moveRootWorkbenchIntentV3,
} from "./v3-root-workbench-intents.js";
import type { WorkbenchNode } from "./model.js";

const ids = {
  document: "doc_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
  project: "prj_01J00000000000000000000000",
} as const;

const pageId: CanvasPageId = CanvasPageIdSchema.parse(ids.page);

function document() {
  return createCanvasDocumentV3({
    id: ids.document,
    initialPage: { id: pageId, kind: "design", name: "Mobile" },
    projectId: ids.project,
  });
}

function rectangle(overrides: Partial<WorkbenchNode> = {}): WorkbenchNode {
  return {
    hidden: false,
    id: "draft-rectangle",
    kind: "Rectangle",
    locked: false,
    name: "Primary card",
    parentId: null,
    position: { x: 40, y: 56 },
    size: { height: 80, width: 240 },
    ...overrides,
  };
}

describe("V3 root workbench intents", () => {
  it("adapts a root-level rectangle create into a V3 intent with stable trace and selection metadata", () => {
    const source = rectangle({ fill: "oklch(0.67 0.2 12)" });
    const result = createRootWorkbenchIntentV3({
      document: document(),
      pageId,
      node: source,
    });

    expect(result.action).toMatchObject({
      type: "node.create",
      payload: {
        index: 0,
        parentId: null,
        node: {
          kind: "rectangle",
          name: "Primary card",
          pageId: ids.page,
          parentId: null,
          transform: { x: 40, y: 56, rotation: 0, scaleX: 1, scaleY: 1 },
          geometry: { height: 80, width: 240 },
          style: {
            fills: [{ color: "oklch(0.67 0.2 12)", type: "solid" }],
          },
        },
      },
    });
    expect(result.metadata).toMatchObject({
      selectionAfter: {
        anchorId: result.targetId,
        focusedId: result.targetId,
        selectedIds: [result.targetId],
      },
      trace: {
        adapter: "v3-root-workbench-intents",
        documentId: ids.document,
        expectedRevision: 0,
        expectedStateHash: document().stateHash,
        pageId: ids.page,
        targetIds: [result.targetId],
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.action)).toBe(true);
    expect(Object.isFrozen(result.action.payload)).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(source).toEqual(rectangle({ fill: "oklch(0.67 0.2 12)" }));
  });

  it("adapts a root-level move using the current V3 transform and preserves scale", () => {
    const initial = document();
    const create = createRootWorkbenchIntentV3({
      document: initial,
      pageId,
      node: rectangle(),
    });
    const created = prepareCanvasOperationV3(initial, {
      action: create.action,
      actor: "human",
      actorId: "local-user",
      id: "opn_01J00000000000000000000000",
      label: "Create primary card",
      occurredAt: "2026-08-01T12:00:00.000Z",
    });
    const current = applyCanvasOperationV3(initial, created);
    const result = moveRootWorkbenchIntentV3({
      document: current,
      pageId,
      node: rectangle({
        id: create.targetId,
        position: { x: 144, y: 212 },
        rotation: 45,
      }),
    });

    expect(result.action).toEqual({
      type: "node.transform",
      payload: {
        nodeId: create.targetId,
        next: { x: 144, y: 212, rotation: 45, scaleX: 1, scaleY: 1 },
      },
    });
    expect(result.metadata.selectionAfter.selectedIds).toEqual([create.targetId]);
    expect(result.metadata.trace.expectedRevision).toBe(1);
  });

  it("rejects nested workbench input instead of silently changing V3 hierarchy", () => {
    expect(() =>
      createRootWorkbenchIntentV3({
        document: document(),
        pageId,
        node: rectangle({ parentId: "legacy-parent" }),
      }),
    ).toThrow("root-level");
  });

  it("rejects moving a V3 child through the root-only adapter", () => {
    const initial = document();
    const parent = createRootWorkbenchIntentV3({
      document: initial,
      pageId,
      node: rectangle({ id: "parent", kind: "Frame" }),
    });
    const afterParent = applyCanvasOperationV3(
      initial,
      prepareCanvasOperationV3(initial, {
        action: parent.action,
        actor: "human",
        actorId: "local-user",
        id: "opn_01J00000000000000000000001",
        label: "Create parent",
        occurredAt: "2026-08-01T12:00:00.000Z",
      }),
    );
    const childId = "nod_01J00000000000000000000000";
    const child = {
      ...afterParent.nodesById[parent.targetId]!,
      childIds: [],
      id: childId,
      name: "Child",
      parentId: parent.targetId,
    };
    const withChild = applyCanvasOperationV3(
      afterParent,
      prepareCanvasOperationV3(afterParent, {
        action: {
          type: "node.create",
          payload: { index: 0, node: child, parentId: parent.targetId },
        },
        actor: "human",
        actorId: "local-user",
        id: "opn_01J00000000000000000000002",
        label: "Create child",
        occurredAt: "2026-08-01T12:00:00.000Z",
      }),
    );

    expect(() =>
      moveRootWorkbenchIntentV3({
        document: withChild,
        pageId,
        node: rectangle({ id: childId }),
      }),
    ).toThrow("root-level");
  });
});
