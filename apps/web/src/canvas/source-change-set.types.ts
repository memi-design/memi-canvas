export interface SourceChangeActor {
  readonly harnessId: string;
  readonly kind: "agent";
  readonly modelId: string;
}

export interface SourceDecisionActor {
  readonly id: string;
  readonly kind: "human";
}

export interface SourceTextReplacement {
  readonly after: string;
  readonly before: string;
}

export interface SourceTextPatch {
  readonly expectedBeforeHash: string;
  readonly relativePath: string;
  readonly replacements: readonly SourceTextReplacement[];
  readonly summary: string;
}

export interface SourceChangeSetInput {
  readonly actor: SourceChangeActor;
  readonly baseRevision: string;
  readonly id: string;
  readonly patches: readonly SourceTextPatch[];
  readonly projectId: string;
  readonly rootId: string;
  readonly runId: string;
}

export interface SourceChangeSet extends SourceChangeSetInput {
  readonly digest: `sha256:${string}`;
}

export interface SourceWorkspaceFile {
  readonly relativePath: string;
  readonly text: string;
}

export interface SourceWorkspaceSnapshot {
  readonly files: readonly SourceWorkspaceFile[];
  readonly revision: string;
  readonly rootId: string;
}

export interface SourceWorkspaceTextChange {
  readonly afterText: string;
  readonly beforeText: string;
  readonly relativePath: string;
}

export interface SourceWorkspaceReplaceRequest {
  readonly changes: readonly SourceWorkspaceTextChange[];
  readonly expectedRevision: string;
  readonly rootId: string;
}

export interface SourceWorkspaceReceipt {
  readonly changedPaths: readonly string[];
  readonly revision: string;
  readonly rootId: string;
}

export interface SourceWorkspacePort {
  inspect(
    relativePaths: readonly string[],
  ): Promise<SourceWorkspaceSnapshot>;
  replaceTextFilesAtomically(
    request: SourceWorkspaceReplaceRequest,
  ): Promise<SourceWorkspaceReceipt>;
}

export type SourceChangeTraceFamily =
  | "source.previewed"
  | "source.approved"
  | "source.applied"
  | "source.verified"
  | "source.rolled-back"
  | "source.rejected"
  | "source.failed";

export interface SourceChangeTraceEvent {
  readonly actor: SourceChangeActor | SourceDecisionActor;
  readonly at: string;
  readonly changeSetId: string;
  readonly family: SourceChangeTraceFamily;
  readonly id: string;
  readonly message: string;
  readonly runId: string;
  readonly sequence: number;
}

export interface SourceChangeTraceOptions {
  readonly idFactory?: () => string;
  readonly now?: () => string;
}

export type SourceChangeReviewStatus = "ready" | "conflict";

export interface SourceChangeReview {
  readonly changeSet: SourceChangeSet;
  readonly currentRevision: string;
  readonly diff: string;
  readonly files: readonly SourceWorkspaceTextChange[];
  readonly message: string;
  readonly status: SourceChangeReviewStatus;
  readonly trace: readonly SourceChangeTraceEvent[];
}

export interface SourceChangeApproval {
  readonly approvedAt: string;
  readonly approvedBy: SourceDecisionActor;
  readonly baseRevision: string;
  readonly changeSetDigest: `sha256:${string}`;
  readonly id: string;
  readonly rootId: string;
  readonly usesRemaining: 1;
  readonly trace: readonly SourceChangeTraceEvent[];
}

export interface SourceChangeVerification {
  readonly checkedRevision: string;
  readonly changedPaths: readonly string[];
  readonly status: "passed" | "failed";
  readonly summary: string;
}

export interface SourceChangeApplication {
  readonly approval: SourceChangeApproval;
  readonly files: readonly SourceWorkspaceTextChange[];
  readonly message: string;
  readonly receipt: SourceWorkspaceReceipt | null;
  readonly review: SourceChangeReview;
  readonly status: "applied" | "failed";
  readonly trace: readonly SourceChangeTraceEvent[];
  readonly verification: SourceChangeVerification | null;
}

export interface SourceChangeRejection {
  readonly message: string;
  readonly review: SourceChangeReview;
  readonly status: "rejected";
  readonly trace: readonly SourceChangeTraceEvent[];
}

export interface SourceChangeRollback {
  readonly application: SourceChangeApplication;
  readonly message: string;
  readonly receipt: SourceWorkspaceReceipt | null;
  readonly status: "rolled-back" | "failed";
  readonly trace: readonly SourceChangeTraceEvent[];
  readonly verification: SourceChangeVerification | null;
}
