import { createRequire } from "node:module";

import type { ArtifactReference } from "@memi/capture-execution";
import type {
  ArtifactId,
  CaptureArtifactV2,
  ImportInventoryV1,
  ImportJobSnapshotV2,
  ProjectId,
} from "@memi/protocol";
import {
  ArtifactIdSchema,
  ImportInventorySchemaV1,
  ImportJobSnapshotSchemaV2,
  ProjectIdSchema,
} from "@memi/protocol";
import { z } from "zod";

const TABLE = `
CREATE TABLE IF NOT EXISTS committed_imported_projects_v1 (
  project_id TEXT PRIMARY KEY,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json)
    AND length(CAST(record_json AS BLOB)) BETWEEN 2 AND 8388608
  ),
  updated_at TEXT NOT NULL
) STRICT;`;
const SQLITE_MODULE_SPECIFIER = "node" + ":sqlite";
const require = createRequire(import.meta.url);

interface SqliteStatementLike {
  run(...values: readonly unknown[]): unknown;
  get(...values: readonly unknown[]): unknown;
}

interface SqliteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementLike;
  close(): void;
}

type DatabaseSyncConstructor = new (
  path: string,
  options?: {
    readonly allowExtension?: boolean;
    readonly allowBareNamedParameters?: boolean;
    readonly allowUnknownNamedParameters?: boolean;
    readonly timeout?: number;
  },
) => SqliteDatabaseLike;

function databaseSyncConstructor(): DatabaseSyncConstructor {
  const loaded = require(SQLITE_MODULE_SPECIFIER) as {
    readonly DatabaseSync?: DatabaseSyncConstructor;
  };
  if (typeof loaded.DatabaseSync !== "function") {
    throw new Error("Node SQLite runtime support is unavailable.");
  }
  return loaded.DatabaseSync;
}

const safeText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);
const safeContainedPath = safeText(1024).refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    ),
  "Safe manifest paths must stay contained inside the repository.",
);
const repositoryPlatform = z.enum([
  "mixed",
  "react-native-expo",
  "react-web",
  "swiftui",
  "unknown",
]);
const artifactReferenceSchema = z.strictObject({
  id: ArtifactIdSchema,
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  extension: z.string().regex(/^[a-z0-9]{1,12}$/u),
});
const manifestItemSchema = z.strictObject({
  id: safeText(160),
  name: safeText(256),
  sourcePath: safeContainedPath,
});
const manifestScreenSchema = manifestItemSchema.extend({
  route: safeText(512),
});
const committedManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectName: safeText(256),
  rootPath: safeText(4096).startsWith("/"),
  revision: safeText(64),
  platform: repositoryPlatform,
  dirty: z.boolean(),
  inventory: ImportInventorySchemaV1,
  files: z.tuple([]),
  screens: z.array(manifestScreenSchema).max(500),
  components: z.array(manifestItemSchema).max(250),
  tokens: z.array(manifestItemSchema).max(100),
});
const committedArtifactBindingSchema = z
  .strictObject({
    captureId: ArtifactIdSchema,
    screenshot: artifactReferenceSchema,
    hierarchy: artifactReferenceSchema.nullable(),
    geometry: artifactReferenceSchema.nullable(),
    reconstruction: artifactReferenceSchema.nullable(),
  });

