import { describe, expect, it } from "vitest";

import {
  createCanvasDocumentV2,
  mapLegacyCanvasIdV2,
  prepareCanvasOperationV2,
} from "@memi/canvas-document";
import type { OperationId } from "@memi/protocol";

import { createCanonicalCanvasStore } from "./canonical-canvas-store.js";
import {
  applyRuntimeCaptureToCanonicalStore,
  prepareRuntimeCaptureCanonicalOperation,
  type RuntimeCaptureScreenV1,
} from "./runtime-capture-canonical-adapter.js";

const hashA = `sha256:${"a".repeat(64)}` as const;
const hashB = `sha256:${"b".repeat(64)}` as const;
const hashC = `sha256:${"c".repeat(64)}` as const;
const hashD = `sha256:${"d".repeat(64)}` as const;

const projectId = mapLegacyCanvasIdV2(
  "project",
  "buzzr-ios",
).canonicalId;
const documentId = mapLegacyCanvasIdV2(
  "document",
  "buzzr-ios-mobile-runtime-captures",
).canonicalId;

function capture(
  overrides: Partial<RuntimeCaptureScreenV1> = {},
): RuntimeCaptureScreenV1 {
  return {
    app: {
      appVersion: "2.1",
      buildRevision: "a6ce2458e0cd1b252663057f2e4060f0929c0687",
      environment: "simulator",
      productId: "buzzr-ios",
    },
    artifact: {
      alt: "Buzzr sign-in screen captured in the iOS simulator",
      artifactId: "artifact-buzzr-sign-in-v1",
      hash: hashA,
      height: 1600,
      kind: "image/png",
      src: "/runtime-captures/buzzr/sign-in-v1.png",
      sourceUrl: "memi-source://repository/app/sign-in.tsx",
      width: 736,
    },
    authority: "local_capture",
    binding: {
      coverageCellId: "buzzr:sign-in:guest-entry:mobile",
      normalizedPath: "/sign-in",
      routeId: "buzzr-route-sign-in",
      sourceAnchor: "app/(auth)/sign-in.tsx#SignInScreen",
      sourceContentHash: hashB,
      stateId: "guest-entry",
      viewport: {
        height: 800,
        name: "mobile",
        scale: 2,
        width: 368,
      },
    },
    captureId: "buzzr:capture:buzzr-route-sign-in:guest-entry:mobile",
    capturedAt: "2026-07-29T12:00:00.000Z",
    evidence: {
      accessibilitySnapshotRef: "artifacts/buzzr/sign-in.a11y.json",
      captureMethod: "ios-simulator-screenshot",
      label: "Local capture",
      truthLabel: "Local capture",
      verifier: "automated",
    },
    layers: [
      {
        content: { text: "Welcome to Buzzr" },
        geometry: {
          height: 30,
          rotation: 0,
          width: 220,
          x: 74,
          y: 116,
        },
        kind: "text",
        layerId: "buzzr:layer:buzzr-screen-sign-in:auth.title",
        name: "Welcome title",
        semanticKey: "auth.title",
        source: {
          astPath: ["SignInScreen", "View[0]", "Text[0]"],
          componentId: null,
          exportName: "SignInScreen",
          range: { end: 411, start: 380 },
          sourceAnchor: "app/(auth)/sign-in.tsx#SignInScreen",
          sourceContentHash: hashB,
        },
        style: {
          fontFamily: "Inter",
          fontSize: 24,
          fontWeight: 500,
          lineHeight: 30,
          opacity: 1,
          textColor: "#f7f8f8",
        },
        zIndex: 1,
      },
      {
        content: {},
        geometry: {
          cornerRadius: 12,
          height: 48,
          rotation: 0,
          width: 320,
          x: 24,
          y: 680,
        },
        kind: "group",
        layerId: "buzzr:layer:buzzr-screen-sign-in:auth.continue",
        name: "Continue button",
        semanticKey: "auth.continue",
        source: {
          astPath: ["SignInScreen", "Button[0]"],
          componentId: "Button.Primary",
          exportName: "SignInScreen",
          range: { end: 920, start: 810 },
          sourceAnchor: "app/(auth)/sign-in.tsx#SignInScreen",
          sourceContentHash: hashB,
        },
        style: {
          fill: "#14f195",
          opacity: 1,
        },
        zIndex: 2,
      },
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
        layerId: "buzzr:layer:buzzr-screen-sign-in:auth.continue.label",
        name: "Continue label",
        parentLayerId:
          "buzzr:layer:buzzr-screen-sign-in:auth.continue",
        semanticKey: "auth.continue.label",
        source: {
          astPath: ["SignInScreen", "Button[0]", "Text[0]"],
          componentId: "Button.Primary",
          exportName: "SignInScreen",
          range: { end: 899, start: 881 },
          sourceAnchor: "app/(auth)/sign-in.tsx#SignInScreen",
          sourceContentHash: hashB,
        },
        style: {
          fontFamily: "Inter",
          fontSize: 15,
          fontWeight: 500,
          lineHeight: 20,
          opacity: 1,
          textAlign: "center",
          textColor: "#08090a",
        },
        zIndex: 3,
      },
    ],
    repository: {
      dirty: true,
      dirtyFileFingerprint: hashD,
      revision: "a6ce2458e0cd1b252663057f2e4060f0929c0687",
      rootPath: "/fixtures/products/buzzr",
      sourceFingerprint: hashC,
    },
    schemaVersion: 1,
    screenId: "buzzr-screen-sign-in",
    screenName: "Sign in · Guest entry",
    ...overrides,
  };
}

