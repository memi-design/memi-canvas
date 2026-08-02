import { describe, expect, it } from "vitest";

import { DurableCommandSchema } from "./authority.js";
import {
  BOUNDED_TARGET_RECEIPT_BYTES,
  TargetApplyOutcomeSchema,
  TargetEffectRequestSchema,
  TargetFenceActivationRequestSchema,
  TargetFenceActivationResultSchema,
  TargetLookupRequestSchema,
  TargetLookupResultSchema,
  TargetReceiptHashMaterialSchema,
  TargetReceiptSchema,
  TargetVerificationRequestSchema,
  TargetVerificationResultSchema,
} from "./target-authority.js";

const idBody = "01J00000000000000000000000";
const ids = {
  project: `prj_${idBody}`,
  task: `tsk_${idBody}`,
  run: `run_${idBody}`,
  command: `cmd_${idBody}`,
  outbox: `obx_${idBody}`,
  document: `doc_${idBody}`,
  operation: `opn_${idBody}`,
  idempotency: `idem_${idBody}`,
  grant: `grt_${idBody}`,
  approval: `apr_${idBody}`,
  lease: `lse_${idBody}`,
} as const;
const hashes = {
  before: `sha256:${"a".repeat(64)}`,
  payload: `sha256:${"b".repeat(64)}`,
  commandAction: `sha256:${"c".repeat(64)}`,
  operationAction: `sha256:${"1".repeat(64)}`,
  resulting: `sha256:${"d".repeat(64)}`,
  receipt: `sha256:${"e".repeat(64)}`,
  evidence: `sha256:${"f".repeat(64)}`,
} as const;

const operation = {
  schemaVersion: 1,
  id: ids.operation,
  documentId: ids.document,
  actorId: "issuer-agent",
  occurredAt: "2026-07-28T12:00:00.000Z",
  type: "node.create",
  payload: {
    node: {
      id: `nod_${idBody}`,
      kind: "draft-frame",
      authority: "canvas-document",
      evidenceLevel: "proposed",
      coverageHealth: "current",
      parentId: null,
      position: { x: 0, y: 0 },
      size: { width: 320, height: 240 },
    },
  },
  actionDigest: hashes.operationAction,
  expectedBeforeHash: hashes.before,
  resultingHash: hashes.resulting,
} as const;

const request = {
  schemaVersion: 1,
  effectKind: "canvas.operation",
  projectId: ids.project,
  taskId: ids.task,
  runId: ids.run,
  issuerId: "issuer-agent",
  commandId: ids.command,
  outboxId: ids.outbox,
  target: {
    kind: "canvas-document",
    id: ids.document,
    expectedBeforeHash: hashes.before,
    baseline: {
      kind: "canvas-revision",
      revision: 0,
      stateHash: hashes.before,
    },
  },
  idempotencyKey: ids.idempotency,
  commandActionDigest: hashes.commandAction,
  operationActionDigest: hashes.operationAction,
  payloadHash: hashes.payload,
  payload: operation,
  capabilityGrantId: ids.grant,
  approvalReceiptId: ids.approval,
  lease: {
    id: ids.lease,
    holderId: "issuer-agent",
    fencingEpoch: 7,
  },
  workerClaim: {
    id: "worker-claim-7",
    fencingEpoch: 3,
    expiresAt: "2026-07-28T12:05:00.000Z",
  },
} as const;

const receipt = {
  schemaVersion: 1,
  adapterContractVersion: 1,
  projectId: ids.project,
  taskId: ids.task,
  runId: ids.run,
  outboxId: ids.outbox,
  target: {
    kind: "canvas-document",
    id: ids.document,
  },
  commandId: ids.command,
  idempotencyKey: ids.idempotency,
  commandActionDigest: hashes.commandAction,
  operationActionDigest: hashes.operationAction,
  expectedBeforeHash: hashes.before,
  payloadHash: hashes.payload,
  leaseId: ids.lease,
  leaseHolderId: "issuer-agent",
  fencingEpoch: 7,
  workerClaimId: "worker-claim-7",
  workerClaimFencingEpoch: 3,
  resultingHash: hashes.resulting,
  operationId: ids.operation,
  appliedRevision: 1,
  appliedAt: "2026-07-28T12:00:01.000Z",
  receiptHash: hashes.receipt,
} as const;

