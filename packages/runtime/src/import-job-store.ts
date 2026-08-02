import { DatabaseSync } from "node:sqlite";

import {
  IMPORT_JOB_MAX_BYTES,
  ImportJobDraftSchemaV2,
  ImportJobIdSchema,
  ImportJobSnapshotSchemaV2,
  type ImportJobDraftV2,
  type ImportJobId,
  type ImportJobSnapshotV2,
  type ImportJobStoreV2,
  type SaveImportJobRequestV2,
} from "@memi/protocol";
import { redactLogMessage } from "@memi/capture-execution";

const IMPORT_JOBS_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS import_jobs_v2 (
  job_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL CHECK (
    state IN (
      'queued', 'running', 'paused', 'ready-to-commit',
      'committed', 'failed', 'cancelled'
    )
  ),
  stage TEXT NOT NULL CHECK (
    stage IN (
      'validate', 'inventory', 'plan', 'prepare-fixtures', 'build',
      'launch', 'capture', 'extract-layers', 'verify', 'save'
    )
  ),
  project_id TEXT,
  job_json TEXT NOT NULL CHECK (
    json_valid(job_json)
    AND length(CAST(job_json AS BLOB))
      BETWEEN 2 AND ${IMPORT_JOB_MAX_BYTES}
  ),
  updated_at TEXT NOT NULL
) STRICT;`;

interface ImportJobStoreOptions {
  readonly now?: () => string;
}

interface ImportJobRow {
  readonly job_json: string;
}

export class ImportJobConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportJobConflictError";
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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

function freezeSnapshot(
  snapshot: ImportJobSnapshotV2,
): ImportJobSnapshotV2 {
  return deepFreeze(structuredClone(snapshot));
}

function validateDraft(job: ImportJobDraftV2): ImportJobDraftV2 {
  return ImportJobDraftSchemaV2.parse({
    ...job,
    logs: job.logs.map((entry) => ({
      ...entry,
      message: redactLogMessage(entry.message),
    })),
    failures: job.failures.map((failure) => ({
      ...failure,
      message: redactLogMessage(failure.message),
      remediation: redactLogMessage(failure.remediation),
      logTail: failure.logTail.map((entry) =>
        redactLogMessage(entry),
      ),
    })),
  });
}

function serializeSnapshot(snapshot: ImportJobSnapshotV2): string {
  const validated = ImportJobSnapshotSchemaV2.parse(snapshot);
  const serialized = JSON.stringify(validated);
  if (byteLength(serialized) > IMPORT_JOB_MAX_BYTES) {
    throw new Error("Import job exceeds its durable payload limit.");
  }
  return serialized;
}

export class SqliteImportJobStore implements ImportJobStoreV2 {
  readonly databasePath: string;
  readonly #database: DatabaseSync;
  readonly #now: () => string;

  constructor(
    databasePath: string,
    options: ImportJobStoreOptions = {},
  ) {
    this.databasePath = databasePath;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#database = new DatabaseSync(databasePath, {
      allowExtension: false,
      allowBareNamedParameters: false,
      allowUnknownNamedParameters: false,
      timeout: 5_000,
    });
    try {
      this.#database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA synchronous = FULL;
        PRAGMA trusted_schema = OFF;
        PRAGMA secure_delete = ON;
        PRAGMA journal_mode = WAL;
        ${IMPORT_JOBS_TABLE_SCHEMA}
      `);
      const json = this.#database
        .prepare("SELECT json_valid('{}') AS supported")
        .get() as { readonly supported: number };
      if (Number(json.supported) !== 1) {
        throw new Error("Import job storage requires SQLite JSON.");
      }
      this.#validateDatabase();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  async get(jobId: ImportJobId): Promise<ImportJobSnapshotV2 | null> {
    const validatedId = ImportJobIdSchema.parse(jobId);
    return this.#load(validatedId);
  }

  async listRecoverable(): Promise<
    readonly ImportJobSnapshotV2[]
  > {
    const rows = this.#database
      .prepare(
        `SELECT job_json
         FROM import_jobs_v2
         WHERE state = 'running'
         ORDER BY updated_at ASC, job_id ASC`,
      )
      .all() as unknown as readonly ImportJobRow[];
    return rows.map(({ job_json }) =>
      freezeSnapshot(
        ImportJobSnapshotSchemaV2.parse(
          JSON.parse(job_json) as unknown,
        ),
      ),
    );
  }

  async listAll(): Promise<readonly ImportJobSnapshotV2[]> {
    const rows = this.#database
      .prepare(
        `SELECT job_json
         FROM import_jobs_v2
         ORDER BY updated_at ASC, job_id ASC`,
      )
      .all() as unknown as readonly ImportJobRow[];
    return rows.map(({ job_json }) =>
      freezeSnapshot(
        ImportJobSnapshotSchemaV2.parse(
          JSON.parse(job_json) as unknown,
        ),
      ),
    );
  }

  async save(
    request: SaveImportJobRequestV2,
  ): Promise<ImportJobSnapshotV2> {
    const job = validateDraft(request.job);
    const expected = request.expectedRevision;
    if (
      expected !== null &&
      (!Number.isSafeInteger(expected) || expected < 1)
    ) {
      throw new ImportJobConflictError(
        "Expected import job revision is invalid.",
      );
    }

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#load(job.id);
      if ((current?.revision ?? null) !== expected) {
        throw new ImportJobConflictError(
          "Import job changed after it was loaded.",
        );
      }
      const snapshot = freezeSnapshot(
        ImportJobSnapshotSchemaV2.parse({
          ...job,
          revision: (current?.revision ?? 0) + 1,
          updatedAt: this.#now(),
        }),
      );
      const serialized = serializeSnapshot(snapshot);

      if (current === null) {
        this.#database
          .prepare(
            `INSERT INTO import_jobs_v2 (
               job_id, revision, state, stage, project_id,
               job_json, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            snapshot.id,
            snapshot.revision,
            snapshot.state,
            snapshot.stage,
            snapshot.projectId,
            serialized,
            snapshot.updatedAt,
          );
      } else {
        const result = this.#database
          .prepare(
            `UPDATE import_jobs_v2
             SET revision = ?, state = ?, stage = ?, project_id = ?,
                 job_json = ?, updated_at = ?
             WHERE job_id = ? AND revision = ?`,
          )
          .run(
            snapshot.revision,
            snapshot.state,
            snapshot.stage,
            snapshot.projectId,
            serialized,
            snapshot.updatedAt,
            snapshot.id,
            expected,
          );
        if (Number(result.changes) !== 1) {
          throw new ImportJobConflictError(
            "Import job compare-and-save lost its revision fence.",
          );
        }
      }
      this.#database.exec("COMMIT");
      return snapshot;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  async delete(jobId: ImportJobId, expectedRevision: number): Promise<void> {
    const validatedId = ImportJobIdSchema.parse(jobId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new ImportJobConflictError(
        "Expected import job revision is invalid.",
      );
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.#database
        .prepare(
          "DELETE FROM import_jobs_v2 WHERE job_id = ? AND revision = ?",
        )
        .run(validatedId, expectedRevision);
      if (Number(result.changes) !== 1) {
        throw new ImportJobConflictError(
          "Import job changed before it could be deleted.",
        );
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  async purgeAll(): Promise<number> {
    this.#database.exec("BEGIN IMMEDIATE");
    let changes: number;
    try {
      const result = this.#database
        .prepare("DELETE FROM import_jobs_v2")
        .run();
      changes = Number(result.changes);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    this.#database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return changes;
  }

  inspect(): Readonly<{
    foreignKeys: boolean;
    journalMode: string;
    synchronous: string;
    trustedSchema: boolean;
    secureDelete: boolean;
  }> {
    const pragma = (name: string): string | number => {
      const row = this.#database
        .prepare(`PRAGMA ${name}`)
        .get() as Record<string, string | number> | undefined;
      return row?.[name] ?? Object.values(row ?? {})[0] ?? "";
    };
    return Object.freeze({
      foreignKeys: Number(pragma("foreign_keys")) === 1,
      journalMode: String(pragma("journal_mode")).toLowerCase(),
      synchronous:
        Number(pragma("synchronous")) === 2 ? "full" : "unknown",
      trustedSchema: Number(pragma("trusted_schema")) === 1,
      secureDelete: Number(pragma("secure_delete")) === 1,
    });
  }

  close(): void {
    this.#database.close();
  }

  #load(jobId: ImportJobId): ImportJobSnapshotV2 | null {
    const row = this.#database
      .prepare(
        `SELECT job_json FROM import_jobs_v2 WHERE job_id = ?`,
      )
      .get(jobId) as ImportJobRow | undefined;
    if (row === undefined) {
      return null;
    }
    return freezeSnapshot(
      ImportJobSnapshotSchemaV2.parse(
        JSON.parse(row.job_json) as unknown,
      ),
    );
  }

  #validateDatabase(): void {
    const safety = this.inspect();
    if (
      !safety.foreignKeys ||
      safety.journalMode !== "wal" ||
      safety.synchronous !== "full" ||
      safety.trustedSchema ||
      !safety.secureDelete
    ) {
      throw new Error("Import job database safety pragmas are invalid.");
    }

    const row = this.#database
      .prepare(
        `SELECT sql FROM sqlite_schema
         WHERE type = 'table' AND name = 'import_jobs_v2'`,
      )
      .get() as { readonly sql: string } | undefined;
    const normalize = (sql: string): string =>
      sql
        .replace(/\bIF\s+NOT\s+EXISTS\b/giu, "")
        .replace(/\s+/gu, " ")
        .replace(/;\s*$/u, "")
        .trim()
        .toLowerCase();
    if (
      row === undefined ||
      !/\bSTRICT\s*;?\s*$/iu.test(row.sql) ||
      normalize(row.sql) !== normalize(IMPORT_JOBS_TABLE_SCHEMA)
    ) {
      throw new Error("Import job database schema is incompatible.");
    }
  }
}
