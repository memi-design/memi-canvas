import type {
  CanvasActionIntentV2,
  CanvasDocumentV2,
  CanvasNodeV2,
} from "@memi/protocol";

import type { Size, WorkbenchNode } from "./model.js";

export type WorkbenchProjectionAction =
  | {
      readonly type: "node.create";
      readonly payload: {
        readonly index: number;
        readonly node: WorkbenchNode;
      };
    }
  | {
      readonly type: "node.delete";
      readonly payload: { readonly nodeId: string };
    }
  | {
      readonly type: "node.transform";
      readonly payload: {
        readonly next: {
          readonly rotation: number;
          readonly x: number;
          readonly y: number;
        };
        readonly nodeId: string;
      };
    }
  | {
      readonly type: "node.geometry";
      readonly payload: {
        readonly next: Size;
        readonly nodeId: string;
      };
    }
  | {
      readonly type: "node.reparent";
      readonly payload: {
        readonly nextIndex: number;
        readonly nextParentId: string | null;
        readonly nodeId: string;
      };
    }
  | {
      readonly type: "node.reorder";
      readonly payload: {
        readonly nextOrder: readonly string[];
        readonly parentId: string | null;
      };
    }
  | {
      readonly type: "node.replace";
      readonly payload: { readonly node: WorkbenchNode };
    };

type ChildIntent = Exclude<
  CanvasActionIntentV2,
  { readonly type: "atomic.batch" }
>;

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equal(value, right[index]))
    );
  }
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        equal(leftRecord[key], rightRecord[key]),
    )
  );
}

function siblingIds(
  nodes: readonly WorkbenchNode[],
  parentId: string | null,
): readonly string[] {
  return nodes
    .filter((node) => node.parentId === parentId)
    .map(({ id }) => id);
}

function depth(
  node: WorkbenchNode,
  nodesById: ReadonlyMap<string, WorkbenchNode>,
): number {
  let result = 0;
  let parentId = node.parentId;
  const visited = new Set<string>();
  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    result += 1;
    parentId = nodesById.get(parentId)?.parentId ?? null;
  }
  return result;
}

function replacementValues(node: WorkbenchNode): unknown {
  const {
    parentId: _parentId,
    position: _position,
    rotation: _rotation,
    size: _size,
    ...values
  } = node;
  return values;
}

function descendantsOf(
  nodes: readonly WorkbenchNode[],
  rootId: string,
): ReadonlySet<string> {
  const result = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (
        !result.has(node.id) &&
        node.parentId !== null &&
        result.has(node.parentId)
      ) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return result;
}

function insertionIndex(
  nodes: readonly WorkbenchNode[],
  parentId: string | null,
  siblingIndex: number,
): number {
  const siblings = siblingIds(nodes, parentId);
  const nextSiblingId = siblings[siblingIndex];
  if (nextSiblingId !== undefined) {
    const index = nodes.findIndex(({ id }) => id === nextSiblingId);
    return index < 0 ? nodes.length : index;
  }
  if (parentId === null) {
    return nodes.length;
  }
  const parentIndex = nodes.findIndex(({ id }) => id === parentId);
  if (parentIndex < 0) {
    throw new Error(`Workbench parent does not exist: ${parentId}`);
  }
  const parentSubtree = descendantsOf(nodes, parentId);
  let index = parentIndex + 1;
  while (index < nodes.length && parentSubtree.has(nodes[index]!.id)) {
    index += 1;
  }
  return index;
}

function insertProjectionNode(
  nodes: readonly WorkbenchNode[],
  node: WorkbenchNode,
  index: number,
): readonly WorkbenchNode[] {
  if (nodes.some(({ id }) => id === node.id)) {
    throw new Error(`Workbench node already exists: ${node.id}`);
  }
  if (
    node.parentId !== null &&
    !nodes.some(({ id }) => id === node.parentId)
  ) {
    throw new Error(`Workbench parent does not exist: ${node.parentId}`);
  }
  const at = insertionIndex(nodes, node.parentId, index);
  return [...nodes.slice(0, at), structuredClone(node), ...nodes.slice(at)];
}

function replaceProjectionNode(
  nodes: readonly WorkbenchNode[],
  nodeId: string,
  update: (node: WorkbenchNode) => WorkbenchNode,
): readonly WorkbenchNode[] {
  if (!nodes.some(({ id }) => id === nodeId)) {
    throw new Error(`Workbench node does not exist: ${nodeId}`);
  }
  return nodes.map((node) => (node.id === nodeId ? update(node) : node));
}

