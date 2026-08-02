import type {
  ApprovalReceipt,
  CanvasOperation,
  CapabilityGrant,
  ContentHash,
  DurableCommand,
  Lease,
  OutboxId,
  ProjectId,
  RunId,
  RuntimeIssuedCommandAuthority,
  TaskId,
  TrustedCommandAuthorityIssuance,
  TrustedCommandAuthorityReservation,
  TrustedCommandAuthorityReservationRequest,
} from "@memi/protocol";

export interface HumanImportBatchDecision {
  readonly schemaVersion: 1;
  readonly kind: "human-import-batch-decision";
  readonly outcome: "approved" | "rejected";
  readonly projectId: ProjectId;
  readonly planId: `mpl_${string}`;
  readonly planDigest: ContentHash;
  readonly documentId: string;
  readonly approver: {
    readonly kind: "human";
    readonly id: string;
  };
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly consequence: string;
}

export interface ReservedImportAuthorityEntry {
  readonly ordinal: number;
  readonly operation: CanvasOperation;
  readonly command: DurableCommand;
  readonly outboxId: OutboxId;
  readonly reservationRequest: TrustedCommandAuthorityReservationRequest;
  readonly reservation: TrustedCommandAuthorityReservation;
}

export interface ReservedImportAuthorityBatch {
  readonly schemaVersion: 1;
  readonly kind: "reserved-import-authority-batch";
  readonly batchDigest: ContentHash;
  readonly batchRootDigest: ContentHash;
  readonly workspaceDigest: ContentHash;
  readonly planDigest: ContentHash;
  readonly projectId: ProjectId;
  readonly documentId: string;
  readonly taskId: TaskId;
  readonly runId: RunId;
  readonly lease: Lease;
  readonly decision: HumanImportBatchDecision;
  readonly entries: readonly ReservedImportAuthorityEntry[];
}

export interface IssuedImportAuthorityEntry
  extends ReservedImportAuthorityEntry {
  readonly issuance: TrustedCommandAuthorityIssuance;
  readonly issuedAuthority: RuntimeIssuedCommandAuthority;
  readonly grant: CapabilityGrant;
  readonly approval: ApprovalReceipt;
}

export interface IssuedImportAuthorityBatch {
  readonly schemaVersion: 1;
  readonly kind: "issued-import-authority-batch";
  readonly batchDigest: ContentHash;
  readonly batchRootDigest: ContentHash;
  readonly workspaceDigest: ContentHash;
  readonly planDigest: ContentHash;
  readonly projectId: ProjectId;
  readonly documentId: string;
  readonly taskId: TaskId;
  readonly runId: RunId;
  readonly lease: Lease;
  readonly decision: HumanImportBatchDecision;
  readonly entries: readonly IssuedImportAuthorityEntry[];
}

export interface ImportAuthoritySigner {
  readonly approver: {
    readonly kind: "human";
    readonly id: string;
    readonly keyId: string;
  };
  readonly trustRootId: string;
  readonly trustRootFingerprint: ContentHash;
  readonly signatureAlgorithm: "ed25519";
  sign(unsignedIssuance: object): string | Promise<string>;
}

export interface ExecutionAuthorityCounts {
  readonly commands: number;
  readonly outboxes: number;
  readonly grants: number;
  readonly approvals: number;
  readonly grantUses: number;
  readonly approvalUses: number;
  readonly targetReceipts: number;
  readonly acceptedVerificationAttempts: number;
  readonly traceBindings: number;
  readonly traceEvents: number;
  readonly projectionIntents: number;
  readonly canonicalReceipts: number;
  readonly latches: number;
}

export interface ImportRuntimeAuthoritySummary {
  readonly snapshotDigest: ContentHash;
  readonly lineage: {
    readonly workspaceDigest: ContentHash;
    readonly planDigest: ContentHash;
    readonly batchRootDigest: ContentHash;
  };
  readonly counts: ExecutionAuthorityCounts;
  readonly observedCommandKinds: readonly string[];
  readonly observedTargetKinds: readonly string[];
  readonly unexpectedCommandIds: readonly string[];
}

export interface ImportRuntimeEvidence {
  readonly schemaVersion: 1;
  readonly kind: "import-runtime-e2e";
  readonly batchDigest: ContentHash;
  readonly workspaceDigest: ContentHash;
  readonly planDigest: ContentHash;
  readonly initialStateHash: ContentHash;
  readonly finalStateHash: ContentHash;
  readonly lastEventHash: ContentHash | null;
  readonly counts: {
    readonly operations: number;
    readonly targetReceipts: number;
    readonly committedReceipts: number;
    readonly traceEvents: number;
    readonly projectionIntents: number;
  };
  readonly authoritySummary: ImportRuntimeAuthoritySummary;
}

export interface ImportBatchExecutionResult {
  readonly batchDigest: ContentHash;
  readonly committedCount: number;
  readonly totalCount: number;
  readonly commandIds: readonly DurableCommand["id"][];
  readonly evidence: ImportRuntimeEvidence;
}
