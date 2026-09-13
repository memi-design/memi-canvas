import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
  sep,
} from "node:path";

import {
  ContentAddressedArtifactStore,
  type ArtifactReference,
} from "@memi/capture-execution";
import {
  ImportJobIdSchema,
  ProjectIdSchema,
  type ImportJobId,
  type ProjectId,
} from "@memi/protocol";

import {
  openReadOnlyGateCImportDatabase,
  readCommittedGateCProject,
  resolveGateCNativeHydrationRoot,
  runGateCNativeHydrationDiagnostic,
} from "./gate-c-native-hydration-diagnostic.js";
import {
  assertGateCReleaseAuthority,
  createGateCReleaseEvidenceManifest,
  type GateCReleaseArtifactReceipt,
  type GateCReleaseEvidenceManifest,
} from "./gate-c-release-evidence.js";

const MAX_ARTIFACT_BYTES = 64 * 1_024 * 1_024;
const MAX_GATE_C_RELEASE_ARTIFACTS = 3;
const ALLOWED_SYSTEM_PATH_ALIASES = new Set(["/var", "/tmp", "/etc"]);

interface GateCReleasePackageArguments {
  readonly expectedSourceRevision: string;
  readonly expectedJobId: ImportJobId;
  readonly outputPath: string;
  readonly projectId: ProjectId;
  readonly root: string;
}

function parseArguments(
  arguments_: readonly string[],
): GateCReleasePackageArguments {
  const [
    root,
    projectIdInput,
    expectedJobIdInput,
    outputPath,
    expectedSourceRevision,
  ] = arguments_;
  if (
    arguments_.length !== 5 ||
    root === undefined ||
    projectIdInput === undefined ||
    expectedJobIdInput === undefined ||
    outputPath === undefined ||
    expectedSourceRevision === undefined
  ) {
    throw new Error(
      "Gate C evidence packaging requires app data, project ID, job ID, output, and source revision.",
    );
  }
  return Object.freeze({
    root,
    projectId: ProjectIdSchema.parse(projectIdInput),
    expectedJobId: ImportJobIdSchema.parse(expectedJobIdInput),
    outputPath,
    expectedSourceRevision,
  });
}

async function assertNoSymlinkAncestors(path: string): Promise<void> {
  const segments = resolve(path).split(sep).filter(Boolean);
  let current = sep;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (
        metadata.isSymbolicLink() &&
        !ALLOWED_SYSTEM_PATH_ALIASES.has(current)
      ) {
        throw new Error(
          "Gate C release output may not traverse a symbolic link.",
        );
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function sha256File(path: string): Promise<`sha256:${string}`> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return `sha256:${hash.digest("hex")}`;
}

async function artifactReceipt(
  store: ContentAddressedArtifactStore,
  reference: ArtifactReference | null,
  label: string,
): Promise<GateCReleaseArtifactReceipt> {
  if (reference === null) {
    throw new Error(`Gate C release evidence requires ${label} authority.`);
  }
  const path = await store.resolve(reference);
  const metadata = await lstat(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size <= 0 ||
    metadata.size > MAX_ARTIFACT_BYTES
  ) {
    throw new Error(`Gate C ${label} artifact is not a bounded regular file.`);
  }
  const actualHash = await sha256File(path);
  if (actualHash !== reference.hash) {
    throw new Error(`Gate C ${label} artifact content hash is contradictory.`);
  }
  return Object.freeze({
    bytes: metadata.size,
    extension: reference.extension,
    hash: actualHash,
  });
}

async function databaseReceipt(path: string): Promise<Readonly<{
  readonly bytes: number;
  readonly hash: `sha256:${string}`;
  readonly name: string;
}> | null> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size <= 0) {
    throw new Error("Gate C database authority must be a non-empty regular file.");
  }
  return Object.freeze({
    bytes: metadata.size,
    hash: await sha256File(path),
    name: basename(path),
  });
}

async function requireOutputPath(input: string): Promise<string> {
  if (
    !isAbsolute(input) ||
    input.trim() !== input ||
    input.includes("\0") ||
    basename(input) !== "evidence-manifest.json"
  ) {
    throw new Error(
      "Gate C release output must be an absolute evidence-manifest.json path.",
    );
  }
  const outputPath = resolve(input);
  const parent = dirname(outputPath);
  await assertNoSymlinkAncestors(parent);
  const metadata = await lstat(parent);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Gate C release output parent must be a real directory.");
  }
  return outputPath;
}