function reparentProjectionNode(
  nodes: readonly WorkbenchNode[],
  nodeId: string,
  nextParentId: string | null,
  nextIndex: number,
): readonly WorkbenchNode[] {
  const subtreeIds = descendantsOf(nodes, nodeId);
  if (nextParentId !== null && subtreeIds.has(nextParentId)) {
    throw new Error("Workbench reparent would create a hierarchy cycle.");
  }
  const subtree = nodes.filter(({ id }) => subtreeIds.has(id));
  if (subtree.length === 0) {
    throw new Error(`Workbench node does not exist: ${nodeId}`);
  }
  const remaining = nodes.filter(({ id }) => !subtreeIds.has(id));
  const root = subtree.find(({ id }) => id === nodeId)!;
  const nextRoot = { ...root, parentId: nextParentId };
  const at = insertionIndex(remaining, nextParentId, nextIndex);
  return [
    ...remaining.slice(0, at),
    nextRoot,
    ...subtree.filter(({ id }) => id !== nodeId),
    ...remaining.slice(at),
  ];
}

function reorderProjectionSiblings(
  nodes: readonly WorkbenchNode[],
  parentId: string | null,
  nextOrder: readonly string[],
): readonly WorkbenchNode[] {
  const currentOrder = siblingIds(nodes, parentId);
  if (
    currentOrder.length !== nextOrder.length ||
    new Set(nextOrder).size !== nextOrder.length ||
    nextOrder.some((id) => !currentOrder.includes(id))
  ) {
    throw new Error("Workbench reorder must be a sibling permutation.");
  }
  let result = nodes;
  nextOrder.forEach((nodeId, index) => {
    result = reparentProjectionNode(result, nodeId, parentId, index);
  });
  return result;
}

export function applyWorkbenchProjectionActions(
  nodes: readonly WorkbenchNode[],
  actions: readonly WorkbenchProjectionAction[],
): readonly WorkbenchNode[] {
  return actions.reduce<readonly WorkbenchNode[]>((current, action) => {
    if (action.type === "node.create") {
      return insertProjectionNode(
        current,
        action.payload.node,
        action.payload.index,
      );
    }
    if (action.type === "node.delete") {
      const node = current.find(({ id }) => id === action.payload.nodeId);
      if (node === undefined) {
        throw new Error(`Workbench node does not exist: ${action.payload.nodeId}`);
      }
      if (current.some(({ parentId }) => parentId === node.id)) {
        throw new Error("Workbench node delete requires child-first actions.");
      }
      return current.filter(({ id }) => id !== node.id);
    }
    if (action.type === "node.transform") {
      return replaceProjectionNode(current, action.payload.nodeId, (node) => ({
        ...node,
        position: { x: action.payload.next.x, y: action.payload.next.y },
        ...(node.rotation === undefined && action.payload.next.rotation === 0
          ? {}
          : { rotation: action.payload.next.rotation }),
      }));
    }
    if (action.type === "node.geometry") {
      return replaceProjectionNode(current, action.payload.nodeId, (node) => ({
        ...node,
        size: { ...action.payload.next },
      }));
    }
    if (action.type === "node.reparent") {
      return reparentProjectionNode(
        current,
        action.payload.nodeId,
        action.payload.nextParentId,
        action.payload.nextIndex,
      );
    }
    if (action.type === "node.reorder") {
      return reorderProjectionSiblings(
        current,
        action.payload.parentId,
        action.payload.nextOrder,
      );
    }
    return replaceProjectionNode(
      current,
      action.payload.node.id,
      () => structuredClone(action.payload.node),
    );
  }, nodes);
}