describe("target authority protocol", () => {
  it("defines a strict closed request with target-bound canvas payload", () => {
    expect(TargetEffectRequestSchema.parse(request)).toEqual(request);
    expect(() =>
      TargetEffectRequestSchema.parse({
        ...request,
        providerSession: "forbidden",
      }),
    ).toThrow();
    expect(() =>
      TargetEffectRequestSchema.parse({
        ...request,
        schemaVersion: 2,
      }),
    ).toThrow();
    expect(() =>
      TargetEffectRequestSchema.parse({
        ...request,
        payload: {
          ...operation,
          documentId: `doc_${"01J00000000000000000000001"}`,
        },
      }),
    ).toThrow(/target/i);
    expect(() =>
      TargetEffectRequestSchema.parse({
        ...request,
        payload: {
          ...operation,
          expectedBeforeHash: hashes.resulting,
        },
      }),
    ).toThrow(/expected-before/i);
    expect(() =>
      TargetEffectRequestSchema.parse({
        ...request,
        payload: {
          ...operation,
          actionDigest: hashes.commandAction,
        },
      }),
    ).toThrow(/operation action digest/i);
    expect(() =>
      TargetEffectRequestSchema.parse({
        ...request,
        issuerId: "another-agent",
      }),
    ).toThrow(/actor/i);
    expect(() =>
      TargetEffectRequestSchema.parse({
        ...request,
        lease: {
          ...request.lease,
          holderId: "another-agent",
        },
      }),
    ).toThrow(/lease holder/i);
  });

  it("represents the initial revision-zero durable canvas baseline", () => {
    expect(
      DurableCommandSchema.parse({
        schemaVersion: 1,
        id: ids.command,
        projectId: ids.project,
        taskId: ids.task,
        runId: ids.run,
        issuerId: request.issuerId,
        kind: "canvas.operation",
        target: request.target,
        payloadHash: hashes.payload,
        idempotencyKey: ids.idempotency,
        actionDigest: hashes.commandAction,
        requiredCapabilities: ["canvas:apply"],
        authority: {
          capabilityGrantId: ids.grant,
          approvalReceiptId: ids.approval,
          leaseId: ids.lease,
          fencingEpoch: 7,
        },
        issuedAt: "2026-07-28T12:00:00.000Z",
      }),
    ).toMatchObject({
      target: {
        baseline: {
          kind: "canvas-revision",
          revision: 0,
        },
      },
    });
  });

  it("defines strict monotonic fence activation requests and results", () => {
    const activation = {
      schemaVersion: 1,
      projectId: ids.project,
      target: {
        kind: "canvas-document",
        id: ids.document,
      },
      leaseId: ids.lease,
      holderId: "runtime-agent",
      fencingEpoch: 7,
    } as const;
    expect(
      TargetFenceActivationRequestSchema.parse(activation),
    ).toEqual(activation);
    expect(
      TargetFenceActivationResultSchema.parse({
        ...activation,
        status: "activated",
        highestFence: 7,
      }),
    ).toMatchObject({ status: "activated", highestFence: 7 });
    expect(
      TargetFenceActivationResultSchema.parse({
        ...activation,
        status: "replayed",
        highestFence: 7,
      }),
    ).toMatchObject({ status: "replayed", highestFence: 7 });
    expect(() =>
      TargetFenceActivationResultSchema.parse({
        ...activation,
        status: "activated",
        highestFence: 6,
      }),
    ).toThrow(/highest fence/i);
    expect(
      TargetFenceActivationResultSchema.parse({
        ...activation,
        status: "rejected",
        code: "STALE_FENCE",
        highestFence: 8,
      }),
    ).toMatchObject({ status: "rejected", highestFence: 8 });
  });

  it("defines bounded applied, replayed, not-applied, and unknown outcomes", () => {
    expect(
      TargetApplyOutcomeSchema.parse({
        schemaVersion: 1,
        status: "applied",
        receipt,
      }),
    ).toMatchObject({ status: "applied", receipt });
    expect(
      TargetApplyOutcomeSchema.parse({
        schemaVersion: 1,
        status: "replayed",
        receipt,
      }),
    ).toMatchObject({ status: "replayed", receipt });
    expect(
      TargetApplyOutcomeSchema.parse({
        schemaVersion: 1,
        status: "not-applied",
        evidence: {
          code: "STALE_TARGET",
          message: "The target changed.",
          currentTargetHash: hashes.before,
          evidenceHash: hashes.evidence,
        },
      }),
    ).toMatchObject({ status: "not-applied" });
    expect(
      TargetApplyOutcomeSchema.parse({
        schemaVersion: 1,
        status: "outcome-unknown",
        error: {
          code: "TARGET_UNAVAILABLE",
          message: "Target acknowledgement was unavailable.",
        },
      }),
    ).toMatchObject({ status: "outcome-unknown" });
    expect(() =>
      TargetApplyOutcomeSchema.parse({
        schemaVersion: 1,
        status: "applied",
        receipt: {
          ...receipt,
          debug: "x".repeat(BOUNDED_TARGET_RECEIPT_BYTES),
        },
      }),
    ).toThrow();

    const {
      receiptHash: _receiptHash,
      ...hashMaterial
    } = receipt;
    expect(
      TargetReceiptHashMaterialSchema.parse(hashMaterial),
    ).toEqual(hashMaterial);
    expect(() =>
      TargetReceiptHashMaterialSchema.parse(receipt),
    ).toThrow();

    const utf8HeavyReceipt = {
      ...receipt,
      leaseHolderId: "é".repeat(600),
    };
    expect(JSON.stringify(utf8HeavyReceipt).length).toBeLessThanOrEqual(
      BOUNDED_TARGET_RECEIPT_BYTES,
    );
    expect(
      new TextEncoder().encode(JSON.stringify(utf8HeavyReceipt))
        .byteLength,
    ).toBeGreaterThan(BOUNDED_TARGET_RECEIPT_BYTES);
    expect(() =>
      TargetReceiptSchema.parse(utf8HeavyReceipt),
    ).toThrow(/bytes/i);
  });

  it("defines strict trusted lookup requests and result unions", () => {
    const lookup = {
      schemaVersion: 1,
      projectId: ids.project,
      target: request.target,
      idempotencyKey: ids.idempotency,
      commandId: ids.command,
      commandActionDigest: hashes.commandAction,
      operationActionDigest: hashes.operationAction,
      expectedBeforeHash: hashes.before,
      challenge: {
        id: `rcv_${idBody}`,
        nonce: "a".repeat(43),
        issuedAt: "2026-07-28T12:00:00.000Z",
      },
      requestDigest: hashes.evidence,
    } as const;
    expect(TargetLookupRequestSchema.parse(lookup)).toEqual(lookup);
    expect(
      TargetLookupResultSchema.parse({
        schemaVersion: 1,
        status: "found",
        requestDigest: hashes.evidence,
        checkedAt: "2026-07-28T12:00:00.000Z",
        receipt,
        currentTargetHash: hashes.resulting,
        evidenceHash: hashes.evidence,
      }),
    ).toMatchObject({ status: "found" });
    expect(
      TargetLookupResultSchema.parse({
        schemaVersion: 1,
        status: "not-found",
        requestDigest: hashes.evidence,
        checkedAt: "2026-07-28T12:00:00.000Z",
        currentTargetHash: hashes.before,
        evidenceHash: hashes.evidence,
      }),
    ).toMatchObject({ status: "not-found" });
    for (const result of [
      {
        status: "mismatch",
        code: "RECEIPT_IDENTITY_MISMATCH",
        evidenceHash: hashes.evidence,
      },
      {
        status: "unavailable",
        code: "TARGET_UNAVAILABLE",
        evidenceHash: hashes.evidence,
      },
      {
        status: "corrupt",
        code: "LEDGER_CORRUPT",
        evidenceHash: hashes.evidence,
      },
    ] as const) {
      expect(
        TargetLookupResultSchema.parse({
          schemaVersion: 1,
          requestDigest: hashes.evidence,
          checkedAt: "2026-07-28T12:00:00.000Z",
          ...result,
          message: `${result.status} evidence`,
        }),
      ).toMatchObject({ status: result.status });
    }
  });

  it("defines trusted verification requests and fail-closed results", () => {
    const verification = {
      schemaVersion: 1,
      projectId: ids.project,
      target: request.target,
      idempotencyKey: ids.idempotency,
      commandId: ids.command,
      commandActionDigest: hashes.commandAction,
      operationActionDigest: hashes.operationAction,
      expectedBeforeHash: hashes.before,
      expectedResultingHash: hashes.resulting,
      expectedReceiptHash: hashes.receipt,
      challenge: {
        id: `rcv_${idBody}`,
        nonce: "a".repeat(43),
        issuedAt: "2026-07-28T12:00:00.000Z",
      },
      requestDigest: hashes.evidence,
    } as const;
    expect(
      TargetVerificationRequestSchema.parse(verification),
    ).toEqual(verification);
    expect(
      TargetVerificationResultSchema.parse({
        schemaVersion: 1,
        status: "verified-applied",
        receipt,
        currentTargetHash: hashes.resulting,
        requestDigest: hashes.evidence,
        checkedAt: "2026-07-28T12:00:00.000Z",
        evidenceHash: hashes.evidence,
      }),
    ).toMatchObject({ status: "verified-applied" });
    expect(
      TargetVerificationResultSchema.parse({
        schemaVersion: 1,
        status: "verified-not-applied",
        expectedBeforeHash: hashes.before,
        currentTargetHash: hashes.before,
        requestDigest: hashes.evidence,
        checkedAt: "2026-07-28T12:00:00.000Z",
        evidenceHash: hashes.evidence,
      }),
    ).toMatchObject({ status: "verified-not-applied" });
    expect(() =>
      TargetVerificationResultSchema.parse({
        schemaVersion: 1,
        status: "verified-applied",
        receipt,
        currentTargetHash: hashes.before,
        requestDigest: hashes.evidence,
        checkedAt: "2026-07-28T12:00:00.000Z",
        evidenceHash: hashes.evidence,
      }),
    ).toThrow(/resulting hash/i);
    expect(() =>
      TargetVerificationResultSchema.parse({
        schemaVersion: 1,
        status: "verified-not-applied",
        expectedBeforeHash: hashes.before,
        currentTargetHash: hashes.resulting,
        requestDigest: hashes.evidence,
        checkedAt: "2026-07-28T12:00:00.000Z",
        evidenceHash: hashes.evidence,
      }),
    ).toThrow(/expected-before/i);
    expect(() =>
      TargetVerificationResultSchema.parse({
        schemaVersion: 1,
        status: "unavailable",
        code: "TARGET_UNAVAILABLE",
        message: "Target unavailable.",
        requestDigest: hashes.evidence,
        checkedAt: "2026-07-28T12:00:00.000Z",
        evidenceHash: hashes.evidence,
        forgedObservedHash: hashes.resulting,
      }),
    ).toThrow();
  });
});
