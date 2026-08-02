import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CANVAS_CLIPBOARD_MAX_DEPTH,
  CANVAS_CLIPBOARD_MAX_BYTES,
  CANVAS_CLIPBOARD_MAX_NODES,
  MEMI_CANVAS_CLIPBOARD_MIME,
  clearCanvasSessionClipboard,
  createCanvasImageNodeAtPoint,
  createCanvasClipboardPayload,
  cutCanvasSelection,
  parseCanvasClipboardFallback,
  pasteCanvasClipboard,
  readCanvasImageFromPasteData,
  readCanvasImageFromSystem,
  readCanvasSessionImage,
  readCanvasClipboardFromPasteData,
  readCanvasClipboardFromSystem,
  readCanvasSessionClipboard,
  serializeCanvasClipboardFallback,
  storeCanvasSessionImage,
  writeCanvasClipboardToSystem,
} from "./canvas-clipboard.js";
import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import type {
  CanvasWorkbenchProject,
  WorkbenchNode,
} from "./model.js";

const componentMaster: WorkbenchNode = {
  id: "component-card",
  kind: "ComponentInstance",
  name: "Card component",
  parentId: null,
  position: { x: 40, y: 80 },
  size: { width: 320, height: 180 },
  layout: {
    alignCounter: "stretch",
    alignPrimary: "space-between",
    gap: 12,
    mode: "vertical",
    padding: { top: 16, right: 20, bottom: 24, left: 28 },
    sizingHorizontal: "fill",
    sizingVertical: "hug",
    wrap: false,
  },
  locked: false,
  hidden: false,
  fill: "#123456",
  provenance: {
    repositoryRevision: "main@abc123",
    sourceAnchor: "src/Card.tsx:12",
    routeId: "route-card",
    stateId: "state-default",
    coverageCellId: "coverage-card",
  },
  component: {
    atomicLevel: "organism",
    componentId: "card",
    componentName: "Card",
    classification: "master",
    editable: {
      label: true,
      icon: false,
      selected: false,
      variant: true,
    },
    props: { label: "Revenue" },
    role: "card",
    source: {
      repositoryRevision: "main@abc123",
      sourceAnchor: "src/Card.tsx:12",
      exportName: "Card",
    },
    variant: "elevated",
  },
};

const componentInstance: WorkbenchNode = {
  ...componentMaster,
  id: "component-card-instance",
  name: "Card instance",
  parentId: componentMaster.id,
  position: { x: 64, y: 104 },
  size: { width: 240, height: 120 },
  component: {
    ...componentMaster.component!,
    classification: "instance",
    masterId: componentMaster.id,
    props: { label: "Pipeline" },
  },
};

function destinationProject(): CanvasWorkbenchProject {
  return {
    ...canvasWorkbenchFixture,
    id: "destination-canvas",
    title: "Destination canvas",
    selectedNodeId: "destination-node",
    document: {
      id: "destination-document",
      revision: 3,
      nodes: [
        {
          id: "destination-node",
          kind: "DraftFrame",
          name: "Destination",
          parentId: null,
          position: { x: 16, y: 16 },
          size: { width: 100, height: 100 },
          locked: false,
          hidden: false,
        },
      ],
    },
    trace: [],
  };
}

afterEach(() => {
  cleanup();
  clearCanvasSessionClipboard();
  vi.unstubAllGlobals();
});