export async function packageGateCReleaseEvidence(input: {
  readonly expectedSourceRevision: string;
  readonly expectedJobId: ImportJobId;
  readonly outputPath: string;
  readonly projectId: ProjectId;
  readonly root: string;
}): Promise<GateCReleaseEvidenceManifest> {
  const root = await resolveGateCNativeHydrationRoot(input.root);
  const projectId = ProjectIdSchema.parse(input.projectId);
  const hydration = await runGateCNativeHydrationDiagnostic(
    root.root,
    projectId,
  );
  const database = openReadOnlyGateCImportDatabase(root.databasePath);
  let committed;
  try {
    committed = readCommittedGateCProject(database, projectId);
  } finally {
    database.close();
  }
  const job = committed.capture.job;
  assertGateCReleaseAuthority({
    actualJobId: job.id,
    actualProjectId: job.projectId,
    actualSourceRevision: job.repository.sourceRevision,
    actualState: job.state,
    expectedJobId: input.expectedJobId,
    expectedProjectId: projectId,
    expectedSourceRevision: input.expectedSourceRevision,
  });
  const scenarios = new Map(
    job.scenarios.map((scenario) => [scenario.id, scenario] as const),
  );
  const store = new ContentAddressedArtifactStore(root.artifactStorePath);
  if (
    committed.capture.artifacts.length === 0 ||
    committed.capture.artifacts.length > MAX_GATE_C_RELEASE_ARTIFACTS
  ) {
    throw new Error("Gate C release evidence exceeds its capture count budget.");
  }
  const artifacts = [];
  for (const binding of committed.capture.artifacts) {
      const captured = job.artifacts.find(
        ({ id }) => id === binding.captureId,
      );
      if (captured === undefined) {
        throw new Error("Gate C committed artifact authority is incomplete.");
      }
      const scenario = scenarios.get(captured.scenarioId);
      if (scenario === undefined) {
        throw new Error("Gate C committed scenario authority is incomplete.");
      }
      artifacts.push(Object.freeze({
        captureId: captured.id,
        scenarioId: captured.scenarioId,
        route: scenario.route,
        state: scenario.state,
        sourceRevision: captured.sourceRevision,
        dimensions: captured.dimensions,
        verification: captured.verification,
        screenshot: await artifactReceipt(
          store,
          binding.screenshot,
          "screenshot",
        ),
        hierarchy: await artifactReceipt(
          store,
          binding.hierarchy,
          "hierarchy",
        ),
        geometry: await artifactReceipt(store, binding.geometry, "geometry"),
        reconstruction: await artifactReceipt(
          store,
          binding.reconstruction,
          "reconstruction",
        ),
      }));
  }
  const databaseReceipts = [];
  for (const path of [
    root.databasePath,
    `${root.databasePath}-wal`,
    `${root.databasePath}-shm`,
  ]) {
    const current = await databaseReceipt(path);
    if (current !== null) databaseReceipts.push(current);
  }
  const manifest = createGateCReleaseEvidenceManifest({
    projectId,
    jobId: job.id,
    jobRevision: job.revision,
    sourceRevision: job.repository.sourceRevision,
    dirtyFingerprint: job.repository.dirtyFingerprint,
    completedAt: job.updatedAt,
    progress: job.progress,
    hydration,
    artifacts,
    databaseReceipts,
  });
  const outputPath = await requireOutputPath(input.outputPath);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > 1_048_576) {
    throw new Error("Gate C release evidence manifest exceeds its byte budget.");
  }
  const handle = await open(outputPath, "wx", 0o600);
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return manifest;
}

if (import.meta.main) {
  try {
    const input = parseArguments(process.argv.slice(2));
    const manifest = await packageGateCReleaseEvidence(input);
    console.log("GATE_C_RELEASE_EVIDENCE_OK", {
      artifacts: manifest.artifacts.length,
      captureAuthorityHash: manifest.captureAuthorityHash,
    });
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Gate C release evidence packaging failed.",
    );
    process.exitCode = 1;
  }
}
