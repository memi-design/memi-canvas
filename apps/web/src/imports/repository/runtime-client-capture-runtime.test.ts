import { describe, expect, it, vi } from "vitest";
import {
  ImportJobSnapshotSchemaV2,
  ImportPlanResultSchemaV1,
  ImportPlanTokenSchema,
  RuntimeCaptureScreenV1Schema,
} from "@memi/protocol";

import { createRuntimeClientCaptureRuntime } from "./runtime-client-capture-runtime.js";
import { RepositoryReconstructionReviewSchema } from "./repository-reconstruction-review.js";

const now = "2026-07-29T12:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}` as const;

function job(
  state: "queued" | "running" | "ready-to-commit" | "committed",
  revision: number,
) {
  return ImportJobSnapshotSchemaV2.parse({
    applications: [
      {
        id: "northstar-web",
        label: "Northstar web",
        platform: "react-web",
        relativeRoot: ".",
      },
    ],
    artifacts: [
      {
        id: "art_01J00000000000000000000000",
        scenarioId: "csc_01J00000000000000000000000",
        screenshotArtifactId: "art_01J00000000000000000000001",
        hierarchyArtifactId: null,
        geometryArtifactId: null,
        reconstructionArtifactId:
          "art_01J00000000000000000000002",
        screenshotHash: hash,
        sourceRevision: "b".repeat(40),
        fixtureFingerprint: hash,
        dimensions: { width: 1280, height: 800, scale: 1 },
        verification: {
          stableFrameHash: hash,
          routeMatched: true,
          blankRejected: true,
          splashRejected: true,
          errorBoundaryRejected: true,
          verifiedAt: now,
        },
      },
    ],
    cancellationRequestedAt: null,
    checkpoints: [],
    createdAt: now,
    currentApplicationId: null,
    currentScenarioId: null,
    failures: [],
    id: "imp_01J00000000000000000000000",
    kind: "memi-import-job",
    logs: [],
    managedWorktreeId: null,
    progress: { captured: 1, failed: 0, remaining: 0, total: 1 },
    projectId:
      state === "committed"
        ? "prj_01J00000000000000000000000"
        : null,
    projectName: "Northstar",
    repository: {
      dirtyFingerprint: hash,
      rootPath: "/Projects/northstar",
      sourceRevision: "b".repeat(40),
    },
    revision,
    scenarios: [
      {
        applicationId: "northstar-web",
        authContext: null,
        fixtureProfile: "deterministic-local",
        id: "csc_01J00000000000000000000000",
        parameters: [],
        readinessSelector: "body",
        route: "/home",
        sourceAnchor: {
          contentHash: hash,
          relativePath: "src/pages/Home.tsx",
          symbol: "Home",
        },
        state: "default",
        viewport: {
          height: 800,
          name: "desktop",
          scale: 1,
          width: 1280,
        },
      },
    ],
    selectedHarness: { harnessId: "codex", modelId: "gpt-5.5" },
    stage: "save",
    state,
    updatedAt: now,
  });
}

const semanticCapture = RuntimeCaptureScreenV1Schema.parse({
  app: {
    appVersion: "1.0.0",
    buildRevision: "b".repeat(40),
    environment: "simulator",
    productId: "northstar",
  },
  artifact: {
    alt: "Northstar Home runtime capture",
    artifactId: "art_01J00000000000000000000001",
    hash,
    height: 800,
    kind: "image/png",
    src: "memi-artifact://localhost/art_01J00000000000000000000001",
    width: 1280,
  },
  authority: "local_capture",
  binding: {
    coverageCellId: "northstar-home-default",
    normalizedPath: "/home",
    routeId: "/home",
    sourceAnchor: "src/pages/Home.tsx#Home",
    sourceContentHash: hash,
    stateId: "default",
    viewport: { height: 800, name: "mobile", scale: 1, width: 1280 },
  },
  captureId: "art_01J00000000000000000000000",
  capturedAt: now,
  evidence: {
    captureMethod: "ios-simulator-screenshot",
    label: "Local capture",
    truthLabel: "Local capture",
  },
  layers: [
    {
      content: { text: "Welcome" },
      geometry: { height: 32, width: 180, x: 24, y: 80 },
      kind: "text",
      layerId: "home-title",
      name: "Welcome title",
      semanticKey: "home.title",
      source: {
        astPath: ["Home", "Text"],
        range: { end: 120, start: 92 },
        sourceAnchor: "src/pages/Home.tsx#Home",
        sourceContentHash: hash,
      },
      style: { fontSize: 24, textColor: "oklch(0.95 0 0)" },
      zIndex: 1,
    },
  ],
  repository: {
    dirty: true,
    dirtyFileFingerprint: hash,
    revision: "b".repeat(40),
    rootPath: "/Projects/northstar",
    sourceFingerprint: hash,
  },
  schemaVersion: 1,
  screenId: "home",
  screenName: "Home",
});

