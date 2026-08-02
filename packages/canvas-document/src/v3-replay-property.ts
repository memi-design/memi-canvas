import {
  CanvasNodeV3Schema,
  type CanvasActionIntentV3,
  type CanvasDocumentV3,
  type CanvasNodeV3,
  type CanvasOperationV3,
  type CanvasSingleActionIntentV3,
} from "@memi/protocol";

import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "./v3-engine.js";
import { revertCanvasOperationV3 } from "./v3-reversion.js";

const ids = {
  project: "prj_01J00000000000000000000000",
  document: "doc_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
  left: "nod_01J00000000000000000000000",
  right: "nod_01J00000000000000000000001",
} as const;

export interface CanvasV3ReplayFixture {
  readonly initial: CanvasDocumentV3;
  readonly operations: readonly CanvasOperationV3[];
  readonly expectedFinalHash: string;
  readonly atomicBatchCount: number;
}

export interface CanvasV3ReplayPropertyResult {
  readonly operationCount: number;
  readonly atomicBatchCount: number;
  readonly replayedHash: string;
  readonly restoredHash: string;
}

function operationId(index: number): string {
  return `opn_${String(index).padStart(26, "0")}`;
}

function node(id: string, x: number): CanvasNodeV3 {
  return CanvasNodeV3Schema.parse({
    id,
    pageId: ids.page,
    kind: "rectangle",
    name: id === ids.left ? "Replay left" : "Replay right",
    parentId: null,
    childIds: [],
    transform: { x, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    geometry: { width: 320, height: 180 },
    style: {
      opacity: 1,
      visible: true,
      locked: false,
      fills: [],
      strokes: [],
      cornerRadii: [12, 12, 12, 12],
    },
    layout: {
      mode: "none",
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      alignPrimary: "start",
      alignCounter: "start",
      wrap: false,
      sizingHorizontal: "fixed",
      sizingVertical: "fixed",
    },
    text: null,
    content: null,
    componentId: null,
    instanceOverrides: {},
    componentBinding: null,
    provenance: null,
    referenceBinding: null,
    sourceAnchor: null,
    sourceBinding: null,
  });
}

function transformAction(
  document: CanvasDocumentV3,
  nodeId: typeof ids.left | typeof ids.right,
  delta: number,
): CanvasSingleActionIntentV3 {
  const current = document.nodesById[nodeId]!;
  return {
    type: "node.transform",
    payload: {
      nodeId,
      next: { ...current.transform, x: current.transform.x + delta },
    },
  };
}

function geometryAction(
  document: CanvasDocumentV3,
  nodeId: typeof ids.left | typeof ids.right,
): CanvasSingleActionIntentV3 {
  const current = document.nodesById[nodeId]!;
  return {
    type: "node.geometry",
    payload: {
      nodeId,
      next: { ...current.geometry, width: current.geometry.width + 1 },
    },
  };
}

function actionFor(
  document: CanvasDocumentV3,
  index: number,
): CanvasActionIntentV3 {
  if (index % 6 === 0) {
    return transformAction(document, ids.left, 1);
  }
  if (index % 6 === 1) {
    return geometryAction(document, ids.right);
  }
  if (index % 6 === 2) {
    const current = document.nodesById[ids.left]!;
    return {
      type: "node.style",
      payload: {
        nodeId: ids.left,
        next: {
          ...current.style,
          opacity: current.style.opacity === 1 ? 0.9 : 1,
        },
      },
    };
  }
  if (index % 6 === 3) {
    return {
      type: "atomic.batch",
      payload: {
        actions: [
          transformAction(document, ids.left, 2),
          geometryAction(document, ids.right),
        ],
      },
    };
  }
  if (index % 6 === 4) {
    return {
      type: "node.reorder",
      payload: {
        pageId: ids.page,
        parentId: null,
        nextOrder: [...document.pagesById[ids.page]!.rootIds].reverse(),
      },
    };
  }
  return {
    type: "atomic.batch",
    payload: {
      actions: [
        transformAction(document, ids.left, 1),
        transformAction(document, ids.right, -1),
      ],
    },
  };
}

function appendOperation(
  document: CanvasDocumentV3,
  operations: CanvasOperationV3[],
  action: CanvasActionIntentV3,
): CanvasDocumentV3 {
  const operation = prepareCanvasOperationV3(document, {
    id: operationId(operations.length),
    actor: "system",
    actorId: "v3-replay-property",
    occurredAt: "2026-08-02T12:00:00.000Z",
    label: `Deterministic replay operation ${operations.length}`,
    action,
  });
  operations.push(operation);
  return applyCanvasOperationV3(document, operation);
}

export function createDeterministicCanvasV3ReplayFixture(
  operationCount: number,
): CanvasV3ReplayFixture {
  if (!Number.isSafeInteger(operationCount) || operationCount < 2) {
    throw new Error("Canvas V3 replay operation count must be an integer of at least two.");
  }
  const initial = createCanvasDocumentV3({
    id: ids.document,
    projectId: ids.project,
    initialPage: { id: ids.page, kind: "design", name: "Replay property" },
  });
  const operations: CanvasOperationV3[] = [];
  let document = appendOperation(initial, operations, {
    type: "node.create",
    payload: { node: node(ids.left, 0), parentId: null, index: 0 },
  });
  document = appendOperation(document, operations, {
    type: "node.create",
    payload: { node: node(ids.right, 400), parentId: null, index: 1 },
  });
  while (operations.length < operationCount) {
    document = appendOperation(
      document,
      operations,
      actionFor(document, operations.length),
    );
  }
  return {
    initial,
    operations,
    expectedFinalHash: document.stateHash,
    atomicBatchCount: operations.filter(
      (operation) => operation.action.type === "atomic.batch",
    ).length,
  };
}

export function findFirstFailingCanvasV3ReplayIndex(
  initial: CanvasDocumentV3,
  operations: readonly CanvasOperationV3[],
): number | null {
  let document = initial;
  for (const [index, operation] of operations.entries()) {
    try {
      document = applyCanvasOperationV3(document, operation);
    } catch {
      return index;
    }
  }
  return null;
}

export function replayCanvasV3Operations(
  initial: CanvasDocumentV3,
  operations: readonly CanvasOperationV3[],
): CanvasDocumentV3 {
  let document = initial;
  for (const [index, operation] of operations.entries()) {
    try {
      document = applyCanvasOperationV3(document, operation);
    } catch (error) {
      const firstFailingOperation = findFirstFailingCanvasV3ReplayIndex(
        initial,
        operations,
      );
      throw new Error(
        `Canvas V3 replay failed at operation=${index}; firstFailingOperation=${firstFailingOperation}; operationId=${operation.id}; reason=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return document;
}

export function verifyCanvasV3ReplayFixture(
  fixture: CanvasV3ReplayFixture,
): CanvasV3ReplayPropertyResult {
  const replayed = replayCanvasV3Operations(fixture.initial, fixture.operations);
  if (replayed.stateHash !== fixture.expectedFinalHash) {
    throw new Error(
      `Canvas V3 replay hash mismatch; expected=${fixture.expectedFinalHash}; actual=${replayed.stateHash}`,
    );
  }
  let restored = replayed;
  for (let index = fixture.operations.length - 1; index >= 0; index -= 1) {
    const operation = fixture.operations[index]!;
    restored = revertCanvasOperationV3(restored, operation);
  }
  return {
    operationCount: fixture.operations.length,
    atomicBatchCount: fixture.atomicBatchCount,
    replayedHash: replayed.stateHash,
    restoredHash: restored.stateHash,
  };
}
