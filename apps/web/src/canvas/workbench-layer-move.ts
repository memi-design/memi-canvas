import type { WorkbenchNode } from "./model.js";
import type { WorkbenchIntentReceiptV3 } from "./workbench-v3-intents.js";

export interface WorkbenchLayerMove {
  /** Final sibling slot after removing the moved node from its old position. */
  readonly index: number;
  readonly nodeId: string;
  readonly parentId: string | null;
}

export interface WorkbenchLayerMovePlan {
  readonly label: string;
  readonly nextNodes: readonly WorkbenchNode[];
  readonly options: {
    readonly selectedIds: readonly string[];
    readonly targetIds: readonly string[];
  };
  readonly receipt: WorkbenchIntentReceiptV3;
  readonly trace: string;
}

const editableContainerKinds = new Set<WorkbenchNode["kind"]>([
  "Component",
  "DraftFrame",
  "Frame",
  "Group",
  "Section",
]);

const sourceAuthorityKinds = new Set<WorkbenchNode["kind"]>([
  "CodeFrame",
  "ReferenceFrame",
  "RoutePlaceholder",
]);

export type WorkbenchLayerOrderDirection =
  | "forward"
  | "backward"
  | "front"
  | "back";

function reorderSiblingIds(
  siblingIds: readonly string[],
  selectedIds: ReadonlySet<string>,
  direction: WorkbenchLayerOrderDirection,
): readonly string[] {
  if (direction === "front") {
    return [
      ...siblingIds.filter((id) => !selectedIds.has(id)),
      ...siblingIds.filter((id) => selectedIds.has(id)),
    ];
  }
  if (direction === "back") {
    return [
      ...siblingIds.filter((id) => selectedIds.has(id)),
      ...siblingIds.filter((id) => !selectedIds.has(id)),
    ];
  }
  const reordered = [...siblingIds];
  const step = direction === "forward" ? 1 : -1;
  const indexes = reordered
    .map((id, index) => (selectedIds.has(id) ? index : -1))
    .filter((index) => index >= 0)
    .sort((left, right) =>
      direction === "forward" ? right - left : left - right,
    );
  for (const index of indexes) {
    const adjacentIndex = index + step;
    if (
      adjacentIndex >= 0 &&
      adjacentIndex < reordered.length &&
      !selectedIds.has(reordered[adjacentIndex] ?? "")
    ) {
      const selectedId = reordered[index];
      const adjacentId = reordered[adjacentIndex];
      if (selectedId !== undefined && adjacentId !== undefined) {
        reordered[index] = adjacentId;
        reordered[adjacentIndex] = selectedId;
      }
    }
  }
  return reordered;
}

export function orderWorkbenchHierarchy(
  nodes: readonly WorkbenchNode[],
  selectedIds: ReadonlySet<string>,
  direction: WorkbenchLayerOrderDirection,
): readonly WorkbenchNode[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string | null, string[]>();
  for (const node of nodes) {
    const siblings = childrenByParent.get(node.parentId) ?? [];
    childrenByParent.set(node.parentId, [...siblings, node.id]);
  }
  const selectedParentIds = new Set(
    nodes
      .filter(({ id }) => selectedIds.has(id))
      .map(({ parentId }) => parentId),
  );
  for (const parentId of selectedParentIds) {
    const siblingIds = childrenByParent.get(parentId) ?? [];
    childrenByParent.set(parentId, [
      ...reorderSiblingIds(siblingIds, selectedIds, direction),
    ]);
  }
  const orderedNodes: WorkbenchNode[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const node = nodesById.get(id);
    if (node === undefined) return;
    visited.add(id);
    orderedNodes.push(node);
    for (const childId of childrenByParent.get(id) ?? []) visit(childId);
  };
  for (const rootId of childrenByParent.get(null) ?? []) visit(rootId);
  for (const node of nodes) visit(node.id);
  return orderedNodes;
}

function hierarchyAllowsLayerMove(
  node: WorkbenchNode,
  nodesById: ReadonlyMap<string, WorkbenchNode>,
): boolean {
  const seen = new Set<string>();
  let current: WorkbenchNode | undefined = node;
  while (current !== undefined) {
    if (
      seen.has(current.id) ||
      current.locked ||
      current.source !== undefined ||
      sourceAuthorityKinds.has(current.kind)
    ) {
      return false;
    }
    seen.add(current.id);
    current =
      current.parentId === null
        ? undefined
        : nodesById.get(current.parentId);
  }
  return true;
}

