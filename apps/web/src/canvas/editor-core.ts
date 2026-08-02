import type {
  DesignDocument,
  DocumentNode,
  Point,
  ViewportState,
} from "./model.js";

export type LayerOrderChange = "forward" | "backward" | "front" | "back";

export interface GroupIdentity {
  readonly id: string;
  readonly name: string;
}

export interface PointerTransaction {
  readonly document: DesignDocument;
  readonly viewport: ViewportState;
}

export interface EditorSnapshot {
  readonly document: DesignDocument;
  readonly viewport: ViewportState;
}

function nodeMap(
  document: DesignDocument,
): ReadonlyMap<string, DocumentNode> {
  return new Map(document.nodes.map((node) => [node.id, node]));
}

function childIdsForParent(
  document: DesignDocument,
  parentId: string | null,
): readonly string[] {
  if (parentId === null) {
    return document.rootIds;
  }
  return (
    document.nodes.find((node) => node.id === parentId)?.childIds ?? []
  );
}

function withChildIds(
  document: DesignDocument,
  parentId: string | null,
  childIds: readonly string[],
): DesignDocument {
  if (parentId === null) {
    return { ...document, rootIds: [...childIds] };
  }
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === parentId ? { ...node, childIds: [...childIds] } : node,
    ),
  };
}

