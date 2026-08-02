import {
  executeCaptureScenario,
} from "@memi/capture-execution";
import type { CaptureAdapterV1 } from "@memi/capture-import";
import { hashCanonicalValue } from "@memi/canonical-json";
import {
  createImportJobDraftV2,
  transitionImportJobV2,
  type ImportJobTransitionEventV2,
} from "@memi/capture-import";
import type { CaptureDiscoveryOptions } from "@memi/capture-platforms";
import {
  CaptureScenarioIdSchema,
  CaptureFailureSchemaV1,
  ImportPurgeAllResultSchemaV1,
  type CaptureFailureV1,
  type CaptureScenarioV2,
  type ImportJobId,
  type ImportJobSnapshotV2,
  type ImportJobStage,
  type ImportPurgeAllResultV1,
} from "@memi/protocol";

import {
  buildImportPlan,
  captureAdapterExecutionContext,
  type InternalImportPlan,
  nativeDependencyApprovalsMatch,
  recipeApprovalsMatch,
} from "./import-planning.js";
import {
  createCommittedImportedProjectRecord,
} from "./committed-import-project-store.js";
import type {
  ImportCoordinatorOptions,
  ImportMutationInput,
  ImportPlan,
  RetryFailedImportInput,
  StartImportInput,
} from "./import-coordinator.types.js";
import { ImportCoordinatorStorage } from "./import-coordinator-storage.js";

export type * from "./import-coordinator.types.js";

export type ImportPlanningStage = "validate" | "inventory" | "plan";

/**
 * A bounded planning failure. The original error remains available only to the
 * local runtime for logging; public RPC responses expose the stage instead.
 */
export class ImportPlanningError extends Error {
  readonly publicCode: string;
  readonly publicMessage: string;
  readonly remediation: string;
  readonly retryable: boolean;
  readonly stage: ImportPlanningStage;

  constructor(input: {
    readonly cause: unknown;
    readonly stage: ImportPlanningStage;
  }) {
    super(`Import planning stopped during ${input.stage}.`, {
      cause: input.cause,
    });
    const sourceCode =
      input.cause !== null &&
      typeof input.cause === "object" &&
      "code" in input.cause &&
      typeof input.cause.code === "string"
        ? input.cause.code
        : null;
    this.name = "ImportPlanningError";
    this.publicCode =
      sourceCode === "symlink-rejected"
        ? "SOURCE_LINK_REJECTED"
        : sourceCode === "path-escape"
          ? "SOURCE_PATH_REJECTED"
          : sourceCode === "budget-exceeded"
            ? "SOURCE_BUDGET_EXCEEDED"
            : sourceCode === "source-changed"
              ? "SOURCE_CHANGED"
              : "IMPORT_PLANNING_FAILED";
    this.publicMessage =
      sourceCode === "symlink-rejected"
        ? "A symbolic link in importable source content cannot be captured safely."
        : sourceCode === "path-escape"
          ? "A source path escaped the selected repository boundary."
          : sourceCode === "budget-exceeded"
            ? "The repository exceeded the safe import inventory budget."
            : sourceCode === "source-changed"
              ? "The repository changed while Memi was preparing its isolated snapshot."
              : `Memi could not complete ${input.stage} for runtime capture.`;
    this.remediation =
      sourceCode === "symlink-rejected"
        ? "Replace the link with source content or exclude its parent directory, then retry."
        : sourceCode === "path-escape"
          ? "Select the repository root again and remove paths that resolve outside it."
          : sourceCode === "budget-exceeded"
            ? "Exclude generated output or reduce the selected repository scope, then retry."
            : sourceCode === "source-changed"
              ? "Wait for repository writes to finish, then retry the import."
              : "Reveal the local import log, correct the reported setup issue, then retry.";
    this.retryable = true;
    this.stage = input.stage;
  }
}

