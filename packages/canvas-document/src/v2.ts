import {
  CanvasActionV2Schema,
  CanvasDocumentV2Schema,
  CanvasNodeV2Schema,
  CanvasOperationV2Schema,
  type CanvasActionIntentV2,
  type CanvasActionV2,
  type CanvasDocumentV2,
  type CanvasNodeV2,
  type CanvasOperationV2,
} from "@memi/protocol";
import { hashValue } from "./hash.js";
import {
  assertDerivedOperationMetadataV2,
  immutableCanvasV2,
  operationActionMaterialV2,
  operationLabelV2,
  operationTargetsV2,
  semanticCanvasStateV2,
} from "./v2-metadata.js";
import {
  applyProfessionalActionV2,
  isProfessionalActionV2,
  isProfessionalIntentV2,
  prepareProfessionalActionV2,
  restoresAuthorityV2,
} from "./v2-professional.js";
import type {
  CreateCanvasDocumentV2Input,
  InvertCanvasOperationV2Input,
  PrepareCanvasOperationV2Input,
} from "./v2-types.js";
export * from "./v2-legacy-id.js";
export type * from "./v2-types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function same(left: unknown, right: unknown): boolean {
  return hashValue(left) === hashValue(right);
}

function requireNode(
  document: CanvasDocumentV2,
  nodeId: string,
): CanvasNodeV2 {
  const node = document.nodesById[nodeId];
  if (node === undefined) {
    throw new Error(`Canvas node does not exist: ${nodeId}`);
  }
  return node;
}

function orderedChildren(
  document: CanvasDocumentV2,
  parentId: string | null,
): readonly string[] {
  return parentId === null
    ? document.rootIds
    : requireNode(document, parentId).childIds;
}

function withOrder(
  document: CanvasDocumentV2,
  parentId: string | null,
  nextOrder: readonly string[],
): CanvasDocumentV2 {
  if (parentId === null) {
    return { ...document, rootIds: [...nextOrder] as CanvasDocumentV2["rootIds"] };
  }
  const parent = requireNode(document, parentId);
  return {
    ...document,
    nodesById: {
      ...document.nodesById,
      [parentId]: {
        ...parent,
        childIds: [...nextOrder] as CanvasNodeV2["childIds"],
      },
    },
  };
}

function insertAt(
  values: readonly string[],
  index: number,
  value: string,
): readonly string[] {
  if (!Number.isInteger(index) || index < 0 || index > values.length) {
    throw new Error(`Canvas order index is out of bounds.`);
  }
  return [...values.slice(0, index), value, ...values.slice(index)];
}

function removeFrom(
  values: readonly string[],
  value: string,
): readonly string[] {
  const index = values.indexOf(value);
  if (index < 0) {
    throw new Error(`Canvas order does not contain node: ${value}`);
  }
  return [...values.slice(0, index), ...values.slice(index + 1)];
}

function replaceNode(
  document: CanvasDocumentV2,
  node: CanvasNodeV2,
): CanvasDocumentV2 {
  return {
    ...document,
    nodesById: {
      ...document.nodesById,
      [node.id]: node,
    },
  };
}

function assertExactPrior(
  current: unknown,
  prior: unknown,
  label: string,
): void {
  if (!same(current, prior)) {
    throw new Error(`${label} has a stale prior value.`);
  }
}

function isDescendant(
  document: CanvasDocumentV2,
  possibleDescendantId: string,
  ancestorId: string,
): boolean {
  let current: CanvasNodeV2 | undefined =
    document.nodesById[possibleDescendantId];
  while (current?.parentId !== null && current !== undefined) {
    if (current.parentId === ancestorId) {
      return true;
    }
    current = document.nodesById[current.parentId];
  }
  return false;
}

