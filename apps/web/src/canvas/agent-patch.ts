import type { CommandTrace } from "./command-bus.js";
import type {
  SelectionState,
  WorkbenchNode,
} from "./model.js";
import type { SceneCommandAdapter } from "./scene-command-adapter.js";

export interface AgentPatchActor {
  readonly kind: "agent";
  readonly harnessId: string;
  readonly modelId: string;
}

export type AgentPatchOperationKind =
  | "create"
  | "update"
  | "delete"
  | "reorder"
  | "reparent"
  | "style";

export interface AgentPatchOperation {
  readonly kind: AgentPatchOperationKind;
  readonly summary: string;
  readonly targetIds: readonly string[];
}

export interface AgentPatch {
  readonly id: string;
  readonly actor: AgentPatchActor;
  readonly baseRevision: number;
  readonly targetIds: readonly string[];
  readonly proposedNodes: readonly WorkbenchNode[];
  readonly operations: readonly AgentPatchOperation[];
}

export type AgentPatchReviewStatus =
  | "pending"
  | "applying"
  | "conflict"
  | "applied"
  | "rejected"
  | "failed";

export interface AgentPatchReview {
  readonly patch: AgentPatch;
  readonly currentRevision: number;
  readonly status: AgentPatchReviewStatus;
  readonly message: string;
}

export interface AgentPatchApplication {
  readonly review: AgentPatchReview;
  readonly trace: CommandTrace | null;
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
}

function validateAgentPatch(input: AgentPatch): void {
  assertNonEmpty(input.id, "Agent patch id");
  assertNonEmpty(input.actor.harnessId, "Agent patch harness");
  assertNonEmpty(input.actor.modelId, "Agent patch model");
  if (
    !Number.isInteger(input.baseRevision) ||
    input.baseRevision < 0
  ) {
    throw new Error("Agent patch base revision must be a non-negative integer.");
  }
  assertUnique(input.targetIds, "Agent patch target ids");
  assertUnique(
    input.proposedNodes.map(({ id }) => id),
    "Agent patch proposed node ids",
  );
  input.operations.forEach((operation, index) => {
    assertNonEmpty(
      operation.summary,
      `Agent patch operation ${index + 1} summary`,
    );
    assertUnique(
      operation.targetIds,
      `Agent patch operation ${index + 1} target ids`,
    );
  });
}

function deepFreeze<T>(value: T): T {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export function createAgentPatch(input: AgentPatch): AgentPatch {
  validateAgentPatch(input);
  return deepFreeze(structuredClone(input));
}

function reviewMessage(
  patch: AgentPatch,
  currentRevision: number,
  status: AgentPatchReviewStatus,
  failure?: string,
): string {
  switch (status) {
    case "pending":
      return `Ready to apply at revision ${currentRevision}.`;
    case "applying":
      return `Applying against revision ${currentRevision}.`;
    case "conflict":
      return `Conflict: patch revision ${patch.baseRevision} does not match document revision ${currentRevision}.`;
    case "applied":
      return `Applied at revision ${currentRevision}.`;
    case "rejected":
      return "Rejected without changing the document.";
    case "failed":
      return `Failed without changing the document: ${failure ?? "Unknown error"}`;
  }
}

export function createAgentPatchReview(
  patch: AgentPatch,
  currentRevision: number,
): AgentPatchReview {
  const status =
    patch.baseRevision === currentRevision ? "pending" : "conflict";
  return Object.freeze({
    patch,
    currentRevision,
    status,
    message: reviewMessage(patch, currentRevision, status),
  });
}

export function rejectAgentPatch(
  review: AgentPatchReview,
): AgentPatchReview {
  return Object.freeze({
    ...review,
    status: "rejected",
    message: reviewMessage(
      review.patch,
      review.currentRevision,
      "rejected",
    ),
  });
}

export function applyAgentPatch(
  review: AgentPatchReview,
  adapter: SceneCommandAdapter,
  selection: SelectionState,
): AgentPatchApplication {
  if (
    review.status === "applying" ||
    review.status === "applied" ||
    review.status === "rejected"
  ) {
    return { review, trace: null };
  }

  const currentRevision = adapter.getBus().getSnapshot().document.revision;
  if (review.patch.baseRevision !== currentRevision) {
    return {
      review: createAgentPatchReview(review.patch, currentRevision),
      trace: null,
    };
  }

  try {
    const trace = adapter.dispatch({
      actor: "agent",
      id: review.patch.id,
      label: `Apply agent patch ${review.patch.id}`,
      nodes: review.patch.proposedNodes,
      selection,
      targetIds: review.patch.targetIds,
    });
    const appliedRevision =
      adapter.getBus().getSnapshot().document.revision;
    return {
      review: Object.freeze({
        patch: review.patch,
        currentRevision: appliedRevision,
        status: "applied",
        message: reviewMessage(
          review.patch,
          appliedRevision,
          "applied",
        ),
      }),
      trace,
    };
  } catch (error) {
    const failure =
      error instanceof Error ? error.message : String(error);
    return {
      review: Object.freeze({
        patch: review.patch,
        currentRevision,
        status: "failed",
        message: reviewMessage(
          review.patch,
          currentRevision,
          "failed",
          failure,
        ),
      }),
      trace: null,
    };
  }
}
