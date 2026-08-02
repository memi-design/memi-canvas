import { describe, expect, it } from "vitest";

import {
  ArtifactIdSchema,
  CaptureArtifactSchemaV2,
  ImportJobSnapshotSchemaV2,
  RuntimeCaptureScreenV1Schema,
} from "@memi/protocol";

import {
  createCapturedRepositoryCanvasProject,
  createStreamingRepositoryCanvasProject,
  setRepositoryDifferenceOverlayVisibility,
  type CaptureArtifactReference,
} from "./repository-capture-workbench.js";
import type { RepositoryImportManifest } from "./repository-import.js";
import { RepositoryReconstructionReviewSchema } from "./repository-reconstruction-review.js";

const now = "2026-07-29T12:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}`;
const sourceRevision = "b".repeat(40);
const firstScenarioId = "csc_01J00000000000000000000000";
const secondScenarioId = "csc_01J00000000000000000000001";
const differenceArtifactId = ArtifactIdSchema.parse(
  "art_01J00000000000000000000004",
);

const manifest: RepositoryImportManifest = {
  schemaVersion: 1,
  projectName: "Northstar",
  rootPath: "/Projects/northstar",
  revision: sourceRevision,
  platform: "react-web",
  dirty: false,
  files: [],
  screens: [
    {
      id: "home",
      name: "Home",
      route: "/",
      sourcePath: "src/pages/Home.tsx",
    },
    {
      id: "settings",
      name: "Settings",
      route: "/settings",
      sourcePath: "src/pages/Settings.tsx",
    },
  ],
  components: [],
  tokens: [],
};

const scenarioBase = {
  applicationId: "northstar-web",
  authContext: null,
  fixtureProfile: "deterministic-local",
  parameters: [],
  readinessSelector: "[data-screen-ready]",
  state: "default",
  viewport: {
    height: 800,
    name: "desktop",
    scale: 1,
    width: 1280,
  },
} as const;

const capturedArtifact = CaptureArtifactSchemaV2.parse({
  dimensions: { height: 800, scale: 1, width: 1280 },
  fixtureFingerprint: hash,
  geometryArtifactId: "art_01J00000000000000000000002",
  hierarchyArtifactId: "art_01J00000000000000000000001",
  id: "art_01J00000000000000000000000",
  reconstructionArtifactId: "art_01J00000000000000000000003",
  scenarioId: firstScenarioId,
  screenshotArtifactId: "art_01J00000000000000000000000",
  screenshotHash: hash,
  sourceRevision,
  verification: {
    blankRejected: true,
    errorBoundaryRejected: true,
    routeMatched: true,
    splashRejected: true,
    stableFrameHash: hash,
    verifiedAt: now,
  },
});

const semanticCapture = RuntimeCaptureScreenV1Schema.parse({
  app: {
    appVersion: "1.0.0",
    buildRevision: sourceRevision,
    environment: "simulator",
    productId: "northstar",
  },
  artifact: {
    alt: "Northstar Home runtime capture",
    artifactId: capturedArtifact.screenshotArtifactId,
    hash,
    height: 800,
    kind: "image/png",
    src: `memi-artifact://localhost/${capturedArtifact.screenshotArtifactId}`,
    width: 1280,
  },
  authority: "local_capture",
  binding: {
    coverageCellId: "northstar-home-default",
    normalizedPath: "/",
    routeId: "/",
    sourceAnchor: "src/pages/Home.tsx#Home",
    sourceContentHash: hash,
    stateId: "default",
    viewport: { height: 800, name: "mobile", scale: 1, width: 1280 },
  },
  captureId: capturedArtifact.id,
  capturedAt: now,
  evidence: {
    captureMethod: "ios-simulator-screenshot",
    label: "Local capture",
    truthLabel: "Local capture",
  },
  layers: [
    {
      geometry: {
        clip: true,
        cornerRadius: 12,
        height: 52,
        width: 240,
        x: 32,
        y: 120,
      },
      kind: "shape",
      layerId: "continue-button",
      name: "Continue",
      semanticKey: "home.continue",
      source: {
        astPath: ["Home", "Button"],
        atomicLevel: "atom",
        range: { end: 180, start: 120 },
        sourceAnchor: "src/pages/Home.tsx#Home",
        sourceContentHash: hash,
      },
      style: { fill: "oklch(0.68 0.22 18)", opacity: 1 },
      zIndex: 1,
    },
    {
      content: { text: "Continue" },
      geometry: { height: 20, width: 80, x: 80, y: 16 },
      kind: "text",
      layerId: "continue-label",
      name: "Continue label",
      parentLayerId: "continue-button",
      semanticKey: "home.continue.label",
      source: {
        astPath: ["Home", "Button", "Text"],
        atomicLevel: "atom",
        range: { end: 168, start: 152 },
        sourceAnchor: "src/pages/Home.tsx#Home",
        sourceContentHash: hash,
      },
      style: { fontSize: 16, textColor: "oklch(0.98 0 0)" },
      zIndex: 2,
    },
  ],
  repository: {
    dirty: false,
    dirtyFileFingerprint: hash,
    revision: sourceRevision,
    rootPath: manifest.rootPath,
    sourceFingerprint: hash,
  },
  schemaVersion: 1,
  screenId: "home",
  screenName: "Home",
});

