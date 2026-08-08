import {
  CanvasComponentIdSchema,
  CanvasNodeIdSchema,
  CanvasNodeV3Schema,
  type CanvasActionIntentV3,
  type CanvasComponentDefinitionV3,
  type CanvasDocumentV3,
  type CanvasGeometryV2,
  type CanvasLayoutV2,
  type CanvasNodeV3,
  type CanvasPageId,
  type CanvasSingleActionIntentV3,
  type CanvasStyleV2,
  type CanvasTextV2,
  type CanvasTransformV2,
} from "@memi/protocol";
import { mapLegacyCanvasIdV2 } from "@memi/canvas-document";

import { DEFAULT_WORKBENCH_LAYOUT, type WorkbenchNode } from "./model.js";
import { canvasTextFromWorkbench } from "./workbench-text-style.js";

/** A compact, user-action receipt. It deliberately never accepts scene arrays. */
export type WorkbenchIntentReceiptV3 =
  | { readonly kind: "batch"; readonly receipts: readonly Exclude<WorkbenchIntentReceiptV3, { readonly kind: "batch" }>[] }
  | { readonly kind: "node.name"; readonly nodeId: string; readonly next: string }
  | { readonly kind: "node.transform"; readonly nodeId: string; readonly next: CanvasTransformV2 }
  | { readonly kind: "node.geometry"; readonly nodeId: string; readonly next: CanvasGeometryV2 }
  | { readonly kind: "node.style"; readonly nodeId: string; readonly next: CanvasStyleV2 }
  | { readonly kind: "node.text"; readonly nodeId: string; readonly next: CanvasTextV2 }
  | { readonly kind: "node.layout"; readonly nodeId: string; readonly next: CanvasLayoutV2 }
  | { readonly kind: "component.update"; readonly node: WorkbenchNode }
  | { readonly kind: "create" | "paste"; readonly nodes: readonly WorkbenchNode[] }
  | { readonly kind: "move" | "resize" | "style"; readonly nodes: readonly WorkbenchNode[] }
  | { readonly kind: "delete"; readonly nodeIds: readonly string[] }
  | {
      readonly kind: "reparent";
      readonly nodes: readonly WorkbenchNode[];
      /** Explicit sibling slots preserve ordering when moving into a populated parent. */
      readonly nextIndices?: readonly number[];
    }
  | {
      readonly kind: "order";
      readonly parentId: string | null;
      readonly orderedNodeIds: readonly string[];
    }
  | {
      readonly kind: "group";
      readonly container: WorkbenchNode;
      /** Children must carry their intended parent-relative positions. */
      readonly children: readonly WorkbenchNode[];
    }
  /** Replaces a source-authoritative V3 node with its detached canvas draft. */
  | { readonly kind: "detach"; readonly node: WorkbenchNode }
  | { readonly kind: "replace"; readonly node: WorkbenchNode };

