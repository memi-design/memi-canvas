import {
  canReadCanvasSystemClipboard,
  copyCanvasSelection,
  createCanvasImageNodeAtPoint,
  cutCanvasSelection,
  pasteCanvasClipboard,
  readCanvasImageFromSystem,
  readCanvasClipboardFromSystem,
  readCanvasSessionClipboard,
  writeCanvasClipboardToSystem,
  type CanvasClipboardImage,
  type CanvasClipboardPayload,
} from "./canvas-clipboard.js";
import {
  componentDuplicateBase,
  dependentNodeIds,
  nodeAuthority,
  provenanceFromSource,
  replaceNode,
  uniqueNodeId,
  type Point,
  type ComponentInstanceBinding,
  type WorkbenchNode,
} from "./model.js";
import type { WorkbenchHistoryActions } from "./workbench-history-actions.js";

interface DocumentActionContext {
  readonly appendTrace: WorkbenchHistoryActions["appendTrace"];
  readonly commitScene: WorkbenchHistoryActions["commitScene"];
  readonly documentId: string;
  readonly getPastePoint?: () => Point | null;
  readonly nodes: readonly WorkbenchNode[];
  readonly selectedNode: WorkbenchNode | undefined;
  readonly selectedNodeId: string | null;
  readonly selectedNodeIds: readonly string[];
}

export interface WorkbenchDocumentActions {
  readonly copySelection: () => void;
  readonly createComponentFromSelection: () => void;
  readonly cutSelection: () => void;
  readonly deleteSelection: () => void;
  readonly detachSelection: () => void;
  readonly duplicateSelection: () => void;
  readonly frameSelection: () => void;
  readonly groupSelection: () => void;
  readonly orderSelection: (
    direction: "forward" | "backward" | "front" | "back",
  ) => void;
  readonly pasteSelection: (
    payload?: CanvasClipboardPayload | null,
  ) => void;
  readonly pasteImage: (image: CanvasClipboardImage) => void;
  readonly toggleSelectionProperty: (
    property: "hidden" | "locked",
  ) => void;
  readonly ungroupSelection: () => void;
}

function imagePasteParentId(
  selected: WorkbenchNode | undefined,
): string | null {
  if (selected === undefined) {
    return null;
  }
  return selected.kind === "Frame" ||
    selected.kind === "Group" ||
    selected.kind === "Section" ||
    selected.kind === "DraftFrame"
    ? selected.id
    : selected.parentId;
}

function localComponentBinding(
  documentId: string,
  masterId: string,
  componentName: string,
): ComponentInstanceBinding {
  return {
    atomicLevel: "molecule",
    classification: "master",
    componentId: `local:${documentId}:${masterId}`,
    componentName,
    editable: {
      icon: true,
      label: true,
      selected: true,
      variant: true,
    },
    props: { label: componentName },
    role: "card",
    source: {
      repositoryRevision: `local:${documentId}`,
      sourceAnchor: `canvas://${documentId}/${masterId}`,
    },
  };
}

function detachedDuplicateBase(node: WorkbenchNode): WorkbenchNode {
  const cloned = structuredClone(node);
  const { source: clonedSource, ...clonedWithoutSource } = cloned;
  const detachedCopy =
    clonedSource === undefined
      ? cloned
      : {
          ...clonedWithoutSource,
          kind: "DraftFrame" as const,
          frameContent: cloned.frameContent ?? cloned.name,
          provenance: provenanceFromSource(clonedSource),
        };
  return componentDuplicateBase(detachedCopy);
}

export function duplicateWorkbenchNode(
  node: WorkbenchNode,
  nodes: readonly WorkbenchNode[],
  offset: Point,
): WorkbenchNode {
  const duplicateBase = detachedDuplicateBase(node);
  return {
    ...duplicateBase,
    id: uniqueNodeId(nodes, `${node.id}-copy`),
    name: `${node.name} copy`,
    parentId: node.parentId,
    position: {
      x: node.position.x + offset.x,
      y: node.position.y + offset.y,
    },
  };
}

