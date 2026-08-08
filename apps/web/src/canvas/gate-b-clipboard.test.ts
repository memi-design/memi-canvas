import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";
import { CanvasPageIdSchema } from "@memi/protocol";

import {
  MEMI_CANVAS_CLIPBOARD_MIME,
  clearCanvasSessionClipboard,
  createCanvasClipboardPayload,
  pasteCanvasClipboard,
  serializeCanvasClipboardFallback,
  type CanvasClipboardPayload,
} from "./canvas-clipboard.js";
import type { Point, WorkbenchNode } from "./model.js";
import { createWorkbenchDocumentActions } from "./workbench-document-actions.js";
import { compileWorkbenchIntentReceiptV3 } from "./workbench-v3-intents.js";
import { projectCanvasDocumentV3ToWorkbench } from "./canvas-v3-workbench-projection.js";

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

  it("round-trips hierarchy, styles, components, provenance, and image pixels through V3", () => {
    const frame: WorkbenchNode = {
      ...rectangle("frame", { x: 100, y: 200 }),
      cornerRadii: [4, 8, 12, 16],
      fill: "#112233",
      kind: "Frame",
      opacity: 0.75,
      provenance: {
        coverageCellId: null,
        repositoryRevision: "buzzr@abc123",
        routeId: null,
        sourceAnchor: "src/Card.tsx#Card",
        stateId: null,
      },
      size: { height: 240, width: 320 },
      stroke: "#445566",
      strokeAlign: "inside",
      strokeWeight: 2,
    };
    const component: NonNullable<WorkbenchNode["component"]> = {
      atomicLevel: "molecule",
      classification: "master",
      componentId: "card",
      componentName: "Card",
      editable: { icon: false, label: true, selected: false, variant: true },
      props: { label: "Card" },
      role: "card",
      source: {
        exportName: "Card",
        repositoryRevision: "buzzr@abc123",
        sourceAnchor: "src/Card.tsx#Card",
      },
      variant: "default",
    };
    const master: WorkbenchNode = {
      ...rectangle("master", { x: 124, y: 232 }, frame.id),
      component,
      kind: "Component",
      size: { height: 80, width: 120 },
    };
    const instance: WorkbenchNode = {
      ...rectangle("instance", { x: 260, y: 232 }, frame.id),
      component: {
        ...component,
        classification: "instance",
        masterId: master.id,
        props: { label: "Instance" },
      },
      kind: "ComponentInstance",
      size: { height: 80, width: 120 },
    };
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==";
    const image: WorkbenchNode = {
      ...rectangle("image", { x: 124, y: 336 }, frame.id),
      image: {
        alt: "Card pixel",
        byteLength: 70,
        height: 1,
        mimeType: "image/png",
        src: png,
        width: 1,
      },
      kind: "Image",
      size: { height: 1, width: 1 },
    };
    const pasted = pasteCanvasClipboard(
      [],
      payload([frame, master, instance, image]),
      { kind: "cursor", point: { x: 640, y: 480 } },
    )!;
    const pageId = CanvasPageIdSchema.parse("pag_01J00000000000000000000000");
    const document = createCanvasDocumentV3({
      id: "doc_01J00000000000000000000000",
      initialPage: { id: pageId, kind: "design", name: "Canvas" },
      projectId: "prj_01J00000000000000000000000",
    });
    const action = compileWorkbenchIntentReceiptV3({
      document,
      pageId,
      receipt: { kind: "paste", nodes: pasted.pastedNodes },
    });
    const next = applyCanvasOperationV3(
      document,
      prepareCanvasOperationV3(document, {
        action,
        actor: "human",
        actorId: "local-user",
        id: "opn_01J00000000000000000000000",
        label: "Paste 4 layers",
        occurredAt: "2026-08-08T12:00:00.000Z",
      }),
    );
    const projected = projectCanvasDocumentV3ToWorkbench(next, pageId);
    const projectedFrame = projected.find(({ name }) => name === "frame copy")!;
    const projectedMaster = projected.find(({ name }) => name === "master")!;
    const projectedInstance = projected.find(({ name }) => name === "instance")!;
    const projectedImage = projected.find(({ name }) => name === "image")!;

    expect(projected.map(({ position }) => position)).toEqual(
      pasted.pastedNodes.map(({ position }) => position),
    );
    expect(projectedFrame).toMatchObject({
      cornerRadii: frame.cornerRadii,
      fill: frame.fill,
      opacity: frame.opacity,
      provenance: frame.provenance,
      stroke: frame.stroke,
      strokeAlign: frame.strokeAlign,
      strokeWeight: frame.strokeWeight,
    });
    expect(projectedMaster.component?.classification).toBe("master");
    expect(projectedInstance.component).toMatchObject({
      classification: "instance",
      masterId: projectedMaster.id,
      props: { label: "Instance" },
    });
    expect(projectedImage.image).toEqual(image.image);
  });

  it("keeps the stored context-menu point when pasting a native image", () => {
    const commitIntentReceipt = vi.fn();
    const actions = createWorkbenchDocumentActions({
      appendTrace: vi.fn(),
      commitIntentReceipt,
      commitScene: vi.fn(),
      documentId: "document",
      getPastePoint: () => ({ x: 999, y: 999 }),
      nodes: [],
      selectedNode: undefined,
      selectedNodeId: null,
      selectedNodeIds: [],
    });
    const image = {
      alt: "Native pixel",
      byteLength: 70,
      height: 1,
      mimeType: "image/png" as const,
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
      width: 1,
    };

    Reflect.apply(actions.pasteImage, undefined, [
      image,
      { x: 320, y: 240 },
    ]);

    expect(commitIntentReceipt).toHaveBeenCalledWith(
      "Paste image",
      {
        kind: "paste",
        nodes: [expect.objectContaining({ position: { x: 320, y: 240 } })],
      },
      expect.objectContaining({ selectedIds: ["image-1"] }),
    );
  });

  it("allocates distinct ids for rapid paste receipts before a render refresh", () => {
    const source = rectangle("card", { x: 40, y: 80 });
    const commitIntentReceipt = vi.fn();
    const actions = createWorkbenchDocumentActions({
      appendTrace: vi.fn(),
      commitIntentReceipt,
      commitScene: vi.fn(),
      documentId: "document",
      nodes: [source],
      selectedNode: source,
      selectedNodeId: source.id,
      selectedNodeIds: [source.id],
    });
    actions.copySelection();

    actions.pasteSelection();
    actions.pasteSelection();

    expect(commitIntentReceipt.mock.calls.map((call) =>
      call[1].nodes[0].id,
    )).toEqual(["card-copy-1", "card-copy-2"]);
  });

  it("shares id reservations between rapid duplicate and paste actions", () => {
    const source = rectangle("card", { x: 40, y: 80 });
    const commitIntentReceipt = vi.fn();
    const actions = createWorkbenchDocumentActions({
      appendTrace: vi.fn(),
      commitIntentReceipt,
      commitScene: vi.fn(),
      documentId: "document",
      nodes: [source],
      selectedNode: source,
      selectedNodeId: source.id,
      selectedNodeIds: [source.id],
    });
    actions.copySelection();

    actions.duplicateSelection();
    actions.pasteSelection();

    expect(commitIntentReceipt.mock.calls.map((call) =>
      call[1].nodes[0].id,
    )).toEqual(["card-copy-1", "card-copy-2"]);
  });

  it("rejects custom MIME images whose declared metadata does not match the PNG", () => {
    const forged: WorkbenchNode = {
      ...rectangle("forged-image", { x: 20, y: 30 }),
      image: {
        alt: "Forged pixel",
        byteLength: 1,
        height: 1,
        mimeType: "image/png",
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
        width: 1,
      },
      kind: "Image",
      size: { height: 1, width: 1 },
    };

    expect(createCanvasClipboardPayload({
      documentId: "untrusted-document",
      nodes: [forged],
      selectedIds: [forged.id],
    })).toBeNull();
  });
});

