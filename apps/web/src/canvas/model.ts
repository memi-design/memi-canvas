import {
  resolveComponentInstanceBinding,
  type ComponentInstanceBinding,
} from "./component-model.js";
import type { CanvasEffectV2 } from "@memi/protocol";

export {
  createSceneState,
  SCENE_HISTORY_MAX_ENTRIES,
  sceneReducer,
} from "./legacy-scene-state.js";
export type {
  HistoryEntry,
  SceneAction,
  SceneState,
} from "./legacy-scene-state.js";

export type {
  AtomicDesignLevel,
  ComponentInstanceBinding,
  ComponentPreviewItem,
  ComponentPreviewRole,
  ComponentSourceProvenance,
} from "./component-model.js";

export type WorkbenchNodeKind =
  | "CodeFrame"
  | "RoutePlaceholder"
  | "ReferenceFrame"
  | "DraftFrame"
  | "Text"
  | "Image"
  | "Rectangle"
  | "Ellipse"
  | "Line"
  | "Arrow"
  | "Vector"
  | "Frame"
  | "Group"
  | "Section"
  | "Slice"
  | "Comment"
  | "Component"
  | "ComponentInstance";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface WorkbenchLayout {
  readonly mode: "none" | "horizontal" | "vertical" | "grid";
  readonly gap: number;
  readonly padding: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly alignPrimary: "start" | "center" | "end" | "space-between";
  readonly alignCounter: "start" | "center" | "end" | "stretch";
  readonly wrap: boolean;
  readonly sizingHorizontal: "fixed" | "hug" | "fill";
  readonly sizingVertical: "fixed" | "hug" | "fill";
}

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayout = {
  alignCounter: "start",
  alignPrimary: "start",
  gap: 0,
  mode: "none",
  padding: { bottom: 0, left: 0, right: 0, top: 0 },
  sizingHorizontal: "fixed",
  sizingVertical: "fixed",
  wrap: false,
};

export type DocumentNodeKind =
  | "Frame"
  | "Group"
  | "Rectangle"
  | "Ellipse"
  | "Line"
  | "Arrow"
  | "Vector"
  | "Text"
  | "Image"
  | "Component"
  | "Instance"
  | "Section"
  | "Sticky"
  | "Connector"
  | "Slice"
  | "Comment"
  | "ImportedSourceFrame";

export interface NodeConstraints {
  readonly horizontal: "left" | "right" | "center" | "stretch" | "scale";
  readonly vertical: "top" | "bottom" | "center" | "stretch" | "scale";
}

export interface DocumentNode {
  readonly id: string;
  readonly kind: DocumentNodeKind;
  readonly name: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly position: Point;
  readonly size: Size;
  readonly rotation: number;
  readonly opacity: number;
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly styles: Readonly<Record<string, unknown>>;
  readonly constraints: NodeConstraints;
  readonly provenance?: DetachedProvenance;
  readonly sourceBinding?: SourceBinding;
  readonly referenceBinding?: ReferenceBinding;
  readonly componentBinding?: ComponentInstanceBinding;
}

export interface DesignDocument {
  readonly id: string;
  readonly revision: number;
  readonly nodes: readonly DocumentNode[];
  readonly rootIds: readonly string[];
}

export interface SelectionState {
  readonly selectedIds: readonly string[];
  readonly anchorId: string | null;
  readonly focusedId: string | null;
  readonly editingId: string | null;
}

export type SelectionUpdateMode = "replace" | "toggle";

export type PointerMode =
  | "idle"
  | "select"
  | "marquee"
  | "pan"
  | "move"
  | "resize"
  | "rotate"
  | "draw";

export interface ViewportState {
  readonly translation: Point;
  readonly zoom: number;
  readonly viewportSize: Size;
  readonly pointerMode: PointerMode;
}

export function createSelectionState(
  selectedIds: readonly string[] = [],
  options: {
    readonly anchorId?: string | null;
    readonly focusedId?: string | null;
    readonly editingId?: string | null;
  } = {},
): SelectionState {
  const orderedUniqueIds = [...new Set(selectedIds)];
  const fallbackId = orderedUniqueIds.at(-1) ?? null;
  return {
    selectedIds: orderedUniqueIds,
    anchorId:
      options.anchorId === undefined ? fallbackId : options.anchorId,
    focusedId:
      options.focusedId === undefined ? fallbackId : options.focusedId,
    editingId: options.editingId ?? null,
  };
}

