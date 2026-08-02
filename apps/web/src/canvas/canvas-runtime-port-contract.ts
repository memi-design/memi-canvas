import type { AgentPatch } from "./agent-patch.js";
import type {
  PermissionPolicy,
  PromptMode,
  ReasoningEffort,
} from "./harness-config.js";
import type { WorkbenchNode } from "./model.js";

export const CANVAS_RUNTIME_PORT_KIND = "canvas-runtime-port";
export const CANVAS_RUNTIME_PORT_VERSION = 1;

export type CanvasRuntimeState =
  | "Disconnected"
  | "Ready"
  | "Queued"
  | "Planning"
  | "Using tools"
  | "Waiting for approval"
  | "Applying"
  | "Verifying"
  | "Complete"
  | "Failed"
  | "Canceled";

export interface CanvasRuntimeViewport {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface CanvasRuntimeSubmitRequest {
  readonly documentId: string;
  readonly documentNodes: readonly WorkbenchNode[];
  readonly documentRevision: number;
  readonly harnessId: string;
  readonly modelId: string;
  readonly permissionPolicy: PermissionPolicy;
  readonly projectId: string;
  readonly prompt: string;
  readonly promptMode: PromptMode;
  readonly reasoningEffort: ReasoningEffort;
  readonly selectedNodeIds: readonly string[];
  readonly viewport: CanvasRuntimeViewport;
}

export interface CanvasRuntimeEvent {
  readonly at: string;
  readonly id: string;
  readonly message: string;
  readonly sequence: number;
  readonly state: CanvasRuntimeState;
}

export interface CanvasRuntimeProposalOperation {
  readonly scope: "canvas";
  readonly summary: string;
  readonly targetIds: readonly string[];
}

export interface CanvasRuntimeProposal {
  readonly authority: "canvas-only";
  readonly baseRevision: number;
  readonly digest: string;
  readonly filesChanged: 0;
  readonly id: string;
  readonly informationalSourcePaths: readonly string[];
  readonly operations: readonly CanvasRuntimeProposalOperation[];
  readonly patch: AgentPatch;
  readonly permissionRequired: "approval";
  readonly risk: "low";
  readonly targetIds: readonly string[];
  readonly verificationPlan: readonly string[];
}

export interface CanvasRuntimeApproval {
  readonly authority: "canvas-only";
  readonly baseRevision: number;
  readonly id: string;
  readonly proposalDigest: string;
  readonly proposalId: string;
  readonly runId: string;
  readonly usesRemaining: 1;
}

export interface CanvasRuntimeVerification {
  readonly checkedRevision: number;
  readonly documentDigest: string;
  readonly filesChanged: 0;
  readonly previewSessionId: string;
  readonly scope: "deterministic-demo";
  readonly status: "passed";
  readonly summary: string;
}

export interface CanvasRuntimeCheckpoint {
  readonly documentNodes: readonly WorkbenchNode[];
  readonly documentRevision: number;
  readonly id: string;
  readonly projectId: string;
  readonly runId: string;
  readonly selectedNodeIds: readonly string[];
  readonly traceSequence: number;
}

export interface CanvasRuntimeDurability {
  readonly reason: string | null;
  readonly status: "durable" | "memory-only" | "volatile";
}

export interface CanvasRuntimeRestorePreview {
  readonly changedNodeCount: number;
  readonly checkpoint: CanvasRuntimeCheckpoint;
  readonly checkpointNodeCount: number;
  readonly currentDocumentRevision: number;
  readonly currentNodeCount: number;
  readonly effectsExcluded: true;
  readonly expectedDocumentDigest: string;
  readonly id: string;
  readonly projectId: string;
}

export interface CanvasRuntimeSnapshot {
  readonly approval: CanvasRuntimeApproval | null;
  readonly checkpoint: CanvasRuntimeCheckpoint | null;
  readonly durability: CanvasRuntimeDurability;
  readonly envelope: CanvasRuntimeSubmitRequest;
  readonly events: readonly CanvasRuntimeEvent[];
  readonly proposal: CanvasRuntimeProposal | null;
  readonly runId: string;
  readonly state: CanvasRuntimeState;
  readonly threadId: string;
  readonly verification: CanvasRuntimeVerification | null;
}

export interface CanvasRuntimeSubmission {
  readonly runId: string;
  readonly threadId: string;
}

export interface CanvasRuntimePortV1 {
  readonly kind: typeof CANVAS_RUNTIME_PORT_KIND;
  readonly version: typeof CANVAS_RUNTIME_PORT_VERSION;
  approve(request: {
    readonly baseRevision: number;
    readonly proposalDigest: string;
    readonly proposalId: string;
    readonly runId: string;
  }): Promise<CanvasRuntimeApproval>;
  apply(request: {
    readonly approval: CanvasRuntimeApproval;
    readonly currentRevision: number;
    readonly runId: string;
  }): Promise<CanvasRuntimeSnapshot>;
  cancel(runId: string): Promise<CanvasRuntimeSnapshot>;
  checkpoint(request: {
    readonly documentNodes: readonly WorkbenchNode[];
    readonly documentRevision: number;
    readonly runId: string;
    readonly selectedNodeIds: readonly string[];
  }): Promise<CanvasRuntimeCheckpoint>;
  getRun(runId: string): Promise<CanvasRuntimeSnapshot>;
  getLatestRun(projectId: string): Promise<CanvasRuntimeSnapshot | null>;
  reject(runId: string): Promise<CanvasRuntimeSnapshot>;
  prepareRestore(request: {
    readonly checkpointId: string;
    readonly currentDocumentNodes: readonly WorkbenchNode[];
    readonly currentDocumentRevision: number;
    readonly projectId: string;
  }): Promise<CanvasRuntimeRestorePreview>;
  requestChanges(request: {
    readonly feedback: string;
    readonly runId: string;
  }): Promise<CanvasRuntimeSnapshot>;
  restore(request: {
    readonly currentDocumentNodes: readonly WorkbenchNode[];
    readonly currentDocumentRevision: number;
    readonly previewId: string;
    readonly projectId: string;
  }): Promise<{
    readonly checkpoint: CanvasRuntimeCheckpoint;
    readonly expectedCurrentRevision: number;
    readonly effectsReplayed: false;
    readonly restored: true;
    readonly snapshot: CanvasRuntimeSnapshot;
  }>;
  submit(
    request: CanvasRuntimeSubmitRequest,
  ): Promise<CanvasRuntimeSubmission>;
  subscribe(
    runId: string,
    listener: (snapshot: CanvasRuntimeSnapshot) => void,
  ): () => void;
  verify(request: {
    readonly documentNodes: readonly WorkbenchNode[];
    readonly documentRevision: number;
    readonly previewEvidence: {
      readonly documentRevision: number;
      readonly projectId: string;
      readonly sessionId: string;
      readonly verifiedAt: string;
    };
    readonly runId: string;
  }): Promise<CanvasRuntimeSnapshot>;
}

export interface DemoCanvasRuntimeOptions {
  readonly idFactory?: () => string;
  readonly maxStorageBytes?: number;
  readonly maxStoredCheckpoints?: number;
  readonly maxStoredRuns?: number;
  readonly now?: () => string;
  readonly schedule?: (callback: () => void, delay: number) => unknown;
  readonly storage?: CanvasRuntimeStorage;
}

export interface CanvasRuntimeStorage {
  load(): unknown;
  save(value: unknown): void;
}
