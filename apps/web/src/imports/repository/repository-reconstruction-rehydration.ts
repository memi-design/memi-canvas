import type {
  CaptureArtifactV2,
  ImportJobSnapshotV2,
  RuntimeCaptureScreenV1,
} from "@memi/protocol";

import type { RepositoryProjectRecord } from "./repository-project-persistence.js";
import {
  parseRepositoryReconstructionArtifact,
  type ParsedRepositoryReconstructionArtifact,
} from "./repository-reconstruction-review.js";

export type RepositoryReconstructionArtifactLoader = (
  artifactId: NonNullable<CaptureArtifactV2["reconstructionArtifactId"]>,
) => Promise<unknown>;

function assertReconstructionAuthority(
  job: ImportJobSnapshotV2,
  artifact: CaptureArtifactV2,
  capture: RuntimeCaptureScreenV1,
): void {
  const scenario = job.scenarios.find(({ id }) => id === artifact.scenarioId);
  if (scenario === undefined) {
    throw new Error("Reconstruction scenario authority is missing.");
  }
  if (
    capture.captureId !== artifact.id ||
    capture.artifact.artifactId !== artifact.screenshotArtifactId ||
    capture.artifact.hash !== artifact.screenshotHash ||
    capture.artifact.width !== artifact.dimensions.width ||
    capture.artifact.height !== artifact.dimensions.height
  ) {
    throw new Error(
      "Reconstruction does not match its runtime screenshot authority.",
    );
  }
  if (
    capture.repository.rootPath !== job.repository.rootPath ||
    capture.repository.revision !== job.repository.sourceRevision ||
    capture.repository.revision !== artifact.sourceRevision ||
    capture.binding.routeId !== scenario.route ||
    capture.binding.stateId !== scenario.state
  ) {
    throw new Error(
      "Reconstruction does not match its repository scenario authority.",
    );
  }
  const scenarioSource = scenario.sourceAnchor;
  const sourceAnchorMatches =
    scenarioSource === null ||
    (capture.binding.sourceContentHash === scenarioSource.contentHash &&
      (capture.binding.sourceAnchor === scenarioSource.relativePath ||
        capture.binding.sourceAnchor.startsWith(
          `${scenarioSource.relativePath}#`,
        )));
  const captureScale = capture.binding.viewport.scale ?? 1;
  const expectedCaptureViewportName =
    scenario.viewport.name === "ios-mobile"
      ? "mobile"
      : scenario.viewport.name;
  if (
    artifact.dimensions.width !== scenario.viewport.width * scenario.viewport.scale ||
    artifact.dimensions.height !== scenario.viewport.height * scenario.viewport.scale ||
    artifact.dimensions.scale !== scenario.viewport.scale ||
    capture.binding.viewport.width !== scenario.viewport.width ||
    capture.binding.viewport.height !== scenario.viewport.height ||
    capture.binding.viewport.name !== expectedCaptureViewportName ||
    captureScale !== scenario.viewport.scale ||
    !sourceAnchorMatches
  ) {
    throw new Error(
      "Reconstruction does not match its repository scenario authority.",
    );
  }
}

async function loadArtifact(
  job: ImportJobSnapshotV2,
  artifact: CaptureArtifactV2,
  loader: RepositoryReconstructionArtifactLoader,
): Promise<ParsedRepositoryReconstructionArtifact | null> {
  if (artifact.reconstructionArtifactId === null) return null;
  const reconstruction = parseRepositoryReconstructionArtifact(
    await loader(artifact.reconstructionArtifactId),
  );
  assertReconstructionAuthority(job, artifact, reconstruction.capture);
  return reconstruction;
}

export async function rehydrateRepositoryProjectRecord(
  record: RepositoryProjectRecord,
  loader: RepositoryReconstructionArtifactLoader,
): Promise<RepositoryProjectRecord> {
  const captureRecord = record.capture;
  if (captureRecord === undefined) return record;
  const entries = await Promise.all(
    captureRecord.job.artifacts.map(async (artifact) => {
      const reference = captureRecord.artifactReferences[artifact.id];
      if (reference === undefined) {
        throw new Error(
          `Runtime artifact reference ${artifact.id} is unavailable.`,
        );
      }
      const reconstruction = await loadArtifact(
        captureRecord.job,
        artifact,
        loader,
      );
      return [
        artifact.id,
        reconstruction === null
          ? reference
          : Object.freeze({
              ...reference,
              reconstruction: reconstruction.capture,
              ...(reconstruction.review === null
                ? {}
                : { reconstructionReview: reconstruction.review }),
            }),
      ] as const;
    }),
  );
  return Object.freeze({
    ...record,
    capture: Object.freeze({
      artifactReferences: Object.freeze(Object.fromEntries(entries)),
      job: captureRecord.job,
    }),
  });
}
