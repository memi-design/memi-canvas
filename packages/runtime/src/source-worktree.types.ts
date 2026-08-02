export type SourceContentHash = `sha256:${string}`;

export interface SourceGitRequest {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly repositoryProcessPolicy: SourceRepositoryProcessPolicy;
  readonly securityProfile: "source-worktree";
  readonly stdin?: string;
}

export interface SourceRepositoryProcessPolicy {
  readonly allowExternalFilters: false;
  readonly allowHooks: false;
  readonly allowNetwork: false;
  readonly allowShell: false;
  readonly allowSubmodules: false;
}

export interface SourceGitResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface SourceWorktreeProcessPort {
  /**
   * Implementations must execute argv without a shell inside the source
   * worktree sandbox. Production composition remains disabled until that
   * broker also suppresses external filters and other repository-controlled
   * process execution.
   */
  runGit(request: SourceGitRequest): Promise<SourceGitResult>;
}

export interface SourceRecoverableTextWrite {
  readonly absolutePath: string;
  readonly afterText: string;
  readonly beforeText: string;
}

export interface SourceFileSystemPort {
  readFile(path: string): Promise<Uint8Array>;
  realpath(path: string): Promise<string>;
  /**
   * Implementations compare every beforeText, use same-directory staging, and
   * either finish every rename or retain enough durable evidence to recover.
   * They must reject symlinks and revalidate root containment at rename time.
   * This contract deliberately does not claim cross-file filesystem atomicity.
   */
  replaceTextFilesRecoverably(
    changes: readonly SourceRecoverableTextWrite[],
  ): Promise<void>;
}

export interface SourceRepositoryState {
  readonly capturedAt: string;
  readonly dirty: boolean;
  readonly dirtyFingerprint: SourceContentHash;
  readonly headRevision: string;
  readonly rootPath: string;
}

export type SourceCleanupKind =
  | "git-worktree-remove"
  | "remove-independent-clone";

export interface SourceWorktreeRecovery {
  readonly cleanupKind: SourceCleanupKind;
  readonly ownerRootPath: string | null;
  readonly rootPath: string;
  readonly state:
    | "active"
    | "merged-pending-cleanup"
    | "removed";
}

export interface ManagedSourceProject {
  readonly createdAt: string;
  readonly original: SourceRepositoryState;
  readonly projectId: string;
  readonly recovery: SourceWorktreeRecovery;
  readonly rootPath: string;
  readonly state: SourceRepositoryState;
}

export interface CreateManagedSourceProjectInput {
  readonly managedProjectsRoot: string;
  readonly originalRoot: string;
  readonly projectId: string;
}

export interface RunSourceWorktree {
  readonly baseProjectState: SourceRepositoryState;
  readonly createdAt: string;
  readonly projectId: string;
  readonly recovery: SourceWorktreeRecovery;
  readonly rootPath: string;
  readonly runId: string;
}

export interface CreateRunSourceWorktreeInput {
  readonly project: ManagedSourceProject;
  readonly runId: string;
  readonly runsRoot: string;
}

export interface InspectedSourceFile {
  readonly contentHash: SourceContentHash;
  readonly relativePath: string;
  readonly text: string;
}

export interface SourceTextHashChange {
  readonly afterText: string;
  readonly expectedBeforeHash: SourceContentHash;
  readonly relativePath: string;
}

export interface CompareAndApplySourceTextInput {
  readonly changes: readonly SourceTextHashChange[];
  readonly commitMessage: string;
  readonly expectedState: SourceRepositoryState;
  readonly rootPath: string;
}

export interface AppliedSourceFile {
  readonly afterHash: SourceContentHash;
  readonly beforeHash: SourceContentHash;
  readonly relativePath: string;
}

export interface CompareAndApplySourceTextResult {
  readonly changedFiles: readonly AppliedSourceFile[];
  readonly state: SourceRepositoryState;
}

export interface RunWorktreeReview {
  readonly baseProjectState: SourceRepositoryState;
  readonly changedPaths: readonly string[];
  readonly currentProjectState: SourceRepositoryState;
  readonly diff: string;
  readonly digest: SourceContentHash;
  readonly reviewedAt: string;
  readonly run: RunSourceWorktree;
  readonly status: "ready";
}

export interface SourceReviewDecisionActor {
  readonly id: string;
  readonly kind: "human";
}

export interface RunWorktreeApproval {
  readonly approvalId: string;
  readonly approvedAt: string;
  readonly approvedBy: SourceReviewDecisionActor;
  readonly digest: SourceContentHash;
  readonly runId: string;
}

export interface IssueRunWorktreeApprovalInput {
  readonly approvedAt: string;
  readonly approvedBy: SourceReviewDecisionActor;
  readonly digest: SourceContentHash;
  readonly runId: string;
}

