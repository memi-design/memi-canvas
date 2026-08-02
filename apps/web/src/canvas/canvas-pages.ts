import type { SceneState } from "./model.js";

export const IMPORTED_CANVAS_PAGE_ID = "source-import";

export type CanvasPageKind = "imported" | "local";

export interface CanvasPage {
  readonly id: string;
  readonly kind: CanvasPageKind;
  readonly name: string;
  readonly scene: SceneState;
}

export interface CanvasPagesState {
  readonly pages: readonly CanvasPage[];
  readonly activePageId: string;
  readonly nextLocalPageNumber: number;
}

export type CanvasPageAction =
  | {
      readonly type: "create-local-page";
      readonly pageId?: string;
    }
  | {
      readonly type: "switch-page";
      readonly pageId: string;
    }
  | {
      readonly type: "replace-page-scene";
      readonly pageId: string;
      readonly scene: SceneState;
    }
  | {
      readonly type: "rename-local-page";
      readonly pageId: string;
      readonly name: string;
    }
  | {
      readonly type: "delete-local-page";
      readonly pageId: string;
    };

export const canvasPageActions = {
  createLocalPage(pageId?: string): CanvasPageAction {
    return {
      type: "create-local-page",
      ...(pageId === undefined ? {} : { pageId }),
    };
  },
  switchPage(pageId: string): CanvasPageAction {
    return { type: "switch-page", pageId };
  },
  replacePageScene(
    pageId: string,
    scene: SceneState,
  ): CanvasPageAction {
    return { type: "replace-page-scene", pageId, scene };
  },
  renameLocalPage(
    pageId: string,
    name: string,
  ): CanvasPageAction {
    return { type: "rename-local-page", pageId, name };
  },
  deleteLocalPage(pageId: string): CanvasPageAction {
    return { type: "delete-local-page", pageId };
  },
};

export function createEmptyCanvasScene(): SceneState {
  return {
    nodes: [],
    selectedNodeId: null,
    revision: 1,
    past: [],
    future: [],
    nextHistoryId: 1,
  };
}

export function createCanvasPagesState(
  importedScene: SceneState,
): CanvasPagesState {
  return {
    pages: [
      {
        id: IMPORTED_CANVAS_PAGE_ID,
        kind: "imported",
        name: "Imported source",
        scene: importedScene,
      },
    ],
    activePageId: IMPORTED_CANVAS_PAGE_ID,
    nextLocalPageNumber: 1,
  };
}

export function getCanvasPage(
  state: CanvasPagesState,
  pageId: string,
): CanvasPage | undefined {
  return state.pages.find(({ id }) => id === pageId);
}

export function getActiveCanvasPage(
  state: CanvasPagesState,
): CanvasPage {
  const activePage = getCanvasPage(state, state.activePageId);
  if (activePage === undefined) {
    throw new Error(
      `Canvas pages state has no active page "${state.activePageId}".`,
    );
  }
  return activePage;
}

function copiedState(state: CanvasPagesState): CanvasPagesState {
  return {
    ...state,
    pages: state.pages.map((page) => ({ ...page })),
  };
}

function nextLocalPageIdentity(
  state: CanvasPagesState,
  requestedPageId?: string,
): {
  readonly id: string;
  readonly name: string;
  readonly number: number;
} {
  const existingIds = new Set(state.pages.map(({ id }) => id));
  let number = state.nextLocalPageNumber;
  let id =
    requestedPageId !== undefined &&
    /^local-canvas-[a-z0-9-]+$/u.test(requestedPageId) &&
    !existingIds.has(requestedPageId)
      ? requestedPageId
      : `local-canvas-${number}`;

  while (existingIds.has(id)) {
    number += 1;
    id = `local-canvas-${number}`;
  }

  return {
    id,
    name: `Untitled canvas ${number}`,
    number,
  };
}

function createLocalPage(
  state: CanvasPagesState,
  requestedPageId?: string,
): CanvasPagesState {
  const identity = nextLocalPageIdentity(state, requestedPageId);
  const page: CanvasPage = {
    id: identity.id,
    kind: "local",
    name: identity.name,
    scene: createEmptyCanvasScene(),
  };

  return {
    pages: [
      ...state.pages.map((existingPage) => ({ ...existingPage })),
      page,
    ],
    activePageId: page.id,
    nextLocalPageNumber: identity.number + 1,
  };
}

function updatePage(
  state: CanvasPagesState,
  pageId: string,
  update: (page: CanvasPage) => CanvasPage,
): CanvasPagesState {
  return {
    ...state,
    pages: state.pages.map((page) =>
      page.id === pageId ? update(page) : { ...page },
    ),
  };
}

function deleteLocalPage(
  state: CanvasPagesState,
  pageId: string,
): CanvasPagesState {
  const page = getCanvasPage(state, pageId);
  if (page?.kind !== "local") {
    return copiedState(state);
  }

  const pages = state.pages
    .filter(({ id }) => id !== pageId)
    .map((remainingPage) => ({ ...remainingPage }));
  const fallbackPage =
    pages.find(({ kind }) => kind === "imported") ?? pages[0];

  return {
    ...state,
    pages,
    activePageId:
      state.activePageId === pageId && fallbackPage !== undefined
        ? fallbackPage.id
        : state.activePageId,
  };
}

export function canvasPagesReducer(
  state: CanvasPagesState,
  action: CanvasPageAction,
): CanvasPagesState {
  if (action.type === "create-local-page") {
    return createLocalPage(state, action.pageId);
  }

  if (action.type === "switch-page") {
    if (getCanvasPage(state, action.pageId) === undefined) {
      return copiedState(state);
    }
    return {
      ...state,
      pages: state.pages.map((page) => ({ ...page })),
      activePageId: action.pageId,
    };
  }

  if (action.type === "replace-page-scene") {
    if (getCanvasPage(state, action.pageId) === undefined) {
      return copiedState(state);
    }
    return updatePage(state, action.pageId, (page) => ({
      ...page,
      scene: action.scene,
    }));
  }

  if (action.type === "rename-local-page") {
    const page = getCanvasPage(state, action.pageId);
    const name = action.name.trim();
    if (page?.kind !== "local" || name.length === 0) {
      return copiedState(state);
    }
    return updatePage(state, action.pageId, (localPage) => ({
      ...localPage,
      name,
    }));
  }

  return deleteLocalPage(state, action.pageId);
}
