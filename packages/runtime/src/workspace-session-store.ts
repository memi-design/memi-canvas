import { DatabaseSync } from "node:sqlite";

import {
  WORKSPACE_SESSION_MAX_BYTES,
  WorkspaceSessionDraftSchemaV1,
  WorkspaceSessionSnapshotSchemaV1,
  type MigrateLegacyWorkspaceSessionRequestV1,
  type MigrateLegacyWorkspaceSessionResultV1,
  type SaveWorkspaceSessionRequestV1,
  type WorkspaceSessionDraftV1,
  type WorkspaceSessionRuntimePortV1,
  type WorkspaceSessionSnapshotV1,
} from "@memi/protocol";

const MIGRATION_KEY_MAX_LENGTH = 512;
const LEGACY_HASH_PATTERN = /^fnv1a64:[a-f0-9]{16}$/u;
const WORKSPACE_SESSIONS_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS workspace_sessions (
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  session_revision INTEGER NOT NULL CHECK (session_revision > 0),
  document_revision INTEGER NOT NULL CHECK (document_revision >= 0),
  session_json TEXT NOT NULL CHECK (
    json_valid(session_json)
    AND length(CAST(session_json AS BLOB))
      BETWEEN 2 AND ${WORKSPACE_SESSION_MAX_BYTES}
  ),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, document_id)
) STRICT;`;
const WORKSPACE_SESSION_MIGRATIONS_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS workspace_session_migrations (
  migration_key TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  legacy_record_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('migrated', 'session-exists')
  ),
  session_revision INTEGER,
  created_at TEXT NOT NULL,
  CHECK (
    (status = 'migrated' AND session_revision = 1)
    OR
    (status = 'session-exists' AND session_revision > 0)
  )
) STRICT;`;
const MIGRATIONS_NO_UPDATE_TRIGGER_SCHEMA = `
CREATE TRIGGER IF NOT EXISTS workspace_session_migrations_no_update
BEFORE UPDATE ON workspace_session_migrations
BEGIN
  SELECT RAISE(
    ABORT,
    'workspace session migration evidence is immutable'
  );
END;`;
const MIGRATIONS_NO_DELETE_TRIGGER_SCHEMA = `
CREATE TRIGGER IF NOT EXISTS workspace_session_migrations_no_delete
BEFORE DELETE ON workspace_session_migrations
BEGIN
  SELECT RAISE(
    ABORT,
    'workspace session migration evidence is immutable'
  );
END;`;

interface WorkspaceSessionStoreOptions {
  readonly now?: () => string;
}

interface SessionRow {
  readonly session_json: string;
}

interface MigrationRow {
  readonly project_id: string;
  readonly document_id: string;
  readonly legacy_record_hash: string;
}

export class WorkspaceSessionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSessionConflictError";
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function freezeSnapshot(
  snapshot: WorkspaceSessionSnapshotV1,
): WorkspaceSessionSnapshotV1 {
  const cloned = structuredClone(snapshot);
  const freeze = (value: unknown): void => {
    if (value !== null && typeof value === "object") {
      Object.freeze(value);
      for (const child of Object.values(value)) {
        freeze(child);
      }
    }
  };
  freeze(cloned);
  return cloned;
}

function serializeSnapshot(snapshot: WorkspaceSessionSnapshotV1): string {
  const validated = WorkspaceSessionSnapshotSchemaV1.parse(snapshot);
  const serialized = JSON.stringify(validated);
  if (byteLength(serialized) > WORKSPACE_SESSION_MAX_BYTES) {
    throw new Error("Workspace session exceeds its durable payload limit.");
  }
  return serialized;
}

function validateDraft(
  draft: WorkspaceSessionDraftV1,
): WorkspaceSessionDraftV1 {
  const validated = WorkspaceSessionDraftSchemaV1.parse(draft);
  if (byteLength(JSON.stringify(validated)) > WORKSPACE_SESSION_MAX_BYTES) {
    throw new Error("Workspace session exceeds its durable payload limit.");
  }
  return validated;
}

