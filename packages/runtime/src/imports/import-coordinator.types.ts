import type {
  CaptureAdapterV1,
} from "@memi/capture-import";
import type {
  ArtifactReference,
  NativeDependencyPreparationApproval,
  NativeDependencyPreparationInput,
  NativeDependencyPreparationPlan,
} from "@memi/capture-execution";
import type {
  ApprovedBuildRecipe,
  CaptureApplicationUnit,
  CaptureDiscoveryOptions,
  RepositoryManifestInput,
} from "@memi/capture-platforms";
import type {
  RepositorySnapshotExclusionManifest,
} from "@memi/capture-repository";
import type {
  CaptureScenarioPlan,
  CaptureRoutePlan,
} from "@memi/capture-platforms";
import type {
  CaptureScenarioId,
  CaptureScenarioV2,
  ImportInventoryV1,
  ImportApplicationV2,
  ImportJobId,
  ImportJobSnapshotV2,
  ImportPurgeAllResultV1,
  ProjectId,
  WorktreeId,
} from "@memi/protocol";
import type { ImportPlanStore } from "./import-plan-store.js";
import type {
  CommittedImportedProjectStore,
} from "./committed-import-project-store.js";
import type {
  ImportRuntimePurgeAuthority,
} from "./import-runtime-purge.js";
import type {
  ImportRuntimeStorageBudgetAuthority,
  StorageBudgetEstimate,
} from "./storage-budget-policy.js";

export interface ImportRepositoryInspection {
  readonly authority: {
    readonly rootPath: string;
    readonly sourceRevision: string | null;
    readonly dirtyFingerprint: `sha256:${string}` | null;
    readonly managedWorktreeId: WorktreeId | null;
    /**
     * Private execution authority for the isolated Memi-managed copy.
     * This path must never be projected into ImportJobV2 or protocol
     * responses.
     */
    readonly managedRootPath: string;
  };
  readonly manifest: RepositoryManifestInput;
  readonly applications?: readonly CaptureApplicationUnit[];
  readonly snapshotExclusions: RepositorySnapshotExclusionManifest;
}

export type ImportSourceRepositoryAuthority = Omit<
  ImportRepositoryInspection["authority"],
  "managedRootPath"
>;

export interface CaptureAdapterExecutionContext {
  readonly managedRootPath: string;
  readonly applicationRootPath: string;
  /** Read-only original application root, used only by an installed dev client. */
  readonly sourceApplicationRootPath?: string;
  readonly repositoryRevision: string | null;
  readonly dependencyPreparation?:
    | Readonly<{
        readonly plan: NativeDependencyPreparationPlan;
        readonly approval: NativeDependencyPreparationApproval;
      }>
    | null;
}

export interface ImportRepositoryPort {
  inspect(
    repositoryPath: string,
    signal: AbortSignal,
    discoveryOptions?: CaptureDiscoveryOptions,
  ): Promise<ImportRepositoryInspection>;
}

export interface PlannedRecipeApproval {
  readonly schemaVersion: 2;
  readonly applicationId: string;
  readonly recipe: ApprovedBuildRecipe;
  readonly repositoryFingerprint: `sha256:${string}`;
  readonly snapshotExclusionFingerprint: `sha256:${string}`;
  readonly snapshotPolicyFingerprint: `sha256:${string}`;
  readonly sourceRevision: string;
  readonly dirtyFingerprint: `sha256:${string}`;
  readonly applicationCacheKey: `sha256:${string}`;
  readonly adapter: {
    readonly id: string;
    readonly version: string;
  };
  readonly resolvedExecutable: string;
  readonly environmentFingerprint: `sha256:${string}`;
  readonly nonce: string;
  readonly expiresAt: string;
  readonly hash: `sha256:${string}`;
}

export interface ImportPlan {
  readonly repository: ImportSourceRepositoryAuthority;
  readonly applications: readonly CaptureApplicationUnit[];
  readonly scenarios: readonly CaptureScenarioV2[];
  readonly recipes: readonly PlannedRecipeApproval[];
  readonly dependencyPreparations: readonly PlannedNativeDependencyPreparation[];
  readonly inventory: ImportInventoryV1;
  readonly scenarioCount: number;
  readonly errors: readonly {
    readonly code: string;
    readonly message: string;
    readonly remediation: string;
    readonly retryable: boolean;
  }[];
}

