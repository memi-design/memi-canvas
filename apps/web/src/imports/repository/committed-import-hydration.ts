import type {
  CaptureArtifactV2,
  ImportApplicationV2,
  ImportJobSnapshotV2,
} from "@memi/protocol";

import type { ProjectRecord } from "../../projects/project-library.js";
import type { CaptureArtifactReference } from "./repository-capture-workbench.js";
import {
  RepositoryImportManifestSchema,
  type RepositoryImportManifest,
} from "./repository-import.js";
import type { RepositoryProjectRecord } from "./repository-project-persistence.js";

function projectPlatform(
  applications: readonly ImportApplicationV2[],
): RepositoryImportManifest["platform"] {
  const platforms = new Set(applications.map(({ platform }) => platform));
  if (platforms.size !== 1) return platforms.size === 0 ? "unknown" : "mixed";
  const [platform] = [...platforms];
  if (platform === "expo-ios") return "react-native-expo";
  if (platform === "react-web" || platform === "swiftui") return platform;
  return "unknown";
}

function sourceUrl(relativePath: string): string {
  return `memi-source://repository/${relativePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function assertCommitted(job: ImportJobSnapshotV2): asserts job is ImportJobSnapshotV2 & {
  readonly projectId: NonNullable<ImportJobSnapshotV2["projectId"]>;
  readonly repository: ImportJobSnapshotV2["repository"] & {
    readonly sourceRevision: string;
  };
} {
  if (
    job.state !== "committed" ||
    job.projectId === null ||
    job.progress.remaining !== 0 ||
    job.repository.sourceRevision === null
  ) {
    throw new Error("Only terminal committed imports can restore a project.");
  }
}

export function repositoryManifestFromCommittedImport(
  job: ImportJobSnapshotV2,
): RepositoryImportManifest {
  assertCommitted(job);
  return RepositoryImportManifestSchema.parse({
    schemaVersion: 1,
    projectName: job.projectName,
    rootPath: job.repository.rootPath,
    revision: job.repository.sourceRevision,
    platform: projectPlatform(job.applications),
    dirty: job.repository.dirtyFingerprint !== null,
    files: [],
    screens: job.scenarios.map((scenario) => ({
      id: scenario.id,
      name:
        scenario.state === "default"
          ? scenario.route
          : `${scenario.route} · ${scenario.state}`,
      route: scenario.route,
      sourcePath:
        scenario.sourceAnchor?.relativePath ??
        `capture-scenarios/${scenario.id}`,
    })),
    components: [],
    tokens: [],
  });
}

export function captureReferenceFromCommittedImport(
  job: ImportJobSnapshotV2,
  artifact: CaptureArtifactV2,
): CaptureArtifactReference {
  const scenario = job.scenarios.find(({ id }) => id === artifact.scenarioId);
  const relativePath =
    scenario?.sourceAnchor?.relativePath ??
    `capture-scenarios/${artifact.scenarioId}`;
  return Object.freeze({
    alt:
      scenario === undefined
        ? "Verified runtime capture"
        : `${scenario.route} · ${scenario.state}`,
    capturedAt: artifact.verification.verifiedAt,
    sourceUrl: sourceUrl(relativePath),
    src: `memi-artifact://localhost/${artifact.screenshotArtifactId}`,
  });
}

export function repositoryProjectFromCommittedImport(
  job: ImportJobSnapshotV2,
): ProjectRecord {
  assertCommitted(job);
  const manifest = repositoryManifestFromCommittedImport(job);
  return {
    id: job.projectId,
    name: job.projectName,
    kind: "design",
    documentRef: `canvas:${job.projectId}`,
    source: {
      kind: "repository",
      label: job.projectName,
      version: job.repository.sourceRevision,
      rootPath: job.repository.rootPath,
      platform: manifest.platform,
      harnessId: "deterministic-import",
      fileCount: 0,
      screenCount: job.scenarios.length,
      componentCount: 0,
    },
    lifecycle: job.failures.length === 0 ? "ready" : "attention",
    updatedAt: job.updatedAt,
    archived: false,
  };
}

export function repositoryRecordFromCommittedImport(
  job: ImportJobSnapshotV2,
): RepositoryProjectRecord {
  assertCommitted(job);
  return {
    harnessId: "deterministic-import",
    manifest: repositoryManifestFromCommittedImport(job),
    capture: {
      artifactReferences: Object.fromEntries(
        job.artifacts.map((artifact) => [
          artifact.id,
          captureReferenceFromCommittedImport(job, artifact),
        ]),
      ),
      job,
    },
  };
}