export function updateSelection(
  selection: SelectionState,
  nodeId: string,
  mode: SelectionUpdateMode,
): SelectionState {
  if (mode === "replace") {
    return createSelectionState([nodeId], {
      anchorId: nodeId,
      focusedId: nodeId,
      editingId: null,
    });
  }

  const selected = selection.selectedIds.includes(nodeId);
  const selectedIds = selected
    ? selection.selectedIds.filter((id) => id !== nodeId)
    : [...selection.selectedIds, nodeId];
  const fallbackId = selectedIds.at(-1) ?? null;
  return createSelectionState(selectedIds, {
    anchorId: selected ? fallbackId : nodeId,
    focusedId: selected ? fallbackId : nodeId,
    editingId:
      selection.editingId !== null &&
      selectedIds.includes(selection.editingId)
        ? selection.editingId
        : null,
  });
}

export function selectionFromLegacy(
  selectedNodeId: string | null,
): SelectionState {
  return createSelectionState(
    selectedNodeId === null ? [] : [selectedNodeId],
  );
}

export function legacySelectionId(
  selection: SelectionState,
): string | null {
  return selection.focusedId ?? selection.selectedIds.at(-1) ?? null;
}

export interface SourceBinding {
  readonly captureState?: "captured" | "placeholder";
  readonly repositoryRevision: string;
  readonly repositoryDirty?: boolean;
  readonly dirtyFileFingerprint?: string;
  readonly sourceFingerprint?: string;
  readonly sourceContentHash?: string;
  readonly routeId: string;
  readonly stateId: string;
  readonly coverageCellId: string;
  readonly sourceAnchor: string;
  readonly viewport: {
    readonly name: "desktop" | "tablet" | "mobile";
    readonly width: number;
    readonly height: number;
  };
}

export interface DetachedProvenance {
  readonly captureState?: "captured" | "placeholder";
  readonly repositoryRevision: string;
  readonly repositoryDirty?: boolean;
  readonly dirtyFileFingerprint?: string;
  readonly sourceFingerprint?: string;
  readonly sourceContentHash?: string;
  readonly sourceAnchor: string;
  readonly routeId: string | null;
  readonly stateId: string | null;
  readonly coverageCellId: string | null;
}

export function provenanceFromSource(
  source: SourceBinding,
): DetachedProvenance {
  return {
    ...(source.captureState === undefined
      ? {}
      : { captureState: source.captureState }),
    repositoryRevision: source.repositoryRevision,
    ...(source.repositoryDirty === undefined
      ? {}
      : { repositoryDirty: source.repositoryDirty }),
    ...(source.dirtyFileFingerprint === undefined
      ? {}
      : { dirtyFileFingerprint: source.dirtyFileFingerprint }),
    ...(source.sourceFingerprint === undefined
      ? {}
      : { sourceFingerprint: source.sourceFingerprint }),
    ...(source.sourceContentHash === undefined
      ? {}
      : { sourceContentHash: source.sourceContentHash }),
    sourceAnchor: source.sourceAnchor,
    routeId: source.routeId,
    stateId: source.stateId,
    coverageCellId: source.coverageCellId,
  };
}

export interface ReferenceBinding {
  readonly src: string;
  readonly alt: string;
  readonly authority: string;
  readonly appVersion: string;
  readonly capturedAt: string;
  readonly sourceUrl: string;
  readonly captureId?: string;
  readonly contentHash?: string;
  readonly sourceRevision?: string;
  readonly accessibilitySnapshotRef?: string;
  readonly sourceAnchors?: readonly string[];
  readonly componentIds?: readonly string[];
}

/**
 * Self-contained image content authored directly on the canvas. Unlike a
 * reference frame, it is user-provided pixel data and carries no runtime or
 * source-evidence claim.
 */
export interface CanvasImageBinding {
  readonly alt: string;
  readonly byteLength: number;
  readonly height: number;
  readonly mimeType: "image/png";
  readonly src: string;
  readonly width: number;
}

export interface WorkbenchNode {
  readonly id: string;
  readonly kind: WorkbenchNodeKind;
  readonly name: string;
  readonly parentId: string | null;
  readonly position: Point;
  readonly size: Size;
  readonly layout?: WorkbenchLayout;
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly path?: readonly Point[];
  readonly text?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly letterSpacing?: number;
  readonly lineHeight?: number;
  readonly textAlign?: "left" | "center" | "right" | "justify";
  readonly textAutoResize?: "none" | "width-height" | "height";
  readonly effects?: readonly CanvasEffectV2[];
  readonly fill?: string;
  readonly stroke?: string;
  readonly rotation?: number;
  readonly opacity?: number;
  readonly cornerRadii?: readonly [number, number, number, number];
  readonly strokeWeight?: number;
  readonly strokeAlign?: "inside" | "center" | "outside";
  readonly source?: SourceBinding;
  readonly provenance?: DetachedProvenance;
  readonly reference?: ReferenceBinding;
  readonly image?: CanvasImageBinding;
  readonly component?: ComponentInstanceBinding;
  readonly frameContent?: string;
  /**
   * Immutable visual signature captured when an imported semantic layer was
   * composed above runtime pixels. A mismatch means the layer has an authored
   * override that must render above the locked reference image.
   */
  readonly semanticBaseline?: string;
}

