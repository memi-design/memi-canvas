import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import { WhiteboardCanvas } from "../whiteboard/WhiteboardCanvas.js";
import type { WhiteboardState } from "../whiteboard/whiteboard-model.js";

describe("canvas performance integration", () => {
  it("renders only visible workbench nodes while retaining selection", () => {
    const project = {
      ...canvasWorkbenchFixture,
      selectedNodeId: "selected-offscreen",
      document: {
        ...canvasWorkbenchFixture.document,
        nodes: [
          {
            ...canvasWorkbenchFixture.document.nodes[0]!,
            id: "visible-node",
            name: "Visible node",
            position: { x: 100, y: 100 },
          },
          {
            ...canvasWorkbenchFixture.document.nodes[0]!,
            id: "culled-node",
            name: "Culled node",
            position: { x: 4_000, y: 4_000 },
          },
          {
            ...canvasWorkbenchFixture.document.nodes[0]!,
            id: "selected-offscreen",
            name: "Selected offscreen",
            position: { x: 5_000, y: 5_000 },
          },
        ],
      },
    };

    render(<CanvasWorkbench project={project} />);
    const viewport = screen.getByRole("region", { name: "Infinite canvas" });

    expect(
      within(viewport).getByRole("button", {
        name: "Visible node on canvas",
      }),
    ).toBeTruthy();
    expect(
      within(viewport).queryByRole("button", {
        name: "Culled node on canvas",
      }),
    ).toBeNull();
    expect(
      within(viewport).getByRole("button", {
        name: "Selected offscreen on canvas",
      }),
    ).toBeTruthy();
  });

  it("culls whiteboard items and connectors while retaining selection", () => {
    const initialState: WhiteboardState = {
      id: "performance-board",
      title: "Performance board",
      revision: 0,
      selectedItemIds: ["selected-offscreen"],
      items: [
        {
          id: "visible",
          kind: "sticky",
          position: { x: 100, y: 100 },
          size: { height: 120, width: 120 },
          text: "Visible",
          color: "yellow",
        },
        {
          id: "left-endpoint",
          kind: "text",
          position: { x: -500, y: 280 },
          size: { height: 40, width: 40 },
          text: "Left",
        },
        {
          id: "right-endpoint",
          kind: "text",
          position: { x: 1_400, y: 280 },
          size: { height: 40, width: 40 },
          text: "Right",
        },
        {
          id: "crossing-connector",
          kind: "connector",
          fromItemId: "left-endpoint",
          toItemId: "right-endpoint",
        },
        {
          id: "culled",
          kind: "sticky",
          position: { x: 4_000, y: 4_000 },
          size: { height: 120, width: 120 },
          text: "Culled",
          color: "blue",
        },
        {
          id: "selected-offscreen",
          kind: "sticky",
          position: { x: 5_000, y: 5_000 },
          size: { height: 120, width: 120 },
          text: "Selected",
          color: "pink",
        },
        {
          id: "offscreen-connector",
          kind: "connector",
          fromItemId: "culled",
          toItemId: "selected-offscreen",
        },
      ],
    };
    render(<WhiteboardCanvas initialState={initialState} />);
    const board = screen.getByRole("listbox", { name: "Whiteboard items" });
    const scene = board.querySelector<HTMLElement>(".whiteboard-scene");

    expect(
      within(board).getByRole("option", { name: "Sticky note: Visible" }),
    ).toBeTruthy();
    expect(
      within(board).queryByRole("option", { name: "Sticky note: Culled" }),
    ).toBeNull();
    expect(
      within(board).getByRole("option", { name: "Sticky note: Selected" }),
    ).toBeTruthy();
    expect(
      board.querySelectorAll(".whiteboard-connections line"),
    ).toHaveLength(1);
    expect(scene?.style.getPropertyValue("--whiteboard-pan-x")).toBe("0px");

    const visible = within(board).getByRole("option", {
      name: "Sticky note: Visible",
    });
    visible.focus();
    fireEvent.keyDown(visible, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      within(board).getByRole("option", {
        name: "Connector from left-endpoint to right-endpoint",
      }),
    );
  });
});
