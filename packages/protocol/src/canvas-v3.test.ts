import { describe, expect, it } from "vitest";

import {
  CanvasDocumentV3Schema,
  CanvasNodeV3Schema,
  CanvasOperationV3Schema,
  EditableReconstructionV1Schema,
  InteractionSessionStateSchema,
  RuntimeEvidenceV1Schema,
  type CanvasDocumentV3,
  type CanvasNodeV3,
} from "./canvas-v3.js";

const ids = {
  project: "prj_01J00000000000000000000000",
  document: "doc_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
  node: "nod_01J00000000000000000000000",
  operation: "opn_01J00000000000000000000000",
  screenshot: "art_01J00000000000000000000000",
  hierarchy: "art_01J00000000000000000000001",
  geometry: "art_01J00000000000000000000002",
  diff: "art_01J00000000000000000000003",
  reconstructionArtifact: "art_01J00000000000000000000004",
  evidence: "evd_01J00000000000000000000000",
  reconstruction: "rec_01J00000000000000000000000",
} as const;

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;

function node(): CanvasNodeV3 {
  return CanvasNodeV3Schema.parse({
    id: ids.node,
    pageId: ids.page,
    kind: "frame",
    name: "Landing page",
    parentId: null,
    childIds: [],
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    geometry: { width: 1440, height: 900 },
    style: {
      opacity: 1,
      visible: true,
      locked: false,
      fills: [],
      strokes: [],
      cornerRadii: [0, 0, 0, 0],
    },
    layout: {
      mode: "none",
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      alignPrimary: "start",
      alignCounter: "start",
      wrap: false,
      sizingHorizontal: "fixed",
      sizingVertical: "fixed",
    },
    text: null,
    content: null,
    componentId: null,
    instanceOverrides: {},
    componentBinding: null,
    provenance: null,
    referenceBinding: null,
    sourceAnchor: null,
    sourceBinding: null,
  });
}

function document(): CanvasDocumentV3 {
  return CanvasDocumentV3Schema.parse({
    schemaVersion: 3,
    id: ids.document,
    projectId: ids.project,
    revision: 0,
    stateHash: hash("0"),
    operationCursor: null,
    pageIds: [ids.page],
    pagesById: {
      [ids.page]: {
        id: ids.page,
        kind: "design",
        name: "Page 1",
        rootIds: [ids.node],
      },
    },
    nodesById: { [ids.node]: node() },
    componentsById: {},
    variableCollectionsById: {},
    variablesById: {},
    assetsById: {},
    prototypeConnectionsById: {},
    evidenceById: {},
    reconstructionsById: {},
  });
}

function evidence() {
  return RuntimeEvidenceV1Schema.parse({
    schemaVersion: 1 as const,
    id: ids.evidence,
    applicationId: "buzzr-ios",
    scenarioId: "auth-sign-in-default",
    route: "/sign-in",
    state: "default",
    sourceRevision: "a6ce245",
    fixtureFingerprint: hash("1"),
    screenshotArtifactId: ids.screenshot,
    hierarchyArtifactId: ids.hierarchy,
    geometryArtifactId: ids.geometry,
    capturedAt: "2026-07-31T12:00:00.000Z",
    viewport: {
      name: "iPhone 16 Pro",
      logicalWidth: 390,
      logicalHeight: 844,
      pixelWidth: 1170,
      pixelHeight: 2532,
      scale: 3,
    },
    verification: {
      status: "verified" as const,
      stableFrameHashes: [hash("2"), hash("2")] as const,
      rejectionReasons: [],
    },
  });
}

