import {
  ImportJobSnapshotSchemaV2,
  type CaptureArtifactV2,
  type CaptureScenarioV2,
  type ImportJobSnapshotV2,
} from "@memi/protocol";
import { CanvasDocumentV3PersistenceAdapter } from "@memi/canvas-document";

import {
  RuntimeCaptureScreenV1Schema,
  type RuntimeCaptureScreenV1,
} from "../../canvas/runtime-capture-canonical-types.js";
import {
  materializeRuntimeCaptureV3,
  type RuntimeCaptureMaterializationPlanV3,
} from "../../canvas/runtime-capture-v3-materialization-adapter.js";
import type { RuntimeClientV1 } from "../../runtime/runtime-client.js";
import { createRuntimeClientCanvasDocumentPersistence } from "../../runtime/runtime-client-canvas-document-persistence.js";
import { createLocalDesignCanvasDocumentV3 } from "../../projects/local-design-canvas-v3.js";
import { runtimeProjectIdForLocalProject } from "../../projects/project-library.js";
import type { StreamingRepositoryCanvasProject } from "./repository-capture-workbench.js";
import type { RepositoryProjectRecord } from "./repository-project-persistence.js";
import {
  rehydrateRepositoryProjectRecord,
  type RepositoryReconstructionArtifactLoader,
} from "./repository-reconstruction-rehydration.js";

const SCREEN_GAP = 96;
const DEFAULT_COLUMNS = 5;

export interface CommittedImportCanvasHydrationV3Input {
  readonly expectedDocumentRevision: number;
  readonly job: ImportJobSnapshotV2;
  readonly pageId: string;
  readonly reconstructionsByArtifactId: Readonly<
    Record<string, RuntimeCaptureScreenV1>
  >;
}

export interface CommittedImportCanvasHydrationV3Result {
  readonly persistence: CanvasDocumentV3PersistenceAdapter;
  readonly plans: readonly RuntimeCaptureMaterializationPlanV3[];
}

export async function persistCommittedImportCanvasDocumentV3(input: {
  readonly canvasProject: StreamingRepositoryCanvasProject;
  readonly job: ImportJobSnapshotV2;
  readonly loader?: RepositoryReconstructionArtifactLoader;
  readonly record: RepositoryProjectRecord;
  readonly runtimeClient: Pick<RuntimeClientV1, "canvasDocuments">;
}): Promise<void> {
  let hydratedRecord = input.record;
  const requiresArtifactLoad = input.job.artifacts.some((artifact) => {
    const reference = hydratedRecord.capture?.artifactReferences[artifact.id];
    return artifact.reconstructionArtifactId !== null &&
      reference?.reconstruction === undefined;
  });
  if (requiresArtifactLoad) {
    if (input.loader === undefined) {
      throw new Error(
        "Verified import reconstruction artifacts require an authenticated loader.",
      );
    }
    hydratedRecord = await rehydrateRepositoryProjectRecord(
      hydratedRecord,
      input.loader,
    );
  }
  const reconstructionsByArtifactId: Record<string, RuntimeCaptureScreenV1> = {};
  for (const artifact of input.job.artifacts) {
    const reconstruction =
      hydratedRecord.capture?.artifactReferences[artifact.id]?.reconstruction;
    if (reconstruction === undefined) {
      throw new Error(
        `Committed artifact ${artifact.id} has no editable reconstruction.`,
      );
    }
    reconstructionsByArtifactId[artifact.id] = reconstruction;
  }
  const document = createLocalDesignCanvasDocumentV3(
    input.canvasProject,
    runtimeProjectIdForLocalProject(input.canvasProject.id),
    "imported",
  );
  const persistence = await CanvasDocumentV3PersistenceAdapter.open(
    document,
    createRuntimeClientCanvasDocumentPersistence(input.runtimeClient),
  );
  const pageId = persistence.document.pageIds[0];
  if (pageId === undefined) {
    throw new Error("Committed import canvas has no imported page.");
  }
  await hydrateCommittedImportCanvasDocumentV3(persistence, {
    expectedDocumentRevision: persistence.document.revision,
    job: input.job,
    pageId,
    reconstructionsByArtifactId,
  });
}

function assertCommitted(job: ImportJobSnapshotV2): void {
  if (
    job.state !== "committed" ||
    job.projectId === null ||
    job.repository.sourceRevision === null ||
    job.progress.remaining !== 0
  ) {
    throw new Error(
      "Canvas V3 hydration requires a terminal committed import job.",
    );
  }
}

function scenarioFor(
  job: ImportJobSnapshotV2,
  artifact: CaptureArtifactV2,
): CaptureScenarioV2 {
  const scenario = job.scenarios.find(({ id }) => id === artifact.scenarioId);
  if (scenario === undefined) {
    throw new Error(`Import artifact ${artifact.id} has no capture scenario.`);
  }
  return scenario;
}

function verifiedArtifact(artifact: CaptureArtifactV2): boolean {
  return (
    artifact.verification.routeMatched &&
    artifact.verification.blankRejected &&
    artifact.verification.splashRejected &&
    artifact.verification.errorBoundaryRejected
  );
}

