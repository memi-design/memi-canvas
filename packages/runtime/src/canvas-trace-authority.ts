import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import {
  CanvasCommittedEffectReceiptSchema,
  CanvasOperationCommittedEventSchema,
  CanvasTraceEffectBindingHashMaterialSchema,
  type CanvasCommittedEffectReceipt,
  type CanvasOperation,
  type CanvasOperationCommittedEvent,
  type DurableCommand,
  type TargetReceipt,
  type TargetVerificationRequest,
  type TargetVerificationResult,
} from "../../protocol/src/index.js";

export interface CanvasTraceAllocation {
  readonly eventId: CanvasOperationCommittedEvent["id"];
  readonly sequence: number;
  readonly occurredAt: string;
  readonly previousEventHash: string | null;
}

export function buildCanvasTraceEvent(input: {
  readonly command: DurableCommand;
  readonly outboxId: string;
  readonly operation: CanvasOperation;
  readonly receipt: TargetReceipt;
  readonly request: TargetVerificationRequest;
  readonly verification: TargetVerificationResult & {
    readonly status: "verified-applied";
  };
  readonly allocation: CanvasTraceAllocation;
}): CanvasOperationCommittedEvent {
  const actionMaterial = {
    schemaVersion: 1 as const,
    family: "canvas.operation.committed" as const,
    projectId: input.command.projectId,
    taskId: input.command.taskId,
    runId: input.command.runId,
    actor: { kind: "system" as const, id: "memi-runtime" },
    commandId: input.command.id,
    outboxId: input.outboxId,
    target: {
      kind: input.command.target.kind,
      id: input.command.target.id,
    },
    idempotencyKey: input.command.idempotencyKey,
    commandActionDigest: input.command.actionDigest,
    operationActionDigest: input.operation.actionDigest,
    expectedBeforeHash: input.operation.expectedBeforeHash,
    resultingHash: input.receipt.resultingHash,
    targetReceiptHash: input.receipt.receiptHash,
    verificationRequestDigest: input.request.requestDigest,
    verificationEvidenceHash: input.verification.evidenceHash,
    verificationCheckedAt: input.verification.checkedAt,
    operationId: input.operation.id,
    appliedRevision: input.receipt.appliedRevision,
    leaseId: input.command.authority.leaseId,
    fencingEpoch: input.command.authority.fencingEpoch,
    id: input.allocation.eventId,
  };
  const eventActionDigest = hashCanonicalValue(actionMaterial);
  const eventMaterial = {
    ...actionMaterial,
    sequence: input.allocation.sequence,
    occurredAt: input.allocation.occurredAt,
    previousEventHash: input.allocation.previousEventHash,
    eventActionDigest,
  };
  return CanvasOperationCommittedEventSchema.parse({
    ...eventMaterial,
    eventHash: hashCanonicalValue(eventMaterial),
  });
}

export function buildCanvasBinding(input: {
  readonly command: DurableCommand;
  readonly outboxId: string;
  readonly event: CanvasOperationCommittedEvent;
  readonly receipt: TargetReceipt;
  readonly request: TargetVerificationRequest;
  readonly verification: TargetVerificationResult & {
    readonly status: "verified-applied";
  };
}) {
  const material = CanvasTraceEffectBindingHashMaterialSchema.parse({
    schemaVersion: 1,
    projectId: input.command.projectId,
    commandId: input.command.id,
    outboxId: input.outboxId,
    eventId: input.event.id,
    eventHash: input.event.eventHash,
    target: {
      kind: input.command.target.kind,
      id: input.command.target.id,
    },
    targetReceiptHash: input.receipt.receiptHash,
    verificationAttemptId: input.request.challenge.id,
    verificationRequestDigest: input.request.requestDigest,
    verificationEvidenceHash: input.verification.evidenceHash,
    resultingHash: input.receipt.resultingHash,
  });
  return { material, digest: hashCanonicalValue(material) };
}

export function buildCanvasCommittedReceipt(input: {
  readonly command: DurableCommand;
  readonly outboxId: string;
  readonly event: CanvasOperationCommittedEvent;
  readonly targetReceipt: TargetReceipt;
  readonly verification: TargetVerificationResult & {
    readonly status: "verified-applied";
  };
  readonly bindingDigest: string;
  readonly committedAt: string;
}): CanvasCommittedEffectReceipt {
  const material = {
    schemaVersion: 1 as const,
    projectId: input.command.projectId,
    commandId: input.command.id,
    outboxId: input.outboxId,
    eventId: input.event.id,
    eventHash: input.event.eventHash,
    bindingDigest: input.bindingDigest,
    resultingHash: input.targetReceipt.resultingHash,
    targetReceiptHash: input.targetReceipt.receiptHash,
    verificationEvidenceHash: input.verification.evidenceHash,
    committedAt: input.committedAt,
  };
  return CanvasCommittedEffectReceiptSchema.parse({
    ...material,
    receiptHash: hashCanonicalValue(material),
  });
}

export function exactCanonicalJson(value: unknown): string {
  return canonicalJson(value);
}
