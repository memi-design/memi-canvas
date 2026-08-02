import {
  CaptureArtifactSchemaV2,
  CaptureFailureSchemaV1,
  CaptureScenarioIdSchema,
  CaptureScenarioSchemaV2,
  ImportApplicationSchemaV2,
  ImportJobIdSchema,
  ImportJobStageSchema,
  ProjectIdSchema,
  type CaptureScenarioV2,
  type ImportJobDraftV2,
  type ImportJobSnapshotV2,
  type SaveImportJobRequestV2,
} from "@memi/protocol";
import { z } from "zod";
import {
  deepFreeze,
  parseImportJobDraftV2,
  parseImportJobSnapshotV2,
} from "./contracts.js";
import { ImportTransitionError } from "./errors.js";
import { prepareFailedScenarioRetry } from "./retry.js";
const MAX_LOGS = 500;
const STAGES = ImportJobStageSchema.options;
export interface CreateImportJobDraftV2Input {
  readonly id: z.input<typeof ImportJobIdSchema>;
  readonly projectName: string;
  readonly repository: ImportJobDraftV2["repository"];
  readonly selectedHarness: ImportJobDraftV2["selectedHarness"];
  readonly pilotScope?: ImportJobDraftV2["pilotScope"];
  readonly applications: readonly z.input<typeof ImportApplicationSchemaV2>[];
  readonly scenarios: readonly z.input<typeof CaptureScenarioSchemaV2>[];
  readonly createdAt: string;
}
export interface DerivedImportProgressV2 {
  readonly determinate: boolean;
  readonly total: number;
  readonly captured: number;
  readonly failed: number;
  readonly remaining: number;
  readonly completionRatio: number;
}
export type ImportJobTransitionEventV2 =
  | { readonly type: "start"; readonly expectedRevision: number }
  | {
      readonly type: "advance-stage";
      readonly expectedRevision: number;
      readonly stage: ImportJobDraftV2["stage"];
    }
  | {
      readonly type: "scenario-started";
      readonly expectedRevision: number;
      readonly scenarioId: z.input<typeof CaptureScenarioIdSchema>;
    }
  | {
      readonly type: "scenario-captured";
      readonly expectedRevision: number;
      readonly artifact: z.input<typeof CaptureArtifactSchemaV2>;
    }
  | {
      readonly type: "scenario-failed";
      readonly expectedRevision: number;
      readonly failure: z.input<typeof CaptureFailureSchemaV1>;
    }
  | {
      readonly type: "append-log";
      readonly expectedRevision: number;
      readonly entry: ImportJobDraftV2["logs"][number];
    }
  | {
      readonly type: "cancel";
      readonly expectedRevision: number;
      readonly at: string;
    }
  | {
      readonly type: "discard";
      readonly expectedRevision: number;
      readonly at: string;
    }
  | { readonly type: "resume"; readonly expectedRevision: number }
  | {
      readonly type: "retry-failed";
      readonly expectedRevision: number;
      readonly scenarioIds?: readonly z.input<
        typeof CaptureScenarioIdSchema
      >[];
    }
  | {
      readonly type: "fail";
      readonly expectedRevision: number;
      readonly failure: z.input<typeof CaptureFailureSchemaV1>;
    }
  | {
      readonly type: "commit";
      readonly expectedRevision: number;
      readonly projectId: z.input<typeof ProjectIdSchema>;
    };
