import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { RuntimeDatabase } from "./database.js";
import { DurableRuntime } from "./index.js";
import {
  AUTHORITATIVE_TABLES,
  RUNTIME_SCHEMA,
  RUNTIME_SCHEMA_V6,
} from "./schema.js";
import * as runtimeSchema from "./schema.js";
import {
  MutableClock,
  RecordingEffectExecutor,
  approvalFor,
  commandSubmission,
  durableCommand,
  grantFor,
  matchingEffectVerifier,
} from "./test-fixtures.js";

const temporaryDirectories: string[] = [];
const expectedTables = [
  "approval_receipts",
  "approval_uses",
  "capability_grants",
  "capability_grant_uses",
  "commands",
  "effect_receipts",
  "harness_checkpoints",
  "harness_handoffs",
  "harness_lifecycle_events",
  "harness_runs",
  "harness_tasks",
  "harness_trace_refs",
  "leases",
  "legacy_effect_receipts",
  "legacy_trace_references",
  "outbox",
  "recovery_decisions",
  "run_state",
  "target_receipts",
  "target_recovery_evidence",
  "target_schedule_latches",
  "target_verification_attempts",
  "trace_effect_bindings",
  "trace_events",
  "trace_heads",
  "trace_projection_outbox",
  "trusted_authority_reservations",
  "trusted_command_authorities",
] as const;

