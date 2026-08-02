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
  importedPage: "pag_01J00000000000000000000001",
  left: "nod_01J00000000000000000000000",
  right: "nod_01J00000000000000000000001",
  container: "nod_01J00000000000000000000002",
  text: "nod_01J00000000000000000000003",
  component: "nod_01J00000000000000000000004",
  instance: "nod_01J00000000000000000000005",
  disposable: "nod_01J00000000000000000000006",
  importedRoot: "nod_01J00000000000000000000007",
  componentId: "cmp_01J00000000000000000000000",
  asset: "ast_01J00000000000000000000000",
  prototype: "ptc_01J00000000000000000000000",
  evidence: "evd_01J00000000000000000000000",
  reconstruction: "rec_01J00000000000000000000000",
  artifact: "art_01J00000000000000000000000",
  hierarchyArtifact: "art_01J00000000000000000000001",
  geometryArtifact: "art_01J00000000000000000000002",
  diffArtifact: "art_01J00000000000000000000003",
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

function node(
  id: string,
  x: number,
  options: {
    readonly kind?: CanvasNodeV3["kind"];
    readonly pageId?: string;
    readonly text?: CanvasNodeV3["text"];
    readonly componentId?: string | null;
  } = {},
): CanvasNodeV3 {
  const kind = options.kind ?? "rectangle";
  return CanvasNodeV3Schema.parse({
    id,
    pageId: options.pageId ?? ids.page,
    kind,
    name: `Replay ${kind} ${id.slice(-2)}`,
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
    text: options.text ?? (kind === "text"
      ? { characters: "Replay text", autoResize: "height" }
      : null),
    content: null,
    componentId: options.componentId ?? null,
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
  const phase = index % 13;
  if (phase === 0) {
    return transformAction(document, ids.left, 1);
  }
  if (phase === 1) {
    return geometryAction(document, ids.right);
  }
  if (phase === 2) {
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
  if (phase === 3) {
    const current = document.nodesById[ids.right]!;
    return {
      type: "node.name",
      payload: {
        nodeId: ids.right,
        next: current.name === "Replay right" ? "Replay right renamed" : "Replay right",
      },
    };
  }
  if (phase === 4) {
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
  if (phase === 5) {
    return {
      type: "node.reorder",
      payload: {
        pageId: ids.page,
        parentId: null,
        nextOrder: [...document.pagesById[ids.page]!.rootIds].reverse(),
      },
    };
  }
  if (phase === 6) {
    const current = document.nodesById[ids.text]!;
    return {
      type: "node.text",
      payload: {
        nodeId: ids.text,
        next: {
          ...current.text!,
          characters: current.text!.characters === "Replay text"
            ? "Replay text updated"
            : "Replay text",
        },
      },
    };
  }
  if (phase === 7) {
    const current = document.nodesById[ids.container]!;
    return {
      type: "node.layout",
      payload: {
        nodeId: ids.container,
        next: {
          ...current.layout,
          mode: current.layout.mode === "horizontal" ? "vertical" : "horizontal",
          gap: current.layout.gap === 8 ? 12 : 8,
        },
      },
    };
  }
  if (phase === 8) {
    const right = document.nodesById[ids.right]!;
    return {
      type: "node.reparent",
      payload: {
        nodeId: ids.right,
        nextPageId: ids.page,
        nextParentId: right.parentId === ids.container ? null : ids.container,
        nextIndex: 0,
      },
    };
  }
  if (phase === 9) {
    const current = document.nodesById[ids.instance]!;
    return {
      type: "instance.override",
      payload: {
        nodeId: ids.instance,
        key: "label",
        next: current.instanceOverrides.label === "Replay override"
          ? null
          : "Replay override",
      },
    };
  }
  if (phase === 10) {
    const disposable = document.nodesById[ids.disposable];
    return disposable === undefined
      ? {
          type: "node.create",
          payload: {
            node: node(ids.disposable, 800),
            parentId: null,
            index: document.pagesById[ids.page]!.rootIds.length,
          },
        }
      : { type: "node.delete", payload: { nodeId: disposable.id } };
  }
  if (phase === 11) {
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
  return {
    type: "node.reorder",
    payload: {
      pageId: ids.page,
      parentId: null,
      nextOrder: [...document.pagesById[ids.page]!.rootIds].reverse(),
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
  if (!Number.isSafeInteger(operationCount) || operationCount < 16) {
    throw new Error("Canvas V3 replay operation count must be an integer of at least sixteen.");
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
  document = appendOperation(document, operations, {
    type: "node.create",
    payload: {
      node: node(ids.container, 200, { kind: "frame" }),
      parentId: null,
      index: 2,
    },
  });
  document = appendOperation(document, operations, {
    type: "node.create",
    payload: {
      node: node(ids.text, 600, {
        kind: "text",
        text: { characters: "Replay text", autoResize: "height" },
      }),
      parentId: null,
      index: 3,
    },
  });
  document = appendOperation(document, operations, {
    type: "node.create",
    payload: {
      node: node(ids.component, 0, { kind: "component" }),
      parentId: null,
      index: 4,
    },
  });
  document = appendOperation(document, operations, {
    type: "component.define",
    payload: {
      componentId: ids.componentId,
      next: {
        id: ids.componentId,
        name: "Replay component",
        rootNodeId: ids.component,
        propertyDefinitions: {
          label: { type: "text", defaultValue: "Replay" },
        },
        variantAxes: { state: ["default", "active"] },
      },
    },
  });
  document = appendOperation(document, operations, {
    type: "node.create",
    payload: {
      node: node(ids.instance, 200, {
        kind: "instance",
        componentId: ids.componentId,
      }),
      parentId: null,
      index: 5,
    },
  });
  document = appendOperation(document, operations, {
    type: "node.create",
    payload: { node: node(ids.disposable, 800), parentId: null, index: 6 },
  });
  document = appendOperation(document, operations, {
    type: "variable-collection.define",
    payload: {
      collectionId: "replay-collection",
      next: {
        id: "replay-collection",
        name: "Replay collection",
        modeIds: ["default"],
        defaultModeId: "default",
      },
    },
  });
  document = appendOperation(document, operations, {
    type: "variable.define",
    payload: {
      variableId: "replay-spacing",
      next: {
        id: "replay-spacing",
        collectionId: "replay-collection",
        name: "Replay spacing",
        type: "number",
        valuesByMode: { default: 8 },
      },
    },
  });
  document = appendOperation(document, operations, {
    type: "asset.define",
    payload: {
      assetId: ids.asset,
      next: {
        id: ids.asset,
        name: "Replay asset",
        kind: "image",
        artifactId: ids.artifact,
        contentHash: `sha256:${"a".repeat(64)}`,
        mimeType: "image/png",
        width: 1,
        height: 1,
      },
    },
  });
  document = appendOperation(document, operations, {
    type: "prototype.define",
    payload: {
      connectionId: ids.prototype,
      next: {
        id: ids.prototype,
        sourceNodeId: ids.left,
        trigger: "click",
        action: "navigate",
        destinationNodeId: ids.right,
        url: null,
        transition: "instant",
        durationMs: 0,
      },
    },
  });
  document = appendOperation(document, operations, {
    type: "page.define",
    payload: {
      pageId: ids.importedPage,
      next: { id: ids.importedPage, kind: "imported", name: "Replay imported", rootIds: [] },
    },
  });
  document = appendOperation(document, operations, {
    type: "node.create",
    payload: {
      node: node(ids.importedRoot, 0, {
        kind: "frame",
        pageId: ids.importedPage,
      }),
      parentId: null,
      index: 0,
    },
  });
  document = appendOperation(document, operations, {
    type: "evidence.define",
    payload: {
      evidenceId: ids.evidence,
      next: {
        schemaVersion: 1,
        id: ids.evidence,
        applicationId: "replay-app",
        scenarioId: "replay-scenario",
        route: "/replay",
        state: "default",
        sourceRevision: "replay-revision",
        fixtureFingerprint: `sha256:${"b".repeat(64)}`,
        screenshotArtifactId: ids.artifact,
        hierarchyArtifactId: ids.hierarchyArtifact,
        geometryArtifactId: ids.geometryArtifact,
        reconstructionArtifactId: ids.diffArtifact,
        capturedAt: "2026-08-02T12:00:00.000Z",
        viewport: {
          name: "Replay phone",
          logicalWidth: 1,
          logicalHeight: 1,
          pixelWidth: 1,
          pixelHeight: 1,
          scale: 1,
        },
        verification: {
          status: "verified",
          stableFrameHashes: [`sha256:${"c".repeat(64)}`, `sha256:${"c".repeat(64)}`],
          rejectionReasons: [],
        },
      },
    },
  });
  document = appendOperation(document, operations, {
    type: "reconstruction.define",
    payload: {
      reconstructionId: ids.reconstruction,
      next: {
        schemaVersion: 1,
        id: ids.reconstruction,
        pageId: ids.importedPage,
        evidenceId: ids.evidence,
        editableRootIds: [ids.importedRoot],
        confidenceByNodeId: {
          [ids.importedRoot]: { score: 1, basis: ["runtime-geometry"] },
        },
        fidelity: {
          status: "verified",
          ssim: 1,
          maximumGeometryDelta: 0,
          diffArtifactId: ids.diffArtifact,
        },
      },
    },
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
