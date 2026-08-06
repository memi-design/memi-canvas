import {
  CanvasNodeIdSchema,
  CanvasNodeV3Schema,
  type CanvasActionIntentV3,
  type CanvasDocumentV3,
  type CanvasNodeV3,
  type CanvasPageId,
} from "@memi/protocol";
import { mapLegacyCanvasIdV2 } from "@memi/canvas-document";

import { DEFAULT_WORKBENCH_LAYOUT, type SelectionState, type WorkbenchNode } from "./model.js";
import { canvasTextFromWorkbench } from "./workbench-text-style.js";

export interface RootWorkbenchIntentTraceV3 {
  readonly adapter: "v3-root-workbench-intents";
  readonly documentId: string;
  readonly expectedRevision: number;
  readonly expectedStateHash: string;
  readonly pageId: CanvasPageId;
  readonly targetIds: readonly string[];
}

export interface RootWorkbenchIntentMetadataV3 {
  readonly selectionAfter: SelectionState;
  readonly trace: RootWorkbenchIntentTraceV3;
}

export interface RootWorkbenchIntentV3 {
  readonly action: CanvasActionIntentV3;
  readonly metadata: RootWorkbenchIntentMetadataV3;
  readonly targetId: string;
}

export interface RootWorkbenchIntentInputV3 {
  readonly document: CanvasDocumentV3;
  readonly pageId: CanvasPageId;
  readonly node: WorkbenchNode;
}

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) {
      immutable(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function rootPage(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
) {
  const page = document.pagesById[pageId];
  if (page === undefined) {
    throw new Error("Canvas V3 root workbench intent requires an existing page.");
  }
  return page;
}

function assertRootWorkbenchNode(node: WorkbenchNode): void {
  if (node.parentId !== null) {
    throw new Error("Canvas V3 root workbench intent only accepts root-level nodes.");
  }
  if (node.source !== undefined || node.provenance !== undefined) {
    throw new Error("Source-linked workbench nodes must enter Canvas V3 through import reconstruction.");
  }
}

function nodeKind(node: WorkbenchNode): CanvasNodeV3["kind"] {
  if (node.kind === "DraftFrame") {
    return "frame";
  }
  if (node.kind === "ComponentInstance") {
    throw new Error("Canvas V3 root workbench adapter cannot create an instance without a component definition.");
  }
  if (
    node.kind === "CodeFrame" ||
    node.kind === "RoutePlaceholder" ||
    node.kind === "ReferenceFrame"
  ) {
    throw new Error("Imported source frames must enter Canvas V3 through verified import reconstruction.");
  }
  const kinds = {
    Arrow: "arrow",
    Comment: "sticky",
    Component: "component",
    Ellipse: "ellipse",
    Frame: "frame",
    Group: "group",
    Image: "image",
    Line: "line",
    Rectangle: "rectangle",
    Section: "section",
    Slice: "section",
    Text: "text",
    Vector: "vector",
  } as const;
  return kinds[node.kind];
}

function canvasNodeId(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
  workbenchId: string,
): CanvasNodeV3["id"] {
  const existing = document.nodesById[workbenchId];
  if (existing !== undefined) {
    return existing.id;
  }
  return CanvasNodeIdSchema.parse(
    mapLegacyCanvasIdV2(
      "node",
      `${document.id}:${pageId}:workbench-root:${workbenchId}`,
    ).canonicalId,
  );
}

function selectionAfter(targetId: string): SelectionState {
  return {
    anchorId: targetId,
    editingId: null,
    focusedId: targetId,
    selectedIds: [targetId],
  };
}

function metadata(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
  targetId: string,
): RootWorkbenchIntentMetadataV3 {
  return {
    selectionAfter: selectionAfter(targetId),
    trace: {
      adapter: "v3-root-workbench-intents",
      documentId: document.id,
      expectedRevision: document.revision,
      expectedStateHash: document.stateHash,
      pageId,
      targetIds: [targetId],
    },
  };
}

function contentFor(
  node: WorkbenchNode,
  kind: CanvasNodeV3["kind"],
): CanvasNodeV3["content"] {
  if (kind === "image") {
    if (node.image === undefined) {
      throw new Error("Canvas V3 image creation requires embedded PNG content.");
    }
    return {
      alt: node.image.alt,
      byteLength: node.image.byteLength,
      dataUri: node.image.src,
      height: node.image.height,
      type: "image",
      width: node.image.width,
    };
  }
  if (kind === "sticky") {
    return { body: node.text ?? "", type: "note" };
  }
  if (
    node.frameContent !== undefined &&
    (kind === "frame" ||
      kind === "group" ||
      kind === "component" ||
      kind === "section")
  ) {
    return { format: "plain-text", type: "frame", value: node.frameContent };
  }
  return null;
}

function canvasNodeForRootCreate(
  pageId: CanvasPageId,
  node: WorkbenchNode,
  targetId: CanvasNodeV3["id"],
): CanvasNodeV3 {
  const kind = nodeKind(node);
  const layout = node.layout ?? DEFAULT_WORKBENCH_LAYOUT;
  return CanvasNodeV3Schema.parse({
    childIds: [],
    componentBinding: null,
    componentId: null,
    content: contentFor(node, kind),
    geometry: { height: node.size.height, width: node.size.width },
    id: targetId,
    instanceOverrides: {},
    kind,
    layout: {
      ...layout,
      padding: { ...layout.padding },
    },
    name: node.name,
    pageId,
    parentId: null,
    provenance: null,
    referenceBinding: null,
    sourceAnchor: null,
    sourceBinding: null,
    style: {
      cornerRadii: node.cornerRadii === undefined
        ? [0, 0, 0, 0]
        : [...node.cornerRadii],
      fills: node.fill === undefined ? [] : [{ color: node.fill, type: "solid" }],
      locked: node.locked,
      opacity: node.opacity ?? 1,
      ...(node.strokeAlign === undefined
        ? {}
        : { strokeAlign: node.strokeAlign }),
      ...(node.strokeWeight === undefined
        ? {}
        : { strokeWeight: node.strokeWeight }),
      strokes: node.stroke === undefined
        ? []
        : [{ color: node.stroke, type: "solid" }],
      visible: !node.hidden,
    },
    text: kind === "text"
      ? canvasTextFromWorkbench(node, node.text ?? "")
      : null,
    transform: {
      rotation: node.rotation ?? 0,
      scaleX: 1,
      scaleY: 1,
      x: node.position.x,
      y: node.position.y,
    },
  });
}

/**
 * Converts one root-level legacy renderer creation result into a V3 action.
 * Nested hierarchy, imports, and instances stay on their dedicated migration
 * paths until their V3 interaction adapters are ready.
 */
export function createRootWorkbenchIntentV3(
  input: RootWorkbenchIntentInputV3,
): RootWorkbenchIntentV3 {
  const page = rootPage(input.document, input.pageId);
  assertRootWorkbenchNode(input.node);
  const targetId = canvasNodeId(input.document, input.pageId, input.node.id);
  if (input.document.nodesById[targetId] !== undefined) {
    throw new Error("Canvas V3 root workbench creation would duplicate an existing node.");
  }
  const action: CanvasActionIntentV3 = {
    type: "node.create",
    payload: {
      index: page.rootIds.length,
      node: canvasNodeForRootCreate(
        input.pageId,
        input.node,
        targetId,
      ),
      parentId: null,
    },
  };
  return immutable({ action, metadata: metadata(input.document, input.pageId, targetId), targetId });
}

/** Converts a root-level renderer move result into one V3 transform intent. */
export function moveRootWorkbenchIntentV3(
  input: RootWorkbenchIntentInputV3,
): RootWorkbenchIntentV3 {
  rootPage(input.document, input.pageId);
  assertRootWorkbenchNode(input.node);
  const targetId = canvasNodeId(input.document, input.pageId, input.node.id);
  const current = input.document.nodesById[targetId];
  if (current === undefined) {
    throw new Error("Canvas V3 root workbench move requires an existing node.");
  }
  if (current.pageId !== input.pageId || current.parentId !== null) {
    throw new Error("Canvas V3 root workbench move only accepts root-level nodes on the active page.");
  }
  const action: CanvasActionIntentV3 = {
    type: "node.transform",
    payload: {
      next: {
        rotation: input.node.rotation ?? current.transform.rotation,
        scaleX: current.transform.scaleX,
        scaleY: current.transform.scaleY,
        x: input.node.position.x,
        y: input.node.position.y,
      },
      nodeId: targetId,
    },
  };
  return immutable({ action, metadata: metadata(input.document, input.pageId, targetId), targetId });
}
