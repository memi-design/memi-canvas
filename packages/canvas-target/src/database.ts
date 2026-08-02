import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";

import {
  TARGET_AUTHORITY_SCHEMA,
  TARGET_AUTHORITY_SCHEMA_VERSION,
  TARGET_AUTHORITY_TABLES,
} from "./schema.js";

export type SqlValue =
  | string
  | number
  | bigint
  | null
  | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

interface DatabaseBootstrapFaults {
  readonly afterSchemaCreate?: () => void;
  readonly beforeWriteTransaction?: () => void;
}

const DATABASE_OPTIONS = {
  allowExtension: false,
  allowBareNamedParameters: false,
  allowUnknownNamedParameters: false,
  timeout: 5_000,
} as const;

let expectedManifest: string | undefined;

export function text(row: SqlRow, key: string): string {
  return String(row[key]);
}

export function integer(row: SqlRow, key: string): number {
  return Number(row[key]);
}

function normalizeSql(value: SqlValue): string | null {
  if (value === null) {
    return null;
  }
  return String(value).trim().replace(/\s+/gu, " ");
}

function applicationObjects(database: DatabaseSync): readonly SqlRow[] {
  return database
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    )
    .all() as readonly SqlRow[];
}

function tableStructure(
  database: DatabaseSync,
  table: string,
): object {
  const columns = (
    database
      .prepare(
        `SELECT cid, name, type, "notnull", dflt_value, pk, hidden
         FROM pragma_table_xinfo(?)
         ORDER BY cid`,
      )
      .all(table) as readonly SqlRow[]
  ).map((row) => ({
    cid: integer(row, "cid"),
    name: text(row, "name"),
    type: text(row, "type"),
    notnull: integer(row, "notnull"),
    defaultValue: row.dflt_value ?? null,
    primaryKey: integer(row, "pk"),
    hidden: integer(row, "hidden"),
  }));
  const uniqueIndexes = (
    database
      .prepare(
        `SELECT name, "unique", origin, partial
         FROM pragma_index_list(?)
         WHERE "unique" = 1
         ORDER BY name`,
      )
      .all(table) as readonly SqlRow[]
  ).map((index) => {
    const name = text(index, "name");
    const indexedColumns = (
      database
        .prepare(
          `SELECT seqno, cid, name
           FROM pragma_index_info(?)
           ORDER BY seqno`,
        )
        .all(name) as readonly SqlRow[]
    ).map((row) => ({
      sequence: integer(row, "seqno"),
      columnId: integer(row, "cid"),
      name: text(row, "name"),
    }));
    return {
      name,
      unique: integer(index, "unique"),
      origin: text(index, "origin"),
      partial: integer(index, "partial"),
      columns: indexedColumns,
    };
  });
  const foreignKeys = (
    database
      .prepare(
        `SELECT id, seq, "table", "from", "to",
                on_update, on_delete, match
         FROM pragma_foreign_key_list(?)
         ORDER BY id, seq`,
      )
      .all(table) as readonly SqlRow[]
  ).map((row) => ({
    id: integer(row, "id"),
    sequence: integer(row, "seq"),
    table: text(row, "table"),
    from: text(row, "from"),
    to: text(row, "to"),
    onUpdate: text(row, "on_update"),
    onDelete: text(row, "on_delete"),
    match: text(row, "match"),
  }));
  return { columns, uniqueIndexes, foreignKeys };
}

function structuralManifest(database: DatabaseSync): string {
  const objects = applicationObjects(database).map((row) => ({
    type: text(row, "type"),
    name: text(row, "name"),
    table: text(row, "tbl_name"),
    sql: normalizeSql(row.sql ?? null),
  }));
  const tables = Object.fromEntries(
    TARGET_AUTHORITY_TABLES.map((table) => [
      table,
      tableStructure(database, table),
    ]),
  );
  return JSON.stringify({ objects, tables });
}

function authoritativeManifest(): string {
  if (expectedManifest !== undefined) {
    return expectedManifest;
  }
  const reference = new DatabaseSync(":memory:", DATABASE_OPTIONS);
  try {
    reference.exec(TARGET_AUTHORITY_SCHEMA);
    expectedManifest = structuralManifest(reference);
    return expectedManifest;
  } finally {
    reference.close();
  }
}

function configureWriter(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = FULL;
    PRAGMA trusted_schema = OFF;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
  `);
}

function configureReader(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA trusted_schema = OFF;
    PRAGMA query_only = ON;
    PRAGMA busy_timeout = 5000;
  `);
}

export class TargetDatabase {
  readonly #path: string;
  readonly #raw: DatabaseSync;
  readonly #faults: DatabaseBootstrapFaults | undefined;
  readonly #readContext = new AsyncLocalStorage<DatabaseSync>();
  #closed = false;

