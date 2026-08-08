import { describe, expect, it } from "vitest";
import { ImportJobSnapshotSchemaV2 } from "@memi/protocol";

import {
  captureReferenceFromCommittedImport,
  repositoryManifestFromCommittedImport,
  repositoryProjectFromCommittedImport,
  repositoryRecordFromCommittedImport,
} from "./committed-import-hydration.js";

const hash = `sha256:${"a".repeat(64)}`;
const revision = "b".repeat(40);
const job = ImportJobSnapshotSchemaV2.parse({
  kind: "memi-import-job",
  id: "imp_01J00000000000000000000000",
  projectId: "prj_01J00000000000000000000000",
  projectName: "Buzzr pilot",
  state: "committed",
  stage: "save",
  repository: {
    rootPath: "/Projects/Buzzr",
    sourceRevision: revision,
    dirtyFingerprint: hash,
  },
  managedWorktreeId: "wrk_01J00000000000000000000000",
  selectedHarness: null,
  applications: [
    {
      id: "app_01J00000000000000000000000",
      label: "buzzr",
      platform: "expo-ios",
      relativeRoot: ".",
    },
  ],
  scenarios: [
    {
      id: "csc_01J00000000000000000000000",
      applicationId: "app_01J00000000000000000000000",
      route: "/sign-in",
      state: "default",
      viewport: { name: "ios-mobile", width: 390, height: 844, scale: 3 },
      authContext: "signed-out",
      parameters: [],
      fixtureProfile: "deterministic-default",
      readinessSelector: null,
      sourceAnchor: {
        relativePath: "app/(auth)/sign-in.tsx",
        symbol: null,
        contentHash: hash,
      },
    },
  ],
  artifacts: [
    {
      id: "art_01J00000000000000000000000",
      scenarioId: "csc_01J00000000000000000000000",
      screenshotArtifactId: "art_01J00000000000000000000001",
      hierarchyArtifactId: "art_01J00000000000000000000002",
      geometryArtifactId: null,
      reconstructionArtifactId: "art_01J00000000000000000000003",
      screenshotHash: hash,
      sourceRevision: revision,
      fixtureFingerprint: hash,
      dimensions: { width: 1170, height: 2532, scale: 3 },
      verification: {
        stableFrameHash: hash,
        routeMatched: true,
        blankRejected: true,
        splashRejected: true,
        errorBoundaryRejected: true,
        verifiedAt: "2026-08-01T15:32:48.100Z",
      },
    },
  ],
  failures: [],
  progress: { total: 1, captured: 1, failed: 0, remaining: 0 },
  currentApplicationId: null,
  currentScenarioId: null,
  checkpoints: ["validate", "inventory", "plan", "prepare-fixtures", "build", "launch", "capture", "extract-layers", "verify", "save"],
  logs: [],
  cancellationRequestedAt: null,
  createdAt: "2026-08-01T15:31:35.148Z",
  revision: 14,
  updatedAt: "2026-08-01T15:56:56.684Z",
});

describe("committed import hydration", () => {
  it("restores the committed source inventory for the library page", () => {
    const inventory = {
      fileCount: 2,
      screenCount: 1,
      componentCount: 1,
      tokenCount: 1,
      screens: [
        {
          id: "screen-sign-in",
          name: "Sign in",
          route: "/sign-in",
          sourcePath: "app/sign-in.tsx",
        },
      ],
      components: [
        {
          id: "button",
          name: "Button",
          sourcePath: "components/Button.tsx",
        },
      ],
      tokens: [
        {
          id: "tokens",
          name: "Tokens",
          sourcePath: "src/theme/tokens.ts",
        },
      ],
      truncated: { screens: false, components: false, tokens: false },
    };

    const manifest = repositoryManifestFromCommittedImport(
      job,
      inventory,
    );

    expect(manifest.inventory).toEqual(inventory);
    expect(manifest.components).toEqual(inventory.components);
    expect(manifest.tokens).toEqual(inventory.tokens);
  });
  it("restores a committed Expo import as an editable repository project", () => {
    const manifest = repositoryManifestFromCommittedImport(job);
    const project = repositoryProjectFromCommittedImport(job);
    const record = repositoryRecordFromCommittedImport(job);
    const reference = captureReferenceFromCommittedImport(job, job.artifacts[0]!);

    expect(manifest).toMatchObject({
      platform: "react-native-expo",
      screens: [{ route: "/sign-in", sourcePath: "app/(auth)/sign-in.tsx" }],
    });
    expect(project).toMatchObject({
      id: job.projectId,
      documentRef: `canvas:${job.projectId}`,
      lifecycle: "ready",
      source: { platform: "react-native-expo", screenCount: 1 },
    });
    expect(record.capture?.job).toEqual(job);
    expect(reference).toEqual({
      alt: "/sign-in · default",
      capturedAt: "2026-08-01T15:32:48.100Z",
      sourceUrl: "memi-source://repository/app/(auth)/sign-in.tsx",
      src: "memi-artifact://localhost/art_01J00000000000000000000001",
    });
  });

  it("refuses non-terminal import jobs", () => {
    expect(() => repositoryProjectFromCommittedImport({
      ...job,
      projectId: null,
      state: "ready-to-commit",
    })).toThrow(/terminal committed/i);
  });
});
