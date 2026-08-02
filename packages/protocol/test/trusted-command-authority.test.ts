import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";

import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import { describe, expect, it } from "vitest";

import {
  RuntimeIssuedCommandAuthoritySchema,
  TrustedCommandAuthorityIssuanceSchema,
  TrustedCommandAuthorityReservationRequestSchema,
  TrustedCommandAuthorityReservationSchema,
  computeTrustedAuthorityBatchRoot,
} from "../src/index.js";

function contentHash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}

const ROOT = (() => {
  const pair = generateKeyPairSync("ed25519");
  const spki = pair.publicKey.export({
    format: "der",
    type: "spki",
  });
  return {
    keyId: "human-root-key",
    trustRootId: "local-human-approval-root",
    fingerprint:
      `sha256:${createHash("sha256").update(spki).digest("hex")}` as const,
    sign(payload: object) {
      return sign(
        null,
        Buffer.from(canonicalJson(payload)),
        pair.privateKey,
      ).toString("base64");
    },
  };
})();

const TARGET = Object.freeze({
  kind: "canvas-document" as const,
  id: "doc_0000000000000000000000000A",
  expectedBeforeHash: contentHash("a"),
  baseline: {
    kind: "canvas-revision" as const,
    revision: 17,
    stateHash: contentHash("a"),
  },
});

const REVIEWED_BATCH = Object.freeze({
  schemaVersion: 1 as const,
  kind: "memi-import-authority-batch-root" as const,
  projectId: "prj_0000000000000000000000000A",
  documentId: TARGET.id,
  workspaceDigest: contentHash("w"),
  planDigest: contentHash("p"),
  operations: [
    {
      ordinal: 0,
      operationId: "opn_0000000000000000000000000A",
      actionDigest: contentHash("c"),
    },
  ],
});

const REVIEWED = Object.freeze({
  workspaceDigest: REVIEWED_BATCH.workspaceDigest,
  planDigest: REVIEWED_BATCH.planDigest,
  batchRootDigest: computeTrustedAuthorityBatchRoot(REVIEWED_BATCH),
});

const COMMAND_DRAFT = Object.freeze({
  schemaVersion: 1 as const,
  id: "cmd_0000000000000000000000000A",
  projectId: REVIEWED_BATCH.projectId,
  taskId: "tsk_0000000000000000000000000A",
  runId: "run_0000000000000000000000000A",
  issuerId: "import-runtime",
  kind: "canvas.operation" as const,
  target: TARGET,
  payloadHash: contentHash("e"),
  idempotencyKey: "idem_0000000000000000000000000A",
  actionDigest: contentHash("d"),
  requiredCapabilities: ["canvas:apply"] as const,
  authority: {
    capabilityGrantId: "grt_0000000000000000000000000Z",
    approvalReceiptId: "apr_0000000000000000000000000Z",
    leaseId: "lse_0000000000000000000000000A",
    fencingEpoch: 3,
  },
  issuedAt: "2026-07-28T12:00:00.000Z",
});

function reservationRequest() {
  return {
    schemaVersion: 1 as const,
    kind: "trusted-command-authority-reservation-request" as const,
    projectId: "prj_0000000000000000000000000A",
    issuerId: "import-runtime",
    commandId: "cmd_0000000000000000000000000A",
    operationId: "opn_0000000000000000000000000A",
    target: TARGET,
    requiredCapabilities: ["canvas:apply"] as const,
    leaseId: "lse_0000000000000000000000000A",
    fencingEpoch: 3,
    commandDraft: COMMAND_DRAFT,
    reviewedContext: REVIEWED,
  };
}

function reservation() {
  return {
    schemaVersion: 1 as const,
    kind: "trusted-command-authority-reservation" as const,
    id: "rsv_0000000000000000000000000A",
    requestDigest: contentHash("q"),
    challenge:
      "challenge-0000000000000000000000000000000000000000000",
    grantId: "grt_0000000000000000000000000A",
    approvalId: "apr_0000000000000000000000000A",
    projectId: reservationRequest().projectId,
    commandId: reservationRequest().commandId,
    operationId: reservationRequest().operationId,
    target: TARGET,
    leaseId: reservationRequest().leaseId,
    fencingEpoch: reservationRequest().fencingEpoch,
    reviewedContext: REVIEWED,
    reservedAt: "2026-07-28T12:00:00.000Z",
    expiresAt: "2026-07-28T12:05:00.000Z",
  };
}

function signedIssuance() {
  const held = reservation();
  const unsigned = {
    schemaVersion: 1 as const,
    kind: "trusted-command-authority-issuance" as const,
    reservationId: held.id,
    reservationRequestDigest: held.requestDigest,
    challenge: held.challenge,
    grantId: held.grantId,
    approvalId: held.approvalId,
    projectId: held.projectId,
    issuerId: "import-runtime",
    commandId: held.commandId,
    operationId: held.operationId,
    target: held.target,
    actionDigest: contentHash("b"),
    requiredCapabilities: ["canvas:apply"] as const,
    leaseId: held.leaseId,
    fencingEpoch: held.fencingEpoch,
    approver: {
      kind: "human" as const,
      id: "local-user",
      keyId: ROOT.keyId,
    },
    trustRootId: ROOT.trustRootId,
    trustRootFingerprint: ROOT.fingerprint,
    reviewedContext: REVIEWED,
    consequence: "Apply the reviewed import batch.",
    issuedAt: "2026-07-28T12:00:00.000Z",
    expiresAt: "2026-07-28T12:05:00.000Z",
    maximumUses: 1,
  };
  return {
    ...unsigned,
    signatureAlgorithm: "ed25519" as const,
    signature: ROOT.sign(unsigned),
  };
}

