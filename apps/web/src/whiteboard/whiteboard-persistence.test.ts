import { describe, expect, it } from "vitest";

import {
  createWhiteboardPersistence,
  whiteboardDocumentKey,
  type WhiteboardStorage,
} from "./whiteboard-persistence.js";
import {
  createStarterWhiteboard,
  whiteboardReducer,
  type WhiteboardState,
} from "./whiteboard-model.js";

function memoryStorage(): {
  readonly storage: WhiteboardStorage;
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
  };
}

function authoredBoard(): WhiteboardState {
  const board = {
    ...createStarterWhiteboard("Research board"),
    id: "research-board",
  };
  const sticky = whiteboardReducer(board, {
    type: "create-sticky",
    id: "sticky-new",
    position: { x: 800, y: 240 },
  });
  const text = whiteboardReducer(sticky, {
    type: "create-text",
    id: "text-new",
    position: { x: 800, y: 440 },
  });
  return whiteboardReducer(text, {
    type: "create-section",
    id: "section-new",
    position: { x: 760, y: 160 },
  });
}

describe("whiteboard document persistence", () => {
  it("round-trips a versioned document under its project documentRef", () => {
    const { storage, values } = memoryStorage();
    const persistence = createWhiteboardPersistence(storage);
    const state = authoredBoard();

    expect(
      persistence.save("whiteboard:research-board", state),
    ).toBe(true);
    expect(
      values.has(whiteboardDocumentKey("whiteboard:research-board")),
    ).toBe(true);
    expect(
      persistence.load("whiteboard:research-board"),
    ).toEqual(state);
  });

  it("isolates documents and rejects cross-project payload substitution", () => {
    const { storage, values } = memoryStorage();
    const persistence = createWhiteboardPersistence(storage);
    expect(
      persistence.save("whiteboard:research-board", authoredBoard()),
    ).toBe(true);
    const serialized = values.get(
      whiteboardDocumentKey("whiteboard:research-board"),
    );
    expect(serialized).toBeDefined();
    values.set(
      whiteboardDocumentKey("whiteboard:other-board"),
      serialized as string,
    );

    expect(persistence.load("whiteboard:other-board")).toBeNull();
    expect(persistence.load("canvas:research-board")).toBeNull();
    expect(persistence.load("../research-board")).toBeNull();
    expect(
      persistence.save("whiteboard:other-board", authoredBoard()),
    ).toBe(false);
  });

  it("fails closed for malformed, unknown-version, oversized, and unavailable storage", () => {
    const { storage, values } = memoryStorage();
    const persistence = createWhiteboardPersistence(storage);
    const key = whiteboardDocumentKey("whiteboard:research-board");

    values.set(key, '{"schemaVersion":2,"kind":"memi-whiteboard-document"}');
    expect(persistence.load("whiteboard:research-board")).toBeNull();
    expect(
      persistence.read("whiteboard:research-board"),
    ).toEqual({ status: "invalid" });
    values.set(key, "x".repeat(524_289));
    expect(persistence.load("whiteboard:research-board")).toBeNull();
    values.set(key, '{"schemaVersion":1,');
    expect(persistence.load("whiteboard:research-board")).toBeNull();

    const unavailable = createWhiteboardPersistence({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(unavailable.load("whiteboard:research-board")).toBeNull();
    expect(
      unavailable.save("whiteboard:research-board", authoredBoard()),
    ).toBe(false);
    expect(
      createWhiteboardPersistence(memoryStorage().storage).read(
        "whiteboard:missing-board",
      ),
    ).toEqual({ status: "missing" });
  });

  it("rejects invalid references, excessive item counts, dangling connectors, and oversized text", () => {
    const persistence = createWhiteboardPersistence(
      memoryStorage().storage,
    );
    const state = authoredBoard();
    const tooManyItems: WhiteboardState = {
      ...state,
      items: Array.from({ length: 1_001 }, (_, index) => ({
        id: `sticky-${index}`,
        kind: "sticky" as const,
        position: { x: index, y: index },
        size: { width: 180, height: 160 },
        text: "Bounded",
        color: "yellow" as const,
      })),
      selectedItemIds: [],
    };
    const dangling: WhiteboardState = {
      ...state,
      items: [
        ...state.items,
        {
          id: "dangling",
          kind: "connector",
          fromItemId: "missing",
          toItemId: "starter-problem",
        },
      ],
    };
    const oversizedText: WhiteboardState = {
      ...state,
      items: state.items.map((item) =>
        item.id === "starter-problem" && item.kind === "sticky"
          ? { ...item, text: "x".repeat(65_537) }
          : item,
      ),
    };

    expect(persistence.save("whiteboard:bad/ref", state)).toBe(false);
    expect(
      persistence.save("whiteboard:research-board", tooManyItems),
    ).toBe(false);
    expect(
      persistence.save("whiteboard:research-board", dangling),
    ).toBe(false);
    expect(
      persistence.save("whiteboard:research-board", oversizedText),
    ).toBe(false);
  });
});