export class SqliteWorkspaceSessionPort
  implements WorkspaceSessionRuntimePortV1
{
  readonly databasePath: string;
  readonly #database: DatabaseSync;
  readonly #now: () => string;

  constructor(
    databasePath: string,
    options: WorkspaceSessionStoreOptions = {},
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
        PRAGMA journal_mode = WAL;
        ${WORKSPACE_SESSIONS_TABLE_SCHEMA}
        ${WORKSPACE_SESSION_MIGRATIONS_TABLE_SCHEMA}
        ${MIGRATIONS_NO_UPDATE_TRIGGER_SCHEMA}
        ${MIGRATIONS_NO_DELETE_TRIGGER_SCHEMA}
      `);
      const json = this.#database
        .prepare("SELECT json_valid('{}') AS supported")
        .get() as { readonly supported: number };
      if (Number(json.supported) !== 1) {
        throw new Error("Workspace session storage requires SQLite JSON.");
      }
      this.#validateDatabase();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  async load(
    projectId: string,
    documentId: string,
  ): Promise<WorkspaceSessionSnapshotV1 | null> {
    this.#validateIdentity(projectId, "project");
    this.#validateIdentity(documentId, "document");
    return this.#load(projectId, documentId);
  }

  async save(
    request: SaveWorkspaceSessionRequestV1,
  ): Promise<WorkspaceSessionSnapshotV1> {
    const session = validateDraft(request.session);
    const expected = request.expectedSessionRevision;
    if (
      expected !== null &&
      (!Number.isInteger(expected) || expected < 1)
    ) {
      throw new WorkspaceSessionConflictError(
        "Expected workspace session revision is invalid.",
      );
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#load(session.projectId, session.documentId);
      if ((current?.sessionRevision ?? null) !== expected) {
        throw new WorkspaceSessionConflictError(
          "Workspace session changed after it was loaded.",
        );
      }
      if (
        current !== null &&
        session.documentRevision < current.documentRevision
      ) {
        throw new WorkspaceSessionConflictError(
          "Workspace document revision cannot regress.",
        );
      }
      const snapshot = this.#snapshot(
        session,
        (current?.sessionRevision ?? 0) + 1,
      );
      const serialized = serializeSnapshot(snapshot);
      if (current === null) {
        this.#database
          .prepare(
            `INSERT INTO workspace_sessions (
               project_id, document_id, session_revision,
               document_revision, session_json, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            snapshot.projectId,
            snapshot.documentId,
            snapshot.sessionRevision,
            snapshot.documentRevision,
            serialized,
            snapshot.updatedAt,
          );
      } else {
        const result = this.#database
          .prepare(
            `UPDATE workspace_sessions
             SET session_revision = ?, document_revision = ?,
                 session_json = ?, updated_at = ?
             WHERE project_id = ? AND document_id = ?
               AND session_revision = ?`,
          )
          .run(
            snapshot.sessionRevision,
            snapshot.documentRevision,
            serialized,
            snapshot.updatedAt,
            snapshot.projectId,
            snapshot.documentId,
            expected,
          );
        if (Number(result.changes) !== 1) {
          throw new WorkspaceSessionConflictError(
            "Workspace session compare-and-save lost its revision fence.",
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

  async migrateLegacy(
    request: MigrateLegacyWorkspaceSessionRequestV1,
  ): Promise<MigrateLegacyWorkspaceSessionResultV1> {
    const session = validateDraft(request.session);
    this.#validateMigrationRequest(request);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const evidence = this.#database
        .prepare(
          `SELECT project_id, document_id, legacy_record_hash
           FROM workspace_session_migrations
           WHERE migration_key = ?`,
        )
        .get(request.migrationKey) as MigrationRow | undefined;
      if (evidence !== undefined) {
        if (
          evidence.project_id !== session.projectId ||
          evidence.document_id !== session.documentId ||
          evidence.legacy_record_hash !== request.legacyRecordHash
        ) {
          throw new WorkspaceSessionConflictError(
            "Workspace session migration source changed after receipt.",
          );
        }
        const current = this.#load(session.projectId, session.documentId);
        this.#database.exec("COMMIT");
        return { status: "already-migrated", session: current };
      }

      const current = this.#load(session.projectId, session.documentId);
      const status = current === null ? "migrated" : "session-exists";
      const snapshot = current ?? this.#snapshot(session, 1);
      if (current === null) {
        const serialized = serializeSnapshot(snapshot);
        this.#database
          .prepare(
            `INSERT INTO workspace_sessions (
               project_id, document_id, session_revision,
               document_revision, session_json, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            snapshot.projectId,
            snapshot.documentId,
            snapshot.sessionRevision,
            snapshot.documentRevision,
            serialized,
            snapshot.updatedAt,
          );
      }
      this.#database
        .prepare(
          `INSERT INTO workspace_session_migrations (
             migration_key, project_id, document_id,
             legacy_record_hash, status, session_revision, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.migrationKey,
          session.projectId,
          session.documentId,
          request.legacyRecordHash,
          status,
          snapshot.sessionRevision,
          this.#now(),
        );
      this.#database.exec("COMMIT");
      return { status, session: snapshot };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }

  #load(
    projectId: string,
    documentId: string,
  ): WorkspaceSessionSnapshotV1 | null {
    const row = this.#database
      .prepare(
        `SELECT session_json FROM workspace_sessions
         WHERE project_id = ? AND document_id = ?`,
      )
      .get(projectId, documentId) as SessionRow | undefined;
    if (row === undefined) {
      return null;
    }
    return freezeSnapshot(
      WorkspaceSessionSnapshotSchemaV1.parse(
        JSON.parse(row.session_json) as unknown,
      ),
    );
  }

  #snapshot(
    session: WorkspaceSessionDraftV1,
    sessionRevision: number,
  ): WorkspaceSessionSnapshotV1 {
    return freezeSnapshot(
      WorkspaceSessionSnapshotSchemaV1.parse({
        ...session,
        sessionRevision,
        updatedAt: this.#now(),
      }),
    );
  }

  #validateIdentity(value: string, label: string): void {
    if (
      value.trim() !== value ||
      value.length < 1 ||
      value.length > 256
    ) {
      throw new Error(`Workspace ${label} identity is invalid.`);
    }
  }

  #validateMigrationRequest(
    request: MigrateLegacyWorkspaceSessionRequestV1,
  ): void {
    if (
      request.migrationKey.trim() !== request.migrationKey ||
      request.migrationKey.length < 1 ||
      request.migrationKey.length > MIGRATION_KEY_MAX_LENGTH
    ) {
      throw new Error("Workspace session migration key is invalid.");
    }
    if (!LEGACY_HASH_PATTERN.test(request.legacyRecordHash)) {
      throw new Error("Workspace session legacy record hash is invalid.");
    }
  }

  #validateDatabase(): void {
    const pragma = (name: string): string | number => {
      const row = this.#database
        .prepare(`PRAGMA ${name}`)
        .get() as Record<string, string | number> | undefined;
      return row?.[name] ?? Object.values(row ?? {})[0] ?? "";
    };
    if (
      Number(pragma("foreign_keys")) !== 1 ||
      Number(pragma("synchronous")) !== 2 ||
      Number(pragma("trusted_schema")) !== 0 ||
      String(pragma("journal_mode")).toLowerCase() !== "wal"
    ) {
      throw new Error("Workspace session database safety pragmas are invalid.");
    }

    const normalize = (sql: string): string =>
      sql
        .replace(/\bIF\s+NOT\s+EXISTS\b/giu, "")
        .replace(/\s+/gu, " ")
        .replace(/;\s*$/u, "")
        .trim()
        .toLowerCase();
    const expected = new Map([
      ["workspace_sessions", WORKSPACE_SESSIONS_TABLE_SCHEMA],
      [
        "workspace_session_migrations",
        WORKSPACE_SESSION_MIGRATIONS_TABLE_SCHEMA,
      ],
      [
        "workspace_session_migrations_no_update",
        MIGRATIONS_NO_UPDATE_TRIGGER_SCHEMA,
      ],
      [
        "workspace_session_migrations_no_delete",
        MIGRATIONS_NO_DELETE_TRIGGER_SCHEMA,
      ],
    ]);
    const rows = this.#database
      .prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE (type = 'table' AND name NOT LIKE 'sqlite_%')
            OR type = 'trigger'`,
      )
      .all() as unknown as readonly {
      readonly name: string;
      readonly sql: string;
    }[];
    if (
      rows.length !== expected.size ||
      rows.some(
        (row) =>
          expected.get(row.name) === undefined ||
          normalize(row.sql) !== normalize(expected.get(row.name) ?? ""),
      )
    ) {
      throw new Error("Workspace session database schema is incompatible.");
    }
  }
}