const committedImportedProjectRecordSchema = z
  .strictObject({
    projectId: ProjectIdSchema,
    harnessId: safeText(64),
    manifest: committedManifestSchema,
    capture: z.strictObject({
      job: ImportJobSnapshotSchemaV2,
      artifacts: z.array(committedArtifactBindingSchema).max(500),
    }),
  })
  .superRefine((record, context) => {
    if (
      record.capture.job.state !== "committed" ||
      record.capture.job.projectId !== record.projectId
    ) {
      context.addIssue({
        code: "custom",
        path: ["capture", "job"],
        message:
          "Committed imported project records require the exact committed job authority.",
      });
    }
    if (
      record.capture.job.projectName !== record.manifest.projectName ||
      record.capture.job.repository.rootPath !== record.manifest.rootPath
    ) {
      context.addIssue({
        code: "custom",
        path: ["manifest"],
        message:
          "Committed imported project manifest must match the committed job repository authority.",
      });
    }
    const sourceRevision =
      record.capture.job.repository.sourceRevision ?? "unversioned";
    if (
      record.manifest.revision !== sourceRevision ||
      record.manifest.dirty !==
        (record.capture.job.repository.dirtyFingerprint !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "revision"],
        message:
          "Committed imported project manifest revision must match the committed job authority.",
      });
    }
    const jobArtifacts = new Map<ArtifactId, CaptureArtifactV2>(
      record.capture.job.artifacts.map((artifact) => [artifact.id, artifact]),
    );
    if (record.capture.artifacts.length !== record.capture.job.artifacts.length) {
      context.addIssue({
        code: "custom",
        path: ["capture", "artifacts"],
        message:
          "Committed imported project records require one artifact binding per committed capture artifact.",
      });
      return;
    }
    for (const [index, binding] of record.capture.artifacts.entries()) {
      const artifact = jobArtifacts.get(binding.captureId);
      if (artifact === undefined) {
        context.addIssue({
          code: "custom",
          path: ["capture", "artifacts", index, "captureId"],
          message:
            "Committed imported project artifact bindings must reference a known committed capture artifact.",
        });
        continue;
      }
      if (
        artifact.screenshotArtifactId !== binding.screenshot.id ||
        artifact.screenshotHash !== binding.screenshot.hash
      ) {
        context.addIssue({
          code: "custom",
          path: ["capture", "artifacts", index, "screenshot"],
          message:
            "Committed imported project screenshot bindings must match committed screenshot authority.",
        });
      }
      if (
        artifact.hierarchyArtifactId !==
        (binding.hierarchy === null ? null : binding.hierarchy.id)
      ) {
        context.addIssue({
          code: "custom",
          path: ["capture", "artifacts", index, "hierarchy"],
          message:
            "Committed imported project hierarchy bindings must match committed hierarchy authority.",
        });
      }
      if (
        artifact.geometryArtifactId !==
        (binding.geometry === null ? null : binding.geometry.id)
      ) {
        context.addIssue({
          code: "custom",
          path: ["capture", "artifacts", index, "geometry"],
          message:
            "Committed imported project geometry bindings must match committed geometry authority.",
        });
      }
      if (
        artifact.reconstructionArtifactId !==
        (binding.reconstruction === null ? null : binding.reconstruction.id)
      ) {
        context.addIssue({
          code: "custom",
          path: ["capture", "artifacts", index, "reconstruction"],
          message:
            "Committed imported project reconstruction bindings must match committed reconstruction authority.",
        });
      }
    }
  });

type CommittedManifest = z.infer<typeof committedManifestSchema>;
type CommittedArtifactBinding = z.infer<typeof committedArtifactBindingSchema>;
export type CommittedImportedProjectRecord = z.infer<
  typeof committedImportedProjectRecordSchema
>;

