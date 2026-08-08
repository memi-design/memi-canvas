import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Layers } from "./layers-tree.js";
import type { WorkbenchNode, WorkbenchNodeKind } from "./model.js";

function node(
  id: string,
  kind: WorkbenchNodeKind,
  parentId: string | null,
  options: Partial<WorkbenchNode> = {},
): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind,
    locked: false,
    name: id,
    parentId,
    position: { x: 0, y: 0 },
    size: { height: 40, width: 60 },
    ...options,
  };
}

function dataTransfer() {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
  };
}

describe("Draft layers hierarchy", () => {
  it("renders Draft containers as expanded hierarchical tree branches", () => {
    const nodes = [
      node("Canvas frame", "DraftFrame", null),
      node("Content group", "Group", "Canvas frame"),
      node("Card", "Rectangle", "Content group"),
      node("Outside", "Ellipse", null),
    ];

    render(
      <Layers
        nodes={nodes}
        onMove={vi.fn()}
        onSelect={vi.fn()}
        selectedNodeId="Card"
      />,
    );

    const frame = screen.getByRole("treeitem", {
      name: "Canvas frame DraftFrame",
    });
    const group = within(frame).getByRole("treeitem", {
      name: "Content group Group",
    });
    expect(frame.getAttribute("aria-expanded")).toBe("true");
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(group).getByRole("treeitem", { name: "Card Rectangle" }),
    ).toBeTruthy();
    expect(
      within(frame).queryByRole("treeitem", { name: "Outside Ellipse" }),
    ).toBeNull();
  });

  it("supports pointer reparenting into an editable Draft container", () => {
    const onMove = vi.fn();
    const transfer = dataTransfer();
    render(
      <Layers
        nodes={[
          node("Frame", "Frame", null),
          node("Existing", "Rectangle", "Frame"),
          node("Card", "Rectangle", null),
        ]}
        onMove={onMove}
        onSelect={vi.fn()}
        selectedNodeId="Card"
      />,
    );

    const card = screen.getByRole("treeitem", { name: "Card Rectangle" });
    const frame = screen.getByRole("treeitem", { name: "Frame Frame" });
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.dragOver(frame, { dataTransfer: transfer });
    fireEvent.drop(frame, { dataTransfer: transfer });

    expect(onMove).toHaveBeenCalledWith({
      index: 1,
      nodeId: "Card",
      parentId: "Frame",
    });
  });

  it("provides keyboard sibling ordering and blocks cycles and protected layers", () => {
    const onMove = vi.fn();
    const transfer = dataTransfer();
    const nodes = [
      node("A", "Rectangle", null),
      node("B", "Rectangle", null),
      node("Parent", "Group", null),
      node("Child frame", "Frame", "Parent"),
      node("Locked", "Rectangle", null, { locked: true }),
      node("Source", "CodeFrame", null),
    ];
    render(
      <Layers
        nodes={nodes}
        onMove={onMove}
        onSelect={vi.fn()}
        selectedNodeId="A"
      />,
    );

    const a = screen.getByRole("treeitem", { name: "A Rectangle" });
    expect(a.getAttribute("aria-keyshortcuts")).toContain("Alt+ArrowDown");
    expect(
      fireEvent.keyDown(a, { altKey: true, key: "ArrowUp" }),
    ).toBe(false);
    expect(
      fireEvent.keyDown(a, { altKey: true, key: "ArrowRight" }),
    ).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.keyDown(a, { altKey: true, key: "ArrowDown" });
    expect(onMove).toHaveBeenLastCalledWith({
      index: 1,
      nodeId: "A",
      parentId: null,
    });

    onMove.mockClear();
    const parent = screen.getByRole("treeitem", { name: "Parent Group" });
    fireEvent.click(parent.querySelector(".layer-branch-toggle")!);
    const child = within(parent).getByRole("treeitem", {
      name: "Child frame Frame",
    });
    fireEvent.dragStart(parent, { dataTransfer: transfer });
    fireEvent.drop(child, { dataTransfer: transfer });
    expect(onMove).not.toHaveBeenCalled();

    const locked = screen.getByRole("treeitem", {
      name: "Locked Rectangle",
    });
    const source = screen.getByRole("treeitem", {
      name: "Source CodeFrame",
    });
    expect((locked as HTMLLIElement).draggable).toBe(false);
    expect((source as HTMLLIElement).draggable).toBe(false);
    fireEvent.keyDown(locked, { altKey: true, key: "ArrowUp" });
    fireEvent.keyDown(source, { altKey: true, key: "ArrowUp" });
    expect(onMove).not.toHaveBeenCalled();
  });
});
