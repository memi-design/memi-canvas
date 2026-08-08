import { useState, type DragEvent, type KeyboardEvent } from "react";

import type { WorkbenchNode } from "./model.js";

export interface LayerMoveRequest {
  readonly index: number;
  readonly nodeId: string;
  readonly parentId: string | null;
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

export function useDraftLayerMoves({
  nodes,
  nodesById,
  onMove,
}: {
  readonly nodes: readonly WorkbenchNode[];
  readonly nodesById: ReadonlyMap<string, WorkbenchNode>;
  readonly onMove?: (move: LayerMoveRequest) => void;
}) {
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const siblings = (parentId: string | null) =>
    nodes.filter((candidate) => candidate.parentId === parentId);
  const movable = (node: WorkbenchNode): boolean => {
    if (onMove === undefined) return false;
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
  };
  const acceptsChildren = (node: WorkbenchNode) =>
    editableContainerKinds.has(node.kind) && movable(node);
  const isAncestorOf = (ancestorId: string, nodeId: string): boolean => {
    const seen = new Set<string>();
    let current = nodesById.get(nodeId);
    while (current !== undefined && !seen.has(current.id)) {
      if (current.id === ancestorId) return true;
      seen.add(current.id);
      current =
        current.parentId === null
          ? undefined
          : nodesById.get(current.parentId);
    }
    return false;
  };
  const request = (move: LayerMoveRequest, message: string) => {
    onMove?.(move);
    setAnnouncement(message);
  };
  const dropMove = (
    event: DragEvent<HTMLLIElement>,
    target: WorkbenchNode,
  ): LayerMoveRequest | null => {
    const sourceId = draggedNodeId || event.dataTransfer.getData("text/plain");
    const source = nodesById.get(sourceId);
    if (
      source === undefined ||
      source.id === target.id ||
      !movable(source) ||
      isAncestorOf(source.id, target.id)
    ) {
      return null;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset =
      bounds.height <= 0 ? 0.5 : (event.clientY - bounds.top) / bounds.height;
    if (acceptsChildren(target) && offset >= 0.25 && offset <= 0.75) {
      return {
        index: siblings(target.id).filter(({ id }) => id !== source.id).length,
        nodeId: source.id,
        parentId: target.id,
      };
    }
    const targetSiblings = siblings(target.parentId).filter(
      ({ id }) => id !== source.id,
    );
    const targetIndex = targetSiblings.findIndex(({ id }) => id === target.id);
    return targetIndex < 0
      ? null
      : {
          index: targetIndex + (offset > 0.5 ? 1 : 0),
          nodeId: source.id,
          parentId: target.parentId,
        };
  };
  const dragProps = (node: WorkbenchNode) => {
    const draggable = onMove !== undefined && movable(node);
    return {
      draggable,
      onDragEnd: () => setDraggedNodeId(null),
      onDragOver: (event: DragEvent<HTMLLIElement>) => {
        if (dropMove(event, node) === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
      onDragStart: (event: DragEvent<HTMLLIElement>) => {
        if (!draggable) {
          event.preventDefault();
          return;
        }
        setDraggedNodeId(node.id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", node.id);
      },
      onDrop: (event: DragEvent<HTMLLIElement>) => {
        const move = dropMove(event, node);
        setDraggedNodeId(null);
        if (move === null) return;
        event.preventDefault();
        event.stopPropagation();
        request(move, `Moved ${move.nodeId} near ${node.name}`);
      },
    };
  };
  const handleMoveKey = (
    event: KeyboardEvent<HTMLLIElement>,
    node: WorkbenchNode,
  ): boolean => {
    if (!event.altKey || !movable(node) || onMove === undefined) return false;
    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight"
    ) {
      return false;
    }
    // Recognized move shortcuts are owned by the layer tree even when the
    // requested move is invalid, so macOS/browser navigation never leaks out.
    event.preventDefault();
    const nodeSiblings = siblings(node.parentId);
    const currentIndex = nodeSiblings.findIndex(({ id }) => id === node.id);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const nextIndex = currentIndex + (event.key === "ArrowUp" ? -1 : 1);
      if (nextIndex < 0 || nextIndex >= nodeSiblings.length) return true;
      request(
        { index: nextIndex, nodeId: node.id, parentId: node.parentId },
        `${node.name} moved ${event.key === "ArrowUp" ? "up" : "down"}`,
      );
      return true;
    }
    if (event.key === "ArrowRight") {
      const previous = nodeSiblings[currentIndex - 1];
      if (previous === undefined || !acceptsChildren(previous)) return true;
      request(
        {
          index: siblings(previous.id).length,
          nodeId: node.id,
          parentId: previous.id,
        },
        `${node.name} moved into ${previous.name}`,
      );
      return true;
    }
    if (event.key === "ArrowLeft" && node.parentId !== null) {
      const parent = nodesById.get(node.parentId);
      if (parent === undefined || !movable(parent)) return true;
      const parentSiblings = siblings(parent.parentId);
      request(
        {
          index: parentSiblings.findIndex(({ id }) => id === parent.id) + 1,
          nodeId: node.id,
          parentId: parent.parentId,
        },
        `${node.name} moved out of ${parent.name}`,
      );
      return true;
    }
    return true;
  };
  return { announcement, dragProps, handleMoveKey, movable };
}