  constructor(path: string, faults?: DatabaseBootstrapFaults) {
    this.#path = path;
    this.#faults = faults;
    this.#raw = new DatabaseSync(path, DATABASE_OPTIONS);
    try {
      const versionRow = this.#raw
        .prepare("PRAGMA user_version")
        .get() as SqlRow;
      const version = integer(versionRow, "user_version");
      this.validateDatabaseState(
        version,
        applicationObjects(this.#raw),
      );
      configureWriter(this.#raw);
      if (version === 0) {
        this.bootstrap(faults);
      }
      this.validateSchema();
    } catch (error) {
      this.#raw.close();
      throw error;
    }
  }

  transaction<T>(operation: () => T): T {
    this.assertOpen();
    this.#faults?.beforeWriteTransaction?.();
    this.#raw.exec("BEGIN IMMEDIATE");
    try {
      this.validateIntegrity();
      const result = operation();
      this.#raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.#raw.exec("ROLLBACK");
      throw error;
    }
  }

  async readTransaction<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    this.assertOpen();
    const current = this.#readContext.getStore();
    if (current !== undefined) {
      return operation();
    }
    const reader = new DatabaseSync(this.#path, {
      ...DATABASE_OPTIONS,
      readOnly: true,
    });
    try {
      configureReader(reader);
      reader.exec("BEGIN");
      try {
        const result = await this.#readContext.run(
          reader,
          operation,
        );
        reader.exec("COMMIT");
        return result;
      } catch (error) {
        reader.exec("ROLLBACK");
        throw error;
      }
    } finally {
      reader.close();
    }
  }

  one(
    sql: string,
    ...values: readonly SqlValue[]
  ): SqlRow | undefined {
    const database = this.#readContext.getStore();
    if (database === undefined) {
      this.assertOpen();
    }
    return (database ?? this.#raw).prepare(sql).get(...values) as
      | SqlRow
      | undefined;
  }

  run(sql: string, ...values: readonly SqlValue[]): number {
    this.assertOpen();
    return Number(this.#raw.prepare(sql).run(...values).changes);
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#raw.close();
  }

  private assertOpen(): void {
    if (this.#closed) {
      throw new Error("Canvas target database is closed.");
    }
  }

  private validateDatabaseState(
    version: number,
    objects: readonly SqlRow[],
  ): void {
    if (version > TARGET_AUTHORITY_SCHEMA_VERSION) {
      throw new Error(
        `Canvas target database has future version ${version}.`,
      );
    }
    if (version === 0) {
      if (objects.length > 0) {
        throw new Error(
          "Canvas target database is nonempty and unversioned.",
        );
      }
    } else if (version !== TARGET_AUTHORITY_SCHEMA_VERSION) {
      throw new Error(
        `Canvas target database version ${version} is unsupported.`,
      );
    }
  }

  private bootstrap(
    faults: DatabaseBootstrapFaults | undefined,
  ): void {
    this.#raw.exec("BEGIN IMMEDIATE");
    try {
      this.#raw.exec(TARGET_AUTHORITY_SCHEMA);
      faults?.afterSchemaCreate?.();
      this.#raw.exec(
        `PRAGMA user_version = ${TARGET_AUTHORITY_SCHEMA_VERSION}`,
      );
      this.#raw.exec("COMMIT");
    } catch (error) {
      this.#raw.exec("ROLLBACK");
      throw error;
    }
  }

  private validateSchema(): void {
    let actual: string;
    try {
      actual = structuralManifest(this.#raw);
    } catch (error) {
      throw new Error(
        "Canvas target structural manifest could not be read.",
        { cause: error },
      );
    }
    if (actual !== authoritativeManifest()) {
      throw new Error(
        "Canvas target structural manifest is incompatible.",
      );
    }
  }

  private validateIntegrity(): void {
    const integrityRows = this.#raw
      .prepare("PRAGMA integrity_check")
      .all() as readonly SqlRow[];
    const healthy =
      integrityRows.length === 1 &&
      text(integrityRows[0]!, "integrity_check") === "ok";
    if (!healthy) {
      throw new Error(
        "Canvas target database integrity check failed.",
      );
    }
    let violations: readonly SqlRow[];
    try {
      violations = this.#raw
        .prepare("PRAGMA foreign_key_check")
        .all() as readonly SqlRow[];
    } catch (error) {
      throw new Error(
        "Canvas target foreign key check failed.",
        { cause: error },
      );
    }
    if (violations.length > 0) {
      throw new Error(
        "Canvas target foreign key integrity check failed.",
      );
    }
  }
}
