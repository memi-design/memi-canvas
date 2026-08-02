import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { DurableRuntime } from "./index.js";
import {
  RUNTIME_SCHEMA_V6,
  RUNTIME_SCHEMA_V2,
  commandsTableSchemaV2,
  leasesTableSchemaV3,
  recoveryDecisionsTableSchema,
} from "./schema.js";
import {
  MutableClock,
  RecordingEffectExecutor,
} from "./test-fixtures.js";

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-runtime-security-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("durable runtime database security", () => {
  it("opens a hardened WAL database with only strict authoritative tables", () => {
    const runtime = new DurableRuntime({
      databasePath: databasePath(),
      clock: new MutableClock().now,
      effectExecutor: new RecordingEffectExecutor(),
    });

    expect(runtime.inspectDatabase()).toEqual({
      schemaVersion: 11,
      journalMode: "wal",
      foreignKeys: true,
      synchronous: "full",
      trustedSchema: false,
      extensionsEnabled: false,
      busyTimeoutMilliseconds: 5_000,
      strictTables: [
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
      ],
    });

    runtime.close();
  });

  it("fails closed on future and unversioned incompatible databases", () => {
    const futurePath = databasePath();
    const future = new DatabaseSync(futurePath);
    future.exec("PRAGMA user_version = 12");
    future.close();

    expect(() =>
      new DurableRuntime({
        databasePath: futurePath,
        clock: new MutableClock().now,
        effectExecutor: new RecordingEffectExecutor(),
      }),
    ).toThrow("Unsupported runtime schema version 12; expected 11.");

    const legacyPath = databasePath();
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec("CREATE TABLE legacy_state (value TEXT)");
    legacy.close();

    expect(() =>
      new DurableRuntime({
        databasePath: legacyPath,
        clock: new MutableClock().now,
        effectExecutor: new RecordingEffectExecutor(),
      }),
    ).toThrow(
      "Unversioned runtime database contains incompatible tables.",
    );
  });

  it("migrates the known version-one authority schema", () => {
    const path = databasePath();
    const versionOneCommands = `
CREATE TABLE commands (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  action_digest TEXT NOT NULL,
  grant_id TEXT NOT NULL REFERENCES capability_grants(id),
  approval_id TEXT NOT NULL REFERENCES approval_receipts(id),
  state TEXT NOT NULL,
  command_json TEXT NOT NULL,
  effect_payload_json TEXT NOT NULL
) STRICT;`;
    const versionOneRecovery = `
CREATE TABLE recovery_decisions (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL UNIQUE REFERENCES commands(id),
  decision_json TEXT NOT NULL
) STRICT;`;
    const database = new DatabaseSync(path);
    database.exec(
      RUNTIME_SCHEMA_V2.replace(
        commandsTableSchemaV2(),
        versionOneCommands,
      ).replace(
        recoveryDecisionsTableSchema(),
        versionOneRecovery,
      ),
    );
    database.exec("PRAGMA user_version = 1");
    database.close();

    const runtime = new DurableRuntime({
      databasePath: path,
      clock: new MutableClock().now,
      effectExecutor: new RecordingEffectExecutor(),
    });
    expect(runtime.inspectDatabase()).toMatchObject({
      schemaVersion: 11,
    });
    runtime.close();
  });

  it("never advances or later accepts a migration with foreign-key violations", () => {
    const path = databasePath();
    const seeded = new DatabaseSync(path);
    seeded.exec(RUNTIME_SCHEMA_V6);
    seeded.exec("DROP TABLE leases");
    seeded.exec(leasesTableSchemaV3());
    seeded.exec("PRAGMA foreign_keys = OFF");
    seeded
      .prepare(
        `INSERT INTO effect_receipts (command_id, receipt_json)
         VALUES (?, ?)`,
      )
      .run("cmd_missing_parent", "{}");
    seeded.exec("PRAGMA user_version = 3");
    seeded.close();

    const attempts: {
      readonly outcome: "opened" | "rejected";
      readonly schemaVersion: number;
    }[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let outcome: "opened" | "rejected" = "opened";
      try {
        const runtime = new DurableRuntime({
          databasePath: path,
          clock: new MutableClock().now,
          effectExecutor: new RecordingEffectExecutor(),
        });
        runtime.close();
      } catch {
        outcome = "rejected";
      }
      const inspected = new DatabaseSync(path);
      const schemaVersion = Number(
        (
          inspected.prepare("PRAGMA user_version").get() as {
            readonly user_version: number;
          }
        ).user_version,
      );
      inspected.close();
      attempts.push({ outcome, schemaVersion });
    }

    expect(attempts).toEqual([
      { outcome: "rejected", schemaVersion: 3 },
      { outcome: "rejected", schemaVersion: 3 },
      { outcome: "rejected", schemaVersion: 3 },
    ]);
  });
});