function applyActionUnchecked(
  document: CanvasDocumentV2,
  action: CanvasActionV2,
): CanvasDocumentV2 {
  if (action.type === "node.create") {
    const { node, parentId, index } = action.payload;
    if (document.nodesById[node.id] !== undefined) {
      throw new Error(`Canvas node already exists: ${node.id}`);
    }
    if (node.childIds.length > 0) {
      throw new Error(`Created canvas nodes must not name absent children.`);
    }
    if (node.parentId !== parentId) {
      throw new Error(
        `Created canvas node parentId must match the operation parentId.`,
      );
    }
    if (parentId !== null) {
      requireNode(document, parentId);
    }
    const order = insertAt(orderedChildren(document, parentId), index, node.id);
    const withNode = {
      ...document,
      nodesById: {
        ...document.nodesById,
        [node.id]: clone(node),
      },
    };
    return withOrder(withNode, parentId, order);
  }

  if (action.type === "node.delete") {
    const { nodeId, prior } = action.payload;
    const current = requireNode(document, nodeId);
    assertExactPrior(current, prior.node, "Canvas node delete");
    if (current.childIds.length > 0) {
      throw new Error(
        `Canvas node delete requires children to be deleted first.`,
      );
    }
    const currentOrder = orderedChildren(document, current.parentId);
    if (
      prior.parentId !== current.parentId ||
      currentOrder[prior.index] !== nodeId
    ) {
      throw new Error(`Canvas node delete has a stale parent order.`);
    }
    const order = removeFrom(currentOrder, nodeId);
    const { [nodeId]: _removed, ...remainingNodes } = document.nodesById;
    return withOrder(
      { ...document, nodesById: remainingNodes },
      current.parentId,
      order,
    );
  }

  if (action.type === "node.transform") {
    const node = requireNode(document, action.payload.nodeId);
    assertExactPrior(node.transform, action.payload.prior, "Canvas transform");
    return replaceNode(document, {
      ...node,
      transform: clone(action.payload.next),
    });
  }

  if (action.type === "node.geometry") {
    const node = requireNode(document, action.payload.nodeId);
    assertExactPrior(node.geometry, action.payload.prior, "Canvas geometry");
    return replaceNode(document, {
      ...node,
      geometry: clone(action.payload.next),
    });
  }

  if (action.type === "node.style") {
    const node = requireNode(document, action.payload.nodeId);
    assertExactPrior(node.style, action.payload.prior, "Canvas style");
    return replaceNode(document, {
      ...node,
      style: clone(action.payload.next),
    });
  }

  if (action.type === "node.text") {
    const node = requireNode(document, action.payload.nodeId);
    if (node.kind !== "text" || node.text === null) {
      throw new Error(`Canvas text operation requires a text node.`);
    }
    assertExactPrior(node.text, action.payload.prior, "Canvas text");
    return replaceNode(document, {
      ...node,
      text: clone(action.payload.next),
    });
  }

  if (action.type === "node.layout") {
    const node = requireNode(document, action.payload.nodeId);
    assertExactPrior(node.layout, action.payload.prior, "Canvas layout");
    return replaceNode(document, {
      ...node,
      layout: clone(action.payload.next),
    });
  }

  if (action.type === "node.reparent") {
    const { nodeId, prior, next } = action.payload;
    const node = requireNode(document, nodeId);
    const priorOrder = orderedChildren(document, node.parentId);
    if (
      node.parentId !== prior.parentId ||
      priorOrder[prior.index] !== nodeId
    ) {
      throw new Error(`Canvas reparent has a stale prior parent order.`);
    }
    if (next.parentId === nodeId) {
      throw new Error(`Canvas node cannot parent itself.`);
    }
    if (
      next.parentId !== null &&
      isDescendant(document, next.parentId, nodeId)
    ) {
      throw new Error(`Canvas reparent would create a hierarchy cycle.`);
    }
    if (next.parentId !== null) {
      requireNode(document, next.parentId);
    }

    const withoutPrior = withOrder(
      document,
      prior.parentId,
      removeFrom(priorOrder, nodeId),
    );
    const nextOrder = insertAt(
      orderedChildren(withoutPrior, next.parentId),
      next.index,
      nodeId,
    );
    return withOrder(
      replaceNode(withoutPrior, { ...node, parentId: next.parentId }),
      next.parentId,
      nextOrder,
    );
  }

  if (action.type === "node.reorder") {
    const { parentId, prior, next } = action.payload;
    const current = orderedChildren(document, parentId);
    assertExactPrior(current, prior, "Canvas reorder");
    if (
      new Set(next).size !== next.length ||
      next.length !== current.length ||
      next.some((nodeId) => !current.includes(nodeId))
    ) {
      throw new Error(`Canvas reorder must be a permutation of siblings.`);
    }
    return withOrder(document, parentId, next);
  }

  if (action.type === "component.define") {
    const current =
      document.componentsById[action.payload.componentId] ?? null;
    assertExactPrior(current, action.payload.prior, "Component definition");
    if (
      action.payload.next !== null &&
      action.payload.next.id !== action.payload.componentId
    ) {
      throw new Error(`Component definition ID does not match its map key.`);
    }
    if (action.payload.next === null) {
      const {
        [action.payload.componentId]: _removed,
        ...remainingComponents
      } = document.componentsById;
      return { ...document, componentsById: remainingComponents };
    }
    return {
      ...document,
      componentsById: {
        ...document.componentsById,
        [action.payload.componentId]: clone(action.payload.next),
      },
    };
  }

  if (isProfessionalActionV2(action)) {
    return applyProfessionalActionV2(document, action);
  }

  const node = requireNode(document, action.payload.nodeId);
  if (node.kind !== "instance") {
    throw new Error(`Instance override requires an instance node.`);
  }
  const current = node.instanceOverrides[action.payload.key] ?? null;
  assertExactPrior(current, action.payload.prior, "Instance override");
  const overrides =
    action.payload.next === null
      ? Object.fromEntries(
          Object.entries(node.instanceOverrides).filter(
            ([key]) => key !== action.payload.key,
          ),
        )
      : {
          ...node.instanceOverrides,
          [action.payload.key]: clone(action.payload.next),
        };
  return replaceNode(document, { ...node, instanceOverrides: overrides });
}