export function diffWorkbenchProjections(
  current: readonly WorkbenchNode[],
  desired: readonly WorkbenchNode[],
): readonly WorkbenchProjectionAction[] {
  const currentById = new Map(current.map((node) => [node.id, node]));
  const desiredById = new Map(desired.map((node) => [node.id, node]));
  const actions: WorkbenchProjectionAction[] = [];
  const added = new Set(
    desired.filter(({ id }) => !currentById.has(id)).map(({ id }) => id),
  );
  while (added.size > 0) {
    const node = desired.find(
      (candidate) =>
        added.has(candidate.id) &&
        (candidate.parentId === null || !added.has(candidate.parentId)),
    );
    if (node === undefined) {
      throw new Error("Workbench creation dependencies are cyclic.");
    }
    actions.push({
      payload: {
        index: siblingIds(desired, node.parentId).indexOf(node.id),
        node: structuredClone(node),
      },
      type: "node.create",
    });
    added.delete(node.id);
  }

  for (const node of desired) {
    const before = currentById.get(node.id);
    if (before === undefined) {
      continue;
    }
    if (before.parentId !== node.parentId) {
      actions.push({
        payload: {
          nextIndex: siblingIds(desired, node.parentId).indexOf(node.id),
          nextParentId: node.parentId,
          nodeId: node.id,
        },
        type: "node.reparent",
      });
    }
    if (
      !equal(before.position, node.position) ||
      (before.rotation ?? 0) !== (node.rotation ?? 0)
    ) {
      actions.push({
        payload: {
          next: {
            rotation: node.rotation ?? 0,
            x: node.position.x,
            y: node.position.y,
          },
          nodeId: node.id,
        },
        type: "node.transform",
      });
    }
    if (!equal(before.size, node.size)) {
      actions.push({
        payload: { next: { ...node.size }, nodeId: node.id },
        type: "node.geometry",
      });
    }
    if (!equal(replacementValues(before), replacementValues(node))) {
      actions.push({
        payload: { node: structuredClone(node) },
        type: "node.replace",
      });
    }
  }

  const removedById = new Map(
    current
      .filter(({ id }) => !desiredById.has(id))
      .map((node) => [node.id, node]),
  );
  [...removedById.values()]
    .sort(
      (left, right) =>
        depth(right, currentById) - depth(left, currentById),
    )
    .forEach((node) => {
      actions.push({
        payload: { nodeId: node.id },
        type: "node.delete",
      });
    });

  const structurallyApplied = applyWorkbenchProjectionActions(
    current,
    actions,
  );
  const parents = new Set<string | null>([
    null,
    ...desired.map(({ parentId }) => parentId),
  ]);
  for (const parentId of parents) {
    const beforeOrder = siblingIds(structurallyApplied, parentId);
    const nextOrder = siblingIds(desired, parentId);
    if (!equal(beforeOrder, nextOrder)) {
      actions.push({
        payload: { nextOrder, parentId },
        type: "node.reorder",
      });
    }
  }
  return actions;
}

function valueActions(
  current: CanvasNodeV2,
  desired: CanvasNodeV2,
): readonly ChildIntent[] {
  const actions: ChildIntent[] = [];
  const detached =
    (current.sourceBinding !== null ||
      current.componentBinding !== null) &&
    desired.sourceBinding === null &&
    desired.componentBinding === null &&
    desired.provenance !== null;
  if (detached) {
    actions.push({
      payload: {
        next: {
          component: {
            componentBinding: desired.componentBinding,
            componentId: desired.componentId,
            instanceOverrides: desired.instanceOverrides,
          },
          content: desired.content,
          identity: { kind: desired.kind, name: desired.name },
          provenance: {
            provenance: desired.provenance,
            referenceBinding: desired.referenceBinding,
            sourceBinding: desired.sourceBinding,
          },
        },
        nodeId: current.id,
      },
      type: "node.detach",
    });
  } else {
    if (
      current.kind !== desired.kind ||
      current.name !== desired.name
    ) {
      actions.push({
        payload: {
          next: { kind: desired.kind, name: desired.name },
          nodeId: current.id,
        },
        type: "node.identity",
      });
    }
    if (!equal(current.content, desired.content)) {
      actions.push({
        payload: { next: desired.content, nodeId: current.id },
        type: "node.content",
      });
    }
    const currentProvenance = {
      provenance: current.provenance,
      referenceBinding: current.referenceBinding,
      sourceBinding: current.sourceBinding,
    };
    const desiredProvenance = {
      provenance: desired.provenance,
      referenceBinding: desired.referenceBinding,
      sourceBinding: desired.sourceBinding,
    };
    if (!equal(currentProvenance, desiredProvenance)) {
      actions.push({
        payload: { next: desiredProvenance, nodeId: current.id },
        type: "node.provenance",
      });
    }
    const currentComponent = {
      componentBinding: current.componentBinding,
      componentId: current.componentId,
      instanceOverrides: current.instanceOverrides,
    };
    const desiredComponent = {
      componentBinding: desired.componentBinding,
      componentId: desired.componentId,
      instanceOverrides: desired.instanceOverrides,
    };
    if (!equal(currentComponent, desiredComponent)) {
      actions.push({
        payload: { next: desiredComponent, nodeId: current.id },
        type: "node.component",
      });
    }
  }
  const simpleValues = [
    ["node.transform", current.transform, desired.transform],
    ["node.geometry", current.geometry, desired.geometry],
    ["node.style", current.style, desired.style],
    ["node.layout", current.layout, desired.layout],
  ] as const;
  simpleValues.forEach(([type, prior, next]) => {
    if (!equal(prior, next)) {
      actions.push({
        payload: { next, nodeId: current.id },
        type,
      } as ChildIntent);
    }
  });
  if (!equal(current.text, desired.text) && desired.text !== null) {
    actions.push({
      payload: { next: desired.text, nodeId: current.id },
      type: "node.text",
    });
  }
  return actions;
}