export interface WorkbenchHierarchyState {
  readonly hidden: boolean;
  readonly locked: boolean;
}

export function workbenchHierarchyStates(
  nodes: readonly WorkbenchNode[],
): ReadonlyMap<string, WorkbenchHierarchyState> {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const states = new Map<string, WorkbenchHierarchyState>();
  const resolving = new Set<string>();
  const resolve = (node: WorkbenchNode): WorkbenchHierarchyState => {
    const existing = states.get(node.id);
    if (existing !== undefined) {
      return existing;
    }
    if (resolving.has(node.id)) {
      return { hidden: node.hidden, locked: node.locked };
    }
    resolving.add(node.id);
    const parent =
      node.parentId === null ? undefined : nodesById.get(node.parentId);
    const parentState =
      parent === undefined
        ? { hidden: false, locked: false }
        : resolve(parent);
    const state = {
      hidden: node.hidden || parentState.hidden,
      locked: node.locked || parentState.locked,
    };
    resolving.delete(node.id);
    states.set(node.id, state);
    return state;
  };
  for (const node of nodes) {
    resolve(node);
  }
  return states;
}

export function resolveComponentInstance(
  node: WorkbenchNode,
  nodes: readonly WorkbenchNode[],
): WorkbenchNode {
  const component = node.component;
  if (
    node.kind !== "ComponentInstance" ||
    component?.classification !== "instance" ||
    component.masterId === undefined
  ) {
    return node;
  }
  const master = nodes.find(
    (candidate) =>
      candidate.id === component.masterId &&
      candidate.component?.classification === "master",
  );
  if (master?.component === undefined) {
    return node;
  }
  return {
    ...node,
    ...(node.fill === undefined && master.fill !== undefined
      ? { fill: master.fill }
      : {}),
    component: resolveComponentInstanceBinding(
      master.component,
      component,
    ),
  };
}

export function componentDuplicateBase(node: WorkbenchNode): WorkbenchNode {
  const component = node.component;
  if (component === undefined) {
    return node;
  }
  if (component.classification === "instance") {
    return {
      ...node,
      component: {
        ...component,
        masterId: component.masterId ?? node.id,
      },
    };
  }
  const { fill: _fill, ...nodeWithoutFill } = node;
  const { variant: _variant, ...componentWithoutVariant } = component;
  return {
    ...nodeWithoutFill,
    kind: "ComponentInstance",
    component: {
      ...componentWithoutVariant,
      classification: "instance",
      masterId: node.id,
      props: {},
    },
  };
}

export function dependentNodeIds(
  nodes: readonly WorkbenchNode[],
  rootId: string,
): ReadonlySet<string> {
  let ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (
        !ids.has(node.id) &&
        ((node.parentId !== null && ids.has(node.parentId)) ||
          (node.component?.masterId !== undefined &&
            ids.has(node.component.masterId)))
      ) {
        ids = new Set([...ids, node.id]);
        changed = true;
      }
    }
  }
  return ids;
}

export interface CanvasWorkbenchProject {
  readonly id: string;
  readonly title: string;
  readonly selectedNodeId: string | null;
  readonly repositoryCatalog?: {
    readonly routes: readonly {
      readonly normalizedPath: string;
      readonly repositoryRevision: string;
      readonly routeId: string;
      readonly sourcePath: string;
    }[];
    readonly evidence: readonly {
      readonly authority: string;
      readonly id: string;
      readonly label: string;
      readonly sourceUrl: string;
      readonly supportingText: string;
    }[];
  };
  readonly document: {
    readonly id: string;
    readonly revision: number;
    readonly nodes: readonly WorkbenchNode[];
  };
  readonly harness: {
    readonly selectedId: string;
    readonly options: readonly {
      readonly disabled?: boolean;
      readonly id: string;
      readonly label: string;
    }[];
  };
  readonly trace: readonly {
    readonly id: string;
    readonly action: string;
    readonly targetNodeId: string;
    readonly harnessId?: string;
  }[];
}

function documentKindFromWorkbenchNode(
  node: WorkbenchNode,
): DocumentNodeKind {
  if (node.kind === "ComponentInstance") {
    return node.component?.classification === "master"
      ? "Component"
      : "Instance";
  }
  if (
    node.kind === "CodeFrame" ||
    node.kind === "RoutePlaceholder" ||
    node.kind === "ReferenceFrame"
  ) {
    return "ImportedSourceFrame";
  }
  if (node.kind === "DraftFrame") {
    return "Frame";
  }
  return node.kind;
}

