import {
  CanvasActionV3Schema,
  CanvasDocumentV3Schema,
  CanvasNodeV3Schema,
  CanvasNodeIdSchema,
  CanvasOperationV3Schema,
  CanvasPageIdSchema,
  CanvasPageV3Schema,
  CanvasSingleActionV3Schema,
  type CanvasActionIntentV3,
  type CanvasActionV3,
  type CanvasDocumentV3,
  type CanvasNodeV3,
  type CanvasOperationV3,
  type CanvasPageV3,
  type CanvasSingleActionIntentV3,
  type CanvasSingleActionV3,
} from "@memi/protocol";

import { hashValue } from "./hash.js";
import { prepareEntityActionV3 } from "./v3-entity-actions.js";
import {
  canvasActionTargetsV3,
  canvasOperationMaterialV3,
  immutableCanvasV3,
  sameCanvasV3,
  semanticCanvasStateV3,
  type CreateCanvasDocumentV3Input,
  type InvertCanvasOperationV3Input,
  type PrepareCanvasOperationV3Input,
} from "./v3-support.js";

function nodeFor(document: CanvasDocumentV3, nodeId: string): CanvasNodeV3 {
  const node = document.nodesById[nodeId];
  if (node === undefined) {
    throw new Error(`Canvas node does not exist: ${nodeId}`);
  }
  return node;
}

function orderedChildren(
  document: CanvasDocumentV3,
  pageId: CanvasNodeV3["pageId"],
  parentId: CanvasNodeV3["parentId"],
): readonly CanvasNodeV3["id"][] {
  if (parentId !== null) {
    const parent = nodeFor(document, parentId);
    if (parent.pageId !== pageId) {
      throw new Error(`Canvas parent does not belong to the requested page.`);
    }
    return parent.childIds;
  }
  const page = document.pagesById[pageId];
  if (page === undefined) {
    throw new Error(`Canvas page does not exist: ${pageId}`);
  }
  return page.rootIds;
}

function withOrder(
  document: CanvasDocumentV3,
  pageId: CanvasNodeV3["pageId"],
  parentId: CanvasNodeV3["parentId"],
  order: readonly CanvasNodeV3["id"][],
): CanvasDocumentV3 {
  if (parentId === null) {
    const page = document.pagesById[pageId];
    if (page === undefined) {
      throw new Error(`Canvas page does not exist: ${pageId}`);
    }
    return {
      ...document,
      pagesById: {
        ...document.pagesById,
        [pageId]: {
          ...page,
          rootIds: [...order] as CanvasPageV3["rootIds"],
        },
      },
    };
  }
  const parent = nodeFor(document, parentId);
  return {
    ...document,
    nodesById: {
      ...document.nodesById,
      [parentId]: {
        ...parent,
        childIds: [...order] as CanvasNodeV3["childIds"],
      },
    },
  };
}

function insertAt<T>(
  values: readonly T[],
  index: number,
  value: T,
): readonly T[] {
  if (!Number.isInteger(index) || index < 0 || index > values.length) {
    throw new Error(`Canvas order index is out of bounds.`);
  }
  return [...values.slice(0, index), value, ...values.slice(index)];
}

function removeFrom<T>(values: readonly T[], value: T): readonly T[] {
  const index = values.indexOf(value);
  if (index < 0) {
    throw new Error(`Canvas order does not contain node: ${value}`);
  }
  return [...values.slice(0, index), ...values.slice(index + 1)];
}

function replaceNode(
  document: CanvasDocumentV3,
  node: CanvasNodeV3,
): CanvasDocumentV3 {
  return {
    ...document,
    nodesById: { ...document.nodesById, [node.id]: node },
  };
}

function descendantIds(
  document: CanvasDocumentV3,
  nodeId: string,
): readonly string[] {
  const result: string[] = [];
  const pending = [...nodeFor(document, nodeId).childIds];
  while (pending.length > 0) {
    const currentId = pending.shift();
    if (currentId === undefined) {
      continue;
    }
    result.push(currentId);
    pending.unshift(...nodeFor(document, currentId).childIds);
  }
  return result;
}

function applyEntity<Value>(
  current: Readonly<Record<string, Value>>,
  id: string,
  prior: Value | null,
  next: Value | null,
  label: string,
): Readonly<Record<string, Value>> {
  if (!sameCanvasV3(current[id] ?? null, prior)) {
    throw new Error(`${label} has a stale prior value.`);
  }
  if (next === null) {
    return Object.fromEntries(
      Object.entries(current).filter(([key]) => key !== id),
    );
  }
  return { ...current, [id]: structuredClone(next) };
}