export function descendantNodeIds(
  nodes: readonly WorkbenchNode[],
  rootIds: readonly string[],
): readonly string[] {
  const included = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (
        !included.has(node.id) &&
        node.parentId !== null &&
        included.has(node.parentId)
      ) {
        included.add(node.id);
        changed = true;
      }
    }
  }
  return nodes.filter(({ id }) => included.has(id)).map(({ id }) => id);
}

export function duplicateWorkbenchSubtrees(
  roots: readonly WorkbenchNode[],
  nodes: readonly WorkbenchNode[],
  offset: Point,
): readonly WorkbenchNode[] {
  const subtreeIds = new Set(
    descendantNodeIds(
      nodes,
      roots.map(({ id }) => id),
    ),
  );
  const originals = nodes.filter(({ id }) => subtreeIds.has(id));
  const reservedIds = new Set(nodes.map(({ id }) => id));
  const copyIds = new Map<string, string>();
  for (const original of originals) {
    const baseId = `${original.id}-copy`;
    let suffix = 1;
    let id = `${baseId}-${suffix}`;
    while (reservedIds.has(id)) {
      suffix += 1;
      id = `${baseId}-${suffix}`;
    }
    reservedIds.add(id);
    copyIds.set(original.id, id);
  }
  return originals.map((original) => {
    const duplicate = detachedDuplicateBase(original);
    return {
      ...duplicate,
      id: copyIds.get(original.id) ?? `${original.id}-copy-1`,
      name: `${original.name} copy`,
      parentId:
        original.parentId === null
          ? null
          : copyIds.get(original.parentId) ?? original.parentId,
      position: {
        x: original.position.x + offset.x,
        y: original.position.y + offset.y,
      },
    };
  });
}

function reorderSiblingIds(
  siblingIds: readonly string[],
  selectedIds: ReadonlySet<string>,
  direction: "forward" | "backward" | "front" | "back",
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

function hierarchyOrderedNodes(
  nodes: readonly WorkbenchNode[],
  selectedIds: ReadonlySet<string>,
  direction: "forward" | "backward" | "front" | "back",
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
    childrenByParent.set(
      parentId,
      [...reorderSiblingIds(siblingIds, selectedIds, direction)],
    );
  }

  const orderedNodes: WorkbenchNode[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) {
      return;
    }
    const node = nodesById.get(id);
    if (node === undefined) {
      return;
    }
    visited.add(id);
    orderedNodes.push(node);
    for (const childId of childrenByParent.get(id) ?? []) {
      visit(childId);
    }
  };
  for (const rootId of childrenByParent.get(null) ?? []) {
    visit(rootId);
  }
  for (const node of nodes) {
    visit(node.id);
  }
  return orderedNodes;
}

