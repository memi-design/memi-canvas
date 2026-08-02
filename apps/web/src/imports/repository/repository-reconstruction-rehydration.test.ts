import { describe, expect, it, vi } from "vitest";
import {
  ImportJobSnapshotSchemaV2,
  RuntimeCaptureScreenV1Schema,
} from "@memi/protocol";

import { RepositoryReconstructionReviewSchema } from "./repository-reconstruction-review.js";
import { rehydrateRepositoryProjectRecord } from "./repository-reconstruction-rehydration.js";

const now = "2026-07-29T12:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}` as const;
const revision = "b".repeat(40);
const artifactId = "art_01J00000000000000000000000";
const screenshotId = "art_01J00000000000000000000001";
const reconstructionId = "art_01J00000000000000000000002";
const scenarioId = "csc_01J00000000000000000000000";

const job = ImportJobSnapshotSchemaV2.parse({
  applications: [
    {
      id: "northstar-web",
      label: "Northstar web",
      platform: "expo-ios",
      relativeRoot: ".",
    },
  ],
  artifacts: [
    {
      dimensions: { height: 800, scale: 1, width: 1280 },
      fixtureFingerprint: hash,
      geometryArtifactId: null,
      hierarchyArtifactId: null,
      id: artifactId,
      reconstructionArtifactId: reconstructionId,
      scenarioId,
      screenshotArtifactId: screenshotId,
      screenshotHash: hash,
      sourceRevision: revision,
      verification: {
        blankRejected: true,
        errorBoundaryRejected: true,
        routeMatched: true,
        splashRejected: true,
        stableFrameHash: hash,
        verifiedAt: now,
      },
    },
  ],
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
  createdAt: now,
  currentApplicationId: null,
  currentScenarioId: null,
  failures: [],
  id: "imp_01J00000000000000000000000",
  kind: "memi-import-job",
  logs: [],
  managedWorktreeId: null,
  progress: { captured: 1, failed: 0, remaining: 0, total: 1 },
  projectId: "prj_01J00000000000000000000000",
  projectName: "Northstar",
  repository: {
    dirtyFingerprint: hash,
    rootPath: "/Projects/northstar",
    sourceRevision: revision,
  },
  revision: 4,
  scenarios: [
    {
      applicationId: "northstar-web",
      authContext: null,
      fixtureProfile: "deterministic-local",
      id: scenarioId,
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
        name: "mobile",
        scale: 1,
        width: 1280,
      },
    },
  ],
  selectedHarness: null,
  stage: "save",
  state: "committed",
  updatedAt: now,
});

const capture = RuntimeCaptureScreenV1Schema.parse({
  app: {
    appVersion: "1.0.0",
    buildRevision: revision,
    environment: "simulator",
    productId: "northstar",
  },
  artifact: {
    alt: "Home runtime capture",
    artifactId: screenshotId,
    hash,
    height: 800,
    kind: "image/png",
    src: `memi-artifact://localhost/${screenshotId}`,
    width: 1280,
  },
  authority: "local_capture",
  binding: {
    coverageCellId: "home-default",
    normalizedPath: "/home",
    routeId: "/home",
    sourceAnchor: "src/pages/Home.tsx#Home",
    sourceContentHash: hash,
    stateId: "default",
    viewport: { height: 800, name: "mobile", scale: 1, width: 1280 },
  },
  captureId: artifactId,
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
      name: "Welcome",
      semanticKey: "home.title",
      source: {
        astPath: ["Home", "Text"],
        range: { end: 120, start: 92 },
        sourceAnchor: "src/pages/Home.tsx#Home",
        sourceContentHash: hash,
      },
      style: { fontSize: 24 },
      zIndex: 1,
    },
  ],
  repository: {
    dirty: false,
    dirtyFileFingerprint: hash,
    revision,
    rootPath: "/Projects/northstar",
    sourceFingerprint: hash,
  },
  schemaVersion: 1,
  screenId: "home",
  screenName: "Home",
});

const review = RepositoryReconstructionReviewSchema.parse({
  confidenceBySemanticKey: {
    "home.title": {
      basis: ["runtime-geometry", "source-anchor"],
      score: 0.97,
    },
  },
  fidelity: {
    diffArtifactId: "art_01J00000000000000000000003",
    evaluatedAt: now,
    maximumGeometryDelta: 0.5,
    ssim: 0.991,
    status: "verified",
  },
  schemaVersion: 1,
});

const record = {
  capture: {
    artifactReferences: {
      [artifactId]: {
        alt: "Home runtime capture",
        capturedAt: now,
        sourceUrl: "memi-source://repository/src/pages/Home.tsx",
        src: `memi-artifact://localhost/${screenshotId}`,
      },
    },
    job,
  },
  harnessId: "deterministic-import",
  manifest: {
    schemaVersion: 1 as const,
    projectName: "Northstar",
    rootPath: "/Projects/northstar",
    revision,
    platform: "react-native-expo" as const,
    dirty: false,
    files: [],
    screens: [],
    components: [],
    tokens: [],
  },
};

describe("repository reconstruction rehydration", () => {
  it("restores reconstruction metadata from the artifact store immutably", async () => {
    const loader = vi.fn(async () => ({
      capture,
      review,
      schemaVersion: 1,
    }));

    const hydrated = await rehydrateRepositoryProjectRecord(record, loader);
    const hydratedReference = Object.values(
      hydrated.capture?.artifactReferences ?? {},
    )[0];

    expect(loader).toHaveBeenCalledWith(reconstructionId);
    expect(hydratedReference).toMatchObject({
      reconstruction: capture,
      reconstructionReview: review,
    });
    expect(record.capture.artifactReferences[artifactId]).not.toHaveProperty(
      "reconstruction",
    );
  });

  it("fails closed when restored semantics do not match runtime authority", async () => {
    const mismatchedCapture = {
      ...capture,
      binding: { ...capture.binding, routeId: "/wrong" },
    };

    await expect(
      rehydrateRepositoryProjectRecord(record, async () => ({
        capture: mismatchedCapture,
        review,
        schemaVersion: 1,
      })),
    ).rejects.toThrow(/scenario authority/iu);
  });

  it.each([
    {
      label: "viewport",
      binding: {
        ...capture.binding,
        viewport: { ...capture.binding.viewport, width: 390 },
      },
    },
    {
      label: "source anchor",
      binding: {
        ...capture.binding,
        sourceAnchor: "src/pages/Other.tsx#Other",
      },
    },
    {
      label: "source content",
      binding: {
        ...capture.binding,
        sourceContentHash: `sha256:${"c".repeat(64)}`,
      },
    },
  ])("rejects stale $label reconstruction evidence", async ({ binding }) => {
    await expect(
      rehydrateRepositoryProjectRecord(record, async () => ({
        capture: { ...capture, binding },
        review,
        schemaVersion: 1,
      })),
    ).rejects.toThrow(/scenario authority/iu);
  });
});