describe("Canvas V3 protocol", () => {
  it("validates a normalized multi-page document and rejects cross-page roots", () => {
    expect(CanvasDocumentV3Schema.parse(document())).toEqual(document());

    const invalid = structuredClone(document());
    invalid.pagesById[ids.page]!.id =
      "pag_01J00000000000000000000001" as CanvasNodeV3["pageId"];
    expect(() => CanvasDocumentV3Schema.parse(invalid)).toThrow();
  });

  it("requires verified runtime evidence to contain two identical stable frames", () => {
    expect(evidence().reconstructionArtifactId).toBeNull();
    expect(
      RuntimeEvidenceV1Schema.parse({
        ...evidence(),
        reconstructionArtifactId: ids.reconstructionArtifact,
      }).reconstructionArtifactId,
    ).toBe(ids.reconstructionArtifact);

    const stable = evidence();
    const unstable = {
      ...stable,
      verification: {
        ...stable.verification,
        stableFrameHashes: [
          stable.verification.stableFrameHashes[0],
          hash("3"),
        ],
      },
    };
    expect(() => RuntimeEvidenceV1Schema.parse(unstable)).toThrow(/stable/i);
  });

  it("does not allow a reconstruction to claim verification below the fidelity gate", () => {
    const reconstruction = {
      schemaVersion: 1,
      id: ids.reconstruction,
      pageId: ids.page,
      evidenceId: ids.evidence,
      editableRootIds: [ids.node],
      confidenceByNodeId: {
        [ids.node]: {
          score: 0.98,
          basis: ["runtime-geometry", "source-anchor"],
        },
      },
      fidelity: {
        status: "verified",
        ssim: 0.984,
        maximumGeometryDelta: 0.5,
        diffArtifactId: ids.diff,
      },
    };
    expect(() =>
      EditableReconstructionV1Schema.parse(reconstruction),
    ).toThrow(/SSIM/i);
  });

  it("keeps selection and gesture state transient, bounded, and internally consistent", () => {
    const session = {
      schemaVersion: 1,
      documentId: ids.document,
      documentRevision: 4,
      selection: {
        selectedIds: [ids.node],
        anchorId: ids.node,
        focusedNodeId: ids.node,
        editingNodeId: null,
      },
      viewport: {
        translation: { x: 12, y: 18 },
        zoom: 1,
        width: 1440,
        height: 900,
        pointerMode: "select",
      },
      hover: { nodeId: null },
      gesture: null,
    };
    expect(InteractionSessionStateSchema.parse(session)).toEqual(session);
    expect(() =>
      InteractionSessionStateSchema.parse({
        ...session,
        selection: { ...session.selection, selectedIds: [] },
      }),
    ).toThrow(/anchor/i);
  });

  it("requires a closed forward action, inverse action, and matching operation type", () => {
    const action = {
      type: "node.transform" as const,
      payload: {
        nodeId: ids.node,
        prior: node().transform,
        next: { ...node().transform, x: 20 },
      },
    };
    const operation = {
      schemaVersion: 3,
      id: ids.operation,
      documentId: ids.document,
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-31T12:00:00.000Z",
      label: "Move landing page",
      targetIds: [ids.node],
      undoOf: null,
      traceId: null,
      expectedRevision: 0,
      previousOperationCursor: null,
      expectedBeforeHash: hash("0"),
      resultingHash: hash("1"),
      actionDigest: hash("2"),
      type: action.type,
      action,
      inverseAction: {
        type: action.type,
        payload: {
          nodeId: ids.node,
          prior: action.payload.next,
          next: action.payload.prior,
        },
      },
    };
    expect(CanvasOperationV3Schema.parse(operation)).toEqual(operation);
    expect(() =>
      CanvasOperationV3Schema.parse({ ...operation, type: "node.style" }),
    ).toThrow(/type/i);
    expect(
      CanvasOperationV3Schema.safeParse({
        ...operation,
        inverseAction: {
          type: "node.geometry",
          payload: {
            nodeId: ids.node,
            prior: node().geometry,
            next: node().geometry,
          },
        },
      }).success,
    ).toBe(false);

    const geometryAction = {
      type: "node.geometry" as const,
      payload: {
        nodeId: ids.node,
        prior: node().geometry,
        next: { ...node().geometry, width: 480 },
      },
    };
    expect(
      CanvasOperationV3Schema.safeParse({
        ...operation,
        type: "atomic.batch",
        action: {
          type: "atomic.batch",
          payload: { actions: [action, geometryAction] },
        },
        inverseAction: {
          type: "atomic.batch",
          payload: {
            actions: [
              operation.inverseAction,
              {
                type: "node.geometry",
                payload: {
                  nodeId: ids.node,
                  prior: geometryAction.payload.next,
                  next: geometryAction.payload.prior,
                },
              },
            ],
          },
        },
      }).success,
    ).toBe(false);
  });
});