const verifiedReview = RepositoryReconstructionReviewSchema.parse({
  confidenceBySemanticKey: {
    "home.continue": {
      basis: ["runtime-geometry", "source-anchor"],
      score: 0.97,
    },
    "home.continue.label": {
      basis: ["runtime-geometry", "source-anchor"],
      score: 0.94,
    },
  },
  fidelity: {
    diffArtifactId: differenceArtifactId,
    evaluatedAt: now,
    maximumGeometryDelta: 0.5,
    ssim: 0.991,
    status: "verified",
  },
  schemaVersion: 1,
});

function terminalJob() {
  return ImportJobSnapshotSchemaV2.parse({
    applications: [
      {
        id: "northstar-web",
        label: "Northstar web",
        platform: "react-web",
        relativeRoot: ".",
      },
    ],
    artifacts: [capturedArtifact],
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
    ],
    createdAt: now,
    currentApplicationId: null,
    currentScenarioId: null,
    failures: [
      {
        code: "READINESS_TIMEOUT",
        logTail: ["Waiting for [data-screen-ready]"],
        message: "The settings screen did not become ready.",
        occurredAt: now,
        remediation: "Add a stable readiness selector and retry.",
        retryable: true,
        scenarioId: secondScenarioId,
        stage: "capture",
      },
    ],
    id: "imp_01J00000000000000000000000",
    kind: "memi-import-job",
    logs: [],
    managedWorktreeId: "wrk_01J00000000000000000000000",
    progress: { captured: 1, failed: 1, remaining: 0, total: 2 },
    projectId: "prj_01J00000000000000000000000",
    projectName: "Northstar",
    repository: {
      dirtyFingerprint: hash,
      rootPath: manifest.rootPath,
      sourceRevision,
    },
    revision: 4,
    scenarios: [
      {
        ...scenarioBase,
        id: firstScenarioId,
        route: "/",
        sourceAnchor: {
          contentHash: hash,
          relativePath: "src/pages/Home.tsx",
          symbol: "Home",
        },
      },
      {
        ...scenarioBase,
        id: secondScenarioId,
        route: "/settings",
        sourceAnchor: {
          contentHash: hash,
          relativePath: "src/pages/Settings.tsx",
          symbol: "Settings",
        },
      },
    ],
    selectedHarness: null,
    stage: "save",
    state: "committed",
    updatedAt: now,
  });
}

