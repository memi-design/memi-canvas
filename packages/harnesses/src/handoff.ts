import { immutableCopy } from "./immutable.js";
import type {
  HandoffInput,
  HandoffPacket,
} from "./types.js";

export function createHandoffPacket(
  input: HandoffInput,
): HandoffPacket {
  const knownCriterionIds = new Set(
    input.task.acceptanceCriteria.map((criterion) => criterion.id),
  );

  for (const criterionId of input.remainingCriterionIds) {
    if (!knownCriterionIds.has(criterionId)) {
      throw new Error(
        `Unknown remaining acceptance criterion "${criterionId}".`,
      );
    }
  }

  if (
    !Number.isFinite(input.remainingTokenBudget) ||
    input.remainingTokenBudget < 0 ||
    input.remainingTokenBudget > input.task.tokenBudget
  ) {
    throw new Error(
      `Remaining token budget must be between 0 and ${input.task.tokenBudget}.`,
    );
  }

  const originalPermissions = new Set(
    input.task.permissionCeiling,
  );

  for (const permission of input.permissionCeiling) {
    if (!originalPermissions.has(permission)) {
      throw new Error(
        `Handoff permission "${permission}" exceeds the original task ceiling.`,
      );
    }
  }

  const remainingIds = new Set(input.remainingCriterionIds);
  const remainingCriteria = input.task.acceptanceCriteria.filter(
    (criterion) => remainingIds.has(criterion.id),
  );

  return immutableCopy({
    schemaVersion: 1,
    taskId: input.task.taskId,
    goal: input.task.goal,
    fromRunId: input.fromRunId,
    fromHarnessId: input.fromHarnessId,
    toHarnessId: input.toHarnessId,
    checkpointId: input.checkpointId,
    traceCursor: input.traceCursor,
    acceptedDecisions: input.acceptedDecisions,
    completedArtifactRefs: input.completedArtifactRefs,
    remainingCriteria,
    currentSelectionRefs: input.currentSelectionRefs,
    evidenceRefs: input.task.evidenceRefs,
    constraints: input.task.constraints,
    permissionCeiling: input.permissionCeiling,
    remainingTokenBudget: input.remainingTokenBudget,
  });
}
