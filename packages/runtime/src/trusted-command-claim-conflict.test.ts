import { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@memi/canonical-json";
import { afterEach, describe, expect, it } from "vitest";

import { MutableClock, sortableId } from "./test-fixtures.js";
import {
  TargetMutationProbe,
  TRUST_ROOT,
  activateLease,
  authorizeAndQueue,
  canvasCommandDraft,
  cleanupAuthorityFixtures,
  databasePath,
  runtime,
} from "./trusted-command-authority-test-support.js";

afterEach(cleanupAuthorityFixtures);

class UnavailableRecoveryTarget extends TargetMutationProbe {
  override lookup(): never {
    throw new Error("Trusted recovery lookup unavailable.");
  }
}

function schedulingBytes(path: string): string {
  const database = new DatabaseSync(path);
  const tables = [
    "commands",
    "outbox",
    "target_schedule_latches",
  ];
  const value = tables.map((table) => ({
    table,
    rows: database
      .prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
      .all(),
  }));
  database.close();
  return canonicalJson(value);
}

describe("command-scoped atomic claim", () => {
  it("claims only the requested command and leaves older unrelated intent untouched", async () => {
    const path = databasePath("memi-authority-exact-claim-");
    const clock = new MutableClock();
    const instance = runtime(path, clock);
    const older = canvasCommandDraft("G");
    const exact = canvasCommandDraft("H");

    for (const draft of [older, exact]) {
      await activateLease(instance, draft.command);
      await authorizeAndQueue(instance, draft);
    }

    const claim = await instance.claimCommandEffect({
      commandId: exact.command.id,
      workerId: "exact-worker",
      claimTtlMilliseconds: 5_000,
    });
    expect(claim).toMatchObject({
      commandId: exact.command.id,
      workerId: "exact-worker",
    });

    const database = new DatabaseSync(path);
    expect(
      database
        .prepare(
          `SELECT worker_id FROM outbox WHERE command_id = ?`,
        )
        .get(older.command.id),
    ).toEqual({ worker_id: null });
    database.close();
    instance.close();
  });

  it("rejects a same-target second claim with byte-identical scheduling state", async () => {
    const path = databasePath("memi-authority-conflict-");
    const clock = new MutableClock();
    const instance = runtime(path, clock);
    const runId = sortableId("run", "J");
    const first = canvasCommandDraft("J", runId, "J");
    const second = canvasCommandDraft("K", runId, "J");

    await activateLease(instance, first.command);
    const firstAuthorized = await authorizeAndQueue(instance, first);
    const secondAuthorized = await authorizeAndQueue(instance, second);
    const before = schedulingBytes(path);

    await expect(
      instance.claimCommandEffect({
        commandId: secondAuthorized.command.id,
        workerId: "conflicting-worker",
        claimTtlMilliseconds: 5_000,
      }),
    ).rejects.toThrow(/claim|conflict|queued|target/i);

    expect(schedulingBytes(path)).toBe(before);
    expect(
      instance.getOutboxForCommand(firstAuthorized.command.id),
    ).toMatchObject({ phase: "intent" });
    expect(
      instance.getOutboxForCommand(secondAuthorized.command.id),
    ).toMatchObject({ phase: "intent" });
    instance.close();
  });

  it("reclaims the exact command after its worker claim expires", async () => {
    const path = databasePath("memi-authority-reclaim-");
    const clock = new MutableClock();
    const instance = runtime(path, clock);
    const draft = canvasCommandDraft("M");

    await activateLease(instance, draft.command);
    const authorized = await authorizeAndQueue(instance, draft);
    const first = await instance.claimCommandEffect({
      commandId: authorized.command.id,
      workerId: "first-worker",
      claimTtlMilliseconds: 5_000,
    });

    clock.advance(5_000);
    const reclaimed = await instance.claimCommandEffect({
      commandId: authorized.command.id,
      workerId: "recovery-worker",
      claimTtlMilliseconds: 5_000,
    });

    expect(reclaimed).toMatchObject({
      commandId: authorized.command.id,
      workerId: "recovery-worker",
      fencingEpoch: first.fencingEpoch + 1,
    });
    instance.close();
  });

  it("does not reclaim an expired exact command without accepted recovery evidence", async () => {
    const path = databasePath("memi-authority-blocked-reclaim-");
    const clock = new MutableClock();
    const target = new UnavailableRecoveryTarget();
    const instance = runtime(path, clock, [TRUST_ROOT], target);
    const draft = canvasCommandDraft("N");

    await activateLease(instance, draft.command);
    const authorized = await authorizeAndQueue(instance, draft);
    await instance.claimCommandEffect({
      commandId: authorized.command.id,
      workerId: "interrupted-worker",
      claimTtlMilliseconds: 5_000,
    });
    clock.advance(5_000);

    await expect(
      instance.claimCommandEffect({
        commandId: authorized.command.id,
        workerId: "unsafe-recovery-worker",
        claimTtlMilliseconds: 5_000,
      }),
    ).rejects.toThrow(/evidence|recovery/i);
    expect(target.applyCalls).toBe(0);
    instance.close();
  });
});
