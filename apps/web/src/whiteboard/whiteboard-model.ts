export interface WhiteboardPoint {
  readonly x: number;
  readonly y: number;
}

export interface WhiteboardSize {
  readonly width: number;
  readonly height: number;
}

interface WhiteboardBaseItem {
  readonly id: string;
  readonly groupId?: string;
}

export interface WhiteboardSticky extends WhiteboardBaseItem {
  readonly kind: "sticky";
  readonly position: WhiteboardPoint;
  readonly size: WhiteboardSize;
  readonly text: string;
  readonly color: "yellow" | "pink" | "blue" | "green";
}

export interface WhiteboardText extends WhiteboardBaseItem {
  readonly kind: "text";
  readonly position: WhiteboardPoint;
  readonly size: WhiteboardSize;
  readonly text: string;
}

export interface WhiteboardSection extends WhiteboardBaseItem {
  readonly kind: "section";
  readonly position: WhiteboardPoint;
  readonly size: WhiteboardSize;
  readonly title: string;
}

export interface WhiteboardConnector extends WhiteboardBaseItem {
  readonly kind: "connector";
  readonly fromItemId: string;
  readonly toItemId: string;
}

export type WhiteboardItem =
  | WhiteboardSticky
  | WhiteboardText
  | WhiteboardSection
  | WhiteboardConnector;

export interface WhiteboardState {
  readonly id: string;
  readonly title: string;
  readonly revision: number;
  readonly items: readonly WhiteboardItem[];
  readonly selectedItemIds: readonly string[];
}

export type WhiteboardAction =
  | {
      readonly type: "select";
      readonly itemId: string;
      readonly additive?: boolean;
    }
  | { readonly type: "clear-selection" }
  | {
      readonly type: "create-sticky";
      readonly id: string;
      readonly position: WhiteboardPoint;
      readonly color?: WhiteboardSticky["color"];
    }
  | {
      readonly type: "create-text";
      readonly id: string;
      readonly position: WhiteboardPoint;
    }
  | {
      readonly type: "create-section";
      readonly id: string;
      readonly position: WhiteboardPoint;
    }
  | {
      readonly type: "create-connector";
      readonly id: string;
      readonly fromItemId: string;
      readonly toItemId: string;
    }
  | {
      readonly type: "update-content";
      readonly itemId: string;
      readonly content: string;
    }
  | {
      readonly type: "move";
      readonly itemId: string;
      readonly position: WhiteboardPoint;
    }
  | {
      readonly type: "move-items";
      readonly itemIds: readonly string[];
      readonly delta: WhiteboardPoint;
    }
  | {
      readonly type: "group-selected";
      readonly groupId: string;
    }
  | { readonly type: "ungroup-selected" }
  | { readonly type: "delete-selected" };

const COORDINATE_LIMIT = 100_000;

function boundedCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-COORDINATE_LIMIT, Math.min(COORDINATE_LIMIT, value));
}

function boundedPoint(point: WhiteboardPoint): WhiteboardPoint {
  return {
    x: boundedCoordinate(point.x),
    y: boundedCoordinate(point.y),
  };
}

function hasItem(state: WhiteboardState, itemId: string): boolean {
  return state.items.some((item) => item.id === itemId);
}

function withoutGroup(item: WhiteboardItem): WhiteboardItem {
  const { groupId: _groupId, ...ungrouped } = item;
  return ungrouped;
}

function appendItem(
  state: WhiteboardState,
  item: WhiteboardItem,
): WhiteboardState {
  if (hasItem(state, item.id)) {
    return state;
  }
  return {
    ...state,
    revision: state.revision + 1,
    items: [...state.items, item],
    selectedItemIds: [item.id],
  };
}

export function createStarterWhiteboard(
  title = "Untitled whiteboard",
): WhiteboardState {
  return {
    id: "starter-whiteboard",
    title,
    revision: 0,
    selectedItemIds: [],
    items: [
      {
        id: "starter-section",
        kind: "section",
        position: { x: 96, y: 96 },
        size: { width: 640, height: 360 },
        title: "Kickoff",
      },
      {
        id: "starter-problem",
        kind: "sticky",
        position: { x: 160, y: 190 },
        size: { width: 180, height: 160 },
        text: "What should we solve?",
        color: "yellow",
      },
      {
        id: "starter-idea",
        kind: "sticky",
        position: { x: 470, y: 190 },
        size: { width: 180, height: 160 },
        text: "Add the strongest idea",
        color: "blue",
      },
      {
        id: "starter-connector",
        kind: "connector",
        fromItemId: "starter-problem",
        toItemId: "starter-idea",
      },
      {
        id: "starter-heading",
        kind: "text",
        position: { x: 128, y: 118 },
        size: { width: 320, height: 48 },
        text: "Start here",
      },
    ],
  };
}

