export interface TargetRef {
  readonly kind: string;
  readonly id: string;
  readonly revision?: string;
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly statement: string;
  readonly status: string;
}

export interface EvidenceRef {
  readonly kind: string;
  readonly id: string;
  readonly revision?: string;
}

export interface TaskEnvelope {
  readonly taskId: string;
  readonly goal: string;
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly selectionRefs: readonly TargetRef[];
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly constraints: readonly string[];
  readonly requestedHarness: string;
  readonly risk: string;
  readonly tokenBudget: number;
  readonly costBudget: number;
  readonly permissionCeiling: readonly string[];
}

export interface HarnessDescriptor {
  readonly harnessId: string;
  readonly displayName: string;
  readonly capabilities: readonly string[];
  readonly models: readonly string[];
}

export interface HarnessReference {
  readonly harnessId: string;
  readonly modelId: string;
}

export interface ActorReference {
  readonly kind: "agent" | "human" | "system";
  readonly id: string;
}

export interface ProviderMetadata {
  readonly providerSessionId?: string;
  readonly providerConversationId?: string;
  readonly providerResponseId?: string;
  readonly providerCursor?: string;
  readonly rawProviderEvent?: unknown;
  readonly vendorEventType?: string;
}

export interface ProviderEventInput {
  readonly kind: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly providerSequence?: number;
  readonly providerMetadata?: ProviderMetadata;
}

export interface EventContext {
  readonly eventId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly actor: ActorReference;
  readonly harness: HarnessReference;
  readonly targetRefs: readonly TargetRef[];
}

export interface NormalizedHarnessEvent extends EventContext {
  readonly schemaVersion: 1;
  readonly type: string;
  readonly status: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface HarnessScriptStep {
  readonly kind: string;
  readonly [key: string]: unknown;
}

export interface FakeHarnessOptions {
  readonly descriptor: HarnessDescriptor;
  readonly modelId: string;
  readonly script: readonly HarnessScriptStep[];
  readonly clock: () => string;
  readonly createEventId: (sequence: number) => string;
}

export interface StartInput {
  readonly runId: string;
  readonly task: TaskEnvelope;
  readonly executionBudget?: {
    readonly remainingTokens: number;
    readonly remainingCostUsdMicros: number;
  };
}

export interface ResumeInput extends StartInput {
  readonly previousRunId: string;
  readonly afterSequence: number;
}

export interface ApprovalResponse {
  readonly runId: string;
  readonly approvalId: string;
  readonly decision: "approved" | "rejected";
  readonly grantId: string;
}

export interface CancelRequest {
  readonly runId: string;
  readonly reason: string;
}

export interface HarnessAdapter {
  readonly descriptor: HarnessDescriptor;
  start(input: StartInput): AsyncIterable<NormalizedHarnessEvent>;
  resume(input: ResumeInput): AsyncIterable<NormalizedHarnessEvent>;
  resolveApproval(response: ApprovalResponse): Promise<void>;
  cancel(request: CancelRequest): Promise<void>;
}

export interface LockedHarnessSelectionRequest {
  readonly mode: "locked";
  readonly harnessId: string;
  readonly requiredCapabilities: readonly string[];
}

export interface HarnessCandidate {
  readonly harnessId: string;
  readonly eligible: boolean;
  readonly selected: boolean;
  readonly reason: string;
}

export interface HarnessSelection {
  readonly adapter: HarnessAdapter;
  readonly reason: "user-selected";
  readonly candidates: readonly HarnessCandidate[];
}

export interface DecisionReference {
  readonly id: string;
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
}

export interface HandoffInput {
  readonly task: TaskEnvelope;
  readonly fromRunId: string;
  readonly fromHarnessId: string;
  readonly toHarnessId: string;
  readonly checkpointId: string;
  readonly traceCursor: number;
  readonly acceptedDecisions: readonly DecisionReference[];
  readonly completedArtifactRefs: readonly string[];
  readonly remainingCriterionIds: readonly string[];
  readonly currentSelectionRefs: readonly TargetRef[];
  readonly permissionCeiling: readonly string[];
  readonly remainingTokenBudget: number;
}

export interface HandoffPacket {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly goal: string;
  readonly fromRunId: string;
  readonly fromHarnessId: string;
  readonly toHarnessId: string;
  readonly checkpointId: string;
  readonly traceCursor: number;
  readonly acceptedDecisions: readonly DecisionReference[];
  readonly completedArtifactRefs: readonly string[];
  readonly remainingCriteria: readonly AcceptanceCriterion[];
  readonly currentSelectionRefs: readonly TargetRef[];
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly constraints: readonly string[];
  readonly permissionCeiling: readonly string[];
  readonly remainingTokenBudget: number;
}

export interface PendingApproval {
  readonly approvalId: string;
  readonly scopes: readonly string[];
  readonly targetRefs: readonly TargetRef[];
}

export interface SharedProductRunState {
  readonly taskId: string;
  readonly runId: string;
  readonly status: string;
  readonly harness: HarnessReference;
  readonly lastSequence: number;
  readonly pendingApproval?: PendingApproval;
  readonly checkpointId?: string;
}

export interface HarnessRuntimeSnapshot extends SharedProductRunState {
  readonly adapterPrivateState?: Readonly<Record<string, unknown>>;
}