function applyPreparedAction(
  document: CanvasDocumentV2,
  action: CanvasActionV2,
): CanvasDocumentV2 {
  return CanvasDocumentV2Schema.parse(applyActionUnchecked(document, action));
}

function prepareSingleAction(
  document: CanvasDocumentV2,
  intent: Exclude<CanvasActionIntentV2, { readonly type: "atomic.batch" }>,
): CanvasActionV2 {
  if (isProfessionalIntentV2(intent)) {
    return prepareProfessionalActionV2(document, intent);
  }
  if (intent.type === "node.create") {
    return CanvasActionV2Schema.parse({
      type: intent.type,
      payload: {
        node: CanvasNodeV2Schema.parse(intent.payload.node),
        parentId: intent.payload.parentId,
        index: intent.payload.index,
      },
    });
  }
  if (intent.type === "node.delete") {
    const node = requireNode(document, intent.payload.nodeId);
    const index = orderedChildren(document, node.parentId).indexOf(node.id);
    return CanvasActionV2Schema.parse({
      type: intent.type,
      payload: {
        nodeId: node.id,
        prior: { node, parentId: node.parentId, index },
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
    const node = requireNode(document, intent.payload.nodeId);
    const priorByType = {
      "node.transform": node.transform,
      "node.geometry": node.geometry,
      "node.style": node.style,
      "node.text": node.text,
      "node.layout": node.layout,
    } as const;
    if (intent.type === "node.text" && node.text === null) {
      throw new Error(`Canvas text operation requires a text node.`);
    }
    return CanvasActionV2Schema.parse({
      type: intent.type,
      payload: {
        nodeId: node.id,
        prior: priorByType[intent.type],
        next: intent.payload.next,
      },
    });
  }
  if (intent.type === "node.reparent") {
    const node = requireNode(document, intent.payload.nodeId);
    return CanvasActionV2Schema.parse({
      type: intent.type,
      payload: {
        nodeId: node.id,
        prior: {
          parentId: node.parentId,
          index: orderedChildren(document, node.parentId).indexOf(node.id),
        },
        next: {
          parentId: intent.payload.nextParentId,
          index: intent.payload.nextIndex,
        },
      },
    });
  }
  if (intent.type === "node.reorder") {
    return CanvasActionV2Schema.parse({
      type: intent.type,
      payload: {
        parentId: intent.payload.parentId,
        prior: orderedChildren(document, intent.payload.parentId),
        next: intent.payload.nextOrder,
      },
    });
  }
  if (intent.type === "component.define") {
    return CanvasActionV2Schema.parse({
      type: intent.type,
      payload: {
        componentId: intent.payload.componentId,
        prior: document.componentsById[intent.payload.componentId] ?? null,
        next: intent.payload.next,
      },
    });
  }
  const node = requireNode(document, intent.payload.nodeId);
  return CanvasActionV2Schema.parse({
    type: intent.type,
    payload: {
      nodeId: node.id,
      key: intent.payload.key,
      prior: node.instanceOverrides[intent.payload.key] ?? null,
      next: intent.payload.next,
    },
  });
}

function prepareAction(
  document: CanvasDocumentV2,
  intent: CanvasActionIntentV2,
): CanvasActionV2 | { readonly type: "atomic.batch"; readonly payload: { readonly actions: readonly CanvasActionV2[] } } {
  if (intent.type !== "atomic.batch") {
    const action = prepareSingleAction(document, intent);
    applyPreparedAction(document, action);
    return action;
  }
  let current = document;
  const actions: CanvasActionV2[] = [];
  for (const childIntent of intent.payload.actions) {
    const action = prepareSingleAction(current, childIntent);
    current = applyPreparedAction(current, action);
    actions.push(action);
  }
  return { type: "atomic.batch", payload: { actions } };
}

function applyOperationAction(
  document: CanvasDocumentV2,
  operation: CanvasOperationV2,
): CanvasDocumentV2 {
  if (operation.type !== "atomic.batch") {
    return applyPreparedAction(
      document,
      CanvasActionV2Schema.parse({
        type: operation.type,
        payload: operation.payload,
      }),
    );
  }
  return operation.payload.actions.reduce(
    (current, action) => applyPreparedAction(current, action),
    document,
  );
}

function nextSemanticDocument(
  document: CanvasDocumentV2,
  operation: CanvasOperationV2,
): CanvasDocumentV2 {
  const content = applyOperationAction(document, operation);
  const candidate = {
    ...content,
    revision: document.revision + 1,
    operationCursor: operation.id,
    stateHash: document.stateHash,
  };
  return CanvasDocumentV2Schema.parse({
    ...candidate,
    stateHash: hashValue(semanticCanvasStateV2(candidate)),
  });
}

function prepareFromAction(
  document: CanvasDocumentV2,
  allocation: InvertCanvasOperationV2Input & {
    readonly undoOf?: string | null;
  },
  action:
    | CanvasActionV2
    | {
        readonly type: "atomic.batch";
        readonly payload: { readonly actions: readonly CanvasActionV2[] };
      },
): CanvasOperationV2 {
  const base = {
    schemaVersion: 2 as const,
    id: allocation.id,
    documentId: document.id,
    actor: allocation.actor,
    actorId: allocation.actorId,
    occurredAt: allocation.occurredAt,
    label: operationLabelV2(action.type),
    targetIds: operationTargetsV2(action),
    undoOf: allocation.undoOf ?? null,
    previousOperationCursor: document.operationCursor,
    type: action.type,
    payload: action.payload,
    expectedBeforeHash: document.stateHash,
  };
  const actionDigest = hashValue(base);
  const provisional = CanvasOperationV2Schema.parse({
    ...base,
    actionDigest,
    resultingHash: document.stateHash,
  });
  const resulting = nextSemanticDocument(document, provisional);
  return CanvasOperationV2Schema.parse({
    ...base,
    actionDigest,
    resultingHash: resulting.stateHash,
  });
}

function invertAction(action: CanvasActionV2): CanvasActionV2 {
  if (action.type === "node.create") {
    return CanvasActionV2Schema.parse({
      type: "node.delete",
      payload: {
        nodeId: action.payload.node.id,
        prior: {
          node: { ...action.payload.node, parentId: action.payload.parentId },
          parentId: action.payload.parentId,
          index: action.payload.index,
        },
      },
    });
  }
  if (action.type === "node.delete") {
    return CanvasActionV2Schema.parse({
      type: "node.create",
      payload: {
        node: action.payload.prior.node,
        parentId: action.payload.prior.parentId,
        index: action.payload.prior.index,
      },
    });
  }
  if (action.type === "node.reparent") {
    return CanvasActionV2Schema.parse({
      ...action,
      payload: {
        nodeId: action.payload.nodeId,
        prior: action.payload.next,
        next: action.payload.prior,
      },
    });
  }
  if (action.type === "node.reorder") {
    return CanvasActionV2Schema.parse({
      ...action,
      payload: {
        parentId: action.payload.parentId,
        prior: action.payload.next,
        next: action.payload.prior,
      },
    });
  }
  if (action.type === "component.define") {
    return CanvasActionV2Schema.parse({
      ...action,
      payload: {
        componentId: action.payload.componentId,
        prior: action.payload.next,
        next: action.payload.prior,
      },
    });
  }
  if (action.type === "instance.override") {
    return CanvasActionV2Schema.parse({
      ...action,
      payload: {
        nodeId: action.payload.nodeId,
        key: action.payload.key,
        prior: action.payload.next,
        next: action.payload.prior,
      },
    });
  }
  return CanvasActionV2Schema.parse({
    ...action,
    payload: {
      nodeId: action.payload.nodeId,
      prior: action.payload.next,
      next: action.payload.prior,
    },
  });
}

export function createCanvasDocumentV2(
  input: CreateCanvasDocumentV2Input,
): CanvasDocumentV2 {
  const candidate = CanvasDocumentV2Schema.parse({
    schemaVersion: 2,
    id: input.id,
    projectId: input.projectId,
    revision: 0,
    stateHash: `sha256:${"0".repeat(64)}`,
    operationCursor: null,
    rootIds: [],
    nodesById: {},
    componentsById: {},
    tokensById: {},
  });
  return immutableCanvasV2(
    CanvasDocumentV2Schema.parse({
      ...candidate,
      stateHash: hashValue(semanticCanvasStateV2(candidate)),
    }),
  );
}

export function hashCanvasDocumentV2(document: CanvasDocumentV2): string {
  return hashValue(semanticCanvasStateV2(CanvasDocumentV2Schema.parse(document)));
}

export function prepareCanvasOperationV2(
  untrustedDocument: CanvasDocumentV2,
  input: PrepareCanvasOperationV2Input,
): CanvasOperationV2 {
  const document = CanvasDocumentV2Schema.parse(untrustedDocument);
  if (hashCanvasDocumentV2(document) !== document.stateHash) {
    throw new Error(`Canvas document V2 state hash is corrupt.`);
  }
  const action = prepareAction(document, input.action);
  return immutableCanvasV2(prepareFromAction(document, input, action));
}

export function applyCanvasOperationV2(
  untrustedDocument: CanvasDocumentV2,
  untrustedOperation: CanvasOperationV2,
): CanvasDocumentV2 {
  const document = CanvasDocumentV2Schema.parse(untrustedDocument);
  const operation = CanvasOperationV2Schema.parse(untrustedOperation);
  if (operation.documentId !== document.id) {
    throw new Error(`Canvas V2 operation targets a different document.`);
  }
  if (hashCanvasDocumentV2(document) !== document.stateHash) {
    throw new Error(`Canvas document V2 state hash is corrupt.`);
  }
  if (operation.expectedBeforeHash !== document.stateHash) {
    throw new Error(`Stale canvas V2 operation expected-before hash.`);
  }
  if (operation.previousOperationCursor !== document.operationCursor) {
    throw new Error(`Stale canvas V2 operation previous cursor.`);
  }
  if (
    hashValue(operationActionMaterialV2(operation)) !==
    operation.actionDigest
  ) {
    throw new Error(`Canvas V2 operation action digest is invalid.`);
  }
  assertDerivedOperationMetadataV2(document, operation);
  if (
    operation.type === "node.detach" &&
    restoresAuthorityV2(
      CanvasActionV2Schema.parse({
        type: operation.type,
        payload: operation.payload,
      }),
    ) &&
    operation.undoOf === null
  ) {
    throw new Error(`Source or component authority restore requires undo proof.`);
  }

  const next = nextSemanticDocument(document, operation);
  if (next.stateHash !== operation.resultingHash) {
    throw new Error(`Canvas V2 operation resulting hash is invalid.`);
  }
  return immutableCanvasV2(next);
}

export function invertCanvasOperationV2(
  untrustedDocument: CanvasDocumentV2,
  untrustedOperation: CanvasOperationV2,
  allocation: InvertCanvasOperationV2Input,
): CanvasOperationV2 {
  const document = CanvasDocumentV2Schema.parse(untrustedDocument);
  const operation = CanvasOperationV2Schema.parse(untrustedOperation);
  if (
    operation.documentId !== document.id ||
    operation.resultingHash !== document.stateHash ||
    document.operationCursor !== operation.id ||
    document.revision === 0
  ) {
    throw new Error(
      `Canvas V2 inverse requires the operation's exact resulting document.`,
    );
  }
  if (hashCanvasDocumentV2(document) !== document.stateHash) {
    throw new Error(`Canvas V2 inverse document proof is corrupt.`);
  }
  if (
    hashValue(operationActionMaterialV2(operation)) !==
    operation.actionDigest
  ) {
    throw new Error(`Canvas V2 inverse operation action digest is invalid.`);
  }
  assertDerivedOperationMetadataV2(
    {
      ...document,
      operationCursor: operation.previousOperationCursor,
    },
    operation,
  );
  const action =
    operation.type === "atomic.batch"
      ? {
          type: "atomic.batch" as const,
          payload: {
            actions: [...operation.payload.actions]
              .reverse()
              .map(invertAction),
          },
        }
      : invertAction(
          CanvasActionV2Schema.parse({
            type: operation.type,
            payload: operation.payload,
          }),
        );
  const priorContent =
    action.type === "atomic.batch"
      ? action.payload.actions.reduce(
          (current, childAction) =>
            applyPreparedAction(current, childAction),
          document,
        )
      : applyPreparedAction(document, action);
  const priorCandidate = CanvasDocumentV2Schema.parse({
    ...priorContent,
    revision: document.revision - 1,
    operationCursor: operation.previousOperationCursor,
    stateHash: operation.expectedBeforeHash,
  });
  if (hashCanvasDocumentV2(priorCandidate) !== operation.expectedBeforeHash) {
    throw new Error(`Canvas V2 inverse expected-before proof is invalid.`);
  }
  const replayed = nextSemanticDocument(priorCandidate, operation);
  if (
    replayed.stateHash !== document.stateHash ||
    !same(semanticCanvasStateV2(replayed), semanticCanvasStateV2(document))
  ) {
    throw new Error(`Canvas V2 inverse replay proof is invalid.`);
  }
  return immutableCanvasV2(
    prepareFromAction(
      document,
      { ...allocation, undoOf: operation.id },
      action,
    ),
  );
}
