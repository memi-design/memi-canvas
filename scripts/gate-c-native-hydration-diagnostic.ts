import { Database } from "bun:sqlite";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  ContentAddressedArtifactStore,
  type ArtifactReference,
} from "@memi/capture-execution";
import { ProjectIdSchema, type ProjectId } from "@memi/protocol";

import { createCanvasDocumentJournalRpcService } from "../apps/macos/runtime-sidecar/src/canvas-document-journal-service.js";
import { persistCommittedImportCanvasDocumentV3 } from "../apps/web/src/imports/repository/committed-import-v3-hydration.js";
import {
  repositoryProjectFromCommittedImport,
  repositoryRecordFromCommittedImport,
} from "../apps/web/src/imports/repository/committed-import-hydration.js";
import { createCapturedRepositoryCanvasProject } from "../apps/web/src/imports/repository/repository-capture-workbench.js";
import { createEphemeralCanvasDocumentPersistence } from "../apps/web/src/runtime/runtime-client-canvas-document-persistence.js";
import {
  parseCommittedImportedProjectRecord,
  type CommittedImportedProjectRecord,
} from "../packages/runtime/src/imports/committed-import-project-store.js";

interface CommittedProjectRow {
  readonly record_json: string;
}

export const MAX_GATE_C_RECONSTRUCTION_BYTES = 8 * 1_024 * 1_024;

export interface GateCNativeHydrationRoot {
  readonly artifactStorePath: string;
  readonly databasePath: string;
  readonly root: string;
}

export interface GateCNativeHydrationSummary {
  readonly artifacts: number;
  readonly components: number;
  readonly projectId: ProjectId;
  readonly screens: number;
}

export interface GateCNativeHydrationArguments {
  readonly projectId: ProjectId;
  readonly root: string;
}

export function parseGateCNativeHydrationArguments(
  arguments_: readonly string[],
): GateCNativeHydrationArguments {
  const [root, projectIdInput] = arguments_;
  if (
    arguments_.length !== 2 ||
    root === undefined ||
    projectIdInput === undefined
  ) {
    throw new Error(
      "Gate C hydration requires an absolute app-data root and project ID.",
    );
  }
  const projectId = ProjectIdSchema.safeParse(projectIdInput);
  if (!projectId.success) {
    throw new Error("Gate C hydration project ID is invalid.");
  }
  return Object.freeze({ projectId: projectId.data, root });
}

async function requireRealPath(
  path: string,
  kind: "directory" | "file",
  label: string,
): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`${label} must be an existing regular ${kind}.`);
    }
    throw error;
  }
  const expected = kind === "directory"
    ? metadata.isDirectory()
    : metadata.isFile();
  if (metadata.isSymbolicLink() || !expected) {
    throw new Error(`${label} must be an existing regular ${kind}.`);
  }
}

export async function resolveGateCNativeHydrationRoot(
  input: string,
): Promise<GateCNativeHydrationRoot> {
  if (
    input.length === 0 ||
    input.trim() !== input ||
    input.includes("\0") ||
    !isAbsolute(input)
  ) {
    throw new Error("Gate C recovery root must be a clean absolute path.");
  }
  const root = resolve(input);
  if (root === "/") {
    throw new Error("Gate C recovery root may not be the filesystem root.");
  }
  const databasePath = join(root, "imports.sqlite");
  const artifactStorePath = join(root, "capture-artifacts");
  await requireRealPath(root, "directory", "Gate C recovery root");
  await requireRealPath(
    databasePath,
    "file",
    "Gate C imports.sqlite",
  );
  await requireRealPath(
    join(artifactStorePath, "sha256"),
    "directory",
    "Gate C artifact hash root",
  );
  return Object.freeze({ artifactStorePath, databasePath, root });
}

export function openReadOnlyGateCImportDatabase(path: string): Database {
  return new Database(path, { readonly: true, strict: true });
}

export function readCommittedGateCProject(
  database: Database,
  projectId: ProjectId,
): CommittedImportedProjectRecord {
  const row = database
    .query<CommittedProjectRow>(
      `SELECT record_json
       FROM committed_imported_projects_v1
       WHERE project_id = ?`,
    )
    .get(projectId);
  if (row === null) {
    throw new Error(
      `Gate C recovery database has no committed import evidence for ${projectId}.`,
    );
  }
  return parseCommittedImportedProjectRecord(
    JSON.parse(row.record_json) as unknown,
  );
}

