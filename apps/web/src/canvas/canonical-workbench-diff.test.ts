import { describe, expect, it } from "vitest";

import type { WorkbenchNode } from "./model.js";
import {
  applyWorkbenchProjectionActions,
  diffWorkbenchProjections,
} from "./canonical-workbench-diff.js";

function rectangle(
  id: string,
  parentId: string | null,
  x: number,
  y: number,
): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind: "Rectangle",
    locked: false,
    name: id,
    parentId,
    position: { x, y },
    size: { height: 40, width: 60 },
  };
}

describe("canonical workbench projection diff", () => {
  it("compiles move and resize into narrow semantic actions", () => {
    const before = [rectangle("card", null, 20, 30)];
    const after = [
      {
        ...before[0]!,
        position: { x: 84, y: 96 },
        size: { height: 80, width: 240 },
      },
    ];

    const actions = diffWorkbenchProjections(before, after);

    expect(actions).toEqual([
      {
        payload: {
          next: { rotation: 0, x: 84, y: 96 },
          nodeId: "card",
        },
        type: "node.transform",
      },
      {
        payload: {
          next: { height: 80, width: 240 },
          nodeId: "card",
        },
        type: "node.geometry",
      },
    ]);
    expect(applyWorkbenchProjectionActions(before, actions)).toEqual(after);
  });

  it("compiles grouping and framing into create and reparent actions", () => {
    const before = [
      rectangle("a", null, 100, 80),
      rectangle("b", null, 180, 120),
    ];
    const group: WorkbenchNode = {
      ...rectangle("group", null, 100, 80),
      kind: "Group",
      size: { height: 80, width: 140 },
    };
    const after = [
      group,
      { ...before[0]!, parentId: group.id },
      { ...before[1]!, parentId: group.id },
    ];

    const actions = diffWorkbenchProjections(before, after);

    expect(actions.map(({ type }) => type)).toEqual([
      "node.create",
      "node.reparent",
      "node.reparent",
    ]);
    expect(actions).not.toContainEqual(
      expect.objectContaining({ type: "node.replace" }),
    );
    expect(applyWorkbenchProjectionActions(before, actions)).toEqual(after);
  });

  it("compiles pasted hierarchies parent-first and deletion child-first", () => {
    const before: readonly WorkbenchNode[] = [];
    const frame: WorkbenchNode = {
      ...rectangle("frame", null, 20, 30),
      kind: "Frame",
      size: { height: 320, width: 480 },
    };
    const child = rectangle("photo", frame.id, 36, 46);
    const pasted = [frame, child];

    const create = diffWorkbenchProjections(before, pasted);
    expect(create.map(({ type }) => type)).toEqual([
      "node.create",
      "node.create",
    ]);
    expect(
      create.map((action) =>
        action.type === "node.create" ? action.payload.node.id : null,
      ),
    ).toEqual(["frame", "photo"]);
    expect(applyWorkbenchProjectionActions(before, create)).toEqual(pasted);

    const remove = diffWorkbenchProjections(pasted, []);
    expect(
      remove.map((action) =>
        action.type === "node.delete" ? action.payload.nodeId : null,
      ),
    ).toEqual(["photo", "frame"]);
    expect(applyWorkbenchProjectionActions(pasted, remove)).toEqual([]);
  });
});
