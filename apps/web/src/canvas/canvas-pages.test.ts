import { describe, expect, it } from "vitest";

import {
  canvasPageActions,
  canvasPagesReducer,
  createCanvasPagesState,
  createEmptyCanvasScene,
  getActiveCanvasPage,
  getCanvasPage,
  IMPORTED_CANVAS_PAGE_ID,
  type CanvasPagesState,
} from "./canvas-pages.js";
import type { SceneState } from "./model.js";

function importedScene(): SceneState {
  return {
    nodes: [
      {
        id: "northstar-dashboard",
        kind: "Frame",
        name: "Northstar dashboard",
        parentId: null,
        position: { x: 80, y: 120 },
        size: { width: 720, height: 480 },
        locked: false,
        hidden: false,
      },
    ],
    selectedNodeId: "northstar-dashboard",
    revision: 7,
    past: [],
    future: [],
    nextHistoryId: 1,
  };
}

function createLocalPage(state: CanvasPagesState): CanvasPagesState {
  return canvasPagesReducer(state, canvasPageActions.createLocalPage());
}

describe("canvas pages state", () => {
  it("accepts a caller-supplied unique local identity without changing the display sequence", () => {
    const state = canvasPagesReducer(
      createCanvasPagesState(importedScene()),
      canvasPageActions.createLocalPage("local-canvas-session-abc"),
    );

    expect(state.activePageId).toBe("local-canvas-session-abc");
    expect(getActiveCanvasPage(state).name).toBe("Untitled canvas 1");
  });

  it("starts on a protected imported source page bound to the supplied scene", () => {
    const scene = importedScene();
    const state = createCanvasPagesState(scene);

    expect(state).toEqual({
      pages: [
        {
          id: IMPORTED_CANVAS_PAGE_ID,
          kind: "imported",
          name: "Imported source",
          scene,
        },
      ],
      activePageId: IMPORTED_CANVAS_PAGE_ID,
      nextLocalPageNumber: 1,
    });
    expect(getActiveCanvasPage(state).scene).toBe(scene);
  });

  it("creates stable, unique local canvases with sequential default names", () => {
    const initial = createCanvasPagesState(importedScene());
    const first = createLocalPage(initial);
    const second = createLocalPage(first);
    const firstLocal = first.pages[1];
    const secondLocal = second.pages[2];

    expect(firstLocal).toMatchObject({
      id: "local-canvas-1",
      kind: "local",
      name: "Untitled canvas 1",
    });
    expect(secondLocal).toMatchObject({
      id: "local-canvas-2",
      kind: "local",
      name: "Untitled canvas 2",
    });
    expect(second.activePageId).toBe("local-canvas-2");
    expect(second.nextLocalPageNumber).toBe(3);
    expect(new Set(second.pages.map(({ id }) => id)).size).toBe(
      second.pages.length,
    );
  });

  it("gives every new page an independent empty scene", () => {
    const expectedEmptyScene = {
      nodes: [],
      selectedNodeId: null,
      revision: 1,
      past: [],
      future: [],
      nextHistoryId: 1,
    };
    const first = createLocalPage(
      createCanvasPagesState(importedScene()),
    );
    const second = createLocalPage(first);
    const firstScene = getCanvasPage(first, "local-canvas-1")?.scene;
    const secondScene = getCanvasPage(second, "local-canvas-2")?.scene;

    expect(createEmptyCanvasScene()).toEqual(expectedEmptyScene);
    expect(firstScene).toEqual(expectedEmptyScene);
    expect(secondScene).toEqual(expectedEmptyScene);
    expect(firstScene).not.toBe(secondScene);
    expect(firstScene?.nodes).not.toBe(secondScene?.nodes);
    expect(firstScene?.past).not.toBe(secondScene?.past);
  });

  it("switches pages while preserving each page's independent scene", () => {
    const withTwoPages = createLocalPage(
      createLocalPage(createCanvasPagesState(importedScene())),
    );
    const editedFirstScene: SceneState = {
      ...createEmptyCanvasScene(),
      revision: 2,
      nodes: [
        {
          id: "idea",
          kind: "Text",
          name: "Idea",
          parentId: null,
          position: { x: 10, y: 20 },
          size: { width: 100, height: 40 },
          locked: false,
          hidden: false,
          text: "First canvas",
        },
      ],
      selectedNodeId: "idea",
    };
    const edited = canvasPagesReducer(
      withTwoPages,
      canvasPageActions.replacePageScene(
        "local-canvas-1",
        editedFirstScene,
      ),
    );
    const switched = canvasPagesReducer(
      edited,
      canvasPageActions.switchPage("local-canvas-1"),
    );

    expect(getActiveCanvasPage(switched).scene).toBe(editedFirstScene);
    expect(getCanvasPage(switched, "local-canvas-2")?.scene).toEqual(
      createEmptyCanvasScene(),
    );
    expect(
      getCanvasPage(switched, IMPORTED_CANVAS_PAGE_ID)?.scene.revision,
    ).toBe(7);
  });

  it("renames and deletes local pages without changing prior states", () => {
    const created = createLocalPage(
      createCanvasPagesState(importedScene()),
    );
    const renamed = canvasPagesReducer(
      created,
      canvasPageActions.renameLocalPage(
        "local-canvas-1",
        "Exploration",
      ),
    );
    const deleted = canvasPagesReducer(
      renamed,
      canvasPageActions.deleteLocalPage("local-canvas-1"),
    );

    expect(getCanvasPage(created, "local-canvas-1")?.name).toBe(
      "Untitled canvas 1",
    );
    expect(getCanvasPage(renamed, "local-canvas-1")?.name).toBe(
      "Exploration",
    );
    expect(getCanvasPage(deleted, "local-canvas-1")).toBeUndefined();
    expect(deleted.activePageId).toBe(IMPORTED_CANVAS_PAGE_ID);
    expect(deleted.nextLocalPageNumber).toBe(2);
  });

  it("never renames or deletes the imported page", () => {
    const initial = createCanvasPagesState(importedScene());
    const renamed = canvasPagesReducer(
      initial,
      canvasPageActions.renameLocalPage(
        IMPORTED_CANVAS_PAGE_ID,
        "Changed",
      ),
    );
    const deleted = canvasPagesReducer(
      renamed,
      canvasPageActions.deleteLocalPage(IMPORTED_CANVAS_PAGE_ID),
    );

    expect(getCanvasPage(deleted, IMPORTED_CANVAS_PAGE_ID)?.name).toBe(
      "Imported source",
    );
    expect(deleted.pages).toHaveLength(1);
    expect(deleted.activePageId).toBe(IMPORTED_CANVAS_PAGE_ID);
  });

  it("returns new state and collection objects without mutating inputs", () => {
    const initial = createCanvasPagesState(importedScene());
    const created = createLocalPage(initial);
    const protectedDelete = canvasPagesReducer(
      initial,
      canvasPageActions.deleteLocalPage(IMPORTED_CANVAS_PAGE_ID),
    );

    expect(created).not.toBe(initial);
    expect(created.pages).not.toBe(initial.pages);
    expect(created.pages[0]).not.toBe(initial.pages[0]);
    expect(initial.pages).toHaveLength(1);
    expect(protectedDelete).not.toBe(initial);
    expect(protectedDelete.pages).not.toBe(initial.pages);
  });
});
