import { describe, expect, it, vi } from "vitest";

import {
  CanvasDocumentAppendReceiptV3Schema,
  CanvasDocumentJournalV3Schema,
  ImportJobSnapshotSchemaV2,
  type CanvasDocumentAppendV3,
  type CanvasDocumentIdentityV3,
  type CanvasDocumentJournalV3,
  type CanvasDocumentSnapshotV3,
  type CanvasDocumentV3PersistencePort,
} from "@memi/protocol";
import {
  CanvasDocumentV3PersistenceAdapter,
  createCanvasDocumentV3,
} from "@memi/canvas-document";

import { RuntimeCaptureScreenV1Schema } from "./runtime-capture-canonical-types.js";
import {
  materializeRuntimeCaptureV3,
  prepareRuntimeCaptureMaterializationV3,
} from "./runtime-capture-v3-materialization-adapter.js";
import { hydrateCommittedImportCanvasDocumentV3 } from "../imports/repository/committed-import-v3-hydration.js";
import { RepositoryReconstructionReviewSchema } from "../imports/repository/repository-reconstruction-review.js";

const ids = {
  document: "doc_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
  project: "prj_01J00000000000000000000000",
} as const;
const hashes = {
  dirty: `sha256:${"d".repeat(64)}` as const,
  screenshot: `sha256:${"a".repeat(64)}` as const,
  source: `sha256:${"b".repeat(64)}` as const,
  workspace: `sha256:${"c".repeat(64)}` as const,
};
const sourceRevision = "a".repeat(40);

function seed() {
  return createCanvasDocumentV3({
    id: ids.document,
    projectId: ids.project,
    initialPage: {
      id: ids.page,
      kind: "imported",
      name: "Imported screens",
    },
  });
}

function capture() {
  return RuntimeCaptureScreenV1Schema.parse({
    app: {
      appVersion: "2.1",
      buildRevision: sourceRevision,
      environment: "simulator",
      productId: "buzzr-ios",
    },
    artifact: {
      alt: "Buzzr sign-in screen",
      artifactId: "art_01J00000000000000000000001",
      hash: hashes.screenshot,
      height: 1_600,
      kind: "image/png",
      src: "/runtime-captures/buzzr/sign-in.png",
      width: 736,
    },
    authority: "local_capture",
    binding: {
      coverageCellId: "buzzr:sign-in:guest:mobile",
      normalizedPath: "/sign-in",
      routeId: "/sign-in",
      sourceAnchor: "app/(auth)/sign-in.tsx#SignInScreen",
      sourceContentHash: hashes.source,
      stateId: "default",
      viewport: { height: 800, name: "mobile", scale: 2, width: 368 },
    },
    captureId: "art_01J00000000000000000000000",
    capturedAt: "2026-08-02T17:00:00.000Z",
    evidence: {
      accessibilitySnapshotRef: "artifacts/buzzr/sign-in.a11y.json",
      captureMethod: "ios-simulator-screenshot",
      componentIds: ["Button.Primary"],
      label: "Local capture",
      sourceAnchors: ["app/(auth)/sign-in.tsx#SignInScreen"],
      truthLabel: "Local capture",
      verifier: "automated",
    },
    layers: [
      {
        content: { text: "Continue as guest" },
        geometry: {
          height: 20,
          rotation: 0,
          width: 140,
          x: 114,
          y: 694,
        },
        kind: "text",
        layerId: "buzzr:layer:continue-label",
        name: "Continue label",
        semanticKey: "auth.continue.label",
        source: {
          astPath: ["SignInScreen", "Button[0]", "Text[0]"],
          componentId: "Button.Primary",
          exportName: "SignInScreen",
          range: { end: 899, start: 881 },
          sourceAnchor: "app/(auth)/sign-in.tsx#SignInScreen",
          sourceContentHash: hashes.source,
        },
        style: {
          fontFamily: "Inter",
          fontSize: 15,
          fontWeight: 500,
          lineHeight: 20,
          opacity: 1,
          textColor: "#08090a",
        },
        zIndex: 1,
      },
    ],
    repository: {
      dirty: false,
      dirtyFileFingerprint: hashes.dirty,
      revision: sourceRevision,
      rootPath: "/fixtures/products/buzzr",
      sourceFingerprint: hashes.workspace,
    },
    schemaVersion: 1,
    screenId: "buzzr-screen-sign-in",
    screenName: "Sign in · Guest",
  });
}