describe("canvas clipboard payload", () => {
  it("creates a bounded truthful image node at the canvas cursor", () => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    );
    const src = `data:image/png;base64,${btoa(
      String.fromCharCode(...bytes),
    )}`;

    expect(
      createCanvasImageNodeAtPoint({
        cursor: { x: 412.5, y: -84.25 },
        image: {
          alt: "Clipboard artwork",
          byteLength: bytes.byteLength,
          height: 1,
          mimeType: "image/png",
          src,
          width: 1,
        },
        nodes: [
          {
            hidden: false,
            id: "image-1",
            kind: "Image",
            locked: false,
            name: "Older image",
            parentId: null,
            position: { x: 0, y: 0 },
            size: { height: 1, width: 1 },
            image: {
              alt: "Older image",
              byteLength: bytes.byteLength,
              height: 1,
              mimeType: "image/png",
              src,
              width: 1,
            },
          },
        ],
        parentId: null,
      }),
    ).toEqual({
      hidden: false,
      id: "image-2",
      image: {
        alt: "Clipboard artwork",
        byteLength: bytes.byteLength,
        height: 1,
        mimeType: "image/png",
        src,
        width: 1,
      },
      kind: "Image",
      locked: false,
      name: "Clipboard artwork",
      parentId: null,
      position: { x: 412.5, y: -84.25 },
      size: { height: 1, width: 1 },
    });

    expect(
      createCanvasImageNodeAtPoint({
        cursor: { x: 0, y: 0 },
        image: {
          alt: "Forged dimensions",
          byteLength: bytes.byteLength,
          height: 2,
          mimeType: "image/png",
          src,
          width: 2,
        },
        nodes: [],
        parentId: null,
      }),
    ).toBeNull();
  });

  it("keeps a verified image in memory when system clipboard access is denied", async () => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    );
    const image = await readCanvasImageFromPasteData({
      getData: () => "",
      items: [
        {
          getAsFile: () => new Blob([bytes], { type: "image/png" }),
          type: "image/png",
        },
      ],
      types: ["image/png"],
    });
    expect(image).not.toBeNull();
    expect(storeCanvasSessionImage(image!)).toBe(true);
    expect(readCanvasSessionImage()).toEqual(image);

    await expect(
      readCanvasImageFromSystem({
        clipboard: {
          async read() {
            throw new DOMException(
              "Clipboard read access denied",
              "NotAllowedError",
            );
          },
          async write() {
            return undefined;
          },
        },
      }),
    ).resolves.toEqual(image);
  });

  it("rejects invalid session images, dangling parents, and non-image system items", async () => {
    expect(readCanvasSessionImage()).toBeNull();
    expect(
      storeCanvasSessionImage({
        alt: "Not PNG pixels",
        byteLength: 4,
        height: 1,
        mimeType: "image/png",
        src: "data:image/png;base64,bm9wZQ==",
        width: 1,
      }),
    ).toBe(false);
    await expect(
      readCanvasImageFromSystem({
        clipboard: {
          async read() {
            return [
              {
                async getType() {
                  return new Blob(["text"], { type: "text/plain" });
                },
                types: ["text/plain"],
              },
            ];
          },
          async write() {
            return undefined;
          },
        },
      }),
    ).resolves.toBeNull();

    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    );
    expect(
      createCanvasImageNodeAtPoint({
        cursor: { x: 0, y: 0 },
        image: {
          alt: "Pasted image",
          byteLength: bytes.byteLength,
          height: 1,
          mimeType: "image/png",
          src: `data:image/png;base64,${btoa(
            String.fromCharCode(...bytes),
          )}`,
          width: 1,
        },
        nodes: [],
        parentId: "missing-frame",
      }),
    ).toBeNull();
  });

  it("copies a selected hierarchy with styles, provenance, and component references", () => {
    const payload = createCanvasClipboardPayload({
      documentId: "source-document",
      nodes: [componentMaster, componentInstance],
      selectedIds: [componentMaster.id, componentInstance.id],
    });

    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({
      mime: MEMI_CANVAS_CLIPBOARD_MIME,
      rootIds: [componentMaster.id],
      sourceDocumentId: "source-document",
      version: 1,
    });
    expect(payload?.nodes).toEqual([componentMaster, componentInstance]);

    const fallback = serializeCanvasClipboardFallback(payload!);
    expect(parseCanvasClipboardFallback(fallback)).toEqual(payload);
  });

  it("round-trips a validated payload through the supported system clipboard", async () => {
    const payload = createCanvasClipboardPayload({
      documentId: "source-document",
      nodes: [componentMaster, componentInstance],
      selectedIds: [componentMaster.id],
    });
    const written: Array<{
      readonly getType: (type: string) => Promise<Blob>;
      readonly types: readonly string[];
    }> = [];
    const clipboard = {
      async read() {
        return written;
      },
      async write(items: readonly (typeof written)[number][]) {
        written.splice(0, written.length, ...items);
      },
    };

    expect(payload).not.toBeNull();
    await expect(
      writeCanvasClipboardToSystem(payload!, {
        clipboard,
        createItem: (items) => ({
          getType: async (type) => items[type]!,
          types: Object.keys(items),
        }),
      }),
    ).resolves.toBe(true);
    await expect(
      readCanvasClipboardFromSystem({ clipboard }),
    ).resolves.toEqual(payload);
  });

  it("retains a valid payload in session memory when system clipboard access is denied", async () => {
    const payload = createCanvasClipboardPayload({
      documentId: "source-document",
      nodes: [componentMaster, componentInstance],
      selectedIds: [componentMaster.id],
    });
    const deniedClipboard = {
      async read() {
        throw new DOMException("Clipboard read access denied", "NotAllowedError");
      },
      async write() {
        throw new DOMException("Clipboard write access denied", "NotAllowedError");
      },
    };

    expect(payload).not.toBeNull();
    await expect(
      writeCanvasClipboardToSystem(payload!, {
        clipboard: deniedClipboard,
        createItem: (items) => ({
          getType: async (type) => items[type]!,
          types: Object.keys(items),
        }),
      }),
    ).resolves.toBe(false);
    await expect(
      readCanvasClipboardFromSystem({ clipboard: deniedClipboard }),
    ).resolves.toEqual(payload);
  });

  it("does not fabricate a Canvas reference from an image-only paste", () => {
    expect(
      readCanvasClipboardFromPasteData({
        getData: () => "",
        types: ["image/png"],
      } satisfies Pick<DataTransfer, "getData" | "types">),
    ).toBeNull();
  });

  it("reads a real PNG paste into serializable image data without a blob URL", async () => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    );
    const image = await readCanvasImageFromPasteData({
      getData: () => "",
      items: [
        {
          getAsFile: () => new Blob([bytes], { type: "image/png" }),
          type: "image/png",
        },
      ],
      types: ["image/png"],
    });

    expect(image).toEqual({
      alt: "Pasted image",
      byteLength: bytes.byteLength,
      height: 1,
      mimeType: "image/png",
      src: expect.stringMatching(/^data:image\/png;base64,/u),
      width: 1,
    });
    expect(image?.src).not.toContain("blob:");
  });

  it("rejects malformed, oversized, and over-deep payloads", () => {
    const valid = createCanvasClipboardPayload({
      documentId: "source-document",
      nodes: [componentMaster, componentInstance],
      selectedIds: [componentMaster.id],
    });
    expect(valid).not.toBeNull();

    expect(
      parseCanvasClipboardFallback(
        JSON.stringify({ ...valid, mime: "application/json" }),
      ),
    ).toBeNull();
    expect(
      parseCanvasClipboardFallback(
        " ".repeat(CANVAS_CLIPBOARD_MAX_BYTES + 1),
      ),
    ).toBeNull();
    expect(
      parseCanvasClipboardFallback(
        JSON.stringify({
          ...valid,
          nodes: [valid!.nodes[0], valid!.nodes[0]],
        }),
      ),
    ).toBeNull();
    expect(
      createCanvasClipboardPayload({
        documentId: "source-document",
        nodes: Array.from(
          { length: CANVAS_CLIPBOARD_MAX_NODES + 1 },
          (_, index): WorkbenchNode => ({
            ...componentMaster,
            id: `node-${index}`,
            parentId: null,
          }),
        ),
        selectedIds: Array.from(
          { length: CANVAS_CLIPBOARD_MAX_NODES + 1 },
          (_, index) => `node-${index}`,
        ),
      }),
    ).toBeNull();

    const deepNodes = Array.from(
      { length: CANVAS_CLIPBOARD_MAX_DEPTH + 1 },
      (_, index): WorkbenchNode => ({
        ...componentMaster,
        id: `depth-${index}`,
        parentId: index === 0 ? null : `depth-${index - 1}`,
      }),
    );
    expect(
      createCanvasClipboardPayload({
        documentId: "source-document",
        nodes: deepNodes,
        selectedIds: ["depth-0"],
      }),
    ).toBeNull();
  });

  it("pastes fresh collision-safe ids with one offset and remapped hierarchy references", () => {
    const payload = createCanvasClipboardPayload({
      documentId: "source-document",
      nodes: [componentMaster, componentInstance],
      selectedIds: [componentMaster.id],
    });
    const collision = {
      ...componentMaster,
      id: `${componentMaster.id}-copy-1`,
    };

    const result = pasteCanvasClipboard([componentMaster, collision], payload);

    expect(result).not.toBeNull();
    expect(new Set(result?.pastedNodes.map(({ id }) => id)).size).toBe(2);
    expect(result?.pastedNodes[0]).toMatchObject({
      id: `${componentMaster.id}-copy-2`,
      parentId: null,
      position: { x: 64, y: 104 },
      fill: componentMaster.fill,
      provenance: componentMaster.provenance,
    });
    expect(result?.pastedNodes[1]).toMatchObject({
      parentId: `${componentMaster.id}-copy-2`,
      position: { x: 88, y: 128 },
      component: {
        masterId: `${componentMaster.id}-copy-2`,
        source: componentInstance.component?.source,
      },
    });
  });

  it("round-trips nested hierarchy and reconnects an external component by semantic identity", () => {
    const frame: WorkbenchNode = {
      hidden: false,
      id: "frame",
      kind: "Frame",
      locked: false,
      name: "Card frame",
      parentId: null,
      position: { x: 100, y: 120 },
      size: { height: 240, width: 360 },
    };
    const group: WorkbenchNode = {
      ...frame,
      id: "group",
      kind: "Group",
      name: "Card content",
      parentId: frame.id,
      position: { x: 116, y: 136 },
      size: { height: 160, width: 328 },
    };
    const externalInstance: WorkbenchNode = {
      ...componentInstance,
      id: "nested-instance",
      parentId: group.id,
      component: {
        ...componentInstance.component!,
        masterId: "source-card-master",
        props: {
          label: "Explicit label",
          supportingText: "Explicit detail",
        },
      },
    };
    const payload = createCanvasClipboardPayload({
      documentId: "source-document",
      nodes: [frame, group, externalInstance],
      selectedIds: [frame.id],
    });
    const destinationMaster: WorkbenchNode = {
      ...componentMaster,
      id: "destination-card-master",
      component: {
        ...componentMaster.component!,
        componentId: externalInstance.component!.componentId,
      },
    };

    const result = pasteCanvasClipboard([destinationMaster], payload);

    expect(result?.pastedNodes).toHaveLength(3);
    const pastedFrame = result?.pastedNodes[0];
    const pastedGroup = result?.pastedNodes[1];
    const pastedInstance = result?.pastedNodes[2];
    expect(pastedGroup?.parentId).toBe(pastedFrame?.id);
    expect(pastedInstance?.parentId).toBe(pastedGroup?.id);
    expect(pastedInstance?.component).toMatchObject({
      masterId: destinationMaster.id,
      props: {
        label: "Explicit label",
        supportingText: "Explicit detail",
      },
      source: externalInstance.component?.source,
    });
    expect(pastedInstance?.fill).toBe(componentInstance.fill);
    expect(pastedInstance?.provenance).toEqual(componentInstance.provenance);
  });

  it("drops an instance master reference when its external master is unavailable", () => {
    const externalInstance: WorkbenchNode = {
      ...componentInstance,
      id: "external-instance",
      parentId: null,
      component: {
        ...componentInstance.component!,
        masterId: "external-master",
      },
    };
    const payload = createCanvasClipboardPayload({
      documentId: "source-document",
      nodes: [externalInstance],
      selectedIds: [externalInstance.id],
    });

    const result = pasteCanvasClipboard([], payload);

    expect(result?.pastedNodes[0]?.component?.masterId).toBeUndefined();
  });

  it("cuts only deletable hierarchy nodes while retaining source-backed nodes", () => {
    const sourceBacked: WorkbenchNode = {
      ...componentMaster,
      id: "source-frame",
      kind: "CodeFrame",
      source: {
        repositoryRevision: "main@abc123",
        routeId: "route-home",
        stateId: "state-default",
        coverageCellId: "coverage-home",
        sourceAnchor: "src/Home.tsx:1",
        viewport: {
          name: "desktop",
          width: 1440,
          height: 900,
        },
      },
    };
    const { component: _component, ...draftBase } = componentMaster;
    const draft: WorkbenchNode = {
      ...draftBase,
      id: "draft-frame",
      kind: "DraftFrame" as const,
    };

    const result = cutCanvasSelection({
      documentId: "source-document",
      nodes: [sourceBacked, draft],
      selectedIds: [sourceBacked.id, draft.id],
    });

    expect(result?.payload.nodes.map(({ id }) => id)).toEqual([draft.id]);
    expect(result?.deletedIds).toEqual([draft.id]);
    expect(result?.nodes).toEqual([sourceBacked]);
  });
});