describe("truthful repository capture projection", () => {
  it("preserves the runtime project identity in streaming projections", () => {
    const runtimeProjectId = "prj_01J00000000000000000000000";
    const running = ImportJobSnapshotSchemaV2.parse({
      ...terminalJob(),
      failures: [],
      progress: { captured: 1, failed: 0, remaining: 1, total: 2 },
      projectId: null,
      revision: 3,
      stage: "capture",
      state: "running",
    });

    const project = createStreamingRepositoryCanvasProject({
      artifactReference: () => ({
        alt: "Northstar Home runtime capture",
        capturedAt: now,
        sourceUrl: "memi-source://repository/src/pages/Home.tsx",
        src: `memi-artifact://localhost/${capturedArtifact.screenshotArtifactId}`,
      }),
      harnessId: "codex",
      job: running,
      manifest,
      projectId: runtimeProjectId,
    });

    expect(project.id).toBe(runtimeProjectId);
  });

  it("streams captured scenarios as editable reconstructions with separate hidden evidence", () => {
    const running = ImportJobSnapshotSchemaV2.parse({
      ...terminalJob(),
      failures: [],
      progress: { captured: 1, failed: 0, remaining: 1, total: 2 },
      projectId: null,
      revision: 3,
      stage: "capture",
      state: "running",
    });
    const project = createStreamingRepositoryCanvasProject({
      artifactReference: () => ({
        alt: "Northstar Home runtime capture",
        capturedAt: now,
        sourceUrl: "memi-source://repository/src/pages/Home.tsx",
        src: `memi-artifact://localhost/${capturedArtifact.screenshotArtifactId}`,
      }),
      harnessId: "codex",
      job: running,
      manifest,
      projectId: "prj_01J00000000000000000000000",
    });

    expect(project.importState).toMatchObject({
      sequence: 3,
      state: "importing",
    });
    expect(project.reconstructions).toEqual([
      expect.objectContaining({
        evidenceArtifactId: capturedArtifact.screenshotArtifactId,
        reviewStatus: "needs-review",
        scenarioId: firstScenarioId,
      }),
    ]);
    const frame = project.document.nodes.find(({ name }) => name === "Home");
    expect(frame).toMatchObject({
      kind: "Frame",
      locked: false,
      provenance: {
        captureState: "captured",
        sourceAnchor: "src/pages/Home.tsx",
      },
    });
    const evidence = project.document.nodes.find(
      ({ id }) => id === `repository-evidence-${firstScenarioId}`,
    );
    expect(evidence).toMatchObject({
      hidden: true,
      kind: "ReferenceFrame",
      locked: true,
      parentId: null,
      reference: {
        captureId: capturedArtifact.id,
        contentHash: capturedArtifact.screenshotHash,
      },
    });
    expect(project.document.nodes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "DraftFrame" }),
        expect.objectContaining({ kind: "RoutePlaceholder" }),
      ]),
    );
    expect(JSON.stringify(project)).not.toMatch(/capture unavailable/iu);
  });

  it("keeps runtime evidence out of the visible reconstruction and exposes explicit diagnostics", () => {
    const reference: CaptureArtifactReference = {
      alt: "Northstar Home runtime capture",
      capturedAt: now,
      sourceUrl: "http://127.0.0.1:4173/",
      src: "/imports/artifacts/art_01J00000000000000000000000.png",
    };
    const project = createCapturedRepositoryCanvasProject({
      artifactReference: () => reference,
      harnessId: "codex",
      job: terminalJob(),
      manifest,
      projectId: terminalJob().projectId!,
    });

    const home = project.document.nodes.find(({ name }) => name === "Home");
    expect(home).toMatchObject({
      kind: "Frame",
      locked: false,
      provenance: {
        captureState: "captured",
        routeId: "/",
        sourceAnchor: "src/pages/Home.tsx",
      },
    });
    const evidence = project.document.nodes.find(
      ({ id }) => id === `repository-evidence-${firstScenarioId}`,
    );
    expect(evidence).toMatchObject({
      hidden: true,
      reference: {
        authority: "local-runtime-capture",
        contentHash: hash,
        src: reference.src,
      },
    });
    expect(project.failureCards).toEqual([
      expect.objectContaining({
        code: "READINESS_TIMEOUT",
        remediation: "Add a stable readiness selector and retry.",
        route: "/settings",
      }),
    ]);
    expect(project.document.nodes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "DraftFrame" }),
        expect.objectContaining({ kind: "RoutePlaceholder" }),
      ]),
    );
    expect(JSON.stringify(project)).not.toMatch(/capture unavailable/iu);
  });

  it("accepts a native artifact identity and rejects a hostile artifact host", () => {
    const nativeReference: CaptureArtifactReference = {
      alt: "Northstar Home runtime capture",
      capturedAt: now,
      sourceUrl: "memi-source://repository/src/pages/Home.tsx",
      src: `memi-artifact://localhost/${capturedArtifact.screenshotArtifactId}`,
    };
    const project = createCapturedRepositoryCanvasProject({
      artifactReference: () => nativeReference,
      harnessId: "codex",
      job: terminalJob(),
      manifest,
      projectId: terminalJob().projectId!,
    });
    expect(
      project.document.nodes.find(
        ({ id }) => id === `repository-evidence-${firstScenarioId}`,
      )
        ?.reference?.src,
    ).toBe(nativeReference.src);

    expect(() =>
      createCapturedRepositoryCanvasProject({
        artifactReference: () => ({
          ...nativeReference,
          src: `memi-artifact://evil.example/${capturedArtifact.screenshotArtifactId}`,
        }),
        harnessId: "codex",
        job: terminalJob(),
        manifest,
        projectId: terminalJob().projectId!,
      }),
    ).toThrow(/artifact identity/iu);
  });

  it("materializes runtime semantic layers above immutable evidence", () => {
    const project = createCapturedRepositoryCanvasProject({
      artifactReference: () => ({
        alt: "Northstar Home runtime capture",
        capturedAt: now,
        reconstruction: semanticCapture,
        sourceUrl: "memi-source://repository/src/pages/Home.tsx",
        src: `memi-artifact://localhost/${capturedArtifact.screenshotArtifactId}`,
      }),
      harnessId: "codex",
      job: terminalJob(),
      manifest,
      projectId: terminalJob().projectId!,
    });
    const frame = project.document.nodes.find(({ name }) => name === "Home")!;
    const button = project.document.nodes.find(({ name }) => name === "Continue")!;
    const label = project.document.nodes.find(
      ({ name }) => name === "Continue label",
    )!;

    expect(button).toMatchObject({
      fill: "oklch(0.68 0.22 18)",
      kind: "Rectangle",
      parentId: frame.id,
      position: { x: 32, y: 120 },
      size: { height: 52, width: 240 },
      source: {
        captureState: "captured",
        sourceAnchor: "src/pages/Home.tsx",
      },
    });
    expect(label).toMatchObject({
      kind: "Text",
      parentId: button.id,
      position: { x: 112, y: 136 },
      text: "Continue",
    });
    expect(project.reconstructions[0]).toMatchObject({
      confidence: 1,
      reviewStatus: "needs-review",
    });
  });

  it("projects verified fidelity, per-node confidence, and a hidden difference overlay", () => {
    const project = createCapturedRepositoryCanvasProject({
      artifactReference: () => ({
        alt: "Northstar Home runtime capture",
        capturedAt: now,
        reconstruction: semanticCapture,
        reconstructionReview: verifiedReview,
        sourceUrl: "memi-source://repository/src/pages/Home.tsx",
        src: `memi-artifact://localhost/${capturedArtifact.screenshotArtifactId}`,
      }),
      harnessId: "codex",
      job: terminalJob(),
      manifest,
      projectId: terminalJob().projectId!,
    });
    const button = project.document.nodes.find(
      ({ name }) => name === "Continue",
    )!;
    const label = project.document.nodes.find(
      ({ name }) => name === "Continue label",
    )!;
    const reconstruction = project.reconstructions[0]!;
    const difference = project.document.nodes.find(
      ({ id }) => id === reconstruction.differenceOverlayNodeId,
    );
    const evidence = project.document.nodes.find(
      ({ id }) => id === reconstruction.evidenceNodeId,
    );

    expect(reconstruction).toMatchObject({
      confidenceByNodeId: {
        [button.id]: { score: 0.97 },
        [label.id]: { score: 0.94 },
      },
      differenceOverlayVisible: false,
      fidelity: {
        diffArtifactId: differenceArtifactId,
        maximumGeometryDelta: 0.5,
        ssim: 0.991,
      },
      reviewStatus: "verified",
    });
    expect(difference).toMatchObject({
      hidden: true,
      kind: "ReferenceFrame",
      locked: true,
      reference: {
        authority: "local-runtime-difference",
        captureId: differenceArtifactId,
        src: `memi-artifact://localhost/${differenceArtifactId}`,
      },
    });
    expect(evidence).toMatchObject({ hidden: true, locked: true });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence?.reference)).toBe(true);

    const shown = setRepositoryDifferenceOverlayVisibility(
      project,
      firstScenarioId,
      true,
    );
    expect(project.document.nodes.find(({ id }) => id === difference?.id))
      .toMatchObject({ hidden: true });
    expect(shown.document.nodes.find(({ id }) => id === difference?.id))
      .toMatchObject({ hidden: false });
    expect(shown.document.nodes.find(({ id }) => id === evidence?.id))
      .toMatchObject({ hidden: true });
    expect(shown.reconstructions[0]).toMatchObject({
      differenceOverlayVisible: true,
    });
    const hidden = setRepositoryDifferenceOverlayVisibility(
      shown,
      firstScenarioId,
      false,
    );
    expect(hidden.document.nodes.find(({ id }) => id === difference?.id))
      .toMatchObject({ hidden: true });
  });

  it("fails closed when a difference overlay has no reviewed artifact", () => {
    const project = createCapturedRepositoryCanvasProject({
      artifactReference: () => ({
        alt: "Northstar Home runtime capture",
        capturedAt: now,
        reconstruction: semanticCapture,
        sourceUrl: "memi-source://repository/src/pages/Home.tsx",
        src: `memi-artifact://localhost/${capturedArtifact.screenshotArtifactId}`,
      }),
      harnessId: "codex",
      job: terminalJob(),
      manifest,
      projectId: terminalJob().projectId!,
    });

    expect(() =>
      setRepositoryDifferenceOverlayVisibility(
        project,
        firstScenarioId,
        true,
      ),
    ).toThrow(/difference artifact/iu);
  });

  it("rejects a terminal projection whose project identity differs from the committed job", () => {
    expect(() =>
      createCapturedRepositoryCanvasProject({
        artifactReference: () => ({
          alt: "capture",
          capturedAt: now,
          sourceUrl: "http://127.0.0.1:4173/",
          src: "/imports/artifacts/art_01J00000000000000000000000.png",
        }),
        harnessId: "codex",
        job: terminalJob(),
        manifest,
        projectId: "northstar-mismatch",
      }),
    ).toThrow(/project identity/iu);
  });

  it("refuses to expose projects before every scenario is terminal", () => {
    expect(() =>
      createCapturedRepositoryCanvasProject({
        artifactReference: () => ({
          alt: "capture",
          capturedAt: now,
          sourceUrl: "http://127.0.0.1:4173/",
          src: "/imports/artifacts/art_01J00000000000000000000000.png",
        }),
        harnessId: "codex",
        job: {
          ...terminalJob(),
          progress: { captured: 1, failed: 0, remaining: 1, total: 2 },
          failures: [],
          state: "running",
        },
        manifest,
        projectId: "northstar-import",
      }),
    ).toThrow(/terminal/iu);
  });

  it("refuses to materialize a terminal job before durable commit", () => {
    expect(() =>
      createCapturedRepositoryCanvasProject({
        artifactReference: () => ({
          alt: "capture",
          capturedAt: now,
          sourceUrl: "http://127.0.0.1:4173/",
          src: "/imports/artifacts/art_01J00000000000000000000000.png",
        }),
        harnessId: "codex",
        job: {
          ...terminalJob(),
          projectId: null,
          state: "ready-to-commit",
        },
        manifest,
        projectId: "northstar-import",
      }),
    ).toThrow(/committed/iu);
  });
});