const verifiedReview = RepositoryReconstructionReviewSchema.parse({
  confidenceBySemanticKey: {
    "home.title": {
      basis: ["runtime-geometry", "source-anchor"],
      score: 0.98,
    },
  },
  fidelity: {
    diffArtifactId: "art_01J00000000000000000000003",
    evaluatedAt: now,
    maximumGeometryDelta: 0.25,
    ssim: 0.992,
    status: "verified",
  },
  schemaVersion: 1,
});

function allFailedJob() {
  const scenario = job("running", 1).scenarios[0]!;
  const scenarios = Array.from({ length: 71 }, (_, index) => ({
    ...scenario,
    id: `csc_${"0".repeat(24)}${String(index).padStart(2, "0")}`,
    route: `/screen-${index}`,
  }));
  const failures = scenarios.map((item, index) => ({
    code: index < 37 ? "PREPARATION_FAILED" : "FIXTURE_REQUIRED",
    logTail: [`failure evidence ${index}`],
    message:
      index < 37
        ? "Native command exited unsuccessfully (1)."
        : "The dynamic route has no deterministic fixture.",
    occurredAt: now,
    remediation:
      index < 37
        ? "Confirm the managed worktree and deterministic fixture recipe."
        : "Provide fixture parameters through the selected harness and retry this scenario.",
    retryable: true,
    scenarioId: item.id,
    stage: "prepare-fixtures",
  }));
  return ImportJobSnapshotSchemaV2.parse({
    ...job("running", 1),
    artifacts: [],
    failures,
    progress: {
      captured: 0,
      failed: 71,
      remaining: 0,
      total: 71,
    },
    revision: 2,
    scenarios,
    stage: "save",
    state: "failed",
  });
}

