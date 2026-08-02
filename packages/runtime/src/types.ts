import type {
  Capability,
  CapabilityGrant,
  ContentHash,
  DurableCommand,
  DurableCommandId,
  IdempotencyKey,
  OutboxId,
  OutboxRecord,
  ProjectId,
  RecoveryAttemptId,
  RunId,
  TargetApplyOutcome,
  TargetEffectRequest,
  TargetFenceActivationRequest,
  TargetFenceActivationResult,
  TargetLookupRequest,
  TargetLookupResult,
  TargetVerificationRequest,
  TargetVerificationResult,
  TraceEventId,
  CanvasCommittedEffectReceipt,
} from "../../protocol/src/index.js";
import type {
  DurableHarnessAdapter,
  DurableHarnessSelectionRequest,
  HarnessAdapter,
  NormalizedHarnessEvent,
  TaskEnvelope,
} from "../../harnesses/src/index.js";

export interface CommandSubmission {
  readonly command: DurableCommand;
  readonly outboxId: OutboxId;
  readonly effectPayload: unknown;
}

export interface EffectExecutionRequest {
  readonly command: DurableCommand;
  readonly effectPayload: unknown;
  readonly idempotencyKey: IdempotencyKey;
  readonly actionDigest: ContentHash;
}

export interface AppliedEffectResult {
  readonly status: "applied";
  readonly resultingHash: ContentHash;
  readonly receipt: unknown;
}

