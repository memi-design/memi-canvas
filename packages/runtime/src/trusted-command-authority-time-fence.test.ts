import { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@memi/canonical-json";
import { LeaseIdSchema } from "../../protocol/src/index.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  MutableClock,
  alternateOutboxId,
  sortableId,
} from "./test-fixtures.js";
import {
  TRUST_ROOT,
  TargetMutationProbe,
  activateLease,
  canvasCommandDraft,
  cleanupAuthorityFixtures,
  databasePath,
  finalCommand,
  reserveAuthority,
  runtime,
  signedIssuance,
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
  ).map((row) => row.name);
  const snapshot = tables.map((table) => ({
    table,
    rows: database
      .prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
      .all(),
  }));
  database.close();
  return canonicalJson(snapshot);
}

function claimFor(
  command: ReturnType<typeof canvasCommandDraft>["command"],
) {
  return {
    id: `claim:${command.id}`,
    commandId: command.id,
    outboxId: alternateOutboxId(command.id.slice(-1)),
    workerId: "stale-authority-worker",
    fencingEpoch: 1,
    expiresAt: "2026-07-28T12:09:00.000Z",
  };
}

async function reserveIssueSubmit(
  instance: ReturnType<typeof runtime>,
  draft: ReturnType<typeof canvasCommandDraft>,
) {
  const lease = await activateLease(
    instance,
    draft.command,
    10 * 60_000,
  );
  const reservation = await reserveAuthority(instance, draft);
  const command = finalCommand(draft, reservation);
  const issuance = signedIssuance(
    command,
    draft.payload,
    reservation,
  );
  const issued = await instance.issueTrustedCommandAuthority(
    issuance,
  );
  expect(Date.parse(issuance.expiresAt)).toBeLessThanOrEqual(
    Date.parse(reservation.expiresAt),
  );
  expect(Date.parse(issuance.expiresAt)).toBeLessThanOrEqual(
    Date.parse(lease.expiresAt),
  );
  instance.submitCommand({
    command,
    outboxId: alternateOutboxId(command.id.slice(-1)),
    effectPayload: draft.payload,
  });
  return { command, issuance, issued, lease, reservation };
}

