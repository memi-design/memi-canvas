import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearCanvasSessionClipboard,
  copyCanvasSelection,
  createCanvasClipboardPayload,
  MEMI_CANVAS_CLIPBOARD_MIME,
  serializeCanvasClipboardFallback,
} from "./canvas-clipboard.js";
import type { WorkbenchNode } from "./model.js";
import { createWorkbenchDocumentActions } from "./workbench-document-actions.js";

function rectangle(
  id: string,
  parentId: string | null,
  x: number,
  y: number,
): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind: "Rectangle",
    locked: false,
    name: id,
    parentId,
    position: { x, y },
    size: { height: 40, width: 40 },
  };
}

function frame(
  id: string,
  parentId: string | null,
  x: number,
  y: number,
): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind: "Frame",
    locked: false,
    name: id,
    parentId,
    position: { x, y },
    size: { height: 240, width: 320 },
  };
}

function actions(
  nodes: readonly WorkbenchNode[],
  selectedNodeIds: readonly string[],
  getPastePoint: () => { readonly x: number; readonly y: number } | null =
    () => null,
  commitIntentReceipt?: (label: string, receipt: any, options?: any) => void,
) {
  const appendTrace = vi.fn();
  const commitScene = vi.fn();
  return {
    appendTrace,
    commitScene,
    value: createWorkbenchDocumentActions({
      appendTrace,
      commitScene,
      ...(commitIntentReceipt === undefined ? {} : { commitIntentReceipt }),
      documentId: "document",
      getPastePoint,
      nodes,
      selectedNode:
        nodes.find(({ id }) => id === selectedNodeIds.at(-1)),
      selectedNodeId: selectedNodeIds.at(-1) ?? null,
      selectedNodeIds,
    }),
  };
}

afterEach(() => {
  clearCanvasSessionClipboard();
  vi.unstubAllGlobals();
});