export interface StartImportInput {
  readonly repositoryPath: string;
  readonly projectName: string;
  readonly selectedHarness: ImportJobSnapshotV2["selectedHarness"];
  readonly approvedRecipes: readonly PlannedRecipeApproval[];
  /** Optional bounded subset from the just-approved import plan. */
  readonly pilotScenarioIds?: readonly CaptureScenarioId[];
  readonly approvedDependencyPreparations?: readonly ApprovedNativeDependencyPreparation[];
}

export interface PlannedNativeDependencyPreparation {
  readonly applicationId: string;
  readonly applicationLabel: string;
  readonly plan: NativeDependencyPreparationPlan;
}

export interface ApprovedNativeDependencyPreparation
  extends PlannedNativeDependencyPreparation {
  readonly approval: NativeDependencyPreparationApproval;
}

export interface ImportMutationInput {
  readonly jobId: ImportJobId;
  readonly expectedRevision: number;
}

export interface RetryFailedImportInput extends ImportMutationInput {
  readonly scenarioIds?: readonly CaptureScenarioId[];
}

export interface ImportArtifactStore {
  initialize(): Promise<void>;
  listReferences(): Promise<readonly ArtifactReference[]>;
}

export interface ResolvedScenarioFixture {
  readonly parameters: readonly {
    readonly key: string;
    readonly value: string;
  }[];
  readonly fixtureProfile: string;
  readonly readinessSelector: string | null;
}

export interface ImportCoordinatorOptions {
  readonly store: {
    get(jobId: ImportJobId): Promise<ImportJobSnapshotV2 | null>;
    listAll(): Promise<readonly ImportJobSnapshotV2[]>;
    listRecoverable(): Promise<readonly ImportJobSnapshotV2[]>;
    save(request: {
      readonly expectedRevision: number | null;
      readonly job: Omit<
        ImportJobSnapshotV2,
        "revision" | "updatedAt"
      >;
    }): Promise<ImportJobSnapshotV2>;
    delete(jobId: ImportJobId, expectedRevision: number): Promise<void>;
    purgeAll(): Promise<number>;
  };
  readonly planStore: ImportPlanStore;
  readonly committedProjectStore?: CommittedImportedProjectStore;
  readonly purgeAuthority: ImportRuntimePurgeAuthority;
  readonly artifactStore: ImportArtifactStore;
  readonly storageBudgetAuthority?: ImportRuntimeStorageBudgetAuthority;
  readonly storageBudgetEstimateFor?: (input: {
    readonly applicationCount: number;
    readonly scenarioCount: number;
  }) => StorageBudgetEstimate;
  readonly repository: ImportRepositoryPort;
  readonly adapterFor: (
    application: ImportApplicationV2,
    unit: CaptureApplicationUnit,
    context: CaptureAdapterExecutionContext,
  ) => CaptureAdapterV1 | null;
  readonly approvalAuthority: {
    describe(input: {
      readonly application: ImportApplicationV2;
      readonly unit: CaptureApplicationUnit;
      readonly adapter: CaptureAdapterV1;
      readonly recipe: ApprovedBuildRecipe;
    }): Promise<{
      readonly resolvedExecutable: string;
      readonly environmentFingerprint: `sha256:${string}`;
    }>;
    createNonce(): string;
    expiresAt(now: Date): string;
  };
  readonly nativeDependencyPreparationFor?: (input: {
    readonly application: ImportApplicationV2;
    readonly unit: CaptureApplicationUnit;
    readonly context: Omit<
      CaptureAdapterExecutionContext,
      "dependencyPreparation"
    >;
    readonly adapter: CaptureAdapterV1;
  }) => Promise<NativeDependencyPreparationInput | null>;
  readonly createJobId: () => ImportJobId;
  readonly createScenarioId: (
    scenario: CaptureScenarioPlan,
    index: number,
  ) => CaptureScenarioId;
  readonly createProjectId: (job: ImportJobSnapshotV2) => ProjectId;
  readonly resolveFixture?: (
    scenario: CaptureScenarioPlan,
    route: CaptureRoutePlan,
  ) => Promise<ResolvedScenarioFixture | null>;
  readonly now?: () => Date;
}

export type ImportCoordinatorPurgeResult = ImportPurgeAllResultV1;