function applySingleAction(
  document: CanvasDocumentV3,
  action: CanvasSingleActionV3,
): CanvasDocumentV3 {
  if (action.type === "node.create") {
    const { node, parentId, index } = action.payload;
    if (document.nodesById[node.id] !== undefined || node.childIds.length > 0) {
      throw new Error(`Created node must be new and cannot name absent children.`);
    }
    if (node.parentId !== parentId) {
      throw new Error(`Created node parent does not match the operation.`);
    }
    const order = insertAt(
      orderedChildren(document, node.pageId, parentId),
      index,
      node.id,
    );
    return withOrder(
      {
        ...document,
        nodesById: {
          ...document.nodesById,
          [node.id]: structuredClone(node),
        },
      },
      node.pageId,
      parentId,
      order,
    );
  }
  if (action.type === "node.delete") {
    const current = nodeFor(document, action.payload.nodeId);
    const { prior } = action.payload;
    if (!sameCanvasV3(current, prior.node) || current.childIds.length > 0) {
      throw new Error(`Canvas node delete has stale state or live children.`);
    }
    const order = orderedChildren(document, current.pageId, current.parentId);
    if (
      prior.parentId !== current.parentId ||
      order[prior.index] !== current.id
    ) {
      throw new Error(`Canvas node delete has a stale parent order.`);
    }
    const { [current.id]: _removed, ...nodesById } = document.nodesById;
    return withOrder(
      { ...document, nodesById },
      current.pageId,
      current.parentId,
      removeFrom(order, current.id),
    );
  }
  if (
    action.type === "node.transform" ||
    action.type === "node.geometry" ||
    action.type === "node.style" ||
    action.type === "node.text" ||
    action.type === "node.layout"
  ) {
    const node = nodeFor(document, action.payload.nodeId);
    const field = action.type.split(".")[1] as
      | "transform"
      | "geometry"
      | "style"
      | "text"
      | "layout";
    if (!sameCanvasV3(node[field], action.payload.prior)) {
      throw new Error(`Canvas ${field} has a stale prior value.`);
    }
    return replaceNode(document, {
      ...node,
      [field]: structuredClone(action.payload.next),
    });
  }
  if (action.type === "node.reparent") {
    const node = nodeFor(document, action.payload.nodeId);
    const { prior, next } = action.payload;
    const priorOrder = orderedChildren(document, prior.pageId, prior.parentId);
    if (
      node.pageId !== prior.pageId ||
      node.parentId !== prior.parentId ||
      priorOrder[prior.index] !== node.id
    ) {
      throw new Error(`Canvas reparent has stale prior state.`);
    }
    if (next.parentId === node.id || descendantIds(document, node.id).includes(next.parentId ?? "")) {
      throw new Error(`Canvas reparent would create a hierarchy cycle.`);
    }
    if (next.parentId !== null && nodeFor(document, next.parentId).pageId !== next.pageId) {
      throw new Error(`Canvas reparent target must belong to the target page.`);
    }
    const withoutPrior = withOrder(
      document,
      prior.pageId,
      prior.parentId,
      removeFrom(priorOrder, node.id),
    );
    const nextOrder = insertAt(
      orderedChildren(withoutPrior, next.pageId, next.parentId),
      next.index,
      node.id,
    );
    const movedIds = new Set([node.id, ...descendantIds(document, node.id)]);
    const nodesById = Object.fromEntries(
      Object.entries(withoutPrior.nodesById).map(([nodeId, current]) => [
        nodeId,
        movedIds.has(nodeId)
          ? {
              ...current,
              pageId: next.pageId,
              ...(nodeId === node.id ? { parentId: next.parentId } : {}),
            }
          : current,
      ]),
    );
    return withOrder(
      { ...withoutPrior, nodesById },
      next.pageId,
      next.parentId,
      nextOrder,
    );
  }
  if (action.type === "node.reorder") {
    const current = orderedChildren(
      document,
      action.payload.pageId,
      action.payload.parentId,
    );
    if (!sameCanvasV3(current, action.payload.prior)) {
      throw new Error(`Canvas reorder has a stale prior order.`);
    }
    if (
      new Set(action.payload.next).size !== current.length ||
      action.payload.next.length !== current.length ||
      action.payload.next.some((nodeId) => !current.includes(nodeId))
    ) {
      throw new Error(`Canvas reorder must be a sibling permutation.`);
    }
    return withOrder(
      document,
      action.payload.pageId,
      action.payload.parentId,
      action.payload.next,
    );
  }
  if (action.type === "page.define") {
    const { pageId, prior, next } = action.payload;
    if ((prior === null || next === null) && (prior?.rootIds.length ?? next?.rootIds.length ?? 0) > 0) {
      throw new Error(`Page creation and deletion require an empty page.`);
    }
    const pagesById = applyEntity(
      document.pagesById,
      pageId,
      prior,
      next,
      "Page definition",
    );
    const pageIds =
      prior === null && next !== null
        ? [...document.pageIds, next.id]
        : next === null
          ? document.pageIds.filter((id) => id !== pageId)
          : document.pageIds;
    return { ...document, pageIds, pagesById };
  }
  if (action.type === "component.define") {
    return {
      ...document,
      componentsById: applyEntity(
        document.componentsById,
        action.payload.componentId,
        action.payload.prior,
        action.payload.next,
        "Component definition",
      ),
    };
  }
  if (action.type === "instance.override") {
    const node = nodeFor(document, action.payload.nodeId);
    if (node.kind !== "instance") {
      throw new Error(`Instance override requires an instance node.`);
    }
    if (
      !sameCanvasV3(
        node.instanceOverrides[action.payload.key] ?? null,
        action.payload.prior,
      )
    ) {
      throw new Error(`Instance override has a stale prior value.`);
    }
    const instanceOverrides =
      action.payload.next === null
        ? Object.fromEntries(
            Object.entries(node.instanceOverrides).filter(
              ([key]) => key !== action.payload.key,
            ),
          )
        : {
            ...node.instanceOverrides,
            [action.payload.key]: structuredClone(action.payload.next),
          };
    return replaceNode(document, { ...node, instanceOverrides });
  }
  if (action.type === "variable-collection.define") {
    const entity = action.payload;
    return {
      ...document,
      variableCollectionsById: applyEntity(
        document.variableCollectionsById,
        entity.collectionId,
        entity.prior,
        entity.next,
        "Variable collection definition",
      ),
    };
  }
  if (action.type === "variable.define") {
    const entity = action.payload;
    return {
      ...document,
      variablesById: applyEntity(
        document.variablesById,
        entity.variableId,
        entity.prior,
        entity.next,
        "Variable definition",
      ),
    };
  }
  if (action.type === "asset.define") {
    const entity = action.payload;
    return {
      ...document,
      assetsById: applyEntity(
        document.assetsById,
        entity.assetId,
        entity.prior,
        entity.next,
        "Asset definition",
      ),
    };
  }
  if (action.type === "prototype.define") {
    const entity = action.payload;
    return {
      ...document,
      prototypeConnectionsById: applyEntity(
        document.prototypeConnectionsById,
        entity.connectionId,
        entity.prior,
        entity.next,
        "Prototype definition",
      ),
    };
  }
  if (action.type === "evidence.define") {
    const entity = action.payload;
    return {
      ...document,
      evidenceById: applyEntity(
        document.evidenceById,
        entity.evidenceId,
        entity.prior,
        entity.next,
        "Evidence definition",
      ),
    };
  }
  const entity = action.payload;
  return {
    ...document,
    reconstructionsById: applyEntity(
      document.reconstructionsById,
      entity.reconstructionId,
      entity.prior,
      entity.next,
      "Reconstruction definition",
    ),
  };
}