interface ActiveImportRun {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

const PRE_CAPTURE_STAGES: readonly ImportJobStage[] = [
  "inventory",
  "plan",
  "prepare-fixtures",
  "build",
  "launch",
  "capture",
];

const POST_CAPTURE_STAGES: readonly ImportJobStage[] = [
  "extract-layers",
  "verify",
  "save",
];
const ALL_STAGES: readonly ImportJobStage[] = [
  "validate",
  ...PRE_CAPTURE_STAGES,
  ...POST_CAPTURE_STAGES,
];
const APPLICATION_SETUP_FAILURE_CODES = new Set([
  "CAPTURE_ADAPTER_UNAVAILABLE",
  "LAUNCH_FAILED",
  "PREPARATION_FAILED",
  "RECIPE_AUTHORITY_CHANGED",
]);

function failure(input: {
  readonly scenarioId: CaptureFailureV1["scenarioId"];
  readonly code: string;
  readonly stage: ImportJobStage;
  readonly message: string;
  readonly remediation: string;
  readonly retryable: boolean;
  readonly occurredAt: string;
}): CaptureFailureV1 {
  return CaptureFailureSchemaV1.parse({
    ...input,
    logTail: [],
  });
}

function unresolved(
  job: ImportJobSnapshotV2,
): readonly CaptureScenarioV2[] {
  const terminal = new Set([
    ...job.artifacts.map(({ scenarioId }) => scenarioId),
    ...job.failures.flatMap(({ scenarioId }) =>
      scenarioId === null ? [] : [scenarioId],
    ),
  ]);
  return job.scenarios.filter(({ id }) => !terminal.has(id));
}

function isApplicationSetupFailure(
  item: CaptureFailureV1,
): boolean {
  return APPLICATION_SETUP_FAILURE_CODES.has(item.code);
}

function selectPilotScenarios(
  scenarios: readonly CaptureScenarioV2[],
  sourceRevision: ImportJobSnapshotV2["repository"]["sourceRevision"],
  pilotScenarioIds: readonly string[] | undefined,
): {
  readonly scenarios: readonly CaptureScenarioV2[];
  readonly pilotScope: ImportJobSnapshotV2["pilotScope"];
} {
  if (pilotScenarioIds === undefined) {
    return { scenarios, pilotScope: null };
  }
  const selectedIds = pilotScenarioIds.map((scenarioId) =>
    CaptureScenarioIdSchema.parse(scenarioId),
  );
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error("Pilot capture scenario identities must be unique.");
  }
  const plannedIds = new Set(scenarios.map(({ id }) => id));
  if (selectedIds.some((scenarioId) => !plannedIds.has(scenarioId))) {
    throw new Error(
      "Pilot capture scenario identities must belong to the approved plan.",
    );
  }
  return {
    scenarios: scenarios.filter(({ id }) => selectedIds.includes(id)),
    pilotScope: {
      sourceRevision,
      scenarioIds: selectedIds,
    },
  };
}

function hasExactScenarioIds(
  actual: readonly CaptureScenarioV2[],
  expectedScenarioIds: readonly string[],
): boolean {
  if (actual.length !== expectedScenarioIds.length) {
    return false;
  }
  const expected = new Set(expectedScenarioIds);
  return actual.every(({ id }) => expected.has(id));
}

function scenarioDefinitionHash(scenario: CaptureScenarioV2): string {
  const { id: _id, ...definition } = scenario;
  return hashCanonicalValue(definition);
}

function hasDurableScenarioDefinitions(
  regenerated: readonly CaptureScenarioV2[],
  durable: readonly CaptureScenarioV2[],
): boolean {
  const available = new Map<string, number>();
  for (const scenario of regenerated) {
    const fingerprint = scenarioDefinitionHash(scenario);
    available.set(fingerprint, (available.get(fingerprint) ?? 0) + 1);
  }
  for (const scenario of durable) {
    const fingerprint = scenarioDefinitionHash(scenario);
    const count = available.get(fingerprint) ?? 0;
    if (count === 0) return false;
    available.set(fingerprint, count - 1);
  }
  return true;
}

export class ImportCoordinator {
  readonly #options: ImportCoordinatorOptions;
  readonly #adapters = new Map<string, CaptureAdapterV1>();
  readonly #runs = new Map<ImportJobId, ActiveImportRun>();
  readonly #plans = new Map<string, InternalImportPlan>();
  readonly #jobPlans = new Map<ImportJobId, InternalImportPlan>();
  readonly #storage: ImportCoordinatorStorage;
  #purgePromise: Promise<ImportPurgeAllResultV1> | null = null;
  #purgeRecoveryRequired = false;

  constructor(options: ImportCoordinatorOptions) {
    this.#options = options;
    this.#storage = new ImportCoordinatorStorage(options);
  }

