import type { Point, WorkbenchNode } from "./model.js";
import type { PointerGesture } from "./CanvasWorkbench.types.js";
import { descendantNodeIds } from "./workbench-document-actions.js";
import { workbenchInteractionFeedback } from "./workbench-interaction-feedback.js";
import type { WorkbenchIntentReceiptV3 } from "./workbench-v3-intents.js";

type MoveGesture = Extract<PointerGesture, { readonly type: "move" }>;

export interface WorkbenchMoveCommit {
  readonly label: string;
  readonly receipt: WorkbenchIntentReceiptV3;
  readonly selectedIds?: readonly string[];
  readonly targetIds: readonly string[];
  readonly traceLabel: string;
}

/**
 * Turns the visible drop affordance into the exact semantic receipt committed
 * on pointer-up. Projection coordinates remain absolute during a gesture and
 * are localized only at this durable boundary.
 */
export function prepareWorkbenchMoveCommit({
  gesture,
  nodes,
  pointer,
}: {
  readonly gesture: MoveGesture;
  readonly nodes: readonly WorkbenchNode[];
  readonly pointer: Point;
}): WorkbenchMoveCommit {
  const feedback = workbenchInteractionFeedback({ gesture, nodes, pointer });
  const dropTarget = nodes.find(({ id }) => id === feedback.dropTargetId);
  const targetIds = gesture.duplicated
    ? descendantNodeIds(nodes, gesture.nodeIds)
    : gesture.nodeIds;
  const rootIds = new Set(gesture.nodeIds);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const durableNodes = nodes
    .filter(({ id }) => targetIds.includes(id))
    .map((node) => {
      const parentId =
        dropTarget !== undefined && rootIds.has(node.id)
          ? dropTarget.id
          : node.parentId;
      const parent = parentId === null ? undefined : nodesById.get(parentId);
      return {
        ...node,
        parentId,
        position:
          gesture.duplicated || parent === undefined
            ? node.position
            : {
                x: node.position.x - parent.position.x,
                y: node.position.y - parent.position.y,
              },
      };
    });
  const destination =
    dropTarget === undefined ? "" : ` into ${dropTarget.name}`;
  const action = gesture.duplicated ? "Duplicate and move" : "Move";
  const label = `${action} ${gesture.nodeName}${destination}`;
  const receipt: WorkbenchIntentReceiptV3 = gesture.duplicated
    ? { kind: "paste", nodes: durableNodes }
    : dropTarget === undefined
      ? { kind: "move", nodes: durableNodes }
      : { kind: "reparent", nodes: durableNodes };

  return Object.freeze({
    label,
    receipt,
    ...(gesture.duplicated ? { selectedIds: gesture.nodeIds } : {}),
    targetIds,
    traceLabel: `${gesture.duplicated ? "Duplicated and moved" : "Moved"} ${gesture.nodeName}${destination}`,
  });
}