describe("CanvasWorkbench clipboard integration", () => {
  it("pastes system image/png data when the keyboard shortcut prevents the browser paste event", async () => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    );
    vi.stubGlobal("navigator", {
      clipboard: {
        async read() {
          return [
            {
              getType: async () => new Blob([bytes], { type: "image/png" }),
              types: ["image/png"],
            },
          ];
        },
        async write() {
          return undefined;
        },
      },
    });
    render(<CanvasWorkbench project={destinationProject()} />);

    fireEvent.keyDown(document, { ctrlKey: true, key: "v" });

    expect(
      await screen.findByRole("button", { name: "Pasted image on canvas" }),
    ).toBeTruthy();
  });

  it("pastes a native image/png clipboard item as an editable Image node", async () => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    );
    render(<CanvasWorkbench project={destinationProject()} />);
    fireEvent.pointerMove(screen.getByRole("region", { name: "Infinite canvas" }), {
      clientX: 312,
      clientY: 228,
      pointerId: 1,
    });
    const pasteEvent = new Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: () => "",
        items: [
          {
            getAsFile: () => new Blob([bytes], { type: "image/png" }),
            type: "image/png",
          },
        ],
        types: ["image/png"],
      },
    });

    act(() => {
      document.dispatchEvent(pasteEvent);
    });

    expect(pasteEvent.defaultPrevented).toBe(true);
    const imageNode = await screen.findByRole("button", {
      name: "Pasted image on canvas",
    });
    const image = within(imageNode).getByRole("img", {
      name: "Pasted image",
    });
    expect(image.getAttribute("src")).toMatch(/^data:image\/png;base64,/u);
    expect(image.getAttribute("src")).not.toContain("blob:");
    expect(imageNode.parentElement?.style.left).toBe("312px");
    expect(imageNode.parentElement?.style.top).toBe("228px");
  });

  it("pastes the validated Memi MIME payload delivered by a browser paste event", () => {
    const payload = createCanvasClipboardPayload({
      documentId: canvasWorkbenchFixture.document.id,
      nodes: canvasWorkbenchFixture.document.nodes,
      selectedIds: ["node-campaign-card"],
    });
    expect(payload).not.toBeNull();
    render(<CanvasWorkbench project={destinationProject()} />);
    const pasteEvent = new Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (type: string) =>
          type === MEMI_CANVAS_CLIPBOARD_MIME
            ? serializeCanvasClipboardFallback(payload!)
            : "",
        types: [MEMI_CANVAS_CLIPBOARD_MIME],
      },
    });

    act(() => {
      document.dispatchEvent(pasteEvent);
    });

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(
      screen.getByRole("button", { name: "Campaign card on canvas" }),
    ).toBeTruthy();
  });

  it("keeps the internal clipboard across document remounts and pastes in one history and trace entry", () => {
    const first = render(
      <CanvasWorkbench project={canvasWorkbenchFixture} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Campaign card on canvas" }),
    );
    fireEvent.keyDown(document, { key: "c", metaKey: true });
    expect(readCanvasSessionClipboard()?.rootIds).toEqual([
      "node-campaign-card",
    ]);

    first.unmount();
    render(<CanvasWorkbench project={destinationProject()} />);
    fireEvent.keyDown(document, { key: "v", ctrlKey: true });

    expect(
      screen.getByRole("button", { name: "Campaign card on canvas" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Agent activity" }));
    const history = screen.getByRole("list", { name: "Semantic history" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(1);
    expect(within(history).getByText("Paste 3 layers")).toBeTruthy();
    expect(
      within(screen.getByRole("log", { name: "Trace" })).getAllByText(
        "Human · Paste 3 layers · r3 → r4 · applied",
      ),
    ).toHaveLength(1);
  });

  it("supports copy, cut, and paste shortcuts without relying on clipboard permissions", () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} />);

    const dashboard = screen.getByRole("button", {
      name: "Dashboard desktop on canvas",
    });
    fireEvent.click(dashboard);
    fireEvent.keyDown(document, { key: "x", metaKey: true });
    expect(dashboard.isConnected).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Campaign card on canvas" }),
    );
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });
    fireEvent.keyDown(document, { key: "v", ctrlKey: true });
    expect(
      screen.getAllByRole("button", { name: "Campaign card on canvas" }),
    ).toHaveLength(2);
    fireEvent.keyDown(document, { key: "x", ctrlKey: true });
    expect(
      screen.getAllByRole("button", { name: "Campaign card on canvas" }),
    ).toHaveLength(1);
    fireEvent.keyDown(document, { key: "v", ctrlKey: true });
    expect(
      screen.getAllByRole("button", { name: "Campaign card on canvas" }),
    ).toHaveLength(2);
  });

  it("offers Cut, Copy, and Paste in the selection context menu", () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} />);
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Campaign card on canvas" }),
      { clientX: 320, clientY: 240 },
    );

    const menu = screen.getByRole("menu", {
      name: "Canvas selection actions",
    });
    expect(within(menu).getByRole("menuitem", { name: /Cut/ })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /Copy/ })).toBeTruthy();
    expect(
      within(menu).getByRole("menuitem", { name: /Paste/ }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
  });
});
