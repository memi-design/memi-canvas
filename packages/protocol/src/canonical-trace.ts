import { hashCanonicalValue } from "@memi/canonical-json";
import { z } from "zod";

import {
  ContentHashSchema,
  IsoTimestampSchema,
  SchemaVersionSchema,
} from "./common.js";
import {
  CanvasDocumentIdSchema,
  DurableCommandIdSchema,
  IdempotencyKeySchema,
  LeaseIdSchema,
  OperationIdSchema,
  OutboxIdSchema,
  ProjectIdSchema,
  RunIdSchema,
  TaskIdSchema,
  TraceEventIdSchema,
  RecoveryAttemptIdSchema,
} from "./ids.js";
import { TraceActorSchema } from "./trace.js";

const CanvasTraceTargetSchema = z.strictObject({
  kind: z.literal("canvas-document"),
  id: CanvasDocumentIdSchema,
});

export const CanvasOperationCommittedBodySchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  family: z.literal("canvas.operation.committed"),
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
  runId: RunIdSchema,
  actor: TraceActorSchema,
  commandId: DurableCommandIdSchema,
  outboxId: OutboxIdSchema,
  target: CanvasTraceTargetSchema,
  idempotencyKey: IdempotencyKeySchema,
  commandActionDigest: ContentHashSchema,
  operationActionDigest: ContentHashSchema,
  expectedBeforeHash: ContentHashSchema,
  resultingHash: ContentHashSchema,
  targetReceiptHash: ContentHashSchema,
  verificationRequestDigest: ContentHashSchema,
  verificationEvidenceHash: ContentHashSchema,
  verificationCheckedAt: IsoTimestampSchema,
  operationId: OperationIdSchema,
  appliedRevision: z.number().int().nonnegative(),
  leaseId: LeaseIdSchema,
  fencingEpoch: z.number().int().positive(),
});
export type CanvasOperationCommittedBody = z.infer<
  typeof CanvasOperationCommittedBodySchema
>;

export const CanvasOperationCommittedAllocationSchema =
  z.strictObject({
    eventId: TraceEventIdSchema,
    sequence: z.number().int().positive(),
    occurredAt: IsoTimestampSchema,
    previousEventHash: ContentHashSchema.nullable(),
  });
export type CanvasOperationCommittedAllocation = z.infer<
  typeof CanvasOperationCommittedAllocationSchema
>;

export const CanvasOperationCommittedActionMaterialSchema =
  z.strictObject({
    ...CanvasOperationCommittedBodySchema.shape,
    id: TraceEventIdSchema,
  });
export type CanvasOperationCommittedActionMaterial = z.infer<
  typeof CanvasOperationCommittedActionMaterialSchema
>;

export const CanvasOperationCommittedEventHashMaterialSchema =
  z.strictObject({
    ...CanvasOperationCommittedActionMaterialSchema.shape,
    sequence: z.number().int().positive(),
    occurredAt: IsoTimestampSchema,
    previousEventHash: ContentHashSchema.nullable(),
    eventActionDigest: ContentHashSchema,
  });
export type CanvasOperationCommittedEventHashMaterial = z.infer<
  typeof CanvasOperationCommittedEventHashMaterialSchema
>;

export const CanvasOperationCommittedEventSchema = z
  .strictObject({
    ...CanvasOperationCommittedEventHashMaterialSchema.shape,
    eventHash: ContentHashSchema,
  })
  .superRefine((event, context) => {
    const {
      eventHash,
      eventActionDigest,
      sequence,
      occurredAt,
      previousEventHash,
      ...actionMaterial
    } = event;
    if (
      eventActionDigest !== hashCanonicalValue(actionMaterial)
    ) {
      context.addIssue({
        code: "custom",
        path: ["eventActionDigest"],
        message:
          "Canvas operation trace action digest is invalid.",
      });
    }
    const eventMaterial = {
      ...actionMaterial,
      sequence,
      occurredAt,
      previousEventHash,
      eventActionDigest,
    };
    if (eventHash !== hashCanonicalValue(eventMaterial)) {
      context.addIssue({
        code: "custom",
        path: ["eventHash"],
        message: "Canvas operation trace event hash is invalid.",
      });
    }
  });
export type CanvasOperationCommittedEvent = z.infer<
  typeof CanvasOperationCommittedEventSchema
>;

export const CanvasTraceEffectBindingHashMaterialSchema =
  z.strictObject({
    schemaVersion: SchemaVersionSchema,
    projectId: ProjectIdSchema,
    commandId: DurableCommandIdSchema,
    outboxId: OutboxIdSchema,
    eventId: TraceEventIdSchema,
    eventHash: ContentHashSchema,
    target: CanvasTraceTargetSchema,
    targetReceiptHash: ContentHashSchema,
    verificationAttemptId: RecoveryAttemptIdSchema,
    verificationRequestDigest: ContentHashSchema,
    verificationEvidenceHash: ContentHashSchema,
    resultingHash: ContentHashSchema,
  });
export type CanvasTraceEffectBindingHashMaterial = z.infer<
  typeof CanvasTraceEffectBindingHashMaterialSchema
>;

export const CanvasTraceEffectBindingSchema = z
  .strictObject({
    ...CanvasTraceEffectBindingHashMaterialSchema.shape,
    bindingDigest: ContentHashSchema,
  })
  .superRefine((binding, context) => {
    const { bindingDigest, ...material } = binding;
    if (bindingDigest !== hashCanonicalValue(material)) {
      context.addIssue({
        code: "custom",
        path: ["bindingDigest"],
        message: "Canvas trace effect binding digest is invalid.",
      });
    }
  });
export type CanvasTraceEffectBinding = z.infer<
  typeof CanvasTraceEffectBindingSchema
>;

export const CanvasCommittedEffectReceiptHashMaterialSchema =
  z.strictObject({
    schemaVersion: SchemaVersionSchema,
    projectId: ProjectIdSchema,
    commandId: DurableCommandIdSchema,
    outboxId: OutboxIdSchema,
    eventId: TraceEventIdSchema,
    eventHash: ContentHashSchema,
    bindingDigest: ContentHashSchema,
    resultingHash: ContentHashSchema,
    targetReceiptHash: ContentHashSchema,
    verificationEvidenceHash: ContentHashSchema,
    committedAt: IsoTimestampSchema,
  });
export type CanvasCommittedEffectReceiptHashMaterial = z.infer<
  typeof CanvasCommittedEffectReceiptHashMaterialSchema
>;

export const CanvasCommittedEffectReceiptSchema = z
  .strictObject({
    ...CanvasCommittedEffectReceiptHashMaterialSchema.shape,
    receiptHash: ContentHashSchema,
  })
  .superRefine((receipt, context) => {
    const { receiptHash, ...material } = receipt;
    if (receiptHash !== hashCanonicalValue(material)) {
      context.addIssue({
        code: "custom",
        path: ["receiptHash"],
        message: "Canvas committed effect receipt hash is invalid.",
      });
    }
  });
export type CanvasCommittedEffectReceipt = z.infer<
  typeof CanvasCommittedEffectReceiptSchema
>;
