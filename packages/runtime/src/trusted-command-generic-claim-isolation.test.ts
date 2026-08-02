import { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@memi/canonical-json";
import { afterEach, describe, expect, it } from "vitest";

import { bindCommandAction } from "./index.js";
import {
  MutableClock,
  alternateLeaseId,
  alternateOutboxId,
  approvalFor,
  grantFor,
  sortableId,
} from "./test-fixtures.js";
import {
  ALTERNATE_ROOT,
  TRUST_ROOT,
  TargetMutationProbe,
  activateLease,
  authorizeAndQueue,
  canvasCommandDraft,
  cleanupAuthorityFixtures,
  databasePath,
  runtime,
  seedMigratedLegacyPendingCommand,
} from "./trusted-command-authority-test-support.js";

afterEach(cleanupAuthorityFixtures);

function databaseBytes(path: string): string {
  const database = new DatabaseSync(path);
  const tables = (
    database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as unknown as readonly { readonly name: string }[]
  ).map(({ name }) => ({
    name,
    rows: database
      .prepare(`SELECT * FROM "${name}" ORDER BY rowid`)
      .all(),
  }));
  database.close();
  return canonicalJson(tables);
}

function commandSchedulingBytes(
  path: string,
  commandId: string,
): string {
  const database = new DatabaseSync(path);
  const snapshot = {
    command: database
      .prepare("SELECT * FROM commands WHERE id = ?")
      .get(commandId) ?? null,
    outbox: database
      .prepare("SELECT * FROM outbox WHERE command_id = ?")
      .get(commandId) ?? null,
    latch: database
      .prepare(
        `SELECT * FROM target_schedule_latches
         WHERE command_id = ?`,
      )
      .get(commandId) ?? null,
  };
  database.close();
  return canonicalJson(snapshot);
}

function seedExpiredRawClaim(
  path: string,
  commandId: string,
): void {
  const database = new DatabaseSync(path);
  database
    .prepare(
      `UPDATE outbox
       SET worker_id = 'interrupted-raw-worker',
           claim_epoch = 1,
           claim_expires_at = '2026-07-28T11:59:59.000Z'
       WHERE command_id = ?`,
    )
    .run(commandId);
  database
    .prepare(
      `INSERT INTO target_schedule_latches (
        project_id, target_kind, target_id, command_id, outbox_id,
        state, worker_claim_id, claim_epoch, acquired_at, updated_at
      )
      SELECT project_id, target_kind, target_id, command_id, id,
             'pending-fence', id || ':1', 1,
             '2026-07-28T11:59:58.000Z',
             '2026-07-28T11:59:58.000Z'
      FROM outbox WHERE command_id = ?`,
    )
    .run(commandId);
  database.close();
}

describe("trusted command generic claim isolation", () => {
  it("leaves a migrated raw legacy import intent byte-identical", () => {
    const path = databasePath("memi-generic-raw-import-");
    const clock = new MutableClock();
    seedMigratedLegacyPendingCommand(path, clock);
    const instance = runtime(path, clock);
    const before = databaseBytes(path);

    expect(
      instance.claimNextEffect({
        workerId: "generic-worker",
        claimTtlMilliseconds: 5_000,
      }),
    ).toBeNull();
    expect(databaseBytes(path)).toBe(before);
    instance.close();
  });

  it("leaves an expired trusted import intent byte-identical", async () => {
    const path = databasePath("memi-generic-expired-import-");
    const clock = new MutableClock();
    const instance = runtime(path, clock);
    const draft = canvasCommandDraft("B");
    await activateLease(instance, draft.command);
    await authorizeAndQueue(instance, draft);
    clock.advance(6 * 60_000);
    const before = databaseBytes(path);

    expect(
      instance.claimNextEffect({
        workerId: "generic-expired-worker",
        claimTtlMilliseconds: 5_000,
      }),
    ).toBeNull();
    expect(databaseBytes(path)).toBe(before);
    instance.close();
  });

  it.each([
    ["missing root", []],
    ["alternate root", [ALTERNATE_ROOT]],
  ] as const)(
    "leaves a trusted import intent byte-identical after reopen with %s",
    async (_label, roots) => {
      const path = databasePath("memi-generic-root-import-");
      const clock = new MutableClock();
      const first = runtime(path, clock);
      const draft = canvasCommandDraft("C");
      await activateLease(first, draft.command);
      await authorizeAndQueue(first, draft);
      first.close();

      const reopened = runtime(path, clock, roots);
      const before = databaseBytes(path);
      expect(
        reopened.claimNextEffect({
          workerId: "generic-root-worker",
          claimTtlMilliseconds: 5_000,
        }),
      ).toBeNull();
      expect(databaseBytes(path)).toBe(before);
      reopened.close();
    },
  );

  it("skips a valid trusted import intent and claims the next non-import command", async () => {
    const path = databasePath("memi-generic-valid-import-");
    const clock = new MutableClock();
    const instance = runtime(path, clock, [TRUST_ROOT]);
    const trustedDraft = canvasCommandDraft("D");
    await activateLease(instance, trustedDraft.command);
    const trusted = await authorizeAndQueue(
      instance,
      trustedDraft,
    );

    const ordinaryDraft = canvasCommandDraft("E");
    const ordinaryPayload = {
      ...ordinaryDraft.payload,
      actorId: "designer-agent",
    };
    const ordinaryCommand = bindCommandAction(
      {
        ...ordinaryDraft.command,
        id: sortableId("cmd", "E"),
        issuerId: "designer-agent",
        idempotencyKey: sortableId("idem", "E"),
        authority: {
          ...ordinaryDraft.command.authority,
          capabilityGrantId: sortableId("grt", "E"),
          approvalReceiptId: sortableId("apr", "E"),
        },
      },
      ordinaryPayload,
    );
    instance.registerGrant(grantFor(ordinaryCommand));
    instance.registerApprovalReceipt(approvalFor(ordinaryCommand));
    await activateLease(instance, ordinaryCommand);
    instance.submitCommand({
      command: ordinaryCommand,
      outboxId: alternateOutboxId("E"),
      effectPayload: ordinaryPayload,
    });
    const trustedBefore = commandSchedulingBytes(
      path,
      trusted.command.id,
    );

    expect(
      instance.claimNextEffect({
        workerId: "generic-ordinary-worker",
        claimTtlMilliseconds: 5_000,
      }),
    ).toMatchObject({
      commandId: ordinaryCommand.id,
      workerId: "generic-ordinary-worker",
    });
    expect(
      commandSchedulingBytes(path, trusted.command.id),
    ).toBe(trustedBefore);
    instance.close();
  });

  it("does not jump a trusted import intent to claim later same-target work", async () => {
    const path = databasePath("memi-generic-same-target-import-");
    const clock = new MutableClock();
    const instance = runtime(path, clock);
    const trustedDraft = canvasCommandDraft("F", undefined, "H");
    await activateLease(instance, trustedDraft.command);
    await authorizeAndQueue(instance, trustedDraft);
    clock.advance(11 * 60_000);

    const ordinaryDraft = canvasCommandDraft("G", undefined, "H");
    const ordinaryPayload = {
      ...ordinaryDraft.payload,
      actorId: "designer-agent",
    };
    const ordinaryCommand = bindCommandAction(
      {
        ...ordinaryDraft.command,
        issuerId: "designer-agent",
        issuedAt: clock.now(),
        authority: {
          capabilityGrantId: sortableId("grt", "G"),
          approvalReceiptId: sortableId("apr", "G"),
          leaseId: alternateLeaseId("G"),
          fencingEpoch: 2,
        },
      },
      ordinaryPayload,
    );
    instance.registerGrant(grantFor(ordinaryCommand));
    instance.registerApprovalReceipt(approvalFor(ordinaryCommand));
    await activateLease(instance, ordinaryCommand);
    instance.submitCommand({
      command: ordinaryCommand,
      outboxId: alternateOutboxId("G"),
      effectPayload: ordinaryPayload,
    });
    const before = databaseBytes(path);

    expect(
      instance.claimNextEffect({
        workerId: "same-target-generic-worker",
        claimTtlMilliseconds: 5_000,
      }),
    ).toBeNull();
    expect(databaseBytes(path)).toBe(before);
    instance.close();
  });

  it("does not reconcile a migrated raw import claim through generic apply", async () => {
    const path = databasePath("memi-generic-raw-recovery-");
    const clock = new MutableClock();
    const seeded = seedMigratedLegacyPendingCommand(path, clock);
    seedExpiredRawClaim(path, seeded.command.id);
    const target = new TargetMutationProbe();
    const instance = runtime(path, clock, [TRUST_ROOT], target);
    const before = databaseBytes(path);

    await expect(
      instance.applyNextEffect({
        workerId: "generic-raw-recovery-worker",
        claimTtlMilliseconds: 5_000,
      }),
    ).resolves.toBeNull();
    expect(databaseBytes(path)).toBe(before);
    expect(target.lookupCalls).toBe(0);
    expect(target.applyCalls).toBe(0);
    instance.close();
  });

  it.each([
    ["valid root", [TRUST_ROOT], 1_001],
    ["missing root", [], 1_001],
    ["alternate root", [ALTERNATE_ROOT], 1_001],
    ["expired authority", [TRUST_ROOT], 6 * 60_000],
  ] as const)(
    "does not reconcile an expired exact import claim through generic apply with %s",
    async (_label, roots, elapsed) => {
      const path = databasePath("memi-generic-trusted-recovery-");
      const clock = new MutableClock();
      const first = runtime(path, clock);
      const draft = canvasCommandDraft("J");
      await activateLease(first, draft.command);
      const authorized = await authorizeAndQueue(first, draft);
      await first.claimCommandEffect({
        commandId: authorized.command.id,
        workerId: "interrupted-exact-worker",
        claimTtlMilliseconds: 1_000,
      });
      first.close();
      clock.advance(elapsed);

      const target = new TargetMutationProbe();
      const reopened = runtime(path, clock, roots, target);
      const before = databaseBytes(path);
      await expect(
        reopened.applyNextEffect({
          workerId: "generic-recovery-worker",
          claimTtlMilliseconds: 5_000,
        }),
      ).resolves.toBeNull();
      expect(databaseBytes(path)).toBe(before);
      expect(target.lookupCalls).toBe(0);
      expect(target.applyCalls).toBe(0);
      reopened.close();
    },
  );
});
