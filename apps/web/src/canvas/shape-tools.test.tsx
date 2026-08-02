import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import { createCanvasWorkbenchV3TestSession } from "./canvas-workbench-v3-test-session.js";
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

function v3Session() {
  return createCanvasWorkbenchV3TestSession(canvasWorkbenchFixture);
}

async function workbench(): Promise<void> {
  await screen.findByRole("region", { name: "Infinite canvas" });
}

async function selectTool(label: string): Promise<void> {
  const tool = screen.getByRole("button", { name: `${label} tool` });
  fireEvent.click(tool);
  await waitFor(() => expect(tool.getAttribute("aria-pressed")).toBe("true"));
}

async function createShape(label: string): Promise<void> {
  await selectTool(label);
  fireEvent.click(viewport(), { clientX: 640, clientY: 360 });
}

beforeEach(() => {
  localStorage.clear();
});

describe("professional shape tools", () => {
  it("exposes Ellipse, Line, and Arrow as icon-first toolbar actions with canonical shortcuts", async () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} v3Session={v3Session()} />);
    await workbench();

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
    async (kind, key, shiftKey) => {
      const onSceneChange = vi.fn();
      render(
        <CanvasWorkbench
          onSceneChange={onSceneChange}
          project={canvasWorkbenchFixture}
          v3Session={v3Session()}
        />,
      );
      await workbench();

      fireEvent.keyDown(document, { key, shiftKey });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: `${kind} tool` }).getAttribute("aria-pressed")).toBe("true");
      });
      fireEvent.click(viewport(), { clientX: 640, clientY: 360 });

      const surface = await screen.findByRole("button", {
        name: `${kind} 1 on canvas`,
      });
      expect(surface).toBeTruthy();
      expect(surface.getAttribute("aria-label")).toBe(`${kind} 1 on canvas`);

    },
  );

  it("places click-created shapes in canvas coordinates relative to editor chrome and the active grid", async () => {
    const onSceneChange = vi.fn();
    render(
      <CanvasWorkbench
        onSceneChange={onSceneChange}
        project={canvasWorkbenchFixture}
        v3Session={v3Session()}
      />,
    );
    await workbench();
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

    await selectTool("Rectangle");
    fireEvent.click(viewport(), { clientX: 350, clientY: 190 });

    const rectangle = await screen.findByRole("button", {
      name: /Rectangle \d+ on canvas/,
    });
    expect(rectangle.closest<HTMLElement>("[data-node-id]")?.style.left).toBe("30px");
    expect(rectangle.closest<HTMLElement>("[data-node-id]")?.style.top).toBe("50px");
  });

  it("keeps shape metadata outside authored artwork in a detached selection tag", async () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} v3Session={v3Session()} />);
    await workbench();

    await createShape("Rectangle");

    const surface = await screen.findByRole("button", {
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

  it("drag-creates a shape from the pointer origin with snapped geometry", async () => {
    const onSceneChange = vi.fn();
    render(
      <CanvasWorkbench
        onSceneChange={onSceneChange}
        project={canvasWorkbenchFixture}
        v3Session={v3Session()}
      />,
    );
    await workbench();
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

    await selectTool("Rectangle");
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 350,
      clientY: 190,
      pointerId: 41,
    });
    fireEvent.pointerMove(canvas, {
      buttons: 1,
      clientX: 501,
      clientY: 318,
      pointerId: 41,
    });
    fireEvent.pointerUp(canvas, {
      button: 0,
      clientX: 501,
      clientY: 318,
      pointerId: 41,
    });

    const rectangle = await screen.findByRole("button", {
      name: /Rectangle \d+ on canvas/,
    });
    expect(rectangle.closest<HTMLElement>("[data-node-id]")?.style.left).toBe("110px");
    expect(rectangle.closest<HTMLElement>("[data-node-id]")?.style.top).toBe("110px");
  });

  it("preserves a right-to-left arrow's authored endpoints", async () => {
    const onSceneChange = vi.fn();
    render(
      <CanvasWorkbench
        onSceneChange={onSceneChange}
        project={canvasWorkbenchFixture}
        v3Session={v3Session()}
      />,
    );
    await workbench();
    const canvas = viewport();
    await selectTool("Arrow");
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

    await screen.findByRole("button", { name: "Arrow 1 on canvas" });
    const line = within(
      screen.getByRole("button", { name: "Arrow 1 on canvas" }),
    ).getByTestId("line-path");
    expect(line.getAttribute("x1")).toBe("0");
    expect(line.getAttribute("x2")).toBe("160");
  });

  it("records pen motion as an authored freehand path", async () => {
    const onSceneChange = vi.fn();
    render(
      <CanvasWorkbench
        onSceneChange={onSceneChange}
        project={canvasWorkbenchFixture}
        v3Session={v3Session()}
      />,
    );
    await workbench();
    const canvas = viewport();
    await selectTool("Pen");
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

    await screen.findByRole("button", { name: "Pen 1 on canvas" });
    expect(
      within(
        screen.getByRole("button", { name: "Pen 1 on canvas" }),
      ).getByTestId("vector-path").getAttribute("points"),
    ).not.toBe("0,12 160,12");
  });

  it("cancels a drag-created shape without committing history", async () => {
    const onSceneChange = vi.fn();
    render(
      <CanvasWorkbench
        onSceneChange={onSceneChange}
        project={canvasWorkbenchFixture}
        v3Session={v3Session()}
      />,
    );
    await workbench();
    const canvas = viewport();
    await selectTool("Rectangle");
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

  it("renders ellipse fill and line/arrow strokes as editable content properties", async () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} v3Session={v3Session()} />);
    await workbench();

    await createShape("Ellipse");
    const ellipse = await screen.findByRole("button", {
      name: "Ellipse 1 on canvas",
    });
    expect(ellipse.getAttribute("data-shape-renderer")).toBe("ellipse");
    expect(
      (
        within(screen.getByRole("region", { name: "Inspector" }))
          .getByRole("textbox", { name: "Fill color" }) as HTMLInputElement
      ).value,
    ).toBe("white");

    await createShape("Line");
    const line = await screen.findByRole("button", { name: "Line 1 on canvas" });
    expect(line.getAttribute("data-shape-renderer")).toBe("line");
    expect(within(line).getByTestId("line-path")).toBeTruthy();
    expect(
      (
        within(screen.getByRole("region", { name: "Inspector" }))
          .getByRole("textbox", { name: "Stroke color" }) as HTMLInputElement
      ).value,
    ).toBe("white");

    await createShape("Arrow");
    const arrow = await screen.findByRole("button", { name: "Arrow 1 on canvas" });
    expect(arrow.getAttribute("data-shape-renderer")).toBe("arrow");
    expect(within(arrow).getByTestId("arrow-head")).toBeTruthy();
  });

  it.each([
    ["Section", "Section", "S", true],
    ["Slice", "Section", "s", false],
    ["Pen", "Vector", "p", false],
    ["Pencil", "Vector", "P", true],
    ["Comment", "Comment", "c", false],
  ] as const)(
    "creates a persistent %s node through the canonical professional tool",
    async (toolName, nodeKind, key, shiftKey) => {
      const onSceneChange = vi.fn();
      render(
        <CanvasWorkbench
          onSceneChange={onSceneChange}
          project={canvasWorkbenchFixture}
          v3Session={v3Session()}
        />,
      );
      await workbench();

      fireEvent.keyDown(document, { key, shiftKey });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: `${toolName} tool` }).getAttribute("aria-pressed")).toBe("true");
      });
      fireEvent.click(viewport(), { clientX: 620, clientY: 340 });

      const node = await screen.findByRole("button", {
        name: `${toolName} 1 on canvas`,
      });
      expect(node.getAttribute("aria-label")).toBe(`${toolName} 1 on canvas`);
      expect(node.closest("[data-node-kind]")?.getAttribute("data-node-kind"))
        .toBe(nodeKind);
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
