import {
  CanvasActionV2Schema,
  type CanvasActionV2,
  type CanvasDocumentV2,
  type CanvasOperationV2,
} from "@memi/protocol";

import { hashValue } from "./hash.js";

type OperationAction =
  | CanvasActionV2
  | {
      readonly type: "atomic.batch";
      readonly payload: { readonly actions: readonly CanvasActionV2[] };
    };

export function semanticCanvasStateV2(
  document: CanvasDocumentV2,
): object {
  return {
    schemaVersion: document.schemaVersion,
    id: document.id,
    projectId: document.projectId,
    revision: document.revision,
    operationCursor: document.operationCursor,
    rootIds: document.rootIds,
    nodesById: document.nodesById,
    componentsById: document.componentsById,
    tokensById: document.tokensById,
  };
}

export function immutableCanvasV2<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    immutableCanvasV2(nested);
  }
  return Object.freeze(value);
}

export function operationActionMaterialV2(
  operation: CanvasOperationV2,
): object {
  return {
    schemaVersion: operation.schemaVersion,
    id: operation.id,
    documentId: operation.documentId,
    actor: operation.actor,
    actorId: operation.actorId,
    occurredAt: operation.occurredAt,
    label: operation.label,
    targetIds: operation.targetIds,
    undoOf: operation.undoOf,
    previousOperationCursor: operation.previousOperationCursor,
    type: operation.type,
    payload: operation.payload,
    expectedBeforeHash: operation.expectedBeforeHash,
  };
}

export function operationLabelV2(
  type: CanvasOperationV2["type"],
): string {
  const labels: Record<CanvasOperationV2["type"], string> = {
    "node.create": "Create node",
    "node.delete": "Delete node",
    "node.transform": "Transform node",
    "node.geometry": "Change geometry",
    "node.style": "Change style",
    "node.text": "Edit text",
    "node.layout": "Change layout",
    "node.reparent": "Reparent node",
    "node.reorder": "Reorder layers",
    "component.define": "Define component",
    "instance.override": "Override instance",
    "node.identity": "Change node identity",
    "node.content": "Change node content",
    "node.provenance": "Change node provenance",
    "node.component": "Change component metadata",
    "node.detach": "Detach node",
    "atomic.batch": "Apply atomic batch",
  };
  return labels[type];
}

function actionTargets(action: CanvasActionV2): readonly string[] {
  if (action.type === "node.create") {
    return [action.payload.node.id];
  }
  if (action.type === "component.define") {
    return [action.payload.componentId];
  }
  if (action.type === "node.reorder") {
    return action.payload.parentId === null ? [] : [action.payload.parentId];
  }
  return [action.payload.nodeId];
}

export function operationTargetsV2(
  action: OperationAction,
): readonly string[] {
  const targets =
    action.type === "atomic.batch"
      ? action.payload.actions.flatMap(actionTargets)
      : actionTargets(action);
  return [...new Set(targets)];
}

function operationAsAction(operation: CanvasOperationV2): OperationAction {
  return operation.type === "atomic.batch"
    ? { type: operation.type, payload: operation.payload }
    : CanvasActionV2Schema.parse({
        type: operation.type,
        payload: operation.payload,
      });
}

export function assertDerivedOperationMetadataV2(
  document: CanvasDocumentV2,
  operation: CanvasOperationV2,
): void {
  const action = operationAsAction(operation);
  if (operation.label !== operationLabelV2(operation.type)) {
    throw new Error(`Canvas V2 operation label metadata is invalid.`);
  }
  if (
    hashValue(operation.targetIds) !==
    hashValue(operationTargetsV2(action))
  ) {
    throw new Error(`Canvas V2 operation target metadata is invalid.`);
  }
  if (
    operation.undoOf !== null &&
    operation.undoOf !== document.operationCursor
  ) {
    throw new Error(`Canvas V2 operation undo metadata is invalid.`);
  }
}
