import {
  CanvasActionV3Schema,
  CanvasDocumentV3Schema,
  CanvasOperationV3Schema,
  CanvasSingleActionV3Schema,
  type CanvasActionV3,
  type CanvasDocumentV3,
  type CanvasOperationV3,
} from "@memi/protocol";

import { hashCanvasDocumentValue, hashValue } from "./hash.js";
import {
  applyCanvasV3ActionForInternalProof,
  hashCanvasDocumentV3,
} from "./v3-engine.js";
import {
  canvasActionTargetsV3,
  canvasOperationMaterialV3,
  immutableCanvasV3,
  sameCanvasV3,
  semanticCanvasStateV3,
} from "./v3-support.js";

function exactInverseAction(action: CanvasActionV3): CanvasActionV3 {
  if (action.type === "atomic.batch") {
    return CanvasActionV3Schema.parse({
      type: "atomic.batch",
      payload: {
        actions: [...action.payload.actions].reverse().map(exactInverseAction),
      },
    });
  }
  if (action.type === "node.create") {
    return CanvasActionV3Schema.parse({
      type: "node.delete",
      payload: { nodeId: action.payload.node.id, prior: action.payload },
    });
  }
  if (action.type === "node.delete") {
    return CanvasActionV3Schema.parse({
      type: "node.create",
      payload: action.payload.prior,
    });
  }
  return CanvasSingleActionV3Schema.parse({
    ...action,
    payload: {
      ...action.payload,
      prior: action.payload.next,
      next: action.payload.prior,
    },
  });
}

export function revertCanvasOperationV3(
  untrustedDocument: CanvasDocumentV3,
  untrustedOperation: CanvasOperationV3,
): CanvasDocumentV3 {
  const document = CanvasDocumentV3Schema.parse(untrustedDocument);
  const operation = CanvasOperationV3Schema.parse(untrustedOperation);
  if (
    document.revision === 0 ||
    operation.documentId !== document.id ||
    operation.expectedRevision + 1 !== document.revision ||
    operation.resultingHash !== document.stateHash ||
    operation.id !== document.operationCursor
  ) {
    throw new Error("Canvas V3 reversion requires the exact resulting document.");
  }
  if (hashCanvasDocumentV3(document) !== document.stateHash) {
    throw new Error("Canvas document V3 state hash is corrupt.");
  }
  if (
    hashValue(canvasOperationMaterialV3(operation)) !== operation.actionDigest ||
    !sameCanvasV3(operation.targetIds, canvasActionTargetsV3(operation.action)) ||
    !sameCanvasV3(operation.inverseAction, exactInverseAction(operation.action))
  ) {
    throw new Error("Canvas V3 operation proof is invalid for reversion.");
  }
  const content = applyCanvasV3ActionForInternalProof(
    document,
    operation.inverseAction,
  );
  const candidate = {
    ...content,
    revision: document.revision - 1,
    operationCursor: operation.previousOperationCursor,
    stateHash: document.stateHash,
  };
  const reverted = CanvasDocumentV3Schema.parse({
    ...candidate,
    stateHash: hashCanvasDocumentValue(semanticCanvasStateV3(candidate)),
  });
  if (reverted.stateHash !== operation.expectedBeforeHash) {
    throw new Error("Canvas V3 reversion prior hash proof is invalid.");
  }
  return immutableCanvasV3(reverted);
}