export function designDocumentFromWorkbench(
  document: CanvasWorkbenchProject["document"],
): DesignDocument {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const childIdsByParent = new Map<string, string[]>();
  for (const node of document.nodes) {
    if (node.parentId === null) {
      continue;
    }
    const current = childIdsByParent.get(node.parentId) ?? [];
    childIdsByParent.set(node.parentId, [...current, node.id]);
  }
  return {
    id: document.id,
    revision: document.revision,
    rootIds: document.nodes
      .filter((node) => node.parentId === null)
      .map((node) => node.id),
    nodes: document.nodes.map((node) => {
      const parent =
        node.parentId === null ? undefined : nodesById.get(node.parentId);
      return {
      id: node.id,
      kind: documentKindFromWorkbenchNode(node),
      name: node.name,
      parentId: node.parentId,
      childIds: childIdsByParent.get(node.id) ?? [],
      position:
        parent === undefined
          ? { ...node.position }
          : {
              x: node.position.x - parent.position.x,
              y: node.position.y - parent.position.y,
            },
      size: { ...node.size },
      rotation: node.rotation ?? 0,
      opacity: node.opacity ?? 1,
      locked: node.locked,
      hidden: node.hidden,
      styles: {
        ...(node.fill === undefined ? {} : { fill: node.fill }),
        ...(node.stroke === undefined ? {} : { stroke: node.stroke }),
        ...(node.cornerRadii === undefined
          ? {}
          : { cornerRadii: node.cornerRadii }),
        ...(node.strokeWeight === undefined
          ? {}
          : { strokeWeight: node.strokeWeight }),
        ...(node.strokeAlign === undefined
          ? {}
          : { strokeAlign: node.strokeAlign }),
        ...(node.effects === undefined
          ? {}
          : { effects: node.effects.map((effect) => ({ ...effect })) }),
        ...(node.path === undefined
          ? {}
          : { path: structuredClone(node.path) }),
        ...(node.text === undefined ? {} : { text: node.text }),
        ...(node.fontFamily === undefined
          ? {}
          : { fontFamily: node.fontFamily }),
        ...(node.fontSize === undefined ? {} : { fontSize: node.fontSize }),
        ...(node.fontWeight === undefined
          ? {}
          : { fontWeight: node.fontWeight }),
        ...(node.letterSpacing === undefined
          ? {}
          : { letterSpacing: node.letterSpacing }),
        ...(node.lineHeight === undefined
          ? {}
          : { lineHeight: node.lineHeight }),
        ...(node.textAlign === undefined
          ? {}
          : { textAlign: node.textAlign }),
        ...(node.textAutoResize === undefined
          ? {}
          : { textAutoResize: node.textAutoResize }),
        ...(node.frameContent === undefined
          ? {}
          : { frameContent: node.frameContent }),
        ...(node.image === undefined
          ? {}
          : { image: structuredClone(node.image) }),
      },
      constraints: {
        horizontal: "left",
        vertical: "top",
      },
      ...(node.provenance === undefined && node.source === undefined
        ? {}
        : {
            provenance:
              node.provenance ??
              provenanceFromSource(node.source as SourceBinding),
          }),
      ...(node.source === undefined
        ? {}
        : { sourceBinding: structuredClone(node.source) }),
      ...(node.reference === undefined
        ? {}
        : { referenceBinding: structuredClone(node.reference) }),
      ...(node.component === undefined
        ? {}
        : { componentBinding: structuredClone(node.component) }),
      };
    }),
  };
}

export function replaceNode(
  nodes: readonly WorkbenchNode[],
  nodeId: string,
  update: (node: WorkbenchNode) => WorkbenchNode,
): readonly WorkbenchNode[] {
  return nodes.map((node) => (node.id === nodeId ? update(node) : node));
}

export function nodeAuthority(node: WorkbenchNode): string {
  if (node.kind === "CodeFrame") {
    return "product source";
  }
  if (node.kind === "RoutePlaceholder") {
    return "repository inventory";
  }
  if (node.kind === "ReferenceFrame") {
    return "production reference";
  }
  if (node.kind === "DraftFrame") {
    return "canvas document";
  }
  if (node.component !== undefined) {
    return "design system component";
  }
  return "canvas node";
}

export function uniqueNodeId(
  nodes: readonly WorkbenchNode[],
  base: string,
): string {
  let suffix = 1;
  let candidate = `${base}-${suffix}`;
  const known = new Set(nodes.map((node) => node.id));
  while (known.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}
