import { DatabaseSync } from "node:sqlite";

import {
  CanvasDocumentAppendReceiptV3Schema,
  CanvasDocumentAppendV3Schema,
  CanvasDocumentIdentityV3Schema,
  CanvasDocumentJournalV3Schema,
  CanvasDocumentSnapshotV3Schema,
  type CanvasDocumentAppendReceiptV3,
  type CanvasDocumentAppendV3,
  type CanvasDocumentIdentityV3,
  type CanvasDocumentJournalV3,
  type CanvasDocumentSnapshotV3,
  type CanvasDocumentV3,
  type CanvasDocumentV3PersistencePort,
  type CanvasOperationV3,
} from "@memi/protocol";
import {
  applyCanvasOperationV3,
  hashCanvasDocumentV3,
} from "@memi/canvas-document";

const MAX_SNAPSHOT_BYTES = 64_000_000;
const MAX_OPERATION_BYTES = 2_000_000;
const MAX_OPERATIONS = 10_000;

const SNAPSHOTS_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS canvas_document_v3_snapshots (
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  state_hash TEXT NOT NULL CHECK (
    length(state_hash) = 71 AND state_hash GLOB 'sha256:[0-9a-f]*'
  ),
  snapshot_json TEXT NOT NULL CHECK (
    json_valid(snapshot_json)
    AND length(CAST(snapshot_json AS BLOB))
      BETWEEN 2 AND ${MAX_SNAPSHOT_BYTES}
  ),
  persisted_at TEXT NOT NULL,
  PRIMARY KEY (project_id, document_id)
) STRICT;`;

const OPERATIONS_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS canvas_document_v3_operations (
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  resulting_hash TEXT NOT NULL CHECK (
    length(resulting_hash) = 71 AND resulting_hash GLOB 'sha256:[0-9a-f]*'
  ),
  operation_bytes INTEGER NOT NULL CHECK (
    operation_bytes BETWEEN 2 AND ${MAX_OPERATION_BYTES}
  ),
  operation_json TEXT NOT NULL CHECK (
    json_valid(operation_json)
    AND length(CAST(operation_json AS BLOB)) = operation_bytes
  ),
  PRIMARY KEY (project_id, document_id, revision),
  UNIQUE (project_id, document_id, operation_id),
  FOREIGN KEY (project_id, document_id)
    REFERENCES canvas_document_v3_snapshots(project_id, document_id)
    ON DELETE CASCADE
) STRICT;`;

interface SnapshotRow {
  readonly revision: number;
  readonly state_hash: string;
  readonly snapshot_json: string;
}

interface OperationRow {
  readonly operation_bytes: number;
  readonly operation_id: string;
  readonly operation_json: string;
  readonly resulting_hash: string;
  readonly revision: number;
}

interface ExistingOperationRow {
  readonly operation_json: string;
  readonly resulting_hash: string;
  readonly revision: number;
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

function freeze<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function sameIdentity(
  left: CanvasDocumentIdentityV3,
  right: CanvasDocumentIdentityV3,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.documentId === right.documentId
  );
}

function validateDocument(document: CanvasDocumentV3): CanvasDocumentV3 {
  const snapshot = CanvasDocumentSnapshotV3Schema.shape.document.parse(document);
  if (hashCanvasDocumentV3(snapshot) !== snapshot.stateHash) {
    throw new CanvasDocumentV3JournalConflictError(
      "CanvasDocumentV3 state hash is invalid.",
    );
  }
  return snapshot;
}

function serializeSnapshot(snapshot: CanvasDocumentSnapshotV3): string {
  const serialized = JSON.stringify(CanvasDocumentSnapshotV3Schema.parse(snapshot));
  if (byteLength(serialized) > MAX_SNAPSHOT_BYTES) {
    throw new CanvasDocumentV3JournalConflictError(
      "CanvasDocumentV3 snapshot exceeds its durable payload limit.",
    );
  }
  return serialized;
}

function serializeOperation(operation: CanvasOperationV3): string {
  const serialized = JSON.stringify(operation);
  if (byteLength(serialized) > MAX_OPERATION_BYTES) {
    throw new CanvasDocumentV3JournalConflictError(
      "CanvasDocumentV3 operation exceeds its durable payload limit.",
    );
  }
  return serialized;
}