describe("trusted authority time and fence invalidation", () => {
  it("rejects an expired reservation while its lease remains active", async () => {
    const path = databasePath("memi-reservation-expiry-");
    const clock = new MutableClock();
    const instance = runtime(path, clock);
    const draft = canvasCommandDraft("W");
    const lease = await activateLease(
      instance,
      draft.command,
      10 * 60_000,
    );
    const reservation = await reserveAuthority(instance, draft);
    const command = finalCommand(draft, reservation);
    const issuance = signedIssuance(
      command,
      draft.payload,
      reservation,
    );
    expect(Date.parse(reservation.expiresAt)).toBeLessThanOrEqual(
      Date.parse(lease.expiresAt),
    );
    const before = databaseBytes(path);
    clock.advance(6 * 60_000);

    await expect(
      reserveAuthority(instance, draft),
    ).rejects.toThrow(/expired|reservation|time/i);
    await expect(
      instance.issueTrustedCommandAuthority(issuance),
    ).rejects.toThrow(/expired|reservation|time/i);
    expect(databaseBytes(path)).toBe(before);
    instance.close();
  });

  it("rejects reserve, issue, submit, claim, and apply after authority expiry with an active lease", async () => {
    const path = databasePath("memi-authority-expiry-");
    const clock = new MutableClock();
    const target = new TargetMutationProbe();
    const instance = runtime(path, clock, [TRUST_ROOT], target);
    const draft = canvasCommandDraft("X");
    const authority = await reserveIssueSubmit(instance, draft);
    const before = databaseBytes(path);
    clock.advance(6 * 60_000);

    await expect(
      reserveAuthority(instance, draft),
    ).rejects.toThrow(/expired|reservation|time/i);
    await expect(
      instance.issueTrustedCommandAuthority(authority.issuance),
    ).rejects.toThrow(/expired|time|valid/i);
    expect(() =>
      instance.submitCommand({
        command: authority.command,
        outboxId: alternateOutboxId("X"),
        effectPayload: draft.payload,
      }),
    ).toThrow(/authority|expired|trusted/i);
    await expect(
      instance.claimCommandEffect({
        commandId: authority.command.id,
        workerId: "expired-claim",
        claimTtlMilliseconds: 5_000,
      }),
    ).rejects.toThrow(/authority|expired|trusted/i);
    await expect(
      instance.applyClaimedEffect(claimFor(authority.command)),
    ).rejects.toThrow(/authority|expired|trusted/i);
    expect(databaseBytes(path)).toBe(before);
    expect(target.applyCalls).toBe(0);
    instance.close();
  });

  it("rejects old authority after actual lease expiry and a higher fence while authority time remains valid", async () => {
    const path = databasePath("memi-authority-fence-");
    const clock = new MutableClock();
    const target = new TargetMutationProbe();
    const instance = runtime(path, clock, [TRUST_ROOT], target);
    const draft = canvasCommandDraft("Y");
    const authority = await reserveIssueSubmit(instance, draft);

    const database = new DatabaseSync(path);
    const expiredAt = "2026-07-28T12:01:00.000Z";
    const oldLease = JSON.parse(
      String(
        (
          database
            .prepare(
              "SELECT lease_json FROM leases WHERE id = ?",
            )
            .get(authority.lease.id) as {
            readonly lease_json: string;
          }
        ).lease_json,
      ),
    ) as Record<string, unknown>;
    database
      .prepare(
        `UPDATE leases
         SET expires_at = ?, lease_json = ?
         WHERE id = ?`,
      )
      .run(
        expiredAt,
        canonicalJson({ ...oldLease, expiresAt: expiredAt }),
        authority.lease.id,
      );
    database.close();
    clock.advance(2 * 60_000);
    const next = instance.acquireLease({
      leaseId: LeaseIdSchema.parse(sortableId("lse", "Z")),
      projectId: authority.command.projectId,
      targetId: authority.command.target.id,
      holderId: authority.command.issuerId,
      ttlMilliseconds: 10 * 60_000,
    });
    await instance.activateCanvasLease({
      projectId: next.projectId,
      targetId: next.targetId,
      leaseId: next.id,
      fencingEpoch: next.fencingEpoch,
    });
    expect(next.fencingEpoch).toBeGreaterThan(
      authority.lease.fencingEpoch,
    );
    expect(Date.parse(authority.issuance.expiresAt)).toBeGreaterThan(
      Date.parse(clock.now()),
    );
    const before = databaseBytes(path);

    await expect(
      reserveAuthority(instance, draft),
    ).rejects.toThrow(/fence|lease|stale/i);
    await expect(
      instance.issueTrustedCommandAuthority(authority.issuance),
    ).rejects.toThrow(/fence|lease|stale/i);
    expect(() =>
      instance.submitCommand({
        command: authority.command,
        outboxId: alternateOutboxId("Y"),
        effectPayload: draft.payload,
      }),
    ).toThrow(/fence|lease|stale|authority/i);
    await expect(
      instance.claimCommandEffect({
        commandId: authority.command.id,
        workerId: "stale-fence-claim",
        claimTtlMilliseconds: 5_000,
      }),
    ).rejects.toThrow(/fence|lease|stale|authority/i);
    await expect(
      instance.applyClaimedEffect(claimFor(authority.command)),
    ).rejects.toThrow(/fence|lease|stale|authority/i);
    expect(databaseBytes(path)).toBe(before);
    expect(target.applyCalls).toBe(0);
    instance.close();
  });

  it("preserves expiry rejection across restart without execution mutation", async () => {
    const path = databasePath("memi-authority-restart-");
    const clock = new MutableClock();
    const first = runtime(path, clock);
    const draft = canvasCommandDraft("Z");
    const authority = await reserveIssueSubmit(first, draft);
    first.close();
    clock.advance(6 * 60_000);

    const target = new TargetMutationProbe();
    const reopened = runtime(path, clock, [TRUST_ROOT], target);
    const before = databaseBytes(path);
    await expect(
      reserveAuthority(reopened, draft),
    ).rejects.toThrow(/expired|reservation|time/i);
    await expect(
      reopened.issueTrustedCommandAuthority(authority.issuance),
    ).rejects.toThrow(/expired|time|valid/i);
    expect(() =>
      reopened.submitCommand({
        command: authority.command,
        outboxId: alternateOutboxId("Z"),
        effectPayload: draft.payload,
      }),
    ).toThrow(/authority|expired|trusted/i);
    await expect(
      reopened.claimCommandEffect({
        commandId: authority.command.id,
        workerId: "restart-expired-claim",
        claimTtlMilliseconds: 5_000,
      }),
    ).rejects.toThrow(/authority|expired|trusted/i);
    await expect(
      reopened.applyClaimedEffect(claimFor(authority.command)),
    ).rejects.toThrow(/authority|expired|trusted/i);
    expect(() => reopened.recover()).toThrow(
      /authority|expired|trusted/i,
    );
    expect(databaseBytes(path)).toBe(before);
    expect(target.applyCalls).toBe(0);
    reopened.close();
  });
});
