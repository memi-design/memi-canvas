import {
  CaptureScenarioIdSchema,
  ImportJobStageSchema,
  type ImportJobDraftV2,
} from "@memi/protocol";

import { ImportTransitionError } from "./errors.js";

const STAGES = ImportJobStageSchema.options;

export function prepareFailedScenarioRetry(
  job: ImportJobDraftV2,
  requestedIds: readonly string[] | undefined,
): Pick<ImportJobDraftV2, "checkpoints" | "failures" | "stage"> {
  const retryableJobFailures = job.failures.filter(
    (failure) =>
      failure.scenarioId === null && failure.retryable,
  );
  if (requestedIds === undefined && retryableJobFailures.length > 0) {
    const stage = retryableJobFailures.reduce(
      (earliest, failure) =>
        STAGES.indexOf(failure.stage) < STAGES.indexOf(earliest)
          ? failure.stage
          : earliest,
      job.stage,
    );
    return {
      stage,
      failures: job.failures.filter(
        (failure) => failure.scenarioId !== null,
      ),
      checkpoints: job.checkpoints.filter(
        (checkpoint) =>
          STAGES.indexOf(checkpoint) < STAGES.indexOf(stage),
      ),
    };
  }
  const selectedIds = new Set(
    (requestedIds ??
      job.failures.flatMap((failure) =>
        failure.retryable && failure.scenarioId !== null
          ? [failure.scenarioId]
          : [],
      )).map((scenarioId) => CaptureScenarioIdSchema.parse(scenarioId)),
  );
  if (selectedIds.size === 0) {
    throw new ImportTransitionError("No retryable scenarios selected.");
  }
  for (const scenarioId of selectedIds) {
    const failure = job.failures.find(
      (item) => item.scenarioId === scenarioId,
    );
    if (failure === undefined || !failure.retryable) {
      throw new ImportTransitionError(
        `Scenario ${scenarioId} is not retryable.`,
      );
    }
  }
  const stage = STAGES.reduce(
    (earliest, candidate) =>
      job.failures.some(
        (failure) =>
          failure.scenarioId !== null &&
          selectedIds.has(failure.scenarioId) &&
          failure.stage === candidate,
      ) &&
      STAGES.indexOf(candidate) < STAGES.indexOf(earliest)
        ? candidate
        : earliest,
    job.stage,
  );
  return {
    stage,
    failures: job.failures.filter(
      (failure) =>
        failure.scenarioId === null ||
        !selectedIds.has(failure.scenarioId),
    ),
    checkpoints: job.checkpoints.filter(
      (checkpoint) =>
        STAGES.indexOf(checkpoint) < STAGES.indexOf(stage),
    ),
  };
}
