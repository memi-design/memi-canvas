import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  OutboxRecordSchema,
  type DurableCommand,
} from "../../protocol/src/index.js";
import { DurableRuntime } from "./index.js";
import { RUNTIME_SCHEMA_V2 } from "./schema.js";
import {
  MutableClock,
  RecordingEffectExecutor,
  alternateLeaseId,
  alternateOutboxId,
  approvalFor,
  commandSubmission,
  contentHash,
  durableCommand,
  grantFor,
  sortableId,
} from "./test-fixtures.js";

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-target-scheduling-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

function runtime(path: string, clock = new MutableClock()) {
  return new DurableRuntime({
    databasePath: path,
    clock: clock.now,
    effectExecutor: new RecordingEffectExecutor(),
  });
}

function authorize(
  instance: DurableRuntime,
  command: DurableCommand,
): void {
  instance.registerGrant(grantFor(command));
  instance.registerApprovalReceipt(approvalFor(command));
}

function boundCommand(
  suffix: string,
  targetId: string,
): DurableCommand {
  return durableCommand({
    id: sortableId("cmd", suffix),
    idempotencyKey: sortableId("idem", suffix),
    target: {
      kind: "canvas-document",
      id: targetId,
      expectedBeforeHash: contentHash("a"),
      baseline: {
        kind: "canvas-revision",
        revision: 1,
        stateHash: contentHash("a"),
      },
    },
    authority: {
      capabilityGrantId: sortableId("grt", suffix),
      approvalReceiptId: sortableId("apr", suffix),
      leaseId: alternateLeaseId(suffix),
      fencingEpoch: 1,
    },
  });
}