export interface WorkbenchIntentReceiptInputV3 {
  readonly document: CanvasDocumentV3;
  readonly pageId: CanvasPageId;
  readonly receipt: WorkbenchIntentReceiptV3;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function requirePage(document: CanvasDocumentV3, pageId: CanvasPageId): void {
  if (document.pagesById[pageId] === undefined) {
    throw new Error("Canvas V3 workbench intent requires an existing page.");
  }
}

/**
 * Maps both pre-existing legacy projection IDs and IDs introduced by a receipt
 * to the one deterministic V3 node identity. Keep post-commit selections on
 * this seam: the authority accepts V3 IDs only.
 */
export function canonicalWorkbenchNodeIdV3(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
  workbenchId: string,
): CanvasNodeV3["id"] {
  if (document.nodesById[workbenchId] !== undefined) return CanvasNodeIdSchema.parse(workbenchId);
  return CanvasNodeIdSchema.parse(
    mapLegacyCanvasIdV2(
      "node",
      `${document.id}:${pageId}:workbench:${workbenchId}`,
    ).canonicalId,
  );
}

function canvasId(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
  workbenchId: string,
): CanvasNodeV3["id"] {
  return canonicalWorkbenchNodeIdV3(document, pageId, workbenchId);
}

function canvasComponentId(
  document: CanvasDocumentV3,
  workbenchId: string,
): CanvasComponentDefinitionV3["id"] {
  const canonical = CanvasComponentIdSchema.safeParse(workbenchId);
  if (canonical.success) return canonical.data;
  return CanvasComponentIdSchema.parse(
    mapLegacyCanvasIdV2(
      "component",
      `${document.id}:workbench:${workbenchId}`,
    ).canonicalId,
  );
}

function canvasKind(node: WorkbenchNode): CanvasNodeV3["kind"] {
  if (node.kind === "DraftFrame") return "frame";
  if (node.kind === "ComponentInstance") return "instance";
  if (node.kind === "CodeFrame" || node.kind === "RoutePlaceholder" || node.kind === "ReferenceFrame") {
    throw new Error("Source-linked workbench nodes must enter Canvas V3 through verified import reconstruction.");
  }
  return {
    Arrow: "arrow", Comment: "sticky", Component: "component", Ellipse: "ellipse",
    Frame: "frame", Group: "group", Image: "image", Line: "line", Rectangle: "rectangle",
    Section: "section", Slice: "section", Text: "text", Vector: "vector",
  }[node.kind] as CanvasNodeV3["kind"];
}

function content(node: WorkbenchNode, kind: CanvasNodeV3["kind"]): CanvasNodeV3["content"] {
  if (kind === "image") {
    if (node.image === undefined) throw new Error("Canvas V3 image creation requires embedded image content.");
    return { alt: node.image.alt, byteLength: node.image.byteLength, dataUri: node.image.src, height: node.image.height, type: "image", width: node.image.width };
  }
  if (kind === "sticky") return { body: node.text ?? "", type: "note" };
  if (node.frameContent !== undefined && ["frame", "group", "component", "section"].includes(kind)) {
    return { format: "plain-text", type: "frame", value: node.frameContent };
  }
  return null;
}

function style(node: WorkbenchNode): CanvasNodeV3["style"] {
  return {
    cornerRadii: node.cornerRadii === undefined ? [0, 0, 0, 0] : [...node.cornerRadii],
    fills: node.fill === undefined ? [] : [{ color: node.fill, type: "solid" }],
    ...(node.effects === undefined
      ? {}
      : { effects: node.effects.map((effect) => ({ ...effect })) }),
    locked: node.locked,
    opacity: node.opacity ?? 1,
    ...(node.strokeAlign === undefined ? {} : { strokeAlign: node.strokeAlign }),
    ...(node.strokeWeight === undefined ? {} : { strokeWeight: node.strokeWeight }),
    strokes: node.stroke === undefined ? [] : [{ color: node.stroke, type: "solid" }],
    visible: !node.hidden,
  };
}

function detachedProvenance(node: WorkbenchNode): CanvasNodeV3["provenance"] {
  if (node.provenance === undefined) return null;
  return {
    captureState: node.provenance.captureState ?? null,
    coverageCellId: node.provenance.coverageCellId ?? null,
    dirtyFileFingerprint: node.provenance.dirtyFileFingerprint ?? null,
    repositoryDirty: node.provenance.repositoryDirty ?? null,
    repositoryRevision: node.provenance.repositoryRevision,
    routeId: node.provenance.routeId ?? null,
    sourceAnchor: node.provenance.sourceAnchor,
    sourceContentHash: node.provenance.sourceContentHash ?? null,
    sourceFingerprint: node.provenance.sourceFingerprint ?? null,
    stateId: node.provenance.stateId ?? null,
  };
}

function componentBinding(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
  node: WorkbenchNode,
): CanvasNodeV3["componentBinding"] {
  const component = node.component;
  if (component === undefined) return null;
  if (
    component.classification === "instance" &&
    component.masterId === undefined
  ) {
    throw new Error("Canvas V3 component instances require a master node.");
  }
  return {
    atomicLevel: component.atomicLevel,
    classification: component.classification,
    componentId: canvasComponentId(document, component.componentId),
    componentName: component.componentName,
    editable: { ...component.editable },
    masterNodeId:
      component.classification === "master"
        ? null
        : canvasId(document, pageId, component.masterId!),
    props: componentProps(component.props),
    role: component.role,
    source: {
      exportName: component.source.exportName ?? null,
      repositoryDirty: component.source.repositoryDirty ?? null,
      repositoryRevision: component.source.repositoryRevision,
      sourceAnchor: component.source.sourceAnchor,
      sourceContentHash: component.source.sourceContentHash ?? null,
    },
    variant: component.variant ?? null,
  };
}

function componentProps(
  props: NonNullable<WorkbenchNode["component"]>["props"],
): NonNullable<CanvasNodeV3["componentBinding"]>["props"] {
  return {
    ...(props.label === undefined ? {} : { label: props.label }),
    ...(props.icon === undefined ? {} : { icon: props.icon }),
    ...(props.selected === undefined ? {} : { selected: props.selected }),
    ...(props.status === undefined ? {} : { status: props.status }),
    ...(props.supportingText === undefined
      ? {}
      : { supportingText: props.supportingText }),
    ...(props.placeholder === undefined
      ? {}
      : { placeholder: props.placeholder }),
    ...(props.value === undefined ? {} : { value: props.value }),
    ...(props.items === undefined
      ? {}
      : { items: props.items.map((item) => ({ ...item })) }),
  };
}

function instanceOverrides(node: WorkbenchNode): CanvasNodeV3["instanceOverrides"] {
  if (node.component?.classification !== "instance") return {};
  const props = componentProps(node.component.props);
  return {
    ...Object.fromEntries(
      Object.entries(props).filter((entry) => entry[1] !== undefined),
    ),
    ...(node.component.variant === undefined
      ? {}
      : { variant: node.component.variant }),
  } as CanvasNodeV3["instanceOverrides"];
}

function componentDefinition(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
  node: WorkbenchNode,
): CanvasComponentDefinitionV3 | null {
  const component = node.component;
  if (node.kind !== "Component" || component?.classification !== "master") {
    return null;
  }
  const id = canvasComponentId(document, component.componentId);
  const propertyDefinitions = Object.fromEntries(
    (Object.entries(component.editable) as readonly [
      keyof typeof component.editable,
      boolean,
    ][]).flatMap(([key, editable]) => {
      if (!editable) return [];
      const type = key === "selected"
        ? "boolean" as const
        : key === "variant"
          ? "variant" as const
          : "text" as const;
      const defaultValue = key === "selected"
        ? component.props.selected ?? false
        : key === "variant"
          ? component.variant ?? "default"
          : key === "icon"
            ? component.props.icon ?? ""
            : component.props.label ?? "";
      return [[key, { defaultValue, type }]];
    }),
  );
  return {
    id,
    name: component.componentName,
    propertyDefinitions,
    rootNodeId: canvasId(document, pageId, node.id),
    variantAxes:
      component.editable.variant
        ? { variant: [component.variant ?? "default"] }
        : {},
  };
}

function toCanvasNode(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
  node: WorkbenchNode,
): CanvasNodeV3 {
  const kind = canvasKind(node);
  const layout = node.layout ?? DEFAULT_WORKBENCH_LAYOUT;
  const binding = componentBinding(document, pageId, node);
  const componentId =
    kind === "instance" && binding !== null ? binding.componentId : null;
  return CanvasNodeV3Schema.parse({
    childIds: [], componentBinding: binding, componentId, content: content(node, kind),
    geometry: { height: node.size.height, width: node.size.width }, id: canvasId(document, pageId, node.id),
    instanceOverrides: instanceOverrides(node), kind, layout: { ...layout, padding: { ...layout.padding } }, name: node.name,
    pageId, parentId: node.parentId === null ? null : canvasId(document, pageId, node.parentId),
    provenance: detachedProvenance(node), referenceBinding: null, sourceAnchor: null, sourceBinding: null,
    style: style(node), text: kind === "text"
      ? canvasTextFromWorkbench(node, node.text ?? "")
      : null,
    transform: { rotation: node.rotation ?? 0, scaleX: 1, scaleY: 1, x: node.position.x, y: node.position.y },
  });
}

function createActions(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
  nodes: readonly WorkbenchNode[],
  positions: "local" | "absolute",
): readonly CanvasSingleActionIntentV3[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const pending = [...nodes];
  const actions: CanvasSingleActionIntentV3[] = [];
  const indices = new Map<string | null, number>();
  const nextIndex = (parentId: string | null) => {
    const existing = parentId === null ? document.pagesById[pageId]!.rootIds.length : document.nodesById[parentId]?.childIds.length ?? 0;
    const result = indices.get(parentId) ?? existing;
    indices.set(parentId, result + 1);
    return result;
  };
  while (pending.length > 0) {
    const index = pending.findIndex((node) => node.parentId === null || nodes.some((candidate) => candidate.id === node.parentId) === false || actions.some((action) => action.type === "node.create" && action.payload.node.id === canvasId(document, pageId, node.parentId!)));
    if (index < 0) throw new Error("Workbench create receipt contains a cyclic or missing parent.");
    const [node] = pending.splice(index, 1);
    if (node === undefined) continue;
    const parentPosition = node.parentId === null || positions === "local"
      ? { x: 0, y: 0 }
      : nodesById.get(node.parentId)?.position ??
        absolutePosition(document, canvasId(document, pageId, node.parentId));
    const canvasNode = toCanvasNode(document, pageId, {
      ...node,
      position: {
        x: node.position.x - parentPosition.x,
        y: node.position.y - parentPosition.y,
      },
    });
    if (document.nodesById[canvasNode.id] !== undefined) throw new Error(`Canvas V3 workbench create would duplicate ${node.id}.`);
    actions.push({ type: "node.create", payload: { index: nextIndex(canvasNode.parentId), node: canvasNode, parentId: canvasNode.parentId } });
  }
  for (const node of nodes) {
    const definition = componentDefinition(document, pageId, node);
    if (definition === null) continue;
    const current = document.componentsById[definition.id];
    if (current !== undefined) {
      if (current.rootNodeId !== definition.rootNodeId) {
        throw new Error("Canvas V3 component identity already belongs to another master.");
      }
      continue;
    }
    actions.push({
      type: "component.define",
      payload: { componentId: definition.id, next: definition },
    });
  }
  return actions;
}

function asIntent(actions: readonly CanvasSingleActionIntentV3[]): CanvasActionIntentV3 {
  if (actions.length === 0) throw new Error("Workbench intent receipt has no affected nodes.");
  return actions.length === 1 ? actions[0]! : { type: "atomic.batch", payload: { actions } };
}

function existing(document: CanvasDocumentV3, pageId: CanvasPageId, node: WorkbenchNode): CanvasNodeV3 {
  return existingById(document, pageId, node.id);
}

function existingById(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
  workbenchId: string,
): CanvasNodeV3 {
  const current = document.nodesById[canvasId(document, pageId, workbenchId)];
  if (current === undefined || current.pageId !== pageId) {
    throw new Error(`Canvas V3 workbench intent requires an existing node on the active page: ${workbenchId}.`);
  }
  return current;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactPropertyIntent(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
  receipt: Extract<
    WorkbenchIntentReceiptV3,
    { readonly kind: "node.transform" | "node.geometry" | "node.style" | "node.text" | "node.layout" }
  >,
): CanvasSingleActionIntentV3 {
  const current = existingById(document, pageId, receipt.nodeId);
  if (receipt.kind === "node.text" && current.text === null) {
    throw new Error("Canvas V3 node.text receipt requires a text node.");
  }
  const field = receipt.kind.slice("node.".length) as
    | "transform"
    | "geometry"
    | "style"
    | "text"
    | "layout";
  if (sameValue(current[field], receipt.next)) {
    throw new Error(`Canvas V3 ${receipt.kind} receipt must change the current value.`);
  }
  if (receipt.kind === "node.transform") {
    const next = structuredClone(receipt.next);
    return { type: receipt.kind, payload: { nodeId: current.id, next } };
  }
  if (receipt.kind === "node.geometry") {
    const next = structuredClone(receipt.next);
    return { type: receipt.kind, payload: { nodeId: current.id, next } };
  }
  if (receipt.kind === "node.style") {
    const next = structuredClone(receipt.next);
    return { type: receipt.kind, payload: { nodeId: current.id, next } };
  }
  if (receipt.kind === "node.text") {
    const next = structuredClone(receipt.next);
    return { type: receipt.kind, payload: { nodeId: current.id, next } };
  }
  const next = structuredClone(receipt.next);
  return { type: receipt.kind, payload: { nodeId: current.id, next } };
}

function transformAction(current: CanvasNodeV3, node: WorkbenchNode): CanvasSingleActionIntentV3 | null {
  const next = { rotation: node.rotation ?? current.transform.rotation, scaleX: current.transform.scaleX, scaleY: current.transform.scaleY, x: node.position.x, y: node.position.y };
  return JSON.stringify(next) === JSON.stringify(current.transform) ? null : { type: "node.transform", payload: { nodeId: current.id, next } };
}

function absolutePosition(
  document: CanvasDocumentV3,
  nodeId: string,
  cache = new Map<string, { readonly x: number; readonly y: number }>(),
): { readonly x: number; readonly y: number } {
  const cached = cache.get(nodeId);
  if (cached !== undefined) return cached;
  const node = document.nodesById[nodeId];
  if (node === undefined) {
    throw new Error(`Canvas V3 workbench move requires an existing node: ${nodeId}.`);
  }
  const parent = node.parentId === null
    ? { x: 0, y: 0 }
    : absolutePosition(document, node.parentId, cache);
  const position = {
    x: parent.x + node.transform.x,
    y: parent.y + node.transform.y,
  };
  cache.set(nodeId, position);
  return position;
}

function moveActions(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
  nodes: readonly WorkbenchNode[],
): readonly CanvasSingleActionIntentV3[] {
  const desiredById = new Map(
    nodes.map((node) => [canvasId(document, pageId, node.id), node]),
  );
  const positionCache = new Map<string, { readonly x: number; readonly y: number }>();
  return nodes.flatMap((node) => {
    const current = existing(document, pageId, node);
    const parentPosition = current.parentId === null
      ? { x: 0, y: 0 }
      : desiredById.get(current.parentId)?.position ??
        absolutePosition(document, current.parentId, positionCache);
    const localNode = {
      ...node,
      position: {
        x: node.position.x - parentPosition.x,
        y: node.position.y - parentPosition.y,
      },
    };
    const action = transformAction(current, localNode);
    return action === null ? [] : [action];
  });
}

/** Compiles only declared affected nodes into V3 semantic intents; no scene diff fallback exists. */
export function compileWorkbenchIntentReceiptV3(input: WorkbenchIntentReceiptInputV3): CanvasActionIntentV3 {
  const { document, pageId, receipt } = input;
  requirePage(document, pageId);
  if (receipt.kind === "batch") {
    const actions = receipt.receipts.flatMap((child) => {
      const action = compileWorkbenchIntentReceiptV3({ document, pageId, receipt: child });
      return action.type === "atomic.batch" ? action.payload.actions : [action];
    });
    return freeze(asIntent(actions));
  }
  if (receipt.kind === "node.name") {
    const current = existingById(document, pageId, receipt.nodeId);
    const next = structuredClone(receipt.next.trim());
    if (next.length === 0 || next.length > 512) {
      throw new Error("Canvas V3 node.name receipt requires a name between 1 and 512 characters.");
    }
    if (current.name === next) {
      throw new Error("Canvas V3 node.name receipt must change the current value.");
    }
    return freeze({
      type: "node.name",
      payload: { nodeId: current.id, next },
    });
  }
  if (
    receipt.kind === "node.transform" ||
    receipt.kind === "node.geometry" ||
    receipt.kind === "node.style" ||
    receipt.kind === "node.text" ||
    receipt.kind === "node.layout"
  ) {
    return freeze(exactPropertyIntent(document, pageId, receipt));
  }
  if (receipt.kind === "component.update") {
    const currentNode = existing(document, pageId, receipt.node);
    const definition = componentDefinition(document, pageId, receipt.node);
    if (definition === null || currentNode.id !== definition.rootNodeId) {
      throw new Error("Canvas V3 component update requires its master node.");
    }
    const current = document.componentsById[definition.id];
    if (current === undefined || current.rootNodeId !== currentNode.id) {
      throw new Error("Canvas V3 component update requires an existing definition.");
    }
    if (sameValue(current, definition)) {
      throw new Error("Canvas V3 component update must change the definition.");
    }
    return freeze({
      type: "component.define",
      payload: { componentId: definition.id, next: definition },
    });
  }
  if (receipt.kind === "replace") throw new Error("Unsupported node.replace fallback: emit explicit semantic receipt actions.");
  if (receipt.kind === "detach") {
    const current = existingById(document, pageId, receipt.node.id);
    const node = toCanvasNode(document, pageId, receipt.node);
    if (node.id !== current.id) {
      throw new Error("Canvas V3 detach receipt must retain the selected node identity.");
    }
    const siblingOrder = current.parentId === null
      ? document.pagesById[pageId]!.rootIds
      : document.nodesById[current.parentId]?.childIds ?? [];
    return freeze(asIntent([
      { type: "node.delete", payload: { nodeId: current.id } },
      {
        type: "node.create",
        payload: {
          index: siblingOrder.indexOf(current.id),
          node,
          parentId: current.parentId,
        },
      },
    ]));
  }
  if (receipt.kind === "create" || receipt.kind === "paste") {
    return freeze(asIntent(createActions(
      document,
      pageId,
      receipt.nodes,
      receipt.kind === "paste" ? "absolute" : "local",
    )));
  }
  if (receipt.kind === "move") {
    return freeze(asIntent(moveActions(document, pageId, receipt.nodes)));
  }
  if (receipt.kind === "resize") return freeze(asIntent(receipt.nodes.flatMap((node) => {
    const current = existing(document, pageId, node);
    const next = { height: node.size.height, width: node.size.width };
    return JSON.stringify(next) === JSON.stringify(current.geometry) ? [] : [{ type: "node.geometry" as const, payload: { nodeId: current.id, next } }];
  })));
  if (receipt.kind === "style") return freeze(asIntent(receipt.nodes.flatMap((node) => {
    const current = existing(document, pageId, node);
    const next = style(node);
    return JSON.stringify(next) === JSON.stringify(current.style) ? [] : [{ type: "node.style" as const, payload: { nodeId: current.id, next } }];
  })));
  if (receipt.kind === "delete") {
    const nodeIds = [...new Set(receipt.nodeIds.map((id) => canvasId(document, pageId, id)))];
    return freeze(asIntent(nodeIds.sort((left, right) => depth(document, right) - depth(document, left)).map((nodeId) => ({ type: "node.delete" as const, payload: { nodeId } }))));
  }
  if (receipt.kind === "order") return freeze(asIntent([{ type: "node.reorder", payload: { pageId, parentId: receipt.parentId === null ? null : canvasId(document, pageId, receipt.parentId), nextOrder: receipt.orderedNodeIds.map((id) => canvasId(document, pageId, id)) } }]));
  if (receipt.kind === "reparent") return freeze(asIntent(reparentActions(document, pageId, receipt.nodes, undefined, receipt.nextIndices)));
  if (receipt.kind !== "group") {
    throw new Error("Unsupported workbench intent receipt.");
  }
  const container = toCanvasNode(document, pageId, receipt.container);
  const siblingOrder = container.parentId === null
    ? document.pagesById[pageId]!.rootIds
    : document.nodesById[container.parentId]?.childIds ?? [];
  const childIndexes = receipt.children.map((child) => {
    const childId = canvasId(document, pageId, child.id);
    const current = document.nodesById[childId];
    return current === undefined || current.parentId !== container.parentId
      ? -1
      : siblingOrder.indexOf(childId);
  }).filter((index) => index >= 0);
  const creates: readonly CanvasSingleActionIntentV3[] = [{
    type: "node.create",
    payload: {
      index: childIndexes.length === 0 ? siblingOrder.length : Math.min(...childIndexes),
      node: container,
      parentId: container.parentId,
    },
  }];
  const reparent = reparentActions(document, pageId, receipt.children, receipt.container.id);
  const definition = componentDefinition(document, pageId, receipt.container);
  const define: readonly CanvasSingleActionIntentV3[] = definition === null
    ? []
    : [{
        type: "component.define",
        payload: { componentId: definition.id, next: definition },
      }];
  return freeze(asIntent([...creates, ...reparent, ...define]));
}

function depth(document: CanvasDocumentV3, nodeId: string): number {
  let result = 0;
  let current = document.nodesById[nodeId];
  while (current?.parentId !== null && current !== undefined) { result += 1; current = document.nodesById[current.parentId]; }
  return result;
}

function reparentActions(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
  nodes: readonly WorkbenchNode[],
  forcedParentId?: string,
  nextIndices?: readonly number[],
): readonly CanvasSingleActionIntentV3[] {
  return nodes.flatMap((node, index) => {
    const current = existing(document, pageId, node);
    const transform = transformAction(current, node);
    const nextParentId = forcedParentId ?? node.parentId;
    const parentId = nextParentId === null ? null : canvasId(document, pageId, nextParentId);
    if (current.parentId === parentId) return transform === null ? [] : [transform];
    const reparent: CanvasSingleActionIntentV3 = { type: "node.reparent", payload: { nodeId: current.id, nextPageId: pageId, nextParentId: parentId, nextIndex: nextIndices?.[index] ?? index } };
    return transform === null ? [reparent] : [transform, reparent];
  });
}
