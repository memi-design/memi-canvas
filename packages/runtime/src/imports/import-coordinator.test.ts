import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  transitionImportJobV2,
  type CaptureAdapterV1,
} from "@memi/capture-import";
import {
  approveNativeDependencyPreparationPlan,
  type ArtifactReference,
} from "@memi/capture-execution";
import {
  discoverCaptureApplications,
  type CaptureRoutePlan,
} from "@memi/capture-platforms";
import {
  CaptureArtifactSchemaV2,
  CaptureScenarioIdSchema,
  ImportJobIdSchema,
  ProjectIdSchema,
  type CaptureScenarioV2,
  type ImportApplicationV2,
} from "@memi/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SqliteImportJobStore } from "../import-job-store.js";
import {
  ImportCoordinator,
  type ImportCoordinatorOptions,
  type ImportRepositoryInspection,
  type PlannedRecipeApproval,
} from "./import-coordinator.js";
import type {
  CommittedImportedProjectRecord,
} from "./committed-import-project-store.js";

const NOW = "2026-07-30T05:00:00.000Z";
const REVISION = "a".repeat(40);
const HASH = `sha256:${"b".repeat(64)}` as const;
const JOB_ID = ImportJobIdSchema.parse(
  "imp_01J00000000000000000000000",
);
const PROJECT_ID = ProjectIdSchema.parse(
  "prj_01J00000000000000000000000",
);
const directories: string[] = [];

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), label));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function repositoryInspection(): ImportRepositoryInspection {
  return {
    authority: {
      rootPath: "/tmp/read-only-product",
      sourceRevision: REVISION,
      dirtyFingerprint: HASH,
      managedWorktreeId: null,
      managedRootPath: "/tmp/managed",
    },
    manifest: {
      schemaVersion: 1,
      repository: {
        revision: REVISION,
        dirtyFileFingerprint: HASH,
      },
      budgets: {
        maxEntries: 32,
        maxFileBytes: 32_768,
        maxTotalBytes: 262_144,
        maxDepth: 12,
      },
      entries: [
        {
          path: "package.json",
          content: JSON.stringify({
            name: "product",
            scripts: { dev: "vite" },
            dependencies: { react: "19.0.0" },
          }),
        },
        {
          path: "src/pages/index.tsx",
          content: "export default function Home() { return <main /> }",
        },
      ],
    },
    snapshotExclusions: {
      schemaVersion: 1,
      entries: [],
      fingerprint: HASH,
      policyFingerprint: HASH,
    },
  };
}

function artifact(scenario: CaptureScenarioV2) {
  return CaptureArtifactSchemaV2.parse({
    id: "art_01J00000000000000000000000",
    scenarioId: scenario.id,
    screenshotArtifactId: "art_01J00000000000000000000001",
    hierarchyArtifactId: "art_01J00000000000000000000002",
    geometryArtifactId: "art_01J00000000000000000000003",
    screenshotHash: HASH,
    sourceRevision: REVISION,
    fixtureFingerprint: HASH,
    dimensions: {
      width: scenario.viewport.width,
      height: scenario.viewport.height,
      scale: scenario.viewport.scale,
    },
    verification: {
      stableFrameHash: HASH,
      routeMatched: true,
      blankRejected: true,
      splashRejected: true,
      errorBoundaryRejected: true,
      verifiedAt: NOW,
    },
  });
}

