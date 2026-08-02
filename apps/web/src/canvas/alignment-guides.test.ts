import { describe, expect, it } from "vitest";

import { computeAlignmentSnap } from "./alignment-guides.js";
import type { WorkbenchNode } from "./model.js";

function rectangle(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 100,
): WorkbenchNode {
  return {
    id,
    kind: "Rectangle",
    name: id,
    parentId: null,
    position: { x, y },
    size: { width, height },
    locked: false,
    hidden: false,
    fill: "white",
  };
}

describe("alignment guides", () => {
  it("snaps matching centers and returns visible world-space guides", () => {
    const moving = rectangle("moving", 0, 0);
    const target = rectangle("target", 200, 300);

    expect(
      computeAlignmentSnap({
        delta: { x: 198, y: 298 },
        movingNodes: [moving],
        sceneNodes: [moving, target],
        threshold: 4,
      }),
    ).toEqual({
      delta: { x: 200, y: 300 },
      guides: {
        horizontal: [300, 350, 400],
        vertical: [200, 250, 300],
      },
    });
  });

  it("does not snap or emit guides outside the threshold", () => {
    const moving = rectangle("moving", 0, 0);
    const target = rectangle("target", 200, 300);

    expect(
      computeAlignmentSnap({
        delta: { x: 180, y: 280 },
        movingNodes: [moving],
        sceneNodes: [moving, target],
        threshold: 4,
      }),
    ).toEqual({
      delta: { x: 180, y: 280 },
      guides: { horizontal: [], vertical: [] },
    });
  });

  it("falls back to the document grid when no object alignment is in range", () => {
    const moving = rectangle("moving", 10, 10, 40, 40);
    const target = rectangle("target", 200, 300);

    expect(
      computeAlignmentSnap({
        delta: { x: 9, y: 21 },
        gridSize: 16,
        movingNodes: [moving],
        sceneNodes: [moving, target],
        threshold: 4,
      }),
    ).toEqual({
      delta: { x: 6, y: 22 },
      guides: { horizontal: [], vertical: [] },
    });
  });

  it("prefers a nearby object edge over the grid and emits that guide", () => {
    const moving = rectangle("moving", 10, 10, 40, 40);
    const target = rectangle("target", 96, 200, 40, 40);

    expect(
      computeAlignmentSnap({
        delta: { x: 43, y: 21 },
        gridSize: 16,
        movingNodes: [moving],
        sceneNodes: [moving, target],
        threshold: 4,
      }),
    ).toEqual({
      delta: { x: 46, y: 22 },
      guides: { horizontal: [], vertical: [96] },
    });
  });

  it("does not snap a child back to its own ancestor", () => {
    const group = {
      ...rectangle("group", 0, 0, 200, 200),
      kind: "Group" as const,
    };
    const child = {
      ...rectangle("child", 0, 0, 40, 40),
      parentId: "group",
    };

    expect(
      computeAlignmentSnap({
        delta: { x: 3, y: 3 },
        movingNodes: [child],
        sceneNodes: [group, child],
        threshold: 6,
      }),
    ).toEqual({
      delta: { x: 3, y: 3 },
      guides: { horizontal: [], vertical: [] },
    });
  });
});