export function createGateCReconstructionLoader(
  artifactStorePath: string,
  references: readonly ArtifactReference[],
): (artifactId: `art_${string}`) => Promise<unknown> {
  const store = new ContentAddressedArtifactStore(artifactStorePath);
  const byId = new Map<string, ArtifactReference>();
  for (const reference of references) {
    const existing = byId.get(reference.id);
    if (
      existing !== undefined &&
      (existing.hash !== reference.hash ||
        existing.extension !== reference.extension)
    ) {
      throw new Error(
        `Reconstruction artifact ${reference.id} has conflicting evidence.`,
      );
    }
    byId.set(reference.id, reference);
  }
  return async (artifactId: `art_${string}`) => {
    const reference = byId.get(artifactId);
    if (reference === undefined) {
      throw new Error(
        `Reconstruction artifact ${artifactId} is not retained in committed evidence.`,
      );
    }
    const path = await store.resolve(reference);
    const metadata = await lstat(path);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > MAX_GATE_C_RECONSTRUCTION_BYTES
    ) {
      throw new Error(
        `Reconstruction artifact ${artifactId} exceeds its JSON byte budget.`,
      );
    }
    const bytes = await readFile(path);
    try {
      return JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      throw new Error(
        `Reconstruction artifact ${artifactId} is not valid JSON.`,
      );
    }
  };
}

function reconstructionReferences(
  committed: CommittedImportedProjectRecord,
): readonly ArtifactReference[] {
  return Object.freeze(
    committed.capture.artifacts.flatMap(({ reconstruction }) =>
      reconstruction === null ? [] : [reconstruction],
    ),
  );
}

export function summarizeGateCNativeHydration(
  input: Readonly<GateCNativeHydrationSummary>,
): GateCNativeHydrationSummary {
  const counts = [input.artifacts, input.components, input.screens];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("Gate C hydration summary counts must be non-negative integers.");
  }
  return Object.freeze({
    artifacts: input.artifacts,
    components: input.components,
    projectId: ProjectIdSchema.parse(input.projectId),
    screens: input.screens,
  });
}

export async function runGateCNativeHydrationDiagnostic(
  inputRoot: string,
  inputProjectId: ProjectId,
): Promise<GateCNativeHydrationSummary> {
  const root = await resolveGateCNativeHydrationRoot(inputRoot);
  const projectId = ProjectIdSchema.parse(inputProjectId);
  const database = openReadOnlyGateCImportDatabase(root.databasePath);
  try {
    const committed = readCommittedGateCProject(database, projectId);
    const job = committed.capture.job;
    const inventory = committed.manifest.inventory;
    const project = repositoryProjectFromCommittedImport(job, inventory);
    const record = repositoryRecordFromCommittedImport(job, inventory);
    const canvasProject = createCapturedRepositoryCanvasProject({
      artifactReference: (artifact) => {
        const reference = record.capture?.artifactReferences[artifact.id];
        if (reference === undefined) {
          throw new Error(
            `Runtime artifact reference ${artifact.id} is unavailable.`,
          );
        }
        return reference;
      },
      harnessId: record.harnessId,
      job,
      manifest: record.manifest,
      projectId: project.id,
    });
    const canvasDocuments = createCanvasDocumentJournalRpcService({
      port: createEphemeralCanvasDocumentPersistence(),
    });
    const loader = createGateCReconstructionLoader(
      root.artifactStorePath,
      reconstructionReferences(committed),
    );
    await persistCommittedImportCanvasDocumentV3({
      canvasProject,
      job,
      loader,
      record,
      runtimeClient: { canvasDocuments },
    });
    return summarizeGateCNativeHydration({
      artifacts: job.artifacts.length,
      components: inventory.components.length,
      projectId: project.id,
      screens: inventory.screens.length,
    });
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  try {
    const { projectId, root } = parseGateCNativeHydrationArguments(
      process.argv.slice(2),
    );
    console.log(
      "GATE_C_NATIVE_HYDRATION_OK",
      await runGateCNativeHydrationDiagnostic(root, projectId),
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Gate C hydration failed.",
    );
    process.exitCode = 1;
  }
}
