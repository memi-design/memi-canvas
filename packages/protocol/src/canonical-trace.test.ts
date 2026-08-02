import { hashCanonicalValue } from "@memi/canonical-json";
import { describe, expect, it } from "vitest";

import * as protocol from "./index.js";

const idBody = "01J00000000000000000000000";
const hash = (character: string) =>
  `sha256:${character.repeat(64)}`;

const body = {
  schemaVersion: 1,
  family: "canvas.operation.committed",
  projectId: `prj_${idBody}`,
  taskId: `tsk_${idBody}`,
  runId: `run_${idBody}`,
  actor: { kind: "agent", id: "runtime-authority" },
  commandId: `cmd_${idBody}`,
  outboxId: `obx_${idBody}`,
  target: {
    kind: "canvas-document",
    id: `doc_${idBody}`,
  },
  idempotencyKey: `idem_${idBody}`,
  commandActionDigest: hash("a"),
  operationActionDigest: hash("b"),
  expectedBeforeHash: hash("c"),
  resultingHash: hash("d"),
  targetReceiptHash: hash("e"),
  verificationRequestDigest: hash("f"),
  verificationEvidenceHash: hash("1"),
  verificationCheckedAt: "2026-07-28T12:00:00.000Z",
  operationId: `opn_${idBody}`,
  appliedRevision: 1,
  leaseId: `lse_${idBody}`,
  fencingEpoch: 3,
} as const;

const allocation = {
  eventId: `evt_${idBody}`,
  sequence: 1,
  occurredAt: "2026-07-28T12:00:01.000Z",
  previousEventHash: null,
} as const;

type Schema = {
  readonly parse: (input: unknown) => unknown;
  readonly safeParse: (
    input: unknown,
  ) => { readonly success: boolean };
};

function schemas() {
  return protocol as unknown as {
    readonly CanvasOperationCommittedBodySchema: Schema;
    readonly CanvasOperationCommittedAllocationSchema: Schema;
    readonly CanvasOperationCommittedEventSchema: Schema;
    readonly CanvasTraceEffectBindingHashMaterialSchema: Schema;
    readonly CanvasTraceEffectBindingSchema: Schema;
    readonly CanvasCommittedEffectReceiptHashMaterialSchema: Schema;
    readonly CanvasCommittedEffectReceiptSchema: Schema;
  };
}

describe("canonical canvas operation trace protocol", () => {
  it("defines closed body, allocation, and event contracts", () => {
    const {
      CanvasOperationCommittedBodySchema,
      CanvasOperationCommittedAllocationSchema,
      CanvasOperationCommittedEventSchema,
    } = schemas();
    const actionMaterial = {
      ...body,
      id: allocation.eventId,
    };
    const hashMaterial = {
      ...actionMaterial,
      sequence: allocation.sequence,
      occurredAt: allocation.occurredAt,
      previousEventHash: allocation.previousEventHash,
      eventActionDigest: hashCanonicalValue(actionMaterial),
    };
    const event = {
      ...hashMaterial,
      eventHash: hashCanonicalValue(hashMaterial),
    };

    expect(CanvasOperationCommittedBodySchema.parse(body)).toEqual(
      body,
    );
    expect(
      CanvasOperationCommittedAllocationSchema.parse(allocation),
    ).toEqual(allocation);
    expect(
      CanvasOperationCommittedEventSchema.parse(event),
    ).toEqual(event);
  });

  it("rejects caller fields, persisted challenge nonce, and invalid authority allocation", () => {
    const {
      CanvasOperationCommittedBodySchema,
      CanvasOperationCommittedAllocationSchema,
      CanvasOperationCommittedEventSchema,
    } = schemas();

    expect(
      CanvasOperationCommittedBodySchema.safeParse({
        ...body,
        challengeNonce: "secret-recovery-nonce",
      }).success,
    ).toBe(false);
    expect(
      CanvasOperationCommittedBodySchema.safeParse({
        ...body,
        callerObservedTargetHash: hash("9"),
      }).success,
    ).toBe(false);
    expect(
      CanvasOperationCommittedAllocationSchema.safeParse({
        ...allocation,
        sequence: 0,
      }).success,
    ).toBe(false);
    expect(
      CanvasOperationCommittedEventSchema.safeParse({
        ...body,
        id: allocation.eventId,
        ...allocation,
        eventActionDigest: hash("7"),
        eventHash: hash("8"),
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it("defines closed binding and final receipt hash material", () => {
    const {
      CanvasTraceEffectBindingHashMaterialSchema,
      CanvasTraceEffectBindingSchema,
      CanvasCommittedEffectReceiptHashMaterialSchema,
      CanvasCommittedEffectReceiptSchema,
    } = schemas();
    const binding = {
      schemaVersion: 1,
      projectId: body.projectId,
      commandId: body.commandId,
      outboxId: body.outboxId,
      eventId: allocation.eventId,
      eventHash: hash("2"),
      target: body.target,
      targetReceiptHash: body.targetReceiptHash,
      verificationAttemptId: `rcv_${idBody}`,
      verificationRequestDigest:
        body.verificationRequestDigest,
      verificationEvidenceHash:
        body.verificationEvidenceHash,
      resultingHash: body.resultingHash,
    } as const;
    const bindingDigest = hashCanonicalValue(binding);
    const receiptMaterial = {
      schemaVersion: 1,
      projectId: body.projectId,
      commandId: body.commandId,
      outboxId: body.outboxId,
      eventId: allocation.eventId,
      eventHash: binding.eventHash,
      bindingDigest,
      resultingHash: body.resultingHash,
      targetReceiptHash: body.targetReceiptHash,
      verificationEvidenceHash:
        body.verificationEvidenceHash,
      committedAt: allocation.occurredAt,
    } as const;
    const receipt = {
      ...receiptMaterial,
      receiptHash: hashCanonicalValue(receiptMaterial),
    };

    expect(
      CanvasTraceEffectBindingHashMaterialSchema.parse(binding),
    ).toEqual(binding);
    expect(
      CanvasTraceEffectBindingSchema.parse({
        ...binding,
        bindingDigest,
      }),
    ).toEqual({ ...binding, bindingDigest });
    expect(
      CanvasTraceEffectBindingSchema.safeParse({
        ...binding,
        bindingDigest: hash("0"),
      }).success,
    ).toBe(false);
    expect(
      CanvasCommittedEffectReceiptHashMaterialSchema.parse(
        receiptMaterial,
      ),
    ).toEqual(receiptMaterial);
    expect(
      CanvasCommittedEffectReceiptSchema.parse(receipt),
    ).toEqual(receipt);
    expect(
      CanvasCommittedEffectReceiptSchema.safeParse({
        ...receipt,
        challengeNonce: "must-not-persist",
      }).success,
    ).toBe(false);
  });
});
