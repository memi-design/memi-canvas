import {
  type RuntimeCaptureScreenV1,
  type CaptureArtifactV2,
  type ImportJobSnapshotV2,
} from "@memi/protocol";
import { canonicalJson } from "@memi/canonical-json";

import type { RuntimeClientV1 } from "../../runtime/runtime-client.js";
import type { CaptureArtifactReference } from "./repository-capture-workbench.js";
import type {
  RepositoryCaptureCommit,
  RepositoryCaptureMaterialization,
  RepositoryCaptureRuntime,
  RepositoryCaptureStartInput,
} from "./repository-capture-runtime.js";
import {
  repositoryCaptureMaterializationState,
  repositoryCaptureProjectId,
} from "./repository-capture-runtime.js";
import {
  parseRepositoryReconstructionArtifact,
  type ParsedRepositoryReconstructionArtifact,
} from "./repository-reconstruction-review.js";

const DEFAULT_POLL_INTERVAL_MS = 250;

export interface RuntimeClientCaptureRuntimeOptions {
  readonly artifactUrl?: (
    artifactId: CaptureArtifactV2["screenshotArtifactId"],
  ) => string;
  readonly client: RuntimeClientV1;
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly loadReconstructionArtifact?: (
    artifactId: NonNullable<CaptureArtifactV2["reconstructionArtifactId"]>,
  ) => Promise<unknown>;
  readonly pollIntervalMs?: number;
  readonly revealLogs?: (job: ImportJobSnapshotV2) => Promise<void>;
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

function sourceIdentity(
  job: ImportJobSnapshotV2,
  artifact: CaptureArtifactV2,
): string {
  const scenario = job.scenarios.find(({ id }) => id === artifact.scenarioId);
  const relativePath =
    scenario?.sourceAnchor?.relativePath ??
    `capture-scenarios/${artifact.scenarioId}`;
  return `memi-source://repository/${relativePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function referenceFor(
  job: ImportJobSnapshotV2,
  artifact: CaptureArtifactV2,
  artifactUrl?: RuntimeClientCaptureRuntimeOptions["artifactUrl"],
  reconstructionArtifact?: ParsedRepositoryReconstructionArtifact,
): CaptureArtifactReference {
  const scenario = job.scenarios.find(({ id }) => id === artifact.scenarioId);
  const reference: CaptureArtifactReference = {
    alt:
      scenario === undefined
        ? "Verified runtime capture"
        : `${scenario.route} · ${scenario.state}`,
    capturedAt: artifact.verification.verifiedAt,
    sourceUrl: sourceIdentity(job, artifact),
    src:
      artifactUrl?.(artifact.screenshotArtifactId) ??
      `/imports/artifacts/${artifact.screenshotArtifactId}.png`,
    ...(reconstructionArtifact === undefined
      ? {}
      : {
          reconstruction: reconstructionArtifact.capture,
          ...(reconstructionArtifact.review === null
            ? {}
            : { reconstructionReview: reconstructionArtifact.review }),
        }),
  };
  return Object.freeze(reference);
}

function assertReconstructionAuthority(
  job: ImportJobSnapshotV2,
  artifact: CaptureArtifactV2,
  capture: RuntimeCaptureScreenV1,
): void {
  const scenario = job.scenarios.find(
    ({ id }) => id === artifact.scenarioId,
  );
  if (scenario === undefined) {
    throw new Error(
      "Semantic reconstruction scenario is missing from the import job.",
    );
  }
  if (
    capture.captureId !== artifact.id ||
    capture.artifact.artifactId !== artifact.screenshotArtifactId ||
    capture.artifact.hash !== artifact.screenshotHash ||
    capture.artifact.width !== artifact.dimensions.width ||
    capture.artifact.height !== artifact.dimensions.height
  ) {
    throw new Error(
      "Semantic reconstruction does not match its runtime screenshot evidence.",
    );
  }
  if (
    capture.repository.rootPath !== job.repository.rootPath ||
    capture.repository.revision !== artifact.sourceRevision ||
    capture.repository.revision !== job.repository.sourceRevision ||
    capture.binding.routeId !== scenario.route ||
    capture.binding.stateId !== scenario.state
  ) {
    throw new Error(
      "Semantic reconstruction does not match the repository scenario authority.",
    );
  }
}

function terminalError(job: ImportJobSnapshotV2): Error {
  const failure = job.failures.at(-1);
  if (failure !== undefined) {
    return new Error(
      `${failure.code}: ${failure.message} ${failure.remediation}`,
    );
  }
  return new Error(
    `Import stopped in ${job.state} state before every scenario was terminal.`,
  );
}

export function createRuntimeClientCaptureRuntime(
  options: RuntimeClientCaptureRuntimeOptions,
): RepositoryCaptureRuntime {
  const delay = options.delay ?? defaultDelay;
  const pollInterval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  async function awaitCommit(
    input: RepositoryCaptureStartInput,
    initial: ImportJobSnapshotV2,
  ): Promise<RepositoryCaptureCommit> {
    let job = initial;
    let lastRevision = -1;
    let lastSnapshot = "";
    const materializedArtifactIds = new Set<string>();
    const reconstructions = new Map<
      CaptureArtifactV2["id"],
      ParsedRepositoryReconstructionArtifact
    >();
    const publish = async (next: ImportJobSnapshotV2): Promise<void> => {
      if (
        next.id !== initial.id ||
        next.projectName !== initial.projectName ||
        canonicalJson(next.repository) !== canonicalJson(initial.repository)
      ) {
        throw new Error("Import runtime changed job authority during polling.");
      }
      if (next.revision < lastRevision) {
        throw new Error(
          `Import runtime returned older job revision ${next.revision} after ${lastRevision}.`,
        );
      }
      const serialized = canonicalJson(next);
      if (next.revision === lastRevision) {
        if (serialized !== lastSnapshot) {
          throw new Error(
            "Import runtime returned divergent data at the same revision.",
          );
        }
        return;
      }
      const pendingArtifacts = next.artifacts.filter(
        ({ id }) => !materializedArtifactIds.has(id),
      );
      await Promise.all(
        pendingArtifacts.map(async (artifact) => {
          if (
            artifact.reconstructionArtifactId !== null &&
            options.loadReconstructionArtifact !== undefined &&
            !reconstructions.has(artifact.id)
          ) {
            const reconstruction = parseRepositoryReconstructionArtifact(
              await options.loadReconstructionArtifact(
                artifact.reconstructionArtifactId,
              ),
            );
            assertReconstructionAuthority(
              next,
              artifact,
              reconstruction.capture,
            );
            reconstructions.set(artifact.id, reconstruction);
          }
        }),
      );
      const addedArtifacts = pendingArtifacts.map((artifact) =>
        Object.freeze({
          artifact,
          reference: referenceFor(
            next,
            artifact,
            options.artifactUrl,
            reconstructions.get(artifact.id),
          ),
        }),
      );
      lastRevision = next.revision;
      lastSnapshot = serialized;
      input.onUpdate(next);
      next.artifacts.forEach(({ id }) => materializedArtifactIds.add(id));
      const materialization: RepositoryCaptureMaterialization = Object.freeze({
        addedArtifacts: Object.freeze(addedArtifacts),
        job: next,
        projectId: repositoryCaptureProjectId(next),
        sequence: next.revision,
        state: repositoryCaptureMaterializationState(next),
      });
      input.onMaterialize?.(materialization);
    };
    await publish(job);
    while (job.state === "queued" || job.state === "running") {
      await delay(pollInterval);
      job = (await options.client.imports.get({ jobId: job.id })).job;
      await publish(job);
    }
    if (job.state !== "ready-to-commit") {
      throw terminalError(job);
    }
    job = (
      await options.client.imports.commit({
        expectedRevision: job.revision,
        jobId: job.id,
      })
    ).job;
    await publish(job);
    return Object.freeze({
      artifactReference: (artifact: CaptureArtifactV2) =>
        referenceFor(
          job,
          artifact,
          options.artifactUrl,
          reconstructions.get(artifact.id),
        ),
      job,
      projectId: repositoryCaptureProjectId(job),
    });
  }

  const runtime: RepositoryCaptureRuntime = {
    async plan(rootPath, planOptions) {
      return (
        await options.client.imports.plan({
          repositoryPath: rootPath,
          ...(planOptions?.expoRuntime === undefined
            ? {}
            : { expoRuntime: planOptions.expoRuntime }),
        })
      ).plan;
    },
    async start(input) {
      const started = await options.client.imports.start({
        approvedRecipeHashes: [...input.approvedRecipeHashes],
        ...(input.pilotScenarioIds === undefined
          ? {}
          : { pilotScenarioIds: [...input.pilotScenarioIds] }),
        planToken: input.planToken,
        projectName: input.projectName,
        repositoryPath: input.manifest.rootPath,
        selectedHarness: null,
      });
      return awaitCommit(input, started.job);
    },
    async cancel(job) {
      return (
        await options.client.imports.cancel({
          expectedRevision: job.revision,
          jobId: job.id,
        })
      ).job;
    },
    async resume(job) {
      return (
        await options.client.imports.resume({
          expectedRevision: job.revision,
          jobId: job.id,
        })
      ).job;
    },
    async retryFailed(job) {
      return (
        await options.client.imports.retryFailed({
          expectedRevision: job.revision,
          jobId: job.id,
        })
      ).job;
    },
    async revealLogs(job) {
      if (options.revealLogs === undefined) {
        throw new Error("Native import log reveal is unavailable.");
      }
      await options.revealLogs(job);
    },
  };
  return Object.freeze(runtime);
}
