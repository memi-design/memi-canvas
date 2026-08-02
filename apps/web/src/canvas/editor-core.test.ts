import { describe, expect, it } from "vitest";

import {
  groupNodes,
  moveNodes,
  reorderNode,
  rollbackPointerTransaction,
  startPointerTransaction,
  ungroupNodes,
} from "./editor-core.js";
import {
  createSelectionState,
  designDocumentFromWorkbench,
  legacySelectionId,
  selectionFromLegacy,
  type DesignDocument,
  type DocumentNode,
  updateSelection,
} from "./model.js";

function node(
  id: string,
  parentId: string | null,
  position: { readonly x: number; readonly y: number },
  childIds: readonly string[] = [],
): DocumentNode {
  return {
    id,
    kind: "Rectangle",
    name: id,
    parentId,
    childIds,
    position,
    size: { width: 20, height: 20 },
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    styles: {},
    constraints: {
      horizontal: "left",
      vertical: "top",
    },
  };
}

function documentWith(
  nodes: readonly DocumentNode[],
  rootIds: readonly string[],
): DesignDocument {
  return {
    id: "document",
    revision: 7,
    nodes,
    rootIds,
  };
}

describe("ordered editor selection", () => {
  it("preserves click order while toggling and replacing selections", () => {
    const empty = createSelectionState();
    const first = updateSelection(empty, "alpha", "replace");
    const second = updateSelection(first, "beta", "toggle");
    const third = updateSelection(second, "gamma", "toggle");
    const removed = updateSelection(third, "beta", "toggle");

    expect(third).toEqual({
      selectedIds: ["alpha", "beta", "gamma"],
      anchorId: "gamma",
      focusedId: "gamma",
      editingId: null,
    });
    expect(removed.selectedIds).toEqual(["alpha", "gamma"]);
    expect(removed.anchorId).toBe("gamma");
    expect(updateSelection(removed, "delta", "replace").selectedIds).toEqual([
      "delta",
    ]);
    expect(empty.selectedIds).toEqual([]);
  });

  it("migrates legacy single selection without changing its identity", () => {
    const selection = selectionFromLegacy("node-1");

    expect(selection.selectedIds).toEqual(["node-1"]);
    expect(legacySelectionId(selection)).toBe("node-1");
    expect(legacySelectionId(createSelectionState())).toBeNull();
    expect(
      createSelectionState(["node-1"], {
        anchorId: null,
        focusedId: null,
      }),
    ).toMatchObject({ anchorId: null, focusedId: null });
  });
});

describe("legacy workbench document migration", () => {
  it("derives ordered roots and children while retaining editable styles", () => {
    const migrated = designDocumentFromWorkbench({
      id: "legacy",
      revision: 2,
      nodes: [
        {
          id: "frame",
          kind: "Frame",
          name: "Frame",
          parentId: null,
          position: { x: 20, y: 30 },
          size: { width: 200, height: 100 },
          locked: false,
          hidden: false,
          fill: "#fff",
        },
        {
          id: "text",
          kind: "Text",
          name: "Text",
          parentId: "frame",
          position: { x: 28, y: 40 },
          size: { width: 80, height: 20 },
          locked: false,
          hidden: false,
          text: "Hello",
        },
      ],
    });

    expect(migrated.rootIds).toEqual(["frame"]);
    expect(migrated.nodes[0]).toMatchObject({
      id: "frame",
      kind: "Frame",
      childIds: ["text"],
      styles: { fill: "#fff" },
    });
    expect(migrated.nodes[1]).toMatchObject({
      id: "text",
      parentId: "frame",
      position: { x: 8, y: 10 },
      styles: { text: "Hello" },
    });
  });
});