describe("workbench hierarchy actions", () => {
  it("emits an explicit V3 detach receipt without falling back to a scene commit", () => {
    const source = {
      ...frame("source-screen", null, 40, 60),
      kind: "CodeFrame" as const,
      source: {
        coverageCellId: "default",
        repositoryRevision: "buzzr@abc123",
        routeId: "home",
        sourceAnchor: "src/Home.tsx#Home",
        stateId: "default",
        viewport: { height: 844, name: "mobile" as const, width: 390 },
      },
    };
    const commitIntentReceipt = vi.fn();
    const { commitScene, value } = actions([source], [source.id], () => null, commitIntentReceipt);

    value.detachSelection();

    expect(commitScene).not.toHaveBeenCalled();
    expect(commitIntentReceipt).toHaveBeenCalledWith(
      "Detach source-screen",
      expect.objectContaining({
        kind: "detach",
        node: expect.objectContaining({
          frameContent: "source-screen",
          kind: "DraftFrame",
          provenance: expect.objectContaining({ repositoryRevision: "buzzr@abc123" }),
        }),
      }),
      expect.objectContaining({ selectedIds: [source.id], targetIds: [source.id] }),
    );
    expect(JSON.stringify(commitIntentReceipt.mock.calls)).not.toContain("node.replace");
  });

  it("emits a compact V3 group receipt with parent-relative child transforms", () => {
    const a = rectangle("a", null, 100, 80);
    const b = rectangle("b", null, 160, 120);
    const commitIntentReceipt = vi.fn();
    const { commitScene, value } = actions(
      [a, b],
      [a.id, b.id],
      () => null,
      commitIntentReceipt,
    );

    value.groupSelection();

    expect(commitScene).not.toHaveBeenCalled();
    expect(commitIntentReceipt).toHaveBeenCalledWith(
      "Group 2 layers",
      expect.objectContaining({
        kind: "group",
        children: expect.arrayContaining([
          expect.objectContaining({ id: "a", position: { x: 0, y: 0 } }),
          expect.objectContaining({ id: "b", position: { x: 60, y: 40 } }),
        ]),
      }),
      expect.objectContaining({ targetIds: expect.arrayContaining(["a", "b"]) }),
    );
  });

  it("creates a selected editable Image node at the canvas cursor", () => {
    const anchor = rectangle("anchor", null, 40, 60);
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    );
    const src = `data:image/png;base64,${btoa(
      String.fromCharCode(...bytes),
    )}`;
    const { appendTrace, commitScene, value } = actions(
      [anchor],
      [anchor.id],
      () => ({ x: 412.5, y: -84.25 }),
    );

    value.pasteImage({
      alt: "Pasted image",
      byteLength: bytes.byteLength,
      height: 1,
      mimeType: "image/png",
      src,
      width: 1,
    });

    const next = commitScene.mock.calls[0]?.[1] as readonly WorkbenchNode[];
    expect(next.at(-1)).toMatchObject({
      hidden: false,
      image: {
        alt: "Pasted image",
        byteLength: bytes.byteLength,
        height: 1,
        mimeType: "image/png",
        src,
        width: 1,
      },
      kind: "Image",
      locked: false,
      name: "Pasted image",
      parentId: null,
      position: { x: 412.5, y: -84.25 },
      size: { height: 1, width: 1 },
    });
    expect(commitScene.mock.calls[0]?.[0]).toBe("Paste image");
    expect(commitScene.mock.calls[0]?.[2]).toMatchObject({
      selectedIds: ["image-1"],
      targetIds: ["image-1"],
    });
    expect(appendTrace).toHaveBeenCalledWith(
      "Pasted image at cursor",
      "image-1",
    );
  });

  it("uses a deterministic near-selection fallback when no cursor is known", () => {
    const anchor = rectangle("anchor", null, 40, 60);
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    );
    const { appendTrace, commitScene, value } = actions(
      [anchor],
      [anchor.id],
    );

    value.pasteImage({
      alt: "Fallback image",
      byteLength: bytes.byteLength,
      height: 1,
      mimeType: "image/png",
      src: `data:image/png;base64,${btoa(
        String.fromCharCode(...bytes),
      )}`,
      width: 1,
    });

    const next = commitScene.mock.calls[0]?.[1] as readonly WorkbenchNode[];
    expect(next.at(-1)?.position).toEqual({ x: 64, y: 84 });
    expect(appendTrace).toHaveBeenCalledWith(
      "Pasted image near selection",
      "image-1",
    );
  });

  it("pastes into the selected frame instead of beside it", () => {
    const container = frame("frame-1", null, 100, 120);
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    );
    const { commitScene, value } = actions(
      [container],
      [container.id],
      () => ({ x: 144, y: 168 }),
    );

    value.pasteImage({
      alt: "Nested image",
      byteLength: bytes.byteLength,
      height: 1,
      mimeType: "image/png",
      src: `data:image/png;base64,${btoa(
        String.fromCharCode(...bytes),
      )}`,
      width: 1,
    });

    const next = commitScene.mock.calls[0]?.[1] as readonly WorkbenchNode[];
    expect(next.at(-1)).toMatchObject({
      id: "image-1",
      kind: "Image",
      parentId: "frame-1",
      position: { x: 144, y: 168 },
    });
  });

  it("prefers a current system clipboard payload over an older session payload", async () => {
    const sessionNode = rectangle("session", null, 0, 0);
    const systemNode = rectangle("system", null, 80, 40);
    const systemPayload = createCanvasClipboardPayload({
      documentId: "system-document",
      nodes: [systemNode],
      selectedIds: [systemNode.id],
    });
    copyCanvasSelection({
      documentId: "session-document",
      nodes: [sessionNode],
      selectedIds: [sessionNode.id],
    });
    expect(systemPayload).not.toBeNull();
    vi.stubGlobal("navigator", {
      clipboard: {
        async read() {
          return [
            {
              getType: async () =>
                new Blob(
                  [serializeCanvasClipboardFallback(systemPayload!)],
                  { type: MEMI_CANVAS_CLIPBOARD_MIME },
                ),
              types: [MEMI_CANVAS_CLIPBOARD_MIME],
            },
          ];
        },
        async write() {
          return undefined;
        },
      },
    });
    const { commitScene, value } = actions([], []);

    value.pasteSelection();

    await vi.waitFor(() => {
      expect(commitScene).toHaveBeenCalledTimes(1);
    });
    const pasted = commitScene.mock.calls[0]?.[1] as readonly WorkbenchNode[];
    expect(pasted.map(({ id }) => id)).toEqual(["system-copy-1"]);
  });

  it("groups only siblings at their first stacking position and preserves world geometry", () => {
    const nodes = [
      rectangle("before", null, 0, 0),
      rectangle("a", null, 100, 80),
      rectangle("between", null, 140, 0),
      rectangle("b", null, 160, 120),
      rectangle("after", null, 240, 0),
    ];
    const { commitScene, value } = actions(nodes, ["b", "a"]);

    value.groupSelection();

    const next = commitScene.mock.calls[0]?.[1] as readonly WorkbenchNode[];
    expect(next.map(({ id }) => id)).toEqual([
      "before",
      "node-group-1",
      "a",
      "between",
      "b",
      "after",
    ]);
    expect(next.find(({ id }) => id === "node-group-1")).toMatchObject({
      parentId: null,
      position: { x: 100, y: 80 },
      size: { height: 80, width: 100 },
    });
    expect(next.find(({ id }) => id === "a")).toMatchObject({
      parentId: "node-group-1",
      position: { x: 100, y: 80 },
    });
    expect(next.find(({ id }) => id === "b")).toMatchObject({
      parentId: "node-group-1",
      position: { x: 160, y: 120 },
    });
  });

  it("does not silently hoist selections from different parents", () => {
    const nodes = [
      rectangle("frame-a", null, 0, 0),
      rectangle("frame-b", null, 200, 0),
      rectangle("a", "frame-a", 10, 10),
      rectangle("b", "frame-b", 210, 10),
    ];
    const { commitScene, value } = actions(nodes, ["a", "b"]);

    value.groupSelection();

    expect(commitScene).not.toHaveBeenCalled();
  });

  it("ungroups in place and restores children at the group stacking position", () => {
    const nodes = [
      rectangle("before", null, 0, 0),
      {
        ...rectangle("group", null, 100, 80),
        kind: "Group" as const,
      },
      rectangle("a", "group", 100, 80),
      rectangle("b", "group", 160, 120),
      rectangle("after", null, 240, 0),
    ];
    const { commitScene, value } = actions(nodes, ["group"]);

    value.ungroupSelection();

    const next = commitScene.mock.calls[0]?.[1] as readonly WorkbenchNode[];
    expect(next.map(({ id }) => id)).toEqual([
      "before",
      "a",
      "b",
      "after",
    ]);
    expect(next.find(({ id }) => id === "a")?.parentId).toBeNull();
    expect(next.find(({ id }) => id === "b")?.parentId).toBeNull();
  });

  it("ungroups multiple groups at each original stacking position", () => {
    const nodes = [
      { ...rectangle("group-a", null, 0, 0), kind: "Group" as const },
      rectangle("a", "group-a", 0, 0),
      rectangle("between", null, 80, 0),
      { ...rectangle("group-b", null, 160, 0), kind: "Group" as const },
      rectangle("b", "group-b", 160, 0),
      rectangle("after", null, 240, 0),
    ];
    const { commitScene, value } = actions(nodes, ["group-a", "group-b"]);

    value.ungroupSelection();

    const next = commitScene.mock.calls[0]?.[1] as readonly WorkbenchNode[];
    expect(next.map(({ id }) => id)).toEqual([
      "a",
      "between",
      "b",
      "after",
    ]);
  });

  it("duplicates an entire selected group hierarchy with stable parent links", () => {
    const nodes = [
      {
        ...rectangle("group", null, 100, 80),
        kind: "Group" as const,
      },
      rectangle("a", "group", 100, 80),
      rectangle("b", "group", 160, 120),
    ];
    const { commitScene, value } = actions(nodes, ["group"]);

    value.duplicateSelection();

    const next = commitScene.mock.calls[0]?.[1] as readonly WorkbenchNode[];
    const copies = next.slice(nodes.length);
    expect(copies).toHaveLength(3);
    expect(copies[0]).toMatchObject({
      id: "group-copy-1",
      parentId: null,
      position: { x: 116, y: 96 },
    });
    expect(copies.slice(1).map(({ parentId }) => parentId)).toEqual([
      "group-copy-1",
      "group-copy-1",
    ]);
    expect(copies.slice(1).map(({ position }) => position)).toEqual([
      { x: 116, y: 96 },
      { x: 176, y: 136 },
    ]);
  });

  it("duplicates a subtree even when legacy input lists a child before its parent", () => {
    const child = rectangle("child", "group", 20, 20);
    const group = {
      ...rectangle("group", null, 10, 10),
      kind: "Group" as const,
    };
    const { commitScene, value } = actions([child, group], ["group"]);

    value.duplicateSelection();

    const next = commitScene.mock.calls[0]?.[1] as readonly WorkbenchNode[];
    expect(
      next.find(({ id }) => id === "child-copy-1")?.parentId,
    ).toBe("group-copy-1");
  });

  it("reorders only among siblings and keeps descendant blocks together", () => {
    const nodes = [
      { ...rectangle("group", null, 0, 0), kind: "Group" as const },
      rectangle("a", "group", 0, 0),
      rectangle("a-child", "a", 0, 0),
      rectangle("b", "group", 80, 0),
      rectangle("outside", null, 200, 0),
    ];
    const { commitScene, value } = actions(nodes, ["a"]);

    value.orderSelection("front");

    const next = commitScene.mock.calls[0]?.[1] as readonly WorkbenchNode[];
    expect(next.map(({ id }) => id)).toEqual([
      "group",
      "b",
      "a",
      "a-child",
      "outside",
    ]);
  });

  it("applies group visibility to descendants", () => {
    const nodes = [
      { ...rectangle("group", null, 0, 0), kind: "Group" as const },
      rectangle("child", "group", 0, 0),
    ];
    const { commitScene, value } = actions(nodes, ["group"]);

    value.toggleSelectionProperty("hidden");

    const next = commitScene.mock.calls[0]?.[1] as readonly WorkbenchNode[];
    expect(next.map(({ hidden }) => hidden)).toEqual([true, true]);
  });
});
