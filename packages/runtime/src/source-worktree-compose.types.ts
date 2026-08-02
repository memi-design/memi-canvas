import type {
  SourceEdit,
} from "@memi/source-compiler";
import type { SourceAnchorV2 } from "@memi/protocol";

import type {
  ManagedSourceProject,
  SourceContentHash,
  SourceRepositoryState,
  SourceWorktreeFailureRecovery,
  SourceWorktreeManager,
} from "./source-worktree.types.js";

export interface DeterministicSourceEditRequest {
  readonly actor?: "human" | "system";
  readonly anchor: SourceAnchorV2;
  readonly commitMessage: string;
  readonly edit: SourceEdit;
  readonly projectId: string;
}

export interface DeterministicSourceRevisionReceipt {
  readonly contentHash: SourceContentHash;
  readonly dirtyFingerprint: SourceContentHash;
  readonly revision: string;
}

export interface ZeroModelTokenUsage {
  readonly inputTokens: 0;
  readonly modelCalls: 0;
  readonly outputTokens: 0;
  readonly totalTokens: 0;
}

export interface DeterministicSourceEditReceipt {
  readonly actor: "human" | "system";
  readonly changedRange: {
    readonly end: number;
    readonly start: number;
  };
  readonly patchSummary: string;
  readonly source: {
    readonly after: DeterministicSourceRevisionReceipt;
    readonly before: DeterministicSourceRevisionReceipt;
    readonly relativePath: string;
  };
  readonly status: "applied";
  readonly usage: ZeroModelTokenUsage;
  readonly zeroToken: true;
}

export interface DeterministicSourceRecoveryEvidence {
  readonly action: "reinspect-before-recovery";
  readonly baseRevision: string;
  readonly expectedAfterHash: SourceContentHash;
  readonly expectedBeforeHash: SourceContentHash;
  readonly expectedProjectState: SourceRepositoryState;
  readonly managedProjectId: string;
  readonly observedProjectState: SourceRepositoryState | null;
  readonly originalProtected: true;
  readonly originalRootPath: string;
  readonly relativePath: string;
  readonly rootPath: string;
  readonly stage: "apply-error" | "apply-postcondition";
  readonly worktree: SourceWorktreeFailureRecovery | null;
}

export type DeterministicSourceCompositionErrorCode =
  | "apply-failed"
  | "apply-postcondition-failed"
  | "compile-postcondition-failed"
  | "source-inspection-failed"
  | "stale-source-authority";

export interface ManagedSourceProjectAuthorityPort {
  resolveActiveProject(
    projectId: string,
  ): Promise<ManagedSourceProject | null>;
}

export interface DeterministicSourceEditCoordinatorOptions {
  readonly projectAuthority: ManagedSourceProjectAuthorityPort;
  readonly sourceWorktree: Pick<
    SourceWorktreeManager,
    "compareAndApplyTextChanges" | "inspectContainedFiles"
  >;
}

export interface DeterministicSourceEditCoordinator {
  apply(
    request: DeterministicSourceEditRequest,
  ): Promise<DeterministicSourceEditReceipt>;
}
