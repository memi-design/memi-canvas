import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearCanvasSessionClipboard,
  createCanvasClipboardPayload,
  pasteCanvasClipboard,
  type CanvasClipboardPayload,
} from "./canvas-clipboard.js";
import type { Point, WorkbenchNode } from "./model.js";
import { createWorkbenchDocumentActions } from "./workbench-document-actions.js";

function rectangle(
  id: string,
  position: Point,
  parentId: string | null = null,
): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind: "Rectangle",
    locked: false,
    name: id,
    parentId,
    position,
    size: { height: 40, width: 60 },
  };
}

function payload(nodes: readonly WorkbenchNode[]): CanvasClipboardPayload {
  const result = createCanvasClipboardPayload({
    documentId: "source-document",
    nodes,
    selectedIds: [nodes[0]!.id],
  });
  expect(result).not.toBeNull();
  return result!;
}

afterEach(() => {
  clearCanvasSessionClipboard();
  vi.unstubAllGlobals();
});

describe("Gate B clipboard placement", () => {
  it("places the copied hierarchy center at the cursor with one deterministic translation", () => {
    const frame: WorkbenchNode = {
      ...rectangle("frame", { x: 100, y: 200 }),
      kind: "Frame",
      size: { height: 100, width: 200 },
    };
    const child = rectangle("child", { x: 124, y: 232 }, frame.id);
    const clipboard = payload([frame, child]);

    const result = Reflect.apply(pasteCanvasClipboard, undefined, [
      [],
      clipboard,
      { kind: "cursor", point: { x: 500, y: 400 } },
    ]);

    expect(result?.pastedNodes.map(({ position }) => position)).toEqual([
      { x: 400, y: 350 },
      { x: 424, y: 382 },
    ]);
    expect(result?.selectedIds).toEqual(["frame-copy-1"]);
  });

  it("accepts and preserves detached V3 provenance with nullable route coordinates", () => {
    const detached: WorkbenchNode = {
      ...rectangle("detached", { x: 12, y: 18 }),
      kind: "DraftFrame",
      provenance: {
        captureState: "captured",
        coverageCellId: null,
        repositoryDirty: true,
        repositoryRevision: "buzzr@dirty",
        routeId: null,
        sourceAnchor: "src/Card.tsx#Card",
        sourceContentHash: "sha256:card",
        stateId: null,
      },
    };

    const clipboard = createCanvasClipboardPayload({
      documentId: "source-document",
      nodes: [detached],
      selectedIds: [detached.id],
    });

    expect(clipboard?.nodes[0]?.provenance).toEqual(detached.provenance);
    expect(pasteCanvasClipboard([], clipboard)?.pastedNodes[0]?.provenance)
      .toEqual(detached.provenance);
  });

  it("emits one canonical paste receipt at the cursor instead of committing a scene", () => {
    const source = rectangle("card", { x: 40, y: 80 });
    const commitIntentReceipt = vi.fn();
    const commitScene = vi.fn();
    const actions = createWorkbenchDocumentActions({
      appendTrace: vi.fn(),
      commitIntentReceipt,
      commitScene,
      documentId: "document",
      getPastePoint: () => ({ x: 320, y: 240 }),
      nodes: [source],
      selectedNode: source,
      selectedNodeId: source.id,
      selectedNodeIds: [source.id],
    });
    actions.copySelection();

    Reflect.apply(actions.pasteSelection, undefined, [
      undefined,
      { kind: "cursor" },
    ]);

    expect(commitScene).not.toHaveBeenCalled();
    expect(commitIntentReceipt).toHaveBeenCalledOnce();
    expect(commitIntentReceipt).toHaveBeenCalledWith(
      "Paste card copy",
      {
        kind: "paste",
        nodes: [
          expect.objectContaining({
            id: "card-copy-1",
            position: { x: 290, y: 220 },
          }),
        ],
      },
      expect.objectContaining({ selectedIds: ["card-copy-1"] }),
    );
  });
});

describe("Gate B native clipboard fallback receipt", () => {
  it("keeps the internal copy and reports when the native clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        async read() {
          throw new DOMException("denied", "NotAllowedError");
        },
        async write() {
          throw new DOMException("denied", "NotAllowedError");
        },
      },
    });
    const source = rectangle("card", { x: 40, y: 80 });
    const appendTrace = vi.fn();
    const actions = createWorkbenchDocumentActions({
      appendTrace,
      commitScene: vi.fn(),
      documentId: "document",
      nodes: [source],
      selectedNode: source,
      selectedNodeId: source.id,
      selectedNodeIds: [source.id],
    });

    actions.copySelection();

    await vi.waitFor(() => {
      expect(appendTrace).toHaveBeenCalledWith(
        "Copied card to Memi clipboard; system clipboard unavailable",
        source.id,
      );
    });
  });
});