function store() {
  let sequence = 1;
  return createCanonicalCanvasStore({
    allocateHistoryOperation: (direction, entry) =>
      ({
        actor: "system",
        actorId: "runtime-capture-test",
        id: mapLegacyCanvasIdV2(
          "operation",
          `history:${sequence++}:${direction}:${entry.id}`,
        ).canonicalId as OperationId,
        occurredAt: "2026-07-29T12:00:00.000Z",
      }) as const,
    document: createCanvasDocumentV2({ id: documentId, projectId }),
  });
}

describe("runtime capture canonical adapter", () => {
  it("imports one screen reference and its ordered editable hierarchy as one immutable operation", () => {
    const canonical = store();
    const manifest = capture();

    const result = applyRuntimeCaptureToCanonicalStore(canonical, {
      expectedDocumentRevision: 0,
      manifest,
    });

    expect(result).toMatchObject({
      changed: true,
      ok: true,
      reconstruction: {
        reviewStatus: "needs-review",
      },
      revision: 1,
    });
    if (!result.ok) {
      return;
    }
    const snapshot = canonical.getSnapshot();
    const frame = snapshot.document.nodesById[result.frameId];
    const reference = snapshot.document.nodesById[result.referenceId];
    const titleId = result.layerNodeIds["auth.title"];
    const buttonId = result.layerNodeIds["auth.continue"];
    const labelId = result.layerNodeIds["auth.continue.label"];
    expect(frame).toMatchObject({
      childIds: [titleId, buttonId],
      geometry: { height: 800, width: 368 },
      kind: "imported-source-frame",
      referenceBinding: null,
      sourceAnchor: null,
      sourceBinding: {
        captureState: "captured",
        repositoryRevision: manifest.repository.revision,
        routeId: manifest.binding.routeId,
        stateId: manifest.binding.stateId,
        viewport: { height: 800, name: "mobile", width: 368 },
      },
      style: { locked: false },
    });
    expect(reference).toMatchObject({
      childIds: [],
      kind: "imported-source-frame",
      parentId: null,
      referenceBinding: {
        accessibilitySnapshotRef:
          manifest.evidence.accessibilitySnapshotRef,
        authority: "Local capture",
        captureId: manifest.captureId,
        componentIds: ["Button.Primary"],
        contentHash: manifest.artifact.hash,
        src: manifest.artifact.src,
        sourceRevision: manifest.repository.revision,
        sourceAnchors: [
          "app/(auth)/sign-in.tsx#SignInScreen",
        ],
      },
      sourceBinding: null,
      style: {
        fills: [
          {
            artifactId: manifest.artifact.artifactId,
            scaleMode: "fill",
            type: "image",
          },
        ],
        locked: true,
        visible: false,
      },
    });
    expect(snapshot.document.rootIds).toEqual([
      result.frameId,
      result.referenceId,
    ]);
    expect(result.reconstruction).toMatchObject({
      evidenceNodeId: result.referenceId,
      frameId: result.frameId,
      reviewStatus: "needs-review",
    });
    expect(result.reconstruction.layers["auth.continue"]).toMatchObject({
      confidence: 1,
      evidenceRefs: expect.arrayContaining([
        manifest.artifact.artifactId,
      ]),
      nodeId: buttonId,
    });
    expect(snapshot.document.nodesById[buttonId ?? ""]?.childIds).toEqual([
      labelId,
    ]);
    expect(snapshot.document.nodesById[labelId ?? ""]).toMatchObject({
      parentId: buttonId,
      sourceAnchor: {
        astPath: ["SignInScreen", "Button[0]", "Text[0]"],
        contentHash: hashB,
        dirtyFingerprint: hashD,
        path: "app/(auth)/sign-in.tsx",
        runtimeEvidenceRefs: [
          "artifact-buzzr-sign-in-v1",
          "runtime-capture:buzzr:capture:buzzr-route-sign-in:guest-entry:mobile",
        ],
        symbol: "SignInScreen",
      },
      text: { characters: "Continue as guest", textAlign: "center" },
      transform: { x: 90, y: 14 },
    });
    expect(Object.isFrozen(snapshot.document)).toBe(true);
    expect(Object.isFrozen(frame)).toBe(true);
    const history = canonical.getHistorySnapshot();
    expect(history.past).toHaveLength(1);
    expect(history.past[0]?.operation.type).toBe("atomic.batch");
    expect(JSON.stringify(history)).not.toContain('"before"');
    expect(JSON.stringify(history)).not.toContain('"after"');
  });

  it("produces deterministic IDs, operation hashes, and no-op replay for the same manifest", () => {
    const first = store();
    const second = store();
    const manifest = capture();
    const firstPlan = prepareRuntimeCaptureCanonicalOperation(
      first.getSnapshot().document,
      manifest,
    );
    const secondPlan = prepareRuntimeCaptureCanonicalOperation(
      second.getSnapshot().document,
      structuredClone(manifest),
    );

    expect(secondPlan).toEqual(firstPlan);
    expect(firstPlan.operation?.expectedBeforeHash).toBe(
      first.getSnapshot().document.stateHash,
    );
    expect(
      applyRuntimeCaptureToCanonicalStore(first, {
        expectedDocumentRevision: 0,
        manifest,
      }),
    ).toMatchObject({ changed: true, ok: true });
    expect(
      applyRuntimeCaptureToCanonicalStore(first, {
        expectedDocumentRevision: 1,
        manifest,
      }),
    ).toMatchObject({ changed: false, ok: true, revision: 1 });
    expect(first.getHistorySnapshot().past).toHaveLength(1);
  });

  it("revision-safely reimports into the same frame while preserving canvas placement", () => {
    const canonical = store();
    const initial = applyRuntimeCaptureToCanonicalStore(canonical, {
      expectedDocumentRevision: 0,
      manifest: capture(),
      placement: { x: 140, y: 220 },
    });
    expect(initial.ok).toBe(true);
    if (!initial.ok) {
      return;
    }
    const beforeMove = canonical.getSnapshot().document;
    const frame = beforeMove.nodesById[initial.frameId];
    if (frame === undefined) {
      throw new Error("Expected imported capture frame.");
    }
    const move = prepareCanvasOperationV2(beforeMove, {
      action: {
        payload: {
          next: { ...frame.transform, x: 420, y: 360 },
          nodeId: frame.id,
        },
        type: "node.transform",
      },
      actor: "human",
      actorId: "runtime-capture-test",
      id: mapLegacyCanvasIdV2(
        "operation",
        "move-runtime-capture-frame",
      ).canonicalId,
      occurredAt: "2026-07-29T12:01:00.000Z",
    });
    expect(canonical.dispatch(move).ok).toBe(true);

    const recapture = capture({
      artifact: {
        ...capture().artifact,
        artifactId: "artifact-buzzr-sign-in-v2",
        hash: hashC,
        src: "/runtime-captures/buzzr/sign-in-v2.png",
        sourceUrl: "memi-source://repository/app/sign-in.tsx",
      },
      capturedAt: "2026-07-29T12:02:00.000Z",
      layers: [
        {
          ...capture().layers[1]!,
          zIndex: 1,
        },
        {
          ...capture().layers[2]!,
          content: { text: "Continue" },
          zIndex: 2,
        },
        {
          ...capture().layers[0]!,
          content: { text: "Welcome back" },
          zIndex: 3,
        },
      ],
      repository: {
        ...capture().repository,
        revision: "b6ce2458e0cd1b252663057f2e4060f0929c0688",
      },
    });
    const result = applyRuntimeCaptureToCanonicalStore(canonical, {
      expectedDocumentRevision: 2,
      manifest: recapture,
    });

    expect(result).toMatchObject({
      changed: true,
      frameId: initial.frameId,
      ok: true,
      revision: 3,
    });
    if (!result.ok) {
      return;
    }
    const next = canonical.getSnapshot().document;
    expect(next.nodesById[result.frameId]?.transform).toMatchObject({
      x: 420,
      y: 360,
    });
    expect(next.nodesById[result.referenceId]?.referenceBinding?.src).toBe(
      recapture.artifact.src,
    );
    const buttonId = result.layerNodeIds["auth.continue"];
    const titleId = result.layerNodeIds["auth.title"];
    expect(next.nodesById[result.frameId]?.childIds).toEqual([
      buttonId,
      titleId,
    ]);
    expect(next.nodesById[result.referenceId]).toMatchObject({
      parentId: null,
      style: { visible: false },
    });
    expect(
      next.nodesById[result.layerNodeIds["auth.continue.label"] ?? ""]?.text
        ?.characters,
    ).toBe("Continue");
    expect(canonical.getHistorySnapshot().past).toHaveLength(3);
    expect(
      canonical.getHistorySnapshot().past.at(-1)?.operation.type,
    ).toBe("atomic.batch");
  });

  it("rejects a stale recapture without mutating document or history", () => {
    const canonical = store();
    expect(
      applyRuntimeCaptureToCanonicalStore(canonical, {
        expectedDocumentRevision: 0,
        manifest: capture(),
      }).ok,
    ).toBe(true);
    const before = canonical.getSnapshot();
    const historyBefore = canonical.getHistorySnapshot();

    const stale = applyRuntimeCaptureToCanonicalStore(canonical, {
      expectedDocumentRevision: 0,
      manifest: capture({ capturedAt: "2026-07-29T12:03:00.000Z" }),
    });

    expect(stale).toMatchObject({
      code: "stale-document",
      ok: false,
    });
    expect(canonical.getSnapshot()).toEqual(before);
    expect(canonical.getHistorySnapshot()).toEqual(historyBefore);
  });

  it("normalizes supported visual layer variants without weakening source anchors", () => {
    const source = capture().layers[0]!.source;
    const geometry = {
      height: 40,
      rotation: 0,
      width: 120,
      x: 20,
      y: 20,
    };
    const variants = capture({
      artifact: {
        alt: "Buzzr sign-in screen captured in the iOS simulator",
        artifactId: "artifact-buzzr-sign-in-v1",
        hash: hashA,
        height: 1600,
        kind: "image/png",
        src: "/runtime-captures/buzzr/sign-in-v1.png",
        width: 736,
      },
      layers: [
        {
          content: {},
          geometry,
          kind: "frame",
          layerId: "variant-frame",
          layout: {
            align: "stretch",
            flex: { direction: "column", wrap: true },
            gap: 8,
            justify: "space-between",
            padding: { bottom: 4, left: 4, right: 4, top: 4 },
            position: "absolute",
          },
          name: "Variant frame",
          semanticKey: "variant.frame",
          source,
          style: {
            fill: "#121212",
            opacity: 0.8,
            stroke: "#383b3f",
          },
          zIndex: 0,
        },
        {
          content: { imageRef: "variant-image-artifact" },
          geometry: { ...geometry, x: 28, y: 28 },
          kind: "image",
          layerId: "variant-image",
          name: "Variant image",
          parentLayerId: "variant-frame",
          semanticKey: "variant.image",
          source,
          style: {},
          zIndex: 1,
        },
        {
          content: { text: "Fill fallback" },
          geometry: { ...geometry, y: 80 },
          kind: "text",
          layerId: "variant-text",
          name: "Variant text",
          semanticKey: "variant.text",
          source,
          style: { fill: "#f7f8f8" },
          zIndex: 2,
        },
        {
          content: {},
          geometry: { ...geometry, y: 130 },
          kind: "component-instance",
          layerId: "variant-instance",
          name: "Variant instance",
          semanticKey: "variant.instance",
          source,
          style: {},
          zIndex: 3,
        },
        {
          content: { iconName: "bell" },
          geometry: { ...geometry, y: 180 },
          kind: "icon",
          layerId: "variant-icon",
          name: "Variant icon",
          semanticKey: "variant.icon",
          source,
          style: {},
          zIndex: 4,
        },
        {
          content: {},
          geometry: { ...geometry, cornerRadius: 10, y: 230 },
          kind: "shape",
          layerId: "variant-shape",
          name: "Variant shape",
          semanticKey: "variant.shape",
          source,
          style: { fill: "#ff5470" },
          zIndex: 5,
        },
      ],
    });
    const canonical = store();

    const result = applyRuntimeCaptureToCanonicalStore(canonical, {
      expectedDocumentRevision: 0,
      manifest: variants,
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const document = canonical.getSnapshot().document;
    expect(document.nodesById[result.layerNodeIds["variant.frame"] ?? ""])
      .toMatchObject({
        layout: {
          alignCounter: "stretch",
          alignPrimary: "space-between",
          gap: 8,
          mode: "vertical",
          wrap: true,
        },
      });
    expect(document.nodesById[result.layerNodeIds["variant.image"] ?? ""])
      .toMatchObject({
        content: {
          artifactId: "variant-image-artifact",
          type: "image",
        },
        kind: "image",
      });
    expect(document.nodesById[result.layerNodeIds["variant.instance"] ?? ""]?.kind)
      .toBe("group");
    expect(document.nodesById[result.layerNodeIds["variant.icon"] ?? ""]?.kind)
      .toBe("vector");
  });

  it("rejects malformed capture hierarchies, identity collisions, and store failures", () => {
    const base = capture();
    const invalidCaptures: RuntimeCaptureScreenV1[] = [
      {
        ...base,
        layers: [
          { ...base.layers[0]!, semanticKey: "duplicate" },
          { ...base.layers[1]!, semanticKey: "duplicate" },
        ],
      },
      {
        ...base,
        layers: [
          {
            ...base.layers[0]!,
            parentLayerId: "missing-parent",
          },
        ],
      },
      {
        ...base,
        layers: [
          {
            ...base.layers[0]!,
            layerId: "cycle-a",
            parentLayerId: "cycle-b",
          },
          {
            ...base.layers[1]!,
            layerId: "cycle-b",
            parentLayerId: "cycle-a",
          },
        ],
      },
      {
        ...base,
        layers: [
          {
            ...base.layers[0]!,
            source: {
              ...base.layers[0]!.source,
              range: { end: 2, start: 3 },
            },
          },
        ],
      },
      {
        ...base,
        layers: [
          {
            ...base.layers[0]!,
            content: {},
          },
        ],
      },
      {
        ...base,
        layers: [
          {
            ...base.layers[0]!,
            source: {
              ...base.layers[0]!.source,
              sourceAnchor: "missing-symbol.tsx",
            },
          },
        ],
      },
    ];
    for (const invalid of invalidCaptures) {
      expect(
        applyRuntimeCaptureToCanonicalStore(store(), {
          expectedDocumentRevision: 0,
          manifest: invalid,
        }),
      ).toMatchObject({ code: "invalid-capture", ok: false });
    }

    const canonical = store();
    expect(
      applyRuntimeCaptureToCanonicalStore(canonical, {
        expectedDocumentRevision: 0,
        manifest: base,
      }).ok,
    ).toBe(true);
    expect(
      applyRuntimeCaptureToCanonicalStore(canonical, {
        expectedDocumentRevision: 1,
        manifest: {
          ...base,
          binding: {
            ...base.binding,
            routeId: "different-route",
          },
        },
      }),
    ).toMatchObject({ code: "invalid-capture", ok: false });

    const rejectingStore = {
      ...store(),
      dispatch: () =>
        ({
          code: "invalid-operation",
          message: "Synthetic store rejection.",
          ok: false,
        }) as const,
    };
    expect(
      applyRuntimeCaptureToCanonicalStore(rejectingStore, {
        expectedDocumentRevision: 0,
        manifest: base,
      }),
    ).toEqual({
      code: "store-rejected",
      message: "Synthetic store rejection.",
      ok: false,
    });
  });

});
