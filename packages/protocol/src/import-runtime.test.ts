import { describe, expect, it } from "vitest";

import {
  CaptureArtifactSchemaV2,
  CaptureFailureSchemaV1,
  CaptureScenarioSchemaV2,
  ImportJobDraftSchemaV2,
  ImportJobIdSchema,
  ImportJobListItemSchemaV1,
  ImportJobSnapshotSchemaV2,
  projectIdForImportJob,
  RuntimeRpcRequestSchema,
  RuntimeRpcResponseSchema,
} from "./index.js";

const now = "2026-07-29T12:00:00.000Z";
const jobId = ImportJobIdSchema.parse(
  "imp_01J00000000000000000000000",
);
const planToken = "ipl_01J00000000000000000000000";
const scenarioId = "csc_01J00000000000000000000000";
const sourceRevision = "a".repeat(40);
const hash = `sha256:${"b".repeat(64)}`;

describe("import project identity", () => {
  it("derives one protocol project identity from the durable job identity", () => {
    expect(projectIdForImportJob(jobId)).toBe(
      "prj_01J00000000000000000000000",
    );
  });
});

const scenario = CaptureScenarioSchemaV2.parse({
  applicationId: "buzzr-ios",
  authContext: "signed-out",
  fixtureProfile: "deterministic-local",
  id: scenarioId,
  parameters: [],
  readinessSelector: "id=screen-ready",
  route: "/sign-in",
  sourceAnchor: {
    contentHash: hash,
    relativePath: "app/(auth)/sign-in.tsx",
    symbol: "SignInScreen",
  },
  state: "default",
  viewport: {
    height: 844,
    name: "iphone-15",
    scale: 3,
    width: 390,
  },
});

const artifact = CaptureArtifactSchemaV2.parse({
  geometryArtifactId: null,
  hierarchyArtifactId: "art_01J00000000000000000000001",
  id: "art_01J00000000000000000000000",
  scenarioId,
  screenshotArtifactId: "art_01J00000000000000000000000",
  screenshotHash: hash,
  sourceRevision,
  fixtureFingerprint: hash,
  dimensions: { height: 2532, scale: 3, width: 1170 },
  verification: {
    blankRejected: true,
    errorBoundaryRejected: true,
    routeMatched: true,
    splashRejected: true,
    stableFrameHash: hash,
    verifiedAt: now,
  },
});

const failure = CaptureFailureSchemaV1.parse({
  code: "READINESS_TIMEOUT",
  logTail: ["Waiting for id=screen-ready"],
  message: "The screen did not become ready.",
  occurredAt: now,
  remediation: "Verify the readiness selector and retry.",
  retryable: true,
  scenarioId,
  stage: "capture",
});

const draft = ImportJobDraftSchemaV2.parse({
  applications: [
    {
      id: "buzzr-ios",
      label: "Buzzr iOS",
      platform: "expo-ios",
      relativeRoot: ".",
    },
  ],
  artifacts: [artifact],
  cancellationRequestedAt: null,
  checkpoints: ["validate", "inventory", "plan"],
  createdAt: now,
  currentApplicationId: "buzzr-ios",
  currentScenarioId: scenarioId,
  failures: [],
  id: jobId,
  kind: "memi-import-job",
  logs: [
    {
      level: "info",
      message: "Captured /sign-in.",
      occurredAt: now,
    },
  ],
  managedWorktreeId: "wrk_01J00000000000000000000000",
  projectId: null,
  projectName: "Buzzr",
  progress: { captured: 1, failed: 0, remaining: 0, total: 1 },
  repository: {
    dirtyFingerprint: hash,
    rootPath: "/tmp/Buzzr",
    sourceRevision,
  },
  scenarios: [scenario],
  selectedHarness: null,
  stage: "verify",
  state: "ready-to-commit",
});

