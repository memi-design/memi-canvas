import type { CanvasActionIntentV3, CanvasOperationV3 } from "@memi/protocol";

import type { CanonicalWorkbenchAuthorityV3 } from "./canonical-workbench-authority-v3.js";
import {
  createSelectionState,
  updateSelection,
  type SelectionState,
} from "./model.js";

/**
 * Operation-native history boundary for the V3 production workbench.
 *
 * This module intentionally has no dependency on the legacy workbench
 * authority, legacy scene projection, or scene-command adapter. The renderer
 * submits semantic V3 actions and the canonical authority owns history.
 */
export interface V3WorkbenchHistoryActionContext {
  readonly actorId: string;
  readonly authority: CanonicalWorkbenchAuthorityV3;
  readonly createOperationId: () => string;
  readonly now: () => string;
}

export interface V3SemanticWorkbenchAction {
  readonly action: CanvasActionIntentV3;
  readonly actor?: "agent" | "human" | "system";
  readonly label: string;
  readonly selectionAfter?: SelectionState;
  readonly traceId?: string | null;
}

export interface V3WorkbenchHistoryActions {
  readonly commitSemanticAction: (
    input: V3SemanticWorkbenchAction,
  ) => Promise<CanvasOperationV3>;
  readonly redoScene: () => Promise<CanvasOperationV3 | null>;
  readonly selectNode: (nodeId: string, additive: boolean) => void;
  readonly selectNodeIds: (nodeIds: readonly string[]) => void;
  readonly undoScene: () => Promise<CanvasOperationV3 | null>;
}

export function createV3WorkbenchHistoryActions(
  context: V3WorkbenchHistoryActionContext,
): V3WorkbenchHistoryActions {
  const historyInput = (actor: "agent" | "human" | "system") => ({
    actor,
    actorId: context.actorId,
    id: context.createOperationId(),
    occurredAt: context.now(),
  });

  const commitSemanticAction: V3WorkbenchHistoryActions["commitSemanticAction"] = (
    input,
  ) =>
    context.authority.commit(
      {
        ...historyInput(input.actor ?? "human"),
        action: input.action,
        label: input.label,
        ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
      },
      input.selectionAfter,
    );

  const undoScene = (): Promise<CanvasOperationV3 | null> =>
    context.authority.getSnapshot().canUndo
      ? context.authority.undo(historyInput("human"))
      : Promise.resolve(null);

  const redoScene = (): Promise<CanvasOperationV3 | null> =>
    context.authority.getSnapshot().canRedo
      ? context.authority.redo(historyInput("human"))
      : Promise.resolve(null);

  const selectNodeIds = (nodeIds: readonly string[]) => {
    const ordered = nodeIds.filter(
      (id, index) => nodeIds.indexOf(id) === index,
    );
    context.authority.setSelection(createSelectionState(ordered));
  };

  const selectNode = (nodeId: string, additive: boolean) => {
    context.authority.setSelection(
      updateSelection(
        context.authority.getSnapshot().selection,
        nodeId,
        additive ? "toggle" : "replace",
      ),
    );
  };

  return {
    commitSemanticAction,
    redoScene,
    selectNode,
    selectNodeIds,
    undoScene,
  };
}
