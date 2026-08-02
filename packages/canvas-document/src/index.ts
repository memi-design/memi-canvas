import {
  CanvasDocumentSchema,
  CanvasNodeSchema,
  CanvasOperationSchema,
  type CanvasDocument,
  type CanvasNode,
  type CanvasOperation,
} from "@memi/protocol";

import { hashValue } from "./hash.js";
import type {
  CanvasMaterialization,
  CreateCanvasDocumentInput,
  PrepareNodeCreateInput,
  ScreenMatrixInput,
} from "./types.js";

export type {
  CanvasDocument,
  CanvasMaterialization,
  CanvasNode,
  CanvasOperation,
  CoverageHealth,
  CreateCanvasDocumentInput,
  EvidenceLevel,
  PrepareNodeCreateInput,
  ScreenMatrixCell,
  ScreenMatrixInput,
} from "./types.js";

function semanticState(document: CanvasDocument): object {
  return {
    schemaVersion: document.schemaVersion,
    id: document.id,
    projectId: document.projectId,
    revision: document.revision,
    operationCursor: document.operationCursor,
    nodes: document.nodes,
  };
}

function operationAction(operation: CanvasOperation): object {
  return {
    schemaVersion: operation.schemaVersion,
    id: operation.id,
    documentId: operation.documentId,
    actorId: operation.actorId,
    occurredAt: operation.occurredAt,
    type: operation.type,
    payload: operation.payload,
    expectedBeforeHash: operation.expectedBeforeHash,
  };
}

function nextSemanticDocument(
  document: CanvasDocument,
  operation: CanvasOperation,
): CanvasDocument {
  let nodes: CanvasNode[];

  if (operation.type === "node.create") {
    if (document.nodes.some((node) => node.id === operation.payload.node.id)) {
      throw new Error(`Canvas node already exists: ${operation.payload.node.id}`);
    }
    nodes = [...document.nodes, structuredClone(operation.payload.node)];
  } else if (operation.type === "node.move") {
    const current = document.nodes.find(
      (node) => node.id === operation.payload.nodeId,
    );
    if (current === undefined) {
      throw new Error(`Canvas node does not exist: ${operation.payload.nodeId}`);
    }
    if (
      current.position.x !== operation.payload.from.x ||
      current.position.y !== operation.payload.from.y
    ) {
      throw new Error(`Canvas node move has stale prior coordinates.`);
    }
    nodes = document.nodes.map((node) =>
      node.id === operation.payload.nodeId
        ? { ...node, position: structuredClone(operation.payload.to) }
        : node,
    );
  } else {
    const current = document.nodes.find(
      (node) => node.id === operation.payload.nodeId,
    );
    if (current === undefined) {
      throw new Error(`Canvas node does not exist: ${operation.payload.nodeId}`);
    }
    if (hashValue(current) !== operation.payload.deletedNodeHash) {
      throw new Error(`Canvas node delete has a stale node hash.`);
    }
    nodes = document.nodes.filter(
      (node) => node.id !== operation.payload.nodeId,
    );
  }

  const candidate = {
    ...document,
    revision: document.revision + 1,
    operationCursor: operation.id,
    nodes,
    stateHash: document.stateHash,
  };

  return {
    ...candidate,
    stateHash: hashValue(semanticState(candidate)),
  };
}

export function createCanvasDocument(
  input: CreateCanvasDocumentInput,
): CanvasDocument {
  const candidate = {
    schemaVersion: 1 as const,
    id: input.id,
    projectId: input.projectId,
    revision: 0,
    stateHash: `sha256:${"0".repeat(64)}`,
    operationCursor: null,
    nodes: [],
    appliedOperations: [],
  };
  const parsed = CanvasDocumentSchema.parse(candidate);

  return CanvasDocumentSchema.parse({
    ...parsed,
    stateHash: hashValue(semanticState(parsed)),
  });
}

export function hashCanvasDocument(document: CanvasDocument): string {
  return hashValue(semanticState(document));
}

