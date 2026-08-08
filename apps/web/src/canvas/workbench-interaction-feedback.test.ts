import { describe, expect, it } from "vitest";

import type { PointerGesture } from "./CanvasWorkbench.types.js";
import type { WorkbenchNode } from "./model.js";
import { workbenchInteractionFeedback } from "./workbench-interaction-feedback.js";

function node(
  id: string,
  overrides: Partial<WorkbenchNode> = {},
): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind: "Frame",
    locked: false,
    name: id,
    parentId: null,
    position: { x: 0, y: 0 },
    size: { height: 200, width: 200 },
    ...overrides,
  };
}

function moveGesture(nodes: readonly WorkbenchNode[]): PointerGesture {
  const moving = nodes[0];
  if (moving === undefined) {
    throw new Error("A moving node is required.");
  }
  return {
    camera: { x: 0, y: 0, zoom: 1 },
    duplicated: false,
    initialNodes: nodes,
    nodeIds: [moving.id],
    nodeName: moving.name,
    origin: { x: 0, y: 0 },
    pointerId: 1,
    positions: { [moving.id]: moving.position },
    type: "move",
  };
}

describe("workbench interaction feedback", () => {
  it("chooses the smallest eligible container and identifies the moving hierarchy", () => {
    const moving = node("moving", {
      kind: "Group",
      position: { x: 400, y: 400 },
    });
    const child = node("moving-child", {
      kind: "Rectangle",
      parentId: moving.id,
      position: { x: 420, y: 420 },
    });
    const outer = node("outer", { size: { height: 300, width: 300 } });
    const inner = node("inner", {
      position: { x: 20, y: 20 },
      size: { height: 100, width: 100 },
    });

    const feedback = workbenchInteractionFeedback({
      gesture: moveGesture([moving, child, outer, inner]),
      nodes: [moving, child, outer, inner],
      pointer: { x: 50, y: 50 },
    });

    expect(feedback.dropTargetId).toBe(inner.id);
    expect(feedback.movingNodeIds).toEqual([moving.id, child.id]);
    expect(Object.isFrozen(feedback.movingNodeIds)).toBe(true);
  });

  it("rejects locked, inherited-locked, source-linked, and non-container targets", () => {
    const moving = node("moving", { position: { x: 400, y: 400 } });
    const locked = node("locked", { locked: true });
    const lockedChild = node("locked-child", { parentId: locked.id });
    const sourceLinked = node("source", {
      source: {
        coverageCellId: "coverage",
        repositoryRevision: "abc123",
        routeId: "/",
        sourceAnchor: "app/index.tsx",
        stateId: "default",
        viewport: { height: 844, name: "mobile", width: 390 },
      },
    });
    const rectangle = node("rectangle", { kind: "Rectangle" });

    expect(
      workbenchInteractionFeedback({
        gesture: moveGesture([
          moving,
          locked,
          lockedChild,
          sourceLinked,
          rectangle,
        ]),
        nodes: [moving, locked, lockedChild, sourceLinked, rectangle],
        pointer: { x: 50, y: 50 },
      }).dropTargetId,
    ).toBeNull();
  });

  it("rejects a local container nested below source-authoritative evidence", () => {
    const moving = node("moving", { position: { x: 400, y: 400 } });
    const sourceParent = node("source-parent", {
      source: {
        coverageCellId: "coverage",
        repositoryRevision: "abc123",
        routeId: "/",
        sourceAnchor: "app/index.tsx",
        stateId: "default",
        viewport: { height: 844, name: "mobile", width: 390 },
      },
    });
    const localChild = node("local-child", {
      parentId: sourceParent.id,
      position: { x: 20, y: 20 },
      size: { height: 100, width: 100 },
    });

    expect(
      workbenchInteractionFeedback({
        gesture: moveGesture([moving, sourceParent, localChild]),
        nodes: [moving, sourceParent, localChild],
        pointer: { x: 50, y: 50 },
      }).dropTargetId,
    ).toBeNull();
  });

  it("returns stable empty feedback outside a move gesture", () => {
    const feedback = workbenchInteractionFeedback({
      gesture: null,
      nodes: [],
      pointer: null,
    });

    expect(feedback).toEqual({ dropTargetId: null, movingNodeIds: [] });
    expect(Object.isFrozen(feedback)).toBe(true);
  });
});