function assertAuthority(
  job: ImportJobSnapshotV2,
  artifact: CaptureArtifactV2,
  scenario: CaptureScenarioV2,
  capture: RuntimeCaptureScreenV1,
): void {
  if (
    capture.captureId !== artifact.id ||
    capture.artifact.artifactId !== artifact.screenshotArtifactId ||
    capture.artifact.hash !== artifact.screenshotHash ||
    capture.artifact.width !== artifact.dimensions.width ||
    capture.artifact.height !== artifact.dimensions.height ||
    capture.repository.rootPath !== job.repository.rootPath ||
    capture.repository.revision !== job.repository.sourceRevision ||
    capture.repository.revision !== artifact.sourceRevision ||
    capture.binding.routeId !== scenario.route ||
    capture.binding.stateId !== scenario.state ||
    capture.binding.viewport.width !== scenario.viewport.width ||
    capture.binding.viewport.height !== scenario.viewport.height ||
    (capture.binding.viewport.scale ?? 1) !== scenario.viewport.scale
  ) {
    throw new Error(
      `Import reconstruction ${artifact.id} does not match its committed runtime authority.`,
    );
  }
  const source = scenario.sourceAnchor;
  if (
    source !== null &&
    (capture.binding.sourceContentHash !== source.contentHash ||
      (capture.binding.sourceAnchor !== source.relativePath &&
        !capture.binding.sourceAnchor.startsWith(`${source.relativePath}#`)))
  ) {
    throw new Error(
      `Import reconstruction ${artifact.id} does not match its source authority.`,
    );
  }
}

function alreadyMaterialized(
  persistence: CanvasDocumentV3PersistenceAdapter,
  artifact: CaptureArtifactV2,
): boolean {
  const evidence = Object.values(persistence.document.evidenceById).find(
    ({ scenarioId }) => scenarioId === artifact.id,
  );
  if (evidence === undefined) return false;
  if (
    evidence.screenshotArtifactId !== artifact.screenshotArtifactId ||
    evidence.geometryArtifactId !== artifact.geometryArtifactId ||
    evidence.hierarchyArtifactId !== artifact.hierarchyArtifactId ||
    evidence.reconstructionArtifactId !== artifact.reconstructionArtifactId ||
    evidence.sourceRevision !== artifact.sourceRevision ||
    evidence.fixtureFingerprint !== artifact.fixtureFingerprint
  ) {
    throw new Error(
      `Persisted import evidence ${artifact.id} conflicts with the committed artifact.`,
    );
  }
  return true;
}

function placement(
  scenario: CaptureScenarioV2,
  index: number,
): Readonly<{ x: number; y: number }> {
  return Object.freeze({
    x: (index % DEFAULT_COLUMNS) * (scenario.viewport.width + SCREEN_GAP),
    y:
      Math.floor(index / DEFAULT_COLUMNS) *
      (scenario.viewport.height + SCREEN_GAP),
  });
}

export async function hydrateCommittedImportCanvasDocumentV3(
  initialPersistence: CanvasDocumentV3PersistenceAdapter,
  input: CommittedImportCanvasHydrationV3Input,
): Promise<CommittedImportCanvasHydrationV3Result> {
  const job = ImportJobSnapshotSchemaV2.parse(input.job);
  assertCommitted(job);
  if (job.projectId !== initialPersistence.document.projectId) {
    throw new Error("Committed import project does not match the canvas project.");
  }
  if (initialPersistence.document.revision !== input.expectedDocumentRevision) {
    throw new Error(
      `Committed import expected revision ${input.expectedDocumentRevision} but the document is at revision ${initialPersistence.document.revision}.`,
    );
  }

  let persistence = initialPersistence;
  const plans: RuntimeCaptureMaterializationPlanV3[] = [];
  for (const [index, artifact] of job.artifacts.entries()) {
    if (alreadyMaterialized(persistence, artifact)) continue;
    const geometryArtifactId = artifact.geometryArtifactId;
    const hierarchyArtifactId = artifact.hierarchyArtifactId;
    const reconstructionArtifactId = artifact.reconstructionArtifactId;
    if (
      geometryArtifactId === null ||
      hierarchyArtifactId === null ||
      reconstructionArtifactId === null
    ) {
      throw new Error(
        `Import artifact ${artifact.id} lacks geometry or editable reconstruction evidence.`,
      );
    }
    const scenario = scenarioFor(job, artifact);
    const capture = RuntimeCaptureScreenV1Schema.parse(
      input.reconstructionsByArtifactId[artifact.id],
    );
    assertAuthority(job, artifact, scenario, capture);
    const result = await materializeRuntimeCaptureV3(persistence, {
      evidenceArtifacts: {
        fixtureFingerprint: artifact.fixtureFingerprint,
        geometryArtifactId,
        hierarchyArtifactId,
        reconstructionArtifactId,
        screenshotArtifactId: artifact.screenshotArtifactId,
        stableFrameHash: artifact.verification.stableFrameHash,
        verified: verifiedArtifact(artifact),
      },
      expectedDocumentRevision: persistence.document.revision,
      manifest: capture,
      pageId: input.pageId,
      placement: placement(scenario, index),
    });
    persistence = result.persistence;
    plans.push(result.plan);
  }

  return Object.freeze({
    persistence,
    plans: Object.freeze([...plans]),
  });
}
