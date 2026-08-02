import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { RuntimeDatabase } from "./database.js";
import * as runtimeSchema from "./schema.js";

const temporaryDirectories: string[] = [];

function path(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-runtime-v8-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("runtime schema verification attempt authority", () => {
  it("creates a strict attempt table and exact authority set", () => {
    const database = new RuntimeDatabase(path());
    expect(database.inspect()).toMatchObject({
      schemaVersion: 11,
      strictTables: expect.arrayContaining([
        "target_verification_attempts",
      ]),
    });
    const sql = String(
      database.one(
        `SELECT sql FROM sqlite_schema
         WHERE name = 'target_verification_attempts'`,
      )?.sql,
    );
    expect(sql).toMatch(/state.+issued.+accepted.+rejected/isu);
    expect(sql).toMatch(/request_json/iu);
    expect(sql).toMatch(/target_receipt_hash/iu);
    expect(sql).toMatch(/claim_worker_id/iu);
    const bindingForeignKeys = database.all(
      "PRAGMA foreign_key_list(trace_effect_bindings)",
    );
    expect(bindingForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "target_verification_attempts",
          from: "verification_attempt_state",
          to: "state",
        }),
        expect.objectContaining({
          table: "target_verification_attempts",
          from: "verification_evidence_hash",
          to: "evidence_hash",
        }),
      ]),
    );
    database.close();
  });

  it("atomically migrates an empty canonical v7 without fabricating attempts", () => {
    const schema = runtimeSchema as unknown as {
      readonly RUNTIME_SCHEMA_V7: string;
    };
    const databasePath = path();
    const seeded = new DatabaseSync(databasePath);
    seeded.exec(schema.RUNTIME_SCHEMA_V7);
    seeded.exec("PRAGMA user_version = 7");
    seeded.close();

    const migrated = new RuntimeDatabase(databasePath);
    expect(migrated.inspect().schemaVersion).toBe(11);
    expect(
      migrated.one(
        `SELECT count(*) AS count
         FROM target_verification_attempts`,
      ),
    ).toEqual({ count: 0 });
    expect(
      migrated.all("PRAGMA foreign_key_list(trace_effect_bindings)"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "target_verification_attempts",
        }),
      ]),
    );
    migrated.close();
  });

  it.each([
    [
      "legacy receipt",
      `INSERT INTO legacy_effect_receipts (command_id, receipt_json)
       VALUES ('cmd_legacy', '{}')`,
    ],
    [
      "legacy trace reference",
      `INSERT INTO legacy_trace_references (
         command_id, trace_event_id
       ) VALUES ('cmd_legacy', 'evt_legacy')`,
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
    [
      "committed command",
      `UPDATE commands SET state = 'committed'
       WHERE id = 'cmd_legacy'`,
    ],
  ] as const)(
    "rolls back v8 migration for noncanonical %s contamination",
    (_label, contaminate) => {
      const schema = runtimeSchema as unknown as {
        readonly RUNTIME_SCHEMA_V8: string;
      };
      const databasePath = path();
      const seeded = new DatabaseSync(databasePath);
      seeded.exec("PRAGMA foreign_keys = OFF");
      seeded.exec(schema.RUNTIME_SCHEMA_V8);
      seeded.exec(`
        INSERT INTO commands (
          id, project_id, target_kind, target_id, idempotency_key,
          action_digest, grant_id, approval_id, state, command_json,
          effect_payload_json
        ) VALUES (
          'cmd_legacy', 'prj_legacy', 'canvas-document', 'doc_legacy',
          'idem_legacy',
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'grt_legacy', 'apr_legacy', 'effect-applied', '{}', '{}'
        );
      `);
      seeded.exec(contaminate);
      seeded.exec("PRAGMA user_version = 8");
      const before = seeded
        .prepare(
          `SELECT name, sql FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all();
      seeded.close();

      expect(() => new RuntimeDatabase(databasePath)).toThrow(
        /adjudication|legacy|canonical/i,
      );
      const preserved = new DatabaseSync(databasePath);
      expect(
        (
          preserved.prepare("PRAGMA user_version").get() as {
            readonly user_version: number;
          }
        ).user_version,
      ).toBe(8);
      expect(
        preserved
          .prepare(
            `SELECT name, sql FROM sqlite_schema
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
             ORDER BY name`,
          )
          .all(),
      ).toEqual(before);
      preserved.close();
    },
  );

  it.each([
    [
      "trace_heads",
      `INSERT INTO trace_heads (
         project_id, last_sequence, last_event_id, last_event_hash,
         schema_version
       ) VALUES ('prj_legacy', 0, NULL, NULL, 1)`,
    ],
    [
      "trace_events",
      `INSERT INTO trace_events (
         id, project_id, sequence, schema_version, task_id, run_id,
         family, actor_kind, actor_id, command_id, outbox_id,
         target_kind, target_id, idempotency_key,
         command_action_digest, operation_action_digest,
         expected_before_hash, resulting_hash, target_receipt_hash,
         verification_request_digest, verification_evidence_hash,
         verification_checked_at, operation_id, applied_revision,
         lease_id, fencing_epoch, occurred_at, event_action_digest,
         previous_event_hash, event_hash, event_json
       ) VALUES (
         'evt_00000000000000000000000001', 'prj_legacy', 1, 1,
         'tsk_legacy', 'run_legacy', 'canvas.operation.committed',
         'system', 'memi-runtime', 'cmd_legacy', 'obx_legacy',
         'canvas-document', 'doc_legacy', 'idem_legacy',
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         '2026-07-28T12:00:00.000Z', 'opn_legacy', 1, 'lse_legacy',
         1, '2026-07-28T12:00:00.000Z',
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         NULL,
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         '{}'
       )`,
    ],
    [
      "target_verification_attempts",
      `INSERT INTO target_verification_attempts (
         id, project_id, command_id, outbox_id, target_kind, target_id,
         claim_worker_id, claim_epoch, claim_expires_at,
         apply_worker_claim_id, apply_claim_epoch, target_receipt_hash,
         request_digest, request_json, state, issued_at
       ) VALUES (
         'rcv_00000000000000000000000001', 'prj_legacy',
         'cmd_legacy', 'obx_legacy', 'canvas-document', 'doc_legacy',
         'commit-worker', 1, '2026-07-28T12:01:00.000Z',
         'apply-worker', 1,
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         '{}', 'issued', '2026-07-28T12:00:00.000Z'
       )`,
    ],
    [
      "trace_effect_bindings",
      `INSERT INTO trace_effect_bindings (
         command_id, outbox_id, event_id, project_id, target_kind,
         target_id, verification_attempt_id, binding_digest,
         target_receipt_hash, verification_request_digest,
         verification_evidence_hash, resulting_hash, committed_at
       ) VALUES (
         'cmd_legacy', 'obx_legacy',
         'evt_00000000000000000000000001', 'prj_legacy',
         'canvas-document', 'doc_legacy',
         'rcv_00000000000000000000000001',
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
         'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
         '2026-07-28T12:00:00.000Z'
       )`,
    ],
    [
      "effect_receipts",
      `INSERT INTO effect_receipts (
         command_id, outbox_id, event_id, project_id, target_kind,
         target_id, binding_digest, receipt_hash, receipt_json,
         committed_at
       ) VALUES (
         'cmd_legacy', 'obx_legacy',
         'evt_00000000000000000000000001', 'prj_legacy',
         'canvas-document', 'doc_legacy',
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         '{}', '2026-07-28T12:00:00.000Z'
       )`,
    ],
    [
      "trace_projection_outbox",
      `INSERT INTO trace_projection_outbox (
         event_id, project_id, sequence, event_hash, state, created_at
       ) VALUES (
         'evt_00000000000000000000000001', 'prj_legacy', 1,
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'pending', '2026-07-28T12:00:00.000Z'
       )`,
    ],
  ] as const)(
    "rolls back v8 migration byte-identically for nonempty %s",
    (table, insert) => {
      const schema = runtimeSchema as unknown as {
        readonly RUNTIME_SCHEMA_V8: string;
      };
      const databasePath = path();
      const seeded = new DatabaseSync(databasePath);
      seeded.exec("PRAGMA foreign_keys = OFF");
      seeded.exec(schema.RUNTIME_SCHEMA_V8);
      seeded.exec(insert);
      seeded.exec("PRAGMA user_version = 8");
      seeded.close();

      expect(() => new RuntimeDatabase(databasePath)).toThrow(
        /adjudication|canonical/i,
      );
      const preserved = new DatabaseSync(databasePath);
      expect(
        (
          preserved.prepare("PRAGMA user_version").get() as {
            readonly user_version: number;
          }
        ).user_version,
      ).toBe(8);
      expect(
        (
          preserved
            .prepare(`SELECT count(*) AS count FROM ${table}`)
            .get() as { readonly count: number }
        ).count,
      ).toBe(1);
      preserved.close();
    },
  );
});