describe("runtime client repository capture adapter", () => {
  it("binds materialization to the canonical committed project identity", async () => {
    const inventory = ImportJobSnapshotSchemaV2.parse({
      ...job("running", 1),
      artifacts: [],
      progress: { captured: 0, failed: 0, remaining: 1, total: 1 },
      stage: "inventory",
    });
    const partial = ImportJobSnapshotSchemaV2.parse({
      ...job("running", 2),
      stage: "capture",
    });
    const ready = job("ready-to-commit", 3);
    const committed = job("committed", 4);
    const client = {
      imports: {
        plan: vi.fn(),
        start: vi.fn(async () => ({ job: inventory })),
        get: vi
          .fn()
          .mockResolvedValueOnce({ job: partial })
          .mockResolvedValueOnce({ job: ready }),
        commit: vi.fn(async () => ({ job: committed })),
        cancel: vi.fn(),
        resume: vi.fn(),
        retryFailed: vi.fn(),
      },
    };
    const materializations = vi.fn();
    const runtime = createRuntimeClientCaptureRuntime({
      client: client as never,
      delay: async () => undefined,
    });

    const result = await runtime.start({
      approvedRecipeHashes: [],
      manifest: {
        schemaVersion: 1,
        projectName: "Northstar",
        rootPath: "/Projects/northstar",
        revision: "b".repeat(40),
        platform: "react-web",
        dirty: true,
        files: [],
        screens: [],
        components: [],
        tokens: [],
      },
      onMaterialize: materializations,
      pilotScenarioIds: [
        job("running", 1).scenarios[0]!.id,
      ],
      planToken: ImportPlanTokenSchema.parse(
        "ipl_01J00000000000000000000000",
      ),
      projectName: "Northstar",
      onUpdate: vi.fn(),
    });

    expect(materializations.mock.calls.map(([update]) => ({
      added: update.addedArtifacts.length,
      sequence: update.sequence,
      state: update.state,
    }))).toEqual([
      { added: 0, sequence: 1, state: "importing" },
      { added: 1, sequence: 2, state: "importing" },
      { added: 0, sequence: 3, state: "importing" },
      { added: 0, sequence: 4, state: "ready" },
    ]);
    expect(new Set(materializations.mock.calls.map(([update]) =>
      update.projectId,
    ))).toEqual(new Set(["prj_01J00000000000000000000000"]));
    expect(result.projectId).toBe(result.job.projectId);
    expect(client.imports.start).toHaveBeenCalledWith(
      expect.objectContaining({
        pilotScenarioIds: ["csc_01J00000000000000000000000"],
      }),
    );
    expect(materializations.mock.calls[1]?.[0].addedArtifacts[0]).toMatchObject({
      artifact: { scenarioId: "csc_01J00000000000000000000000" },
      reference: {
        src: "/imports/artifacts/art_01J00000000000000000000001.png",
      },
    });
  });

  it("rejects a higher revision from a different durable job", async () => {
    const initial = ImportJobSnapshotSchemaV2.parse({
      ...job("running", 1),
      artifacts: [],
      progress: { captured: 0, failed: 0, remaining: 1, total: 1 },
    });
    const replaced = ImportJobSnapshotSchemaV2.parse({
      ...job("running", 2),
      id: "imp_01J00000000000000000000009",
    });
    const client = {
      imports: {
        plan: vi.fn(),
        start: vi.fn(async () => ({ job: initial })),
        get: vi.fn(async () => ({ job: replaced })),
        commit: vi.fn(),
        cancel: vi.fn(),
        resume: vi.fn(),
        retryFailed: vi.fn(),
      },
    };
    const runtime = createRuntimeClientCaptureRuntime({
      client: client as never,
      delay: async () => undefined,
    });

    await expect(runtime.start({
      approvedRecipeHashes: [],
      manifest: {
        schemaVersion: 1,
        projectName: "Northstar",
        rootPath: "/Projects/northstar",
        revision: "b".repeat(40),
        platform: "react-web",
        dirty: true,
        files: [],
        screens: [],
        components: [],
        tokens: [],
      },
      planToken: ImportPlanTokenSchema.parse(
        "ipl_01J00000000000000000000000",
      ),
      projectName: "Northstar",
      onUpdate: vi.fn(),
    })).rejects.toThrow(/changed job authority/iu);
    expect(client.imports.commit).not.toHaveBeenCalled();
  });

  it("rejects divergent payloads at the same durable revision", async () => {
    const initial = ImportJobSnapshotSchemaV2.parse({
      ...job("running", 1),
      artifacts: [],
      progress: { captured: 0, failed: 0, remaining: 1, total: 1 },
    });
    const divergent = ImportJobSnapshotSchemaV2.parse({
      ...initial,
      logs: [
        {
          level: "warning",
          message: "Divergent same-revision payload",
          occurredAt: now,
        },
      ],
    });
    const client = {
      imports: {
        plan: vi.fn(),
        start: vi.fn(async () => ({ job: initial })),
        get: vi
          .fn()
          .mockResolvedValueOnce({ job: divergent })
          .mockRejectedValueOnce(new Error("poll guard")),
        commit: vi.fn(),
        cancel: vi.fn(),
        resume: vi.fn(),
        retryFailed: vi.fn(),
      },
    };
    const runtime = createRuntimeClientCaptureRuntime({
      client: client as never,
      delay: async () => undefined,
    });

    await expect(runtime.start({
      approvedRecipeHashes: [],
      manifest: {
        schemaVersion: 1,
        projectName: "Northstar",
        rootPath: "/Projects/northstar",
        revision: "b".repeat(40),
        platform: "react-web",
        dirty: true,
        files: [],
        screens: [],
        components: [],
        tokens: [],
      },
      planToken: ImportPlanTokenSchema.parse(
        "ipl_01J00000000000000000000000",
      ),
      projectName: "Northstar",
      onUpdate: vi.fn(),
    })).rejects.toThrow(/same revision/iu);
  });

  it("attaches a validated semantic reconstruction artifact when available", async () => {
    const queued = job("queued", 1);
    const ready = job("ready-to-commit", 2);
    const committed = job("committed", 3);
    const loadReconstructionArtifact = vi.fn(async () => ({
      capture: semanticCapture,
      review: verifiedReview,
      schemaVersion: 1,
    }));
    const client = {
      imports: {
        plan: vi.fn(),
        start: vi.fn(async () => ({ job: queued })),
        get: vi.fn(async () => ({ job: ready })),
        commit: vi.fn(async () => ({ job: committed })),
        cancel: vi.fn(),
        resume: vi.fn(),
        retryFailed: vi.fn(),
      },
    };
    const runtime = createRuntimeClientCaptureRuntime({
      client: client as never,
      delay: async () => undefined,
      loadReconstructionArtifact,
    });

    const result = await runtime.start({
      approvedRecipeHashes: [],
      manifest: {
        schemaVersion: 1,
        projectName: "Northstar",
        rootPath: "/Projects/northstar",
        revision: "b".repeat(40),
        platform: "react-web",
        dirty: true,
        files: [],
        screens: [],
        components: [],
        tokens: [],
      },
      planToken: ImportPlanTokenSchema.parse(
        "ipl_01J00000000000000000000000",
      ),
      projectName: "Northstar",
      onUpdate: vi.fn(),
    });

    expect(loadReconstructionArtifact).toHaveBeenCalledWith(
      "art_01J00000000000000000000002",
    );
    expect(
      result.artifactReference(result.job.artifacts[0]!).reconstruction,
    ).toEqual(semanticCapture);
    expect(
      result.artifactReference(result.job.artifacts[0]!)
        .reconstructionReview,
    ).toEqual(verifiedReview);
  });

  it("fails closed when the runtime returns an older job revision", async () => {
    const newer = ImportJobSnapshotSchemaV2.parse({
      ...job("running", 4),
      artifacts: [],
      progress: { captured: 0, failed: 0, remaining: 1, total: 1 },
      stage: "inventory",
    });
    const stale = ImportJobSnapshotSchemaV2.parse({
      ...job("running", 3),
      stage: "capture",
    });
    const client = {
      imports: {
        plan: vi.fn(),
        start: vi.fn(async () => ({ job: newer })),
        get: vi.fn(async () => ({ job: stale })),
        commit: vi.fn(),
        cancel: vi.fn(),
        resume: vi.fn(),
        retryFailed: vi.fn(),
      },
    };
    const runtime = createRuntimeClientCaptureRuntime({
      client: client as never,
      delay: async () => undefined,
    });

    await expect(runtime.start({
      approvedRecipeHashes: [],
      manifest: {
        schemaVersion: 1,
        projectName: "Northstar",
        rootPath: "/Projects/northstar",
        revision: "b".repeat(40),
        platform: "react-web",
        dirty: true,
        files: [],
        screens: [],
        components: [],
        tokens: [],
      },
      planToken: ImportPlanTokenSchema.parse(
        "ipl_01J00000000000000000000000",
      ),
      projectName: "Northstar",
      onUpdate: vi.fn(),
    })).rejects.toThrow(/older job revision/iu);
    expect(client.imports.commit).not.toHaveBeenCalled();
  });

  it("plans, streams durable progress, commits, and exposes internal artifact identities", async () => {
    const plan = ImportPlanResultSchemaV1.parse({
      plan: {
        token: "ipl_01J00000000000000000000000",
        repository: {
          dirtyFingerprint: hash,
          rootPath: "/Projects/northstar",
          sourceRevision: "b".repeat(40),
        },
        applications: [],
        scenarios: [],
        recipes: [],
        inventory: {
          fileCount: 1,
          screenCount: 1,
          componentCount: 0,
          tokenCount: 0,
          screens: [
            {
              id: "northstar-home",
              name: "Home",
              route: "/",
              sourcePath: "src/pages/Home.tsx",
            },
          ],
          components: [],
          tokens: [],
          truncated: {
            screens: false,
            components: false,
            tokens: false,
          },
        },
        scenarioCount: 1,
        errors: [],
      },
    }).plan;
    const queued = job("queued", 1);
    const ready = job("ready-to-commit", 2);
    const committed = job("committed", 3);
    const client = {
      imports: {
        plan: vi.fn(async () => ({ plan })),
        start: vi.fn(async () => ({ job: queued })),
        get: vi.fn(async () => ({ job: ready })),
        commit: vi.fn(async () => ({ job: committed })),
        cancel: vi.fn(),
        resume: vi.fn(),
        retryFailed: vi.fn(),
      },
    };
    const updates = vi.fn();
    const runtime = createRuntimeClientCaptureRuntime({
      client: client as never,
      delay: async () => undefined,
    });

    expect(
      await runtime.plan("/Projects/northstar", {
        expoRuntime: "existing-development-client",
      }),
    ).toBe(plan);
    expect(client.imports.plan).toHaveBeenCalledWith({
      repositoryPath: "/Projects/northstar",
      expoRuntime: "existing-development-client",
    });
    const result = await runtime.start({
      approvedRecipeHashes: [],
      manifest: {
        schemaVersion: 1,
        projectName: "Northstar",
        rootPath: "/Projects/northstar",
        revision: "b".repeat(40),
        platform: "react-web",
        dirty: true,
        files: [],
        screens: [],
        components: [],
        tokens: [],
      },
      planToken: plan.token,
      projectName: "Northstar",
      onUpdate: updates,
    });

    expect(updates).toHaveBeenCalledTimes(3);
    expect(client.imports.start).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedHarness: null,
      }),
    );
    expect(result.job.state).toBe("committed");
    expect(result.artifactReference(result.job.artifacts[0]!)).toEqual({
      alt: "/home · default",
      capturedAt: now,
      sourceUrl: "memi-source://repository/src/pages/Home.tsx",
      src: "/imports/artifacts/art_01J00000000000000000000001.png",
    });
  });

  it("uses a durable native artifact URL without exposing a filesystem path", async () => {
    const queued = job("queued", 1);
    const ready = job("ready-to-commit", 2);
    const committed = job("committed", 3);
    const client = {
      imports: {
        plan: vi.fn(),
        start: vi.fn(async () => ({ job: queued })),
        get: vi.fn(async () => ({ job: ready })),
        commit: vi.fn(async () => ({ job: committed })),
        cancel: vi.fn(),
        resume: vi.fn(),
        retryFailed: vi.fn(),
      },
    };
    const runtime = createRuntimeClientCaptureRuntime({
      artifactUrl: (artifactId) =>
        `memi-artifact://localhost/${artifactId}`,
      client: client as never,
      delay: async () => undefined,
    });

    const result = await runtime.start({
      approvedRecipeHashes: [],
      manifest: {
        schemaVersion: 1,
        projectName: "Northstar",
        rootPath: "/Projects/northstar",
        revision: "b".repeat(40),
        platform: "react-web",
        dirty: true,
        files: [],
        screens: [],
        components: [],
        tokens: [],
      },
      planToken: ImportPlanTokenSchema.parse(
        "ipl_01J00000000000000000000000",
      ),
      projectName: "Northstar",
      onUpdate: vi.fn(),
    });

    expect(
      result.artifactReference(result.job.artifacts[0]!).src,
    ).toBe(
      "memi-artifact://localhost/art_01J00000000000000000000001",
    );
  });

  it("surfaces all 71 failures unchanged without committing or returning an empty project", async () => {
    const queued = job("queued", 1);
    const failed = allFailedJob();
    const client = {
      imports: {
        plan: vi.fn(),
        start: vi.fn(async () => ({ job: queued })),
        get: vi.fn(async () => ({ job: failed })),
        commit: vi.fn(),
        cancel: vi.fn(),
        resume: vi.fn(),
        retryFailed: vi.fn(),
      },
    };
    const updates = vi.fn();
    const runtime = createRuntimeClientCaptureRuntime({
      client: client as never,
      delay: async () => undefined,
    });

    await expect(runtime.start({
      approvedRecipeHashes: [],
      manifest: {
        schemaVersion: 1,
        projectName: "Northstar",
        rootPath: "/Projects/northstar",
        revision: "b".repeat(40),
        platform: "react-web",
        dirty: true,
        files: [],
        screens: [],
        components: [],
        tokens: [],
      },
      planToken: ImportPlanTokenSchema.parse(
        "ipl_01J00000000000000000000000",
      ),
      projectName: "Northstar",
      onUpdate: updates,
    })).rejects.toThrow(
      /FIXTURE_REQUIRED: The dynamic route has no deterministic fixture/iu,
    );

    expect(client.imports.commit).not.toHaveBeenCalled();
    expect(updates).toHaveBeenCalledTimes(2);
    expect(updates.mock.calls.at(-1)?.[0]).toEqual(failed);
    expect(failed.failures).toHaveLength(71);
    expect(failed.failures.every(({ retryable }) => retryable)).toBe(true);
    expect(failed.projectId).toBeNull();
  });
});