export function prepareNodeCreateOperation(
  document: CanvasDocument,
  input: PrepareNodeCreateInput,
): CanvasOperation {
  const node = CanvasNodeSchema.parse(input.node);
  const base = {
    schemaVersion: 1 as const,
    id: input.id,
    documentId: document.id,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    type: "node.create" as const,
    payload: { node },
    expectedBeforeHash: document.stateHash,
  };
  const actionDigest = hashValue(base);
  const provisional = CanvasOperationSchema.parse({
    ...base,
    actionDigest,
    resultingHash: document.stateHash,
  });
  const resulting = nextSemanticDocument(document, provisional);

  return CanvasOperationSchema.parse({
    ...base,
    actionDigest,
    resultingHash: resulting.stateHash,
  });
}

export function applyCanvasOperation(
  untrustedDocument: CanvasDocument,
  untrustedOperation: CanvasOperation,
): CanvasDocument {
  const document = CanvasDocumentSchema.parse(untrustedDocument);
  const operation = CanvasOperationSchema.parse(untrustedOperation);
  const existing = document.appliedOperations.find(
    (receipt) => receipt.id === operation.id,
  );

  if (existing !== undefined) {
    if (
      existing.actionDigest !== operation.actionDigest ||
      existing.resultingHash !== operation.resultingHash
    ) {
      throw new Error(
        `Canvas operation idempotency digest or resulting hash mismatch for ${operation.id}.`,
      );
    }
    return document;
  }

  if (operation.documentId !== document.id) {
    throw new Error(`Canvas operation targets a different document.`);
  }
  if (hashCanvasDocument(document) !== document.stateHash) {
    throw new Error(`Canvas document state hash is corrupt.`);
  }
  if (operation.expectedBeforeHash !== document.stateHash) {
    throw new Error(`Stale canvas operation expected-before hash.`);
  }
  if (hashValue(operationAction(operation)) !== operation.actionDigest) {
    throw new Error(`Canvas operation action digest is invalid.`);
  }

  const next = nextSemanticDocument(document, operation);
  if (next.stateHash !== operation.resultingHash) {
    throw new Error(`Canvas operation resulting hash is invalid.`);
  }

  return CanvasDocumentSchema.parse({
    ...next,
    appliedOperations: [
      ...document.appliedOperations,
      {
        id: operation.id,
        actionDigest: operation.actionDigest,
        resultingHash: operation.resultingHash,
      },
    ],
  });
}

export function compileScreenMatrixOperations(
  document: CanvasDocument,
  input: ScreenMatrixInput,
): CanvasOperation[] {
  const columnX = {
    desktop: 0,
    tablet: 1540,
    mobile: 2474,
  } as const;
  const operations: CanvasOperation[] = [];
  let current = document;

  for (const [index, cell] of input.cells.entries()) {
    const operation = prepareNodeCreateOperation(current, {
      id: cell.operationId,
      actorId: input.actorId,
      occurredAt: input.occurredAt,
      node: {
        id: cell.nodeId,
        kind: "code-frame",
        authority: "product-source",
        evidenceLevel: cell.evidenceLevel,
        coverageHealth: cell.coverageHealth,
        parentId: null,
        position: {
          x: columnX[cell.viewport.name],
          y: Math.floor(index / 3) * 1240,
        },
        size: {
          width: cell.viewport.width,
          height: cell.viewport.height,
        },
        viewport: cell.viewport,
        source: {
          routeId: cell.routeId,
          stateId: cell.stateId,
          coverageCellId: cell.coverageCellId,
        },
      },
    });
    operations.push(operation);
    current = applyCanvasOperation(current, operation);
  }

  return operations;
}

export function materializeScreenMatrix(
  document: CanvasDocument,
  input: ScreenMatrixInput,
): CanvasMaterialization {
  const operations = compileScreenMatrixOperations(document, input);
  const materialized = operations.reduce(applyCanvasOperation, document);
  return { document: materialized, operations };
}

export * from "./v2.js";
export * from "./v3.js";
