import {
  createSelectionContextCapsule,
  createSelectionContextCapsuleFromLegacyDocument,
  hashSelectionContextValue,
  MAX_SELECTION_CONTEXT_BYTES,
  verifySelectionContextCapsule,
} from "./selection-context-capsule.js";
import type { CanvasDocumentV2 } from "@memi/protocol";
import {
  createSelectionState,
  type DesignDocument,
  type DocumentNode,
  type ViewportState,
} from "./model.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function node(
  id: string,
  overrides: Partial<DocumentNode> = {},
): DocumentNode {
  return {
    id,
    kind: "Rectangle",
    name: id,
    parentId: null,
    childIds: [],
    position: { x: 10, y: 20 },
    size: { width: 120, height: 48 },
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    styles: {},
    constraints: { horizontal: "left", vertical: "top" },
    ...overrides,
  };
}

function document(nodes: readonly DocumentNode[]): DesignDocument {
  return {
    id: "document-buzzr",
    revision: 17,
    nodes,
    rootIds: nodes.filter(({ parentId }) => parentId === null).map(({ id }) => id),
  };
}

const viewport: ViewportState = {
  translation: { x: -200, y: 75 },
  zoom: 1.25,
  viewportSize: { width: 1440, height: 900 },
  pointerMode: "select",
};