function applyAction(
  document: CanvasDocumentV3,
  action: CanvasActionV3,
): CanvasDocumentV3 {
  const next =
    action.type === "atomic.batch"
      ? action.payload.actions.reduce(applySingleAction, document)
      : applySingleAction(document, action);
  return CanvasDocumentV3Schema.parse(next);
}

function prepareSingleAction(
  document: CanvasDocumentV3,
  intent: CanvasSingleActionIntentV3,
): CanvasSingleActionV3 {
  if (intent.type === "node.create") {
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        node: CanvasNodeV3Schema.parse(intent.payload.node),
        parentId: intent.payload.parentId,
        index: intent.payload.index,
      },
    });
  }
  if (intent.type === "node.delete") {
    const node = nodeFor(document, intent.payload.nodeId);
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        nodeId: node.id,
        prior: {
          node,
          parentId: node.parentId,
          index: orderedChildren(document, node.pageId, node.parentId).indexOf(node.id),
        },
      },
    });
  }
  if (
    intent.type === "node.transform" ||
    intent.type === "node.geometry" ||
    intent.type === "node.style" ||
    intent.type === "node.text" ||
    intent.type === "node.layout"
  ) {
    const node = nodeFor(document, intent.payload.nodeId);
    const field = intent.type.split(".")[1] as
      | "transform"
      | "geometry"
      | "style"
      | "text"
      | "layout";
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        nodeId: node.id,
        prior: node[field],
        next: intent.payload.next,
      },
    });
  }
  if (intent.type === "node.reparent") {
    const node = nodeFor(document, intent.payload.nodeId);
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        nodeId: node.id,
        prior: {
          pageId: node.pageId,
          parentId: node.parentId,
          index: orderedChildren(document, node.pageId, node.parentId).indexOf(node.id),
        },
        next: {
          pageId: intent.payload.nextPageId,
          parentId: intent.payload.nextParentId,
          index: intent.payload.nextIndex,
        },
      },
    });
  }
  if (intent.type === "node.reorder") {
    const pageId = CanvasPageIdSchema.parse(intent.payload.pageId);
    const parentId = CanvasNodeIdSchema.nullable().parse(
      intent.payload.parentId,
    );
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        pageId,
        parentId,
        prior: orderedChildren(document, pageId, parentId),
        next: intent.payload.nextOrder,
      },
    });
  }
  if (intent.type === "instance.override") {
    const node = nodeFor(document, intent.payload.nodeId);
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        nodeId: node.id,
        key: intent.payload.key,
        prior: node.instanceOverrides[intent.payload.key] ?? null,
        next: intent.payload.next,
      },
    });
  }
  return prepareEntityActionV3(document, intent);
}

