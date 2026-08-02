import {
  createAgentPatch,
  type AgentPatch,
} from "./agent-patch.js";
import type {
  CanvasRuntimeCheckpoint,
  CanvasRuntimeEvent,
  CanvasRuntimeProposal,
  CanvasRuntimeProposalOperation,
  CanvasRuntimeSnapshot,
  CanvasRuntimeState,
  CanvasRuntimeStorage,
  CanvasRuntimeSubmitRequest,
} from "./canvas-runtime-port-contract.js";
import type { WorkbenchNode } from "./model.js";

export interface StoredCanvasRuntime {
  readonly checkpoints: readonly CanvasRuntimeCheckpoint[];
  readonly runs: readonly CanvasRuntimeSnapshot[];
  readonly version: 1;
}

export const DEFAULT_MAX_STORAGE_BYTES = 1_500_000;
export const DEFAULT_MAX_STORED_CHECKPOINTS = 8;
export const DEFAULT_MAX_STORED_RUNS = 8;

const RUNTIME_STATES: ReadonlySet<CanvasRuntimeState> = new Set([
  "Disconnected",
  "Ready",
  "Queued",
  "Planning",
  "Using tools",
  "Waiting for approval",
  "Applying",
  "Verifying",
  "Complete",
  "Failed",
  "Canceled",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isWorkbenchNode(value: unknown): value is WorkbenchNode {
  if (!isRecord(value) || !isRecord(value.position) || !isRecord(value.size)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.name === "string" &&
    (value.parentId === null || typeof value.parentId === "string") &&
    isFiniteNumber(value.position.x) &&
    isFiniteNumber(value.position.y) &&
    isFiniteNumber(value.size.width) &&
    isFiniteNumber(value.size.height)
  );
}

function isSubmitRequest(value: unknown): value is CanvasRuntimeSubmitRequest {
  if (!isRecord(value) || !isRecord(value.viewport)) {
    return false;
  }
  return (
    typeof value.documentId === "string" &&
    Array.isArray(value.documentNodes) &&
    value.documentNodes.every(isWorkbenchNode) &&
    Number.isInteger(value.documentRevision) &&
    typeof value.harnessId === "string" &&
    typeof value.modelId === "string" &&
    ["inspect-only", "approval", "full-access"].includes(
      String(value.permissionPolicy),
    ) &&
    typeof value.projectId === "string" &&
    typeof value.prompt === "string" &&
    ["plan", "propose", "apply"].includes(String(value.promptMode)) &&
    ["low", "medium", "high", "xhigh"].includes(
      String(value.reasoningEffort),
    ) &&
    isStringArray(value.selectedNodeIds) &&
    isFiniteNumber(value.viewport.height) &&
    isFiniteNumber(value.viewport.width) &&
    isFiniteNumber(value.viewport.x) &&
    isFiniteNumber(value.viewport.y) &&
    isFiniteNumber(value.viewport.zoom)
  );
}

function isRuntimeEvent(value: unknown): value is CanvasRuntimeEvent {
  return (
    isRecord(value) &&
    typeof value.at === "string" &&
    typeof value.id === "string" &&
    typeof value.message === "string" &&
    Number.isInteger(value.sequence) &&
    typeof value.state === "string" &&
    RUNTIME_STATES.has(value.state as CanvasRuntimeState)
  );
}

function isRuntimeProposal(value: unknown): value is CanvasRuntimeProposal {
  if (
    !isRecord(value) ||
    !isRecord(value.patch) ||
    !Array.isArray(value.patch.proposedNodes) ||
    !value.patch.proposedNodes.every(isWorkbenchNode)
  ) {
    return false;
  }
  try {
    createAgentPatch(value.patch as unknown as AgentPatch);
  } catch {
    return false;
  }
  return (
    value.authority === "canvas-only" &&
    Number.isInteger(value.baseRevision) &&
    typeof value.digest === "string" &&
    value.filesChanged === 0 &&
    typeof value.id === "string" &&
    isStringArray(value.informationalSourcePaths) &&
    Array.isArray(value.operations) &&
    value.operations.every(
      (operation) =>
        isRecord(operation) &&
        operation.scope === "canvas" &&
        typeof operation.summary === "string" &&
        isStringArray(operation.targetIds),
    ) &&
    value.permissionRequired === "approval" &&
    value.risk === "low" &&
    isStringArray(value.targetIds) &&
    isStringArray(value.verificationPlan)
  );
}

export function isRuntimeCheckpoint(
  value: unknown,
): value is CanvasRuntimeCheckpoint {
  return (
    isRecord(value) &&
    Array.isArray(value.documentNodes) &&
    value.documentNodes.every(isWorkbenchNode) &&
    Number.isInteger(value.documentRevision) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.runId === "string" &&
    isStringArray(value.selectedNodeIds) &&
    Number.isInteger(value.traceSequence)
  );
}

export function isRuntimeSnapshot(
  value: unknown,
): value is CanvasRuntimeSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  const approvalValid =
    value.approval === null ||
    (isRecord(value.approval) &&
      value.approval.authority === "canvas-only" &&
      Number.isInteger(value.approval.baseRevision) &&
      typeof value.approval.id === "string" &&
      typeof value.approval.proposalDigest === "string" &&
      typeof value.approval.proposalId === "string" &&
      typeof value.approval.runId === "string" &&
      value.approval.usesRemaining === 1);
  const verificationValid =
    value.verification === null ||
    (isRecord(value.verification) &&
      Number.isInteger(value.verification.checkedRevision) &&
      typeof value.verification.documentDigest === "string" &&
      value.verification.filesChanged === 0 &&
      typeof value.verification.previewSessionId === "string" &&
      value.verification.scope === "deterministic-demo" &&
      value.verification.status === "passed" &&
      typeof value.verification.summary === "string");
  const durabilityValid =
    value.durability === undefined ||
    (isRecord(value.durability) &&
      (value.durability.reason === null ||
        typeof value.durability.reason === "string") &&
      ["durable", "memory-only", "volatile"].includes(
        String(value.durability.status),
      ));
  return (
    approvalValid &&
    (value.checkpoint === null || isRuntimeCheckpoint(value.checkpoint)) &&
    isSubmitRequest(value.envelope) &&
    Array.isArray(value.events) &&
    value.events.every(isRuntimeEvent) &&
    (value.proposal === null || isRuntimeProposal(value.proposal)) &&
    typeof value.runId === "string" &&
    typeof value.state === "string" &&
    RUNTIME_STATES.has(value.state as CanvasRuntimeState) &&
    typeof value.threadId === "string" &&
    durabilityValid &&
    verificationValid
  );
}

export function createLocalCanvasRuntimeStorage(
  storage: Pick<Storage, "getItem" | "setItem">,
  key = "memi-canvas-runtime-v1",
): CanvasRuntimeStorage {
  return {
    load() {
      const value = storage.getItem(key);
      return value === null ? null : JSON.parse(value);
    },
    save(value) {
      storage.setItem(key, JSON.stringify(value));
    },
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function deterministicCanvasDigest(value: unknown): string {
  const source = JSON.stringify(stableValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `demo-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function changedNodeCount(
  current: readonly WorkbenchNode[],
  checkpoint: readonly WorkbenchNode[],
): number {
  const currentById = new Map(current.map((node) => [node.id, node]));
  const checkpointById = new Map(
    checkpoint.map((node) => [node.id, node]),
  );
  return [...new Set([...currentById.keys(), ...checkpointById.keys()])]
    .filter(
      (id) =>
        deterministicCanvasDigest(currentById.get(id) ?? null) !==
        deterministicCanvasDigest(checkpointById.get(id) ?? null),
    )
    .length;
}

export function freezeClone<T>(value: T): T {
  return Object.freeze(structuredClone(value));
}

function sourcePaths(
  request: CanvasRuntimeSubmitRequest,
): readonly string[] {
  return [
    ...new Set(
      request.documentNodes
        .filter(({ id }) => request.selectedNodeIds.includes(id))
        .flatMap((node) =>
          node.source?.sourceAnchor === undefined
            ? node.component?.source.sourceAnchor === undefined
              ? []
              : [node.component.source.sourceAnchor]
            : [node.source.sourceAnchor],
        ),
    ),
  ];
}

function proposedDraft(
  request: CanvasRuntimeSubmitRequest,
  runId: string,
): readonly WorkbenchNode[] {
  const target = request.documentNodes.find(({ id }) =>
    request.selectedNodeIds.includes(id),
  );
  if (target === undefined) {
    return structuredClone(request.documentNodes);
  }
  const draft: WorkbenchNode = {
    fill: "var(--studio-accent-soft)",
    frameContent:
      "Deterministic Demo proposal · detached canvas draft · repository unchanged",
    hidden: false,
    id: `demo-draft-${runId}`,
    kind: "DraftFrame",
    locked: false,
    name: `${target.name} · Demo proposal`,
    parentId: null,
    position: {
      x: target.position.x + target.size.width + 80,
      y: target.position.y,
    },
    size: structuredClone(target.size),
  };
  return [...structuredClone(request.documentNodes), draft];
}

export function createProposal(
  request: CanvasRuntimeSubmitRequest,
  runId: string,
  revisionNote = "",
): CanvasRuntimeProposal {
  const revisionKey =
    revisionNote.length === 0
      ? "initial"
      : deterministicCanvasDigest(revisionNote);
  const id = `proposal-${runId}-${revisionKey}`;
  const operations: readonly CanvasRuntimeProposalOperation[] = [
    {
      scope: "canvas",
      summary:
        "Create a detached draft beside the selected source-backed target.",
      targetIds: request.selectedNodeIds,
    },
  ];
  const patch = createAgentPatch({
    actor: {
      harnessId: "deterministic-demo",
      kind: "agent",
      modelId: "zero-token-fixture",
    },
    baseRevision: request.documentRevision,
    id,
    operations: operations.map((operation) => ({
      kind: "create" as const,
      summary: operation.summary,
      targetIds: operation.targetIds,
    })),
    proposedNodes: proposedDraft(request, runId),
    targetIds: request.selectedNodeIds,
  });
  const digest = deterministicCanvasDigest({
    authority: "canvas-only",
    baseRevision: request.documentRevision,
    operations,
    patch,
    revisionNote,
    targetIds: request.selectedNodeIds,
  });
  return freezeClone({
    authority: "canvas-only",
    baseRevision: request.documentRevision,
    digest,
    filesChanged: 0,
    id,
    informationalSourcePaths: sourcePaths(request),
    operations,
    patch,
    permissionRequired: "approval",
    risk: "low",
    targetIds: request.selectedNodeIds,
    verificationPlan: [
      "Apply one immutable EditorCommand to the canvas draft only.",
      "Confirm the selected source-backed target remains unchanged.",
      "Record zero repository files changed.",
    ],
  });
}
