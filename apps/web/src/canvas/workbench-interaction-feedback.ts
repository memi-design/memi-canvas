import { canvasPointFromViewport } from "./canvas-camera.js";
import type { PointerGesture } from "./CanvasWorkbench.types.js";
import {
  workbenchHierarchyStates,
  type Point,
  type WorkbenchNode,
} from "./model.js";
import { descendantNodeIds } from "./workbench-document-actions.js";

export interface WorkbenchInteractionFeedback {
  readonly dropTargetId: string | null;
  readonly movingNodeIds: readonly string[];
}

const EMPTY_FEEDBACK: WorkbenchInteractionFeedback = Object.freeze({
  dropTargetId: null,
  movingNodeIds: Object.freeze([]),
});

const DROP_CONTAINER_KINDS = new Set<WorkbenchNode["kind"]>([
  "DraftFrame",
  "Frame",
  "Section",
]);

function containsPoint(node: WorkbenchNode, point: Point): boolean {
  return (
    point.x >= node.position.x &&
    point.x <= node.position.x + node.size.width &&
    point.y >= node.position.y &&
    point.y <= node.position.y + node.size.height
  );
}

/**
 * Projects transient manipulation feedback without changing document state.
 * Drop targets are only editable, unlocked canvas containers outside the
 * moving hierarchy; source-linked runtime evidence can never become a target.
 */
export function workbenchInteractionFeedback({
  gesture,
  nodes,
  pointer,
}: {
  readonly gesture: PointerGesture | null;
  readonly nodes: readonly WorkbenchNode[];
  readonly pointer: Point | null;
}): WorkbenchInteractionFeedback {
  if (gesture?.type !== "move" || pointer === null) {
    return EMPTY_FEEDBACK;
  }

  const movingNodeIds = descendantNodeIds(
    gesture.initialNodes,
    gesture.nodeIds,
  );
  if (gesture.duplicated) {
    return Object.freeze({
      dropTargetId: null,
      movingNodeIds: Object.freeze([...movingNodeIds]),
    });
  }
  const movingIds = new Set(movingNodeIds);
  const hierarchyStates = workbenchHierarchyStates(nodes);
  const canvasPoint = canvasPointFromViewport(gesture.camera, pointer);
  const candidates = nodes
    .filter((node) => {
      const state = hierarchyStates.get(node.id);
      return (
        DROP_CONTAINER_KINDS.has(node.kind) &&
        !movingIds.has(node.id) &&
        state?.hidden === false &&
        state.locked === false &&
        state.sourceLinked === false &&
        containsPoint(node, canvasPoint)
      );
    })
    .sort(
      (left, right) =>
        left.size.width * left.size.height -
          right.size.width * right.size.height ||
        left.id.localeCompare(right.id),
    );

  return Object.freeze({
    dropTargetId: candidates[0]?.id ?? null,
    movingNodeIds: Object.freeze([...movingNodeIds]),
  });
}
