import { Database } from "bun:sqlite";

import { redactLogMessage } from "@memi/capture-execution";
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

const TABLE = `
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

interface BunImportJobStoreOptions {
  readonly now?: () => string;
}

interface JobRow {
  readonly job_json: string;
}

export class BunImportJobConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportJobConflictError";
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function snapshot(value: unknown): ImportJobSnapshotV2 {
  return deepFreeze(
    structuredClone(ImportJobSnapshotSchemaV2.parse(value)),
  );
}

function draft(value: ImportJobDraftV2): ImportJobDraftV2 {
  return ImportJobDraftSchemaV2.parse({
    ...value,
    logs: value.logs.map((entry) => ({
      ...entry,
      message: redactLogMessage(entry.message),
    })),
    failures: value.failures.map((failure) => ({
      ...failure,
      message: redactLogMessage(failure.message),
      remediation: redactLogMessage(failure.remediation),
      logTail: failure.logTail.map((entry) =>
        redactLogMessage(entry),
      ),
    })),
  });
}

function serialized(value: ImportJobSnapshotV2): string {
  const result = JSON.stringify(
    ImportJobSnapshotSchemaV2.parse(value),
  );
  if (new TextEncoder().encode(result).byteLength > IMPORT_JOB_MAX_BYTES) {
    throw new Error("Import job exceeds its durable payload limit.");
  }
  return result;
}

export class BunSqliteImportJobStore implements ImportJobStoreV2 {
  readonly databasePath: string;
  readonly #database: Database;
  readonly #now: () => string;

  constructor(
    databasePath: string,
    options: BunImportJobStoreOptions = {},
  ) {
    this.databasePath = databasePath;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#database = new Database(databasePath, {
      create: true,
      readwrite: true,
      strict: true,
    });
    try {
      this.#database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA synchronous = FULL;
        PRAGMA trusted_schema = OFF;
        PRAGMA secure_delete = ON;
        PRAGMA journal_mode = WAL;
        ${TABLE}
      `);
      this.#validateDatabase();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  async get(jobId: ImportJobId): Promise<ImportJobSnapshotV2 | null> {
    return this.#load(ImportJobIdSchema.parse(jobId));
  }

  async listRecoverable(): Promise<
    readonly ImportJobSnapshotV2[]
  > {
    return this.#database
      .query<JobRow>(
        `SELECT job_json
         FROM import_jobs_v2
         WHERE state = 'running'
         ORDER BY updated_at ASC, job_id ASC`,
      )
      .all()
      .map(({ job_json }) =>
        snapshot(JSON.parse(job_json) as unknown),
      );
  }

  async listAll(): Promise<readonly ImportJobSnapshotV2[]> {
    return this.#database
      .query<JobRow>(
        `SELECT job_json
         FROM import_jobs_v2
         ORDER BY updated_at ASC, job_id ASC`,
      )
      .all()
      .map(({ job_json }) =>
        snapshot(JSON.parse(job_json) as unknown),
      );
  }

  async save(
    request: SaveImportJobRequestV2,
  ): Promise<ImportJobSnapshotV2> {
    const nextDraft = draft(request.job);
    const expected = request.expectedRevision;
    if (
      expected !== null &&
      (!Number.isSafeInteger(expected) || expected < 1)
    ) {
      throw new BunImportJobConflictError(
        "Expected import job revision is invalid.",
      );
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#load(nextDraft.id);
      if ((current?.revision ?? null) !== expected) {
        throw new BunImportJobConflictError(
          "Import job changed after it was loaded.",
        );
      }
      const next = snapshot({
        ...nextDraft,
        revision: (current?.revision ?? 0) + 1,
        updatedAt: this.#now(),
      });
      const json = serialized(next);
      if (current === null) {
        this.#database
          .query(
            `INSERT INTO import_jobs_v2 (
               job_id, revision, state, stage, project_id,
               job_json, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            next.id,
            next.revision,
            next.state,
            next.stage,
            next.projectId,
            json,
            next.updatedAt,
          );
      } else {
        const result = this.#database
          .query(
            `UPDATE import_jobs_v2
             SET revision = ?, state = ?, stage = ?, project_id = ?,
                 job_json = ?, updated_at = ?
             WHERE job_id = ? AND revision = ?`,
          )
          .run(
            next.revision,
            next.state,
            next.stage,
            next.projectId,
            json,
            next.updatedAt,
            next.id,
            expected,
          );
        if (Number(result.changes) !== 1) {
          throw new BunImportJobConflictError(
            "Import job compare-and-save lost its revision fence.",
          );
        }
      }
      this.#database.exec("COMMIT");
      return next;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  async delete(jobId: ImportJobId, expectedRevision: number): Promise<void> {
    const validatedId = ImportJobIdSchema.parse(jobId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new BunImportJobConflictError(
        "Expected import job revision is invalid.",
      );
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.#database
        .query(
          "DELETE FROM import_jobs_v2 WHERE job_id = ? AND revision = ?",
        )
        .run(validatedId, expectedRevision);
      if (Number(result.changes) !== 1) {
        throw new BunImportJobConflictError(
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
    try {
      const result = this.#database
        .query("DELETE FROM import_jobs_v2")
        .run();
      this.#database.exec("COMMIT");
      this.#database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      return Number(result.changes);
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  inspect(): Readonly<{
    foreignKeys: boolean;
    journalMode: string;
    secureDelete: boolean;
    synchronous: string;
    trustedSchema: boolean;
  }> {
    const pragma = (name: string): string | number => {
      const row = this.#database
        .query<Record<string, string | number>>(`PRAGMA ${name}`)
        .get();
      return row?.[name] ?? Object.values(row ?? {})[0] ?? "";
    };
    return Object.freeze({
      foreignKeys: Number(pragma("foreign_keys")) === 1,
      journalMode: String(pragma("journal_mode")).toLowerCase(),
      secureDelete: Number(pragma("secure_delete")) === 1,
      synchronous:
        Number(pragma("synchronous")) === 2 ? "full" : "unknown",
      trustedSchema: Number(pragma("trusted_schema")) === 1,
    });
  }

  close(): void {
    this.#database.close();
  }

  #load(jobId: ImportJobId): ImportJobSnapshotV2 | null {
    const row = this.#database
      .query<JobRow>(
        "SELECT job_json FROM import_jobs_v2 WHERE job_id = ?",
      )
      .get(jobId);
    return row === null
      ? null
      : snapshot(JSON.parse(row.job_json) as unknown);
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
      throw new Error(
        "Bun import job database safety configuration is invalid.",
      );
    }
    const columns = this.#database
      .query<{ readonly name: string }>(
        "PRAGMA table_info(import_jobs_v2)",
      )
      .all()
      .map(({ name }) => name)
      .sort();
    const expected = [
      "job_id",
      "job_json",
      "project_id",
      "revision",
      "stage",
      "state",
      "updated_at",
    ].sort();
    if (
      columns.length !== expected.length ||
      columns.some((name, index) => name !== expected[index])
    ) {
      throw new Error(
        "Existing Bun import job database schema is incompatible.",
      );
    }
  }
}