describe("trusted command authority protocol", () => {
  it("reserves opaque authority ids without accepting caller-selected ids", () => {
    expect(
      TrustedCommandAuthorityReservationRequestSchema.parse(
        reservationRequest(),
      ),
    ).toEqual(reservationRequest());
    expect(
      TrustedCommandAuthorityReservationSchema.parse(reservation()),
    ).toEqual(reservation());

    expect(() =>
      TrustedCommandAuthorityReservationRequestSchema.parse({
        ...reservationRequest(),
        desiredGrantId: reservation().grantId,
      }),
    ).toThrow();
    expect(() =>
      TrustedCommandAuthorityReservationRequestSchema.parse({
        ...reservationRequest(),
        desiredApprovalId: reservation().approvalId,
      }),
    ).toThrow();
  });

  it("accepts a structurally complete issuance with canonical base64", () => {
    expect(
      TrustedCommandAuthorityIssuanceSchema.parse(signedIssuance()),
    ).toEqual(signedIssuance());
    const canonical = signedIssuance().signature;
    expect(Buffer.from(canonical, "base64").toString("base64")).toBe(
      canonical,
    );
    expect(() =>
      TrustedCommandAuthorityIssuanceSchema.parse({
        ...signedIssuance(),
        signature: `${canonical}=`,
      }),
    ).toThrow(/base64|canonical|signature/i);
  });

  it("retains the complete reservation lineage in issued authority", () => {
    expect(
      RuntimeIssuedCommandAuthoritySchema.parse({
        schemaVersion: 1,
        kind: "runtime-issued-command-authority",
        reservation: reservation(),
        issuanceDigest: contentHash("d"),
        grant: {
          schemaVersion: 1,
          id: reservation().grantId,
          projectId: reservation().projectId,
          clientId: "import-runtime",
          capabilities: ["canvas:apply"],
          constraints: {
            canonicalPaths: [],
            allowedHosts: [],
            actionDigest: contentHash("b"),
            maximumUses: 1,
          },
          issuedAt: "2026-07-28T12:00:00.000Z",
          expiresAt: "2026-07-28T12:05:00.000Z",
        },
        approval: {
          schemaVersion: 1,
          id: reservation().approvalId,
          projectId: reservation().projectId,
          approver: { kind: "human", id: "local-user" },
          target: TARGET,
          actionDigest: contentHash("b"),
          capabilities: ["canvas:apply"],
          consequence: "Apply the reviewed import batch.",
          issuedAt: "2026-07-28T12:00:00.000Z",
          expiresAt: "2026-07-28T12:05:00.000Z",
          maximumUses: 1,
        },
        leaseId: reservation().leaseId,
        fencingEpoch: reservation().fencingEpoch,
        trustRootId: ROOT.trustRootId,
        trustRootFingerprint: ROOT.fingerprint,
        reviewedContext: REVIEWED,
        signatureAlgorithm: "ed25519",
        signature: signedIssuance().signature,
      }),
    ).toMatchObject({
      reservation: {
        id: reservation().id,
        grantId: reservation().grantId,
        approvalId: reservation().approvalId,
      },
      trustRootFingerprint: ROOT.fingerprint,
    });
  });
});

describe("trusted authority batch root", () => {
  const material = {
    schemaVersion: 1 as const,
    kind: "memi-import-authority-batch-root" as const,
    projectId: "prj_0000000000000000000000000A",
    documentId: "doc_0000000000000000000000000A",
    workspaceDigest: REVIEWED.workspaceDigest,
    planDigest: REVIEWED.planDigest,
    operations: [
      {
        ordinal: 0,
        operationId: "opn_0000000000000000000000000A",
        actionDigest: contentHash("1"),
      },
      {
        ordinal: 1,
        operationId: "opn_0000000000000000000000000B",
        actionDigest: contentHash("2"),
      },
    ],
  };

  it("uses an explicit domain and the exact ordered operation universe", () => {
    expect(computeTrustedAuthorityBatchRoot(material)).toBe(
      hashCanonicalValue(material),
    );
  });

  it.each([
    ["reordered", { ...material, operations: [...material.operations].reverse() }],
    ["duplicate ordinal", {
      ...material,
      operations: [
        material.operations[0],
        { ...material.operations[1], ordinal: 0 },
      ],
    }],
    ["duplicate id", {
      ...material,
      operations: [
        material.operations[0],
        {
          ...material.operations[1],
          operationId: material.operations[0]!.operationId,
        },
      ],
    }],
    ["changed workspace", {
      ...material,
      workspaceDigest: contentHash("3"),
    }],
    ["changed plan", { ...material, planDigest: contentHash("4") }],
    ["changed project", {
      ...material,
      projectId: "prj_0000000000000000000000000B",
    }],
  ])("rejects or domain-separates %s material", (_label, changed) => {
    if (_label === "duplicate ordinal" || _label === "duplicate id") {
      expect(() => computeTrustedAuthorityBatchRoot(changed)).toThrow();
      return;
    }
    expect(computeTrustedAuthorityBatchRoot(changed)).not.toBe(
      computeTrustedAuthorityBatchRoot(material),
    );
  });
});
