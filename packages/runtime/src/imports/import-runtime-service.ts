import { randomBytes } from "node:crypto";
import {
  approveNativeDependencyPreparationPlan,
} from "@memi/capture-execution";

import type {
  CaptureScenarioId,
  ImportJobId,
  ImportJobListItemV1,
  ImportJobSnapshotV2,
} from "@memi/protocol";
import {
  ImportApplicationSchemaV2,
  ImportJobListItemSchemaV1,
  ImportPurgeAllResultSchemaV1,
  ImportPlanResultSchemaV1,
  ImportPlanTokenSchema,
  type ImportPlanResultV1,
  type ImportPlanToken,
  type ImportPurgeAllResultV1,
} from "@memi/protocol";

import {
  ImportCoordinator,
} from "./import-coordinator.js";
import type {
  CommittedImportedProjectStore,
} from "./committed-import-project-store.js";
import type {
  ImportMutationInput,
  PlannedRecipeApproval,
  PlannedNativeDependencyPreparation,
  RetryFailedImportInput,
} from "./import-coordinator.types.js";

export type ImportPlanServiceResult = ImportPlanResultV1;

export interface ImportJobServiceResult {
  readonly job: ImportJobSnapshotV2;
  readonly inventory?: ImportPlanResultV1["plan"]["inventory"];
}
export interface ImportJobsListServiceResult {
  readonly jobs: readonly ImportJobListItemV1[];
}
export type ImportPurgeServiceResult = ImportPurgeAllResultV1;

interface PendingPlan {
  readonly repositoryPath: string;
  readonly approvals: readonly PlannedRecipeApproval[];
  readonly dependencyPreparations: readonly PlannedNativeDependencyPreparation[];
  readonly expiresAt: string;
}

function toImportJobListItem(
  job: ImportJobSnapshotV2,
): ImportJobListItemV1 {
  return ImportJobListItemSchemaV1.parse({
    id: job.id,
    projectId: job.projectId,
    projectName: job.projectName,
    state: job.state,
    stage: job.stage,
    sourceRevision: job.repository.sourceRevision,
    progress: job.progress,
    currentApplicationId: job.currentApplicationId,
    currentScenarioId: job.currentScenarioId,
    failureCount: job.failures.length,
    revision: job.revision,
    updatedAt: job.updatedAt,
  });
}

export interface ImportRuntimeServiceOptions {
  readonly now?: () => Date;
  readonly createPlanToken?: () => ImportPlanToken;
  readonly committedProjectStore?: CommittedImportedProjectStore;
}

function defaultPlanToken(): ImportPlanToken {
  return ImportPlanTokenSchema.parse(
    `ipl_${randomBytes(13)
      .toString("hex")
      .slice(0, 26)
      .toUpperCase()}`,
  );
}

export class ImportRuntimeService {
  readonly #coordinator: ImportCoordinator;
  readonly #committedProjectStore: CommittedImportedProjectStore | undefined;
  readonly #now: () => Date;
  readonly #createPlanToken: () => ImportPlanToken;
  readonly #pending = new Map<ImportPlanToken, PendingPlan>();
  #purgePromise: Promise<ImportPurgeServiceResult> | null = null;

  constructor(
    coordinator: ImportCoordinator,
    options: ImportRuntimeServiceOptions = {},
  ) {
    this.#coordinator = coordinator;
    this.#committedProjectStore = options.committedProjectStore;
    this.#now = options.now ?? (() => new Date());
    this.#createPlanToken =
      options.createPlanToken ?? defaultPlanToken;
  }