describe("parent-relative document operations", () => {
  it("groups siblings without changing their world positions", () => {
    const before = documentWith(
      [
        node("a", null, { x: 100, y: 80 }),
        node("b", null, { x: 160, y: 120 }),
        node("c", null, { x: 240, y: 120 }),
      ],
      ["a", "b", "c"],
    );

    const after = groupNodes(before, ["b", "a"], {
      id: "group",
      name: "Group 1",
    });

    expect(after.rootIds).toEqual(["group", "c"]);
    expect(after.nodes.find(({ id }) => id === "group")).toMatchObject({
      parentId: null,
      childIds: ["a", "b"],
      position: { x: 100, y: 80 },
      size: { width: 80, height: 60 },
    });
    expect(after.nodes.find(({ id }) => id === "a")).toMatchObject({
      parentId: "group",
      position: { x: 0, y: 0 },
    });
    expect(after.nodes.find(({ id }) => id === "b")).toMatchObject({
      parentId: "group",
      position: { x: 60, y: 40 },
    });
    expect(before.rootIds).toEqual(["a", "b", "c"]);
  });

  it("ungroups into the original parent and preserves sibling order", () => {
    const grouped = groupNodes(
      documentWith(
        [
          node("a", null, { x: 100, y: 80 }),
          node("b", null, { x: 160, y: 120 }),
          node("c", null, { x: 240, y: 120 }),
        ],
        ["a", "b", "c"],
      ),
      ["a", "b"],
      { id: "group", name: "Group 1" },
    );

    const restored = ungroupNodes(grouped, ["group"]);

    expect(restored.rootIds).toEqual(["a", "b", "c"]);
    expect(restored.nodes.find(({ id }) => id === "group")).toBeUndefined();
    expect(restored.nodes.find(({ id }) => id === "a")).toMatchObject({
      parentId: null,
      position: { x: 100, y: 80 },
    });
    expect(restored.nodes.find(({ id }) => id === "b")).toMatchObject({
      parentId: null,
      position: { x: 160, y: 120 },
    });
  });

  it("moves only top-level selected roots so nested child coordinates stay local", () => {
    const child = node("child", "group", { x: 15, y: 12 });
    const group = {
      ...node("group", null, { x: 100, y: 90 }, ["child"]),
      kind: "Group" as const,
    };
    const before = documentWith([group, child], ["group"]);

    const after = moveNodes(before, ["group", "child"], { x: 20, y: -5 });

    expect(after.nodes.find(({ id }) => id === "group")?.position).toEqual({
      x: 120,
      y: 85,
    });
    expect(after.nodes.find(({ id }) => id === "child")).toBe(child);
    expect(before.nodes.find(({ id }) => id === "group")?.position).toEqual({
      x: 100,
      y: 90,
    });
  });

  it("reorders only within the node's sibling list", () => {
    const before = documentWith(
      [
        node("a", null, { x: 0, y: 0 }),
        node("b", null, { x: 0, y: 0 }),
        node("c", null, { x: 0, y: 0 }),
      ],
      ["a", "b", "c"],
    );

    expect(reorderNode(before, "a", "front").rootIds).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(reorderNode(before, "c", "backward").rootIds).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(before.rootIds).toEqual(["a", "b", "c"]);
  });

  it("rejects invalid groups and leaves no-op operations untouched", () => {
    const locked = { ...node("locked", null, { x: 0, y: 0 }), locked: true };
    const child = node("child", "parent", { x: 4, y: 5 });
    const parent = {
      ...node("parent", null, { x: 0, y: 0 }, ["child"]),
      kind: "Frame" as const,
    };
    const before = documentWith([locked, parent, child], [
      "locked",
      "parent",
    ]);

    expect(moveNodes(before, ["locked"], { x: 2, y: 2 })).toBe(before);
    expect(moveNodes(before, ["missing"], { x: 2, y: 2 })).toBe(before);
    expect(moveNodes(before, ["parent"], { x: 0, y: 0 })).toBe(before);
    expect(
      moveNodes(before, ["parent"], {
        x: Number.NaN,
        y: Number.NaN,
      }),
    ).toBe(before);
    expect(groupNodes(before, [], { id: "group", name: "Empty" })).toBe(
      before,
    );
    expect(reorderNode(before, "missing", "front")).toBe(before);
    expect(reorderNode(before, "locked", "back")).toBe(before);
    expect(reorderNode(before, "locked", "forward").rootIds).toEqual([
      "parent",
      "locked",
    ]);
    expect(ungroupNodes(before, ["parent"])).toBe(before);
    expect(() =>
      groupNodes(before, ["locked", "child"], {
        id: "group",
        name: "Invalid",
      }),
    ).toThrow("Only sibling nodes can be grouped");
    expect(() =>
      groupNodes(before, ["locked"], {
        id: "parent",
        name: "Duplicate",
      }),
    ).toThrow('A node with id "parent" already exists');
  });

  it("ungroups a nested group back into its parent", () => {
    const first = node("first", "frame", { x: 10, y: 12 });
    const second = node("second", "frame", { x: 50, y: 30 });
    const frame = {
      ...node("frame", null, { x: 100, y: 100 }, ["first", "second"]),
      kind: "Frame" as const,
    };
    const grouped = groupNodes(
      documentWith([frame, first, second], ["frame"]),
      ["first", "second"],
      { id: "group", name: "Nested group" },
    );
    const ungrouped = ungroupNodes(grouped, ["group"]);

    expect(
      ungrouped.nodes.find(({ id }) => id === "frame")?.childIds,
    ).toEqual(["first", "second"]);
    expect(
      ungrouped.nodes.find(({ id }) => id === "first")?.position,
    ).toEqual({ x: 10, y: 12 });
  });
});

describe("pointer transaction rollback", () => {
  it("restores both the document and viewport snapshot after cancellation", () => {
    const document = documentWith(
      [node("a", null, { x: 0, y: 0 })],
      ["a"],
    );
    const viewport = {
      translation: { x: 40, y: -12 },
      zoom: 1.5,
      viewportSize: { width: 1000, height: 700 },
      pointerMode: "move" as const,
    };
    const transaction = startPointerTransaction(document, viewport);
    const changedDocument = moveNodes(document, ["a"], { x: 200, y: 100 });

    const rolledBack = rollbackPointerTransaction(transaction, {
      document: changedDocument,
      viewport: {
        ...viewport,
        translation: { x: 500, y: 500 },
      },
    });

    expect(rolledBack).toEqual({ document, viewport });
    expect(transaction.document).not.toBe(document);
    expect(transaction.viewport).not.toBe(viewport);
  });
});