function structuralActions(
  current: CanvasDocumentV2,
  desired: CanvasDocumentV2,
): readonly ChildIntent[] {
  const actions: ChildIntent[] = [];
  const currentIds = new Set(Object.keys(current.nodesById));
  const desiredIds = new Set(Object.keys(desired.nodesById));
  const added = new Set([...desiredIds].filter((id) => !currentIds.has(id)));
  const removed = new Set([...currentIds].filter((id) => !desiredIds.has(id)));
  const defined = new Set(Object.keys(current.componentsById));
  while (added.size > 0) {
    let progressed = false;
    for (const id of added) {
      const node = desired.nodesById[id];
      if (
        node === undefined ||
        (node.parentId !== null &&
          !currentIds.has(node.parentId) &&
          !desiredIds.has(node.parentId)) ||
        (node.parentId !== null && added.has(node.parentId)) ||
        (node.kind === "instance" &&
          node.componentId !== null &&
          !defined.has(node.componentId))
      ) {
        continue;
      }
      const siblings =
        node.parentId === null
          ? desired.rootIds
          : desired.nodesById[node.parentId]?.childIds ?? [];
      actions.push({
        payload: {
          index: siblings.indexOf(node.id),
          node: { ...node, childIds: [] },
          parentId: node.parentId,
        },
        type: "node.create",
      });
      const definition = Object.values(desired.componentsById).find(
        ({ rootNodeId }) => rootNodeId === node.id,
      );
      if (definition !== undefined && !defined.has(definition.id)) {
        actions.push({
          payload: { componentId: definition.id, next: definition },
          type: "component.define",
        });
        defined.add(definition.id);
      }
      added.delete(id);
      progressed = true;
    }
    if (!progressed) {
      throw new Error("Canonical canvas creation dependencies are cyclic.");
    }
  }
  for (const id of [...currentIds].filter((value) => desiredIds.has(value))) {
    const before = current.nodesById[id];
    const after = desired.nodesById[id];
    if (
      before !== undefined &&
      after !== undefined &&
      before.parentId !== after.parentId
    ) {
      const siblings =
        after.parentId === null
          ? desired.rootIds
          : desired.nodesById[after.parentId]?.childIds ?? [];
      actions.push({
        payload: {
          nextIndex: siblings.indexOf(after.id),
          nextParentId: after.parentId,
          nodeId: id,
        },
        type: "node.reparent",
      });
    }
  }
  const componentByRoot: ReadonlyMap<string, string> = new Map(
    Object.values(current.componentsById).map((component) => [
      component.rootNodeId,
      component.id,
    ]),
  );
  while (removed.size > 0) {
    const leaf = [...removed].find((id) => {
      const node = current.nodesById[id];
      return (
        node !== undefined &&
        node.childIds.every((childId) => !removed.has(childId)) &&
        !componentByRoot.has(id)
      );
    });
    const target =
      leaf ??
      [...removed].find((id) => {
        const node = current.nodesById[id];
        return node?.childIds.every((childId) => !removed.has(childId));
      });
    if (target === undefined) {
      throw new Error("Canonical canvas deletion dependencies are cyclic.");
    }
    const componentId = componentByRoot.get(target);
    if (componentId !== undefined) {
      actions.push({
        payload: { componentId, next: null },
        type: "component.define",
      });
    }
    actions.push({ payload: { nodeId: target }, type: "node.delete" });
    removed.delete(target);
  }
  return actions;
}

export function diffCanonicalWorkbenchDocuments(
  current: CanvasDocumentV2,
  desired: CanvasDocumentV2,
): readonly ChildIntent[] {
  const actions = [...structuralActions(current, desired)];
  for (const [id, after] of Object.entries(desired.nodesById)) {
    const before = current.nodesById[id];
    if (before !== undefined) {
      actions.push(...valueActions(before, after));
    }
  }
  const parents = new Set<string | null>([
    null,
    ...Object.values(desired.nodesById).map((node) => node.parentId),
  ]);
  for (const parentId of parents) {
    const before =
      parentId === null
        ? current.rootIds
        : current.nodesById[parentId]?.childIds ?? [];
    const next =
      parentId === null
        ? desired.rootIds
        : desired.nodesById[parentId]?.childIds ?? [];
    if (before.length === next.length && !equal(before, next)) {
      actions.push({
        payload: { nextOrder: next, parentId },
        type: "node.reorder",
      });
    }
  }
  return actions;
}