function seedVersionTwo(path: string): {
  readonly command: DurableCommand;
  readonly outboxId: string;
} {
  const command = boundCommand(
    "M",
    "canvas:document:migrated",
  );
  const outboxId = alternateOutboxId("M");
  const grant = grantFor(command);
  const approval = approvalFor(command);
  const outbox = OutboxRecordSchema.parse({
    schemaVersion: 1,
    id: outboxId,
    commandId: command.id,
    projectId: command.projectId,
    idempotencyKey: command.idempotencyKey,
    actionDigest: command.actionDigest,
    phase: "intent",
    effect: {
      kind: command.kind,
      targetId: command.target.id,
      expectedBeforeHash: command.target.expectedBeforeHash,
      payloadHash: command.payloadHash,
    },
    createdAt: command.issuedAt,
  });
  const database = new DatabaseSync(path);
  database.exec(RUNTIME_SCHEMA_V2);
  database
    .prepare(
      `INSERT INTO capability_grants
        (id, project_id, grant_json) VALUES (?, ?, ?)`,
    )
    .run(grant.id, grant.projectId, JSON.stringify(grant));
  database
    .prepare(
      `INSERT INTO approval_receipts
        (id, project_id, receipt_json) VALUES (?, ?, ?)`,
    )
    .run(approval.id, approval.projectId, JSON.stringify(approval));
  database
    .prepare(
      `INSERT INTO commands (
        id, project_id, idempotency_key, action_digest, grant_id,
        approval_id, state, command_json, effect_payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      command.id,
      command.projectId,
      command.idempotencyKey,
      command.actionDigest,
      grant.id,
      approval.id,
      "intent",
      JSON.stringify(command),
      JSON.stringify(commandSubmission(command).effectPayload),
    );
  database
    .prepare(
      `INSERT INTO outbox
        (id, command_id, phase, record_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(outbox.id, command.id, outbox.phase, JSON.stringify(outbox));
  database.exec("PRAGMA user_version = 2");
  database.close();
  return { command, outboxId };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("runtime target scheduling authority", () => {
  it("migrates version two bindings into strict version three tables and reopens", () => {
    const path = databasePath();
    const seeded = seedVersionTwo(path);

    const first = runtime(path);
    expect(first.inspectDatabase()).toMatchObject({
      schemaVersion: 11,
      strictTables: expect.arrayContaining([
        "target_receipts",
        "target_recovery_evidence",
        "target_schedule_latches",
      ]),
    });
    first.close();

    const reopened = runtime(path);
    expect(reopened.getCommand(seeded.command.id)).toEqual(
      seeded.command,
    );
    reopened.close();

    const database = new DatabaseSync(path);
    const commandBinding = database
      .prepare(
        `SELECT project_id, target_kind, target_id
         FROM commands WHERE id = ?`,
      )
      .get(seeded.command.id);
    const outboxBinding = database
      .prepare(
        `SELECT project_id, target_kind, target_id, command_id
         FROM outbox WHERE id = ?`,
      )
      .get(seeded.outboxId);
    const tableRows = database
      .prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE type = 'table'
           AND name IN ('target_receipts', 'target_schedule_latches')
         ORDER BY name`,
      )
      .all() as unknown as readonly {
        readonly name: string;
        readonly sql: string;
      }[];
    database.close();

    expect(commandBinding).toMatchObject({
      project_id: seeded.command.projectId,
      target_kind: seeded.command.target.kind,
      target_id: seeded.command.target.id,
    });
    expect(outboxBinding).toMatchObject({
      project_id: seeded.command.projectId,
      target_kind: seeded.command.target.kind,
      target_id: seeded.command.target.id,
      command_id: seeded.command.id,
    });
    expect(tableRows).toHaveLength(2);
    expect(
      tableRows.every((row) => /\bSTRICT\s*$/iu.test(row.sql)),
    ).toBe(true);
  });

  it("quarantines legacy effect-applied evidence without inventing a target receipt", () => {
    const path = databasePath();
    const seeded = seedVersionTwo(path);
    const legacyEvidence = {
      pending: true,
      executorReceipt: {
        kind: "legacy-opaque-effect",
        untrusted: true,
      },
    };
    const database = new DatabaseSync(path);
    const row = database
      .prepare("SELECT record_json FROM outbox WHERE id = ?")
      .get(seeded.outboxId) as { readonly record_json: string };
    const intent = JSON.parse(row.record_json) as Record<
      string,
      unknown
    >;
    const applied = {
      ...intent,
      phase: "effect-applied",
      appliedAt: "2026-07-28T12:00:01.000Z",
      resultingHash: contentHash("e"),
    };
    database
      .prepare(
        `UPDATE outbox SET phase = 'effect-applied', record_json = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(applied), seeded.outboxId);
    database
      .prepare(
        `UPDATE commands SET state = 'effect-applied' WHERE id = ?`,
      )
      .run(seeded.command.id);
    database
      .prepare(
        `INSERT INTO effect_receipts (
           command_id, receipt_json
         )
         VALUES (?, ?)`,
      )
      .run(seeded.command.id, JSON.stringify(legacyEvidence));
    database.close();

    expect(() => runtime(path)).toThrow(/adjudication/i);

    const inspected = new DatabaseSync(path);
    const version = (
      inspected.prepare("PRAGMA user_version").get() as {
        readonly user_version: number;
      }
    ).user_version;
    const latch = inspected
      .prepare(
        `SELECT state FROM target_schedule_latches
         WHERE command_id = ?`,
      )
      .get(seeded.command.id);
    const targetReceipt = inspected
      .prepare(
        `SELECT receipt_json FROM target_receipts
         WHERE command_id = ?`,
      )
      .get(seeded.command.id);
    const preserved = inspected
      .prepare(
        `SELECT receipt_json FROM effect_receipts
         WHERE command_id = ?`,
      )
      .get(seeded.command.id) as {
      readonly receipt_json: string;
    };
    inspected.close();

    expect(version).toBe(6);
    expect(latch).toEqual({ state: "blocked-unknown" });
    expect(targetReceipt).toBeUndefined();
    expect(JSON.parse(preserved.receipt_json)).toEqual(
      legacyEvidence,
    );
  });

  it("holds one durable latch per target while allowing another target", () => {
    const path = databasePath();
    const instance = runtime(path);
    const first = boundCommand(
      "1",
      "canvas:document:shared",
    );
    const sameTarget = boundCommand(
      "2",
      "canvas:document:shared",
    );
    const otherTarget = boundCommand(
      "3",
      "canvas:document:other",
    );
    for (const command of [first, sameTarget, otherTarget]) {
      authorize(instance, command);
    }
    instance.submitCommand(
      commandSubmission(first, alternateOutboxId("1")),
    );
    instance.submitCommand(
      commandSubmission(sameTarget, alternateOutboxId("2")),
    );
    instance.submitCommand(
      commandSubmission(otherTarget, alternateOutboxId("3")),
    );

    expect(
      instance.claimNextEffect({
        workerId: "worker-first",
        claimTtlMilliseconds: 1_000,
      })?.commandId,
    ).toBe(first.id);
    expect(
      instance.claimNextEffect({
        workerId: "worker-other",
        claimTtlMilliseconds: 1_000,
      })?.commandId,
    ).toBe(otherTarget.id);
    expect(
      instance.claimNextEffect({
        workerId: "worker-blocked",
        claimTtlMilliseconds: 1_000,
      }),
    ).toBeNull();
    instance.close();

    const database = new DatabaseSync(path);
    const latches = database
      .prepare(
        `SELECT project_id, target_kind, target_id, command_id,
                outbox_id, state
         FROM target_schedule_latches
         ORDER BY target_id`,
      )
      .all();
    database.close();
    expect(latches).toEqual([
      expect.objectContaining({
        target_id: "canvas:document:other",
        command_id: otherTarget.id,
        outbox_id: alternateOutboxId("3"),
        state: "pending-fence",
      }),
      expect.objectContaining({
        target_id: "canvas:document:shared",
        command_id: first.id,
        outbox_id: alternateOutboxId("1"),
        state: "pending-fence",
      }),
    ]);
  });

  it("keeps the latch owner blocked for recovery after its worker claim expires", () => {
    const path = databasePath();
    const clock = new MutableClock();
    const firstRuntime = runtime(path, clock);
    const first = boundCommand(
      "4",
      "canvas:document:reclaim",
    );
    const sameTarget = boundCommand(
      "5",
      "canvas:document:reclaim",
    );
    for (const command of [first, sameTarget]) {
      authorize(firstRuntime, command);
    }
    firstRuntime.submitCommand(
      commandSubmission(first, alternateOutboxId("4")),
    );
    firstRuntime.submitCommand(
      commandSubmission(sameTarget, alternateOutboxId("5")),
    );
    const original = firstRuntime.claimNextEffect({
      workerId: "worker-original",
      claimTtlMilliseconds: 1_000,
    });
    expect(original?.commandId).toBe(first.id);
    firstRuntime.close();

    clock.advance(1_001);
    const recovered = runtime(path, clock);
    const reclaimed = recovered.claimNextEffect({
      workerId: "worker-recovery",
      claimTtlMilliseconds: 1_000,
    });
    expect(reclaimed).toBeNull();
    recovered.close();

    const database = new DatabaseSync(path);
    const latchCount = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM target_schedule_latches
         WHERE project_id = ? AND target_kind = ? AND target_id = ?`,
      )
      .get(
        first.projectId,
        first.target.kind,
        first.target.id,
      ) as { readonly count: number };
    database.close();
    expect(latchCount.count).toBe(1);
  });
});