describe("Gate B native clipboard fallback receipt", () => {
  it("prefers a fresh native Memi payload over an older in-session node copy", async () => {
    const stale = rectangle("stale", { x: 40, y: 80 });
    const fresh = payload([rectangle("fresh", { x: 160, y: 180 })]);
    const read = vi.fn(async () => [{
      getType: async () => new Blob(
        [serializeCanvasClipboardFallback(fresh)],
        { type: MEMI_CANVAS_CLIPBOARD_MIME },
      ),
      types: [MEMI_CANVAS_CLIPBOARD_MIME],
    }]);
    vi.stubGlobal("navigator", {
      clipboard: { read, async write() { return undefined; } },
    });
    const commitIntentReceipt = vi.fn();
    const actions = createWorkbenchDocumentActions({
      appendTrace: vi.fn(),
      commitIntentReceipt,
      commitScene: vi.fn(),
      documentId: "document",
      nodes: [stale],
      selectedNode: stale,
      selectedNodeId: stale.id,
      selectedNodeIds: [stale.id],
    });
    actions.copySelection();

    actions.pasteSelection();

    await vi.waitFor(() => {
      expect(commitIntentReceipt).toHaveBeenCalledWith(
        "Paste fresh copy",
        {
          kind: "paste",
          nodes: [expect.objectContaining({ id: "fresh-copy-1" })],
        },
        expect.objectContaining({ selectedIds: ["fresh-copy-1"] }),
      );
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("prefers a fresh system PNG over an older in-session node copy", async () => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    );
    const read = vi.fn(async () => [{
      getType: async () => new Blob([bytes], { type: "image/png" }),
      types: ["image/png"],
    }]);
    vi.stubGlobal("navigator", {
      clipboard: { read, async write() { return undefined; } },
    });
    const source = rectangle("card", { x: 40, y: 80 });
    const commitIntentReceipt = vi.fn();
    const actions = createWorkbenchDocumentActions({
      appendTrace: vi.fn(),
      commitIntentReceipt,
      commitScene: vi.fn(),
      documentId: "document",
      nodes: [source],
      selectedNode: source,
      selectedNodeId: source.id,
      selectedNodeIds: [source.id],
    });
    actions.copySelection();

    actions.pasteSelection();

    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      expect(commitIntentReceipt).toHaveBeenCalledWith(
        "Paste image",
        {
          kind: "paste",
          nodes: [expect.objectContaining({
            image: expect.objectContaining({ mimeType: "image/png" }),
          })],
        },
        expect.objectContaining({ selectedIds: ["image-1"] }),
      );
    });
  });

  it("falls back to the latest PNG after native clipboard content disappears", async () => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    );
    const read = vi.fn()
      .mockResolvedValueOnce([{
        getType: async () => new Blob([bytes], { type: "image/png" }),
        types: ["image/png"],
      }])
      .mockResolvedValue([]);
    vi.stubGlobal("navigator", {
      clipboard: { read, async write() { return undefined; } },
    });
    const stale = rectangle("stale", { x: 40, y: 80 });
    const commitIntentReceipt = vi.fn();
    const actions = createWorkbenchDocumentActions({
      appendTrace: vi.fn(),
      commitIntentReceipt,
      commitScene: vi.fn(),
      documentId: "document",
      nodes: [stale],
      selectedNode: stale,
      selectedNodeId: stale.id,
      selectedNodeIds: [stale.id],
    });
    actions.copySelection();
    actions.pasteSelection();
    await vi.waitFor(() => expect(commitIntentReceipt).toHaveBeenCalledWith(
      "Paste image",
      expect.anything(),
      expect.anything(),
    ));
    commitIntentReceipt.mockClear();

    actions.pasteSelection();

    await vi.waitFor(() => expect(commitIntentReceipt).toHaveBeenCalledWith(
      "Paste image",
      {
        kind: "paste",
        nodes: [expect.objectContaining({ id: "image-2" })],
      },
      expect.objectContaining({ selectedIds: ["image-2"] }),
    ));
    expect(read).toHaveBeenCalledTimes(3);
  });

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

  it("abandons a delayed native read after the initiating canvas scope changes", async () => {
    let resolveRead!: (items: readonly never[]) => void;
    const read = vi.fn(() => new Promise<readonly never[]>((resolve) => {
      resolveRead = resolve;
    }));
    vi.stubGlobal("navigator", {
      clipboard: { read, async write() { return undefined; } },
    });
    let scope = "page-a";
    let nodes: readonly WorkbenchNode[] = [];
    const commitIntentReceipt = vi.fn();
    const actions = createWorkbenchDocumentActions({
      appendTrace: vi.fn(),
      commitIntentReceipt,
      commitScene: vi.fn(),
      documentId: "document",
      nodeReservation: {
        get: () => nodes,
        getScope: () => scope,
        isScopeCurrent: (candidate) => candidate === scope,
        set: (next) => { nodes = next; },
      },
      nodes,
      selectedNode: undefined,
      selectedNodeId: null,
      selectedNodeIds: [],
    });

    actions.pasteSelection();
    scope = "page-b";
    resolveRead([]);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());

    expect(commitIntentReceipt).not.toHaveBeenCalled();
  });
});
