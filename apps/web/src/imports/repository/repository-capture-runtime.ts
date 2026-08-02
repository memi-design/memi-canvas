import type {
  CaptureArtifactV2,
  ImportPlanResultV1,
  ImportJobSnapshotV2,
} from "@memi/protocol";
import { projectIdForImportJob } from "@memi/protocol";

import type { CaptureArtifactReference } from "./repository-capture-workbench.js";
import type { RepositoryImportManifest } from "./repository-import.js";
import type {
  RepositoryImportFailureView,
  RepositoryImportJobView,
} from "./RepositoryImportWorkspace.js";

export interface RepositoryCaptureCommit {
  readonly artifactReference: (
    artifact: CaptureArtifactV2,
  ) => CaptureArtifactReference;
  readonly job: ImportJobSnapshotV2;
  readonly projectId: string;
}

export type RepositoryCaptureMaterializationState =
  "importing" | "ready" | "needs-attention" | "cancelled";

export interface RepositoryCaptureArtifactMaterialization {
  readonly artifact: CaptureArtifactV2;
  readonly reference: CaptureArtifactReference;
}

/** Explicit, user-selected runtime preference for Expo capture planning. */
export interface RepositoryCapturePlanOptions {
  readonly expoRuntime?: "existing-development-client";
}

/**
 * Incremental, revision-ordered view of a durable import job. The application
 * shell can expose the stable project identity as soon as inventory finishes,
 * then append only the newly verified artifacts from each later revision.
 */
export interface RepositoryCaptureMaterialization {
  readonly addedArtifacts: readonly RepositoryCaptureArtifactMaterialization[];
  readonly job: ImportJobSnapshotV2;
  readonly projectId: string;
  readonly sequence: number;
  readonly state: RepositoryCaptureMaterializationState;
}

export interface RepositoryCaptureStartInput {
  readonly approvedRecipeHashes: readonly `sha256:${string}`[];
  readonly manifest: RepositoryImportManifest;
  readonly onMaterialize?: (update: RepositoryCaptureMaterialization) => void;
  /**
   * An explicit, plan-bound pilot subset. Omission intentionally preserves a
   * full-plan import; this adapter never invents a narrower scope.
   */
  readonly pilotScenarioIds?: readonly ImportPlanResultV1["plan"]["scenarios"][number]["id"][];
  readonly planToken: ImportPlanResultV1["plan"]["token"];
  readonly projectName: string;
  readonly onUpdate: (job: ImportJobSnapshotV2) => void;
}

export function repositoryCaptureProjectId(job: ImportJobSnapshotV2): string {
  const durableProjectId = projectIdForImportJob(job.id);
  if (job.projectId !== null && job.projectId !== durableProjectId) {
    throw new Error(
      "Committed project identity does not match the durable import identity.",
    );
  }
  return job.projectId ?? durableProjectId;
}

export function repositoryCaptureMaterializationState(
  job: ImportJobSnapshotV2,
): RepositoryCaptureMaterializationState {
  if (job.state === "cancelled") return "cancelled";
  if (
    job.state === "failed" ||
    (job.failures.length > 0 &&
      (job.state === "committed" || job.progress.remaining === 0))
  ) {
    return "needs-attention";
  }
  return job.state === "committed" ? "ready" : "importing";
}

export interface RepositoryCaptureRuntime {
  plan(
    rootPath: string,
    options?: RepositoryCapturePlanOptions,
  ): Promise<ImportPlanResultV1["plan"]>;
  start(input: RepositoryCaptureStartInput): Promise<RepositoryCaptureCommit>;
  cancel(job: ImportJobSnapshotV2): Promise<ImportJobSnapshotV2>;
  resume(job: ImportJobSnapshotV2): Promise<ImportJobSnapshotV2>;
  retryFailed(job: ImportJobSnapshotV2): Promise<ImportJobSnapshotV2>;
  revealLogs(job: ImportJobSnapshotV2): Promise<void>;
}

function failureView(
  job: ImportJobSnapshotV2,
): readonly RepositoryImportFailureView[] {
  const scenarioById = new Map(
    job.scenarios.map((scenario) => [scenario.id, scenario]),
  );
  return job.failures.map((failure, index) => {
    const scenario =
      failure.scenarioId === null
        ? undefined
        : scenarioById.get(failure.scenarioId);
    return {
      code: failure.code,
      id: `${failure.scenarioId ?? `job-${index}`}:${failure.code}`,
      message: failure.message,
      remediation: failure.remediation,
      retryable: failure.retryable,
      route: scenario?.route ?? "Repository",
      ...(scenario === undefined
        ? {}
        : {
            state: scenario.state,
            ...(scenario.sourceAnchor === null
              ? {}
              : {
                  sourcePath: scenario.sourceAnchor.relativePath,
                }),
          }),
    };
  });
}

export function repositoryImportJobView(
  job: ImportJobSnapshotV2,
  currentTime = Date.now(),
): RepositoryImportJobView {
  const application = job.applications.find(
    ({ id }) => id === job.currentApplicationId,
  );
  const scenario = job.scenarios.find(({ id }) => id === job.currentScenarioId);
  return {
    ...(job.logs.at(-1) === undefined
      ? {}
      : { activity: job.logs.at(-1)!.message }),
    ...(application === undefined
      ? {}
      : { currentApplication: application.label }),
    ...(scenario === undefined
      ? {}
      : {
          currentScenario: `${scenario.route} · ${scenario.state}`,
        }),
    elapsedMs: Math.max(0, currentTime - Date.parse(job.createdAt)),
    failures: failureView(job),
    id: job.id,
    progress: job.progress,
    stage: job.stage,
    state: job.state,
  };
}