describe("truthful import runtime contracts", () => {
  it("keeps semantic reconstruction as a content artifact reference", () => {
    expect(artifact.reconstructionArtifactId).toBeNull();
    expect(
      CaptureArtifactSchemaV2.parse({
        ...artifact,
        reconstructionArtifactId:
          "art_01J00000000000000000000002",
      }).reconstructionArtifactId,
    ).toBe("art_01J00000000000000000000002");
    expect(JSON.stringify(artifact)).not.toContain("layers");
  });

  it("validates a bounded immutable job snapshot and terminal evidence", () => {
    const snapshot = ImportJobSnapshotSchemaV2.parse({
      ...draft,
      revision: 4,
      updatedAt: now,
    });

    expect(snapshot.progress).toEqual({
      captured: 1,
      failed: 0,
      remaining: 0,
      total: 1,
    });
    expect(snapshot.artifacts[0]?.screenshotHash).toBe(hash);
    expect(failure.retryable).toBe(true);
  });

  it("uses compact items for durable import lists instead of full capture payloads", () => {
    const item = ImportJobListItemSchemaV1.parse({
      id: jobId,
      projectId: null,
      projectName: "Buzzr",
      state: "ready-to-commit",
      stage: "verify",
      sourceRevision,
      progress: { captured: 1, failed: 0, remaining: 0, total: 1 },
      currentApplicationId: "buzzr-ios",
      currentScenarioId: scenarioId,
      failureCount: 0,
      revision: 4,
      updatedAt: now,
    });

    expect(item).not.toHaveProperty("artifacts");
    expect(JSON.stringify(item).length).toBeLessThan(
      JSON.stringify({ ...draft, revision: 4, updatedAt: now }).length,
    );
  });

  it("rejects progress or evidence that does not bind to known scenarios", () => {
    expect(() =>
      ImportJobDraftSchemaV2.parse({
        ...draft,
        artifacts: [{ ...artifact, scenarioId: "csc_unknown" }],
      }),
    ).toThrow();
    expect(() =>
      ImportJobDraftSchemaV2.parse({
        ...draft,
        progress: { captured: 1, failed: 1, remaining: 0, total: 1 },
      }),
    ).toThrow();
  });

  it("rejects stale or internally inconsistent runtime evidence", () => {
    const invalidArtifacts = [
      {
        ...artifact,
        sourceRevision: "c".repeat(40),
      },
      {
        ...artifact,
        dimensions: { ...artifact.dimensions, width: 1_171 },
      },
      {
        ...artifact,
        verification: {
          ...artifact.verification,
          stableFrameHash: `sha256:${"d".repeat(64)}`,
        },
      },
    ];
    for (const invalidArtifact of invalidArtifacts) {
      expect(() =>
        ImportJobDraftSchemaV2.parse({
          ...draft,
          artifacts: [invalidArtifact],
        }),
      ).toThrow();
    }
  });

  it("validates all import RPC methods with strict bounded payloads", () => {
    const requestBase = {
      correlationId: "cor_01J00000000000000000000000",
      requestId: "prq_01J00000000000000000000000",
      schemaVersion: 1,
      sentAt: now,
    };
    const requests = [
      {
        ...requestBase,
        method: "imports.plan",
        payload: {
          repositoryPath: "/tmp/Buzzr",
        },
      },
      {
        ...requestBase,
        method: "imports.start",
        payload: {
          approvedRecipeHashes: [hash],
          pilotScenarioIds: [scenarioId],
          planToken,
          projectName: "Buzzr",
          repositoryPath: "/tmp/Buzzr",
          selectedHarness: null,
        },
      },
      {
        ...requestBase,
        method: "imports.get",
        payload: { jobId },
      },
      {
        ...requestBase,
        method: "imports.list",
        payload: {},
      },
      {
        ...requestBase,
        method: "imports.cancel",
        payload: { expectedRevision: 4, jobId },
      },
      {
        ...requestBase,
        method: "imports.discard",
        payload: { expectedRevision: 4, jobId },
      },
      {
        ...requestBase,
        method: "imports.resume",
        payload: { expectedRevision: 4, jobId },
      },
      {
        ...requestBase,
        method: "imports.retryFailed",
        payload: {
          expectedRevision: 4,
          jobId,
          scenarioIds: [scenarioId],
        },
      },
      {
        ...requestBase,
        method: "imports.commit",
        payload: { expectedRevision: 4, jobId },
      },
      {
        ...requestBase,
        method: "imports.purgeAll",
        payload: {},
      },
    ];

    for (const request of requests) {
      const method = request.method;
      const responseJob = {
        ...draft,
        projectId:
          method === "imports.commit"
            ? "prj_01J00000000000000000000000"
            : null,
        revision: 4,
        stage: method === "imports.commit" ? "save" : draft.stage,
        state:
          method === "imports.cancel"
            ? "paused"
            : method === "imports.discard"
              ? "cancelled"
            : method === "imports.resume" ||
                method === "imports.retryFailed"
              ? "running"
              : method === "imports.commit"
                ? "committed"
                : draft.state,
        updatedAt: now,
      };
      expect(RuntimeRpcRequestSchema.parse(request).method).toBe(
        request.method,
      );
      const result =
        method === "imports.plan"
          ? {
              plan: {
                token: planToken,
                repository: draft.repository,
                applications: draft.applications,
                scenarios: [
                  {
                    applicationId: scenario.applicationId,
                    id: scenario.id,
                    route: scenario.route,
                    sourceAnchor: scenario.sourceAnchor,
                    state: scenario.state,
                    viewport: scenario.viewport,
                  },
                ],
                recipes: [
                  {
                    applicationId: "buzzr-ios",
                    applicationLabel: "Buzzr iOS",
                    adapterId: "maestro-expo-ios",
                    adapterVersion: "1.0.0",
                    executable: "npx",
                    resolvedExecutable: "/usr/local/bin/npx",
                    args: ["expo", "start", "--localhost"],
                    cwd: "/tmp/Buzzr",
                    purpose: "launch",
                    hash,
                    expiresAt: now,
                  },
                ],
                inventory: {
                  fileCount: 2,
                  screenCount: 1,
                  componentCount: 0,
                  tokenCount: 0,
                  screens: [
                    {
                      id: "buzzr-home",
                      name: "Home",
                      route: "/",
                      sourcePath: "app/index.tsx",
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
            }
          : method === "imports.list"
            ? {
                jobs: [{
                  id: responseJob.id,
                  projectId: responseJob.projectId,
                  projectName: responseJob.projectName,
                  state: responseJob.state,
                  stage: responseJob.stage,
                  sourceRevision: responseJob.repository.sourceRevision,
                  progress: responseJob.progress,
                  currentApplicationId: responseJob.currentApplicationId,
                  currentScenarioId: responseJob.currentScenarioId,
                  failureCount: responseJob.failures.length,
                  revision: responseJob.revision,
                  updatedAt: responseJob.updatedAt,
                }],
              }
          : method === "imports.purgeAll"
            ? {
                complete: true,
                counts: {
                  artifacts: 3,
                  jobs: 1,
                  managedWorktrees: 1,
                  pendingPlans: 1,
                  plans: 1,
                  projectBindings: 1,
                  simulatorAuthorities: 1,
                },
                failures: [],
              }
            : { job: responseJob };
      expect(
        RuntimeRpcResponseSchema.parse({
          correlationId: request.correlationId,
          method: request.method,
          ok: true,
          receivedAt: now,
          requestId: request.requestId,
          result,
          schemaVersion: 1,
        }).method,
      ).toBe(request.method);
    }

    expect(
      RuntimeRpcRequestSchema.safeParse({
        ...requestBase,
        method: "imports.purgeAll",
        payload: { repositoryPath: "/tmp/Buzzr" },
      }).success,
    ).toBe(false);
    expect(
      RuntimeRpcResponseSchema.safeParse({
        correlationId: requestBase.correlationId,
        method: "imports.purgeAll",
        ok: true,
        receivedAt: now,
        requestId: requestBase.requestId,
        result: {
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
          failures: [
            {
              category: "artifacts",
              code: "ARTIFACT_PURGE_FAILED",
              message: "Capture artifacts remain.",
            },
          ],
        },
        schemaVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      RuntimeRpcRequestSchema.safeParse({
        ...requestBase,
        method: "imports.start",
        payload: {
          approvedRecipeHashes: [hash],
          pilotScenarioIds: [scenarioId, scenarioId],
          planToken,
          projectName: "Buzzr",
          repositoryPath: "/tmp/Buzzr",
          selectedHarness: null,
        },
      }).success,
    ).toBe(false);
  });

  it("persists a revision-bound pilot scope without weakening job evidence", () => {
    const scoped = ImportJobDraftSchemaV2.parse({
      ...draft,
      pilotScope: {
        scenarioIds: [scenarioId],
        sourceRevision,
      },
    });
    expect(scoped.pilotScope).toEqual({
      scenarioIds: [scenarioId],
      sourceRevision,
    });
    expect(() =>
      ImportJobDraftSchemaV2.parse({
        ...scoped,
        pilotScope: {
          ...scoped.pilotScope,
          sourceRevision: "c".repeat(40),
        },
      }),
    ).toThrow();
  });

  it("reads pre-pilot durable snapshots as all-scenario jobs", () => {
    const { pilotScope: _legacyAbsentScope, ...legacyDraft } = draft;
    const snapshot = ImportJobSnapshotSchemaV2.parse({
      ...legacyDraft,
      revision: 4,
      updatedAt: now,
    });

    expect(snapshot.pilotScope).toBeNull();
  });

  it("rejects host paths with control characters and oversized log tails", () => {
    const startRequest = (repositoryPath: string) => ({
        correlationId: "cor_01J00000000000000000000000",
        method: "imports.start",
        payload: {
          approvedRecipeHashes: [],
          planToken,
          projectName: "Buzzr",
          repositoryPath,
          selectedHarness: null,
        },
        requestId: "prq_01J00000000000000000000000",
        schemaVersion: 1,
        sentAt: now,
      });
    expect(() =>
      RuntimeRpcRequestSchema.parse(
        startRequest("/tmp/Buzzr\nunsafe"),
      ),
    ).toThrow();
    expect(() =>
      RuntimeRpcRequestSchema.parse(startRequest("/")),
    ).toThrow();
    expect(() =>
      RuntimeRpcRequestSchema.parse(startRequest("/tmp/../etc")),
    ).toThrow();
    expect(() =>
      CaptureFailureSchemaV1.parse({
        ...failure,
        logTail: Array.from({ length: 33 }, () => "bounded"),
      }),
    ).toThrow();
  });
});