  async plan(input: {
    readonly repositoryPath: string;
    readonly expoRuntime?: "existing-development-client";
  }): Promise<ImportPlanServiceResult> {
    this.#assertNotPurging();
    const plan = await this.#coordinator.plan(input);
    const planToken = this.#createPlanToken();
    ImportPlanTokenSchema.parse(planToken);
    if (this.#pending.has(planToken)) {
      throw new Error("Import plan token authority is invalid.");
    }
    const repositoryPath = plan.repository.rootPath;
    const scenarios = plan.scenarios ?? [];
    const dependencyPreparations =
      plan.dependencyPreparations ?? [];
    for (const [token, pending] of this.#pending) {
      if (
        pending.repositoryPath === repositoryPath ||
        pending.expiresAt <= this.#now().toISOString()
      ) {
        this.#pending.delete(token);
      }
    }
    const expiresAt =
      plan.recipes.map(({ expiresAt: expiry }) => expiry).sort()[0] ??
      new Date(this.#now().getTime() + 60_000).toISOString();
    this.#pending.set(
      planToken,
      Object.freeze({
        repositoryPath,
        approvals: plan.recipes,
        dependencyPreparations,
        expiresAt,
      }),
    );
    const labels = new Map<string, string>(
      plan.applications.map((application) => [
        application.applicationId,
        application.displayName,
      ]),
    );
    return ImportPlanResultSchemaV1.parse({
      plan: Object.freeze({
        token: planToken,
        repository: {
          rootPath: plan.repository.rootPath,
          sourceRevision: plan.repository.sourceRevision,
          dirtyFingerprint: plan.repository.dirtyFingerprint,
        },
        applications: plan.applications.map((application) =>
          ImportApplicationSchemaV2.parse({
            id: application.applicationId,
            label: application.displayName,
            platform: application.platform,
            relativeRoot: application.root,
          }),
        ),
        scenarios: scenarios.map((scenario) => ({
          id: scenario.id,
          applicationId: scenario.applicationId,
          route: scenario.route,
          state: scenario.state,
          viewport: scenario.viewport,
          sourceAnchor: scenario.sourceAnchor,
        })),
        recipes: plan.recipes.map((approval) => ({
          applicationId: approval.applicationId,
          applicationLabel:
            labels.get(approval.applicationId) ??
            approval.applicationId,
          adapterId: approval.adapter.id,
          adapterVersion: approval.adapter.version,
          executable: approval.recipe.executable,
          resolvedExecutable: approval.resolvedExecutable,
          args: approval.recipe.args,
          cwd: approval.recipe.cwd,
          purpose: approval.recipe.purpose,
          hash: approval.hash,
          expiresAt: approval.expiresAt,
        })),
        ...(dependencyPreparations.length === 0
          ? {}
          : {
              dependencyPreparations:
                dependencyPreparations.map((preparation) => ({
                  applicationId: preparation.applicationId,
                  applicationLabel: preparation.applicationLabel,
                  adapterVersion:
                    preparation.plan.adapterVersion,
                  planFingerprint:
                    preparation.plan.fingerprint,
                  repositoryRevision:
                    preparation.plan.repositoryRevision,
                  policy: preparation.plan.policy,
                  lockfiles: preparation.plan.lockfiles,
                  commands: preparation.plan.commands,
                })),
            }),
        inventory: plan.inventory,
        scenarioCount: plan.scenarioCount,
        errors: plan.errors,
      }),
    });
  }

