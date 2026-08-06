import { mapLegacyCanvasIdV2 } from "@memi/canvas-document";

import type { AgentPatch } from "./agent-patch.js";
import type { WorkbenchNode } from "./model.js";
import type { WorkbenchIntentReceiptV3 } from "./workbench-v3-intents.js";

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withoutName(node: WorkbenchNode): Omit<WorkbenchNode, "name"> {
  const { name: _name, ...rest } = node;
  return rest;
}

/**
 * Translate the narrow legacy patch shape that can be proven equivalent to
 * durable V3 operations. Full-node replacement is deliberately unsupported.
 */
export function agentPatchV3Receipt(
  patch: AgentPatch,
  currentNodes: readonly WorkbenchNode[],
  resolveNodeId: (nodeId: string) => string = (nodeId) => nodeId,
): WorkbenchIntentReceiptV3 {
  if (patch.operations.some(({ kind }) => kind !== "update")) {
    throw new Error(
      "Agent patch contains operations without a safe V3 semantic translation.",
    );
  }

  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const proposedById = new Map(
    patch.proposedNodes.map((node) => [node.id, node]),
  );
  if (
    currentById.size !== currentNodes.length ||
    proposedById.size !== patch.proposedNodes.length ||
    currentById.size !== proposedById.size ||
    [...currentById.keys()].some((id) => !proposedById.has(id))
  ) {
    throw new Error(
      "Agent patch changes the document node set without explicit V3 receipts.",
    );
  }

  const patchTargets = new Set(patch.targetIds);
  const declaredUpdateTargets = new Set(
    patch.operations.flatMap(({ targetIds }) => targetIds),
  );
  if (
    [...declaredUpdateTargets].some((id) => !patchTargets.has(id)) ||
    [...patchTargets].some((id) => !declaredUpdateTargets.has(id))
  ) {
    throw new Error(
      "Agent patch targets do not match its declared update operations.",
    );
  }

  const receipts: Exclude<
    WorkbenchIntentReceiptV3,
    { readonly kind: "batch" }
  >[] = [];
  for (const current of currentNodes) {
    const proposed = proposedById.get(current.id);
    if (proposed === undefined || sameValue(current, proposed)) {
      continue;
    }
    if (
      !patchTargets.has(current.id) ||
      !sameValue(withoutName(current), withoutName(proposed))
    ) {
      throw new Error(
        `Agent patch changes ${current.id} without an exact V3 semantic receipt.`,
      );
    }
    const next = proposed.name.trim();
    if (next.length === 0 || next.length > 512 || next === current.name) {
      throw new Error(
        `Agent patch proposes an invalid V3 node name for ${current.id}.`,
      );
    }
    receipts.push({
      kind: "node.name",
      next,
      nodeId: resolveNodeId(current.id),
    });
  }

  if (receipts.length === 0) {
    throw new Error("Agent patch has no matching V3 semantic changes.");
  }
  return receipts.length === 1
    ? receipts[0]!
    : { kind: "batch", receipts };
}

export function legacyAgentPatchV3NodeId(
  legacyDocumentId: string,
  legacyNodeId: string,
): string {
  return mapLegacyCanvasIdV2(
    "node",
    `${legacyDocumentId}:${legacyNodeId}`,
  ).canonicalId;
}

export function agentPatchUsesLegacyNodeIds(
  targetIds: readonly string[],
  currentNodes: readonly WorkbenchNode[],
): boolean {
  const currentNodeIds = new Set(currentNodes.map(({ id }) => id));
  const hasCanonicalTarget = targetIds.some((id) => currentNodeIds.has(id));
  const hasLegacyTarget = targetIds.some((id) => !currentNodeIds.has(id));
  if (hasCanonicalTarget && hasLegacyTarget) {
    throw new Error(
      "Agent patch mixes legacy and canonical V3 target identities.",
    );
  }
  return hasLegacyTarget;
}