export interface UnappliedEffectResult {
  readonly status: "definitely-not-applied";
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export interface UnknownEffectResult {
  readonly status: "outcome-unknown";
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type EffectExecutionResult =
  | AppliedEffectResult
  | UnappliedEffectResult
  | UnknownEffectResult;

export interface EffectExecutor {
  execute(
    request: EffectExecutionRequest,
  ): Promise<EffectExecutionResult>;
}

export interface CanvasTargetAdapter {
  activateFence(
    request: TargetFenceActivationRequest,
  ):
    | TargetFenceActivationResult
    | Promise<TargetFenceActivationResult>;
  compareAndApply(
    request: TargetEffectRequest,
  ): TargetApplyOutcome | Promise<TargetApplyOutcome>;
  lookup(
    request: TargetLookupRequest,
  ): TargetLookupResult | Promise<TargetLookupResult>;
  verify(
    request: TargetVerificationRequest,
  ):
    | TargetVerificationResult
    | Promise<TargetVerificationResult>;
}

export interface RuntimeFaults {
  readonly afterTargetFenceRecorded?: () => void;
  readonly afterRecoveryChallengePersisted?: () => void;
  readonly afterTraceEventInsert?: () => void;
  readonly afterTraceHeadUpdate?: () => void;
  readonly afterTraceBindingInsert?: () => void;
  readonly afterCanonicalReceiptInsert?: () => void;
  readonly afterProjectionInsert?: () => void;
  readonly afterCommittedOutboxUpdate?: () => void;
}

export interface RecoveryChallengeSeed {
  readonly id: RecoveryAttemptId;
  readonly nonce: string;
}

export type RecoveryChallengeFactory = () => RecoveryChallengeSeed;
export type TraceEventIdFactory = () => TraceEventId;

export interface ApprovalTrustRoot {
  readonly id: string;
  readonly consequence?: string;
  readonly keys: readonly {
    readonly keyId: string;
    readonly publicKeyPem: string;
    readonly approverId?: string;
  }[];
}

export interface WorkerClaim {
  readonly id: string;
  readonly commandId: DurableCommandId;
  readonly outboxId: OutboxId;
  readonly workerId: string;
  readonly fencingEpoch: number;
  readonly expiresAt: string;
}

export interface RecoveryProbeRequest {
  readonly command: DurableCommand;
  readonly outbox: OutboxRecord;
}

export interface RecoveryProbeEvidence {
  readonly observedTargetHash: ContentHash;
  readonly evidenceHash: ContentHash;
  readonly checkedAt: string;
}

export interface CommandPolicyValidationRequest {
  readonly command: DurableCommand;
  readonly effectPayload: unknown;
  readonly grant: CapabilityGrant;
}

export interface CommandPolicyValidator {
  validate(request: CommandPolicyValidationRequest): void;
}

export interface EffectVerificationRequest {
  readonly command: DurableCommand;
  readonly outbox: OutboxRecord & {
    readonly phase: "effect-applied";
  };
  readonly resultingHash: ContentHash;
  readonly executorReceipt: unknown;
}

export interface EffectVerifier {
  verify(
    request: EffectVerificationRequest,
  ): CommitVerification | Promise<CommitVerification>;
}

export interface DurableRuntimeOptions {
  readonly databasePath: string;
  readonly clock: () => string;
  readonly effectExecutor: EffectExecutor;
  readonly canvasTarget?: CanvasTargetAdapter;
  readonly harnesses?: readonly HarnessAdapter[];
  readonly lifecycleHarnesses?: readonly DurableHarnessAdapter[];
  readonly policyValidator?: CommandPolicyValidator;
  readonly effectVerifier?: EffectVerifier;
  readonly recoveryProbe?: (
    request: RecoveryProbeRequest,
  ) => RecoveryProbeEvidence | undefined;
  readonly runtimeFaults?: RuntimeFaults;
  readonly recoveryChallengeFactory?: RecoveryChallengeFactory;
  readonly traceEventIdFactory?: TraceEventIdFactory;
  readonly approvalTrustRoots?: readonly ApprovalTrustRoot[];
}

export interface HarnessTaskInput {
  readonly projectId: string;
  readonly taskId: string;
  readonly goal: string;
  readonly permissionCeiling: readonly string[];
  readonly tokenBudget: number;
  readonly costBudgetUsdMicros: number;
}

export interface HarnessRunStartInput {
  readonly taskId: string;
  readonly runId: string;
  readonly selection: DurableHarnessSelectionRequest;
}

export interface HarnessRunControlInput {
  readonly runId: string;
  readonly dispatchEpoch: number;
  readonly reason: string;
}

export interface HarnessRunResumeInput {
  readonly runId: string;
  readonly dispatchEpoch: number;
}

export interface DemoHarnessApprovalResolutionInput {
  readonly runId: string;
  readonly dispatchEpoch: number;
  readonly approvalId: string;
  readonly decision: "approved" | "rejected";
  readonly authority: {
    readonly kind: "local-demo-human";
    readonly actorId: string;
  };
}

export interface HarnessRunSnapshot {
  readonly runId: string;
  readonly taskId: string;
  readonly parentRunId?: string;
  readonly harnessId: string;
  readonly modelId: string;
  readonly state:
    | "queued"
    | "running"
    | "awaiting-approval"
    | "paused"
    | "stopped"
    | "completed"
    | "failed";
  readonly dispatchEpoch: number;
  readonly adapterCursor: number;
  readonly remainingTokenBudget: number;
  readonly remainingCostBudgetUsdMicros: number;
  readonly checkpointId?: string;
  readonly failure?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface HarnessLifecycleEvent {
  readonly runId: string;
  readonly sequence: number;
  readonly dispatchEpoch: number;
  readonly previousHash: string | null;
  readonly eventHash: string;
  readonly createdAt: string;
  readonly signal: import("../../protocol/src/index.js").HarnessSignal;
}

export interface HarnessHandoffInput {
  readonly handoffId: string;
  readonly parentRunId: string;
  readonly childRunId: string;
  readonly toHarnessId: "demo-alpha" | "demo-beta";
}

export interface HarnessHandoff {
  readonly handoffId: string;
  readonly taskId: string;
  readonly parentRunId: string;
  readonly childRunId: string;
  readonly fromHarnessId: string;
  readonly toHarnessId: string;
  readonly checkpointId: string;
  readonly permissionCeiling: readonly string[];
  readonly remainingTokenBudget: number;
  readonly remainingCostBudgetUsdMicros: number;
  readonly artifactRefs: readonly string[];
  readonly decisions: readonly {
    readonly decisionId: string;
    readonly summary: string;
  }[];
}

export interface HarnessTraceReferenceInput {
  readonly runId: string;
  readonly lifecycleSequence: number;
  readonly traceEventId: string;
}

export interface CommitVerification {
  readonly observedTargetHash: ContentHash;
  readonly evidenceHash: ContentHash;
  readonly verifiedAt: string;
}

export interface HarnessDispatchRequest {
  readonly projectId: ProjectId;
  readonly runId: RunId;
  readonly harnessId: string;
  readonly requiredHarnessCapabilities: readonly string[];
  readonly requiredCapabilities: readonly Capability[];
  readonly task: TaskEnvelope;
}

export interface HarnessDispatch {
  readonly events: AsyncIterable<NormalizedHarnessEvent>;
}

export interface CommitClaim {
  readonly commandId: DurableCommandId;
  readonly outboxId: OutboxId;
  readonly workerId: string;
  readonly fencingEpoch: number;
  readonly expiresAt: string;
}

export interface CommitClaimRequest {
  readonly commandId: DurableCommandId;
  readonly workerId: string;
  readonly claimTtlMilliseconds: number;
}

export interface VerifyAndCommitRequest {
  readonly claim: CommitClaim;
}

export interface LegacyCommittedEffectReceipt {
  readonly commandId: DurableCommandId;
  readonly actionDigest: ContentHash;
  readonly resultingHash: ContentHash;
  readonly traceEventId: TraceEventId;
  readonly verification: CommitVerification;
  readonly executorReceipt: unknown;
}

export type CommittedEffectReceipt =
  | LegacyCommittedEffectReceipt
  | CanvasCommittedEffectReceipt;
