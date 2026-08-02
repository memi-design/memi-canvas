import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import { createCanvasDocument } from "@memi/canvas-document";

import { CanvasTargetAuthority } from "./index.js";
import { TARGET_AUTHORITY_SCHEMA } from "./schema.js";
import {
  NOW,
  cleanupTemporaryDirectories,
  databasePath,
  documentFixture,
  fenceFor,
  ids,
  operationFor,
  requestFor,
  sortableId,
} from "./test-fixtures.js";

const CURRENT_DATABASE_VERSION = 1;
const MAX_JSON_BYTES = 1_048_576;

function rawDatabase(path: string): DatabaseSync {
  return new DatabaseSync(path, {
    allowExtension: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
  });
}

function installSchema(
  path: string,
  schema: string,
  version = CURRENT_DATABASE_VERSION,
): void {
  const database = rawDatabase(path);
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      ${schema}
      PRAGMA user_version = ${version};
    `);
  } finally {
    database.close();
  }
}

function expectOpenFailure(path: string, pattern: RegExp): void {
  expect(
    () =>
      new CanvasTargetAuthority({
        databasePath: path,
        clock: () => NOW,
      }),
  ).toThrow(pattern);
}

async function appliedDatabase(): Promise<{
  readonly path: string;
  readonly request: ReturnType<typeof requestFor>;
}> {
  const path = databasePath();
  const authority = new CanvasTargetAuthority({
    databasePath: path,
    clock: () => NOW,
  });
  const document = documentFixture();
  const request = requestFor(
    document,
    operationFor(document, "1"),
    "1",
  );
  authority.createDocument(document);
  authority.activateFence(fenceFor(request));
  const outcome = await authority.compareAndApply(request);
  if (outcome.status !== "applied") {
    throw new Error("Expected database fixture to apply.");
  }
  authority.close();
  return { path, request };
}

afterEach(() => {
  cleanupTemporaryDirectories();
});

describe("canvas target database versioning", () => {
  it("atomically bootstraps an empty database at version one", () => {
    const path = databasePath();
    const authority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    const database = rawDatabase(path);
    expect(
      database.prepare("PRAGMA user_version").get(),
    ).toEqual({ user_version: CURRENT_DATABASE_VERSION });
    database.close();
    authority.close();
  });

  it("reopens the exact manifest with stable autoindexes", () => {
    const path = databasePath();
    const first = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    first.close();
    const before = rawDatabase(path);
    const beforeIndexes = before
      .prepare(
        `SELECT name, tbl_name
         FROM sqlite_schema
         WHERE type = 'index'
         ORDER BY name`,
      )
      .all();
    before.close();

    const reopened = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    reopened.close();
    const after = rawDatabase(path);
    const afterIndexes = after
      .prepare(
        `SELECT name, tbl_name
         FROM sqlite_schema
         WHERE type = 'index'
         ORDER BY name`,
      )
      .all();
    after.close();

    expect(afterIndexes).toEqual(beforeIndexes);
    expect(afterIndexes.length).toBeGreaterThan(0);
  });

  it("rejects a future database version without bootstrapping", () => {
    const path = databasePath();
    const database = rawDatabase(path);
    database.exec("PRAGMA user_version = 2");
    database.close();

    expectOpenFailure(path, /future|version/i);
    const inspected = rawDatabase(path);
    expect(
      inspected
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
        )
        .get(),
    ).toEqual({ count: 0 });
    inspected.close();
  });

  it.each([
    [
      "nonempty unversioned",
      `CREATE TABLE unrelated (id TEXT PRIMARY KEY) STRICT;`,
    ],
    [
      "partially bootstrapped",
      `CREATE TABLE documents (
        project_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        PRIMARY KEY (project_id, target_id)
      ) STRICT;`,
    ],
    ["current-version empty", ""],
  ])("rejects a %s database", (_label, schema) => {
    const path = databasePath();
    const database = rawDatabase(path);
    database.exec(schema);
    if (_label === "current-version empty") {
      database.exec(
        `PRAGMA user_version = ${CURRENT_DATABASE_VERSION}`,
      );
    }
    database.close();
    expectOpenFailure(
      path,
      /version|schema|manifest|unversioned|partial/i,
    );
  });

  it("rejects a complete but unversioned database", () => {
    const path = databasePath();
    installSchema(path, TARGET_AUTHORITY_SCHEMA, 0);
    expectOpenFailure(path, /unversioned|version/i);
  });

  it("rolls back every bootstrap object when bootstrap fails", () => {
    const path = databasePath();
    const options = {
      databasePath: path,
      clock: () => NOW,
      faults: {
        afterSchemaCreate: () => {
          throw new Error("injected bootstrap failure");
        },
      },
    } as unknown as ConstructorParameters<
      typeof CanvasTargetAuthority
    >[0];

    expect(() => new CanvasTargetAuthority(options)).toThrow(
      /injected bootstrap failure/i,
    );
    const database = rawDatabase(path);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 0,
    });
    database.close();

    const recovered = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    recovered.close();
  });
});

describe("canvas target structural manifest", () => {
  it.each([
    [
      "wrong column",
      TARGET_AUTHORITY_SCHEMA.replaceAll(
        "document_record_hash",
        "wrong_record_hash",
      ),
    ],
    [
      "missing CHECK",
      TARGET_AUTHORITY_SCHEMA.replace(
        "revision INTEGER NOT NULL CHECK (revision >= 0)",
        "revision INTEGER NOT NULL",
      ),
    ],
    [
      "missing composite unique index",
      TARGET_AUTHORITY_SCHEMA.replace(
        "UNIQUE (project_id, target_id, command_id, receipt_hash),",
        "",
      ),
    ],
    [
      "wrong composite foreign key",
      TARGET_AUTHORITY_SCHEMA.replace(
        `FOREIGN KEY (project_id, target_id, command_id, receipt_hash)
    REFERENCES receipts (
      project_id, target_id, command_id, receipt_hash
    )`,
        `FOREIGN KEY (receipt_hash)
    REFERENCES receipts (receipt_hash)`,
      ),
    ],
  ])("rejects a schema with a %s", (_label, schema) => {
    expect(schema).not.toBe(TARGET_AUTHORITY_SCHEMA);
    const path = databasePath();
    installSchema(path, schema);
    expectOpenFailure(
      path,
      /column|constraint|foreign|index|manifest|schema/i,
    );
  });
});

describe("canvas target database constraints and checks", () => {
  it("does not mutate after cross-process corruption races the write lock", () => {
    const path = databasePath();
    let injectRace = false;
    const authority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
      faults: {
        beforeWriteTransaction: () => {
          if (!injectRace) {
            return;
          }
          injectRace = false;
          const script = `
            import { DatabaseSync } from "node:sqlite";
            const database = new DatabaseSync(process.argv[1]);
            database.exec("PRAGMA ignore_check_constraints = ON");
            database.exec("BEGIN IMMEDIATE");
            database.prepare(
              "UPDATE documents SET revision = -1 " +
              "WHERE project_id = ? AND target_id = ?"
            ).run(process.argv[2], process.argv[3]);
            database.exec("COMMIT");
            database.close();
          `;
          const child = spawnSync(
            process.execPath,
            ["--input-type=module", "-e", script, path, ids.project, ids.document],
            { encoding: "utf8", timeout: 5_000 },
          );
          if (child.status !== 0) {
            throw new Error(
              `Cross-process corruption failed: ${child.stderr}`,
            );
          }
        },
      },
    });
    authority.createDocument(documentFixture());
    injectRace = true;
    let mutationError: unknown;
    try {
      authority.createDocument(
        createCanvasDocument({
          projectId: ids.project,
          id: sortableId("doc", "2"),
        }),
      );
    } catch (error) {
      mutationError = error;
    }
    authority.close();

    const database = rawDatabase(path);
    const intended = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM documents
         WHERE project_id = ? AND target_id = ?`,
      )
      .get(ids.project, sortableId("doc", "2"));
    database.close();

    expect(mutationError).toBeInstanceOf(Error);
    expect(String(mutationError)).toMatch(/integrity check failed/i);
    expect(intended).toEqual({ count: 0 });
  });

  it.each([
    ["document revision", "documents", "revision", -1],
    ["fence epoch", "target_fences", "highest_fence", 0],
    ["operation revision", "operations", "applied_revision", 0],
    ["ledger fence", "idempotency_ledger", "fencing_epoch", 0],
    [
      "ledger claim epoch",
      "idempotency_ledger",
      "worker_claim_epoch",
      0,
    ],
    [
      "ledger applied revision",
      "idempotency_ledger",
      "applied_revision",
      0,
    ],
    [
      "adapter contract version",
      "idempotency_ledger",
      "adapter_contract_version",
      0,
    ],
  ] as const)(
    "rejects invalid %s",
    async (_label, table, column, value) => {
      const { path } = await appliedDatabase();
      const database = rawDatabase(path);
      expect(() =>
        database
          .prepare(`UPDATE ${table} SET ${column} = ?`)
          .run(value),
      ).toThrow(/constraint/i);
      database.close();
    },
  );

  it.each([
    ["state hash", "documents", "state_hash", "not-a-hash"],
    [
      "operation timestamp",
      "operations",
      "applied_at",
      "not-a-timestamp",
    ],
    [
      "ledger timestamp",
      "idempotency_ledger",
      "applied_at",
      "not-a-timestamp",
    ],
  ] as const)(
    "rejects malformed %s",
    async (_label, table, column, value) => {
      const { path } = await appliedDatabase();
      const database = rawDatabase(path);
      expect(() =>
        database
          .prepare(`UPDATE ${table} SET ${column} = ?`)
          .run(value),
      ).toThrow(/constraint/i);
      database.close();
    },
  );

  it("bounds authoritative JSON records", async () => {
    const { path } = await appliedDatabase();
    const database = rawDatabase(path);
    const oversized = JSON.stringify({
      padding: "x".repeat(MAX_JSON_BYTES),
    });
    expect(oversized.length).toBeGreaterThan(MAX_JSON_BYTES);
    expect(() =>
      database
        .prepare("UPDATE receipts SET receipt_json = ?")
        .run(oversized),
    ).toThrow(/constraint/i);
    database.close();
  });

  it("rejects a cross-project receipt pointer", async () => {
    const { path, request } = await appliedDatabase();
    const authority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    authority.createDocument(createCanvasDocument({
      projectId: sortableId("prj", "2"),
      id: sortableId("doc", "2"),
    }));
    authority.close();
    const database = rawDatabase(path);
    database.exec("PRAGMA foreign_keys = ON");
    expect(() =>
      database
        .prepare(
          `UPDATE idempotency_ledger
           SET project_id = ?
           WHERE idempotency_key = ?`,
        )
        .run(sortableId("prj", "2"), request.idempotencyKey),
    ).toThrow(/foreign key/i);
    database.close();
  });

  it.each([
    ["integrity_check", "PRAGMA ignore_check_constraints = ON", `
      UPDATE documents SET revision = -1
      WHERE project_id = '${ids.project}'
    `],
    ["foreign_key_check", "PRAGMA foreign_keys = OFF", `
      UPDATE receipts SET project_id = '${sortableId("prj", "Z")}'
    `],
  ])(
    "runs %s before the next mutation",
    async (_label, pragma, mutation) => {
      const { path } = await appliedDatabase();
      const database = rawDatabase(path);
      database.exec(`${pragma}; ${mutation}`);
      database.close();
      const authority = new CanvasTargetAuthority({
        databasePath: path,
        clock: () => NOW,
      });
      expect(() =>
        authority.createDocument(createCanvasDocument({
          projectId: ids.project,
          id: sortableId("doc", "2"),
        })),
      ).toThrow(/integrity|foreign key|corrupt/i);
      authority.close();
    },
  );
});