  async #buildPlan(
    repositoryPath: string,
    signal: AbortSignal,
    discoveryOptions?: CaptureDiscoveryOptions,
  ): Promise<InternalImportPlan> {
    let inspection;
    try {
      inspection = await this.#options.repository.inspect(
        repositoryPath,
        signal,
        discoveryOptions,
      );
    } catch (cause) {
      throw new ImportPlanningError({ cause, stage: "validate" });
    }
    try {
      return await buildImportPlan(inspection, this.#options);
    } catch (cause) {
      throw new ImportPlanningError({ cause, stage: "plan" });
    }
  }

  async plan(input: {
    readonly repositoryPath: string;
    readonly signal?: AbortSignal;
    readonly expoRuntime?: "existing-development-client";
  }): Promise<ImportPlan> {
    this.#assertNotPurging();
    const signal = input.signal ?? new AbortController().signal;
    const plan = await this.#buildPlan(
      input.repositoryPath,
      signal,
      input.expoRuntime === undefined
        ? {}
        : { expoRuntime: input.expoRuntime },
    );
    this.#plans.set(plan.inspection.authority.rootPath, plan);
    return plan.publicPlan;
  }

  async start(input: StartImportInput): Promise<ImportJobSnapshotV2> {
    this.#assertNotPurging();
    const cached = this.#plans.get(input.repositoryPath);
    const planned =
      cached ??
      (await this.#buildPlan(
        input.repositoryPath,
        new AbortController().signal,
      ));
    this.#plans.delete(input.repositoryPath);
    const selected = selectPilotScenarios(
      planned.scenarios,
      planned.inspection.authority.sourceRevision,
      input.pilotScenarioIds,
    );
    const draft = {
      ...createImportJobDraftV2({
        id: this.#options.createJobId(),
        projectName: input.projectName,
        repository: {
          rootPath: planned.inspection.authority.rootPath,
          sourceRevision:
            planned.inspection.authority.sourceRevision,
          dirtyFingerprint:
            planned.inspection.authority.dirtyFingerprint,
        },
        selectedHarness: input.selectedHarness,
        pilotScope: selected.pilotScope,
        applications: planned.applications,
        scenarios: selected.scenarios,
        createdAt: this.#now(),
      }),
      managedWorktreeId:
        planned.inspection.authority.managedWorktreeId,
    };
    let job = await this.#options.store.save({
      expectedRevision: null,
      job: draft,
    });
    const planFailure =
      planned.publicPlan.errors[0] ??
      (planned.applications.length === 0 ||
      planned.scenarios.length === 0
        ? {
            code: "UNSUPPORTED_APPLICATION",
            message:
              "The repository contains no capturable application scenarios.",
            remediation:
              "Import an Expo Router iOS, React web, or SwiftUI application.",
            retryable: false,
          }
        : null);
    if (planFailure !== null) {
      return this.#fail(job, {
        ...planFailure,
        stage: "plan",
      });
    }
    if (
      !recipeApprovalsMatch(
        planned.publicPlan.recipes,
        input.approvedRecipes,
        this.#options.now?.() ?? new Date(),
      )
    ) {
      return this.#fail(job, {
        code: "RECIPE_APPROVAL_REQUIRED",
        stage: "plan",
        message:
          "The exact structured build and launch recipes have not been approved.",
        remediation:
          "Review the executable, arguments, and working directory, then approve the matching recipe hashes.",
        retryable: true,
      });
    }
    const approvedDependencyPreparations =
      input.approvedDependencyPreparations ?? [];
    if (
      !nativeDependencyApprovalsMatch(
        planned.dependencyPreparations,
        approvedDependencyPreparations,
      )
    ) {
      return this.#fail(job, {
        code: "DEPENDENCY_APPROVAL_REQUIRED",
        stage: "plan",
        message:
          "The exact locked native dependency preparation has not been approved.",
        remediation:
          "Review the Node, npm, CocoaPods, network, script, and write risks, then approve the matching plan fingerprint.",
        retryable: true,
      });
    }
    await this.#options.artifactStore.initialize();
    await this.#options.planStore.save(
      job.id,
      planned.inspection,
      planned.publicPlan.recipes,
      approvedDependencyPreparations,
    );
    try {
      await this.#storage.ensure(job, {
        managedRootPath: planned.inspection.authority.managedRootPath,
        applicationCount: planned.applications.length,
        scenarioCount: selected.scenarios.length,
      });
    } catch (error) {
      await this.#options.planStore.delete(job.id);
      return this.#fail(job, {
        code: "STORAGE_PREFLIGHT_FAILED",
        stage: "plan",
        message: "Memi could not reserve safe local capture storage.",
        remediation:
          error instanceof Error
            ? error.message
            : "Free local storage, then plan the import again.",
        retryable: true,
      });
    }
    job = await this.#apply(job, {
      type: "start",
      expectedRevision: job.revision,
    });
    const approvedPlan = Object.freeze({
      ...planned,
      dependencyPreparations: Object.freeze([
        ...approvedDependencyPreparations,
      ]),
    });
    this.#jobPlans.set(job.id, approvedPlan);
    this.#launch(job.id, approvedPlan);
    return job;
  }

  async get(jobId: ImportJobId): Promise<ImportJobSnapshotV2> {
    const job = await this.#options.store.get(jobId);
    if (job === null) {
      throw new Error(`Unknown import job ${jobId}.`);
    }
    return job;
  }

  async list(): Promise<readonly ImportJobSnapshotV2[]> {
    this.#assertNotPurging();
    return this.#options.store.listAll();
  }

  async cancel(
    input: ImportMutationInput,
  ): Promise<ImportJobSnapshotV2> {
    this.#assertNotPurging();
    const current = await this.get(input.jobId);
    const paused = await this.#apply(current, {
      type: "cancel",
      expectedRevision: input.expectedRevision,
      at: this.#now(),
    });
    this.#runs.get(input.jobId)?.controller.abort();
    return paused;
  }

  async discard(
    input: ImportMutationInput,
  ): Promise<ImportJobSnapshotV2> {
    this.#assertNotPurging();
    const current = await this.get(input.jobId);
    const storedPlan = await this.#options.planStore.get(current.id);
    const discarded =
      current.state === "cancelled"
        ? current
        : await this.#apply(current, {
            type: "discard",
            expectedRevision: input.expectedRevision,
            at: this.#now(),
          });
    const active = this.#runs.get(discarded.id);
    active?.controller.abort();
    if (active !== undefined) {
      await active.promise;
    }
    if (storedPlan !== null) {
      await this.#storage.ensureCleanup(
        discarded,
        storedPlan.inspection.authority.managedRootPath,
      );
    }
    await this.#storage.finalizeDiscarded(discarded);
    await this.#options.planStore.delete(discarded.id);
    this.#jobPlans.delete(discarded.id);
    await this.#options.store.delete(discarded.id, discarded.revision);
    return discarded;
  }

  async resume(
    input: ImportMutationInput,
  ): Promise<ImportJobSnapshotV2> {
    this.#assertNotPurging();
    const current = await this.get(input.jobId);
    const resumed = await this.#apply(current, {
      type: "resume",
      expectedRevision: input.expectedRevision,
    });
    this.#launch(resumed.id);
    return resumed;
  }

  async retryFailed(
    input: RetryFailedImportInput,
  ): Promise<ImportJobSnapshotV2> {
    this.#assertNotPurging();
    const current = await this.get(input.jobId);
    const event: ImportJobTransitionEventV2 = {
      type: "retry-failed",
      expectedRevision: input.expectedRevision,
      ...(input.scenarioIds === undefined
        ? {}
        : { scenarioIds: input.scenarioIds }),
    };
    const retried = await this.#apply(current, event);
    this.#launch(retried.id);
    return retried;
  }

  async commit(
    input: ImportMutationInput,
  ): Promise<ImportJobSnapshotV2> {
    this.#assertNotPurging();
    const current = await this.get(input.jobId);
    const storedPlan = await this.#options.planStore.get(current.id);
    if (
      storedPlan === null ||
      storedPlan.inspection.authority.rootPath !==
        current.repository.rootPath ||
      storedPlan.inspection.authority.sourceRevision !==
        current.repository.sourceRevision ||
      storedPlan.inspection.authority.dirtyFingerprint !==
        current.repository.dirtyFingerprint
    ) {
      throw new Error(
        "The persisted import plan authority is missing or does not match the captured source.",
      );
    }
    const projectId = this.#options.createProjectId(current);
    const restoredPlan = await buildImportPlan(
      storedPlan.inspection,
      this.#options,
    );
    const committed = await this.#apply(current, {
      type: "commit",
      expectedRevision: input.expectedRevision,
      projectId,
    });
    if (this.#options.committedProjectStore !== undefined) {
      await this.#options.committedProjectStore.save(
        createCommittedImportedProjectRecord({
          inventory: restoredPlan.publicPlan.inventory,
          artifactReferences:
            await this.#options.artifactStore.listReferences(),
          harnessId: "deterministic-import",
          job: committed,
          projectId,
        }),
      );
    }
    await this.#options.planStore.delete(committed.id);
    this.#jobPlans.delete(committed.id);
    await this.#storage.finalize(committed.id, "succeeded");
    return committed;
  }

  async waitForIdle(jobId: ImportJobId): Promise<ImportJobSnapshotV2> {
    const active = this.#runs.get(jobId);
    if (active !== undefined) {
      await active.promise;
    }
    return this.get(jobId);
  }

  async recoverInterrupted(): Promise<
    readonly ImportJobSnapshotV2[]
  > {
    this.#assertNotPurging();
    if (await this.#options.purgeAuthority.purgeRecoveryPending()) {
      this.#purgeRecoveryRequired = true;
      throw new Error(
        "Import purge recovery must complete before job recovery.",
      );
    }
    const interrupted =
      await this.#options.store.listRecoverable();
    const recovered: ImportJobSnapshotV2[] = [];
    for (const current of interrupted) {
      try {
        const paused = await this.#apply(current, {
          type: "cancel",
          expectedRevision: current.revision,
          at: this.#now(),
        });
        const resumed = await this.#apply(paused, {
          type: "resume",
          expectedRevision: paused.revision,
        });
        const plan = await this.#restorePlan(resumed);
        await this.#storage.ensure(resumed, {
          managedRootPath: plan.inspection.authority.managedRootPath,
          applicationCount: plan.applications.length,
          scenarioCount: resumed.scenarios.length,
        });
        this.#launch(resumed.id, plan);
        recovered.push(resumed);
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "ImportJobConflictError"
        ) {
          continue;
        }
        await this.#recordRecoveryFailure(current.id, error);
      }
    }
    const dormant = (await this.#options.store.listAll()).filter(
      ({ state }) => state === "paused" || state === "ready-to-commit",
    );
    for (const current of dormant) {
      const stored = await this.#options.planStore.get(current.id);
      if (
        stored === null ||
        stored.inspection.authority.rootPath !==
          current.repository.rootPath ||
        stored.inspection.authority.sourceRevision !==
          current.repository.sourceRevision ||
        stored.inspection.authority.dirtyFingerprint !==
          current.repository.dirtyFingerprint
      ) {
        throw new Error(
          "A resumable import lost its durable storage authority.",
        );
      }
      // A paused or ready draft is not executing. Reacquire only its cleanup
      // authority so restart recovery never reserves the capacity required for
      // a future capture before the user explicitly resumes it.
      await this.#storage.ensureCleanup(
        current,
        stored.inspection.authority.managedRootPath,
      );
    }
    return Object.freeze(recovered);
  }

  async purgeAll(): Promise<ImportPurgeAllResultV1> {
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

  async #performPurge(): Promise<ImportPurgeAllResultV1> {
    let counts: ImportPurgeAllResultV1["counts"] = Object.freeze({
      artifacts: 0,
      jobs: 0,
      managedWorktrees: 0,
      pendingPlans: 0,
      plans: 0,
      projectBindings: 0,
      simulatorAuthorities: 0,
    });
    let failures: readonly Readonly<{
      readonly category:
        | "authority"
        | "simulator-authority"
        | "managed-worktrees"
        | "artifacts"
        | "plans"
        | "jobs";
      readonly code: string;
      readonly message: string;
    }>[] = Object.freeze([]);
    try {
      await this.#options.purgeAuthority.inspect();
    } catch {
      return ImportPurgeAllResultSchemaV1.parse({
        complete: false,
        counts,
        failures: [{
          category: "authority",
          code: "PURGE_PREFLIGHT_FAILED",
          message:
            "Memi-owned purge targets could not be validated.",
        }],
      });
    }

    const activeRuns = [...this.#runs.values()];
    for (const { controller } of activeRuns) {
      controller.abort();
    }
    await Promise.allSettled(activeRuns.map(({ promise }) => promise));
    try {
      await this.#storage.releaseAll();
    } catch {
      return ImportPurgeAllResultSchemaV1.parse({
        complete: false,
        counts,
        failures: [{
          category: "authority",
          code: "STORAGE_LOCK_RELEASE_FAILED",
          message: "An active import storage authority remains locked.",
        }],
      });
    }
    try {
      await this.#options.purgeAuthority.beginPurge();
      this.#purgeRecoveryRequired = true;
    } catch {
      this.#purgeRecoveryRequired = await this.#options.purgeAuthority
        .purgeRecoveryPending()
        .catch(() => true);
      return ImportPurgeAllResultSchemaV1.parse({
        complete: false,
        counts,
        failures: [{
          category: "authority",
          code: "PURGE_MARKER_WRITE_FAILED",
          message:
            "Durable import purge recovery could not be established.",
        }],
      });
    }

    let jobs: readonly ImportJobSnapshotV2[];
    try {
      jobs = await this.#options.store.listAll();
    } catch {
      return ImportPurgeAllResultSchemaV1.parse({
        complete: false,
        counts,
        failures: [{
          category: "jobs",
          code: "JOB_INVENTORY_FAILED",
          message: "Durable import jobs could not be inventoried.",
        }],
      });
    }

    const purgeResource = async (
      category:
        | "simulator-authority"
        | "managed-worktrees"
        | "artifacts"
        | "jobs",
      code: string,
      message: string,
      operation: () => Promise<number>,
      field:
        | "simulatorAuthorities"
        | "managedWorktrees"
        | "artifacts"
        | "jobs",
    ): Promise<void> => {
      try {
        counts = Object.freeze({
          ...counts,
          [field]: await operation(),
        });
      } catch {
        failures = Object.freeze([
          ...failures,
          Object.freeze({ category, code, message }),
        ]);
      }
    };
    await purgeResource(
      "simulator-authority",
      "SIMULATOR_PURGE_FAILED",
      "Managed simulator authority remains.",
      () => this.#options.purgeAuthority.purgeSimulatorAuthority(),
      "simulatorAuthorities",
    );
    await purgeResource(
      "managed-worktrees",
      "WORKTREE_PURGE_FAILED",
      "Managed capture worktrees remain.",
      () => this.#options.purgeAuthority.purgeManagedWorktrees(),
      "managedWorktrees",
    );
    await purgeResource(
      "artifacts",
      "ARTIFACT_PURGE_FAILED",
      "Capture artifacts remain.",
      () => this.#options.purgeAuthority.purgeArtifacts(),
      "artifacts",
    );
    await purgeResource(
      "jobs",
      "JOB_FILE_PURGE_FAILED",
      "Legacy durable import job records remain.",
      () => this.#options.purgeAuthority.purgeJobRecords(),
      "jobs",
    );
    if (failures.length > 0) {
      return ImportPurgeAllResultSchemaV1.parse({
        complete: false,
        counts,
        failures,
      });
    }

    try {
      counts = Object.freeze({
        ...counts,
        plans: await this.#options.planStore.purgeAll(),
      });
    } catch {
      failures = Object.freeze([
        ...failures,
        Object.freeze({
          category: "plans" as const,
          code: "PLAN_PURGE_FAILED",
          message: "Durable import execution plans remain.",
        }),
      ]);
    }
    if (failures.length > 0) {
      return ImportPurgeAllResultSchemaV1.parse({
        complete: false,
        counts,
        failures,
      });
    }

    try {
      counts = Object.freeze({
        ...counts,
        projectBindings:
          this.#options.committedProjectStore === undefined
            ? new Set(
                jobs.flatMap(({ projectId }) =>
                  projectId === null ? [] : [projectId],
                ),
              ).size
            : await this.#options.committedProjectStore.purgeAll(),
      });
    } catch {
      failures = Object.freeze([
        ...failures,
        Object.freeze({
          category: "jobs" as const,
          code: "JOB_PURGE_FAILED",
          message: "Durable import jobs and project bindings remain.",
        }),
      ]);
    }
    if (failures.length > 0) {
      return ImportPurgeAllResultSchemaV1.parse({
        complete: false,
        counts,
        failures,
      });
    }
    try {
      counts = Object.freeze({
        ...counts,
        jobs: counts.jobs + await this.#options.store.purgeAll(),
      });
    } catch {
      failures = Object.freeze([
        ...failures,
        Object.freeze({
          category: "jobs" as const,
          code: "JOB_PURGE_FAILED",
          message: "Durable import jobs remain.",
        }),
      ]);
    }
    if (failures.length === 0) {
      try {
        await this.#options.purgeAuthority.completePurge();
        this.#purgeRecoveryRequired = false;
      } catch {
        failures = Object.freeze([
          ...failures,
          Object.freeze({
            category: "authority" as const,
            code: "PURGE_MARKER_CLEAR_FAILED",
            message: "Durable import purge recovery remains active.",
          }),
        ]);
      }
    }
    if (failures.length === 0) {
      this.#plans.clear();
      this.#jobPlans.clear();
    }
    return ImportPurgeAllResultSchemaV1.parse({
      complete: failures.length === 0,
      counts,
      failures,
    });
  }

  #launch(jobId: ImportJobId, plan?: InternalImportPlan): void {
    if (this.#runs.has(jobId)) {
      return;
    }
    const controller = new AbortController();
    const activePlan = plan ?? this.#jobPlans.get(jobId);
    const run = this.#run(jobId, controller.signal, activePlan)
      .catch((error: unknown) =>
        this.#recordUnexpectedFailure(jobId, error),
      )
      .then(() => this.#storage.finalizeTerminal(jobId))
      .finally(() => {
        this.#releaseAdapters(jobId);
        const active = this.#runs.get(jobId);
        if (active?.controller === controller) {
          this.#runs.delete(jobId);
        }
      });
    this.#runs.set(jobId, { controller, promise: run });
  }

  #adapterKey(
    jobId: ImportJobId,
    applicationId: string,
  ): string {
    return `${jobId}\u0000${applicationId}`;
  }

  #releaseAdapters(jobId: ImportJobId): void {
    const prefix = `${jobId}\u0000`;
    for (const key of this.#adapters.keys()) {
      if (key.startsWith(prefix)) {
        this.#adapters.delete(key);
      }
    }
  }

  async #run(
    jobId: ImportJobId,
    signal: AbortSignal,
    plan?: InternalImportPlan,
  ): Promise<void> {
    let job = await this.get(jobId);
    const executionPlan = plan ?? await this.#restorePlan(job);
    await this.#storage.ensure(job, {
      managedRootPath:
        executionPlan.inspection.authority.managedRootPath,
      applicationCount: executionPlan.applications.length,
      scenarioCount: job.scenarios.length,
    });
    for (const stage of PRE_CAPTURE_STAGES) {
      if (
        ALL_STAGES.indexOf(job.stage) >= ALL_STAGES.indexOf(stage)
      ) {
        continue;
      }
      if (job.state !== "running" || signal.aborted) {
        return;
      }
      job = await this.#apply(job, {
        type: "advance-stage",
        expectedRevision: job.revision,
        stage,
      });
    }
    while (true) {
      job = await this.get(jobId);
      if (job.state !== "running" || signal.aborted) {
        return;
      }
      const scenario = unresolved(job)[0];
      if (scenario === undefined) {
        break;
      }
      job = await this.#apply(job, {
        type: "scenario-started",
        expectedRevision: job.revision,
        scenarioId: scenario.id,
      });
      const result = await this.#execute(
        job,
        scenario,
        signal,
        executionPlan,
      );
      job = await this.get(jobId);
      if (job.state !== "running" || signal.aborted) {
        return;
      }
      if (
        result.kind === "failed" &&
        isApplicationSetupFailure(result.failure)
      ) {
        const blockedScenarios = unresolved(job).filter(
          ({ applicationId }) => applicationId === scenario.applicationId,
        );
        for (const blockedScenario of blockedScenarios) {
          if (job.currentScenarioId !== blockedScenario.id) {
            job = await this.#apply(job, {
              type: "scenario-started",
              expectedRevision: job.revision,
              scenarioId: blockedScenario.id,
            });
          }
          job = await this.#apply(job, {
            type: "scenario-failed",
            expectedRevision: job.revision,
            failure: failure({
              scenarioId: blockedScenario.id,
              code: result.failure.code,
              stage: result.failure.stage,
              message: result.failure.message,
              remediation: result.failure.remediation,
              retryable: result.failure.retryable,
              occurredAt: this.#now(),
            }),
          });
        }
        continue;
      }
      job = await this.#apply(
        job,
        result.kind === "captured"
          ? {
              type: "scenario-captured",
              expectedRevision: job.revision,
              artifact: result.artifact,
            }
          : {
              type: "scenario-failed",
              expectedRevision: job.revision,
              failure: result.failure,
            },
      );
    }
    for (const stage of POST_CAPTURE_STAGES) {
      job = await this.get(jobId);
      if (job.state !== "running" || signal.aborted) {
        return;
      }
      job = await this.#apply(job, {
        type: "advance-stage",
        expectedRevision: job.revision,
        stage,
      });
    }
  }

  async #restorePlan(
    job: ImportJobSnapshotV2,
  ): Promise<InternalImportPlan> {
    const stored = await this.#options.planStore.get(job.id);
    if (stored === null) {
      throw new Error(
        "The durable import execution plan is unavailable.",
      );
    }
    if (
      stored.inspection.authority.rootPath !== job.repository.rootPath ||
      stored.inspection.authority.sourceRevision !==
        job.repository.sourceRevision ||
      stored.inspection.authority.dirtyFingerprint !==
        job.repository.dirtyFingerprint
    ) {
      throw new Error(
        "The durable import execution plan does not match the job authority.",
      );
    }
    const restored = await buildImportPlan(
      stored.inspection,
      this.#options,
    );
    if (
      !recipeApprovalsMatch(
        stored.approvals,
        restored.publicPlan.recipes.map((approval) => {
          const persisted = stored.approvals.find(
            ({ applicationId }) =>
              applicationId === approval.applicationId,
          );
          return persisted ?? approval;
        }),
        this.#options.now?.() ?? new Date(),
      )
    ) {
      throw new Error(
        "The durable recipe approval authority is invalid or expired.",
      );
    }
    if (
      !nativeDependencyApprovalsMatch(
        restored.dependencyPreparations,
        stored.dependencyPreparations ?? [],
      )
    ) {
      throw new Error(
        "The durable native dependency approval is invalid or stale.",
      );
    }
    const expectedScenarioIds =
      job.pilotScope?.scenarioIds ?? job.scenarios.map(({ id }) => id);
    const durableScenarios = Object.freeze([...job.scenarios]);
    const restoredWithApprovals: InternalImportPlan = {
      ...restored,
      scenarios: durableScenarios,
      dependencyPreparations: stored.dependencyPreparations ?? [],
      publicPlan: {
        ...restored.publicPlan,
        recipes: stored.approvals,
        scenarios: durableScenarios,
        scenarioCount: durableScenarios.length,
      },
    };
    if (
      (job.pilotScope !== null &&
        job.pilotScope.sourceRevision !==
          restoredWithApprovals.inspection.authority.sourceRevision) ||
      !hasExactScenarioIds(durableScenarios, expectedScenarioIds) ||
      !hasDurableScenarioDefinitions(restored.scenarios, durableScenarios) ||
      (job.pilotScope === null &&
        restored.scenarios.length !== durableScenarios.length)
    ) {
      throw new Error(
        "The durable import execution plan does not match the revision-bound pilot scope.",
      );
    }
    const jobApplications = new Set(
      job.applications.map(({ id }) => id),
    );
    if (
      restoredWithApprovals.applications.length !== jobApplications.size ||
      restoredWithApprovals.applications.some(
        ({ id }) => !jobApplications.has(id),
      )
    ) {
      throw new Error(
        "The durable import execution plan applications changed.",
      );
    }
    this.#jobPlans.set(job.id, restoredWithApprovals);
    return restoredWithApprovals;
  }

  async #execute(
    job: ImportJobSnapshotV2,
    scenario: CaptureScenarioV2,
    signal: AbortSignal,
    plan?: InternalImportPlan,
  ) {
    if (scenario.fixtureProfile === "unresolved-required-fixture") {
      return {
        kind: "failed" as const,
        failure: failure({
          scenarioId: scenario.id,
          code: "FIXTURE_REQUIRED",
          stage: "prepare-fixtures",
          message: "The dynamic route has no deterministic fixture.",
          remediation:
            "Review a non-secret fixture proposal, then retry this scenario.",
          retryable: true,
          occurredAt: this.#now(),
        }),
      };
    }
    const application = job.applications.find(
      ({ id }) => id === scenario.applicationId,
    );
    const unit = plan?.unitsByApplicationId.get(
      scenario.applicationId,
    );
    const dependencyPreparation =
      plan?.dependencyPreparations.find(
        ({ applicationId }) =>
          applicationId === application?.id,
      );
    const context =
      application === undefined ||
      unit === undefined ||
      plan === undefined
        ? null
        : {
            ...captureAdapterExecutionContext(
              plan.inspection,
              unit,
            ),
            ...(dependencyPreparation !== undefined &&
            "approval" in dependencyPreparation
              ? {
                  dependencyPreparation: {
                    plan: dependencyPreparation.plan,
                    approval: dependencyPreparation.approval,
                  },
                }
              : {}),
          };
    const adapterKey =
      application === undefined ? null : this.#adapterKey(job.id, application.id);
    const adapter =
      application === undefined ||
      unit === undefined ||
      context === null
        ? null
        : this.#adapters.get(adapterKey!) ?? (() => {
            const created = this.#options.adapterFor(
              application,
              unit,
              context,
            );
            if (created !== null) {
              this.#adapters.set(adapterKey!, created);
            }
            return created;
          })();
    if (
      application === undefined ||
      unit === undefined ||
      adapter === null
    ) {
      return {
        kind: "failed" as const,
        failure: failure({
          scenarioId: scenario.id,
          code: "CAPTURE_ADAPTER_UNAVAILABLE",
          stage: "launch",
          message:
            "No production capture adapter is available for this application.",
          remediation:
            "Install or configure the matching platform capture adapter, then retry.",
          retryable: true,
          occurredAt: this.#now(),
        }),
      };
    }
    const approved = plan?.publicPlan.recipes.find(
      ({ applicationId }) => applicationId === application.id,
    );
    const currentAuthority =
      approved === undefined
        ? null
        : await this.#options.approvalAuthority.describe({
            application,
            unit,
            adapter,
            recipe: approved.recipe,
          });
    if (
      approved === undefined ||
      currentAuthority === null ||
      approved.expiresAt <= this.#now() ||
      approved.sourceRevision !== job.repository.sourceRevision ||
      approved.dirtyFingerprint !== job.repository.dirtyFingerprint ||
      approved.applicationCacheKey !== unit.cacheKey ||
      approved.adapter.id !== adapter.metadata.id ||
      approved.adapter.version !== adapter.metadata.version ||
      approved.resolvedExecutable !==
        currentAuthority.resolvedExecutable ||
      approved.environmentFingerprint !==
        currentAuthority.environmentFingerprint ||
      hashCanonicalValue(unit.buildRecipe) !==
        hashCanonicalValue(approved.recipe)
    ) {
      return {
        kind: "failed" as const,
        failure: failure({
          scenarioId: scenario.id,
          code: "RECIPE_AUTHORITY_CHANGED",
          stage: "launch",
          message:
            "The approved execution recipe no longer matches the repository, adapter, executable, or sandbox environment.",
          remediation:
            "Re-plan the import, review the new structured recipe, and approve it again.",
          retryable: true,
          occurredAt: this.#now(),
        }),
      };
    }
    return executeCaptureScenario({
      adapter,
      application,
      scenario,
      job,
      signal,
      ...(this.#options.now === undefined
        ? {}
        : { now: this.#options.now }),
    });
  }

  async #apply(
    job: ImportJobSnapshotV2,
    event: ImportJobTransitionEventV2,
  ): Promise<ImportJobSnapshotV2> {
    return this.#options.store.save(
      transitionImportJobV2(job, event),
    );
  }

  async listRetainedArtifactReferences(): Promise<
    Awaited<
      ReturnType<ImportCoordinatorStorage["listRetainedArtifactReferences"]>
    >
  > {
    return this.#storage.listRetainedArtifactReferences();
  }

  async #fail(
    job: ImportJobSnapshotV2,
    input: {
      readonly code: string;
      readonly stage: ImportJobStage;
      readonly message: string;
      readonly remediation: string;
      readonly retryable: boolean;
    },
  ): Promise<ImportJobSnapshotV2> {
    return this.#apply(job, {
      type: "fail",
      expectedRevision: job.revision,
      failure: failure({
        scenarioId: null,
        ...input,
        occurredAt: this.#now(),
      }),
    });
  }

  async #recordUnexpectedFailure(
    jobId: ImportJobId,
    error: unknown,
  ): Promise<void> {
    const job = await this.get(jobId);
    if (!["queued", "running", "paused"].includes(job.state)) {
      return;
    }
    await this.#fail(job, {
      code: "IMPORT_COORDINATOR_FAILED",
      stage: job.stage,
      message:
        error instanceof Error
          ? error.message
          : "The import coordinator failed.",
      remediation: "Inspect redacted logs and resume the import.",
      retryable: true,
    });
  }

  async #recordRecoveryFailure(
    jobId: ImportJobId,
    error: unknown,
  ): Promise<void> {
    const job = await this.get(jobId);
    if (!["queued", "running", "paused"].includes(job.state)) {
      return;
    }
    const expiredApproval =
      error instanceof Error &&
      error.message ===
        "The durable recipe approval authority is invalid or expired.";
    await this.#fail(job, {
      code: expiredApproval
        ? "RECIPE_APPROVAL_EXPIRED"
        : "IMPORT_COORDINATOR_FAILED",
      stage: job.stage,
      message: expiredApproval
        ? error.message
        : error instanceof Error
          ? error.message
          : "The import recovery failed.",
      remediation: expiredApproval
        ? "Create a new approved import plan before retrying this job."
        : "Inspect redacted logs and resume the import.",
      retryable: true,
    });
  }

  #now(): string {
    return (this.#options.now ?? (() => new Date()))().toISOString();
  }

  #assertNotPurging(): void {
    if (
      this.#purgePromise !== null ||
      this.#purgeRecoveryRequired
    ) {
      throw new Error("Import purge is in progress.");
    }
  }
}
