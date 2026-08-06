import { describe, expect, it } from "vitest";

import {
  CanvasDocumentV2Schema,
  CanvasNodeV2Schema,
  CanvasOperationV2Schema,
  CanvasTextV2Schema,
  LegacyCanvasIdMappingReceiptV2Schema,
  SourceAnchorV2Schema,
} from "./canvas-v2.js";
import {
  CanvasComponentBindingV2Schema,
  CanvasSourceBindingV2Schema,
} from "./canvas-v2-semantics.js";

const hash = `sha256:${"0".repeat(64)}`;

describe("Canvas V2 protocol", () => {
  const node = {
    id: "nod_01J00000000000000000000000",
    kind: "frame",
    name: "Frame",
    parentId: null,
    childIds: [],
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    geometry: { width: 320, height: 240 },
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
  };

  it("validates professional text appearance without accepting invalid metrics", () => {
    const appearance = {
      autoResize: "height",
      characters: "Design at the speed of thought",
      fontFamily: "Inter Variable",
      fontSize: 48,
      fontWeight: 500,
      letterSpacing: -0.8,
      lineHeight: 56,
      textAlign: "center",
    };

    expect(CanvasTextV2Schema.safeParse(appearance).success).toBe(true);
    expect(
      CanvasTextV2Schema.safeParse({ ...appearance, fontSize: 0 }).success,
    ).toBe(false);
    expect(
      CanvasTextV2Schema.safeParse({ ...appearance, fontWeight: 950 }).success,
    ).toBe(false);
  });

  it("fails closed on unknown document and operation fields", () => {
    const document = {
      schemaVersion: 2,
      id: "doc_01J00000000000000000000000",
      projectId: "prj_01J00000000000000000000000",
      revision: 0,
      stateHash: hash,
      operationCursor: null,
      rootIds: [],
      nodesById: {},
      componentsById: {},
      tokensById: {},
      appliedOperations: [],
      unexpected: true,
    };

    expect(CanvasDocumentV2Schema.safeParse(document).success).toBe(false);

    const operation = {
      schemaVersion: 2,
      id: "opn_01J00000000000000000000000",
      documentId: document.id,
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-29T12:00:00.000Z",
      actionDigest: hash,
      expectedBeforeHash: hash,
      resultingHash: hash,
      type: "node.transform",
      payload: {
        nodeId: "nod_01J00000000000000000000000",
        prior: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        next: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
        unexpected: true,
      },
    };

    expect(CanvasOperationV2Schema.safeParse(operation).success).toBe(false);
  });

  it("requires exact prior values for reversible mutations", () => {
    const operation = {
      schemaVersion: 2,
      id: "opn_01J00000000000000000000000",
      documentId: "doc_01J00000000000000000000000",
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-29T12:00:00.000Z",
      actionDigest: hash,
      expectedBeforeHash: hash,
      resultingHash: hash,
      type: "node.style",
      payload: {
        nodeId: "nod_01J00000000000000000000000",
        next: { opacity: 0.5 },
      },
    };

    expect(CanvasOperationV2Schema.safeParse(operation).success).toBe(false);
  });

  it("validates truthful source anchors and typed migration receipts", () => {
    const sourceAnchor = {
      path: "app/components/Button.tsx",
      symbol: "Button",
      astPath: ["SourceFile", "Button"],
      range: { start: 10, end: 40 },
      contentHash: `sha256:${"1".repeat(64)}`,
      sourceRevision: "0123456789abcdef",
      dirtyFingerprint: `sha256:${"2".repeat(64)}`,
      componentIdentity: "Button",
      runtimeEvidenceRefs: ["capture:button"],
    };
    expect(SourceAnchorV2Schema.safeParse(sourceAnchor).success).toBe(true);
    expect(
      SourceAnchorV2Schema.safeParse({
        ...sourceAnchor,
        range: { start: 40, end: 10 },
      }).success,
    ).toBe(false);

    const receipt = {
      strategy: "sha256-crockford-v1",
      kind: "node",
      legacyId: "legacy-button",
      canonicalId: "nod_01J00000000000000000000000",
      digest: `sha256:${"3".repeat(64)}`,
    };
    expect(
      LegacyCanvasIdMappingReceiptV2Schema.safeParse(receipt).success,
    ).toBe(true);
    expect(
      LegacyCanvasIdMappingReceiptV2Schema.safeParse({
        ...receipt,
        canonicalId: "doc_01J00000000000000000000000",
      }).success,
    ).toBe(false);
  });

  it("requires explicit captured or placeholder source evidence state", () => {
    const binding = {
      repositoryRevision: "0123456789abcdef",
      repositoryDirty: false,
      dirtyFileFingerprint: null,
      sourceFingerprint: null,
      sourceContentHash: `sha256:${"4".repeat(64)}`,
      sourceAnchor: "app/(tabs)/dashboard.tsx#Dashboard",
      routeId: "dashboard",
      stateId: "default",
      coverageCellId: "dashboard-mobile",
      viewport: { name: "mobile", width: 390, height: 844 },
    };

    expect(CanvasSourceBindingV2Schema.safeParse(binding).success).toBe(false);
    expect(
      CanvasSourceBindingV2Schema.safeParse({
        ...binding,
        captureState: "captured",
      }).success,
    ).toBe(true);
    expect(
      CanvasSourceBindingV2Schema.safeParse({
        ...binding,
        captureState: "placeholder",
      }).success,
    ).toBe(true);
    expect(
      CanvasSourceBindingV2Schema.safeParse({
        ...binding,
        captureState: "marketing-reference",
      }).success,
    ).toBe(false);
  });

  it("rejects internally inconsistent text, instance, and hierarchy state", () => {
    expect(
      CanvasNodeV2Schema.safeParse({
        ...node,
        childIds: [node.id, node.id],
      }).success,
    ).toBe(false);
    expect(
      CanvasNodeV2Schema.safeParse({
        ...node,
        kind: "text",
        text: null,
      }).success,
    ).toBe(false);
    expect(
      CanvasNodeV2Schema.safeParse({
        ...node,
        text: { characters: "Invalid", autoResize: "height" },
      }).success,
    ).toBe(false);
    expect(
      CanvasNodeV2Schema.safeParse({
        ...node,
        kind: "instance",
        componentId: null,
      }).success,
    ).toBe(false);
    expect(
      CanvasNodeV2Schema.safeParse({
        ...node,
        componentId: "cmp_01J00000000000000000000000",
      }).success,
    ).toBe(false);
    expect(
      CanvasNodeV2Schema.safeParse({
        ...node,
        instanceOverrides: { label: "Continue" },
      }).success,
    ).toBe(false);
  });

  it("rejects cycles, broken components, and mismatched token keys", () => {
    const secondId = "nod_01J00000000000000000000001";
    const cyclic = {
      schemaVersion: 2,
      id: "doc_01J00000000000000000000000",
      projectId: "prj_01J00000000000000000000000",
      revision: 0,
      stateHash: hash,
      operationCursor: null,
      rootIds: [],
      nodesById: {
        [node.id]: {
          ...node,
          parentId: secondId,
          childIds: [secondId],
        },
        [secondId]: {
          ...node,
          id: secondId,
          parentId: node.id,
          childIds: [node.id],
        },
      },
      componentsById: {
        cmp_01J00000000000000000000000: {
          id: "cmp_01J00000000000000000000000",
          name: "Broken",
          rootNodeId: "nod_01J00000000000000000000002",
          propertyKeys: [],
        },
      },
      tokensById: {
        "color.ruby": {
          id: "color.other",
          name: "Ruby",
          type: "color",
          value: "#ff5470",
        },
      },
    };

    expect(CanvasDocumentV2Schema.safeParse(cyclic).success).toBe(false);
  });

  it("fails closed on contradictory component authority metadata", () => {
    const binding = {
      atomicLevel: "atom",
      componentId: "cmp_01J00000000000000000000000",
      componentName: "Button",
      classification: "master",
      editable: {
        label: true,
        icon: true,
        selected: false,
        variant: true,
      },
      masterNodeId: "nod_01J00000000000000000000000",
      props: { label: "Continue" },
      role: "button",
      source: {
        repositoryRevision: "0123456789abcdef",
        repositoryDirty: false,
        sourceAnchor: "components/ui/Button.tsx#Button",
        sourceContentHash: `sha256:${"4".repeat(64)}`,
        exportName: "Button",
      },
      variant: "primary",
    };
    expect(
      CanvasComponentBindingV2Schema.safeParse(binding).success,
    ).toBe(false);
    expect(
      CanvasComponentBindingV2Schema.safeParse({
        ...binding,
        classification: "instance",
        masterNodeId: null,
      }).success,
    ).toBe(false);
  });
});
