import {
  CanvasActionV2Schema,
  type CanvasActionIntentV2,
  type CanvasActionV2,
  type CanvasComponentBindingV2,
  type CanvasDetachedProvenanceV2,
  type CanvasDocumentV2,
  type CanvasNodeComponentStateV2,
  type CanvasNodeDetachStateV2,
  type CanvasNodeProvenanceStateV2,
  type CanvasSourceBindingV2,
  type CanvasNodeV2,
} from "@memi/protocol";

import { hashValue } from "./hash.js";

type ProfessionalActionType =
  | "node.identity"
  | "node.content"
  | "node.provenance"
  | "node.component"
  | "node.detach";

type ProfessionalAction = Extract<
  CanvasActionV2,
  { readonly type: ProfessionalActionType }
>;
type ProfessionalIntent = Extract<
  CanvasActionIntentV2,
  { readonly type: ProfessionalActionType }
>;

function nodeFor(
  document: CanvasDocumentV2,
  nodeId: string,
): CanvasNodeV2 {
  const node = document.nodesById[nodeId];
  if (node === undefined) {
    throw new Error(`Canvas node does not exist: ${nodeId}`);
  }
  return node;
}

function same(left: unknown, right: unknown): boolean {
  return hashValue(left) === hashValue(right);
}

function provenanceState(
  node: CanvasNodeV2,
): CanvasNodeProvenanceStateV2 {
  return {
    provenance: node.provenance,
    referenceBinding: node.referenceBinding,
    sourceBinding: node.sourceBinding,
  };
}

function componentState(node: CanvasNodeV2): CanvasNodeComponentStateV2 {
  return {
    componentId: node.componentId,
    instanceOverrides: node.instanceOverrides,
    componentBinding: node.componentBinding,
  };
}

function detachState(node: CanvasNodeV2): CanvasNodeDetachStateV2 {
  return {
    identity: { name: node.name, kind: node.kind },
    content: node.content,
    provenance: provenanceState(node),
    component: componentState(node),
  };
}

function replaceNode(
  document: CanvasDocumentV2,
  node: CanvasNodeV2,
): CanvasDocumentV2 {
  return {
    ...document,
    nodesById: { ...document.nodesById, [node.id]: node },
  };
}

function assertPrior(
  current: unknown,
  prior: unknown,
  label: string,
): void {
  if (!same(current, prior)) {
    throw new Error(`${label} has a stale prior value.`);
  }
}

function assertComponentMetadataUpdate(
  prior: CanvasNodeComponentStateV2,
  next: CanvasNodeComponentStateV2,
): void {
  if (
    prior.componentId !== next.componentId ||
    prior.componentBinding?.classification !==
      next.componentBinding?.classification ||
    prior.componentBinding?.componentId !==
      next.componentBinding?.componentId ||
    prior.componentBinding?.masterNodeId !==
      next.componentBinding?.masterNodeId
  ) {
    throw new Error(
      `Component authority changes require a node.detach operation.`,
    );
  }
}

function sourceDetachEvidence(
  source: CanvasSourceBindingV2,
): CanvasDetachedProvenanceV2 {
  return {
    repositoryRevision: source.repositoryRevision,
    repositoryDirty: source.repositoryDirty,
    dirtyFileFingerprint: source.dirtyFileFingerprint,
    sourceFingerprint: source.sourceFingerprint,
    sourceContentHash: source.sourceContentHash,
    sourceAnchor: source.sourceAnchor,
    captureState: source.captureState,
    routeId: source.routeId,
    stateId: source.stateId,
    coverageCellId: source.coverageCellId,
  };
}

function componentDetachEvidence(
  component: CanvasComponentBindingV2,
): CanvasDetachedProvenanceV2 {
  return {
    repositoryRevision: component.source.repositoryRevision,
    repositoryDirty: component.source.repositoryDirty,
    dirtyFileFingerprint: null,
    sourceFingerprint: null,
    sourceContentHash: component.source.sourceContentHash,
    sourceAnchor: component.source.sourceAnchor,
    captureState: null,
    routeId: null,
    stateId: null,
    coverageCellId: null,
  };
}

function assertDetachEvidence(
  prior: CanvasNodeDetachStateV2,
  next: CanvasNodeDetachStateV2,
): void {
  const evidence = next.provenance.provenance;
  if (evidence === null) {
    throw new Error(`Authority detach must retain detached provenance.`);
  }
  const source = prior.provenance.sourceBinding;
  if (source !== null && !same(evidence, sourceDetachEvidence(source))) {
    throw new Error(
      `Source detach provenance evidence does not match prior authority.`,
    );
  }
  const component = prior.component.componentBinding;
  if (component === null) {
    return;
  }
  const expected = componentDetachEvidence(component);
  const representableFieldsMatch =
    evidence.repositoryRevision === expected.repositoryRevision &&
    evidence.repositoryDirty === expected.repositoryDirty &&
    evidence.sourceContentHash === expected.sourceContentHash &&
    evidence.sourceAnchor === expected.sourceAnchor;
  const componentOnlyFieldsMatch =
    source !== null ||
    (evidence.dirtyFileFingerprint === null &&
      evidence.sourceFingerprint === null &&
      evidence.captureState === null &&
      evidence.routeId === null &&
      evidence.stateId === null &&
      evidence.coverageCellId === null);
  if (!representableFieldsMatch || !componentOnlyFieldsMatch) {
    throw new Error(
      `Component detach provenance evidence does not match prior authority.`,
    );
  }
}

