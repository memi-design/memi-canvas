import { describe, expect, it } from "vitest";

import {
  type CanvasActionIntentV2,
  type CanvasDocumentV2,
  type CanvasNodeV2,
} from "@memi/protocol";

import {
  applyCanvasOperationV2,
  createCanvasDocumentV2,
  invertCanvasOperationV2,
  prepareCanvasOperationV2,
} from "./v2.js";

const id = {
  project: "prj_01J00000000000000000000000",
  document: "doc_01J00000000000000000000000",
  sourceNode: "nod_01J00000000000000000000010",
  frameNode: "nod_01J00000000000000000000011",
  masterNode: "nod_01J00000000000000000000012",
  instanceNode: "nod_01J00000000000000000000013",
  component: "cmp_01J00000000000000000000010",
  operation: [
    "opn_01J00000000000000000000010",
    "opn_01J00000000000000000000011",
    "opn_01J00000000000000000000012",
    "opn_01J00000000000000000000013",
    "opn_01J00000000000000000000014",
    "opn_01J00000000000000000000015",
    "opn_01J00000000000000000000016",
    "opn_01J00000000000000000000017",
    "opn_01J00000000000000000000018",
    "opn_01J00000000000000000000019",
  ],
} as const;

const provenance = {
  repositoryRevision: "0123456789abcdef",
  repositoryDirty: true,
  dirtyFileFingerprint: `sha256:${"1".repeat(64)}`,
  sourceFingerprint: `sha256:${"2".repeat(64)}`,
  sourceContentHash: `sha256:${"3".repeat(64)}`,
  sourceAnchor: "app/(tabs)/dashboard.tsx#Dashboard",
  captureState: "captured" as const,
  routeId: "dashboard",
  stateId: "default",
  coverageCellId: "dashboard-mobile",
} as const;

const sourceBinding = {
  ...provenance,
  viewport: { name: "mobile" as const, width: 390, height: 844 },
};