export function createWorkbenchDocumentActions(
  context: DocumentActionContext,
): WorkbenchDocumentActions {
  const clipboardInput = () => ({
    documentId: context.documentId,
    nodes: context.nodes,
    selectedIds: context.selectedNodeIds,
  });

  const copySelection = () => {
    const payload = copyCanvasSelection(clipboardInput());
    if (payload !== null) {
      void writeCanvasClipboardToSystem(payload);
    }
  };

  const cutSelection = () => {
    const result = cutCanvasSelection(clipboardInput());
    if (result === null || result.deletedIds.length === 0) {
      return;
    }
    void writeCanvasClipboardToSystem(result.payload);
    const label =
      result.deletedIds.length === 1
        ? `Cut ${
            context.nodes.find(({ id }) => id === result.deletedIds[0])
              ?.name ?? "selection"
          }`
        : `Cut ${result.deletedIds.length} layers`;
    context.commitScene(label, result.nodes, {
      selectedIds: [],
      targetIds: result.deletedIds,
    });
  };

  const pasteSelection = (
    eventPayload?: CanvasClipboardPayload | null,
  ) => {
    const commitPaste = (payload = readCanvasSessionClipboard()) => {
      const result = pasteCanvasClipboard(context.nodes, payload);
      if (result === null) {
        return;
      }
      const count = result.pastedNodes.length;
      context.commitScene(
        `Paste ${count === 1 ? result.pastedNodes[0]?.name ?? "layer" : `${count} layers`}`,
        result.nodes,
        {
          selectedIds: result.selectedIds,
          targetIds: result.pastedNodes.map(({ id }) => id),
        },
      );
    };
    if (eventPayload !== undefined) {
      commitPaste(eventPayload);
      return;
    }
    if (!canReadCanvasSystemClipboard()) {
      commitPaste();
      return;
    }
    void readCanvasImageFromSystem().then((systemImage) => {
      if (systemImage !== null) {
        pasteImage(systemImage);
        return;
      }
      void readCanvasClipboardFromSystem().then((systemPayload) => {
        commitPaste(systemPayload);
      });
    });
  };

  const pasteImage = (image: CanvasClipboardImage) => {
    const selected = context.selectedNode;
    const cursor = context.getPastePoint?.() ?? null;
    const node = createCanvasImageNodeAtPoint({
      cursor:
        cursor ?? {
          x: (selected?.position.x ?? 0) + 24,
          y: (selected?.position.y ?? 0) + 24,
        },
      image,
      nodes: context.nodes,
      parentId: imagePasteParentId(selected),
    });
    if (node === null) {
      return;
    }
    context.commitScene("Paste image", [...context.nodes, node], {
      selectedIds: [node.id],
      targetIds: [node.id],
    });
    context.appendTrace(
      cursor === null
        ? "Pasted image near selection"
        : "Pasted image at cursor",
      node.id,
    );
  };

  const duplicateSelection = () => {
    const selectedNodes = context.selectedNodeIds
      .map((id) => context.nodes.find((node) => node.id === id))
      .filter((node): node is WorkbenchNode => node !== undefined);
    if (selectedNodes.length === 0) {
      return;
    }
    const selectedSet = new Set(selectedNodes.map(({ id }) => id));
    const roots = selectedNodes.filter((node) => {
      let parentId = node.parentId;
      while (parentId !== null) {
        if (selectedSet.has(parentId)) {
          return false;
        }
        parentId =
          context.nodes.find(({ id }) => id === parentId)?.parentId ??
          null;
      }
      return true;
    });
    const duplicates = duplicateWorkbenchSubtrees(
      roots,
      context.nodes,
      { x: 16, y: 16 },
    );
    const label =
      selectedNodes.length === 1
        ? `Duplicate ${selectedNodes[0]?.name ?? "selection"}`
        : `Duplicate ${selectedNodes.length} layers`;
    context.commitScene(label, [...context.nodes, ...duplicates], {
      selectedIds: duplicates.map((node) => node.id),
      targetIds: duplicates.map((node) => node.id),
    });
    context.appendTrace(
      selectedNodes.length === 1
        ? `Duplicated ${selectedNodes[0]?.name ?? "selection"}`
        : `Duplicated ${selectedNodes.length} layers`,
      duplicates.at(-1)?.id ?? "canvas",
    );
  };

  const deleteSelection = () => {
    const protectedKinds = new Set([
      "CodeFrame",
      "RoutePlaceholder",
      "ReferenceFrame",
    ]);
    const deletableIds = context.selectedNodeIds.filter((id) => {
      const node = context.nodes.find((candidate) => candidate.id === id);
      return node !== undefined && !protectedKinds.has(node.kind);
    });
    if (deletableIds.length === 0) {
      return;
    }
    const deletedIds = new Set(
      deletableIds.flatMap((id) => [
        ...dependentNodeIds(context.nodes, id),
      ]),
    );
    const remaining = context.nodes.filter(
      (node) => !deletedIds.has(node.id),
    );
    const label =
      deletableIds.length === 1
        ? `Delete ${
            context.nodes.find((node) => node.id === deletableIds[0])
              ?.name ?? "selection"
          }`
        : `Delete ${deletableIds.length} layers`;
    context.commitScene(label, remaining, {
      selectedIds: [],
      targetIds: [...deletedIds],
    });
    context.appendTrace(
      label.replace("Delete", "Deleted"),
      deletableIds[0] ?? "canvas",
    );
  };

  const detachSelection = () => {
    const selectedNode = context.selectedNode;
    if (
      (selectedNode?.kind !== "CodeFrame" &&
        selectedNode?.kind !== "RoutePlaceholder") ||
      selectedNode.source === undefined
    ) {
      return;
    }
    context.commitScene(
      `Detach ${selectedNode.name}`,
      replaceNode(context.nodes, selectedNode.id, (node) => {
        const { source, ...withoutSource } = node;
        if (source === undefined) {
          return node;
        }
        return {
          ...withoutSource,
          kind: "DraftFrame",
          provenance: provenanceFromSource(source),
          frameContent: node.name,
        };
      }),
      {
        selectedIds: [selectedNode.id],
        targetIds: [selectedNode.id],
      },
    );
    context.appendTrace(
      `Detached ${selectedNode.name} from ${nodeAuthority(selectedNode)}`,
      selectedNode.id,
    );
  };

  const wrapSelection = (kind: "Component" | "Frame" | "Group") => {
    if (
      context.selectedNodeIds.length < (kind === "Group" ? 2 : 1)
    ) {
      return;
    }
    const selected = new Set(context.selectedNodeIds);
    const roots = context.nodes.filter((node) => {
      if (!selected.has(node.id)) {
        return false;
      }
      let parentId = node.parentId;
      while (parentId !== null) {
        if (selected.has(parentId)) {
          return false;
        }
        parentId =
          context.nodes.find((candidate) => candidate.id === parentId)
            ?.parentId ?? null;
      }
      return true;
    });
    if (roots.length < (kind === "Group" ? 2 : 1)) {
      return;
    }
    const sharedParentId = roots[0]?.parentId ?? null;
    if (roots.some(({ parentId }) => parentId !== sharedParentId)) {
      return;
    }
    const minimumX = Math.min(...roots.map((node) => node.position.x));
    const minimumY = Math.min(...roots.map((node) => node.position.y));
    const maximumX = Math.max(
      ...roots.map((node) => node.position.x + node.size.width),
    );
    const maximumY = Math.max(
      ...roots.map((node) => node.position.y + node.size.height),
    );
    const containerId = uniqueNodeId(
      context.nodes,
      `node-${kind.toLocaleLowerCase()}`,
    );
    const containerName = `${kind} ${
      context.nodes.filter((node) => node.kind === kind).length + 1
    }`;
    const group = {
      id: containerId,
      kind,
      name: containerName,
      parentId: sharedParentId,
      position: { x: minimumX, y: minimumY },
      size: {
        width: Math.max(1, maximumX - minimumX),
        height: Math.max(1, maximumY - minimumY),
      },
      locked: false,
      hidden: false,
      ...(kind === "Component"
        ? {
            component: localComponentBinding(
              context.documentId,
              containerId,
              containerName,
            ),
          }
        : {}),
    } as WorkbenchNode;
    const rootIds = new Set(roots.map((node) => node.id));
    const reparentedNodes = context.nodes.map((node) =>
      rootIds.has(node.id)
        ? { ...node, parentId: containerId }
        : node,
    );
    const firstRootIndex = Math.min(
      ...roots.map(({ id }) =>
        reparentedNodes.findIndex((node) => node.id === id),
      ),
    );
    const nextNodes = [
      ...reparentedNodes.slice(0, firstRootIndex),
      group,
      ...reparentedNodes.slice(firstRootIndex),
    ];
    const verb =
      kind === "Group"
        ? "Group"
        : kind === "Frame"
          ? "Frame"
          : "Create component from";
    context.commitScene(
      `${verb} ${roots.length} layers`,
      nextNodes,
      {
        selectedIds: [containerId],
        targetIds: [...roots.map((node) => node.id), containerId],
      },
    );
    context.appendTrace(
      `${verb} ${roots.length} layers`,
      containerId,
    );
  };

  const groupSelection = () => wrapSelection("Group");
  const frameSelection = () => wrapSelection("Frame");
  const createComponentFromSelection = () =>
    wrapSelection("Component");

  const toggleSelectionProperty = (
    property: "hidden" | "locked",
  ) => {
    if (context.selectedNodeIds.length === 0) {
      return;
    }
    const selected = new Set(
      descendantNodeIds(context.nodes, context.selectedNodeIds),
    );
    const allEnabled = context.nodes
      .filter((node) => selected.has(node.id))
      .every((node) => node[property]);
    const nextValue = !allEnabled;
    const label = `${
      property === "hidden"
        ? nextValue
          ? "Hide"
          : "Show"
        : nextValue
          ? "Lock"
          : "Unlock"
    } ${context.selectedNodeIds.length === 1 ? context.selectedNode?.name ?? "selection" : `${context.selectedNodeIds.length} layers`}`;
    context.commitScene(
      label,
      context.nodes.map((node) =>
        selected.has(node.id)
          ? { ...node, [property]: nextValue }
          : node,
      ),
      { targetIds: [...selected] },
    );
    context.appendTrace(label, context.selectedNodeId ?? "canvas");
  };

  const ungroupSelection = () => {
    const groupIds = context.selectedNodeIds.filter(
      (id) =>
        context.nodes.find((node) => node.id === id)?.kind ===
        ("Group" as never),
    );
    if (groupIds.length === 0) {
      return;
    }
    const groupSet = new Set(groupIds);
    const groups = new Map(
      context.nodes
        .filter((node) => groupSet.has(node.id))
        .map((node) => [node.id, node]),
    );
    const childIds = context.nodes
      .filter(
        (node) =>
          node.parentId !== null && groupSet.has(node.parentId),
      )
      .map(({ id }) => id);
    const childSet = new Set(childIds);
    const nextNodes = context.nodes.flatMap((node) => {
      const selectedGroup = groups.get(node.id);
      if (selectedGroup !== undefined) {
        return context.nodes
          .filter(({ parentId }) => parentId === selectedGroup.id)
          .map((child) => ({
            ...child,
            parentId: selectedGroup.parentId,
          }));
      }
      return childSet.has(node.id) ? [] : [node];
    });
    const label = `Ungroup ${
      groupIds.length === 1
        ? groups.get(groupIds[0] ?? "")?.name ?? "group"
        : `${groupIds.length} groups`
    }`;
    context.commitScene(label, nextNodes, {
      selectedIds: childIds,
      targetIds: [...groupIds, ...childIds],
    });
    context.appendTrace(
      `Ungrouped ${groupIds.length === 1 ? "selection" : `${groupIds.length} groups`}`,
      childIds.at(-1) ?? "canvas",
    );
  };

  const orderSelection: WorkbenchDocumentActions["orderSelection"] = (
    direction,
  ) => {
    if (context.selectedNodeIds.length === 0) {
      return;
    }
    const selected = new Set(context.selectedNodeIds);
    const nextNodes = hierarchyOrderedNodes(
      context.nodes,
      selected,
      direction,
    );
    const label = `${
      direction === "front"
        ? "Bring to front"
        : direction === "back"
          ? "Send to back"
          : direction === "forward"
            ? "Bring forward"
            : "Send backward"
    } ${context.selectedNodeIds.length === 1 ? context.selectedNode?.name ?? "selection" : `${context.selectedNodeIds.length} layers`}`;
    context.commitScene(label, nextNodes, {
      targetIds: context.selectedNodeIds,
    });
    context.appendTrace(
      `Reordered ${context.selectedNodeIds.length === 1 ? context.selectedNode?.name ?? "selection" : `${context.selectedNodeIds.length} layers`} ${direction}`,
      context.selectedNodeId ?? "canvas",
    );
  };

  return {
    copySelection,
    createComponentFromSelection,
    cutSelection,
    deleteSelection,
    detachSelection,
    duplicateSelection,
    frameSelection,
    groupSelection,
    orderSelection,
    pasteImage,
    pasteSelection,
    toggleSelectionProperty,
    ungroupSelection,
  };
}
