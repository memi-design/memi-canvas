import { z } from "zod";

const SORTABLE_ID_BODY = "[0-9A-HJKMNP-TV-Z]{26}";

function brandedId<const Brand extends string>(prefix: string) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_${SORTABLE_ID_BODY}$`, "u"))
    .brand<Brand>();
}

export const ProjectIdSchema = brandedId<"ProjectId">("prj");
export type ProjectId = z.infer<typeof ProjectIdSchema>;

export const FlowIdSchema = brandedId<"FlowId">("flw");
export type FlowId = z.infer<typeof FlowIdSchema>;

export const RouteIdSchema = brandedId<"RouteId">("rte");
export type RouteId = z.infer<typeof RouteIdSchema>;

export const StateIdSchema = brandedId<"StateId">("sta");
export type StateId = z.infer<typeof StateIdSchema>;

export const CoverageCellIdSchema = brandedId<"CoverageCellId">("cov");
export type CoverageCellId = z.infer<typeof CoverageCellIdSchema>;

export const CanvasDocumentIdSchema = brandedId<"CanvasDocumentId">("doc");
export type CanvasDocumentId = z.infer<typeof CanvasDocumentIdSchema>;

export const CanvasNodeIdSchema = brandedId<"CanvasNodeId">("nod");
export type CanvasNodeId = z.infer<typeof CanvasNodeIdSchema>;

export const OperationIdSchema = brandedId<"OperationId">("opn");
export type OperationId = z.infer<typeof OperationIdSchema>;

export const TraceEventIdSchema = brandedId<"TraceEventId">("evt");
export type TraceEventId = z.infer<typeof TraceEventIdSchema>;

export const ArtifactIdSchema = brandedId<"ArtifactId">("art");
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;

export const TaskIdSchema = brandedId<"TaskId">("tsk");
export type TaskId = z.infer<typeof TaskIdSchema>;

export const RunIdSchema = brandedId<"RunId">("run");
export type RunId = z.infer<typeof RunIdSchema>;

export const ChangeSetIdSchema = brandedId<"ChangeSetId">("chg");
export type ChangeSetId = z.infer<typeof ChangeSetIdSchema>;

export const CapabilityGrantIdSchema =
  brandedId<"CapabilityGrantId">("grt");
export type CapabilityGrantId = z.infer<typeof CapabilityGrantIdSchema>;

export const LeaseIdSchema = brandedId<"LeaseId">("lse");
export type LeaseId = z.infer<typeof LeaseIdSchema>;

export const CheckpointIdSchema = brandedId<"CheckpointId">("chk");
export type CheckpointId = z.infer<typeof CheckpointIdSchema>;

export const RecoveryAttemptIdSchema =
  brandedId<"RecoveryAttemptId">("rcv");
export type RecoveryAttemptId = z.infer<typeof RecoveryAttemptIdSchema>;

export const OutboxIdSchema = brandedId<"OutboxId">("obx");
export type OutboxId = z.infer<typeof OutboxIdSchema>;

export const CapturePlanIdSchema = brandedId<"CapturePlanId">("cap");
export type CapturePlanId = z.infer<typeof CapturePlanIdSchema>;

export const CorrelationIdSchema = brandedId<"CorrelationId">("cor");
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;

export const IdempotencyKeySchema = brandedId<"IdempotencyKey">("idem");
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

export const WorktreeIdSchema = brandedId<"WorktreeId">("wrk");
export type WorktreeId = z.infer<typeof WorktreeIdSchema>;

export const DurableCommandIdSchema =
  brandedId<"DurableCommandId">("cmd");
export type DurableCommandId = z.infer<typeof DurableCommandIdSchema>;

export const ApprovalReceiptIdSchema =
  brandedId<"ApprovalReceiptId">("apr");
export type ApprovalReceiptId = z.infer<typeof ApprovalReceiptIdSchema>;

export const TrustedCommandAuthorityReservationIdSchema =
  brandedId<"TrustedCommandAuthorityReservationId">("rsv");
export type TrustedCommandAuthorityReservationId = z.infer<
  typeof TrustedCommandAuthorityReservationIdSchema
>;

export const SandboxProfileIdSchema =
  brandedId<"SandboxProfileId">("sbx");
export type SandboxProfileId = z.infer<typeof SandboxProfileIdSchema>;

export const ProcessRequestIdSchema =
  brandedId<"ProcessRequestId">("prq");
export type ProcessRequestId = z.infer<typeof ProcessRequestIdSchema>;