export interface CommittedImportedProjectStore {
  save(record: CommittedImportedProjectRecord): Promise<void>;
  get(projectId: ProjectId): Promise<CommittedImportedProjectRecord | null>;
  purgeAll(): Promise<number>;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function platformFor(
  applications: readonly ImportJobSnapshotV2["applications"][number][],
): z.infer<typeof repositoryPlatform> {
  const platforms = new Set(applications.map(({ platform }) => platform));
  if (platforms.size !== 1) {
    return platforms.size === 0 ? "unknown" : "mixed";
  }
  const platform = [...platforms][0];
  if (platform === "expo-ios") return "react-native-expo";
  if (platform === "react-web" || platform === "swiftui") {
    return platform;
  }
  return "unknown";
}

function bindingFor(
  artifact: CaptureArtifactV2,
  references: ReadonlyMap<string, ArtifactReference>,
): CommittedArtifactBinding {
  const screenshot = references.get(artifact.screenshotArtifactId);
  const hierarchy =
    artifact.hierarchyArtifactId === null
      ? null
      : references.get(artifact.hierarchyArtifactId) ?? null;
  const geometry =
    artifact.geometryArtifactId === null
      ? null
      : references.get(artifact.geometryArtifactId) ?? null;
  const reconstruction =
    artifact.reconstructionArtifactId === null
      ? null
      : references.get(artifact.reconstructionArtifactId) ?? null;
  if (
    screenshot === undefined ||
    (artifact.hierarchyArtifactId !== null && hierarchy === null) ||
    (artifact.geometryArtifactId !== null && geometry === null) ||
    (artifact.reconstructionArtifactId !== null && reconstruction === null)
  ) {
    throw new Error(
      "Committed imported project artifact authority is incomplete.",
    );
  }
  return {
    captureId: artifact.id,
    screenshot: artifactReferenceSchema.parse(screenshot),
    hierarchy:
      hierarchy === null ? null : artifactReferenceSchema.parse(hierarchy),
    geometry:
      geometry === null ? null : artifactReferenceSchema.parse(geometry),
    reconstruction:
      reconstruction === null
        ? null
        : artifactReferenceSchema.parse(reconstruction),
  };
}

export function committedImportedProjectManifest(input: {
  readonly inventory: ImportInventoryV1;
  readonly job: ImportJobSnapshotV2;
}): CommittedManifest {
  return committedManifestSchema.parse({
    schemaVersion: 1,
    projectName: input.job.projectName,
    rootPath: input.job.repository.rootPath,
    revision: input.job.repository.sourceRevision ?? "unversioned",
    platform: platformFor(input.job.applications),
    dirty: input.job.repository.dirtyFingerprint !== null,
    inventory: input.inventory,
    files: [],
    screens: input.inventory.screens,
    components: input.inventory.components,
    tokens: input.inventory.tokens,
  });
}

export function createCommittedImportedProjectRecord(input: {
  readonly inventory: ImportInventoryV1;
  readonly artifactReferences: readonly ArtifactReference[];
  readonly harnessId: string;
  readonly job: ImportJobSnapshotV2;
  readonly projectId: ProjectId;
}): CommittedImportedProjectRecord {
  const references = new Map(
    input.artifactReferences.map((reference) => [reference.id, reference] as const),
  );
  return deepFreeze(
    committedImportedProjectRecordSchema.parse({
      projectId: input.projectId,
      harnessId: input.harnessId,
      manifest: committedImportedProjectManifest({
        inventory: input.inventory,
        job: input.job,
      }),
      capture: {
        job: input.job,
        artifacts: input.job.artifacts.map((artifact) =>
          bindingFor(artifact, references),
        ),
      },
    }),
  );
}

export function parseCommittedImportedProjectRecord(
  value: unknown,
): CommittedImportedProjectRecord {
  return deepFreeze(
    committedImportedProjectRecordSchema.parse(value),
  );
}

export class SqliteCommittedImportedProjectStore
  implements CommittedImportedProjectStore
{
  readonly #database: SqliteDatabaseLike;

  constructor(databasePath: string) {
    const DatabaseSync = databaseSyncConstructor();
    this.#database = new DatabaseSync(databasePath, {
      allowExtension: false,
      allowBareNamedParameters: false,
      allowUnknownNamedParameters: false,
      timeout: 5_000,
    });
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = FULL;
      PRAGMA trusted_schema = OFF;
      PRAGMA secure_delete = ON;
      PRAGMA journal_mode = WAL;
      ${TABLE}
    `);
  }

  async save(record: CommittedImportedProjectRecord): Promise<void> {
    const parsed = parseCommittedImportedProjectRecord(record);
    this.#database
      .prepare(
        `INSERT INTO committed_imported_projects_v1 (
           project_id, record_json, updated_at
         ) VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           record_json = excluded.record_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        parsed.projectId,
        JSON.stringify(parsed),
        parsed.capture.job.updatedAt,
      );
  }

  async get(
    projectId: ProjectId,
  ): Promise<CommittedImportedProjectRecord | null> {
    const id = ProjectIdSchema.parse(projectId);
    const row = this.#database
      .prepare(
        `SELECT record_json
         FROM committed_imported_projects_v1
         WHERE project_id = ?`,
      )
      .get(id) as { readonly record_json: string } | undefined;
    if (row === undefined) {
      return null;
    }
    return parseCommittedImportedProjectRecord(
      JSON.parse(row.record_json) as unknown,
    );
  }

  async purgeAll(): Promise<number> {
    const row = this.#database
      .prepare(
        "SELECT count(*) AS count FROM committed_imported_projects_v1",
      )
      .get() as { readonly count: number | bigint };
    const count = Number(row.count);
    this.#database.exec("DELETE FROM committed_imported_projects_v1");
    return count;
  }

  close(): void {
    this.#database.close();
  }
}
