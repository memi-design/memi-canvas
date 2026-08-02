import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import {
  createSceneState,
  designDocumentFromWorkbench,
  sceneReducer,
  type WorkbenchNode,
} from "./model.js";
import {
  createCanvasAutosave,
  type CanvasAutosave,
} from "./persistence.js";

function viewport(): HTMLElement {
  return screen.getByRole("region", { name: "Infinite canvas" });
}

function createShape(label: string): void {
  fireEvent.click(screen.getByRole("button", { name: `${label} tool` }));
  fireEvent.click(viewport(), { clientX: 640, clientY: 360 });
}

beforeEach(() => {
  localStorage.clear();
});

describe("professional shape tools", () => {
  it("exposes Ellipse, Line, and Arrow as icon-first toolbar actions with canonical shortcuts", () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} />);

    for (const [label, shortcut] of [
      ["Ellipse", "O"],
      ["Line", "L"],
      ["Arrow", "⇧L"],
    ] as const) {
      const action = screen.getByRole("button", { name: `${label} tool` });
      const helpId = action.getAttribute("aria-describedby");
      expect(helpId).toBeTruthy();
      expect(document.getElementById(helpId!)?.textContent).toContain(shortcut);
    }
  });

  it.each([
    ["Ellipse", "O", false],
    ["Line", "l", false],
    ["Arrow", "L", true],
  ] as const)(
    "creates a visible %s with the %s keyboard tool and a click default",
    (kind, key, shiftKey) => {
      const onSceneChange = vi.fn();
      render(
        <CanvasWorkbench
          onSceneChange={onSceneChange}
          project={canvasWorkbenchFixture}
        />,
      );

      fireEvent.keyDown(document, { key, shiftKey });
      fireEvent.click(viewport(), { clientX: 640, clientY: 360 });

      const surface = screen.getByRole("button", {
        name: `${kind} 1 on canvas`,
      });
      expect(surface).toBeTruthy();
      expect(surface.closest("[data-node-kind]")?.getAttribute("data-node-kind"))
        .toBe(kind);

      const latestScene = onSceneChange.mock.calls.at(-1)?.[0] as
        | ReturnType<typeof createSceneState>
        | undefined;
      expect(latestScene?.nodes.at(-1)?.kind).toBe(kind);
      expect(latestScene?.past.at(-1)?.label).toBe(`Create ${kind} 1`);
    },
  );

  it("places click-created shapes in canvas coordinates relative to editor chrome and the active grid", () => {
    const onSceneChange = vi.fn();
    render(
      <CanvasWorkbench
        onSceneChange={onSceneChange}
        project={canvasWorkbenchFixture}
      />,
    );
    vi.spyOn(viewport(), "getBoundingClientRect").mockReturnValue({
      bottom: 680,
      height: 600,
      left: 240,
      right: 1_040,
      top: 80,
      width: 800,
      x: 240,
      y: 80,
      toJSON: () => ({}),
    });

    fireEvent.click(screen.getByRole("button", { name: "Rectangle tool" }));
    fireEvent.click(viewport(), { clientX: 270, clientY: 110 });

    expect(
      onSceneChange.mock.calls.at(-1)?.[0].nodes.at(-1),
    ).toMatchObject({
      kind: "Rectangle",
      position: { x: -50, y: -30 },
      size: { width: 160, height: 120 },
    });
  });

  it("keeps shape metadata outside authored artwork in a detached selection tag", () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} />);

    createShape("Rectangle");

    const surface = screen.getByRole("button", {
      name: /Rectangle \d+ on canvas/,
    });
    expect(surface.textContent).toBe("");

    const tag = screen.getByTestId(/^canvas-node-tag-/);
    expect(tag.textContent).toBe(
      surface.getAttribute("aria-label")?.replace(" on canvas", ""),
    );
    expect(tag.getAttribute("data-artwork")).toBe("false");
    expect(tag.getAttribute("data-source-binding")).toBe("canvas-only");
    expect(surface.contains(tag)).toBe(false);
  });

  it("drag-creates a shape from the pointer origin with snapped geometry", () => {
    const onSceneChange = vi.fn();
    render(
      <CanvasWorkbench
        onSceneChange={onSceneChange}
        project={canvasWorkbenchFixture}
      />,
    );
    const canvas = viewport();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      bottom: 680,
      height: 600,
      left: 240,
      right: 1_040,
      top: 80,
      width: 800,
      x: 240,
      y: 80,
      toJSON: () => ({}),
    });

    fireEvent.click(screen.getByRole("button", { name: "Rectangle tool" }));
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 270,
      clientY: 110,
      pointerId: 41,
    });
    fireEvent.pointerMove(canvas, {
      buttons: 1,
      clientX: 421,
      clientY: 238,
      pointerId: 41,
    });
    fireEvent.pointerUp(canvas, {
      button: 0,
      clientX: 421,
      clientY: 238,
      pointerId: 41,
    });

    expect(
      onSceneChange.mock.calls.at(-1)?.[0].nodes.at(-1),
    ).toMatchObject({
      kind: "Rectangle",
      position: { x: 30, y: 30 },
      size: { width: 150, height: 130 },
    });
  });

  it("preserves a right-to-left arrow's authored endpoints", () => {
    const onSceneChange = vi.fn();
    render(
      <CanvasWorkbench
        onSceneChange={onSceneChange}
        project={canvasWorkbenchFixture}
      />,
    );
    const canvas = viewport();
    fireEvent.click(screen.getByRole("button", { name: "Arrow tool" }));
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 420,
      clientY: 220,
      pointerId: 51,
    });
    fireEvent.pointerMove(canvas, {
      buttons: 1,
      clientX: 260,
      clientY: 220,
      pointerId: 51,
    });
    fireEvent.pointerUp(canvas, {
      button: 0,
      clientX: 260,
      clientY: 220,
      pointerId: 51,
    });

    const arrow = onSceneChange.mock.calls.at(-1)?.[0].nodes.at(-1);
    expect(arrow).toMatchObject({
      kind: "Arrow",
      path: [
        { x: 160, y: 0 },
        { x: 0, y: 0 },
      ],
    });
    const line = within(
      screen.getByRole("button", { name: "Arrow 1 on canvas" }),
    ).getByTestId("line-path");
    expect(line.getAttribute("x1")).toBe("160");
    expect(line.getAttribute("x2")).toBe("0");
  });

  it("records pen motion as an authored freehand path", () => {
    const onSceneChange = vi.fn();
    render(
      <CanvasWorkbench
        onSceneChange={onSceneChange}
        project={canvasWorkbenchFixture}
      />,
    );
    const canvas = viewport();
    fireEvent.click(screen.getByRole("button", { name: "Pen tool" }));
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 260,
      clientY: 220,
      pointerId: 52,
    });
    fireEvent.pointerMove(canvas, {
      buttons: 1,
      clientX: 300,
      clientY: 260,
      pointerId: 52,
    });
    fireEvent.pointerMove(canvas, {
      buttons: 1,
      clientX: 360,
      clientY: 230,
      pointerId: 52,
    });
    fireEvent.pointerUp(canvas, {
      button: 0,
      clientX: 360,
      clientY: 230,
      pointerId: 52,
    });

    const vector = onSceneChange.mock.calls.at(-1)?.[0].nodes.at(-1);
    expect(vector?.kind).toBe("Vector");
    expect(vector?.path).toHaveLength(3);
    expect(new Set(vector?.path?.map(({ y }: { y: number }) => y)).size)
      .toBeGreaterThan(1);
    expect(
      within(
        screen.getByRole("button", { name: "Pen 1 on canvas" }),
      ).getByTestId("vector-path").getAttribute("points"),
    ).not.toBe("0,12 160,12");
  });

  it("cancels a drag-created shape without committing history", () => {
    const onSceneChange = vi.fn();
    render(
      <CanvasWorkbench
        onSceneChange={onSceneChange}
        project={canvasWorkbenchFixture}
      />,
    );
    const canvas = viewport();
    fireEvent.click(screen.getByRole("button", { name: "Rectangle tool" }));
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 30,
      clientY: 30,
      pointerId: 42,
    });
    fireEvent.pointerMove(canvas, {
      buttons: 1,
      clientX: 180,
      clientY: 160,
      pointerId: 42,
    });
    fireEvent.pointerCancel(canvas, { pointerId: 42 });

    expect(
      screen.queryByRole("button", { name: "Rectangle 1 on canvas" }),
    ).toBeNull();
    expect(
      onSceneChange.mock.calls.some(
        ([scene]) => scene.past.at(-1)?.label === "Create Rectangle 1",
      ),
    ).toBe(false);
  });

  it("renders ellipse fill and line/arrow strokes as editable content properties", () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} />);

    createShape("Ellipse");
    const ellipse = screen.getByRole("button", {
      name: "Ellipse 1 on canvas",
    });
    expect(ellipse.getAttribute("data-shape-renderer")).toBe("ellipse");
    expect(
      (
        within(screen.getByRole("region", { name: "Inspector" }))
          .getByRole("textbox", { name: "Fill color" }) as HTMLInputElement
      ).value,
    ).toBe("white");

    createShape("Line");
    const line = screen.getByRole("button", { name: "Line 1 on canvas" });
    expect(line.getAttribute("data-shape-renderer")).toBe("line");
    expect(within(line).getByTestId("line-path")).toBeTruthy();
    expect(
      (
        within(screen.getByRole("region", { name: "Inspector" }))
          .getByRole("textbox", { name: "Stroke color" }) as HTMLInputElement
      ).value,
    ).toBe("white");

    createShape("Arrow");
    const arrow = screen.getByRole("button", { name: "Arrow 1 on canvas" });
    expect(arrow.getAttribute("data-shape-renderer")).toBe("arrow");
    expect(within(arrow).getByTestId("arrow-head")).toBeTruthy();
  });

  it.each([
    ["Section", "Section", "S", true],
    ["Slice", "Slice", "s", false],
    ["Pen", "Vector", "p", false],
    ["Pencil", "Vector", "P", true],
    ["Comment", "Comment", "c", false],
  ] as const)(
    "creates a persistent %s node through the canonical professional tool",
    (toolName, nodeKind, key, shiftKey) => {
      const onSceneChange = vi.fn();
      render(
        <CanvasWorkbench
          onSceneChange={onSceneChange}
          project={canvasWorkbenchFixture}
        />,
      );

      fireEvent.keyDown(document, { key, shiftKey });
      fireEvent.click(viewport(), { clientX: 620, clientY: 340 });

      const node = screen.getByRole("button", {
        name: `${toolName} 1 on canvas`,
      });
      expect(node.closest("[data-node-kind]")?.getAttribute("data-node-kind"))
        .toBe(nodeKind);
      expect(
        onSceneChange.mock.calls.at(-1)?.[0].past.at(-1)?.label,
      ).toBe(`Create ${toolName} 1`);
    },
  );

  it("round-trips authored shape geometry and appearance through local persistence", () => {
    const autosave: CanvasAutosave = createCanvasAutosave(localStorage);
    const initial = createSceneState(canvasWorkbenchFixture);
    const shapes: readonly WorkbenchNode[] = [
      {
        id: "node-ellipse",
        kind: "Ellipse",
        name: "Ellipse 1",
        parentId: null,
        position: { x: 100, y: 120 },
        size: { width: 160, height: 120 },
        locked: false,
        hidden: false,
        fill: "#ff5470",
      },
      {
        id: "node-line",
        kind: "Line",
        name: "Line 1",
        parentId: null,
        position: { x: 320, y: 120 },
        size: { width: 160, height: 24 },
        locked: false,
        hidden: false,
        stroke: "#8a8f98",
      },
      {
        id: "node-arrow",
        kind: "Arrow",
        name: "Arrow 1",
        parentId: null,
        position: { x: 520, y: 120 },
        size: { width: 160, height: 24 },
        locked: false,
        hidden: false,
        stroke: "#f7f8f8",
      },
    ];
    const scene = sceneReducer(initial, {
      type: "commit",
      label: "Create shape set",
      nodes: [...initial.nodes, ...shapes],
      selectedNodeId: "node-arrow",
    });

    expect(autosave.save(canvasWorkbenchFixture, scene, [])).toBe(true);
    expect(autosave.load(canvasWorkbenchFixture)?.scene.nodes.slice(-3))
      .toEqual(shapes);
    expect(
      designDocumentFromWorkbench({
        ...canvasWorkbenchFixture.document,
        nodes: shapes,
      }).nodes.map(({ kind, styles }) => ({ kind, styles })),
    ).toEqual([
      { kind: "Ellipse", styles: { fill: "#ff5470" } },
      { kind: "Line", styles: { stroke: "#8a8f98" } },
      { kind: "Arrow", styles: { stroke: "#f7f8f8" } },
    ]);
  });
});