function invertSingleAction(action: CanvasSingleActionV3): CanvasSingleActionV3 {
  if (action.type === "node.create") {
    return CanvasSingleActionV3Schema.parse({
      type: "node.delete",
      payload: {
        nodeId: action.payload.node.id,
        prior: {
          node: action.payload.node,
          parentId: action.payload.parentId,
          index: action.payload.index,
        },
      },
    });
  }
  if (action.type === "node.delete") {
    return CanvasSingleActionV3Schema.parse({
      type: "node.create",
      payload: {
        node: action.payload.prior.node,
        parentId: action.payload.prior.parentId,
        index: action.payload.prior.index,
      },
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

function inverseAction(action: CanvasActionV3): CanvasActionV3 {
  return action.type === "atomic.batch"
    ? CanvasActionV3Schema.parse({
        type: "atomic.batch",
        payload: {
          actions: [...action.payload.actions].reverse().map(invertSingleAction),
        },
      })
    : invertSingleAction(action);
}

function prepareAction(
  document: CanvasDocumentV3,
  intent: CanvasActionIntentV3,
): CanvasActionV3 {
  if (intent.type !== "atomic.batch") {
    return prepareSingleAction(document, intent);
  }
  let current = document;
  const actions: CanvasSingleActionV3[] = [];
  for (const childIntent of intent.payload.actions) {
    const action = prepareSingleAction(current, childIntent);
    current = applySingleAction(current, action);
    actions.push(action);
  }
  return CanvasActionV3Schema.parse({
    type: "atomic.batch",
    payload: { actions },
  });
}

function nextSemanticDocument(
  document: CanvasDocumentV3,
  operation: CanvasOperationV3,
): CanvasDocumentV3 {
  const content = applyAction(document, operation.action);
  const candidate = {
    ...content,
    revision: document.revision + 1,
    operationCursor: operation.id,
    stateHash: document.stateHash,
  };
  return CanvasDocumentV3Schema.parse({
    ...candidate,
    stateHash: hashValue(semanticCanvasStateV3(candidate)),
  });
}

function prepareFromAction(
  document: CanvasDocumentV3,
  input: Omit<PrepareCanvasOperationV3Input, "action"> & {
    readonly undoOf?: string | null;
  },
  action: CanvasActionV3,
  inverse: CanvasActionV3,
): CanvasOperationV3 {
  const base = {
    schemaVersion: 3 as const,
    id: input.id,
    documentId: document.id,
    actor: input.actor,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    label: input.label,
    targetIds: canvasActionTargetsV3(action),
    undoOf: input.undoOf ?? null,
    traceId: input.traceId ?? null,
    expectedRevision: document.revision,
    previousOperationCursor: document.operationCursor,
    expectedBeforeHash: document.stateHash,
    type: action.type,
    action,
    inverseAction: inverse,
  };
  const actionDigest = hashValue(base);
  const provisional = CanvasOperationV3Schema.parse({
    ...base,
    actionDigest,
    resultingHash: document.stateHash,
  });
  const resulting = nextSemanticDocument(document, provisional);
  return immutableCanvasV3(
    CanvasOperationV3Schema.parse({
      ...base,
      actionDigest,
      resultingHash: resulting.stateHash,
    }),
  );
}

export function createCanvasDocumentV3(
  input: CreateCanvasDocumentV3Input,
): CanvasDocumentV3 {
  const page = CanvasPageV3Schema.parse({ ...input.initialPage, rootIds: [] });
  const candidate = CanvasDocumentV3Schema.parse({
    schemaVersion: 3,
    id: input.id,
    projectId: input.projectId,
    revision: 0,
    stateHash: `sha256:${"0".repeat(64)}`,
    operationCursor: null,
    pageIds: [page.id],
    pagesById: { [page.id]: page },
    nodesById: {},
    componentsById: {},
    variableCollectionsById: {},
    variablesById: {},
    assetsById: {},
    prototypeConnectionsById: {},
    evidenceById: {},
    reconstructionsById: {},
  });
  return immutableCanvasV3(
    CanvasDocumentV3Schema.parse({
      ...candidate,
      stateHash: hashValue(semanticCanvasStateV3(candidate)),
    }),
  );
}

export function hashCanvasDocumentV3(document: CanvasDocumentV3): string {
  return hashValue(
    semanticCanvasStateV3(CanvasDocumentV3Schema.parse(document)),
  );
}

export function prepareCanvasOperationV3(
  untrustedDocument: CanvasDocumentV3,
  input: PrepareCanvasOperationV3Input,
): CanvasOperationV3 {
  const document = CanvasDocumentV3Schema.parse(untrustedDocument);
  if (hashCanvasDocumentV3(document) !== document.stateHash) {
    throw new Error(`Canvas document V3 state hash is corrupt.`);
  }
  const action = prepareAction(document, input.action);
  return prepareFromAction(document, input, action, inverseAction(action));
}

export function applyCanvasOperationV3(
  untrustedDocument: CanvasDocumentV3,
  untrustedOperation: CanvasOperationV3,
): CanvasDocumentV3 {
  const document = CanvasDocumentV3Schema.parse(untrustedDocument);
  const operation = CanvasOperationV3Schema.parse(untrustedOperation);
  if (operation.documentId !== document.id) {
    throw new Error(`Canvas V3 operation targets a different document.`);
  }
  if (hashCanvasDocumentV3(document) !== document.stateHash) {
    throw new Error(`Canvas document V3 state hash is corrupt.`);
  }
  if (operation.expectedRevision !== document.revision) {
    throw new Error(`Stale canvas V3 operation expected revision.`);
  }
  if (
    operation.expectedBeforeHash !== document.stateHash ||
    operation.previousOperationCursor !== document.operationCursor
  ) {
    throw new Error(`Stale canvas V3 operation document proof.`);
  }
  if (
    hashValue(canvasOperationMaterialV3(operation)) !== operation.actionDigest
  ) {
    throw new Error(`Canvas V3 operation action digest is invalid.`);
  }
  if (
    !sameCanvasV3(
      operation.targetIds,
      canvasActionTargetsV3(operation.action),
    )
  ) {
    throw new Error(`Canvas V3 operation target metadata is invalid.`);
  }
  if (!sameCanvasV3(operation.inverseAction, inverseAction(operation.action))) {
    throw new Error(`Canvas V3 operation inverse evidence is invalid.`);
  }
  const next = nextSemanticDocument(document, operation);
  if (next.stateHash !== operation.resultingHash) {
    throw new Error(`Canvas V3 operation resulting hash is invalid.`);
  }
  return immutableCanvasV3(next);
}

export function invertCanvasOperationV3(
  untrustedDocument: CanvasDocumentV3,
  untrustedOperation: CanvasOperationV3,
  input: InvertCanvasOperationV3Input,
): CanvasOperationV3 {
  const document = CanvasDocumentV3Schema.parse(untrustedDocument);
  const operation = CanvasOperationV3Schema.parse(untrustedOperation);
  if (
    operation.documentId !== document.id ||
    operation.resultingHash !== document.stateHash ||
    operation.id !== document.operationCursor
  ) {
    throw new Error(`Canvas V3 inverse requires the exact resulting document.`);
  }
  return prepareFromAction(
    document,
    {
      ...input,
      label: input.label ?? `Undo ${operation.label}`,
      undoOf: operation.id,
    },
    operation.inverseAction,
    operation.action,
  );
}