export function whiteboardReducer(
  state: WhiteboardState,
  action: WhiteboardAction,
): WhiteboardState {
  if (action.type === "select") {
    const target = state.items.find((item) => item.id === action.itemId);
    if (target === undefined) {
      return state;
    }
    const targetIds =
      target.kind !== "connector" && target.groupId !== undefined
        ? state.items
            .filter((item) => item.groupId === target.groupId)
            .map((item) => item.id)
        : [action.itemId];
    if (!action.additive) {
      return state.selectedItemIds.length === targetIds.length &&
        targetIds.every((id, index) => state.selectedItemIds[index] === id)
        ? state
        : { ...state, selectedItemIds: targetIds };
    }
    const selected = targetIds.every((id) =>
      state.selectedItemIds.includes(id),
    );
    return {
      ...state,
      selectedItemIds: selected
        ? state.selectedItemIds.filter((id) => !targetIds.includes(id))
        : [
            ...state.selectedItemIds,
            ...targetIds.filter((id) => !state.selectedItemIds.includes(id)),
          ],
    };
  }

  if (action.type === "clear-selection") {
    return state.selectedItemIds.length === 0
      ? state
      : { ...state, selectedItemIds: [] };
  }

  if (action.type === "create-sticky") {
    return appendItem(state, {
      id: action.id,
      kind: "sticky",
      position: boundedPoint(action.position),
      size: { width: 180, height: 160 },
      text: "New idea",
      color: action.color ?? "yellow",
    });
  }

  if (action.type === "create-text") {
    return appendItem(state, {
      id: action.id,
      kind: "text",
      position: boundedPoint(action.position),
      size: { width: 220, height: 48 },
      text: "Start typing",
    });
  }

  if (action.type === "create-section") {
    return appendItem(state, {
      id: action.id,
      kind: "section",
      position: boundedPoint(action.position),
      size: { width: 560, height: 340 },
      title: "New section",
    });
  }

  if (action.type === "create-connector") {
    const fromItem = state.items.find(
      (item) => item.id === action.fromItemId,
    );
    const toItem = state.items.find((item) => item.id === action.toItemId);
    const validEndpoints =
      action.fromItemId !== action.toItemId &&
      fromItem !== undefined &&
      fromItem.kind !== "connector" &&
      toItem !== undefined &&
      toItem.kind !== "connector";
    if (!validEndpoints) {
      return state;
    }
    return appendItem(state, {
      id: action.id,
      kind: "connector",
      fromItemId: action.fromItemId,
      toItemId: action.toItemId,
    });
  }

  if (action.type === "update-content") {
    let changed = false;
    const items = state.items.map((item): WhiteboardItem => {
      if (item.id !== action.itemId || item.kind === "connector") {
        return item;
      }
      const previousContent =
        item.kind === "section" ? item.title : item.text;
      if (previousContent === action.content) {
        return item;
      }
      changed = true;
      return item.kind === "section"
        ? { ...item, title: action.content }
        : { ...item, text: action.content };
    });
    return changed
      ? { ...state, items, revision: state.revision + 1 }
      : state;
  }

  if (action.type === "group-selected") {
    const selectedIds = new Set(state.selectedItemIds);
    const selectedItems = state.items.filter(
      (item) => item.kind !== "connector" && selectedIds.has(item.id),
    );
    if (selectedItems.length < 2) {
      return state;
    }
    let changed = false;
    const items = state.items.map((item): WhiteboardItem => {
      if (
        item.kind === "connector" ||
        !selectedIds.has(item.id) ||
        item.groupId === action.groupId
      ) {
        return item;
      }
      changed = true;
      return { ...item, groupId: action.groupId };
    });
    return changed
      ? { ...state, items, revision: state.revision + 1 }
      : state;
  }

  if (action.type === "ungroup-selected") {
    const selectedIds = new Set(state.selectedItemIds);
    const groupIds = new Set(
      state.items
        .filter((item) => selectedIds.has(item.id))
        .map((item) => item.groupId)
        .filter((groupId): groupId is string => groupId !== undefined),
    );
    if (groupIds.size === 0) {
      return state;
    }
    const items = state.items.map((item): WhiteboardItem =>
      item.groupId !== undefined && groupIds.has(item.groupId)
        ? withoutGroup(item)
        : item,
    );
    return { ...state, items, revision: state.revision + 1 };
  }

  if (action.type === "delete-selected") {
    if (state.selectedItemIds.length === 0) {
      return state;
    }
    const selectedIds = new Set(state.selectedItemIds);
    const items = state.items.filter(
      (item) =>
        !selectedIds.has(item.id) &&
        !(
          item.kind === "connector" &&
          (selectedIds.has(item.fromItemId) ||
            selectedIds.has(item.toItemId))
        ),
    );
    return {
      ...state,
      items,
      revision: state.revision + 1,
      selectedItemIds: [],
    };
  }

  if (action.type === "move-items") {
    const requestedIds = new Set(action.itemIds);
    const groupIds = new Set(
      state.items
        .filter((item) => requestedIds.has(item.id))
        .map((item) => item.groupId)
        .filter((groupId): groupId is string => groupId !== undefined),
    );
    let changed = false;
    const items = state.items.map((item): WhiteboardItem => {
      if (
        item.kind === "connector" ||
        (!requestedIds.has(item.id) &&
          (item.groupId === undefined || !groupIds.has(item.groupId)))
      ) {
        return item;
      }
      const position = boundedPoint({
        x: item.position.x + action.delta.x,
        y: item.position.y + action.delta.y,
      });
      if (
        position.x === item.position.x &&
        position.y === item.position.y
      ) {
        return item;
      }
      changed = true;
      return { ...item, position };
    });
    return changed
      ? { ...state, items, revision: state.revision + 1 }
      : state;
  }

  const item = state.items.find(
    (candidate) =>
      candidate.id === action.itemId && candidate.kind !== "connector",
  );
  if (item === undefined || item.kind === "connector") {
    return state;
  }
  const position = boundedPoint(action.position);
  return whiteboardReducer(state, {
    type: "move-items",
    itemIds: [item.id],
    delta: {
      x: position.x - item.position.x,
      y: position.y - item.position.y,
    },
  });
}

export function itemLabel(item: WhiteboardItem): string {
  if (item.kind === "sticky") {
    return `Sticky note: ${item.text}`;
  }
  if (item.kind === "text") {
    return `Text note: ${item.text}`;
  }
  if (item.kind === "section") {
    return `Section: ${item.title}`;
  }
  return `Connector from ${item.fromItemId} to ${item.toItemId}`;
}
