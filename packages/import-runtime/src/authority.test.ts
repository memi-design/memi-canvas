import { describe, expect, it } from "vitest";

import { canonicalJson, hashCanonicalValue } from "@memi/canonical-json";

import {
  IMPORT_BATCH_CONSEQUENCE,
  executeApprovedImportBatch,
  issueApprovedImportAuthorityBatch,
  reserveApprovedImportAuthorityBatch,
  validateIssuedImportAuthorityBatch,
} from "./index.js";
import {
  approvalSigner,
  cleanupFixture,
  databaseCounts,
  humanDecision,
  productPlan,
  runtimeFixture,
} from "../test-support.js";

type MutableIssuedBatch = {
  batchDigest: string;
  entries: Array<{
    issuance: {
      consequence: string;
      approver: { id: string; keyId: string };
      trustRootId: string;
      trustRootFingerprint: string;
      issuedAt: string;
      expiresAt: string;
      signatureAlgorithm: string;
      signature: string;
    };
    issuedAuthority: {
      issuanceDigest: string;
      trustRootId: string;
      trustRootFingerprint: string;
      signatureAlgorithm: string;
      signature: string;
    };
  }>;
};

function tamperedIssuedBatch(
  input: unknown,
  mutate: (entry: MutableIssuedBatch["entries"][number]) => void,
) {
  const changed = structuredClone(input) as MutableIssuedBatch;
  const entry = changed.entries[0];
  if (entry === undefined) {
    throw new Error("Issued authority fixture is empty.");
  }
  mutate(entry);
  entry.issuedAuthority.issuanceDigest = hashCanonicalValue(
    entry.issuance,
  );
  const { batchDigest: _oldDigest, ...body } = changed;
  return {
    ...body,
    batchDigest: hashCanonicalValue(body),
  };
}

const postIssuanceTamperCases = [
  ["consequence", (entry: MutableIssuedBatch["entries"][number]) => {
    entry.issuance.consequence = "Apply a different consequence.";
  }],
  ["approver id", (entry: MutableIssuedBatch["entries"][number]) => {
    entry.issuance.approver.id = "different-human";
  }],
  ["approver key", (entry: MutableIssuedBatch["entries"][number]) => {
    entry.issuance.approver.keyId = "different-key";
  }],
  ["trust root id", (entry: MutableIssuedBatch["entries"][number]) => {
    entry.issuance.trustRootId = "different-root";
    entry.issuedAuthority.trustRootId = "different-root";
  }],
  ["trust root fingerprint", (entry: MutableIssuedBatch["entries"][number]) => {
    const fingerprint = `sha256:${"f".repeat(64)}`;
    entry.issuance.trustRootFingerprint = fingerprint;
    entry.issuedAuthority.trustRootFingerprint = fingerprint;
  }],
  ["issued time", (entry: MutableIssuedBatch["entries"][number]) => {
    entry.issuance.issuedAt = "2026-07-28T12:00:00.001Z";
  }],
  ["expiry", (entry: MutableIssuedBatch["entries"][number]) => {
    entry.issuance.expiresAt = "2026-07-28T12:04:59.000Z";
  }],
  ["signature algorithm", (entry: MutableIssuedBatch["entries"][number]) => {
    entry.issuance.signatureAlgorithm = "caller-authored";
    entry.issuedAuthority.signatureAlgorithm = "caller-authored";
  }],
  ["signature", (entry: MutableIssuedBatch["entries"][number]) => {
    const signature = Buffer.from("caller-authored-signature").toString(
      "base64",
    );
    entry.issuance.signature = signature;
    entry.issuedAuthority.signature = signature;
  }],
] as const;

