import type {
  CanvasActionV3,
  CanvasActionIntentV3,
  CanvasDocumentV3,
  CanvasOperationV3,
} from "@memi/protocol";

import { hashValue } from "./hash.js";

export interface CreateCanvasDocumentV3Input {
  readonly id: string;
  readonly projectId: string;
  readonly initialPage: {
    readonly id: string;
    readonly kind: "design" | "imported" | "whiteboard" | "library";
    readonly name: string;
  };
}

export interface PrepareCanvasOperationV3Input {
  readonly id: string;
  readonly actor: "human" | "agent" | "system";
  readonly actorId: string;
  readonly occurredAt: string;
  readonly label: string;
  readonly traceId?: string | null;
  readonly action: CanvasActionIntentV3;
}

export interface InvertCanvasOperationV3Input {
  readonly id: string;
  readonly actor: "human" | "agent" | "system";
  readonly actorId: string;
  readonly occurredAt: string;
  readonly label?: string;
  readonly traceId?: string | null;
}

export function immutableCanvasV3<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    immutableCanvasV3(nested);
  }
  return Object.freeze(value);
}

export function sameCanvasV3(left: unknown, right: unknown): boolean {
  return hashValue(left) === hashValue(right);
}

export function semanticCanvasStateV3(document: CanvasDocumentV3): object {
  return {
    schemaVersion: document.schemaVersion,
    id: document.id,
    projectId: document.projectId,
    revision: document.revision,
    operationCursor: document.operationCursor,
    pageIds: document.pageIds,
    pagesById: document.pagesById,
    nodesById: document.nodesById,
    componentsById: document.componentsById,
    variableCollectionsById: document.variableCollectionsById,
    variablesById: document.variablesById,
    assetsById: document.assetsById,
    prototypeConnectionsById: document.prototypeConnectionsById,
    evidenceById: document.evidenceById,
    reconstructionsById: document.reconstructionsById,
  };
}

export function canvasOperationMaterialV3(
  operation: CanvasOperationV3,
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
    traceId: operation.traceId,
    expectedRevision: operation.expectedRevision,
    previousOperationCursor: operation.previousOperationCursor,
    expectedBeforeHash: operation.expectedBeforeHash,
    type: operation.type,
    action: operation.action,
    inverseAction: operation.inverseAction,
  };
}

export function canvasActionTargetsV3(
  action: CanvasActionV3,
): readonly string[] {
  if (action.type === "atomic.batch") {
    return [...new Set(action.payload.actions.flatMap(canvasActionTargetsV3))];
  }
  if (action.type === "node.create") {
    return [action.payload.node.id];
  }
  if (action.type === "node.reorder") {
    return [action.payload.parentId ?? action.payload.pageId];
  }
  if (action.type.startsWith("node.") || action.type === "instance.override") {
    return "nodeId" in action.payload ? [action.payload.nodeId] : [];
  }
  const idKey = Object.keys(action.payload).find((key) => key.endsWith("Id"));
  return idKey === undefined
    ? []
    : [String(action.payload[idKey as keyof typeof action.payload])];
}