function databasePath(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-runtime-v7-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

function seedVersionSix(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec(RUNTIME_SCHEMA_V6);
  database.exec("PRAGMA user_version = 6");
  return database;
}

function names(database: DatabaseSync): readonly string[] {
  return (
    database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as unknown as readonly { readonly name: string }[]
  ).map((row) => row.name);
}

function legacyRows(database: DatabaseSync): unknown {
  return {
    effects: database
      .prepare(
        `SELECT command_id, hex(receipt_json) AS receipt_bytes
         FROM effect_receipts ORDER BY command_id`,
      )
      .all(),
    references: database
      .prepare(
        `SELECT command_id, trace_event_id
         FROM trace_references ORDER BY command_id`,
      )
      .all(),
    outbox: database
      .prepare(
        `SELECT id, command_id, project_id, target_kind, target_id,
                phase, hex(record_json) AS record_bytes
         FROM outbox ORDER BY id`,
      )
      .all(),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("runtime schema v7 canonical trace authority", () => {
  it("creates the exact strict v7 authority without fabricating trace rows", () => {
    expect(AUTHORITATIVE_TABLES).toEqual(expectedTables);
    const database = new RuntimeDatabase(databasePath());

    expect(database.inspect()).toMatchObject({
      schemaVersion: 11,
      strictTables: expectedTables,
    });
    for (const table of [
      "effect_receipts",
      "trace_effect_bindings",
      "trace_events",
      "trace_heads",
      "trace_projection_outbox",
    ]) {
      expect(
        database.one(`SELECT count(*) AS count FROM ${table}`),
      ).toEqual({ count: 0 });
    }
    database.close();
  });

  it("atomically renames empty v6 outcome tables and creates no canonical event", () => {
    const path = databasePath();
    seedVersionSix(path).close();

    const migrated = new RuntimeDatabase(path);
    expect(migrated.inspect().schemaVersion).toBe(11);
    expect(names(migrated.raw)).toEqual([...expectedTables].sort());
    expect(
      migrated.one(
        "SELECT count(*) AS count FROM legacy_effect_receipts",
      ),
    ).toEqual({ count: 0 });
    expect(
      migrated.one(
        "SELECT count(*) AS count FROM legacy_trace_references",
      ),
    ).toEqual({ count: 0 });
    expect(
      migrated.one("SELECT count(*) AS count FROM trace_events"),
    ).toEqual({ count: 0 });
    migrated.close();
  });

  it.each([
    [
      "legacy effect receipt",
      `INSERT INTO effect_receipts (command_id, receipt_json)
       VALUES ('cmd_legacy', '{"legacy":true}')`,
    ],
    [
      "legacy trace reference",
      `INSERT INTO trace_references (command_id, trace_event_id)
       VALUES ('cmd_legacy', 'evt_legacy')`,
    ],
    [
      "committed outbox",
      `INSERT INTO outbox (
         id, command_id, project_id, target_kind, target_id, phase,
         record_json
       ) VALUES (
         'obx_legacy', 'cmd_legacy', 'prj_legacy',
         'canvas-document', 'doc_legacy', 'committed', '{}'
       )`,
    ],
  ] as const)(
    "rolls back v6 migration byte-for-byte for nonempty %s state",
    (_label, insertSql) => {
      const path = databasePath();
      const seeded = seedVersionSix(path);
      seeded.exec("PRAGMA foreign_keys = OFF");
      seeded.exec(insertSql);
      const before = seeded
        .prepare(
          `SELECT name, sql FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all();
      const beforeRows = legacyRows(seeded);
      seeded.close();

      expect(() => new RuntimeDatabase(path)).toThrow(
        /legacy|adjudicat|migration/i,
      );

      const preserved = new DatabaseSync(path);
      expect(
        (
          preserved.prepare("PRAGMA user_version").get() as {
            readonly user_version: number;
          }
        ).user_version,
      ).toBe(6);
      expect(
        preserved
          .prepare(
            `SELECT name, sql FROM sqlite_schema
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
             ORDER BY name`,
          )
          .all(),
      ).toEqual(before);
      expect(names(preserved)).toContain("effect_receipts");
      expect(names(preserved)).toContain("trace_references");
      expect(names(preserved)).not.toContain("trace_events");
      expect(legacyRows(preserved)).toEqual(beforeRows);
      preserved.close();
    },
  );

  it("enforces bounded JSON, positive sequence, pending projection, and composite foreign keys", () => {
    const database = new RuntimeDatabase(databasePath());
    const traceSql = String(
      database.one(
        `SELECT sql FROM sqlite_schema
         WHERE type = 'table' AND name = 'trace_events'`,
      )?.sql,
    );
    expect(traceSql).toMatch(
      /length\s*\(\s*cast\s*\(\s*event_json\s+as\s+blob\s*\)\s*\)/iu,
    );
    expect(traceSql).toMatch(/sequence\s*>\s*0/iu);
    expect(
      database.all("PRAGMA foreign_key_list(trace_effect_bindings)"),
    ).not.toEqual([]);
    expect(
      database.all("PRAGMA foreign_key_list(effect_receipts)"),
    ).not.toEqual([]);
    expect(
      database.all(
        `SELECT name FROM sqlite_schema
         WHERE type = 'index'
           AND name IN (
             'trace_events_effect_lookup',
             'trace_effect_bindings_project_event',
             'trace_projection_pending_order'
           )`,
      ),
    ).toHaveLength(3);
    expect(() =>
      database.run(
        `INSERT INTO trace_heads (
           project_id, last_sequence, last_event_id, last_event_hash,
           schema_version
         ) VALUES ('prj_invalid', -1, NULL, NULL, 1)`,
      ),
    ).toThrow();
    expect(() =>
      database.run(
        `INSERT INTO trace_projection_outbox (
           event_id, project_id, sequence, state, created_at
         ) VALUES (
           'evt_invalid', 'prj_invalid', 1, 'projected',
           '2026-07-28T12:00:00.000Z'
         )`,
      ),
    ).toThrow();
    database.close();
  });

  it("fails startup when a v7 trace constraint is replaced", () => {
    const schema = runtimeSchema as unknown as {
      readonly traceEventsTableSchema: () => string;
    };
    const traceSchema = schema.traceEventsTableSchema();
    const tamperedTraceSchema = traceSchema.replace(
      "CHECK (sequence > 0)",
      "CHECK (sequence >= 0)",
    );
    expect(tamperedTraceSchema).not.toBe(traceSchema);
    const path = databasePath();
    const seeded = new DatabaseSync(path);
    seeded.exec(RUNTIME_SCHEMA.replace(traceSchema, tamperedTraceSchema));
    seeded.exec("PRAGMA user_version = 10");
    seeded.close();

    expect(() => new RuntimeDatabase(path)).toThrow(
      /schema|constraint|incompatible/i,
    );
  });

  it("keeps the fresh legacy fixture path isolated from canonical trace authority", async () => {
    const path = databasePath();
    const clock = new MutableClock();
    const runtime = new DurableRuntime({
      databasePath: path,
      clock: clock.now,
      effectExecutor: new RecordingEffectExecutor(),
      effectVerifier: matchingEffectVerifier(),
    });
    const command = durableCommand();
    runtime.registerGrant(grantFor(command));
    runtime.registerApprovalReceipt(approvalFor(command));
    runtime.acquireLease({
      leaseId: command.authority.leaseId,
      projectId: command.projectId,
      targetId: command.target.id,
      holderId: command.issuerId,
      ttlMilliseconds: 60_000,
    });
    runtime.submitCommand(commandSubmission(command));
    await runtime.applyNextEffect({
      workerId: "legacy-fixture",
      claimTtlMilliseconds: 5_000,
    });
    const claim = runtime.claimEffectCommit({
      commandId: command.id,
      workerId: "legacy-commit-fixture",
      claimTtlMilliseconds: 5_000,
    });
    await runtime.verifyAndCommit({
      claim,
    });
    runtime.close();

    const inspected = new DatabaseSync(path, { readOnly: true });
    expect(
      inspected
        .prepare(
          "SELECT count(*) AS count FROM legacy_effect_receipts",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      inspected
        .prepare(
          "SELECT count(*) AS count FROM legacy_trace_references",
        )
        .get(),
    ).toEqual({ count: 1 });
    for (const table of [
      "effect_receipts",
      "trace_events",
      "trace_effect_bindings",
      "trace_projection_outbox",
    ]) {
      expect(
        inspected
          .prepare(`SELECT count(*) AS count FROM ${table}`)
          .get(),
      ).toEqual({ count: 0 });
    }
    inspected.close();
  });
});
