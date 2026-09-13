import { describe, expect, it, vi } from "vitest";
import {
  CaptureScenarioIdSchema,
  ImportJobSnapshotSchemaV2,
  ImportPlanTokenSchema,
} from "@memi/protocol";

import {
  createImportRuntimeService,
} from "./import-runtime-service.js";

const EMPTY_INVENTORY = {
  fileCount: 0,
  screenCount: 0,
  componentCount: 0,
  tokenCount: 0,
  screens: [],
  components: [],
  tokens: [],
  truncated: { screens: false, components: false, tokens: false },
} as const;
const DEPENDENCY_FINGERPRINT = `sha256:${"d".repeat(64)}` as const;
const dependencyPreparation = {
  applicationId: "app_ios",
  applicationLabel: "Native iOS",
  plan: {
    contract: "memi.native-dependency-preparation-plan.v1" as const,
    managedWorktreeRoot: "/tmp/managed",
    platformRoot: "/tmp/managed",
    repositoryRevision: "a".repeat(40),
    adapterVersion: "1",
    policy: {
      contract: "memi.native-dependency-preparation-policy.v1" as const,
      network: "locked-dependency-downloads" as const,
      npmLifecycleScripts: "disabled" as const,
      cocoapodsHooks: "enabled" as const,
      requireLockfiles: true as const,
      sandboxProfileFingerprint: `sha256:${"e".repeat(64)}`,
    },
    tools: [],
    manifests: [],
    lockfiles: [
      {
        relativePath: "package-lock.json",
        sha256: `sha256:${"f".repeat(64)}`,
        byteLength: 100,
      },
    ],
    commands: [
      {
        id: "npm-ci" as const,
        executable: "/usr/local/bin/node",
        args: ["/usr/local/lib/node_modules/npm/bin/npm-cli.js", "ci"],
        cwd: "/tmp/managed",
        lockfileRelativePaths: ["package-lock.json"],
        risk: {
          network: "downloads-lockfile-pinned-packages" as const,
          scripts: "npm-lifecycle-scripts-disabled" as const,
          writes: ["node_modules"],
        },
      },
    ],
    fingerprint: DEPENDENCY_FINGERPRINT,
    approval: {
      status: "pending" as const,
      requiresExplicitApproval: true as const,
    },
  },
} as const;

const listableJob = ImportJobSnapshotSchemaV2.parse({
  kind: "memi-import-job",
  id: "imp_01J00000000000000000000000",
  projectId: null,
  projectName: "Product",
  state: "failed",
  stage: "capture",
  repository: {
    rootPath: "/tmp/source",
    sourceRevision: "a".repeat(40),
    dirtyFingerprint: null,
  },
  managedWorktreeId: null,
  selectedHarness: null,
  pilotScope: null,
  applications: [],
  scenarios: [],
  artifacts: [],
  failures: [],
  progress: { total: 0, captured: 0, failed: 0, remaining: 0 },
  currentApplicationId: null,
  currentScenarioId: null,
  checkpoints: [],
  logs: [],
  cancellationRequestedAt: null,
  createdAt: "2026-07-30T05:00:00.000Z",
  revision: 3,
  updatedAt: "2026-07-30T05:00:00.000Z",
});

