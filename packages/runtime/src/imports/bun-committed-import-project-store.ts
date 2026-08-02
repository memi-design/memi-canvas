import { Database } from "bun:sqlite";

import type { ProjectId } from "@memi/protocol";
import { ProjectIdSchema } from "@memi/protocol";

import type {
  CommittedImportedProjectRecord,
  CommittedImportedProjectStore,
} from "./committed-import-project-store.js";
import {
  parseCommittedImportedProjectRecord,
} from "./committed-import-project-store.js";

const TABLE = `
CREATE TABLE IF NOT EXISTS committed_imported_projects_v1 (
  project_id TEXT PRIMARY KEY,
  record_json TEXT NOT NULL CHECK (
    json_valid(record_json)
    AND length(CAST(record_json AS BLOB)) BETWEEN 2 AND 8388608
  ),
  updated_at TEXT NOT NULL
) STRICT;`;

interface ProjectRow {
  readonly record_json: string;
}

export class BunSqliteCommittedImportedProjectStore
  implements CommittedImportedProjectStore
{
  readonly databasePath: string;
  readonly #database: Database;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
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

  async save(record: CommittedImportedProjectRecord): Promise<void> {
    const parsed = parseCommittedImportedProjectRecord(record);
    this.#database
      .query(
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
    const row = this.#database
      .query<ProjectRow>(
        `SELECT record_json
         FROM committed_imported_projects_v1
         WHERE project_id = ?`,
      )
      .get(ProjectIdSchema.parse(projectId));
    return row === null
      ? null
      : parseCommittedImportedProjectRecord(
          JSON.parse(row.record_json) as unknown,
        );
  }

  async purgeAll(): Promise<number> {
    const result = this.#database
      .query("DELETE FROM committed_imported_projects_v1")
      .run();
    this.#database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return Number(result.changes);
  }

  close(): void {
    this.#database.close();
  }

  #validateDatabase(): void {
    const pragma = (name: string): string | number => {
      const row = this.#database
        .query<Record<string, string | number>>(`PRAGMA ${name}`)
        .get();
      return row?.[name] ?? Object.values(row ?? {})[0] ?? "";
    };
    if (
      Number(pragma("foreign_keys")) !== 1 ||
      String(pragma("journal_mode")).toLowerCase() !== "wal" ||
      Number(pragma("synchronous")) !== 2 ||
      Number(pragma("trusted_schema")) !== 0 ||
      Number(pragma("secure_delete")) !== 1
    ) {
      throw new Error(
        "Bun committed imported project database safety configuration is invalid.",
      );
    }
    const columns = this.#database
      .query<{ readonly name: string }>(
        "PRAGMA table_info(committed_imported_projects_v1)",
      )
      .all()
      .map(({ name }) => name)
      .sort();
    const expected = [
      "project_id",
      "record_json",
      "updated_at",
    ];
    if (
      columns.length !== expected.length ||
      expected.some((name, index) => columns[index] !== name)
    ) {
      throw new Error(
        "Committed imported project table shape is invalid.",
      );
    }
  }
}
