import { describe, expect, it } from "vitest";
import {
  ArtifactIdSchema,
  ImportJobSnapshotSchemaV2,
  RuntimeCaptureScreenV1Schema,
} from "@memi/protocol";

import {
  createRepositoryProjectPersistence,
  repositoryProjectKey,
} from "./repository-project-persistence.js";
import { RepositoryReconstructionReviewSchema } from "./repository-reconstruction-review.js";

const record = {
  harnessId: "codex",
  manifest: {
    schemaVersion: 1 as const,
    projectName: "Northstar",
    rootPath: "/Projects/northstar",
    revision: "a1b2c3d4",
    platform: "react-web" as const,
    dirty: false,
    files: [],
    screens: [],
    components: [],
    tokens: [],
  },
};

describe("repository project persistence", () => {
  it("uses the exact canonical runtime project identity as the storage key", () => {
    const values = new Map<string, string>();
    const persistence = createRepositoryProjectPersistence({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });
    const runtimeProjectId = "prj_01J00000000000000000000000";

    expect(persistence.save(runtimeProjectId, record)).toBe(true);
    expect(persistence.load(runtimeProjectId)).toEqual(record);
    expect(values.has(repositoryProjectKey(runtimeProjectId))).toBe(true);
  });

  it("round-trips source authority independently from canvas history", () => {
    const values = new Map<string, string>();
    const persistence = createRepositoryProjectPersistence({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });

    expect(persistence.save("northstar", record)).toBe(true);
    expect(persistence.load("northstar")).toEqual(record);
    expect(values.has(repositoryProjectKey("northstar"))).toBe(true);
  });

  it("fails closed for malformed source authority", () => {
    const persistence = createRepositoryProjectPersistence({
      getItem: () => '{"harnessId":"codex","manifest":{"projectName":"bad"}}',
      setItem: () => undefined,
    });
    expect(persistence.load("northstar")).toBeNull();
    expect(persistence.load("../escape")).toBeNull();
  });

  it("round-trips terminal capture authority without screenshot bytes", () => {
    const values = new Map<string, string>();
    const persistence = createRepositoryProjectPersistence({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });
    const capturedRecord = {
      ...record,
      manifest: {
        ...record.manifest,
        revision: "a".repeat(40),
      },
      capture: {
        artifactReferences: {
          art_01J00000000000000000000000: {
            alt: "Home runtime capture",
            capturedAt: "2026-07-29T12:00:00.000Z",
            sourceUrl: "http://127.0.0.1:4173/",
            src: "/imports/artifacts/art_01J00000000000000000000000.png",
          },
        },
        job: ImportJobSnapshotSchemaV2.parse({
          applications: [
            {
              id: "northstar-web",
              label: "Northstar web",
              platform: "react-web",
              relativeRoot: ".",
            },
          ],
          artifacts: [],
          cancellationRequestedAt: null,
          checkpoints: [
            "validate",
            "inventory",
            "plan",
            "prepare-fixtures",
            "build",
            "launch",
            "capture",
            "extract-layers",
            "verify",
            "save",
          ],
          createdAt: "2026-07-29T12:00:00.000Z",
          currentApplicationId: null,
          currentScenarioId: null,
          failures: [],
          id: "imp_01J00000000000000000000000",
          kind: "memi-import-job",
          logs: [],
          managedWorktreeId: null,
          progress: {
            captured: 0,
            failed: 0,
            remaining: 0,
            total: 0,
          },
          projectId: "prj_01J00000000000000000000000",
          projectName: "Northstar",
          repository: {
            dirtyFingerprint: null,
            rootPath: record.manifest.rootPath,
            sourceRevision: "a".repeat(40),
          },
          revision: 2,
          scenarios: [],
          selectedHarness: null,
          stage: "save",
          state: "committed",
          updatedAt: "2026-07-29T12:00:01.000Z",
        }),
      },
    } as const;

    const runtimeProjectId = capturedRecord.capture.job.projectId!;

    expect(persistence.save(runtimeProjectId, capturedRecord)).toBe(true);
    expect(persistence.load(runtimeProjectId)).toEqual(capturedRecord);
    expect(values.get(repositoryProjectKey(runtimeProjectId))).not.toMatch(
      /data:image/iu,
    );
  });

  it("persists native artifact identities and rejects hostile artifact URLs", () => {
    const values = new Map<string, string>();
    const persistence = createRepositoryProjectPersistence({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });
    const screenshotId = ArtifactIdSchema.parse(
      "art_01J00000000000000000000000",
    );
    const committed = {
      ...record,
      manifest: {
        ...record.manifest,
        revision: "a".repeat(40),
      },
      capture: {
        artifactReferences: {
          [screenshotId]: {
            alt: "Home runtime capture",
            capturedAt: "2026-07-29T12:00:00.000Z",
            sourceUrl: "memi-source://repository/src/pages/Home.tsx",
            src: `memi-artifact://localhost/${screenshotId}`,
          },
        },
        job: ImportJobSnapshotSchemaV2.parse({
          applications: [
            {
              id: "northstar-web",
              label: "Northstar web",
              platform: "react-web",
              relativeRoot: ".",
            },
          ],
          artifacts: [],
          cancellationRequestedAt: null,
          checkpoints: ["validate", "inventory", "plan", "prepare-fixtures", "build", "launch", "capture", "extract-layers", "verify", "save"],
          createdAt: "2026-07-29T12:00:00.000Z",
          currentApplicationId: null,
          currentScenarioId: null,
          failures: [],
          id: "imp_01J00000000000000000000000",
          kind: "memi-import-job",
          logs: [],
          managedWorktreeId: null,
          progress: { captured: 0, failed: 0, remaining: 0, total: 0 },
          projectId: "prj_01J00000000000000000000000",
          projectName: "Northstar",
          repository: {
            dirtyFingerprint: null,
            rootPath: record.manifest.rootPath,
            sourceRevision: "a".repeat(40),
          },
          revision: 2,
          scenarios: [],
          selectedHarness: null,
          stage: "save",
          state: "committed",
          updatedAt: "2026-07-29T12:00:01.000Z",
        }),
      },
    } as const;

    const runtimeProjectId = committed.capture.job.projectId!;

    expect(persistence.save(runtimeProjectId, committed)).toBe(true);
    expect(persistence.load(runtimeProjectId)).toEqual(committed);
    expect(
      persistence.save(runtimeProjectId, {
        ...committed,
        capture: {
          ...committed.capture,
          artifactReferences: {
            [screenshotId]: {
              alt: "Home runtime capture",
              capturedAt: "2026-07-29T12:00:00.000Z",
              sourceUrl:
                "memi-source://repository/src/pages/Home.tsx",
              src: `memi-artifact://evil.example/${screenshotId}`,
            },
          },
        },
      }),
    ).toBe(false);
  });

  it("rejects capture authority stored under a different project identity", () => {
    const values = new Map<string, string>();
    const persistence = createRepositoryProjectPersistence({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });
    const runtimeProjectId = "prj_01J00000000000000000000000";
    const capturedRecord = {
      ...record,
      manifest: {
        ...record.manifest,
        revision: "a".repeat(40),
      },
      capture: {
        artifactReferences: {},
        job: ImportJobSnapshotSchemaV2.parse({
          applications: [
            {
              id: "northstar-web",
              label: "Northstar web",
              platform: "react-web",
              relativeRoot: ".",
            },
          ],
          artifacts: [],
          cancellationRequestedAt: null,
          checkpoints: ["validate", "inventory", "plan", "prepare-fixtures", "build", "launch", "capture", "extract-layers", "verify", "save"],
          createdAt: "2026-07-29T12:00:00.000Z",
          currentApplicationId: null,
          currentScenarioId: null,
          failures: [],
          id: "imp_01J00000000000000000000000",
          kind: "memi-import-job",
          logs: [],
          managedWorktreeId: null,
          progress: { captured: 0, failed: 0, remaining: 0, total: 0 },
          projectId: runtimeProjectId,
          projectName: "Northstar",
          repository: {
            dirtyFingerprint: null,
            rootPath: record.manifest.rootPath,
            sourceRevision: "a".repeat(40),
          },
          revision: 2,
          scenarios: [],
          selectedHarness: null,
          stage: "save",
          state: "committed",
          updatedAt: "2026-07-29T12:00:01.000Z",
        }),
      },
    } as const;

    expect(persistence.save("northstar-alias", capturedRecord)).toBe(false);
    values.set(
      repositoryProjectKey("northstar-alias"),
      JSON.stringify(capturedRecord),
    );
    expect(persistence.load("northstar-alias")).toBeNull();
  });

  it("rejects semantic reconstructions that do not match the committed artifact authority", () => {
    const values = new Map<string, string>();
    const persistence = createRepositoryProjectPersistence({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });
    const screenshotId = ArtifactIdSchema.parse(
      "art_01J00000000000000000000000",
    );
    const reconstructionId = ArtifactIdSchema.parse(
      "art_01J00000000000000000000003",
    );
    const sourceRevision = "a".repeat(40);
    const runtimeProjectId = "prj_01J00000000000000000000000";
    const committed = {
      ...record,
      manifest: {
        ...record.manifest,
        revision: sourceRevision,
      },
      capture: {
        artifactReferences: {
          [screenshotId]: {
            alt: "Home runtime capture",
            capturedAt: "2026-07-29T12:00:00.000Z",
            sourceUrl: "memi-source://repository/src/pages/Home.tsx",
            src: `memi-artifact://localhost/${screenshotId}`,
            reconstruction: RuntimeCaptureScreenV1Schema.parse({
              app: {
                appVersion: "1.0.0",
                buildRevision: sourceRevision,
                environment: "simulator",
                productId: "northstar",
              },
              artifact: {
                alt: "Home runtime capture",
                artifactId: screenshotId,
                hash: `sha256:${"a".repeat(64)}`,
                height: 800,
                kind: "image/png",
                src: `memi-artifact://localhost/${screenshotId}`,
                width: 1280,
              },
              authority: "local_capture",
              binding: {
                coverageCellId: "northstar-home-default",
                normalizedPath: "/",
                routeId: "/",
                sourceAnchor: "src/pages/Home.tsx#Home",
                sourceContentHash: `sha256:${"a".repeat(64)}`,
                stateId: "default",
                viewport: {
                  height: 800,
                  name: "mobile",
                  scale: 1,
                  width: 1280,
                },
              },
              captureId: screenshotId,
              capturedAt: "2026-07-29T12:00:00.000Z",
              evidence: {
                captureMethod: "ios-simulator-screenshot",
                label: "Local capture",
                truthLabel: "Local capture",
              },
              layers: [],
              repository: {
                dirty: false,
                dirtyFileFingerprint: `sha256:${"a".repeat(64)}`,
                revision: sourceRevision,
                rootPath: record.manifest.rootPath,
                sourceFingerprint: `sha256:${"a".repeat(64)}`,
              },
              schemaVersion: 1,
              screenId: "home",
              screenName: "Home",
            }),
            reconstructionReview:
              RepositoryReconstructionReviewSchema.parse({
                confidenceBySemanticKey: {},
                fidelity: {
                  diffArtifactId:
                    "art_01J00000000000000000000004",
                  evaluatedAt: "2026-07-29T12:00:00.000Z",
                  maximumGeometryDelta: 0.5,
                  ssim: 0.99,
                  status: "verified",
                },
                schemaVersion: 1,
              }),
          },
        },
        job: ImportJobSnapshotSchemaV2.parse({
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
              dimensions: { height: 800, scale: 1, width: 1280 },
              fixtureFingerprint: `sha256:${"a".repeat(64)}`,
              geometryArtifactId: null,
              hierarchyArtifactId: null,
              id: screenshotId,
              reconstructionArtifactId: reconstructionId,
              scenarioId: "csc_01J00000000000000000000000",
              screenshotArtifactId: screenshotId,
              screenshotHash: `sha256:${"a".repeat(64)}`,
              sourceRevision,
              verification: {
                blankRejected: true,
                errorBoundaryRejected: true,
                routeMatched: true,
                splashRejected: true,
                stableFrameHash: `sha256:${"a".repeat(64)}`,
                verifiedAt: "2026-07-29T12:00:00.000Z",
              },
            },
          ],
          cancellationRequestedAt: null,
          checkpoints: ["validate", "inventory", "plan", "prepare-fixtures", "build", "launch", "capture", "extract-layers", "verify", "save"],
          createdAt: "2026-07-29T12:00:00.000Z",
          currentApplicationId: null,
          currentScenarioId: null,
          failures: [],
          id: "imp_01J00000000000000000000000",
          kind: "memi-import-job",
          logs: [],
          managedWorktreeId: null,
          progress: { captured: 1, failed: 0, remaining: 0, total: 1 },
          projectId: runtimeProjectId,
          projectName: "Northstar",
          repository: {
            dirtyFingerprint: null,
            rootPath: record.manifest.rootPath,
            sourceRevision,
          },
          revision: 2,
          scenarios: [
            {
              applicationId: "northstar-web",
              authContext: null,
              fixtureProfile: "deterministic-local",
              id: "csc_01J00000000000000000000000",
              parameters: [],
              readinessSelector: "body",
              route: "/",
              sourceAnchor: {
                contentHash: `sha256:${"a".repeat(64)}`,
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
          selectedHarness: null,
          stage: "save",
          state: "committed",
          updatedAt: "2026-07-29T12:00:01.000Z",
        }),
      },
    } as const;

    const originalReference =
      committed.capture.artifactReferences[screenshotId];
    const originalReconstruction = originalReference?.reconstruction;
    if (
      originalReference === undefined ||
      originalReconstruction === undefined
    ) {
      throw new Error("Expected a semantic reconstruction fixture.");
    }
    expect(persistence.save(runtimeProjectId, committed)).toBe(true);
    const serialized = values.get(repositoryProjectKey(runtimeProjectId));
    expect(serialized).not.toMatch(
      /confidenceBySemanticKey|reconstructionReview|"layers"|"ssim"/u,
    );
    const mismatchedArtifactId = ArtifactIdSchema.parse(
      "art_01J00000000000000000000009",
    );
    const mutatedReference: typeof originalReference = {
      ...originalReference,
      reconstruction: {
        ...originalReconstruction,
        artifact: {
          ...originalReconstruction.artifact,
                  artifactId: mismatchedArtifactId,
        },
      },
    };

    expect(
      persistence.save(runtimeProjectId, {
        ...committed,
        capture: {
          ...committed.capture,
          artifactReferences: {
            [screenshotId]: mutatedReference,
          } as typeof committed.capture.artifactReferences,
        },
      }),
    ).toBe(false);
  });

  it("rejects capture records that have not reached durable commit", () => {
    const values = new Map<string, string>();
    const persistence = createRepositoryProjectPersistence({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });
    const committed = {
      ...record,
      capture: {
        artifactReferences: {},
        job: ImportJobSnapshotSchemaV2.parse({
          applications: [],
          artifacts: [],
          cancellationRequestedAt: null,
          checkpoints: ["validate", "inventory", "plan", "prepare-fixtures", "build", "launch", "capture", "extract-layers", "verify", "save"],
          createdAt: "2026-07-29T12:00:00.000Z",
          currentApplicationId: null,
          currentScenarioId: null,
          failures: [],
          id: "imp_01J00000000000000000000000",
          kind: "memi-import-job",
          logs: [],
          managedWorktreeId: null,
          progress: { captured: 0, failed: 0, remaining: 0, total: 0 },
          projectId: null,
          projectName: "Northstar",
          repository: {
            dirtyFingerprint: null,
            rootPath: record.manifest.rootPath,
            sourceRevision: "a".repeat(40),
          },
          revision: 2,
          scenarios: [],
          selectedHarness: null,
          stage: "save",
          state: "ready-to-commit",
          updatedAt: "2026-07-29T12:00:01.000Z",
        }),
      },
    } as const;

    expect(persistence.save("northstar", committed)).toBe(false);
  });
});