function assertDetachTransition(
  prior: CanvasNodeDetachStateV2,
  next: CanvasNodeDetachStateV2,
): void {
  const hadSource = prior.provenance.sourceBinding !== null;
  const hadComponent = prior.component.componentBinding !== null;
  const nextHasSource = next.provenance.sourceBinding !== null;
  const nextHasComponent = next.component.componentBinding !== null;
  const removesAuthority =
    (hadSource || hadComponent) && !nextHasSource && !nextHasComponent;
  const restoresAuthority =
    !hadSource && !hadComponent && (nextHasSource || nextHasComponent);
  if (!removesAuthority && !restoresAuthority) {
    throw new Error(
      `Node detach must remove authority or restore it during undo.`,
    );
  }
  if (removesAuthority) {
    if (
      next.component.componentId !== null ||
      Object.keys(next.component.instanceOverrides).length > 0
    ) {
      throw new Error(`Node detach must remove component authority.`);
    }
    assertDetachEvidence(prior, next);
    if (
      next.identity.kind === "imported-source-frame" ||
      next.identity.kind === "component" ||
      next.identity.kind === "instance"
    ) {
      throw new Error(`Detached nodes must use an authority-free kind.`);
    }
  }
}

export function isProfessionalActionV2(
  action: CanvasActionV2,
): action is ProfessionalAction {
  return [
    "node.identity",
    "node.content",
    "node.provenance",
    "node.component",
    "node.detach",
  ].includes(action.type);
}

export function isProfessionalIntentV2(
  intent: CanvasActionIntentV2,
): intent is ProfessionalIntent {
  return [
    "node.identity",
    "node.content",
    "node.provenance",
    "node.component",
    "node.detach",
  ].includes(intent.type);
}

export function restoresAuthorityV2(action: CanvasActionV2): boolean {
  if (action.type !== "node.detach") {
    return false;
  }
  const priorHasAuthority =
    action.payload.prior.provenance.sourceBinding !== null ||
    action.payload.prior.component.componentBinding !== null;
  const nextHasAuthority =
    action.payload.next.provenance.sourceBinding !== null ||
    action.payload.next.component.componentBinding !== null;
  return !priorHasAuthority && nextHasAuthority;
}

export function applyProfessionalActionV2(
  document: CanvasDocumentV2,
  action: ProfessionalAction,
): CanvasDocumentV2 {
  const node = nodeFor(document, action.payload.nodeId);
  if (action.type === "node.identity") {
    assertPrior(
      { name: node.name, kind: node.kind },
      action.payload.prior,
      "Canvas identity",
    );
    if (
      node.kind !== action.payload.next.kind &&
      (node.sourceBinding !== null || node.componentBinding !== null)
    ) {
      throw new Error(`Authority-bound kind changes require node.detach.`);
    }
    return replaceNode(document, {
      ...node,
      name: action.payload.next.name,
      kind: action.payload.next.kind,
    });
  }
  if (action.type === "node.content") {
    assertPrior(node.content, action.payload.prior, "Canvas content");
    return replaceNode(document, {
      ...node,
      content: structuredClone(action.payload.next),
    });
  }
  if (action.type === "node.provenance") {
    const current = provenanceState(node);
    assertPrior(current, action.payload.prior, "Canvas provenance");
    if (
      (current.sourceBinding === null) !==
      (action.payload.next.sourceBinding === null)
    ) {
      throw new Error(`Source authority changes require node.detach.`);
    }
    return replaceNode(document, {
      ...node,
      ...structuredClone(action.payload.next),
    });
  }
  if (action.type === "node.component") {
    const current = componentState(node);
    assertPrior(current, action.payload.prior, "Canvas component");
    assertComponentMetadataUpdate(current, action.payload.next);
    return replaceNode(document, {
      ...node,
      ...structuredClone(action.payload.next),
    });
  }

  const current = detachState(node);
  assertPrior(current, action.payload.prior, "Canvas detach");
  assertDetachTransition(current, action.payload.next);
  return replaceNode(document, {
    ...node,
    name: action.payload.next.identity.name,
    kind: action.payload.next.identity.kind,
    content: structuredClone(action.payload.next.content),
    ...structuredClone(action.payload.next.provenance),
    ...structuredClone(action.payload.next.component),
  });
}

export function prepareProfessionalActionV2(
  document: CanvasDocumentV2,
  intent: ProfessionalIntent,
): ProfessionalAction {
  const node = nodeFor(document, intent.payload.nodeId);
  const priorByType = {
    "node.identity": { name: node.name, kind: node.kind },
    "node.content": node.content,
    "node.provenance": provenanceState(node),
    "node.component": componentState(node),
    "node.detach": detachState(node),
  } as const;
  return CanvasActionV2Schema.parse({
    type: intent.type,
    payload: {
      nodeId: node.id,
      prior: priorByType[intent.type],
      next: intent.payload.next,
    },
  }) as ProfessionalAction;
}