function wouldCreateHierarchyCycle(
  nodeId: string,
  parentId: string | null,
  nodesById: ReadonlyMap<string, WorkbenchNode>,
): boolean {
  const seen = new Set<string>();
  let currentId = parentId;
  while (currentId !== null) {
    if (currentId === nodeId || seen.has(currentId)) return true;
    seen.add(currentId);
    currentId = nodesById.get(currentId)?.parentId ?? null;
  }
  return false;
}

function nodesWithLayerPlacement(
  nodes: readonly WorkbenchNode[],
  move: WorkbenchLayerMove,
): readonly WorkbenchNode[] {
  const updated = nodes.map((node) =>
    node.id === move.nodeId ? { ...node, parentId: move.parentId } : node,
  );
  const nodesById = new Map(updated.map((node) => [node.id, node]));
  const childIdsByParent = new Map<string | null, string[]>();
  for (const node of updated) {
    const childIds = childIdsByParent.get(node.parentId) ?? [];
    childIdsByParent.set(node.parentId, [...childIds, node.id]);
  }
  const targetSiblings = (childIdsByParent.get(move.parentId) ?? []).filter(
    (id) => id !== move.nodeId,
  );
  childIdsByParent.set(move.parentId, [
    ...targetSiblings.slice(0, move.index),
    move.nodeId,
    ...targetSiblings.slice(move.index),
  ]);

  const ordered: WorkbenchNode[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const node = nodesById.get(id);
    if (node === undefined) return;
    visited.add(id);
    ordered.push(node);
    for (const childId of childIdsByParent.get(id) ?? []) visit(childId);
  };
  for (const rootId of childIdsByParent.get(null) ?? []) visit(rootId);
  for (const node of updated) visit(node.id);
  return ordered;
}

export function planWorkbenchLayerMove(
  nodes: readonly WorkbenchNode[],
  move: WorkbenchLayerMove,
): WorkbenchLayerMovePlan | null {
  if (!Number.isInteger(move.index) || move.index < 0) return null;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const node = nodesById.get(move.nodeId);
  const parent = move.parentId === null ? undefined : nodesById.get(move.parentId);
  if (
    node === undefined ||
    !hierarchyAllowsLayerMove(node, nodesById) ||
    (move.parentId !== null &&
      (parent === undefined ||
        !editableContainerKinds.has(parent.kind) ||
        !hierarchyAllowsLayerMove(parent, nodesById))) ||
    wouldCreateHierarchyCycle(node.id, move.parentId, nodesById)
  ) {
    return null;
  }
  const targetSiblingIds = nodes
    .filter(
      (candidate) =>
        candidate.parentId === move.parentId && candidate.id !== node.id,
    )
    .map(({ id }) => id);
  if (move.index > targetSiblingIds.length) return null;
  const orderedNodeIds = [
    ...targetSiblingIds.slice(0, move.index),
    node.id,
    ...targetSiblingIds.slice(move.index),
  ];
  const nextNodes = nodesWithLayerPlacement(nodes, move);
  if (node.parentId === move.parentId) {
    const currentOrder = nodes
      .filter((candidate) => candidate.parentId === move.parentId)
      .map(({ id }) => id);
    if (JSON.stringify(currentOrder) === JSON.stringify(orderedNodeIds)) {
      return null;
    }
    return {
      label: `Reorder ${node.name}`,
      nextNodes,
      options: { selectedIds: [node.id], targetIds: [node.id] },
      receipt: { kind: "order", orderedNodeIds, parentId: move.parentId },
      trace: `Reordered ${node.name} from Layers`,
    };
  }

  const parentPosition = parent?.position ?? { x: 0, y: 0 };
  const localNode: WorkbenchNode = {
    ...node,
    parentId: move.parentId,
    position: {
      x: node.position.x - parentPosition.x,
      y: node.position.y - parentPosition.y,
    },
  };
  const destination = parent === undefined ? "to canvas" : `into ${parent.name}`;
  return {
    label: `Move ${node.name} ${destination}`,
    nextNodes,
    options: {
      selectedIds: [node.id],
      targetIds: parent === undefined ? [node.id] : [node.id, parent.id],
    },
    receipt: {
      kind: "reparent",
      nextIndices: [move.index],
      nodes: [localNode],
    },
    trace: `Moved ${node.name} ${destination}`,
  };
}
