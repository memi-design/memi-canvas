import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkbenchNode } from "./model.js";
import { CanvasNodeView } from "./parts.js";

function selectedNode(kind: "Frame" | "Group"): WorkbenchNode {
  return {
    id: `selection-${kind.toLowerCase()}`,
    kind,
    name: `${kind} selection`,
    parentId: null,
    position: { x: 120, y: 80 },
    size: { width: 280, height: 160 },
    locked: false,
    hidden: false,
    fill: "#ffffff",
  };
}

function renderSelectedNode(kind: "Frame" | "Group"): WorkbenchNode {
  const node = selectedNode(kind);
  render(
    <CanvasNodeView
      node={node}
      onPointerDown={vi.fn()}
      onResizePointerDown={vi.fn()}
      onSelect={vi.fn()}
      selected
    />,
  );
  return node;
}

describe("canvas selection feedback", () => {
  it("keeps frame and group selection semantics outside authored artwork", () => {
    const frame = renderSelectedNode("Frame");
    expect(
      screen
        .getByLabelText(`Selection bounds for ${frame.name}`)
        .getAttribute("data-selection-role"),
    ).toBe("frame");

    const group = selectedNode("Group");
    render(
      <CanvasNodeView
        node={group}
        onPointerDown={vi.fn()}
        onResizePointerDown={vi.fn()}
        onSelect={vi.fn()}
        selected
      />,
    );
    const bounds = screen.getByLabelText(`Selection bounds for ${group.name}`);
    expect(bounds.getAttribute("data-artwork")).toBe("false");
    expect(bounds.getAttribute("data-selection-role")).toBe("group");
  });

  it("announces direct manipulation and clears it at the end of a gesture", () => {
    const node = renderSelectedNode("Frame");
    const surface = screen.getByRole("button", {
      name: `${node.name} on canvas`,
    });
    const root = surface.parentElement;

    expect(root?.getAttribute("data-direct-manipulation")).toBe("false");
    fireEvent.pointerDown(surface, { button: 0, pointerId: 17 });

    expect(root?.getAttribute("data-direct-manipulation")).toBe("move");
    expect(
      screen.getByRole("status", { name: `Moving ${node.name}` }),
    ).toBeTruthy();

    fireEvent.pointerUp(window, { button: 0, pointerId: 17 });

    expect(root?.getAttribute("data-direct-manipulation")).toBe("false");
    expect(
      screen.queryByRole("status", { name: `Moving ${node.name}` }),
    ).toBeNull();
  });
});
