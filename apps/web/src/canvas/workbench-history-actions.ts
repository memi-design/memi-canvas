import type { Dispatch, SetStateAction } from "react";

import type { CanonicalWorkbenchAuthority } from "./canonical-workbench-authority.js";
import { commandTraceAction } from "./scene-command-adapter.js";
import type { CommandTrace } from "./command-bus.js";
import {
  createSelectionState,
  updateSelection,
  type SelectionState,
  type WorkbenchNode,
} from "./model.js";
import type { CollaborationTraceItem } from "./collaboration.js";
import { diffWorkbenchProjections } from "./canonical-workbench-diff.js";
import type { AuthoringSelectionTransaction } from "./authoring-selection.js";

interface HistoryActionContext {
  readonly authority: CanonicalWorkbenchAuthority;
  readonly nodes: readonly WorkbenchNode[];
  readonly selection: SelectionState;
  readonly selectedNodeIds: readonly string[];
  readonly setCommandTrace: Dispatch<
    SetStateAction<readonly CollaborationTraceItem[]>
  >;
  readonly setPreviewNodes: Dispatch<
    SetStateAction<readonly WorkbenchNode[] | null>
  >;
  readonly setTrace: Dispatch<
    SetStateAction<readonly CollaborationTraceItem[]>
  >;
  readonly commandSequence: { current: number };
  readonly traceSequence: { current: number };
}

export interface WorkbenchHistoryActions {
  readonly appendStructuredCommandTrace: (
    command: CommandTrace,
    eventHarnessId?: string,
  ) => void;
  readonly appendTrace: (
    action: string,
    targetNodeId: string,
    eventHarnessId?: string,
  ) => void;
  readonly commitPreview: (
    label: string,
    before: readonly WorkbenchNode[],
    targetIds: readonly string[],
  ) => void;
  readonly commitSelectionTransaction: (
    transaction: AuthoringSelectionTransaction,
  ) => {
    readonly nodes: readonly WorkbenchNode[];
    readonly revision: number;
  };
  readonly commitScene: (
    label: string,
    nodes: readonly WorkbenchNode[],
    options?: {
      readonly actor?: "human" | "agent" | "system";
      readonly selectedIds?: readonly string[];
      readonly targetIds?: readonly string[];
    },
  ) => {
    readonly nodes: readonly WorkbenchNode[];
    readonly revision: number;
  };
  readonly createRootNode: (
    label: string,
    node: WorkbenchNode,
  ) => {
    readonly nodes: readonly WorkbenchNode[];
    readonly revision: number;
  };
  readonly redoScene: () => void;
  readonly selectNode: (nodeId: string, additive: boolean) => void;
  readonly selectNodeIds: (
    nodeIds: readonly string[],
    action?: string,
  ) => void;
  readonly undoScene: () => void;
}

export function createWorkbenchHistoryActions(
  context: HistoryActionContext,
): WorkbenchHistoryActions {
  const appendTrace = (
    action: string,
    targetNodeId: string,
    eventHarnessId?: string,
  ) => {
    const next: CollaborationTraceItem = {
      id: `workbench-trace-${context.traceSequence.current}`,
      action,
      targetNodeId,
      ...(eventHarnessId === undefined
        ? {}
        : { harnessId: eventHarnessId }),
    };
    context.traceSequence.current += 1;
    context.setTrace((current) => [...current, next]);
  };

  const appendStructuredCommandTrace = (
    command: CommandTrace,
    eventHarnessId?: string,
  ) => {
    const next: CollaborationTraceItem = {
      id: `editor-command-trace-${context.commandSequence.current}`,
      action: commandTraceAction(command),
      targetNodeId: command.targetIds.at(-1) ?? "canvas",
      ...(eventHarnessId === undefined
        ? {}
        : { harnessId: eventHarnessId }),
    };
    context.commandSequence.current += 1;
    context.setCommandTrace((current) => [...current, next]);
  };

  const commitScene: WorkbenchHistoryActions["commitScene"] = (
    label,
    nodes,
    options = {},
  ) => {
    const nextSelection =
      options.selectedIds === undefined
        ? context.selection
        : createSelectionState(options.selectedIds);
    const result = context.authority.commitActions({
      actions: diffWorkbenchProjections(
        context.authority.getSnapshot().nodes,
        nodes,
      ),
      actor: options.actor ?? "human",
      label,
      selection: nextSelection,
      targetIds: options.targetIds ?? context.selectedNodeIds,
    });
    context.setPreviewNodes(null);
    appendStructuredCommandTrace(result.trace);
    return {
      nodes,
      revision: context.authority.getSnapshot().document.revision,
    };
  };

  const commitPreview = (
    label: string,
    before: readonly WorkbenchNode[],
    targetIds: readonly string[],
  ) => {
    const result = context.authority.commitActions({
      actions: diffWorkbenchProjections(
        context.authority.getSnapshot().nodes,
        context.nodes,
      ),
      actor: "human",
      label,
      selection: context.selection,
      targetIds,
    });
    void before;
    context.setPreviewNodes(null);
    appendStructuredCommandTrace(result.trace);
  };

  const commitSelectionTransaction: WorkbenchHistoryActions["commitSelectionTransaction"] = (
    transaction,
  ) => {
    const targetIds = new Set(transaction.targetIds);
    const nextNodes = context.nodes.map((node) =>
      targetIds.has(node.id) ? transaction.update(node) : node,
    );
    return commitScene(transaction.label, nextNodes, {
      targetIds: transaction.targetIds,
    });
  };

  const createRootNode: WorkbenchHistoryActions["createRootNode"] = (
    label,
    node,
  ) => {
    const result = context.authority.createRootNode({
      actor: "human",
      label,
      node,
    });
    context.setPreviewNodes(null);
    appendStructuredCommandTrace(result.trace);
    const snapshot = context.authority.getSnapshot();
    return {
      nodes: snapshot.nodes,
      revision: snapshot.revision,
    };
  };

  const undoScene = () => {
    const result = context.authority.undo();
    if (result === null) {
      return;
    }
    context.setPreviewNodes(null);
    appendStructuredCommandTrace(result.trace);
  };

  const redoScene = () => {
    const result = context.authority.redo();
    if (result === null) {
      return;
    }
    context.setPreviewNodes(null);
    appendStructuredCommandTrace(result.trace);
  };

  const selectNodeIds = (
    nodeIds: readonly string[],
    action?: string,
  ) => {
    const ordered = nodeIds.filter(
      (id, index) => nodeIds.indexOf(id) === index,
    );
    context.authority.setSelection(createSelectionState(ordered));
    const anchor = ordered.at(-1) ?? null;
    if (action !== undefined) {
      appendTrace(action, anchor ?? "canvas");
    }
  };

  const selectNode = (nodeId: string, additive: boolean) => {
    const nextSelection = updateSelection(
      context.selection,
      nodeId,
      additive ? "toggle" : "replace",
    );
    selectNodeIds(nextSelection.selectedIds);
  };

  return {
    appendStructuredCommandTrace,
    appendTrace,
    createRootNode,
    commitPreview,
    commitScene,
    commitSelectionTransaction,
    redoScene,
    selectNode,
    selectNodeIds,
    undoScene,
  };
}