function node(
  nodeId: string,
  kind: CanvasNodeV2["kind"],
): CanvasNodeV2 {
  return {
    id: nodeId as CanvasNodeV2["id"],
    kind,
    name: "Dashboard",
    parentId: null,
    childIds: [],
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    geometry: { width: 390, height: 844 },
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
}

function prepare(
  document: CanvasDocumentV2,
  action: CanvasActionIntentV2,
  index: number,
) {
  return prepareCanvasOperationV2(document, {
    id: id.operation[index]!,
    actor: "human",
    actorId: "local-user",
    occurredAt: `2026-07-29T15:00:0${index}.000Z`,
    action,
  });
}

describe("Canvas V2 professional semantics", () => {
  it("round-trips typed identity and kind-safe frame content", () => {
    const empty = createCanvasDocumentV2({
      id: id.document,
      projectId: id.project,
    });
    const create = prepare(empty, {
      type: "node.create",
      payload: {
        node: node(id.frameNode, "frame"),
        parentId: null,
        index: 0,
      },
    }, 0);
    let document = applyCanvasOperationV2(empty, create);
    const identity = prepare(document, {
      type: "node.identity",
      payload: {
        nodeId: id.frameNode,
        next: { kind: "frame", name: "Editable dashboard" },
      },
    }, 1);
    document = applyCanvasOperationV2(document, identity);
    const content = prepare(document, {
      type: "node.content",
      payload: {
        nodeId: id.frameNode,
        next: {
          type: "frame",
          format: "tsx-preview",
          value: "<Dashboard />",
        },
      },
    }, 2);
    const changed = applyCanvasOperationV2(document, content);
    const inverse = invertCanvasOperationV2(changed, content, {
      id: id.operation[3],
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-29T15:00:03.000Z",
    });
    const restored = applyCanvasOperationV2(changed, inverse);

    expect(changed.nodesById[id.frameNode]).toMatchObject({
      name: "Editable dashboard",
      content: { type: "frame", value: "<Dashboard />" },
    });
    expect(restored.nodesById[id.frameNode]?.content).toBeNull();
  });

  it("detaches source authority atomically with exact provenance", () => {
    const empty = createCanvasDocumentV2({
      id: id.document,
      projectId: id.project,
    });
    const sourceNode = {
      ...node(id.sourceNode, "imported-source-frame"),
      content: {
        type: "frame" as const,
        format: "tsx-preview" as const,
        value: "<Dashboard />",
      },
      sourceBinding,
    };
    const create = prepare(empty, {
      type: "node.create",
      payload: { node: sourceNode, parentId: null, index: 0 },
    }, 0);
    const sourceDocument = applyCanvasOperationV2(empty, create);
    expect(() =>
      prepare(sourceDocument, {
        type: "node.identity",
        payload: {
          nodeId: id.sourceNode,
          next: { kind: "frame", name: "Unsafe detach" },
        },
      }, 1),
    ).toThrow(/detach/i);
    expect(() =>
      prepare(sourceDocument, {
        type: "node.provenance",
        payload: {
          nodeId: id.sourceNode,
          next: {
            provenance,
            referenceBinding: null,
            sourceBinding: null,
          },
        },
      }, 1),
    ).toThrow(/detach/i);
    const detachedSourceNext = {
      identity: { kind: "frame" as const, name: "Dashboard draft" },
      content: sourceNode.content,
      provenance: {
        provenance,
        referenceBinding: null,
        sourceBinding: null,
      },
      component: {
        componentBinding: null,
        componentId: null,
        instanceOverrides: {},
      },
    };
    expect(() =>
      prepare(sourceDocument, {
        type: "node.detach",
        payload: {
          nodeId: id.sourceNode,
          next: {
            ...detachedSourceNext,
            provenance: {
              ...detachedSourceNext.provenance,
              provenance: {
                ...provenance,
                repositoryRevision: "forged-revision",
              },
            },
          },
        },
      }, 1),
    ).toThrow(/evidence|provenance/i);
    const detach = prepare(sourceDocument, {
      type: "node.detach",
      payload: {
        nodeId: id.sourceNode,
        next: detachedSourceNext,
      },
    }, 1);
    const detached = applyCanvasOperationV2(sourceDocument, detach);
    if (detach.type !== "node.detach") {
      throw new Error("Expected node.detach operation.");
    }
    const unprovenRestore = prepare(detached, {
      type: "node.detach",
      payload: {
        nodeId: id.sourceNode,
        next: detach.payload.prior,
      },
    }, 3);
    expect(() =>
      applyCanvasOperationV2(detached, unprovenRestore),
    ).toThrow(/undo proof/i);
    const inverse = invertCanvasOperationV2(detached, detach, {
      id: id.operation[2],
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-29T15:00:02.000Z",
    });
    const restored = applyCanvasOperationV2(detached, inverse);

    expect(detached.nodesById[id.sourceNode]).toMatchObject({
      kind: "frame",
      name: "Dashboard draft",
      sourceBinding: null,
      provenance,
    });
    expect(restored.nodesById[id.sourceNode]).toMatchObject({
      kind: "imported-source-frame",
      sourceBinding,
      provenance: null,
    });
  });

  it("rejects arbitrary metadata and kind-incompatible content", () => {
    const invalidMetadata = {
      ...node(id.frameNode, "frame"),
      provenance: { arbitrary: "unvalidated" },
    };
    const invalidContent = {
      ...node(id.frameNode, "rectangle"),
      content: {
        type: "frame",
        format: "plain-text",
        value: "not valid for a rectangle",
      },
    };
    const empty = createCanvasDocumentV2({
      id: id.document,
      projectId: id.project,
    });

    expect(() =>
      prepare(empty, {
        type: "node.create",
        payload: {
          node: invalidMetadata as unknown as CanvasNodeV2,
          parentId: null,
          index: 0,
        },
      }, 0),
    ).toThrow(/unrecognized|provenance|invalid/i);
    expect(() =>
      prepare(empty, {
        type: "node.create",
        payload: {
          node: invalidContent as unknown as CanvasNodeV2,
          parentId: null,
          index: 0,
        },
      }, 0),
    ).toThrow(/content|frame/i);
  });

  it("updates and detaches component metadata without losing undo proof", () => {
    const empty = createCanvasDocumentV2({
      id: id.document,
      projectId: id.project,
    });
    const componentSource = {
      repositoryRevision: "0123456789abcdef",
      repositoryDirty: false,
      sourceAnchor: "components/ui/Button.tsx#Button",
      sourceContentHash: `sha256:${"4".repeat(64)}`,
      exportName: "Button",
    };
    const masterBinding = {
      atomicLevel: "atom" as const,
      componentId: id.component as never,
      componentName: "Button",
      classification: "master" as const,
      editable: {
        label: true,
        icon: true,
        selected: false,
        variant: true,
      },
      masterNodeId: null,
      props: { label: "Continue" },
      role: "button" as const,
      source: componentSource,
      variant: "primary",
    };
    const master = {
      ...node(id.masterNode, "component"),
      componentBinding: masterBinding,
    };
    const createMaster = prepare(empty, {
      type: "node.create",
      payload: { node: master, parentId: null, index: 0 },
    }, 0);
    let document = applyCanvasOperationV2(empty, createMaster);
    const define = prepare(document, {
      type: "component.define",
      payload: {
        componentId: id.component,
        next: {
          id: id.component as never,
          name: "Button",
          rootNodeId: id.masterNode as never,
          propertyKeys: ["label", "icon", "variant"],
        },
      },
    }, 1);
    document = applyCanvasOperationV2(document, define);
    const instanceBinding = {
      ...masterBinding,
      classification: "instance" as const,
      masterNodeId: id.masterNode as never,
      props: { label: "Follow" },
    };
    const instance = {
      ...node(id.instanceNode, "instance"),
      componentId: id.component as never,
      componentBinding: instanceBinding,
      instanceOverrides: { label: "Follow" },
    };
    const createInstance = prepare(document, {
      type: "node.create",
      payload: { node: instance, parentId: null, index: 1 },
    }, 2);
    document = applyCanvasOperationV2(document, createInstance);
    const componentChange = prepare(document, {
      type: "node.component",
      payload: {
        nodeId: id.instanceNode,
        next: {
          componentId: id.component as never,
          componentBinding: {
            ...instanceBinding,
            props: { label: "Maybe later" },
            variant: "secondary",
          },
          instanceOverrides: { label: "Maybe later" },
        },
      },
    }, 3);
    document = applyCanvasOperationV2(document, componentChange);
    expect(
      document.nodesById[id.instanceNode]?.componentBinding?.variant,
    ).toBe("secondary");

    const componentProvenance = {
      repositoryRevision: componentSource.repositoryRevision,
      repositoryDirty: componentSource.repositoryDirty,
      dirtyFileFingerprint: null,
      sourceFingerprint: null,
      sourceContentHash: componentSource.sourceContentHash,
      sourceAnchor: componentSource.sourceAnchor,
      captureState: null,
      routeId: null,
      stateId: null,
      coverageCellId: null,
    };
    const detachedComponentNext = {
      identity: { kind: "frame" as const, name: "Detached button" },
      content: {
        type: "frame" as const,
        format: "plain-text" as const,
        value: "Follow",
      },
      provenance: {
        provenance: componentProvenance,
        referenceBinding: null,
        sourceBinding: null,
      },
      component: {
        componentBinding: null,
        componentId: null,
        instanceOverrides: {},
      },
    };
    expect(() =>
      prepare(document, {
        type: "node.detach",
        payload: {
          nodeId: id.instanceNode,
          next: {
            ...detachedComponentNext,
            provenance: {
              ...detachedComponentNext.provenance,
              provenance: null,
            },
          },
        },
      }, 4),
    ).toThrow(/provenance|evidence/i);
    expect(() =>
      prepare(document, {
        type: "node.detach",
        payload: {
          nodeId: id.instanceNode,
          next: {
            ...detachedComponentNext,
            provenance: {
              ...detachedComponentNext.provenance,
              provenance: {
                ...componentProvenance,
                sourceAnchor: "components/ui/ForgedButton.tsx#Button",
              },
            },
          },
        },
      }, 4),
    ).toThrow(/provenance|evidence/i);
    const detach = prepare(document, {
      type: "node.detach",
      payload: {
        nodeId: id.instanceNode,
        next: detachedComponentNext,
      },
    }, 4);
    const detached = applyCanvasOperationV2(document, detach);
    const inverse = invertCanvasOperationV2(detached, detach, {
      id: id.operation[5],
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-29T15:00:05.000Z",
    });
    const restored = applyCanvasOperationV2(detached, inverse);

    expect(detached.nodesById[id.instanceNode]).toMatchObject({
      kind: "frame",
      componentBinding: null,
      componentId: null,
      instanceOverrides: {},
    });
    expect(restored.nodesById[id.instanceNode]?.componentBinding).toEqual(
      document.nodesById[id.instanceNode]?.componentBinding,
    );
  });
});