export type ImportJobTransitionV2 = SaveImportJobRequestV2;
export function createImportJobDraftV2(
  input: CreateImportJobDraftV2Input,
): ImportJobDraftV2 {
  return parseImportJobDraftV2({
    kind: "memi-import-job",
    id: input.id,
    projectId: null,
    projectName: input.projectName,
    state: "queued",
    stage: "validate",
    repository: input.repository,
    managedWorktreeId: null,
    selectedHarness: input.selectedHarness,
    pilotScope: input.pilotScope ?? null,
    applications: input.applications,
    scenarios: input.scenarios,
    artifacts: [],
    failures: [],
    progress: {
      total: input.scenarios.length,
      captured: 0,
      failed: 0,
      remaining: input.scenarios.length,
    },
    currentApplicationId: null,
    currentScenarioId: null,
    checkpoints: [],
    logs: [],
    cancellationRequestedAt: null,
    createdAt: input.createdAt,
  });
}
export function deriveImportProgressV2(
  job: Pick<
    ImportJobDraftV2,
    "artifacts" | "failures" | "scenarios"
  >,
): DerivedImportProgressV2 {
  const captured = new Set(
    job.artifacts.map((artifact) => artifact.scenarioId),
  ).size;
  const failed = new Set(
    job.failures.flatMap((failure) =>
      failure.scenarioId === null ? [] : [failure.scenarioId],
    ),
  ).size;
  const total = job.scenarios.length;
  const remaining = Math.max(0, total - captured - failed);
  return deepFreeze({
    determinate: total > 0,
    total,
    captured,
    failed,
    remaining,
    completionRatio: total === 0 ? 0 : (captured + failed) / total,
  });
}
export function isImportJobTerminal(
  job: Pick<ImportJobDraftV2, "state">,
): boolean {
  return ["ready-to-commit", "committed", "failed", "cancelled"].includes(
    job.state,
  );
}
function assertRevision(
  snapshot: ImportJobSnapshotV2,
  expectedRevision: number,
): void {
  if (snapshot.revision !== expectedRevision) {
    throw new ImportTransitionError(
      `Stale revision: expected ${expectedRevision}, current ${snapshot.revision}.`,
    );
  }
}
function assertState(
  job: ImportJobDraftV2,
  allowed: readonly ImportJobDraftV2["state"][],
  action: string,
): void {
  if (!allowed.includes(job.state)) {
    throw new ImportTransitionError(
      `Cannot ${action} an import in ${job.state} state.`,
    );
  }
}
function progressFields(
  job: Pick<ImportJobDraftV2, "artifacts" | "failures" | "scenarios">,
): ImportJobDraftV2["progress"] {
  const progress = deriveImportProgressV2(job);
  return {
    total: progress.total,
    captured: progress.captured,
    failed: progress.failed,
    remaining: progress.remaining,
  };
}
function withProgress(job: ImportJobDraftV2): ImportJobDraftV2 {
  const progress = progressFields(job);
  return { ...job, progress };
}
function assertKnownScenario(
  job: ImportJobDraftV2,
  scenarioId: CaptureScenarioV2["id"],
): CaptureScenarioV2 {
  const scenario = job.scenarios.find((item) => item.id === scenarioId);
  if (scenario === undefined) {
    throw new ImportTransitionError(`Unknown capture scenario ${scenarioId}.`);
  }
  return scenario;
}
function assertUnresolved(
  job: ImportJobDraftV2,
  scenarioId: CaptureScenarioV2["id"],
): void {
  if (
    job.artifacts.some((item) => item.scenarioId === scenarioId) ||
    job.failures.some((item) => item.scenarioId === scenarioId)
  ) {
    throw new ImportTransitionError(
      `Capture scenario ${scenarioId} already has terminal evidence.`,
    );
  }
}
function assertMatchesCurrentScenario(
  job: ImportJobDraftV2,
  scenarioId: CaptureScenarioV2["id"],
): void {
  if (job.currentScenarioId === null) {
    throw new ImportTransitionError(
      `Scenario ${scenarioId} cannot finish because there is no active scenario.`,
    );
  }
  if (
    job.currentScenarioId !== scenarioId
  ) {
    throw new ImportTransitionError(
      `Scenario ${scenarioId} does not match active scenario ${job.currentScenarioId}.`,
    );
  }
}
function transition(
  job: ImportJobDraftV2,
  event: ImportJobTransitionEventV2,
): ImportJobDraftV2 {
  switch (event.type) {
    case "start":
      assertState(job, ["queued"], "start");
      return { ...job, state: "running" };
    case "advance-stage": {
      assertState(job, ["running"], "advance");
      const current = STAGES.indexOf(job.stage);
      const next = STAGES.indexOf(event.stage);
      if (next <= current) {
        throw new ImportTransitionError("Import stages cannot move backward.");
      }
      if (next !== current + 1) {
        throw new ImportTransitionError("Import stages cannot be skipped.");
      }
      const progress = progressFields(job);
      if (
        event.stage === "save" &&
        (progress.total === 0 || progress.remaining !== 0)
      ) {
        throw new ImportTransitionError(
          "The save stage requires terminal evidence for every scenario.",
        );
      }
      return {
        ...job,
        stage: event.stage,
        state:
          event.stage === "save"
            ? progress.captured === 0
              ? "failed"
              : "ready-to-commit"
            : job.state,
        checkpoints: [...job.checkpoints, job.stage],
      };
    }
    case "scenario-started": {
      assertState(job, ["running"], "start a scenario for");
      const scenarioId = CaptureScenarioIdSchema.parse(event.scenarioId);
      const scenario = assertKnownScenario(job, scenarioId);
      assertUnresolved(job, scenarioId);
      if (job.currentScenarioId !== null) {
        throw new ImportTransitionError(
          `Capture scenario ${job.currentScenarioId} is already active.`,
        );
      }
      return {
        ...job,
        currentApplicationId: scenario.applicationId,
        currentScenarioId: scenario.id,
      };
    }
    case "scenario-captured": {
      assertState(job, ["running"], "capture a scenario for");
      const artifact = CaptureArtifactSchemaV2.parse(event.artifact);
      assertKnownScenario(job, artifact.scenarioId);
      assertUnresolved(job, artifact.scenarioId);
      assertMatchesCurrentScenario(job, artifact.scenarioId);
      return withProgress({
        ...job,
        artifacts: [...job.artifacts, artifact],
        currentApplicationId: null,
        currentScenarioId: null,
      });
    }
    case "scenario-failed": {
      assertState(job, ["running"], "fail a scenario for");
      const failure = CaptureFailureSchemaV1.parse(event.failure);
      if (failure.scenarioId === null) {
        throw new ImportTransitionError(
          "Scenario failures must identify their scenario.",
        );
      }
      assertKnownScenario(job, failure.scenarioId);
      assertUnresolved(job, failure.scenarioId);
      assertMatchesCurrentScenario(job, failure.scenarioId);
      return withProgress({
        ...job,
        failures: [...job.failures, failure],
        currentApplicationId: null,
        currentScenarioId: null,
      });
    }
    case "append-log":
      return {
        ...job,
        logs: [...job.logs, event.entry].slice(-MAX_LOGS),
      };
    case "cancel":
      assertState(job, ["queued", "running"], "cancel");
      return {
        ...job,
        state: "paused",
        cancellationRequestedAt: event.at,
        currentApplicationId: null,
        currentScenarioId: null,
      };
    case "discard":
      // A discarded import has no project binding. Terminal drafts may be
      // reclaimed safely, but a committed project is intentionally excluded.
      assertState(
        job,
        ["queued", "running", "paused", "ready-to-commit", "failed"],
        "discard",
      );
      return {
        ...job,
        state: "cancelled",
        cancellationRequestedAt: event.at,
        currentApplicationId: null,
        currentScenarioId: null,
      };
    case "resume":
      assertState(job, ["paused"], "resume");
      return {
        ...job,
        state: "running",
        cancellationRequestedAt: null,
      };
    case "retry-failed": {
      assertState(job, ["ready-to-commit", "failed"], "retry");
      const retry = prepareFailedScenarioRetry(job, event.scenarioIds);
      const next = {
        ...job,
        state: "running" as const,
        stage: retry.stage,
        failures: retry.failures,
        currentApplicationId: null,
        currentScenarioId: null,
      };
      return {
        ...next,
        checkpoints: retry.checkpoints,
        progress: progressFields(next),
      };
    }
    case "fail": {
      const failure = CaptureFailureSchemaV1.parse(event.failure);
      assertState(job, ["queued", "running", "paused"], "fail");
      if (failure.scenarioId !== null) {
        throw new ImportTransitionError(
          "Job-level failures cannot identify a capture scenario.",
        );
      }
      return {
        ...job,
        state: "failed",
        failures: [...job.failures, failure],
        currentApplicationId: null,
        currentScenarioId: null,
      };
    }
    case "commit":
      assertState(job, ["ready-to-commit"], "commit");
      if (progressFields(job).captured === 0) {
        throw new ImportTransitionError(
          "An import requires at least one verified capture before commit.",
        );
      }
      return {
        ...job,
        projectId: ProjectIdSchema.parse(event.projectId),
        state: "committed",
        stage: "save",
      };
  }
}
export function transitionImportJobV2(
  input: ImportJobSnapshotV2,
  event: ImportJobTransitionEventV2,
): ImportJobTransitionV2 {
  const snapshot = parseImportJobSnapshotV2(input);
  assertRevision(snapshot, event.expectedRevision);
  const { revision, updatedAt, ...draftInput } = snapshot;
  void updatedAt;
  const current = parseImportJobDraftV2(draftInput);
  const job = parseImportJobDraftV2(transition(current, event));
  return deepFreeze({
    expectedRevision: revision,
    job,
  });
}
