import { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@memi/canonical-json";
import { afterEach, describe, expect, it } from "vitest";

import {
  MutableClock,
  alternateOutboxId,
  contentHash,
  sortableId,
} from "./test-fixtures.js";
import {
  ALTERNATE_ROOT,
  TargetMutationProbe,
  TRUST_ROOT,
  activateLease,
  authorizeAndQueue,
  canvasCommandDraft,
  cleanupAuthorityFixtures,
  databasePath,
  finalCommand,
  reserveAuthority,
  runtime,
  seedMigratedLegacyPendingCommand,
  signedIssuance,
} from "./trusted-command-authority-test-support.js";

afterEach(cleanupAuthorityFixtures);

function persistedExecutionSnapshot(path: string): string {
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

const issuanceTamperCases: readonly [
  label: string,
  overrides: Record<string, unknown>,
  signatureOverride?: string,
][] = [
  ["tampered signature", {}, "tampered"],
  ["changed grant", { grantId: sortableId("grt", "Y") }],
  ["changed approval", { approvalId: sortableId("apr", "Y") }],
  [
    "changed nondegenerate action",
    {
      actionDigest:
        `sha256:${"1234567890abcdef".repeat(4)}`,
    },
  ],
  ["changed challenge", { challenge: "x".repeat(48) }],
  ["changed fence", { fencingEpoch: 9 }],
  ["changed target", {
    target: {
      kind: "canvas-document",
      id: sortableId("doc", "Y"),
      expectedBeforeHash: contentHash("a"),
      baseline: {
        kind: "canvas-revision",
        revision: 0,
        stateHash: contentHash("a"),
      },
    },
  }],
  ["changed consequence", { consequence: "Anything else." }],
  ["changed approver", {
    approver: {
      kind: "human",
      id: "another-human",
      keyId: TRUST_ROOT.keyId,
    },
  }],
  ["changed key id", {
    approver: {
      kind: "human",
      id: "local-user",
      keyId: "untrusted-key",
    },
  }],
  ["changed fingerprint", {
    trustRootFingerprint: contentHash("7"),
  }],
  ["changed workspace", {
    reviewedContext: {
      workspaceDigest: contentHash("8"),
      planDigest: contentHash("p"),
      batchRootDigest: contentHash("r"),
    },
  }],
  ["changed plan", {
    reviewedContext: {
      workspaceDigest: contentHash("w"),
      planDigest: contentHash("8"),
      batchRootDigest: contentHash("r"),
    },
  }],
  ["changed batch root", {
    reviewedContext: {
      workspaceDigest: contentHash("w"),
      planDigest: contentHash("p"),
      batchRootDigest: contentHash("8"),
    },
  }],
];

describe("trusted command authority lifecycle", () => {
  it("derives opaque ids before final command binding and replays issuance across restart", async () => {
    const path = databasePath();
    const clock = new MutableClock();
    const draft = canvasCommandDraft("A");
    const first = runtime(path, clock);
    await activateLease(first, draft.command);

    const reservation = await reserveAuthority(first, draft);
    expect(reservation).toMatchObject({
      kind: "trusted-command-authority-reservation",
      projectId: draft.command.projectId,
      commandId: draft.command.id,
      operationId: draft.payload.id,
      leaseId: draft.command.authority.leaseId,
      fencingEpoch: draft.command.authority.fencingEpoch,
    });
    expect(reservation.grantId).toMatch(
      /^grt_[0-9A-HJKMNP-TV-Z]{26}$/u,
    );
    expect(reservation.approvalId).toMatch(
      /^apr_[0-9A-HJKMNP-TV-Z]{26}$/u,
    );
    expect(reservation.grantId).not.toBe(
      draft.command.authority.capabilityGrantId,
    );
    expect(reservation.approvalId).not.toBe(
      draft.command.authority.approvalReceiptId,
    );

    const command = finalCommand(draft, reservation);
    expect(command.authority).toMatchObject({
      capabilityGrantId: reservation.grantId,
      approvalReceiptId: reservation.approvalId,
    });
    expect(command.actionDigest).not.toBe(draft.command.actionDigest);

    const issuance = signedIssuance(
      command,
      draft.payload,
      reservation,
    );
    const issued = await first.issueTrustedCommandAuthority(issuance);
    expect(issued).toMatchObject({
      reservation,
      trustRootFingerprint: TRUST_ROOT.fingerprint,
      reviewedContext: issuance.reviewedContext,
    });
    first.close();

    const reopened = runtime(path, clock);
    expect(
      await reopened.issueTrustedCommandAuthority(issuance),
    ).toEqual(issued);
    expect(
      reopened.submitCommand({
        command,
        outboxId: alternateOutboxId("A"),
        effectPayload: draft.payload,
      }),
    ).toMatchObject({ commandId: command.id, state: "intent" });
    reopened.close();
  });

  it.each([
    ["no configured roots", []],
    ["same ids with alternate SPKI", [ALTERNATE_ROOT]],
  ] as const)(
    "rejects persisted authority after restart with %s without mutation",
    async (_label, roots) => {
      const path = databasePath("memi-authority-root-pinning-");
      const clock = new MutableClock();
      const draft = canvasCommandDraft("C");
      const first = runtime(path, clock);
      await activateLease(first, draft.command);
      const authorized = await authorizeAndQueue(first, draft);
      first.close();

      const target = new TargetMutationProbe();
      const reopened = runtime(path, clock, roots, target);
      const before = persistedExecutionSnapshot(path);
      const claim = {
        id: `restart-claim:${authorized.command.id}`,
        commandId: authorized.command.id,
        outboxId: alternateOutboxId("C"),
        workerId: "restart-root-pinning-worker",
        fencingEpoch: 1,
        expiresAt: "2026-07-28T12:01:00.000Z",
      };

      await expect(
        reopened.issueTrustedCommandAuthority(
          signedIssuance(
            authorized.command,
            draft.payload,
            authorized.reservation,
          ),
        ),
      ).rejects.toThrow(
        /fingerprint|key|missing|root|signature|trust/i,
      );
      expect(persistedExecutionSnapshot(path)).toBe(before);
      expect(() =>
        reopened.submitCommand({
          command: authorized.command,
          outboxId: alternateOutboxId("C"),
          effectPayload: draft.payload,
        }),
      ).toThrow(/fingerprint|key|root|signature|trust/i);
      expect(persistedExecutionSnapshot(path)).toBe(before);
      await expect(
        reopened.claimCommandEffect({
          commandId: authorized.command.id,
          workerId: "restart-root-pinning-claim",
          claimTtlMilliseconds: 5_000,
        }),
      ).rejects.toThrow(/fingerprint|key|root|signature|trust/i);
      expect(persistedExecutionSnapshot(path)).toBe(before);
      await expect(
        reopened.applyClaimedEffect(claim),
      ).rejects.toThrow(
        /fingerprint|key|root|signature|trust/i,
      );
      expect(persistedExecutionSnapshot(path)).toBe(before);
      expect(() => reopened.recover()).toThrow(
        /fingerprint|key|root|signature|trust/i,
      );
      expect(persistedExecutionSnapshot(path)).toBe(before);
      expect(target.applyCalls).toBe(0);
      reopened.close();
    },
  );

  it.each(issuanceTamperCases)(
    "rejects issuance with %s",
    async (_label, overrides, signatureOverride) => {
    const path = databasePath();
    const clock = new MutableClock();
    const draft = canvasCommandDraft("B");
    const instance = runtime(path, clock);
    await activateLease(instance, draft.command);
    const reservation = await reserveAuthority(instance, draft);
    const command = finalCommand(draft, reservation);
    await expect(
      instance.issueTrustedCommandAuthority(
        signedIssuance(command, draft.payload, reservation, {
          overrides,
          ...(signatureOverride === undefined
            ? {}
            : { signatureOverride }),
        }),
      ),
    ).rejects.toThrow(
      /approval|authority|binding|challenge|fence|signature|trust|verify/i,
    );
    instance.close();
    },
  );

  it("rejects a real migrated raw-authorized pending command at claim, apply, and recovery", async () => {
    const path = databasePath();
    const clock = new MutableClock();
    const seeded = seedMigratedLegacyPendingCommand(path, clock);
    const target = new TargetMutationProbe();
    const reopened = runtime(path, clock, [TRUST_ROOT], target);
    expect(reopened.getCommand(seeded.command.id)).toEqual(
      seeded.command,
    );
    const legacy = new DatabaseSync(path);
    expect(
      legacy
        .prepare(
          `SELECT
             (SELECT count(*) FROM commands) AS commands,
             (SELECT count(*) FROM outbox) AS outboxes,
             (SELECT count(*) FROM capability_grants) AS grants,
             (SELECT count(*) FROM approval_receipts) AS approvals,
             (SELECT count(*) FROM capability_grant_uses) AS grant_uses,
             (SELECT count(*) FROM approval_uses) AS approval_uses`,
        )
        .get(),
    ).toEqual({
      commands: 1,
      outboxes: 1,
      grants: 1,
      approvals: 1,
      grant_uses: 0,
      approval_uses: 0,
    });
    legacy.close();
    const before = persistedExecutionSnapshot(path);
    await expect(
      reopened.claimCommandEffect({
        commandId: seeded.command.id,
        workerId: "legacy-claim",
        claimTtlMilliseconds: 5_000,
      }),
    ).rejects.toThrow(/legacy|lineage|reservation|trusted/i);
    expect(persistedExecutionSnapshot(path)).toBe(before);
    await expect(
      reopened.applyClaimedEffect(seeded.claim),
    ).rejects.toThrow(/legacy|lineage|reservation|trusted/i);
    expect(persistedExecutionSnapshot(path)).toBe(before);
    expect(() => reopened.recover()).toThrow(
      /legacy|lineage|reservation|trusted/i,
    );
    expect(persistedExecutionSnapshot(path)).toBe(before);
    expect(target.applyCalls).toBe(0);
    reopened.close();
  });

  it("persists single-use authority and rejects a second command binding", async () => {
    const path = databasePath();
    const clock = new MutableClock();
    const instance = runtime(path, clock);
    const first = canvasCommandDraft("E");
    await activateLease(instance, first.command);
    const authorized = await authorizeAndQueue(instance, first);

    const second = canvasCommandDraft(
      "F",
      first.command.runId,
      "E",
    );
    const rebound = finalCommand(second, authorized.reservation);
    expect(() =>
      instance.submitCommand({
        command: rebound,
        outboxId: alternateOutboxId("F"),
        effectPayload: second.payload,
      }),
    ).toThrow(/action|authority|command|reservation|single|use/i);
    expect(instance.getCommand(second.command.id)).toBeUndefined();
    instance.close();
  });
});