/**
 * Production composition must bind this port to the durable runtime approval
 * store. A process-local object registry is not an authority implementation.
 */
export interface RunWorktreeApprovalAuthorityPort {
  consumeExact(approval: RunWorktreeApproval): Promise<boolean>;
  isActiveExact(approval: RunWorktreeApproval): Promise<boolean>;
  issue(
    input: IssueRunWorktreeApprovalInput,
  ): Promise<RunWorktreeApproval>;
}

export interface MergeApprovedRunWorktreeInput {
  readonly approval: RunWorktreeApproval;
  readonly projectRoot: string;
  readonly review: RunWorktreeReview;
}

export interface MergeApprovedRunWorktreeResult {
  readonly mergedRevision: string;
  readonly projectState: SourceRepositoryState;
  readonly recovery: SourceWorktreeRecovery;
  readonly status: "merged";
}

export type PromotionConflict =
  | "managed-project-dirty"
  | "managed-project-state-changed"
  | "original-dirty-at-connect"
  | "original-dirty-state-changed"
  | "original-head-changed";

export interface CheckSourcePromotionInput {
  readonly connectedOriginal: SourceRepositoryState;
  readonly expectedProjectState: SourceRepositoryState;
  readonly projectRoot: string;
}

export interface SourcePromotionCheck {
  readonly changedPaths: readonly string[];
  readonly conflicts: readonly PromotionConflict[];
  readonly currentOriginal: SourceRepositoryState;
  readonly currentProject: SourceRepositoryState;
  readonly diff: string;
  readonly digest: SourceContentHash;
  readonly status: "conflict" | "ready";
}

export type SourceWorktreeFailurePhase =
  | "apply-commit"
  | "clone"
  | "create-run"
  | "merge-run";

export interface SourceWorktreeFailureRecovery {
  readonly approvalId: string | null;
  readonly changedPaths: readonly string[];
  readonly originalProtected: true;
  readonly phase: SourceWorktreeFailurePhase;
  readonly reviewDigest: SourceContentHash | null;
  readonly rootPath: string;
  readonly runId: string | null;
}

export interface SourceWorktreeManagerOptions {
  readonly approvalAuthority: RunWorktreeApprovalAuthorityPort;
  readonly fileSystem: SourceFileSystemPort;
  readonly now?: () => string;
  readonly process: SourceWorktreeProcessPort;
  readonly securityAuthorization: SourceWorktreeMutationAuthorizationPort;
}

export type SourceWorktreeMutationKind =
  | "managed-project.create"
  | "managed-source.apply"
  | "run-worktree.cleanup"
  | "run-worktree.create"
  | "run-worktree.merge";

export interface SourceWorktreeMutationAuthorizationRequest {
  readonly kind: SourceWorktreeMutationKind;
  readonly relativePaths: readonly string[];
  readonly sourceRootPath: string;
  readonly targetRootPath: string;
}

export interface SourceWorktreeMutationAuthorizationReceipt {
  readonly authorized: true;
  readonly policyDigest: SourceContentHash;
}

/**
 * Production composition binds this to durable capability policy. There is no
 * permissive default and manager construction is not exported from the package
 * root while the source-mutation security veto remains active.
 */
export interface SourceWorktreeMutationAuthorizationPort {
  authorizeMutation(
    request: SourceWorktreeMutationAuthorizationRequest,
  ): Promise<SourceWorktreeMutationAuthorizationReceipt>;
}

export interface SourceWorktreeManager {
  captureRepositoryState(rootPath: string): Promise<SourceRepositoryState>;
  checkPromotion(
    input: CheckSourcePromotionInput,
  ): Promise<SourcePromotionCheck>;
  cleanFingerprint(headRevision: string): Promise<SourceContentHash>;
  cleanupRunWorktree(
    recovery: SourceWorktreeRecovery,
  ): Promise<SourceWorktreeRecovery>;
  compareAndApplyTextChanges(
    input: CompareAndApplySourceTextInput,
  ): Promise<CompareAndApplySourceTextResult>;
  createManagedProject(
    input: CreateManagedSourceProjectInput,
  ): Promise<ManagedSourceProject>;
  createRunWorktree(
    input: CreateRunSourceWorktreeInput,
  ): Promise<RunSourceWorktree>;
  inspectContainedFiles(
    rootPath: string,
    relativePaths: readonly string[],
  ): Promise<readonly InspectedSourceFile[]>;
  mergeApprovedRunWorktree(
    input: MergeApprovedRunWorktreeInput,
  ): Promise<MergeApprovedRunWorktreeResult>;
  reviewRunWorktree(run: RunSourceWorktree): Promise<RunWorktreeReview>;
}