function evidenceArtifacts() {
  return {
    fixtureFingerprint: hashes.workspace,
    geometryArtifactId: "art_01J00000000000000000000004",
    hierarchyArtifactId: "art_01J00000000000000000000003",
    reconstructionArtifactId: "art_01J00000000000000000000005",
    screenshotArtifactId: "art_01J00000000000000000000001",
    stableFrameHash: hashes.screenshot,
    verified: true,
  } as const;
}

function committedJob() {
  return ImportJobSnapshotSchemaV2.parse({
    applications: [
      {
        id: "app_01J00000000000000000000000",
        label: "buzzr",
        platform: "expo-ios",
        relativeRoot: ".",
      },
    ],
    artifacts: [
      {
        dimensions: { height: 1_600, scale: 2, width: 736 },
        fixtureFingerprint: hashes.workspace,
        geometryArtifactId: "art_01J00000000000000000000004",
        hierarchyArtifactId: "art_01J00000000000000000000003",
        id: "art_01J00000000000000000000000",
        reconstructionArtifactId: "art_01J00000000000000000000005",
        scenarioId: "csc_01J00000000000000000000000",
        screenshotArtifactId: "art_01J00000000000000000000001",
        screenshotHash: hashes.screenshot,
        sourceRevision,
        verification: {
          blankRejected: true,
          errorBoundaryRejected: true,
          routeMatched: true,
          splashRejected: true,
          stableFrameHash: hashes.screenshot,
          verifiedAt: "2026-08-02T17:00:00.000Z",
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
    createdAt: "2026-08-02T16:58:00.000Z",
    currentApplicationId: null,
    currentScenarioId: null,
    failures: [],
    id: "imp_01J00000000000000000000000",
    kind: "memi-import-job",
    logs: [],
    managedWorktreeId: "wrk_01J00000000000000000000000",
    progress: { captured: 1, failed: 0, remaining: 0, total: 1 },
    projectId: ids.project,
    projectName: "Buzzr",
    repository: {
      dirtyFingerprint: hashes.dirty,
      rootPath: "/fixtures/products/buzzr",
      sourceRevision,
    },
    revision: 14,
    scenarios: [
      {
        applicationId: "app_01J00000000000000000000000",
        authContext: "signed-out",
        fixtureProfile: "deterministic-default",
        id: "csc_01J00000000000000000000000",
        parameters: [],
        readinessSelector: null,
        route: "/sign-in",
        sourceAnchor: {
          contentHash: hashes.source,
          relativePath: "app/(auth)/sign-in.tsx",
          symbol: "SignInScreen",
        },
        state: "default",
        viewport: { height: 800, name: "ios-mobile", scale: 2, width: 368 },
      },
    ],
    selectedHarness: null,
    stage: "save",
    state: "committed",
    updatedAt: "2026-08-02T17:00:10.000Z",
  });
}

function verifiedReconstructionReview() {
  return RepositoryReconstructionReviewSchema.parse({
    confidenceBySemanticKey: {
      "auth.continue.label": {
        basis: ["runtime-geometry", "source-anchor"],
        score: 0.98,
      },
    },
    fidelity: {
      diffArtifactId: "art_01J00000000000000000000006",
      evaluatedAt: "2026-08-02T17:00:05.000Z",
      maximumGeometryDelta: 0.25,
      ssim: 0.992,
      status: "verified",
    },
    schemaVersion: 1,
  });
}

function memoryJournalPort() {
  let journal: CanvasDocumentJournalV3 | null = null;
  const appends: CanvasDocumentAppendV3[] = [];
  const port: CanvasDocumentV3PersistencePort = {
    load: vi.fn(async (_identity: CanvasDocumentIdentityV3) => journal),
    initialize: vi.fn(async (snapshot: CanvasDocumentSnapshotV3) => {
      journal = CanvasDocumentJournalV3Schema.parse({
        schemaVersion: 1,
        kind: "canvas-document-v3-journal",
        identity: snapshot.identity,
        snapshot,
        operations: [],
        operationBytes: 0,
      });
    }),
    append: vi.fn(async (append: CanvasDocumentAppendV3) => {
      if (journal === null) {
        throw new Error("journal is not initialized");
      }
      appends.push(append);
      const operations = [...journal.operations, append.operation];
      journal = CanvasDocumentJournalV3Schema.parse({
        ...journal,
        operations,
        operationBytes: operations.reduce(
          (total, operation) =>
            total +
            new TextEncoder().encode(JSON.stringify(operation)).byteLength,
          0,
        ),
      });
      return CanvasDocumentAppendReceiptV3Schema.parse({
        schemaVersion: 1,
        identity: append.identity,
        operationId: append.operation.id,
        revision: append.operation.expectedRevision + 1,
        stateHash: append.operation.resultingHash,
      });
    }),
    checkpoint: vi.fn(async (snapshot: CanvasDocumentSnapshotV3) => {
      journal = CanvasDocumentJournalV3Schema.parse({
        schemaVersion: 1,
        kind: "canvas-document-v3-journal",
        identity: snapshot.identity,
        snapshot,
        operations: [],
        operationBytes: 0,
      });
    }),
  };
  return { appends, port };
}

describe("runtime capture V3 materialization", () => {
  it("compiles capture truth into one explicit semantic V3 operation", () => {
    const plan = prepareRuntimeCaptureMaterializationV3(seed(), {
      evidenceArtifacts: evidenceArtifacts(),
      expectedDocumentRevision: 0,
      manifest: capture(),
      pageId: ids.page,
      placement: { x: 120, y: 80 },
    });

    expect(plan.operation.type).toBe("atomic.batch");
    expect(plan.operation.action.type).toBe("atomic.batch");
    if (plan.operation.action.type !== "atomic.batch") {
      return;
    }
    expect(plan.operation.action.payload.actions.map(({ type }) => type)).toEqual([
      "asset.define",
      "evidence.define",
      "node.create",
      "node.create",
      "node.create",
      "reconstruction.define",
    ]);
    expect(plan.operation.expectedRevision).toBe(0);
    expect(plan.operation.expectedBeforeHash).toBe(seed().stateHash);
    expect(plan.operation.resultingHash).not.toBe(seed().stateHash);
    expect(JSON.stringify(plan.operation)).not.toContain('"nodesById"');
    expect(JSON.stringify(plan.operation)).not.toContain('"before"');
    expect(JSON.stringify(plan.operation)).not.toContain('"after"');
  });

  it("persists evidence, source anchors, and exact revision/hash across restart", async () => {
    const memory = memoryJournalPort();
    const initial = await CanvasDocumentV3PersistenceAdapter.open(
      seed(),
      memory.port,
    );
    const result = await materializeRuntimeCaptureV3(initial, {
      evidenceArtifacts: evidenceArtifacts(),
      expectedDocumentRevision: 0,
      manifest: capture(),
      pageId: ids.page,
    });

    expect(result.changed).toBe(true);
    expect(result.persistence.document.revision).toBe(1);
    expect(result.persistence.document.operationCursor).toBe(
      result.plan.operation.id,
    );
    expect(result.persistence.document.evidenceById[result.plan.evidenceId]).toMatchObject({
      applicationId: "buzzr-ios",
      route: "/sign-in",
      sourceRevision,
      verification: { status: "verified" },
    });
    expect(
      result.persistence.document.nodesById[result.plan.layerNodeIds["auth.continue.label"]!]
        ?.sourceAnchor,
    ).toMatchObject({
      path: "app/(auth)/sign-in.tsx",
      sourceRevision,
      symbol: "SignInScreen",
    });
    expect(memory.appends).toHaveLength(1);

    const restarted = await CanvasDocumentV3PersistenceAdapter.open(
      seed(),
      memory.port,
    );
    expect(restarted.document.revision).toBe(result.persistence.document.revision);
    expect(restarted.document.stateHash).toBe(result.persistence.document.stateHash);
    expect(restarted.document).toEqual(result.persistence.document);
  });

  it("fails closed before materialization for stale revisions and non-import pages", () => {
    expect(() =>
      prepareRuntimeCaptureMaterializationV3(seed(), {
        evidenceArtifacts: evidenceArtifacts(),
        expectedDocumentRevision: 1,
        manifest: capture(),
        pageId: ids.page,
      }),
    ).toThrow(/expected revision 1.*revision 0/iu);

    const design = createCanvasDocumentV3({
      id: ids.document,
      projectId: ids.project,
      initialPage: { id: ids.page, kind: "design", name: "Design" },
    });
    expect(() =>
      prepareRuntimeCaptureMaterializationV3(design, {
        evidenceArtifacts: evidenceArtifacts(),
        expectedDocumentRevision: 0,
        manifest: capture(),
        pageId: ids.page,
      }),
    ).toThrow(/imported page/iu);
  });

  it("hydrates committed import artifacts through the same durable V3 path", async () => {
    const memory = memoryJournalPort();
    const initial = await CanvasDocumentV3PersistenceAdapter.open(
      seed(),
      memory.port,
    );
    const result = await hydrateCommittedImportCanvasDocumentV3(initial, {
      expectedDocumentRevision: 0,
      job: committedJob(),
      pageId: ids.page,
      reconstructionsByArtifactId: {
        art_01J00000000000000000000000: capture(),
      },
    });

    expect(result.plans).toHaveLength(1);
    expect(result.persistence.document.revision).toBe(1);
    expect(memory.appends).toHaveLength(1);
    expect(memory.appends[0]?.operation.type).toBe("atomic.batch");
    expect(result.persistence.document.pagesById[ids.page]?.rootIds).toHaveLength(2);
    const plan = result.plans[0]!;
    expect(result.persistence.document.evidenceById[plan.evidenceId]).toMatchObject({
      fixtureFingerprint: hashes.workspace,
      geometryArtifactId: "art_01J00000000000000000000004",
      hierarchyArtifactId: "art_01J00000000000000000000003",
      reconstructionArtifactId: "art_01J00000000000000000000005",
      screenshotArtifactId: "art_01J00000000000000000000001",
      verification: { status: "verified" },
    });
    expect(
      result.persistence.document.reconstructionsById[plan.reconstructionId]
        ?.fidelity,
    ).toEqual({
      diffArtifactId: null,
      maximumGeometryDelta: null,
      ssim: null,
      status: "needs-review",
    });

    const restarted = await CanvasDocumentV3PersistenceAdapter.open(
      seed(),
      memory.port,
    );
    const repeated = await hydrateCommittedImportCanvasDocumentV3(restarted, {
      expectedDocumentRevision: restarted.document.revision,
      job: committedJob(),
      pageId: ids.page,
      reconstructionsByArtifactId: {
        art_01J00000000000000000000000: capture(),
      },
    });
    expect(repeated.plans).toHaveLength(0);
    expect(repeated.persistence.document).toEqual(result.persistence.document);
    expect(memory.appends).toHaveLength(1);
  });

  it("preserves verified reconstruction fidelity separately from runtime capture validity", async () => {
    const memory = memoryJournalPort();
    const initial = await CanvasDocumentV3PersistenceAdapter.open(
      seed(),
      memory.port,
    );
    const result = await hydrateCommittedImportCanvasDocumentV3(initial, {
      expectedDocumentRevision: 0,
      job: committedJob(),
      pageId: ids.page,
      reconstructionsByArtifactId: {
        art_01J00000000000000000000000: capture(),
      },
      reconstructionReviewsByArtifactId: {
        art_01J00000000000000000000000: verifiedReconstructionReview(),
      },
    });

    const plan = result.plans[0]!;
    expect(
      result.persistence.document.evidenceById[plan.evidenceId]?.verification
        .status,
    ).toBe("verified");
    expect(
      result.persistence.document.reconstructionsById[plan.reconstructionId]
        ?.fidelity,
    ).toEqual({
      diffArtifactId: "art_01J00000000000000000000006",
      maximumGeometryDelta: 0.25,
      ssim: 0.992,
      status: "verified",
    });
  });
});