describe("trusted import authority preparation", () => {
  it("reserves opaque authority before external approval issues exact per-operation grants", async () => {
    const { workspace, plan } = await productPlan();
    const fixture = await runtimeFixture(plan);
    try {
      const decision = humanDecision(plan);
      const reserved = await reserveApprovedImportAuthorityBatch(
        fixture.runtime,
        workspace,
        plan,
        fixture.lease,
        decision,
      );
      expect(reserved.entries).toHaveLength(18);
      expect(
        new Set(
          reserved.entries.flatMap((entry) => [
            entry.reservation.id,
            entry.reservation.challenge,
            entry.reservation.grantId,
            entry.reservation.approvalId,
          ]),
        ).size,
      ).toBe(18 * 4);
      expect(databaseCounts(fixture.runtimePath, fixture.targetPath)).toEqual({
        commands: 0,
        outbox: 0,
        grants: 0,
        approvals: 0,
        targetReceipts: 0,
        targetAuthorityReceipts: 0,
        acceptedVerificationAttempts: 0,
        traceBindings: 0,
        events: 0,
        projections: 0,
        canonicalReceipts: 0,
        latches: 0,
      });

      const issued = await issueApprovedImportAuthorityBatch(
        fixture.runtime,
        workspace,
        plan,
        reserved,
        approvalSigner(plan),
      );
      expect(issued.entries).toHaveLength(18);
      for (const entry of issued.entries) {
        expect(entry.command.issuerId).toBe("import-runtime");
        expect(entry.command.requiredCapabilities).toEqual(["canvas:apply"]);
        expect(entry.grant).toMatchObject({
          id: entry.reservation.grantId,
          capabilities: ["canvas:apply"],
          constraints: {
            canonicalPaths: [],
            allowedHosts: [],
            actionDigest: entry.command.actionDigest,
            maximumUses: 1,
          },
        });
        expect(entry.approval).toMatchObject({
          id: entry.reservation.approvalId,
          capabilities: ["canvas:apply"],
          consequence: IMPORT_BATCH_CONSEQUENCE,
          actionDigest: entry.command.actionDigest,
          maximumUses: 1,
        });
        expect(entry.issuedAuthority.reviewedContext).toEqual({
          workspaceDigest: workspace.workspaceDigest,
          planDigest: plan.planDigest,
          batchRootDigest: issued.batchRootDigest,
        });
      }
      await expect(
        validateIssuedImportAuthorityBatch(
          fixture.runtime,
          issued,
          workspace,
          plan,
        ),
      ).resolves.toEqual(issued);
      expect(Object.isFrozen(issued)).toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("replays reservations and issuance without replacing runtime-owned authority", async () => {
    const { workspace, plan } = await productPlan();
    const fixture = await runtimeFixture(plan);
    try {
      const firstReservation = await reserveApprovedImportAuthorityBatch(
        fixture.runtime,
        workspace,
        plan,
        fixture.lease,
        humanDecision(plan),
      );
      const secondReservation = await reserveApprovedImportAuthorityBatch(
        fixture.runtime,
        structuredClone(workspace),
        structuredClone(plan),
        structuredClone(fixture.lease),
        structuredClone(humanDecision(plan)),
      );
      expect(canonicalJson(secondReservation)).toBe(
        canonicalJson(firstReservation),
      );
      const first = await issueApprovedImportAuthorityBatch(
        fixture.runtime,
        workspace,
        plan,
        firstReservation,
        approvalSigner(plan),
      );
      const second = await issueApprovedImportAuthorityBatch(
        fixture.runtime,
        workspace,
        plan,
        secondReservation,
        approvalSigner(plan),
      );
      expect(second).toEqual(first);
      const { batchDigest, ...body } = first;
      expect(batchDigest).toBe(hashCanonicalValue(body));
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it.each([
    ["rejected decision", { outcome: "rejected" }],
    ["wrong project", {
      projectId: "prj_01J00000000000000000000001",
    }],
    ["wrong plan digest", { planDigest: `sha256:${"a".repeat(64)}` }],
    ["wrong consequence", { consequence: "Apply all changes." }],
    ["overlong decision", {
      expiresAt: "2026-07-28T12:30:00.000Z",
    }],
  ])("fails before reservation for %s", async (_label, override) => {
    const { workspace, plan } = await productPlan();
    const fixture = await runtimeFixture(plan);
    try {
      await expect(
        reserveApprovedImportAuthorityBatch(
          fixture.runtime,
          workspace,
          plan,
          fixture.lease,
          humanDecision(plan, override as never),
        ),
      ).rejects.toThrow();
      expect(databaseCounts(fixture.runtimePath, fixture.targetPath)).toMatchObject({
        grants: 0,
        approvals: 0,
        commands: 0,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects a signer that does not match the reviewed human before issuance", async () => {
    const { workspace, plan } = await productPlan();
    const fixture = await runtimeFixture(plan);
    try {
      const reserved = await reserveApprovedImportAuthorityBatch(
        fixture.runtime,
        workspace,
        plan,
        fixture.lease,
        humanDecision(plan),
      );
      const signer = approvalSigner(plan);
      await expect(
        issueApprovedImportAuthorityBatch(
          fixture.runtime,
          workspace,
          plan,
          reserved,
          {
            ...signer,
            approver: {
              ...signer.approver,
              id: "caller-authored-reviewer",
            },
          },
        ),
      ).rejects.toThrow(/approval|review|signer/i);
      expect(databaseCounts(fixture.runtimePath, fixture.targetPath)).toMatchObject({
        grants: 0,
        approvals: 0,
        commands: 0,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it.each(postIssuanceTamperCases)(
    "rejects post-issuance %s tamper before command or target mutation",
    async (_label, mutate) => {
      const { workspace, plan } = await productPlan();
      const fixture = await runtimeFixture(plan);
      try {
        const reserved = await reserveApprovedImportAuthorityBatch(
          fixture.runtime,
          workspace,
          plan,
          fixture.lease,
          humanDecision(plan),
        );
        const issued = await issueApprovedImportAuthorityBatch(
          fixture.runtime,
          workspace,
          plan,
          reserved,
          approvalSigner(plan),
        );
        const tampered = tamperedIssuedBatch(issued, mutate);
        const before = databaseCounts(
          fixture.runtimePath,
          fixture.targetPath,
        );

        await expect(
          validateIssuedImportAuthorityBatch(
            fixture.runtime,
            tampered as never,
            workspace,
            plan,
          ),
        ).rejects.toThrow();
        await expect(
          executeApprovedImportBatch(
            fixture.runtime,
            workspace,
            plan,
            tampered as never,
          ),
        ).rejects.toThrow();
        expect(
          databaseCounts(fixture.runtimePath, fixture.targetPath),
        ).toEqual(before);
      } finally {
        await cleanupFixture(fixture);
      }
    },
  );
});
