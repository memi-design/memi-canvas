import { describe, expect, it } from "vitest";

import {
  createStarterWhiteboard,
  whiteboardReducer,
  type WhiteboardState,
} from "./whiteboard-model.js";

function emptyBoard(): WhiteboardState {
  return {
    id: "board-test",
    title: "Test board",
    revision: 0,
    items: [],
    selectedItemIds: [],
  };
}

describe("whiteboard document model", () => {
  it("creates a connected starter board without shared mutable references", () => {
    const first = createStarterWhiteboard("First");
    const second = createStarterWhiteboard("Second");

    expect(first.title).toBe("First");
    expect(first.items.map((item) => item.kind)).toEqual([
      "section",
      "sticky",
      "sticky",
      "connector",
      "text",
    ]);
    expect(first.items).not.toBe(second.items);
    expect(first.items[0]).not.toBe(second.items[0]);

    const connector = first.items.find((item) => item.kind === "connector");
    expect(connector).toMatchObject({
      fromItemId: "starter-problem",
      toItemId: "starter-idea",
    });
  });

  it("creates all authoring primitives with bounded coordinates", () => {
    const stickyState = whiteboardReducer(emptyBoard(), {
      type: "create-sticky",
      id: "sticky-1",
      position: { x: 150_000, y: -150_000 },
    });
    const textState = whiteboardReducer(stickyState, {
      type: "create-text",
      id: "text-1",
      position: { x: 80, y: 90 },
    });
    const sectionState = whiteboardReducer(textState, {
      type: "create-section",
      id: "section-1",
      position: { x: 20, y: 30 },
    });
    const connectedState = whiteboardReducer(sectionState, {
      type: "create-connector",
      id: "connector-1",
      fromItemId: "sticky-1",
      toItemId: "text-1",
    });

    expect(stickyState.items[0]).toMatchObject({
      kind: "sticky",
      position: { x: 100_000, y: -100_000 },
      text: "New idea",
    });
    expect(textState.items.at(-1)).toMatchObject({
      kind: "text",
      text: "Start typing",
    });
    expect(sectionState.items.at(-1)).toMatchObject({
      kind: "section",
      title: "New section",
    });
    expect(connectedState.items.at(-1)).toMatchObject({
      kind: "connector",
      fromItemId: "sticky-1",
      toItemId: "text-1",
    });
    expect(connectedState.revision).toBe(4);
  });

  it("rejects duplicate identifiers and connectors with missing endpoints", () => {
    const withSticky = whiteboardReducer(emptyBoard(), {
      type: "create-sticky",
      id: "item-1",
      position: { x: 0, y: 0 },
    });

    expect(
      whiteboardReducer(withSticky, {
        type: "create-text",
        id: "item-1",
        position: { x: 10, y: 10 },
      }),
    ).toBe(withSticky);
    expect(
      whiteboardReducer(withSticky, {
        type: "create-connector",
        id: "connector-1",
        fromItemId: "item-1",
        toItemId: "missing",
      }),
    ).toBe(withSticky);
  });

  it("rejects connectors whose endpoints are themselves connectors", () => {
    const board = createStarterWhiteboard();

    expect(
      whiteboardReducer(board, {
        type: "create-connector",
        id: "nested-connector",
        fromItemId: "starter-connector",
        toItemId: "starter-problem",
      }),
    ).toBe(board);
  });

  it("selects one or many items without accepting unknown identifiers", () => {
    const board = createStarterWhiteboard();
    const selected = whiteboardReducer(board, {
      type: "select",
      itemId: "starter-problem",
    });
    const additive = whiteboardReducer(selected, {
      type: "select",
      itemId: "starter-idea",
      additive: true,
    });

    expect(selected.selectedItemIds).toEqual(["starter-problem"]);
    expect(additive.selectedItemIds).toEqual([
      "starter-problem",
      "starter-idea",
    ]);
    expect(
      whiteboardReducer(additive, {
        type: "select",
        itemId: "unknown",
      }),
    ).toBe(additive);
    expect(
      whiteboardReducer(additive, {
        type: "clear-selection",
      }).selectedItemIds,
    ).toEqual([]);
  });

  it("edits and moves authoring items immutably", () => {
    const board = createStarterWhiteboard();
    const originalProblem = board.items.find(
      (item) => item.id === "starter-problem",
    );
    const edited = whiteboardReducer(board, {
      type: "update-content",
      itemId: "starter-problem",
      content: "A sharper problem",
    });
    const moved = whiteboardReducer(edited, {
      type: "move",
      itemId: "starter-problem",
      position: { x: 480, y: 260 },
    });

    expect(board.items.find((item) => item.id === "starter-problem")).toBe(
      originalProblem,
    );
    expect(originalProblem).toMatchObject({
      text: "What should we solve?",
      position: { x: 160, y: 190 },
    });
    expect(
      edited.items.find((item) => item.id === "starter-problem"),
    ).toMatchObject({ text: "A sharper problem" });
    expect(
      moved.items.find((item) => item.id === "starter-problem"),
    ).toMatchObject({ position: { x: 480, y: 260 } });
    expect(moved.revision).toBe(board.revision + 2);
  });

  it("groups selected items and moves the group as one immutable operation", () => {
    const board = createStarterWhiteboard();
    const selectedProblem = whiteboardReducer(board, {
      type: "select",
      itemId: "starter-problem",
    });
    const selectedPair = whiteboardReducer(selectedProblem, {
      type: "select",
      itemId: "starter-idea",
      additive: true,
    });
    const grouped = whiteboardReducer(selectedPair, {
      type: "group-selected",
      groupId: "group-1",
    });
    const moved = whiteboardReducer(grouped, {
      type: "move-items",
      itemIds: ["starter-problem"],
      delta: { x: 40, y: -20 },
    });

    expect(
      grouped.items
        .filter((item) =>
          ["starter-problem", "starter-idea"].includes(item.id),
        )
        .map((item) => item.groupId),
    ).toEqual(["group-1", "group-1"]);
    expect(
      moved.items.find((item) => item.id === "starter-problem"),
    ).toMatchObject({ position: { x: 200, y: 170 } });
    expect(
      moved.items.find((item) => item.id === "starter-idea"),
    ).toMatchObject({ position: { x: 510, y: 170 } });
    expect(board.items.find((item) => item.id === "starter-problem")).toMatchObject({
      position: { x: 160, y: 190 },
    });
    expect(moved.revision).toBe(grouped.revision + 1);
  });

  it("selects grouped peers together, ungroups them, and removes attached connectors", () => {
    const board = createStarterWhiteboard();
    const selectedProblem = whiteboardReducer(board, {
      type: "select",
      itemId: "starter-problem",
    });
    const selectedPair = whiteboardReducer(selectedProblem, {
      type: "select",
      itemId: "starter-idea",
      additive: true,
    });
    const grouped = whiteboardReducer(selectedPair, {
      type: "group-selected",
      groupId: "group-1",
    });
    const cleared = whiteboardReducer(grouped, {
      type: "clear-selection",
    });
    const selectedGroup = whiteboardReducer(cleared, {
      type: "select",
      itemId: "starter-problem",
    });
    const ungrouped = whiteboardReducer(selectedGroup, {
      type: "ungroup-selected",
    });
    const removed = whiteboardReducer(ungrouped, {
      type: "delete-selected",
    });

    expect(selectedGroup.selectedItemIds).toEqual([
      "starter-problem",
      "starter-idea",
    ]);
    expect(
      ungrouped.items
        .filter((item) =>
          ["starter-problem", "starter-idea"].includes(item.id),
        )
        .every((item) => item.groupId === undefined),
    ).toBe(true);
    expect(
      removed.items.some((item) => item.id === "starter-connector"),
    ).toBe(false);
    expect(
      removed.items.some((item) => item.id === "starter-problem"),
    ).toBe(false);
    expect(removed.selectedItemIds).toEqual([]);
  });
});