  async start(input: {
    readonly planToken: ImportPlanToken;
    readonly repositoryPath: string;
    readonly projectName: string;
    readonly selectedHarness: ImportJobSnapshotV2["selectedHarness"];
    readonly approvedRecipeHashes: readonly `sha256:${string}`[];
    readonly pilotScenarioIds?: readonly CaptureScenarioId[];
  }): Promise<ImportJobServiceResult> {
    this.#assertNotPurging();
    const pending = this.#pending.get(input.planToken);
    this.#pending.delete(input.planToken);
    if (
      pending === undefined ||
      pending.repositoryPath !== input.repositoryPath ||
      pending.expiresAt <= this.#now().toISOString()
    ) {
      throw new Error(
        "Import plan token is unknown, expired, consumed, or bound to another repository.",
      );
    }
    const required = [
      ...pending.approvals.map(({ hash }) => hash),
      ...pending.dependencyPreparations.map(
        ({ plan }) => plan.fingerprint,
      ),
    ]
      .sort();
    const approved = [...input.approvedRecipeHashes].sort();
    if (
      required.length !== approved.length ||
      required.some((hash, index) => hash !== approved[index])
    ) {
      throw new Error(
        "Approved recipe hashes do not match the single-use import plan.",
      );
    }
    const job = await this.#coordinator.start({
      repositoryPath: input.repositoryPath,
      projectName: input.projectName,
      selectedHarness: input.selectedHarness,
      ...(input.pilotScenarioIds === undefined
        ? {}
        : { pilotScenarioIds: input.pilotScenarioIds }),
      approvedRecipes: pending.approvals,
      approvedDependencyPreparations:
        pending.dependencyPreparations.map((preparation) => ({
          ...preparation,
          approval: approveNativeDependencyPreparationPlan(
            preparation.plan,
            {
              approvedFingerprint: preparation.plan.fingerprint,
              approvedBy: "human:repository-import",
              approvedAt: this.#now().toISOString(),
            },
          ),
        })),
    });
    return Object.freeze({ job });
  }

  async list(): Promise<ImportJobsListServiceResult> {
    this.#assertNotPurging();
    return Object.freeze({
      jobs: Object.freeze(
        (await this.#coordinator.list()).map(toImportJobListItem),
      ),
    });
  }

  async get(input: {
    readonly jobId: ImportJobId;
  }): Promise<ImportJobServiceResult> {
    this.#assertNotPurging();
    const job = await this.#coordinator.get(input.jobId);
    const committed =
      job.projectId === null || this.#committedProjectStore === undefined
        ? null
        : await this.#committedProjectStore.get(job.projectId);
    return Object.freeze({
      job,
      ...(committed === null
        ? {}
        : { inventory: committed.manifest.inventory }),
    });
  }

  async cancel(
    input: ImportMutationInput,
  ): Promise<ImportJobServiceResult> {
    this.#assertNotPurging();
    return Object.freeze({
      job: await this.#coordinator.cancel(input),
    });
  }

  async discard(
    input: ImportMutationInput,
  ): Promise<ImportJobServiceResult> {
    this.#assertNotPurging();
    return Object.freeze({
      job: await this.#coordinator.discard(input),
    });
  }

  async resume(
    input: ImportMutationInput,
  ): Promise<ImportJobServiceResult> {
    this.#assertNotPurging();
    return Object.freeze({
      job: await this.#coordinator.resume(input),
    });
  }

  async retryFailed(
    input: RetryFailedImportInput,
  ): Promise<ImportJobServiceResult> {
    this.#assertNotPurging();
    return Object.freeze({
      job: await this.#coordinator.retryFailed(input),
    });
  }

  async commit(
    input: ImportMutationInput,
  ): Promise<ImportJobServiceResult> {
    this.#assertNotPurging();
    return Object.freeze({
      job: await this.#coordinator.commit(input),
    });
  }

  async purgeAll(
    _input: Readonly<Record<never, never>>,
  ): Promise<ImportPurgeServiceResult> {
    if (this.#purgePromise !== null) {
      return this.#purgePromise;
    }
    const operation = this.#performPurge();
    this.#purgePromise = operation;
    try {
      return await operation;
    } finally {
      if (this.#purgePromise === operation) {
        this.#purgePromise = null;
      }
    }
  }

  async #performPurge(): Promise<ImportPurgeServiceResult> {
    const result = await this.#coordinator.purgeAll();
    if (!result.complete) {
      return ImportPurgeAllResultSchemaV1.parse(result);
    }
    const pendingPlans = this.#pending.size;
    this.#pending.clear();
    return ImportPurgeAllResultSchemaV1.parse({
      ...result,
      counts: {
        ...result.counts,
        pendingPlans,
      },
    });
  }

  #assertNotPurging(): void {
    if (this.#purgePromise !== null) {
      throw new Error("Import purge is in progress.");
    }
  }
}

export function createImportRuntimeService(
  coordinator: ImportCoordinator,
  options: ImportRuntimeServiceOptions = {},
): ImportRuntimeService {
  return new ImportRuntimeService(coordinator, options);
}