function normalizeSchema(sql: string): string {
  return sql
    .replace(/\bIF\s+NOT\s+EXISTS\b/giu, "")
    .replace(/\s+/gu, " ")
    .replace(/;\s*$/u, "")
    .trim()
    .toLowerCase();
}

export class CanvasDocumentV3JournalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasDocumentV3JournalConflictError";
  }
}

/**
 * A standalone, SQLite WAL-backed authority for a V3 document's semantic
 * snapshot and append-only operation journal. The composite key preserves the
 * project/document identity exactly, so a legacy document ID can never collide
 * across projects during migration or recovery.
 */
export class SqliteCanvasDocumentV3PersistencePort
  implements CanvasDocumentV3PersistencePort
{
  readonly databasePath: string;
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
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
        ${SNAPSHOTS_TABLE_SCHEMA}
        ${OPERATIONS_TABLE_SCHEMA}
      `);
      const json = this.#database
        .prepare("SELECT json_valid('{}') AS supported")
        .get() as { readonly supported: number };
      if (Number(json.supported) !== 1) {
        throw new Error("Canvas document journal requires SQLite JSON.");
      }
      this.#validateDatabase();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  async load(
    untrustedIdentity: CanvasDocumentIdentityV3,
  ): Promise<CanvasDocumentJournalV3 | null> {
    const identity = CanvasDocumentIdentityV3Schema.parse(untrustedIdentity);
    return this.#readTransaction(() => this.#load(identity));
  }

  async initialize(
    untrustedSnapshot: CanvasDocumentSnapshotV3,
  ): Promise<void> {
    const snapshot = this.#validateSnapshot(untrustedSnapshot);
    const serialized = serializeSnapshot(snapshot);
    this.#writeTransaction(() => {
      const existing = this.#load(snapshot.identity);
      if (existing !== null) {
        const persisted = existing.snapshot.document;
        if (
          existing.operations.length === 0 &&
          persisted.revision === snapshot.document.revision &&
          persisted.stateHash === snapshot.document.stateHash
        ) {
          return;
        }
        throw new CanvasDocumentV3JournalConflictError(
          "CanvasDocumentV3 already exists with a different state.",
        );
      }
      this.#database
        .prepare(
          `INSERT INTO canvas_document_v3_snapshots (
             project_id, document_id, revision, state_hash,
             snapshot_json, persisted_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          snapshot.identity.projectId,
          snapshot.identity.documentId,
          snapshot.document.revision,
          snapshot.document.stateHash,
          serialized,
          snapshot.persistedAt,
        );
    });
  }

  async append(
    untrustedRequest: CanvasDocumentAppendV3,
  ): Promise<CanvasDocumentAppendReceiptV3> {
    const request = CanvasDocumentAppendV3Schema.parse(untrustedRequest);
    const serialized = serializeOperation(request.operation);
    return this.#writeTransaction(() => {
      const existing = this.#database
        .prepare(
          `SELECT revision, resulting_hash, operation_json
           FROM canvas_document_v3_operations
           WHERE project_id = ? AND document_id = ? AND operation_id = ?`,
        )
        .get(
          request.identity.projectId,
          request.identity.documentId,
          request.operation.id,
        ) as ExistingOperationRow | undefined;
      if (existing !== undefined) {
        if (existing.operation_json !== serialized) {
          throw new CanvasDocumentV3JournalConflictError(
            "CanvasDocumentV3 operation ID was reused with different content.",
          );
        }
        return freeze(
          CanvasDocumentAppendReceiptV3Schema.parse({
            schemaVersion: 1,
            identity: request.identity,
            operationId: request.operation.id,
            revision: existing.revision,
            stateHash: existing.resulting_hash,
          }),
        );
      }

      const journal = this.#load(request.identity);
      if (journal === null) {
        throw new CanvasDocumentV3JournalConflictError(
          "CanvasDocumentV3 must be initialized before it can append operations.",
        );
      }
      if (journal.operations.length >= MAX_OPERATIONS) {
        throw new CanvasDocumentV3JournalConflictError(
          "CanvasDocumentV3 journal requires a checkpoint before more operations can append.",
        );
      }
      const current = this.#replay(journal);
      let resulting: CanvasDocumentV3;
      try {
        resulting = applyCanvasOperationV3(current, request.operation);
      } catch (error) {
        throw new CanvasDocumentV3JournalConflictError(
          error instanceof Error
            ? `CanvasDocumentV3 append rejected: ${error.message}`
            : "CanvasDocumentV3 append rejected.",
        );
      }
      this.#database
        .prepare(
          `INSERT INTO canvas_document_v3_operations (
             project_id, document_id, operation_id, revision,
             resulting_hash, operation_bytes, operation_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.identity.projectId,
          request.identity.documentId,
          request.operation.id,
          resulting.revision,
          resulting.stateHash,
          byteLength(serialized),
          serialized,
        );
      return freeze(
        CanvasDocumentAppendReceiptV3Schema.parse({
          schemaVersion: 1,
          identity: request.identity,
          operationId: request.operation.id,
          revision: resulting.revision,
          stateHash: resulting.stateHash,
        }),
      );
    });
  }

  async checkpoint(
    untrustedSnapshot: CanvasDocumentSnapshotV3,
  ): Promise<void> {
    const snapshot = this.#validateSnapshot(untrustedSnapshot);
    const serialized = serializeSnapshot(snapshot);
    this.#writeTransaction(() => {
      const journal = this.#load(snapshot.identity);
      if (journal === null) {
        throw new CanvasDocumentV3JournalConflictError(
          "CanvasDocumentV3 must be initialized before checkpointing.",
        );
      }
      const current = this.#replay(journal);
      if (
        current.revision !== snapshot.document.revision ||
        current.stateHash !== snapshot.document.stateHash
      ) {
        throw new CanvasDocumentV3JournalConflictError(
          "CanvasDocumentV3 checkpoint does not match the current journal state.",
        );
      }
      const changed = this.#database
        .prepare(
          `UPDATE canvas_document_v3_snapshots
           SET revision = ?, state_hash = ?, snapshot_json = ?, persisted_at = ?
           WHERE project_id = ? AND document_id = ?`,
        )
        .run(
          snapshot.document.revision,
          snapshot.document.stateHash,
          serialized,
          snapshot.persistedAt,
          snapshot.identity.projectId,
          snapshot.identity.documentId,
        );
      if (Number(changed.changes) !== 1) {
        throw new CanvasDocumentV3JournalConflictError(
          "CanvasDocumentV3 checkpoint lost its identity fence.",
        );
      }
      this.#database
        .prepare(
          `DELETE FROM canvas_document_v3_operations
           WHERE project_id = ? AND document_id = ?`,
        )
        .run(snapshot.identity.projectId, snapshot.identity.documentId);
    });
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
        .prepare(`PRAGMA ${name}`)
        .get() as Record<string, string | number> | undefined;
      return row?.[name] ?? Object.values(row ?? {})[0] ?? "";
    };
    return Object.freeze({
      foreignKeys: Number(pragma("foreign_keys")) === 1,
      journalMode: String(pragma("journal_mode")).toLowerCase(),
      secureDelete: Number(pragma("secure_delete")) === 1,
      synchronous: Number(pragma("synchronous")) === 2 ? "full" : "unknown",
      trustedSchema: Number(pragma("trusted_schema")) === 1,
    });
  }

  close(): void {
    this.#database.close();
  }

  #validateSnapshot(
    untrustedSnapshot: CanvasDocumentSnapshotV3,
  ): CanvasDocumentSnapshotV3 {
    const snapshot = CanvasDocumentSnapshotV3Schema.parse(untrustedSnapshot);
    validateDocument(snapshot.document);
    return snapshot;
  }

  #load(identity: CanvasDocumentIdentityV3): CanvasDocumentJournalV3 | null {
    const snapshotRow = this.#database
      .prepare(
        `SELECT revision, state_hash, snapshot_json
         FROM canvas_document_v3_snapshots
         WHERE project_id = ? AND document_id = ?`,
      )
      .get(identity.projectId, identity.documentId) as SnapshotRow | undefined;
    if (snapshotRow === undefined) {
      return null;
    }
    const snapshot = this.#validateSnapshot(
      JSON.parse(snapshotRow.snapshot_json) as CanvasDocumentSnapshotV3,
    );
    if (
      snapshotRow.revision !== snapshot.document.revision ||
      snapshotRow.state_hash !== snapshot.document.stateHash
    ) {
      throw new CanvasDocumentV3JournalConflictError(
        "CanvasDocumentV3 snapshot index is corrupt.",
      );
    }
    if (!sameIdentity(snapshot.identity, identity)) {
      throw new CanvasDocumentV3JournalConflictError(
        "CanvasDocumentV3 snapshot identity is corrupt.",
      );
    }
    const rows = this.#database
      .prepare(
        `SELECT operation_id, revision, resulting_hash, operation_bytes, operation_json
         FROM canvas_document_v3_operations
         WHERE project_id = ? AND document_id = ?
         ORDER BY revision ASC`,
      )
      .all(identity.projectId, identity.documentId) as unknown as readonly OperationRow[];
    if (rows.length > MAX_OPERATIONS) {
      throw new CanvasDocumentV3JournalConflictError(
        "CanvasDocumentV3 journal exceeds its operation limit.",
      );
    }
    const operations = rows.map((row, index) => {
      const operation = CanvasDocumentAppendV3Schema.shape.operation.parse(
        JSON.parse(row.operation_json) as unknown,
      );
      if (
        operation.id !== row.operation_id ||
        operation.documentId !== identity.documentId ||
        row.revision !== snapshot.document.revision + index + 1 ||
        row.resulting_hash !== operation.resultingHash ||
        row.operation_bytes !== byteLength(row.operation_json)
      ) {
        throw new CanvasDocumentV3JournalConflictError(
          "CanvasDocumentV3 operation journal row is corrupt.",
        );
      }
      return operation;
    });
    const operationBytes = rows.reduce(
      (total, row) => total + row.operation_bytes,
      0,
    );
    const journal = CanvasDocumentJournalV3Schema.parse({
      schemaVersion: 1,
      kind: "canvas-document-v3-journal",
      identity,
      snapshot,
      operations,
      operationBytes,
    });
    this.#replay(journal);
    return freeze(journal);
  }

  #replay(journal: CanvasDocumentJournalV3): CanvasDocumentV3 {
    let document = validateDocument(journal.snapshot.document);
    for (const operation of journal.operations) {
      try {
        document = applyCanvasOperationV3(document, operation);
      } catch (error) {
        throw new CanvasDocumentV3JournalConflictError(
          error instanceof Error
            ? `CanvasDocumentV3 journal replay failed: ${error.message}`
            : "CanvasDocumentV3 journal replay failed.",
        );
      }
    }
    return document;
  }

  #readTransaction<Result>(read: () => Result): Result {
    this.#database.exec("BEGIN");
    try {
      const result = read();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #writeTransaction<Result>(write: () => Result): Result {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = write();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
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
      throw new Error("CanvasDocumentV3 journal database safety pragmas are invalid.");
    }
    const expected = new Map([
      ["canvas_document_v3_snapshots", SNAPSHOTS_TABLE_SCHEMA],
      ["canvas_document_v3_operations", OPERATIONS_TABLE_SCHEMA],
    ]);
    const rows = this.#database
      .prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE type = 'table'
           AND name IN (
             'canvas_document_v3_snapshots',
             'canvas_document_v3_operations'
           )`,
      )
      .all() as unknown as readonly { readonly name: string; readonly sql: string }[];
    if (
      rows.length !== expected.size ||
      rows.some(
        (row) =>
          expected.get(row.name) === undefined ||
          !/\bSTRICT\s*;?\s*$/iu.test(row.sql) ||
          normalizeSchema(row.sql) !== normalizeSchema(expected.get(row.name) ?? ""),
      )
    ) {
      throw new Error("CanvasDocumentV3 journal database schema is incompatible.");
    }
  }
}