function hasSelectedAncestor(
  node: DocumentNode,
  selectedIds: ReadonlySet<string>,
  byId: ReadonlyMap<string, DocumentNode>,
): boolean {
  let parentId = node.parentId;
  const visited = new Set<string>();
  while (parentId !== null && !visited.has(parentId)) {
    if (selectedIds.has(parentId)) {
      return true;
    }
    visited.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return false;
}

function selectedRoots(
  document: DesignDocument,
  selectedNodeIds: readonly string[],
): readonly DocumentNode[] {
  const byId = nodeMap(document);
  const selectedIds = new Set(selectedNodeIds);
  return selectedNodeIds
    .map((id) => byId.get(id))
    .filter(
      (node): node is DocumentNode =>
        node !== undefined &&
        !hasSelectedAncestor(node, selectedIds, byId),
    );
}

function revised(
  document: DesignDocument,
  changes: Omit<Partial<DesignDocument>, "revision">,
): DesignDocument {
  return {
    ...document,
    ...changes,
    revision: document.revision + 1,
  };
}

export function moveNodes(
  document: DesignDocument,
  nodeIds: readonly string[],
  delta: Point,
): DesignDocument {
  const roots = selectedRoots(document, nodeIds).filter(
    (node) => !node.locked,
  );
  if (
    roots.length === 0 ||
    (!Number.isFinite(delta.x) && !Number.isFinite(delta.y)) ||
    (delta.x === 0 && delta.y === 0)
  ) {
    return document;
  }
  const rootIds = new Set(roots.map((node) => node.id));
  return revised(document, {
    nodes: document.nodes.map((node) =>
      rootIds.has(node.id)
        ? {
            ...node,
            position: {
              x: node.position.x + (Number.isFinite(delta.x) ? delta.x : 0),
              y: node.position.y + (Number.isFinite(delta.y) ? delta.y : 0),
            },
          }
        : node,
    ),
  });
}

export function groupNodes(
  document: DesignDocument,
  nodeIds: readonly string[],
  identity: GroupIdentity,
): DesignDocument {
  if (document.nodes.some((node) => node.id === identity.id)) {
    throw new Error(`A node with id "${identity.id}" already exists.`);
  }
  const roots = selectedRoots(document, nodeIds);
  if (roots.length === 0) {
    return document;
  }
  const parentId = roots[0]?.parentId ?? null;
  if (roots.some((node) => node.parentId !== parentId)) {
    throw new Error("Only sibling nodes can be grouped.");
  }
  const siblingIds = childIdsForParent(document, parentId);
  const selectedIds = new Set(roots.map((node) => node.id));
  const orderedIds = siblingIds.filter((id) => selectedIds.has(id));
  if (orderedIds.length !== roots.length) {
    throw new Error("The document sibling order is incomplete.");
  }

  const byId = nodeMap(document);
  const orderedNodes = orderedIds
    .map((id) => byId.get(id))
    .filter((node): node is DocumentNode => node !== undefined);
  const minimumX = Math.min(...orderedNodes.map((node) => node.position.x));
  const minimumY = Math.min(...orderedNodes.map((node) => node.position.y));
  const maximumX = Math.max(
    ...orderedNodes.map((node) => node.position.x + node.size.width),
  );
  const maximumY = Math.max(
    ...orderedNodes.map((node) => node.position.y + node.size.height),
  );
  const firstIndex = Math.min(
    ...orderedIds.map((id) => siblingIds.indexOf(id)),
  );
  const remainingSiblingIds = siblingIds.filter(
    (id) => !selectedIds.has(id),
  );
  const nextSiblingIds = [
    ...remainingSiblingIds.slice(0, firstIndex),
    identity.id,
    ...remainingSiblingIds.slice(firstIndex),
  ];
  const group: DocumentNode = {
    id: identity.id,
    kind: "Group",
    name: identity.name,
    parentId,
    childIds: orderedIds,
    position: { x: minimumX, y: minimumY },
    size: {
      width: maximumX - minimumX,
      height: maximumY - minimumY,
    },
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    styles: {},
    constraints: {
      horizontal: "left",
      vertical: "top",
    },
  };
  const reparentedNodes = document.nodes.map((node) =>
    selectedIds.has(node.id)
      ? {
          ...node,
          parentId: identity.id,
          position: {
            x: node.position.x - minimumX,
            y: node.position.y - minimumY,
          },
        }
      : node,
  );
  const withGroup: DesignDocument = {
    ...document,
    nodes: [...reparentedNodes, group],
  };
  const reordered = withChildIds(withGroup, parentId, nextSiblingIds);
  return revised(document, {
    nodes: reordered.nodes,
    rootIds: reordered.rootIds,
  });
}

function ungroupOne(
  document: DesignDocument,
  groupId: string,
): DesignDocument {
  const group = document.nodes.find((node) => node.id === groupId);
  if (group?.kind !== "Group") {
    return document;
  }
  const parentId = group.parentId;
  const siblingIds = childIdsForParent(document, parentId);
  const groupIndex = siblingIds.indexOf(group.id);
  if (groupIndex < 0) {
    throw new Error(`Group "${group.id}" is missing from its parent order.`);
  }
  const nextSiblingIds = [
    ...siblingIds.slice(0, groupIndex),
    ...group.childIds,
    ...siblingIds.slice(groupIndex + 1),
  ];
  const childIds = new Set(group.childIds);
  const nodes = document.nodes
    .filter((node) => node.id !== group.id)
    .map((node) =>
      childIds.has(node.id)
        ? {
            ...node,
            parentId,
            position: {
              x: group.position.x + node.position.x,
              y: group.position.y + node.position.y,
            },
          }
        : node,
    );
  return withChildIds({ ...document, nodes }, parentId, nextSiblingIds);
}

export function ungroupNodes(
  document: DesignDocument,
  groupIds: readonly string[],
): DesignDocument {
  const ungrouped = groupIds.reduce(ungroupOne, document);
  return ungrouped === document
    ? document
    : revised(document, {
        nodes: ungrouped.nodes,
        rootIds: ungrouped.rootIds,
      });
}

function reorderedIds(
  siblingIds: readonly string[],
  nodeId: string,
  change: LayerOrderChange,
): readonly string[] {
  const index = siblingIds.indexOf(nodeId);
  if (index < 0) {
    return siblingIds;
  }
  const withoutNode = siblingIds.filter((id) => id !== nodeId);
  const targetIndex =
    change === "front"
      ? withoutNode.length
      : change === "back"
        ? 0
        : change === "forward"
          ? Math.min(withoutNode.length, index + 1)
          : Math.max(0, index - 1);
  return [
    ...withoutNode.slice(0, targetIndex),
    nodeId,
    ...withoutNode.slice(targetIndex),
  ];
}

export function reorderNode(
  document: DesignDocument,
  nodeId: string,
  change: LayerOrderChange,
): DesignDocument {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    return document;
  }
  const currentIds = childIdsForParent(document, node.parentId);
  const nextIds = reorderedIds(currentIds, nodeId, change);
  if (nextIds.every((id, index) => id === currentIds[index])) {
    return document;
  }
  const reordered = withChildIds(document, node.parentId, nextIds);
  return revised(document, {
    nodes: reordered.nodes,
    rootIds: reordered.rootIds,
  });
}

export function startPointerTransaction(
  document: DesignDocument,
  viewport: ViewportState,
): PointerTransaction {
  return {
    document: structuredClone(document),
    viewport: structuredClone(viewport),
  };
}

export function rollbackPointerTransaction(
  transaction: PointerTransaction,
  _current: EditorSnapshot,
): EditorSnapshot {
  return {
    document: transaction.document,
    viewport: transaction.viewport,
  };
}
