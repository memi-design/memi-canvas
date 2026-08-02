import type {
  ApprovedBuildRecipe,
  CaptureApplicationUnit,
  CaptureDiscoveryOptions,
  ContentHash,
  RepositoryManifestBudgets,
  RepositoryManifestInput,
} from "@memi/capture-platforms";

export type RepositoryEntryKind =
  | "directory"
  | "file"
  | "missing"
  | "symlink";

export interface RepositoryDirectoryEntry {
  readonly kind: Exclude<RepositoryEntryKind, "missing">;
  readonly name: string;
}

export interface RepositoryFileSystemPort {
  createManagedSnapshot(input: {
    readonly sourceRoot: string;
    readonly targetRoot: string;
    readonly signal: AbortSignal;
  }): Promise<RepositoryTreeFingerprint>;
  entryKind(path: string): Promise<RepositoryEntryKind>;
  fingerprintSourceTree(input: {
    readonly rootPath: string;
    readonly signal: AbortSignal;
  }): Promise<RepositoryTreeFingerprint>;
  readDirectory(path: string): Promise<readonly RepositoryDirectoryEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  realpath(path: string): Promise<string>;
  assertManagedTreeSafe(input: {
    readonly rootPath: string;
    readonly signal: AbortSignal;
  }): Promise<void>;
  removeManagedTree(input: {
    readonly rootPath: string;
    readonly signal: AbortSignal;
  }): Promise<void>;
}

export interface RepositoryTreeFingerprint {
  readonly contentFingerprint: ContentHash;
  readonly exclusionManifest: RepositorySnapshotExclusionManifest;
  readonly fileCount: number;
  readonly totalBytes: number;
}

export type RepositorySnapshotExclusionReason =
  | "credential-file"
  | "environment-secret"
  | "generated-artifact"
  | "generated-directory"
  | "key-material"
  | "private-directory"
  | "signing-artifact";

export interface RepositorySnapshotExclusion {
  readonly path: string;
  readonly reason: RepositorySnapshotExclusionReason;
}

export interface RepositorySnapshotExclusionManifest {
  readonly entries: readonly RepositorySnapshotExclusion[];
  readonly fingerprint: ContentHash;
  readonly policyFingerprint: ContentHash;
  readonly schemaVersion: 1;
}

export interface RepositoryGitPolicy {
  readonly allowExternalFilters: false;
  readonly allowHooks: false;
  readonly allowNetwork: false;
  readonly allowShell: false;
  readonly allowSubmodules: false;
  readonly optionalLocks: false;
}

export interface RepositoryGitRequest {
  readonly access: "managed-target-write" | "source-read-only";
  readonly args: readonly string[];
  readonly cwd: string;
  readonly executable: "git";
  readonly policy: RepositoryGitPolicy;
  readonly signal: AbortSignal;
}

export interface RepositoryGitResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface RepositoryProcessPort {
  runGit(request: RepositoryGitRequest): Promise<RepositoryGitResult>;
}

export interface RepositoryCapturePorts {
  readonly fileSystem: RepositoryFileSystemPort;
  readonly process: RepositoryProcessPort;
}

export interface RepositoryCaptureSource {
  readonly dirty: boolean;
  readonly dirtyFingerprint: ContentHash;
  readonly headRevision: string;
  readonly rootPath: string;
}

export interface ManagedRepositoryCopy {
  readonly revision: string;
  readonly rootPath: string;
  readonly sourceProtected: true;
  readonly strategy: "filesystem-snapshot";
}

export interface ManagedCaptureApplication
  extends Omit<CaptureApplicationUnit, "buildRecipe"> {
  readonly buildRecipe: ApprovedBuildRecipe | null;
  readonly recipePlan: ManagedRecipeApprovalPlan | null;
}

export interface ManagedRecipeApprovalPlan {
  readonly applicationId: CaptureApplicationUnit["applicationId"];
  readonly managedRevision: string;
  readonly recipe: ApprovedBuildRecipe;
  readonly recipeHash: ContentHash;
  readonly repositoryFingerprint: ContentHash;
  readonly snapshotExclusionFingerprint: ContentHash;
  readonly snapshotPolicyFingerprint: ContentHash;
  readonly schemaVersion: 2;
}

export interface RepositoryCapturePreparation {
  readonly applications: readonly ManagedCaptureApplication[];
  readonly cacheFingerprint: ContentHash;
  readonly inventory: RepositoryManifestInput;
  readonly managedCopy: ManagedRepositoryCopy;
  readonly repositoryFingerprint: ContentHash;
  readonly snapshotExclusions: RepositorySnapshotExclusionManifest;
  readonly source: RepositoryCaptureSource;
}

export interface PrepareRepositoryCaptureInput {
  readonly budgets?: Partial<RepositoryManifestBudgets>;
  /** Explicit transport preferences; omitted preserves static defaults. */
  readonly discoveryOptions?: CaptureDiscoveryOptions;
  readonly captureId: string;
  readonly managedRoot: string;
  readonly ports: RepositoryCapturePorts;
  readonly signal: AbortSignal;
  readonly sourceRoot: string;
}

export type RepositoryBoundaryErrorCode =
  | "budget-exceeded"
  | "git-failed"
  | "invalid-capture-id"
  | "invalid-managed-root"
  | "invalid-source-root"
  | "invalid-text"
  | "managed-root-overlap"
  | "managed-target-exists"
  | "path-escape"
  | "repository-root-mismatch"
  | "source-changed"
  | "symlink-rejected"
  | "unsupported-application";

export interface RepositoryInventoryOptions {
  readonly budgets: RepositoryManifestBudgets;
  readonly fileSystem: RepositoryFileSystemPort;
  readonly rootPath: string;
  readonly signal: AbortSignal;
}