function adapterFixture(options: {
  readonly capture?: (
    scenario: CaptureScenarioV2,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly prepare?: (
    application: ImportApplicationV2,
    signal: AbortSignal,
  ) => Promise<void>;
} = {}): CaptureAdapterV1 {
  let scenario: CaptureScenarioV2 | null = null;
  return {
    metadata: {
      id: "react-web-test",
      platform: "react-web",
      version: "1",
      capabilities: [
        "discover",
        "prepare",
        "launch",
        "capture",
        "collect",
        "cleanup",
      ],
    },
    discover: vi.fn(async ({ job }) => job.applications),
    prepare: vi.fn(async (context, application) => {
      await options.prepare?.(application, context.signal);
      return {
        id: "prepared",
        application,
        repository: {
          rootPath: "/tmp/read-only-product",
          sourceRevision: REVISION,
          dirtyFingerprint: HASH,
        },
      };
    }),
    launch: vi.fn(async () => ({
      id: "launched",
      preparationId: "prepared",
    })),
    capture: vi.fn(async ({ signal }, _launch, nextScenario) => {
      scenario = nextScenario;
      await options.capture?.(nextScenario, signal);
      return { id: "raw", scenarioId: nextScenario.id };
    }),
    collect: vi.fn(async () => {
      if (scenario === null) {
        throw new Error("No captured scenario.");
      }
      return artifact(scenario);
    }),
    cleanup: vi.fn(async () => undefined),
  };
}

function coordinator(
  adapter: CaptureAdapterV1,
  describeApproval: () => Promise<{
    readonly resolvedExecutable: string;
    readonly environmentFingerprint: `sha256:${string}`;
  }> = async () => ({
    resolvedExecutable: "/usr/local/bin/npm",
    environmentFingerprint: HASH,
  }),
  overrides: {
    readonly inspection?: ImportRepositoryInspection;
    readonly adapterFor?: ImportCoordinatorOptions["adapterFor"];
    readonly createScenarioId?: ImportCoordinatorOptions["createScenarioId"];
    readonly nativeDependencyPreparationFor?:
      ImportCoordinatorOptions["nativeDependencyPreparationFor"];
    readonly storageBudgetAuthority?: {
      acquireJobLock(input: {
        readonly jobId: string;
        readonly transientPaths: readonly string[];
      }): Promise<{
        readonly jobId: string;
        finalize(input: {
          readonly outcome: "succeeded" | "failed" | "cancelled";
          readonly artifactReferences: readonly unknown[];
        }): Promise<unknown>;
        release(): Promise<void>;
      }>;
      preflight(input: {
        readonly transientBytes?: number;
        readonly artifactBytes?: number;
        readonly sharedCacheBytes?: number;
        readonly artifactReferences: readonly unknown[];
      }): Promise<unknown>;
    };
    readonly storageBudgetEstimateFor?: (input: {
      readonly applicationCount: number;
      readonly scenarioCount: number;
    }) => {
      readonly transientBytes?: number;
      readonly artifactBytes?: number;
      readonly sharedCacheBytes?: number;
    };
    readonly now?: () => Date;
  } = {},
) {
  const directory = temporaryDirectory("memi-import-coordinator-");
  const store = new SqliteImportJobStore(join(directory, "runtime.sqlite"), {
    now: () => NOW,
  });
  const inspect = vi.fn(async () =>
    overrides.inspection ?? repositoryInspection());
  const plans = new Map<
    string,
    {
      inspection: ImportRepositoryInspection;
      approvals: readonly PlannedRecipeApproval[];
    }
  >();
  const planStore = {
    save: vi.fn(async (
      id: string,
      plan: ImportRepositoryInspection,
      approvals: readonly PlannedRecipeApproval[],
    ) => {
      plans.set(id, {
        inspection: structuredClone(plan),
        approvals: structuredClone(approvals),
      });
    }),
    get: vi.fn(async (id: string) => plans.get(id) ?? null),
    delete: vi.fn(async (id: string) => {
      plans.delete(id);
    }),
    purgeAll: vi.fn(async () => {
      const count = plans.size;
      plans.clear();
      return count;
    }),
  };
  const committedProjects = new Map<
    string,
    CommittedImportedProjectRecord
  >();
  const committedProjectStore = {
    save: vi.fn(async (record: CommittedImportedProjectRecord) => {
      committedProjects.set(record.projectId, structuredClone(record));
    }),
    get: vi.fn(async (projectId: string) =>
      committedProjects.get(projectId) ?? null,
    ),
    purgeAll: vi.fn(async () => {
      const count = committedProjects.size;
      committedProjects.clear();
      return count;
    }),
  };
  const defaultAdapterFor = vi.fn(
    (
      application: ImportApplicationV2,
      _unit: unknown,
      context: {
        readonly managedRootPath: string;
        readonly applicationRootPath: string;
      },
    ) => {
      expect(context).toEqual({
        managedRootPath: "/tmp/managed",
        applicationRootPath: "/tmp/managed",
        sourceApplicationRootPath: "/tmp/read-only-product",
        repositoryRevision: REVISION,
      });
      return application.platform === "react-web" ? adapter : null;
    },
  );
  const adapterFor = overrides.adapterFor ?? defaultAdapterFor;
  const purgeAuthority = {
    inspect: vi.fn(async () => undefined),
    beginPurge: vi.fn(async () => undefined),
    completePurge: vi.fn(async () => undefined),
    purgeRecoveryPending: vi.fn(async () => false),
    purgeArtifacts: vi.fn(async () => 2),
    purgeJobRecords: vi.fn(async () => 0),
    purgeManagedWorktrees: vi.fn(async () => 1),
    purgeSimulatorAuthority: vi.fn(async () => 1),
  };
  const artifactStore = {
    initialize: vi.fn(async () => undefined),
    listReferences: vi.fn(async (): Promise<readonly ArtifactReference[]> =>
      [
        {
          id: "art_01J00000000000000000000001",
          hash: HASH,
          extension: "png",
        },
        {
          id: "art_01J00000000000000000000002",
          hash: HASH,
          extension: "json",
        },
        {
          id: "art_01J00000000000000000000003",
          hash: HASH,
          extension: "json",
        },
      ],
    ),
  };
  const create = () =>
    new ImportCoordinator({
      store,
      planStore,
      committedProjectStore,
      artifactStore,
      repository: { inspect },
      adapterFor,
      approvalAuthority: {
        describe: vi.fn(describeApproval),
        createNonce: () => "approval-nonce-1",
        expiresAt: () => "2026-07-31T05:00:00.000Z",
      },
      ...(overrides.nativeDependencyPreparationFor === undefined
        ? {}
        : {
            nativeDependencyPreparationFor:
              overrides.nativeDependencyPreparationFor,
          }),
      createJobId: () => JOB_ID,
      createScenarioId:
        overrides.createScenarioId ??
        (() =>
          CaptureScenarioIdSchema.parse(
            "csc_01J00000000000000000000000",
          )),
      createProjectId: () => PROJECT_ID,
      purgeAuthority,
      ...(overrides.storageBudgetAuthority === undefined
        ? {}
        : {
            storageBudgetAuthority:
              overrides.storageBudgetAuthority as never,
          }),
      ...(overrides.storageBudgetEstimateFor === undefined
        ? {}
        : {
            storageBudgetEstimateFor:
              overrides.storageBudgetEstimateFor,
          }),
      now: overrides.now ?? (() => new Date(NOW)),
    });
  return {
    coordinator: create(),
    restart: create,
    inspect,
    store,
    planStore,
    committedProjectStore,
    artifactStore,
    purgeAuthority,
    adapterFor,
  };
}

describe("ImportCoordinator", () => {
  it("labels repository inspection failures as a retryable validation planning error", async () => {
    const fixture = coordinator(adapterFixture());
    fixture.inspect.mockRejectedValueOnce(
      new Error("The private managed snapshot could not be created."),
    );

    await expect(
      fixture.coordinator.plan({ repositoryPath: "/tmp/read-only-product" }),
    ).rejects.toMatchObject({
      name: "ImportPlanningError",
      stage: "validate",
      retryable: true,
    });
    fixture.store.close();
  });

  it("plans without execution and requires exact structured recipe approval", async () => {
    const adapter = adapterFixture();
    const fixture = coordinator(adapter);

    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    expect(plan.applications).toHaveLength(1);
    expect(plan.repository).not.toHaveProperty("managedRootPath");
    expect(plan.recipes).toEqual([
      expect.objectContaining({
        recipe: {
          executable: "npm",
          args: [
            "run",
            "dev",
            "--",
            "--host",
            "127.0.0.1",
            "--port",
            "{leasedPort}",
          ],
          cwd: ".",
          purpose: "launch",
        },
        hash: expect.stringMatching(/^sha256:/u),
      }),
    ]);
    expect(adapter.discover).not.toHaveBeenCalled();
    expect(fixture.adapterFor).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      {
        managedRootPath: "/tmp/managed",
        applicationRootPath: "/tmp/managed",
        sourceApplicationRootPath: "/tmp/read-only-product",
        repositoryRevision: REVISION,
      },
    );

    const failed = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: [],
    });
    expect(failed.state).toBe("failed");
    expect(failed.failures).toEqual([
      expect.objectContaining({
        code: "RECIPE_APPROVAL_REQUIRED",
        retryable: true,
      }),
    ]);
    expect(adapter.prepare).not.toHaveBeenCalled();
    fixture.store.close();
  });

  it("launches the initial Expo run with the approved dependency preparation", async () => {
    const managedRootPath = temporaryDirectory(
      "memi-import-native-approved-",
    );
    const toolRoot = temporaryDirectory("memi-import-native-tools-");
    mkdirSync(
      join(toolRoot, "lib", "node_modules", "npm", "bin"),
      { recursive: true },
    );
    mkdirSync(
      join(toolRoot, "lib", "node_modules", "npm", "lib"),
      { recursive: true },
    );
    mkdirSync(join(toolRoot, "bin"), { recursive: true });
    writeFileSync(
      join(managedRootPath, "package.json"),
      JSON.stringify({
        name: "expo-fixture",
        packageManager: "npm@10.9.2",
      }),
    );
    writeFileSync(
      join(managedRootPath, "package-lock.json"),
      JSON.stringify({
        name: "expo-fixture",
        lockfileVersion: 3,
        packages: {},
      }),
    );
    const nodeExecutable = join(toolRoot, "bin", "node");
    const npmExecutable = join(toolRoot, "bin", "npm");
    const npmCliExecutable = join(
      toolRoot,
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    writeFileSync(nodeExecutable, "#!/bin/sh\nexit 0\n");
    writeFileSync(npmCliExecutable, "require('../lib/cli.js')\n");
    writeFileSync(
      join(toolRoot, "lib", "node_modules", "npm", "lib", "cli.js"),
      "module.exports = () => undefined\n",
    );
    chmodSync(nodeExecutable, 0o700);
    chmodSync(npmCliExecutable, 0o700);
    symlinkSync(npmCliExecutable, npmExecutable);
    const applicationId = "app_fa3727d2fb5054e954c42545";
    const unit = {
      applicationId,
      platform: "expo-ios",
      root: ".",
      displayName: "Expo fixture",
      status: "supported",
      pipelineStages: [],
      manifestPaths: ["package.json", "package-lock.json"],
      buildRecipe: {
        executable: "npm",
        args: ["run", "ios"],
        cwd: ".",
        purpose: "build",
      },
      routes: [{
        routeId: "rte_0af4856e2ad60ecea90bea69",
        path: "/",
        displayName: "Home",
        sourcePath: "app/index.tsx",
        navigation: "deep-link",
        parameters: [],
      }],
      scenarios: [{
        scenarioId: "scn_36b3e045ed8c5975e6aaf7b9",
        applicationId,
        routeId: "rte_0af4856e2ad60ecea90bea69",
        routePath: "/",
        state: "default",
        viewport: {
          name: "iphone",
          width: 393,
          height: 852,
          scale: 3,
        },
        authContext: "public",
        readiness: {
          strategy: "two-stable-frames",
          stableFrames: 2,
          rejectBlank: true,
          rejectSplash: true,
          rejectErrorBoundary: true,
        },
        fixture: {
          status: "not-required",
          parameterNames: [],
        },
      }],
      cacheKey: HASH,
      errors: [],
    } as never;
    const inspection = {
      ...repositoryInspection(),
      authority: {
        ...repositoryInspection().authority,
        managedRootPath,
      },
      applications: [unit],
    } satisfies ImportRepositoryInspection;
    const adapter = {
      ...adapterFixture(),
      metadata: {
        id: "maestro-expo-ios",
        platform: "expo-ios",
        version: "1.0.0",
        capabilities: [
          "discover",
          "prepare",
          "launch",
          "capture",
          "collect",
          "cleanup",
        ],
      },
    } as CaptureAdapterV1;
    const executionContexts: unknown[] = [];
    const adapterFor = vi.fn((
      _application,
      _unit,
      context,
    ) => {
      executionContexts.push(context);
      return adapter;
    });
    const fixture = coordinator(
      adapter,
      async () => ({
        resolvedExecutable: nodeExecutable,
        environmentFingerprint: HASH,
      }),
      {
        inspection,
        adapterFor,
        nativeDependencyPreparationFor: async ({
          context,
          adapter: plannedAdapter,
        }) => ({
          managedWorktreeRoot: context.managedRootPath,
          platformRoot: context.applicationRootPath,
          repositoryRevision: context.repositoryRevision!,
          adapterVersion: plannedAdapter.metadata.version,
          nodeExecutable,
          npmExecutable,
          policy: {
            contract: "memi.native-dependency-preparation-policy.v1",
            network: "locked-dependency-downloads",
            npmLifecycleScripts: "disabled",
            cocoapodsHooks: "enabled",
            requireLockfiles: true,
            sandboxProfileFingerprint: HASH,
          },
        }),
      },
    );
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const approvedDependencyPreparations =
      plan.dependencyPreparations.map((preparation) => ({
        ...preparation,
        approval: approveNativeDependencyPreparationPlan(
          preparation.plan,
          {
            approvedFingerprint: preparation.plan.fingerprint,
            approvedBy: "human:repository-import",
            approvedAt: NOW,
          },
        ),
      }));

    await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Expo fixture",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
      approvedDependencyPreparations,
    });
    await fixture.coordinator.waitForIdle(JOB_ID);

    expect(executionContexts.at(-1)).toMatchObject({
      repositoryRevision: REVISION,
      dependencyPreparation: {
        plan: {
          fingerprint:
            approvedDependencyPreparations[0]?.plan.fingerprint,
        },
        approval: approvedDependencyPreparations[0]?.approval,
      },
    });
    fixture.store.close();
  });

  it("captures every scenario and commits only after verified terminal evidence", async () => {
    const adapter = adapterFixture();
    const fixture = coordinator(adapter);
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    expect(started.state).toBe("running");
    expect(started.repository).toEqual({
      rootPath: "/tmp/read-only-product",
      sourceRevision: REVISION,
      dirtyFingerprint: HASH,
    });
    expect(started.repository).not.toHaveProperty(
      "managedRootPath",
    );

    const ready = await fixture.coordinator.waitForIdle(started.id);
    expect(ready).toMatchObject({
      state: "ready-to-commit",
      stage: "save",
      progress: { total: 1, captured: 1, failed: 0, remaining: 0 },
    });
    expect(ready.artifacts).toHaveLength(1);

    const committed = await fixture.coordinator.commit({
      jobId: ready.id,
      expectedRevision: ready.revision,
    });
    expect(committed).toMatchObject({
      projectId: PROJECT_ID,
      state: "committed",
    });
    await expect(
      fixture.committedProjectStore.get(PROJECT_ID),
    ).resolves.toMatchObject({
      projectId: PROJECT_ID,
      harnessId: "deterministic-import",
      manifest: {
        projectName: "Product",
        rootPath: "/tmp/read-only-product",
        revision: REVISION,
        dirty: true,
        inventory: {
          fileCount: 2,
          screenCount: 1,
          componentCount: 0,
          tokenCount: 0,
        },
        screens: [
          expect.objectContaining({
            name: "Home",
            route: "/",
            sourcePath: "src/pages/index.tsx",
          }),
        ],
      },
      capture: {
        job: expect.objectContaining({
          id: JOB_ID,
          projectId: PROJECT_ID,
          state: "committed",
        }),
        artifacts: [
          expect.objectContaining({
            screenshot: expect.objectContaining({
              id: "art_01J00000000000000000000001",
            }),
            hierarchy: expect.objectContaining({
              id: "art_01J00000000000000000000002",
            }),
            geometry: expect.objectContaining({
              id: "art_01J00000000000000000000003",
            }),
          }),
        ],
      },
    });
    fixture.store.close();
  });

  it("commits verified evidence after its execution approval expires", async () => {
    let now = new Date(NOW);
    const fixture = coordinator(adapterFixture(), undefined, {
      now: () => now,
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    const ready = await fixture.coordinator.waitForIdle(started.id);
    now = new Date("2026-08-01T05:00:00.000Z");

    await expect(fixture.coordinator.commit({
      jobId: ready.id,
      expectedRevision: ready.revision,
    })).resolves.toMatchObject({
      projectId: PROJECT_ID,
      state: "committed",
    });
    fixture.store.close();
  });

  it("runs only a revision-bound pilot selection and never broadens it after restart", async () => {
    const baseInspection = repositoryInspection();
    const inspection = {
      ...baseInspection,
      manifest: {
        ...baseInspection.manifest,
        entries: [
          ...baseInspection.manifest.entries,
          {
            path: "src/pages/activity.tsx",
            content:
              "export default function Activity() { return <main /> }",
          },
        ],
      },
    } satisfies ImportRepositoryInspection;
    let attempts = 0;
    const capturedScenarioIds: string[] = [];
    let markStarted: (() => void) | undefined;
    const captureStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const adapter = adapterFixture({
      capture: async (_scenario, signal) => {
        attempts += 1;
        capturedScenarioIds.push(_scenario.id);
        if (attempts > 1) {
          return;
        }
        markStarted?.();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        });
      },
    });
    const fixture = coordinator(adapter, undefined, {
      createScenarioId: (_scenario, index) =>
        CaptureScenarioIdSchema.parse(
          `csc_01J0000000000000000000000${index}`,
        ),
      inspection,
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const selectedScenarioId = CaptureScenarioIdSchema.parse(
      "csc_01J00000000000000000000000",
    );
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Pilot Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
      pilotScenarioIds: [selectedScenarioId],
    });
    expect(started.pilotScope).toEqual({
      sourceRevision: REVISION,
      scenarioIds: [selectedScenarioId],
    });
    expect(started.scenarios.map(({ id }) => id)).toEqual([
      selectedScenarioId,
    ]);
    await captureStarted;
    const active = await fixture.coordinator.get(started.id);
    const paused = await fixture.coordinator.cancel({
      jobId: active.id,
      expectedRevision: active.revision,
    });
    await fixture.coordinator.waitForIdle(paused.id);

    const restarted = fixture.restart();
    const resumed = await restarted.resume({
      jobId: paused.id,
      expectedRevision: paused.revision,
    });
    const ready = await restarted.waitForIdle(resumed.id);

    expect(ready.progress).toEqual({
      captured: 1,
      failed: 0,
      remaining: 0,
      total: 1,
    });
    expect(adapter.capture).toHaveBeenCalledTimes(2);
    expect(capturedScenarioIds).toEqual([
      selectedScenarioId,
      selectedScenarioId,
    ]);
    fixture.store.close();
  });

  it("rejects duplicate and out-of-plan pilot scenario ids before creating a job", async () => {
    const fixture = coordinator(adapterFixture());
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const known = CaptureScenarioIdSchema.parse(
      "csc_01J00000000000000000000000",
    );
    const unknown = CaptureScenarioIdSchema.parse(
      "csc_01J00000000000000000000001",
    );
    const start = (pilotScenarioIds: readonly typeof known[]) =>
      fixture.coordinator.start({
        repositoryPath: "/tmp/read-only-product",
        projectName: "Invalid Pilot",
        selectedHarness: null,
        approvedRecipes: plan.recipes,
        pilotScenarioIds,
      });

    await expect(start([known, known])).rejects.toThrow(/unique/i);
    await expect(start([unknown])).rejects.toThrow(/approved plan/i);
    expect(await fixture.store.listAll()).toEqual([]);
    fixture.store.close();
  });

  it("preflights, locks, and finalizes storage around a committed import", async () => {
    const finalize = vi.fn(async () => ({}));
    const release = vi.fn(async () => undefined);
    const acquireJobLock = vi.fn(async ({ jobId }: { jobId: string }) => ({
      jobId,
      finalize,
      release,
    }));
    const preflight = vi.fn(async () => ({}));
    const storageBudgetEstimateFor = vi.fn(() => ({
      transientBytes: 12,
      artifactBytes: 8,
      sharedCacheBytes: 4,
    }));
    const fixture = coordinator(adapterFixture(), undefined, {
      storageBudgetAuthority: { acquireJobLock, preflight },
      storageBudgetEstimateFor,
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Budgeted Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });

    expect(storageBudgetEstimateFor).toHaveBeenCalledWith({
      applicationCount: 1,
      scenarioCount: 1,
    });
    expect(preflight).toHaveBeenCalledWith({
      transientBytes: 12,
      artifactBytes: 8,
      sharedCacheBytes: 4,
      jobId: started.id,
      artifactReferences: [],
    });
    expect(acquireJobLock).toHaveBeenCalledWith({
      jobId: started.id,
      transientPaths: ["/tmp/managed"],
    });
    expect(acquireJobLock.mock.invocationCallOrder[0]).toBeLessThan(
      preflight.mock.invocationCallOrder[0]!,
    );
    const ready = await fixture.coordinator.waitForIdle(started.id);
    expect(finalize).not.toHaveBeenCalled();

    await fixture.coordinator.commit({
      jobId: ready.id,
      expectedRevision: ready.revision,
    });
    expect(finalize).toHaveBeenCalledWith({
      outcome: "succeeded",
      artifactReferences: await fixture.artifactStore.listReferences(),
    });
    expect(release).not.toHaveBeenCalled();
    fixture.store.close();
  });

  it("releases resumable storage locks before an explicit full purge", async () => {
    const release = vi.fn(async () => undefined);
    const fixture = coordinator(adapterFixture(), undefined, {
      storageBudgetAuthority: {
        acquireJobLock: vi.fn(async ({ jobId }) => ({
          jobId,
          finalize: vi.fn(async () => ({})),
          release,
        })),
        preflight: vi.fn(async () => ({})),
      },
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Purgeable Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    await fixture.coordinator.waitForIdle(started.id);

    await expect(fixture.coordinator.purgeAll()).resolves.toMatchObject({
      complete: true,
    });
    expect(release).toHaveBeenCalledTimes(1);
    fixture.store.close();
  });

  it("discards a paused import through its revision fence and releases only its staging", async () => {
    let captureStarted: (() => void) | undefined;
    const startedCapture = new Promise<void>((resolve) => {
      captureStarted = resolve;
    });
    const finalize = vi.fn(async () => ({}));
    const adapter = adapterFixture({
      capture: async (_scenario, signal) => {
        captureStarted?.();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        });
      },
    });
    const fixture = coordinator(adapter, undefined, {
      storageBudgetAuthority: {
        acquireJobLock: vi.fn(async ({ jobId }) => ({
          jobId,
          finalize,
          release: vi.fn(async () => undefined),
        })),
        preflight: vi.fn(async () => ({})),
      },
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Discarded Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    await startedCapture;
    const active = await fixture.coordinator.get(started.id);
    const paused = await fixture.coordinator.cancel({
      jobId: active.id,
      expectedRevision: active.revision,
    });
    await fixture.coordinator.waitForIdle(paused.id);

    const discarded = await fixture.coordinator.discard({
      jobId: paused.id,
      expectedRevision: paused.revision,
    });

    expect(discarded.state).toBe("cancelled");
    expect(finalize).toHaveBeenCalledWith({
      outcome: "cancelled",
      artifactReferences: [],
    });
    expect(fixture.planStore.delete).toHaveBeenCalledWith(discarded.id);
    await expect(fixture.coordinator.get(discarded.id)).rejects.toThrow(
      /Unknown import job/u,
    );
    fixture.store.close();
  });

  it("retains one bounded retry checkpoint for a terminal capture failure", async () => {
    const finalize = vi.fn(async () => ({}));
    const fixture = coordinator(
      adapterFixture({
        prepare: async () => {
          throw new Error("Build preparation failed.");
        },
      }),
      undefined,
      {
        storageBudgetAuthority: {
          acquireJobLock: vi.fn(async ({ jobId }) => ({
            jobId,
            finalize,
            release: vi.fn(async () => undefined),
          })),
          preflight: vi.fn(async () => ({})),
        },
      },
    );
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Failed Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });

    await expect(fixture.coordinator.waitForIdle(started.id)).resolves
      .toMatchObject({ state: "failed" });
    expect(finalize).toHaveBeenCalledWith({
      outcome: "failed",
      artifactReferences: [],
    });
    fixture.store.close();
  });

  it("reacquires failed staging before discarding a terminal draft after restart", async () => {
    const finalize = vi.fn(async () => ({}));
    const acquireJobLock = vi.fn(async ({ jobId }: { jobId: string }) => ({
      jobId,
      finalize,
      release: vi.fn(async () => undefined),
    }));
    const fixture = coordinator(
      adapterFixture({
        prepare: async () => {
          throw new Error("Build preparation failed.");
        },
      }),
      undefined,
      {
        storageBudgetAuthority: {
          acquireJobLock,
          preflight: vi.fn(async () => ({})),
        },
      },
    );
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Discarded Failed Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    const failed = await fixture.coordinator.waitForIdle(started.id);
    expect(failed.state).toBe("failed");

    const restarted = fixture.restart();
    const discarded = await restarted.discard({
      jobId: failed.id,
      expectedRevision: failed.revision,
    });

    expect(discarded.state).toBe("cancelled");
    expect(acquireJobLock).toHaveBeenCalledTimes(2);
    expect(acquireJobLock).toHaveBeenLastCalledWith({
      jobId: failed.id,
      transientPaths: ["/tmp/managed"],
    });
    expect(finalize).toHaveBeenLastCalledWith({
      outcome: "cancelled",
      artifactReferences: [],
    });
    expect(fixture.planStore.delete).toHaveBeenCalledWith(failed.id);
    await expect(restarted.get(failed.id)).rejects.toThrow(
      /Unknown import job/u,
    );
    fixture.store.close();
  });

  it("terminalizes a storage preflight denial and removes its staging", async () => {
    const finalize = vi.fn(async () => ({}));
    const fixture = coordinator(adapterFixture(), undefined, {
      storageBudgetAuthority: {
        acquireJobLock: vi.fn(async ({ jobId }) => ({
          jobId,
          finalize,
          release: vi.fn(async () => undefined),
        })),
        preflight: vi.fn(async () => {
          throw new Error("15 GB free-space reserve is unavailable.");
        }),
      },
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });

    await expect(
      fixture.coordinator.start({
        repositoryPath: "/tmp/read-only-product",
        projectName: "Denied Product",
        selectedHarness: null,
        approvedRecipes: plan.recipes,
      }),
    ).resolves.toMatchObject({
      state: "failed",
      failures: [
        expect.objectContaining({ code: "STORAGE_PREFLIGHT_FAILED" }),
      ],
    });
    expect(finalize).toHaveBeenCalledWith({
      outcome: "cancelled",
      artifactReferences: [],
    });
    fixture.store.close();
  });

  it("preserves both storage preflight and cleanup failures for remediation", async () => {
    const fixture = coordinator(adapterFixture(), undefined, {
      storageBudgetAuthority: {
        acquireJobLock: vi.fn(async ({ jobId }) => ({
          jobId,
          finalize: vi.fn(async () => {
            throw new Error("Managed staging cleanup was blocked.");
          }),
          release: vi.fn(async () => undefined),
        })),
        preflight: vi.fn(async () => {
          throw new Error("15 GB free-space reserve is unavailable.");
        }),
      },
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });

    await expect(
      fixture.coordinator.start({
        repositoryPath: "/tmp/read-only-product",
        projectName: "Denied Product",
        selectedHarness: null,
        approvedRecipes: plan.recipes,
      }),
    ).resolves.toMatchObject({
      state: "failed",
      failures: [
        expect.objectContaining({
          code: "STORAGE_PREFLIGHT_FAILED",
          remediation:
            "Storage preflight failed: 15 GB free-space reserve is unavailable. Cleanup failed: Managed staging cleanup was blocked.",
        }),
      ],
    });
    fixture.store.close();
  });

  it("records an unresolved fixture as a terminal retryable failure while capturing verified scenarios", async () => {
    const baseInspection = repositoryInspection();
    const application = discoverCaptureApplications(
      baseInspection.manifest,
    ).applications[0]!;
    const unresolvedRoute = {
      ...application.routes[0]!,
      routeId: "rte_dynamic_fixture",
      path: "/games/:gameId",
      parameters: [{ name: "gameId", kind: "dynamic" as const }],
    } satisfies CaptureRoutePlan;
    const inspection = {
      ...baseInspection,
      applications: [{
        ...application,
        routes: [application.routes[0]!, unresolvedRoute],
        scenarios: [
          application.scenarios[0]!,
          {
            ...application.scenarios[0]!,
            scenarioId: "scn_dynamic_fixture",
            routeId: unresolvedRoute.routeId,
            routePath: unresolvedRoute.path,
            fixture: {
              status: "required" as const,
              parameterNames: ["gameId"],
            },
          },
        ],
      }],
    } satisfies ImportRepositoryInspection;
    const adapter = adapterFixture();
    const fixture = coordinator(adapter, undefined, {
      inspection,
      createScenarioId: (_scenario, index) =>
        CaptureScenarioIdSchema.parse(
          `csc_01J0000000000000000000000${index}`,
        ),
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });

    expect(plan.errors).toEqual([]);
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    const finished = await fixture.coordinator.waitForIdle(started.id);

    expect(adapter.capture).toHaveBeenCalledTimes(1);
    expect(finished.progress).toEqual({
      total: 2,
      captured: 1,
      failed: 1,
      remaining: 0,
    });
    expect(finished.failures).toEqual([
      expect.objectContaining({
        code: "FIXTURE_REQUIRED",
        retryable: true,
        stage: "prepare-fixtures",
      }),
    ]);
    fixture.store.close();
  });

  it("reuses one production adapter for every scenario in an application flow", async () => {
    const baseInspection = repositoryInspection();
    const inspection = {
      ...baseInspection,
      manifest: {
        ...baseInspection.manifest,
        entries: [
          ...baseInspection.manifest.entries,
          {
            path: "src/pages/activity.tsx",
            content:
              "export default function Activity() { return <main /> }",
          },
        ],
      },
    } satisfies ImportRepositoryInspection;
    const adapter = adapterFixture();
    const adapterFor = vi.fn(() => adapter);
    const fixture = coordinator(adapter, undefined, {
      adapterFor,
      createScenarioId: (_scenario, index) =>
        CaptureScenarioIdSchema.parse(
          `csc_01J0000000000000000000000${index}`,
        ),
      inspection,
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });

    adapterFor.mockClear();
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    const finished = await fixture.coordinator.waitForIdle(started.id);

    expect(finished.progress).toMatchObject({ captured: 2, failed: 0 });
    expect(adapterFor).toHaveBeenCalledTimes(1);
    fixture.store.close();
  });

  it("terminalizes one application setup blocker per scenario and retries the whole flow", async () => {
    const baseInspection = repositoryInspection();
    const inspection = {
      ...baseInspection,
      manifest: {
        ...baseInspection.manifest,
        entries: [
          ...baseInspection.manifest.entries,
          {
            path: "src/pages/activity.tsx",
            content:
              "export default function Activity() { return <main /> }",
          },
        ],
      },
    } satisfies ImportRepositoryInspection;
    let attempts = 0;
    const adapter = adapterFixture({
      prepare: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Locked dependency preparation failed.");
        }
      },
    });
    const fixture = coordinator(adapter, undefined, {
      createScenarioId: (_scenario, index) =>
        CaptureScenarioIdSchema.parse(
          `csc_01J0000000000000000000000${index}`,
        ),
      inspection,
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    const blocked = await fixture.coordinator.waitForIdle(started.id);

    expect(blocked).toMatchObject({
      state: "failed",
      progress: { captured: 0, failed: 2, remaining: 0, total: 2 },
    });
    expect(blocked.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
        code: "PREPARATION_FAILED",
        scenarioId: expect.stringMatching(/^csc_/u),
        stage: "prepare-fixtures",
        }),
      ]),
    );
    expect(blocked.failures).toHaveLength(2);
    expect(adapter.prepare).toHaveBeenCalledTimes(1);

    const retried = await fixture.coordinator.retryFailed({
      jobId: blocked.id,
      expectedRevision: blocked.revision,
    });
    const recovered = await fixture.coordinator.waitForIdle(retried.id);

    expect(recovered.progress).toMatchObject({
      captured: 2,
      failed: 0,
      remaining: 0,
      total: 2,
    });
    expect(recovered.failures).toHaveLength(0);
    fixture.store.close();
  });

  it("purges external Memi-owned resources before durable jobs, plans, and project bindings", async () => {
    const fixture = coordinator(adapterFixture());
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    const ready = await fixture.coordinator.waitForIdle(started.id);
    await fixture.coordinator.commit({
      jobId: ready.id,
      expectedRevision: ready.revision,
    });
    const planPurge = vi.spyOn(fixture.planStore, "purgeAll");
    const projectBindingPurge = vi.spyOn(
      fixture.committedProjectStore,
      "purgeAll",
    );
    const jobPurge = vi.spyOn(fixture.store, "purgeAll");

    await expect(fixture.coordinator.purgeAll()).resolves.toEqual({
      complete: true,
      counts: {
        artifacts: 2,
        jobs: 1,
        managedWorktrees: 1,
        pendingPlans: 0,
        plans: 0,
        projectBindings: 1,
        simulatorAuthorities: 1,
      },
      failures: [],
    });
    expect(fixture.purgeAuthority.inspect).toHaveBeenCalledTimes(1);
    expect(
      fixture.purgeAuthority.beginPurge.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.purgeAuthority.purgeSimulatorAuthority.mock.invocationCallOrder[0]!,
    );
    expect(
      fixture.purgeAuthority.purgeSimulatorAuthority.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.purgeAuthority.purgeManagedWorktrees.mock.invocationCallOrder[0]!,
    );
    expect(
      fixture.purgeAuthority.purgeManagedWorktrees.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.purgeAuthority.purgeArtifacts.mock.invocationCallOrder[0]!,
    );
    expect(
      fixture.purgeAuthority.purgeArtifacts.mock.invocationCallOrder[0],
    ).toBeLessThan(planPurge.mock.invocationCallOrder[0]!);
    expect(
      fixture.purgeAuthority.purgeJobRecords.mock.invocationCallOrder[0],
    ).toBeLessThan(planPurge.mock.invocationCallOrder[0]!);
    expect(planPurge.mock.invocationCallOrder[0]).toBeLessThan(
      projectBindingPurge.mock.invocationCallOrder[0]!,
    );
    expect(projectBindingPurge.mock.invocationCallOrder[0]).toBeLessThan(
      jobPurge.mock.invocationCallOrder[0]!,
    );
    expect(jobPurge.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.purgeAuthority.completePurge.mock.invocationCallOrder[0]!,
    );
    await expect(fixture.store.get(started.id)).resolves.toBeNull();
    await expect(
      fixture.committedProjectStore.get(PROJECT_ID),
    ).resolves.toBeNull();
    fixture.store.close();
  });

  it("fails closed and retains durable bindings when owned cleanup is incomplete", async () => {
    const fixture = coordinator(adapterFixture());
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    await fixture.coordinator.waitForIdle(started.id);
    fixture.purgeAuthority.purgeManagedWorktrees.mockRejectedValueOnce(
      new Error("locked"),
    );
    const planPurge = vi.spyOn(fixture.planStore, "purgeAll");
    const jobPurge = vi.spyOn(fixture.store, "purgeAll");

    await expect(fixture.coordinator.purgeAll()).resolves.toMatchObject({
      complete: false,
      counts: {
        artifacts: 2,
        jobs: 0,
        managedWorktrees: 0,
        plans: 0,
        projectBindings: 0,
        simulatorAuthorities: 1,
      },
      failures: [
        {
          category: "managed-worktrees",
          code: "WORKTREE_PURGE_FAILED",
          message: "Managed capture worktrees remain.",
        },
      ],
    });
    expect(planPurge).not.toHaveBeenCalled();
    expect(jobPurge).not.toHaveBeenCalled();
    expect(fixture.purgeAuthority.completePurge).not.toHaveBeenCalled();
    await expect(fixture.store.get(started.id)).resolves.not.toBeNull();
    fixture.store.close();
  });

  it("fails before destructive work when the durable purge marker cannot be established", async () => {
    const fixture = coordinator(adapterFixture());
    fixture.purgeAuthority.beginPurge.mockRejectedValueOnce(
      new Error("marker unavailable"),
    );

    await expect(fixture.coordinator.purgeAll()).resolves.toMatchObject({
      complete: false,
      failures: [{
        category: "authority",
        code: "PURGE_MARKER_WRITE_FAILED",
      }],
    });
    expect(fixture.purgeAuthority.purgeSimulatorAuthority)
      .not.toHaveBeenCalled();
    expect(fixture.purgeAuthority.purgeManagedWorktrees)
      .not.toHaveBeenCalled();
    expect(fixture.purgeAuthority.completePurge).not.toHaveBeenCalled();
    fixture.store.close();
  });

  it("retains the marker and reports incomplete when marker clearing fails", async () => {
    const fixture = coordinator(adapterFixture());
    const jobPurge = vi.spyOn(fixture.store, "purgeAll");
    fixture.purgeAuthority.completePurge.mockRejectedValueOnce(
      new Error("marker locked"),
    );

    await expect(fixture.coordinator.purgeAll()).resolves.toMatchObject({
      complete: false,
      failures: [{
        category: "authority",
        code: "PURGE_MARKER_CLEAR_FAILED",
      }],
    });
    expect(jobPurge).toHaveBeenCalledTimes(1);
    fixture.store.close();
  });

  it("does not mutate any owned resource when purge preflight fails", async () => {
    const fixture = coordinator(adapterFixture());
    fixture.purgeAuthority.inspect.mockRejectedValueOnce(
      new Error("symlinked app data"),
    );
    const planPurge = vi.spyOn(fixture.planStore, "purgeAll");
    const jobPurge = vi.spyOn(fixture.store, "purgeAll");

    await expect(fixture.coordinator.purgeAll()).resolves.toEqual({
      complete: false,
      counts: {
        artifacts: 0,
        jobs: 0,
        managedWorktrees: 0,
        pendingPlans: 0,
        plans: 0,
        projectBindings: 0,
        simulatorAuthorities: 0,
      },
      failures: [
        {
          category: "authority",
          code: "PURGE_PREFLIGHT_FAILED",
          message: "Memi-owned purge targets could not be validated.",
        },
      ],
    });
    expect(fixture.purgeAuthority.purgeSimulatorAuthority)
      .not.toHaveBeenCalled();
    expect(fixture.purgeAuthority.purgeManagedWorktrees)
      .not.toHaveBeenCalled();
    expect(fixture.purgeAuthority.purgeArtifacts).not.toHaveBeenCalled();
    expect(fixture.purgeAuthority.purgeJobRecords).not.toHaveBeenCalled();
    expect(planPurge).not.toHaveBeenCalled();
    expect(jobPurge).not.toHaveBeenCalled();
    fixture.store.close();
  });

  it("revalidates executable and environment authority immediately before execution", async () => {
    let environmentFingerprint = HASH;
    const adapter = adapterFixture();
    const fixture = coordinator(adapter, async () => ({
      resolvedExecutable: "/usr/local/bin/npm",
      environmentFingerprint,
    }));
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    environmentFingerprint = `sha256:${"c".repeat(64)}`;
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    const finished = await fixture.coordinator.waitForIdle(started.id);
    expect(finished).toMatchObject({
      artifacts: [],
      progress: {
        captured: 0,
        failed: 1,
        remaining: 0,
        total: 1,
      },
      projectId: null,
      state: "failed",
    });
    expect(finished.failures).toEqual([
      expect.objectContaining({
        code: "RECIPE_AUTHORITY_CHANGED",
        retryable: true,
        scenarioId: expect.stringMatching(/^csc_/u),
        stage: "launch",
      }),
    ]);
    await expect(fixture.coordinator.commit({
      jobId: finished.id,
      expectedRevision: finished.revision,
    })).rejects.toThrow(/cannot commit/i);
    expect(adapter.prepare).not.toHaveBeenCalled();
    fixture.store.close();
  });

  it("aborts active work durably and resumes only the remaining scenario", async () => {
    let attempt = 0;
    let markStarted: (() => void) | undefined;
    const captureStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const adapter = adapterFixture({
      capture: async (_scenario, signal) => {
        attempt += 1;
        if (attempt > 1) {
          return;
        }
        markStarted?.();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        });
      },
    });
    const fixture = coordinator(adapter);
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    await captureStarted;
    const active = await fixture.coordinator.get(started.id);
    const paused = await fixture.coordinator.cancel({
      jobId: active.id,
      expectedRevision: active.revision,
    });
    expect(paused.state).toBe("paused");
    expect(paused.artifacts).toHaveLength(0);
    await fixture.coordinator.waitForIdle(paused.id);

    const restarted = fixture.restart();
    const resumed = await restarted.resume({
      jobId: paused.id,
      expectedRevision: paused.revision,
    });
    expect(resumed.state).toBe("running");
    const ready = await restarted.waitForIdle(resumed.id);
    expect(ready.progress).toEqual({
      total: 1,
      captured: 1,
      failed: 0,
      remaining: 0,
    });
    expect(attempt).toBe(2);
    fixture.store.close();
  });

  it("reacquires storage authority for a ready import after restart", async () => {
    const acquireJobLock = vi.fn(async ({ jobId }: { jobId: string }) => ({
      jobId,
      finalize: vi.fn(async () => ({})),
      release: vi.fn(async () => undefined),
    }));
    const fixture = coordinator(adapterFixture(), undefined, {
      storageBudgetAuthority: {
        acquireJobLock,
        preflight: vi.fn(async () => ({})),
      },
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Recoverable Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    await fixture.coordinator.waitForIdle(started.id);

    const restarted = fixture.restart();
    await restarted.recoverInterrupted();

    expect(acquireJobLock).toHaveBeenCalledTimes(2);
    expect(acquireJobLock).toHaveBeenLastCalledWith({
      jobId: started.id,
      transientPaths: ["/tmp/managed"],
    });
    fixture.store.close();
  });

  it("holds paused drafts for cleanup after restart without reserving their next capture", async () => {
    let attempt = 0;
    let markStarted: (() => void) | undefined;
    const captureStarted = new Promise<void>((resolvePromise) => {
      markStarted = resolvePromise;
    });
    const release = vi.fn(async () => undefined);
    const acquireJobLock = vi.fn(async ({ jobId }: { jobId: string }) => ({
      jobId,
      finalize: vi.fn(async () => ({})),
      release,
    }));
    const preflight = vi.fn(async () => ({}));
    const fixture = coordinator(adapterFixture({
      capture: async (_scenario, signal) => {
        attempt += 1;
        if (attempt > 1) return;
        markStarted?.();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        });
      },
    }), undefined, {
      storageBudgetAuthority: { acquireJobLock, preflight },
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Recoverable Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    await captureStarted;
    const active = await fixture.coordinator.get(started.id);
    const paused = await fixture.coordinator.cancel({
      jobId: active.id,
      expectedRevision: active.revision,
    });
    await fixture.coordinator.waitForIdle(paused.id);

    const restarted = fixture.restart();
    await expect(restarted.recoverInterrupted()).resolves.toEqual([]);
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(acquireJobLock).toHaveBeenCalledTimes(2);

    const resumed = await restarted.resume({
      jobId: paused.id,
      expectedRevision: paused.revision,
    });
    await restarted.waitForIdle(resumed.id);

    expect(preflight).toHaveBeenCalledTimes(2);
    expect(acquireJobLock).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledTimes(1);
    fixture.store.close();
  });

  it("retries individually failed scenarios without discarding completed work", async () => {
    let attempt = 0;
    const adapter = adapterFixture({
      capture: async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error("route was not ready");
        }
      },
    });
    const fixture = coordinator(adapter);
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    const failed = await fixture.coordinator.waitForIdle(started.id);
    expect(failed.progress).toMatchObject({ captured: 0, failed: 1 });
    const failedScenario = failed.failures[0]?.scenarioId;
    expect(failedScenario).not.toBeNull();

    const retried = await fixture.coordinator.retryFailed({
      jobId: failed.id,
      expectedRevision: failed.revision,
      ...(failedScenario === null || failedScenario === undefined
        ? {}
        : { scenarioIds: [failedScenario] }),
    });
    const recovered = await fixture.coordinator.waitForIdle(retried.id);
    expect(recovered.progress).toEqual({
      total: 1,
      captured: 1,
      failed: 0,
      remaining: 0,
    });
    expect(recovered.failures).toHaveLength(0);
    fixture.store.close();
  });

  it("restores failed scenarios by their durable definition when regenerated ids differ", async () => {
    let attempt = 0;
    let generatedScenarioCount = 0;
    const fixture = coordinator(adapterFixture({
      capture: async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error("route was not ready");
        }
      },
    }), undefined, {
      createScenarioId: () => {
        generatedScenarioCount += 1;
        return CaptureScenarioIdSchema.parse(
          `csc_01J0000000000000000000000${generatedScenarioCount}`,
        );
      },
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    const failed = await fixture.coordinator.waitForIdle(started.id);

    const restarted = fixture.restart();
    const retried = await restarted.retryFailed({
      jobId: failed.id,
      expectedRevision: failed.revision,
    });
    const recovered = await restarted.waitForIdle(retried.id);

    expect(recovered.state).toBe("ready-to-commit");
    expect(recovered.progress).toMatchObject({ captured: 1, failed: 0 });
    expect(generatedScenarioCount).toBeGreaterThan(1);
    fixture.store.close();
  });

  it("fails unsupported repositories before execution and rejects unknown jobs", async () => {
    const adapter = adapterFixture();
    const fixture = coordinator(adapter);
    fixture.inspect.mockResolvedValueOnce({
      ...repositoryInspection(),
      manifest: {
        ...repositoryInspection().manifest,
        entries: [
          {
            path: "README.md",
            content: "# unsupported",
          },
        ],
      },
    });

    const rejected = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Unsupported",
      selectedHarness: null,
      approvedRecipes: [],
    });

    expect(rejected.state).toBe("failed");
    expect(rejected.failures[0]).toMatchObject({
      scenarioId: null,
      stage: "plan",
    });
    expect(adapter.prepare).not.toHaveBeenCalled();
    await expect(
      fixture.coordinator.get(
        ImportJobIdSchema.parse(
          "imp_01J00000000000000000000001",
        ),
      ),
    ).rejects.toThrow(/Unknown import job/u);
    fixture.store.close();
  });

  it("fails closed when a paused job loses its durable execution plan", async () => {
    let markStarted: (() => void) | undefined;
    const captureStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const adapter = adapterFixture({
      capture: async (_scenario, signal) => {
        markStarted?.();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        });
      },
    });
    const fixture = coordinator(adapter);
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    await captureStarted;
    const active = await fixture.coordinator.get(started.id);
    const paused = await fixture.coordinator.cancel({
      jobId: active.id,
      expectedRevision: active.revision,
    });
    await fixture.coordinator.waitForIdle(paused.id);
    await fixture.planStore.delete(paused.id);

    const restarted = fixture.restart();
    const resumed = await restarted.resume({
      jobId: paused.id,
      expectedRevision: paused.revision,
    });
    const failed = await restarted.waitForIdle(resumed.id);

    expect(failed.state).toBe("failed");
    expect(failed.failures.at(-1)).toMatchObject({
      code: "IMPORT_COORDINATOR_FAILED",
      message: "The durable import execution plan is unavailable.",
    });
    fixture.store.close();
  });

  it("recovers running jobs after a process restart and retries the interrupted scenario", async () => {
    let attempt = 0;
    let markStarted: (() => void) | undefined;
    const captureStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const adapter = adapterFixture({
      capture: async (_scenario, signal) => {
        attempt += 1;
        if (attempt > 1) {
          return;
        }
        markStarted?.();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("interrupted")),
            { once: true },
          );
        });
      },
    });
    const fixture = coordinator(adapter);
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    await captureStarted;
    const active = await fixture.coordinator.get(started.id);
    const paused = await fixture.coordinator.cancel({
      jobId: active.id,
      expectedRevision: active.revision,
    });
    await fixture.coordinator.waitForIdle(paused.id);
    const simulatedInterrupted = await fixture.store.save(
      transitionImportJobV2(paused, {
        type: "resume",
        expectedRevision: paused.revision,
      }),
    );
    expect(simulatedInterrupted.state).toBe("running");

    const firstRestart = fixture.restart();
    const secondRestart = fixture.restart();
    const [firstRecovery, secondRecovery] = await Promise.all([
      firstRestart.recoverInterrupted(),
      secondRestart.recoverInterrupted(),
    ]);
    expect(
      firstRecovery.length + secondRecovery.length,
    ).toBe(1);
    const owner =
      firstRecovery.length === 1 ? firstRestart : secondRestart;
    const recovered = firstRecovery[0] ?? secondRecovery[0]!;
    const ready = await owner.waitForIdle(recovered.id);
    expect(ready.state).toBe("ready-to-commit");
    expect(ready.progress).toMatchObject({
      captured: 1,
      remaining: 0,
    });
    expect(attempt).toBe(2);
    fixture.store.close();
  });

  it("marks interrupted jobs with expired approvals terminal instead of blocking recovery", async () => {
    let now = new Date(NOW);
    let markStarted: (() => void) | undefined;
    const captureStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const adapter = adapterFixture({
      capture: async (_scenario, signal) => {
        markStarted?.();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("interrupted")),
            { once: true },
          );
        });
      },
    });
    const fixture = coordinator(adapter, undefined, {
      now: () => now,
    });
    const plan = await fixture.coordinator.plan({
      repositoryPath: "/tmp/read-only-product",
    });
    const started = await fixture.coordinator.start({
      repositoryPath: "/tmp/read-only-product",
      projectName: "Product",
      selectedHarness: null,
      approvedRecipes: plan.recipes,
    });
    await captureStarted;
    const active = await fixture.coordinator.get(started.id);
    const paused = await fixture.coordinator.cancel({
      jobId: active.id,
      expectedRevision: active.revision,
    });
    await fixture.coordinator.waitForIdle(paused.id);
    await fixture.store.save(
      transitionImportJobV2(paused, {
        type: "resume",
        expectedRevision: paused.revision,
      }),
    );
    now = new Date("2026-08-01T05:00:00.000Z");

    await expect(fixture.restart().recoverInterrupted()).resolves.toEqual([]);

    const failed = await fixture.coordinator.get(started.id);
    expect(failed).toMatchObject({ state: "failed" });
    expect(failed.failures.at(-1)).toMatchObject({
      code: "RECIPE_APPROVAL_EXPIRED",
      message: "The durable recipe approval authority is invalid or expired.",
      retryable: true,
    });
    fixture.store.close();
  });
});