describe("SelectionContextCapsuleV1", () => {
  it("projects only selected semantic nodes with bounded source, token, component, and artifact evidence", async () => {
    const button = node("button-primary", {
      kind: "Instance",
      name: "Primary button",
      styles: {
        fill: { tokenId: "color.action.primary" },
        radius: "token:radius.control",
      },
      sourceBinding: {
        repositoryRevision: "buzzr-source-42",
        sourceContentHash: HASH_A,
        routeId: "dashboard",
        stateId: "default",
        coverageCellId: "dashboard-mobile-default",
        sourceAnchor: "components/ui/Button.tsx#Button",
        viewport: { name: "mobile", width: 393, height: 852 },
      },
      componentBinding: {
        atomicLevel: "atom",
        componentId: "button",
        componentName: "Button",
        classification: "instance",
        editable: {
          label: true,
          icon: true,
          selected: false,
          variant: true,
        },
        props: { label: "Continue" },
        role: "button",
        source: {
          repositoryRevision: "buzzr-source-42",
          sourceAnchor: "components/ui/Button.tsx#Button",
          sourceContentHash: HASH_A,
          exportName: "Button",
        },
        variant: "primary",
      },
    });
    const title = node("screen-title", {
      kind: "Text",
      name: "Dashboard title",
      styles: { color: { tokenId: "color.text.primary" } },
      provenance: {
        repositoryRevision: "buzzr-source-42",
        sourceAnchor: "app/(protected)/(tabs)/dashboard.tsx#Dashboard",
        sourceContentHash: HASH_B,
        routeId: "dashboard",
        stateId: "default",
        coverageCellId: "dashboard-mobile-default",
      },
    });
    const unselected = node("UNSELECTED_SENTINEL", {
      styles: { privateDocumentPayload: "DO_NOT_SERIALIZE" },
    });

    const capsule = await createSelectionContextCapsuleFromLegacyDocument({
      document: document([unselected, title, button]),
      selection: createSelectionState(["button-primary", "screen-title"]),
      sourceRevision: "buzzr-source-42",
      viewport,
      tokenCandidates: [
        {
          id: "color.text.primary",
          name: "Text / primary",
          value: "#f7f8f8",
        },
        {
          id: "radius.control",
          name: "Radius / control",
          value: 10,
        },
        {
          id: "color.action.primary",
          name: "Action / primary",
          value: "#13d790",
        },
        {
          id: "unused",
          name: "Unused",
          value: "#ff00ff",
        },
      ],
      componentCandidates: [
        {
          id: "unused-component",
          name: "Unused component",
          sourceAnchor: "components/Unused.tsx#Unused",
        },
      ],
      artifactReferences: [
        {
          id: "capture-dashboard",
          kind: "screenshot",
          contentHash: HASH_A,
          mimeType: "image/png",
        },
      ],
    });

    expect(capsule.version).toBe(1);
    expect(capsule.document).toEqual({
      id: "document-buzzr",
      revision: 17,
      sourceRevision: "buzzr-source-42",
    });
    expect(capsule.selectedIds).toEqual(["button-primary", "screen-title"]);
    expect(capsule.selectedNodes.map(({ id }) => id)).toEqual([
      "button-primary",
      "screen-title",
    ]);
    expect(capsule.selectedNodes[0]).toMatchObject({
      childCount: 0,
      componentId: "button",
      kind: "Instance",
      name: "Primary button",
    });
    expect(capsule.sourceAnchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "button-primary",
          sourceAnchor: "components/ui/Button.tsx#Button",
        }),
        expect.objectContaining({
          nodeId: "screen-title",
          sourceAnchor:
            "app/(protected)/(tabs)/dashboard.tsx#Dashboard",
        }),
      ]),
    );
    expect(capsule.relevantTokens.map(({ id }) => id)).toEqual([
      "color.action.primary",
      "color.text.primary",
      "radius.control",
    ]);
    expect(capsule.relevantComponents).toEqual([
      expect.objectContaining({
        atomicLevel: "atom",
        id: "button",
        name: "Button",
        sourceAnchor: "components/ui/Button.tsx#Button",
      }),
    ]);
    expect(capsule.artifactReferences).toHaveLength(1);
    expect(JSON.stringify(capsule)).not.toContain("UNSELECTED_SENTINEL");
    expect(JSON.stringify(capsule)).not.toContain("DO_NOT_SERIALIZE");
    expect(Object.isFrozen(capsule)).toBe(true);
    expect(Object.isFrozen(capsule.selectedNodes)).toBe(true);
    await expect(verifySelectionContextCapsule(capsule)).resolves.toBe(true);
  });

  it("produces canonical hashes independent of document and candidate ordering", async () => {
    const firstNode = node("first", {
      styles: {
        fill: { tokenId: "color.action.primary", opacity: 0.8 },
      },
    });
    const secondNode = node("second", {
      styles: { radius: "token:radius.control" },
    });
    const first = await createSelectionContextCapsuleFromLegacyDocument({
      document: document([firstNode, secondNode]),
      selection: createSelectionState(["second", "first"]),
      sourceRevision: "revision-1",
      viewport,
      tokenCandidates: [
        { id: "radius.control", name: "Radius", value: 10 },
        { id: "color.action.primary", name: "Action", value: "#13d790" },
      ],
    });
    const second = await createSelectionContextCapsuleFromLegacyDocument({
      document: document([secondNode, firstNode]),
      selection: createSelectionState(["second", "first"]),
      sourceRevision: "revision-1",
      viewport,
      tokenCandidates: [
        { id: "color.action.primary", name: "Action", value: "#13d790" },
        { id: "radius.control", name: "Radius", value: 10 },
      ],
    });

    expect(second.selectionSemanticHash).toBe(first.selectionSemanticHash);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it("keeps viewport and artifacts out of the reusable selection semantic hash", async () => {
    const selected = node("selected");
    const base = {
      document: document([selected]),
      selection: createSelectionState(["selected"]),
      sourceRevision: "revision-1",
    } as const;
    const first = await createSelectionContextCapsuleFromLegacyDocument({
      ...base,
      viewport,
    });
    const second = await createSelectionContextCapsuleFromLegacyDocument({
      ...base,
      viewport: {
        ...viewport,
        translation: { x: 999, y: -999 },
        zoom: 4,
      },
      artifactReferences: [
        { id: "preview", kind: "preview", contentHash: HASH_A },
      ],
    });

    expect(second.selectionSemanticHash).toBe(first.selectionSemanticHash);
    expect(second.contentHash).not.toBe(first.contentHash);
  });

  it("rejects unknown selections before serializing document context", async () => {
    await expect(
      createSelectionContextCapsuleFromLegacyDocument({
        document: document([node("known")]),
        selection: createSelectionState(["missing"]),
        sourceRevision: "revision-1",
        viewport,
      }),
    ).rejects.toThrow(/selected node "missing" does not exist/i);
  });

  it("enforces the 64KB inline capsule limit", async () => {
    const selected = node("selected", {
      styles: { payload: "x".repeat(MAX_SELECTION_CONTEXT_BYTES) },
    });

    await expect(
      createSelectionContextCapsuleFromLegacyDocument({
        document: document([selected]),
        selection: createSelectionState(["selected"]),
        sourceRevision: "revision-1",
        viewport,
      }),
    ).rejects.toThrow(/65,536-byte limit/i);
  });

  it("detects a capsule whose canonical hash has been tampered with", async () => {
    const capsule = await createSelectionContextCapsuleFromLegacyDocument({
      document: document([node("selected")]),
      selection: createSelectionState(["selected"]),
      sourceRevision: "revision-1",
      viewport,
    });

    await expect(
      verifySelectionContextCapsule({
        ...capsule,
        contentHash: HASH_A,
      }),
    ).resolves.toBe(false);
  });

  it("uses locale-independent Unicode code-unit ordering for canonical hashes", async () => {
    const canonical = '{"Z":1,"a":2,"é":3,"𝌆":4}';
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical),
    );
    const expected = `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;

    await expect(
      hashSelectionContextValue({ "𝌆": 4, é: 3, a: 2, Z: 1 }),
    ).resolves.toBe(expected);
  });

  it.each([
    {
      label: "repository revision",
      componentRevision: "revision-b",
      componentHash: HASH_A,
      message: /conflicting repository revision/i,
    },
    {
      label: "content hash",
      componentRevision: "revision-a",
      componentHash: HASH_B,
      message: /conflicting content hash/i,
    },
  ])(
    "rejects duplicate legacy anchors with conflicting $label evidence",
    async ({ componentRevision, componentHash, message }) => {
      const selected = node("button", {
        sourceBinding: {
          repositoryRevision: "revision-a",
          sourceContentHash: HASH_A,
          routeId: "dashboard",
          stateId: "default",
          coverageCellId: "dashboard-mobile",
          sourceAnchor: "components/Button.tsx#Button",
          viewport: { name: "mobile", width: 393, height: 852 },
        },
        componentBinding: {
          atomicLevel: "atom",
          componentId: "button",
          componentName: "Button",
          classification: "instance",
          editable: {
            label: true,
            icon: false,
            selected: false,
            variant: true,
          },
          props: { label: "Continue" },
          role: "button",
          source: {
            repositoryRevision: componentRevision,
            sourceAnchor: "components/Button.tsx#Button",
            sourceContentHash: componentHash,
          },
        },
      });

      await expect(
        createSelectionContextCapsuleFromLegacyDocument({
          document: document([selected]),
          selection: createSelectionState([selected.id]),
          sourceRevision: "revision-a",
          viewport,
        }),
      ).rejects.toThrow(message);
    },
  );

  it("projects protocol V2 nodes and structured source anchors without serializing the normalized document", async () => {
    const nodeId = `nod_${"1".repeat(26)}` as CanvasDocumentV2["rootIds"][number];
    const documentId = `doc_${"2".repeat(26)}` as CanvasDocumentV2["id"];
    const projectId = `prj_${"3".repeat(26)}` as CanvasDocumentV2["projectId"];
    const componentId = `cmp_${"4".repeat(26)}` as NonNullable<
      CanvasDocumentV2["nodesById"][string]["componentId"]
    >;
    const v2Document = {
      schemaVersion: 2,
      id: documentId,
      projectId,
      revision: 22,
      stateHash: HASH_A,
      operationCursor: null,
      rootIds: [nodeId],
      nodesById: {
        [nodeId]: {
          id: nodeId,
          kind: "instance",
          name: "Primary button",
          parentId: null,
          childIds: [],
          transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
          geometry: { width: 120, height: 48 },
          style: {
            opacity: 1,
            visible: true,
            locked: false,
            fills: [{ type: "solid", color: "#13d790" }],
            strokes: [],
            cornerRadii: [12, 12, 12, 12],
          },
          layout: {
            mode: "horizontal",
            gap: 8,
            padding: { top: 12, right: 16, bottom: 12, left: 16 },
            alignPrimary: "center",
            alignCounter: "center",
            wrap: false,
            sizingHorizontal: "hug",
            sizingVertical: "fixed",
          },
          text: null,
          content: null,
          componentId,
          instanceOverrides: {
            label: "Continue",
            radiusToken: { tokenId: "radius.control" },
          },
          componentBinding: null,
          provenance: null,
          referenceBinding: null,
          sourceAnchor: {
            path: "components/ui/Button.tsx",
            symbol: "Button",
            astPath: ["SourceFile", "Button"],
            range: { start: 100, end: 220 },
            contentHash: HASH_B,
            sourceRevision: "buzzr-revision-22",
            dirtyFingerprint: HASH_A,
            componentIdentity: "Button",
            runtimeEvidenceRefs: ["capture-button"],
          },
          sourceBinding: null,
        },
      },
      componentsById: {
        [componentId]: {
          id: componentId,
          name: "Button",
          rootNodeId: nodeId,
          propertyKeys: ["label", "variant"],
        },
      },
      tokensById: {
        "radius.control": {
          id: "radius.control",
          name: "Control radius",
          type: "number",
          value: 12,
        },
      },
    } satisfies CanvasDocumentV2;

    const capsule = await createSelectionContextCapsule({
      document: v2Document,
      selectedIds: [nodeId],
      sourceRevision: "buzzr-revision-22",
      viewport,
      relevantTokenIds: ["radius.control"],
    });

    expect(capsule.selectedNodes).toEqual([
      expect.objectContaining({
        id: nodeId,
        kind: "Instance",
        componentId,
      }),
    ]);
    expect(capsule.sourceAnchors).toEqual([
      expect.objectContaining({
        nodeId,
        sourceAnchor: "components/ui/Button.tsx#Button",
        astPath: ["SourceFile", "Button"],
        range: { start: 100, end: 220 },
        runtimeEvidenceRefs: ["capture-button"],
      }),
    ]);
    expect(capsule.relevantComponents).toEqual([
      expect.objectContaining({ id: componentId, name: "Button" }),
    ]);
    expect(capsule.relevantTokens).toEqual([
      expect.objectContaining({ id: "radius.control", value: 12 }),
    ]);
    expect(JSON.stringify(capsule)).not.toContain("nodesById");
    expect(JSON.stringify(capsule)).not.toContain("tokensById");
  });

  it("rejects V2 token IDs that are not referenced by the selected node semantics", async () => {
    const nodeId = `nod_${"5".repeat(26)}` as CanvasDocumentV2["rootIds"][number];
    const documentId = `doc_${"6".repeat(26)}` as CanvasDocumentV2["id"];
    const projectId = `prj_${"7".repeat(26)}` as CanvasDocumentV2["projectId"];
    const v2Document = {
      schemaVersion: 2,
      id: documentId,
      projectId,
      revision: 1,
      stateHash: HASH_A,
      operationCursor: null,
      rootIds: [nodeId],
      nodesById: {
        [nodeId]: {
          id: nodeId,
          kind: "rectangle",
          name: "Card",
          parentId: null,
          childIds: [],
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          geometry: { width: 100, height: 100 },
          style: {
            opacity: 1,
            visible: true,
            locked: false,
            fills: [{ type: "solid", color: "#ffffff" }],
            strokes: [],
            cornerRadii: [8, 8, 8, 8],
          },
          layout: {
            mode: "none",
            gap: 0,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            alignPrimary: "start",
            alignCounter: "start",
            wrap: false,
            sizingHorizontal: "fixed",
            sizingVertical: "fixed",
          },
          text: null,
          content: null,
          componentId: null,
          instanceOverrides: {},
          componentBinding: null,
          provenance: null,
          referenceBinding: null,
          sourceAnchor: null,
          sourceBinding: null,
        },
      },
      componentsById: {},
      tokensById: {
        unrelated: {
          id: "unrelated",
          name: "Unrelated token",
          type: "color",
          value: "#ff00ff",
        },
      },
    } satisfies CanvasDocumentV2;

    await expect(
      createSelectionContextCapsule({
        document: v2Document,
        selectedIds: [nodeId],
        sourceRevision: "revision-1",
        viewport,
        relevantTokenIds: ["unrelated"],
      }),
    ).rejects.toThrow(/token "unrelated".*not referenced/i);
  });
});