describe("import runtime service adapter", () => {
  const planToken = ImportPlanTokenSchema.parse(
    "ipl_01J00000000000000000000000",
  );
  it("returns protocol-ready plan and job envelopes", async () => {
    const plan = {
      repository: {
        rootPath: "/tmp/source",
        sourceRevision: null,
        dirtyFingerprint: null,
        managedWorktreeId: null,
      },
      recipes: [],
      applications: [],
      inventory: EMPTY_INVENTORY,
      scenarioCount: 0,
      errors: [],
    };
    const job = { id: "job" };
    const coordinator = {
      plan: vi.fn(async () => plan),
      list: vi.fn(async () => [listableJob]),
      start: vi.fn(async () => job),
      get: vi.fn(async () => job),
      cancel: vi.fn(async () => job),
      resume: vi.fn(async () => job),
      retryFailed: vi.fn(async () => job),
      commit: vi.fn(async () => job),
    };
    const service = createImportRuntimeService(coordinator as never, {
      createPlanToken: () =>
        planToken,
      now: () => new Date("2026-07-30T05:00:00.000Z"),
    });

    await expect(
      service.plan({ repositoryPath: "/tmp/source" }),
    ).resolves.toEqual({
      plan: {
        ...plan,
        token: planToken,
        repository: {
          rootPath: "/tmp/source",
          sourceRevision: null,
          dirtyFingerprint: null,
        },
        scenarios: [],
      },
    });
    await expect(
      service.start({
        planToken,
        repositoryPath: "/tmp/source",
        projectName: "Product",
        selectedHarness: null,
        approvedRecipeHashes: [],
      }),
    ).resolves.toEqual({ job });
    await expect(service.list()).resolves.toEqual({
      jobs: [{
        id: listableJob.id,
        projectId: listableJob.projectId,
        projectName: listableJob.projectName,
        state: listableJob.state,
        stage: listableJob.stage,
        sourceRevision: listableJob.repository.sourceRevision,
        progress: listableJob.progress,
        currentApplicationId: listableJob.currentApplicationId,
        currentScenarioId: listableJob.currentScenarioId,
        failureCount: listableJob.failures.length,
        revision: listableJob.revision,
        updatedAt: listableJob.updatedAt,
      }],
    });
    expect(coordinator.list).toHaveBeenCalledOnce();
    expect(coordinator.start).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ pilotScenarioIds: expect.anything() }),
    );
  });

  it("returns compact job lists while keeping full evidence behind get", async () => {
    const coordinator = {
      list: vi.fn(async () => [listableJob]),
    };
    const service = createImportRuntimeService(coordinator as never);

    await expect(service.list()).resolves.toEqual({
      jobs: [{
        id: listableJob.id,
        projectId: listableJob.projectId,
        projectName: listableJob.projectName,
        state: listableJob.state,
        stage: listableJob.stage,
        sourceRevision: listableJob.repository.sourceRevision,
        progress: listableJob.progress,
        currentApplicationId: listableJob.currentApplicationId,
        currentScenarioId: listableJob.currentScenarioId,
        failureCount: listableJob.failures.length,
        revision: listableJob.revision,
        updatedAt: listableJob.updatedAt,
      }],
    });
  });

  it("returns committed inventory from the durable project authority", async () => {
    const committedJob = ImportJobSnapshotSchemaV2.parse({
      ...listableJob,
      id: "imp_01J00000000000000000000001",
      projectId: "prj_01J00000000000000000000001",
      state: "committed",
      stage: "save",
      revision: 4,
    });
    const coordinator = { get: vi.fn(async () => committedJob) };
    const committedProjectStore = {
      get: vi.fn(async () => ({ manifest: { inventory: EMPTY_INVENTORY } })),
    };
    const service = createImportRuntimeService(coordinator as never, {
      committedProjectStore: committedProjectStore as never,
    });

    await expect(service.get({ jobId: committedJob.id })).resolves.toEqual({
      job: committedJob,
      inventory: EMPTY_INVENTORY,
    });
    expect(committedProjectStore.get).toHaveBeenCalledWith(
      committedJob.projectId,
    );
  });

  it("forwards the requested pilot IDs under the single-use plan authority", async () => {
    const pilotScenarioId = CaptureScenarioIdSchema.parse(
      "csc_01J00000000000000000000000",
    );
    const coordinator = {
      plan: vi.fn(async () => ({
        repository: {
          rootPath: "/tmp/source",
          sourceRevision: "a".repeat(40),
          dirtyFingerprint: `sha256:${"b".repeat(64)}`,
          managedWorktreeId: null,
        },
        applications: [],
        recipes: [],
        inventory: EMPTY_INVENTORY,
        scenarioCount: 1,
        errors: [],
      })),
      start: vi.fn(async () => ({ id: "job" })),
    };
    const service = createImportRuntimeService(coordinator as never, {
      createPlanToken: () => planToken,
      now: () => new Date("2026-07-30T05:00:00.000Z"),
    });
    await service.plan({ repositoryPath: "/tmp/source" });

    await service.start({
      approvedRecipeHashes: [],
      pilotScenarioIds: [pilotScenarioId],
      planToken,
      projectName: "Pilot",
      repositoryPath: "/tmp/source",
      selectedHarness: null,
    });

    expect(coordinator.start).toHaveBeenCalledWith(
      expect.objectContaining({ pilotScenarioIds: [pilotScenarioId] }),
    );
  });

  it("consumes opaque plan tokens and rejects hash-only replay", async () => {
    const hash = `sha256:${"a".repeat(64)}` as const;
    const coordinator = {
      plan: vi.fn(async () => ({
        repository: {
          rootPath: "/tmp/source",
          sourceRevision: "a".repeat(40),
          dirtyFingerprint: hash,
          managedWorktreeId: null,
        },
        applications: [],
        recipes: [
          {
            applicationId: "app_web",
            recipe: {
              executable: "npm" as const,
              args: ["run", "dev"],
              cwd: "/tmp/managed",
              purpose: "launch" as const,
            },
            hash,
            adapter: { id: "web", version: "1" },
            resolvedExecutable: "/usr/local/bin/npm",
            expiresAt: "2026-07-31T05:00:00.000Z",
          },
        ],
        dependencyPreparations: [dependencyPreparation],
        inventory: EMPTY_INVENTORY,
        scenarioCount: 1,
        errors: [],
      })),
      start: vi.fn(async () => ({ id: "job" })),
    };
    const service = createImportRuntimeService(coordinator as never, {
      createPlanToken: () =>
        planToken,
      now: () => new Date("2026-07-30T05:00:00.000Z"),
    });
    await service.plan({ repositoryPath: "/tmp/source" });

    await expect(
      service.start({
        planToken,
        repositoryPath: "/tmp/source",
        projectName: "Product",
        selectedHarness: null,
        approvedRecipeHashes: [],
      }),
    ).rejects.toThrow(/do not match/u);
    await expect(
      service.start({
        planToken,
        repositoryPath: "/tmp/source",
        projectName: "Product",
        selectedHarness: null,
        approvedRecipeHashes: [hash, DEPENDENCY_FINGERPRINT],
      }),
    ).rejects.toThrow(/consumed/u);
    expect(coordinator.start).not.toHaveBeenCalled();
  });

  it("requires one single-use approval set for dependency preparation and build recipes", async () => {
    const coordinator = {
      plan: vi.fn(async () => ({
        repository: {
          rootPath: "/tmp/source",
          sourceRevision: "a".repeat(40),
          dirtyFingerprint: `sha256:${"b".repeat(64)}`,
          managedWorktreeId: null,
        },
        applications: [],
        recipes: [],
        dependencyPreparations: [dependencyPreparation],
        inventory: EMPTY_INVENTORY,
        scenarioCount: 1,
        errors: [],
      })),
      start: vi.fn(async () => ({ id: "job" })),
    };
    const service = createImportRuntimeService(coordinator as never, {
      createPlanToken: () => planToken,
      now: () => new Date("2026-07-30T05:00:00.000Z"),
    });

    const result = await service.plan({ repositoryPath: "/tmp/source" });
    expect(result.plan.dependencyPreparations?.[0]).toMatchObject({
      applicationLabel: "Native iOS",
      planFingerprint: DEPENDENCY_FINGERPRINT,
    });
    await expect(
      service.start({
        planToken,
        repositoryPath: "/tmp/source",
        projectName: "Product",
        selectedHarness: null,
        approvedRecipeHashes: [],
      }),
    ).rejects.toThrow(/do not match/u);
    expect(coordinator.start).not.toHaveBeenCalled();
  });

  it("wraps all durable job mutations in protocol-ready envelopes", async () => {
    const job = { id: "job" };
    const coordinator = {
      get: vi.fn(async () => job),
      cancel: vi.fn(async () => job),
      discard: vi.fn(async () => job),
      resume: vi.fn(async () => job),
      retryFailed: vi.fn(async () => job),
      commit: vi.fn(async () => job),
    };
    const service = createImportRuntimeService(coordinator as never);
    const input = { jobId: "job", expectedRevision: 1 } as never;

    await expect(service.get(input)).resolves.toEqual({ job });
    await expect(service.cancel(input)).resolves.toEqual({ job });
    await expect(service.discard(input)).resolves.toEqual({ job });
    await expect(service.resume(input)).resolves.toEqual({ job });
    await expect(service.retryFailed(input)).resolves.toEqual({ job });
    await expect(service.commit(input)).resolves.toEqual({ job });
  });

  it("invalidates superseded, repository-mismatched, and expired plan tokens", async () => {
    const tokens = [
      planToken,
      ImportPlanTokenSchema.parse("ipl_01J00000000000000000000001"),
      ImportPlanTokenSchema.parse("ipl_01J00000000000000000000002"),
    ];
    let tokenIndex = 0;
    let now = new Date("2026-07-30T05:00:00.000Z");
    const coordinator = {
      plan: vi.fn(async () => ({
        repository: {
          rootPath: "/tmp/source",
          sourceRevision: null,
          dirtyFingerprint: null,
          managedWorktreeId: null,
        },
        applications: [],
        recipes: [],
        inventory: EMPTY_INVENTORY,
        scenarioCount: 0,
        errors: [],
      })),
      start: vi.fn(),
    };
    const service = createImportRuntimeService(coordinator as never, {
      createPlanToken: () => tokens[tokenIndex++]!,
      now: () => now,
    });
    await service.plan({ repositoryPath: "/tmp/source" });
    const replacement = await service.plan({
      repositoryPath: "/tmp/source",
    });

    await expect(
      service.start({
        planToken,
        repositoryPath: "/tmp/source",
        projectName: "Product",
        selectedHarness: null,
        approvedRecipeHashes: [],
      }),
    ).rejects.toThrow(/unknown, expired, consumed/u);
    await expect(
      service.start({
        planToken: replacement.plan.token,
        repositoryPath: "/tmp/another-source",
        projectName: "Product",
        selectedHarness: null,
        approvedRecipeHashes: [],
      }),
    ).rejects.toThrow(/another repository/u);

    const expiring = await service.plan({
      repositoryPath: "/tmp/source",
    });
    now = new Date("2026-07-30T05:01:01.000Z");
    await expect(
      service.start({
        planToken: expiring.plan.token,
        repositoryPath: "/tmp/source",
        projectName: "Product",
        selectedHarness: null,
        approvedRecipeHashes: [],
      }),
    ).rejects.toThrow(/expired/u);
    expect(coordinator.start).not.toHaveBeenCalled();
  });

  it("binds plan tokens to the inspected canonical repository root", async () => {
    const coordinator = {
      plan: vi.fn(async () => ({
        repository: {
          rootPath: "/canonical/source",
          sourceRevision: null,
          dirtyFingerprint: null,
          managedWorktreeId: null,
        },
        applications: [],
        recipes: [],
        inventory: EMPTY_INVENTORY,
        scenarioCount: 0,
        errors: [],
      })),
      start: vi.fn(async () => ({ id: "job" })),
    };
    const service = createImportRuntimeService(coordinator as never, {
      createPlanToken: () => planToken,
    });
    await service.plan({ repositoryPath: "/alias/source" });

    await expect(
      service.start({
        planToken,
        repositoryPath: "/canonical/source",
        projectName: "Product",
        selectedHarness: null,
        approvedRecipeHashes: [],
      }),
    ).resolves.toEqual({ job: { id: "job" } });
    expect(coordinator.start).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryPath: "/canonical/source",
      }),
    );
  });

  it("rejects duplicate token authority before replacing pending plans", async () => {
    const coordinator = {
      plan: vi.fn(async () => ({
        repository: {
          rootPath: "/tmp/source",
          sourceRevision: null,
          dirtyFingerprint: null,
          managedWorktreeId: null,
        },
        applications: [],
        recipes: [],
        inventory: EMPTY_INVENTORY,
        scenarioCount: 0,
        errors: [],
      })),
    };
    const service = createImportRuntimeService(coordinator as never, {
      createPlanToken: () => planToken,
    });
    await service.plan({ repositoryPath: "/tmp/first" });
    await expect(
      service.plan({ repositoryPath: "/tmp/second" }),
    ).rejects.toThrow(/token authority is invalid/u);
  });

  it("clears pending plan bindings only after a complete owned purge", async () => {
    const successful = {
      complete: true,
      counts: {
        artifacts: 0,
        jobs: 0,
        managedWorktrees: 1,
        pendingPlans: 0,
        plans: 0,
        projectBindings: 0,
        simulatorAuthorities: 0,
      },
      failures: [],
    } as const;
    const coordinator = {
      plan: vi.fn(async () => ({
        repository: {
          rootPath: "/tmp/source",
          sourceRevision: null,
          dirtyFingerprint: null,
          managedWorktreeId: null,
        },
        applications: [],
        recipes: [],
        inventory: EMPTY_INVENTORY,
        scenarioCount: 0,
        errors: [],
      })),
      purgeAll: vi.fn(async () => successful),
      start: vi.fn(),
    };
    const service = createImportRuntimeService(coordinator as never, {
      createPlanToken: () => planToken,
    });
    await service.plan({ repositoryPath: "/tmp/source" });

    await expect(service.purgeAll({})).resolves.toEqual({
      ...successful,
      counts: {
        ...successful.counts,
        pendingPlans: 1,
      },
    });
    await expect(
      service.start({
        planToken,
        repositoryPath: "/tmp/source",
        projectName: "Product",
        selectedHarness: null,
        approvedRecipeHashes: [],
      }),
    ).rejects.toThrow(/unknown, expired, consumed/u);
  });

  it("retains pending plan authority when owned purge is incomplete", async () => {
    const coordinator = {
      plan: vi.fn(async () => ({
        repository: {
          rootPath: "/tmp/source",
          sourceRevision: null,
          dirtyFingerprint: null,
          managedWorktreeId: null,
        },
        applications: [],
        recipes: [],
        inventory: EMPTY_INVENTORY,
        scenarioCount: 0,
        errors: [],
      })),
      purgeAll: vi.fn(async () => ({
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
            category: "managed-worktrees",
            code: "WORKTREE_PURGE_FAILED",
            message: "Managed capture worktrees remain.",
          },
        ],
      })),
      start: vi.fn(async () => ({ id: "job" })),
    };
    const service = createImportRuntimeService(coordinator as never, {
      createPlanToken: () => planToken,
    });
    await service.plan({ repositoryPath: "/tmp/source" });

    await expect(service.purgeAll({})).resolves.toMatchObject({
      complete: false,
      counts: { pendingPlans: 0 },
    });
    await expect(
      service.start({
        planToken,
        repositoryPath: "/tmp/source",
        projectName: "Product",
        selectedHarness: null,
        approvedRecipeHashes: [],
      }),
    ).resolves.toEqual({ job: { id: "job" } });
  });

  it("serializes purge callers and rejects new planning until pending authority is cleared", async () => {
    let finishPurge!: (value: {
      readonly complete: true;
      readonly counts: {
        readonly artifacts: 0;
        readonly jobs: 0;
        readonly managedWorktrees: 0;
        readonly pendingPlans: 0;
        readonly plans: 0;
        readonly projectBindings: 0;
        readonly simulatorAuthorities: 0;
      };
      readonly failures: readonly [];
    }) => void;
    const coordinator = {
      plan: vi.fn(async () => ({
        repository: {
          rootPath: "/tmp/source",
          sourceRevision: null,
          dirtyFingerprint: null,
          managedWorktreeId: null,
        },
        applications: [],
        recipes: [],
        inventory: EMPTY_INVENTORY,
        scenarioCount: 0,
        errors: [],
      })),
      purgeAll: vi.fn(
        () =>
          new Promise<Parameters<typeof finishPurge>[0]>(
            (resolve) => {
              finishPurge = resolve;
            },
          ),
      ),
    };
    const service = createImportRuntimeService(coordinator as never, {
      createPlanToken: () => planToken,
    });
    await service.plan({ repositoryPath: "/tmp/source" });

    const first = service.purgeAll({});
    const second = service.purgeAll({});
    await expect(
      service.plan({ repositoryPath: "/tmp/other-source" }),
    ).rejects.toThrow(/purge is in progress/u);
    finishPurge({
      complete: true,
      counts: {
        artifacts: 0,
        jobs: 0,
        managedWorktrees: 0,
        pendingPlans: 0,
        plans: 0,
        projectBindings: 0,
        simulatorAuthorities: 0,
      },
      failures: [],
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ counts: expect.objectContaining({
        pendingPlans: 1,
      }) }),
      expect.objectContaining({ counts: expect.objectContaining({
        pendingPlans: 1,
      }) }),
    ]);
    expect(coordinator.purgeAll).toHaveBeenCalledTimes(1);
    expect(coordinator.plan).toHaveBeenCalledTimes(1);
  });
});
