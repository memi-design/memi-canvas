import { describe, expect, it } from "vitest";

import {
  CanvasDocumentV2Schema,
  type CanvasActionIntentV2,
  type CanvasDocumentV2,
  type CanvasNodeV2,
} from "@memi/protocol";

import {
  applyCanvasOperationV2,
  createCanvasDocumentV2,
  hashCanvasDocumentV2,
  invertCanvasOperationV2,
  mapLegacyCanvasIdV2,
  prepareCanvasOperationV2,
} from "./v2.js";
import { hashValue } from "./hash.js";

const ids = {
  project: "prj_01J00000000000000000000000",
  document: "doc_01J00000000000000000000000",
  node: [
    "nod_01J00000000000000000000000",
    "nod_01J00000000000000000000001",
    "nod_01J00000000000000000000002",
  ],
  operation: Array.from(
    { length: 30 },
    (_, index) => {
      const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      return `opn_01J000000000000000000000${alphabet[Math.floor(index / 32)]}${alphabet[index % 32]}`;
    },
  ),
  component: "cmp_01J00000000000000000000000",
} as const;

const baseNode = (
  id: string,
  kind: CanvasNodeV2["kind"] = "frame",
): CanvasNodeV2 => ({
  id: id as CanvasNodeV2["id"],
  kind,
  name: `Node ${id.slice(-2)}`,
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
});

function prepare(
  document: CanvasDocumentV2,
  action: CanvasActionIntentV2,
  operationIndex: number,
) {
  return prepareCanvasOperationV2(document, {
    id: ids.operation[operationIndex]!,
    actor: "human",
    actorId: "local-user",
    occurredAt: `2026-07-29T12:00:${operationIndex
      .toString()
      .padStart(2, "0")}.000Z`,
    action,
  });
}

function content(document: CanvasDocumentV2) {
  return {
    rootIds: document.rootIds,
    nodesById: document.nodesById,
    componentsById: document.componentsById,
    tokensById: document.tokensById,
  };
}

function rehashOperation<T extends ReturnType<typeof prepare>>(
  operation: T,
  overrides: Partial<T>,
): T {
  const candidate = { ...operation, ...overrides };
  const {
    actionDigest: _actionDigest,
    resultingHash: _resultingHash,
    ...actionMaterial
  } = candidate;
  return {
    ...candidate,
    actionDigest: hashValue(actionMaterial),
  };
}

describe("CanvasDocumentV2 operation engine", () => {
  it("maps legacy IDs deterministically without loosening branded schemas", () => {
    const first = mapLegacyCanvasIdV2("node", "buzzr:dashboard:continue");
    const repeated = mapLegacyCanvasIdV2(
      "node",
      "buzzr:dashboard:continue",
    );
    const document = mapLegacyCanvasIdV2(
      "document",
      "buzzr:dashboard:continue",
    );

    expect(first).toEqual(repeated);
    expect(first.canonicalId).toMatch(/^nod_[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(document.canonicalId).toMatch(/^doc_/u);
    expect(document.canonicalId).not.toBe(first.canonicalId);
    expect(first).toMatchObject({
      strategy: "sha256-crockford-v1",
      kind: "node",
      legacyId: "buzzr:dashboard:continue",
    });
  });

  it("applies every canonical operation immutably with exact prior values", () => {
    const empty = createCanvasDocumentV2({
      id: ids.document,
      projectId: ids.project,
    });
    const frameCreate = prepare(empty, {
      type: "node.create",
      payload: { node: baseNode(ids.node[0]), parentId: null, index: 0 },
    }, 0);
    const frameDocument = applyCanvasOperationV2(empty, frameCreate);
    expect(frameCreate).toMatchObject({
      label: "Create node",
      targetIds: [ids.node[0]],
      undoOf: null,
    });
    expect(frameDocument).not.toHaveProperty("appliedOperations");
    const textNode = {
      ...baseNode(ids.node[1], "text"),
      parentId: ids.node[0] as CanvasNodeV2["parentId"],
      text: { characters: "Before", autoResize: "width-height" as const },
    };
    const textCreate = prepare(frameDocument, {
      type: "node.create",
      payload: { node: textNode, parentId: ids.node[0], index: 0 },
    }, 1);
    let document = applyCanvasOperationV2(frameDocument, textCreate);

    const actions: readonly CanvasActionIntentV2[] = [
      {
        type: "node.transform",
        payload: {
          nodeId: ids.node[1],
          next: { x: 12, y: 18, rotation: 5, scaleX: 1, scaleY: 1 },
        },
      },
      {
        type: "node.geometry",
        payload: {
          nodeId: ids.node[1],
          next: { width: 240, height: 48 },
        },
      },
      {
        type: "node.style",
        payload: {
          nodeId: ids.node[1],
          next: {
            opacity: 0.8,
            visible: true,
            locked: false,
            fills: [{ type: "solid", color: "#ff5470" }],
            strokes: [],
            cornerRadii: [8, 8, 8, 8],
          },
        },
      },
      {
        type: "node.text",
        payload: {
          nodeId: ids.node[1],
          next: { characters: "After", autoResize: "height" },
        },
      },
      {
        type: "node.layout",
        payload: {
          nodeId: ids.node[0],
          next: {
            mode: "vertical",
            gap: 12,
            padding: { top: 16, right: 16, bottom: 16, left: 16 },
            alignPrimary: "center",
            alignCounter: "stretch",
            wrap: false,
            sizingHorizontal: "fixed",
            sizingVertical: "hug",
          },
        },
      },
      {
        type: "node.reparent",
        payload: { nodeId: ids.node[1], nextParentId: null, nextIndex: 1 },
      },
      {
        type: "node.reorder",
        payload: {
          parentId: null,
          nextOrder: [ids.node[1], ids.node[0]],
        },
      },
      {
        type: "component.define",
        payload: {
          componentId: ids.component,
          next: {
            id: ids.component,
            name: "Primary button",
            rootNodeId: ids.node[0],
            propertyKeys: ["label"],
          },
        },
      },
    ];

    for (const [index, action] of actions.entries()) {
      const before = document;
      const operation = prepare(document, action, index + 2);
      document = applyCanvasOperationV2(document, operation);
      expect(before).not.toBe(document);
      expect(document.stateHash).toBe(hashCanvasDocumentV2(document));
      expect(operation.payload).toHaveProperty("prior");
    }

    const instance = {
      ...baseNode(ids.node[2], "instance"),
      componentId: ids.component as CanvasNodeV2["componentId"],
    };
    const instanceCreate = prepare(document, {
      type: "node.create",
      payload: { node: instance, parentId: null, index: 2 },
    }, 10);
    document = applyCanvasOperationV2(document, instanceCreate);
    const override = prepare(document, {
      type: "instance.override",
      payload: { nodeId: ids.node[2], key: "label", next: "Continue" },
    }, 11);
    document = applyCanvasOperationV2(document, override);

    expect(document.nodesById[ids.node[1]]?.text?.characters).toBe("After");
    expect(document.nodesById[ids.node[2]]?.instanceOverrides).toEqual({
      label: "Continue",
    });
    expect(empty.rootIds).toEqual([]);
  });

  it("inverts create, delete, and mutations without historical snapshots", () => {
    const empty = createCanvasDocumentV2({
      id: ids.document,
      projectId: ids.project,
    });
    const create = prepare(empty, {
      type: "node.create",
      payload: { node: baseNode(ids.node[0]), parentId: null, index: 0 },
    }, 0);
    const created = applyCanvasOperationV2(empty, create);
    const transform = prepare(created, {
      type: "node.transform",
      payload: {
        nodeId: ids.node[0],
        next: { x: 50, y: 80, rotation: 0, scaleX: 1, scaleY: 1 },
      },
    }, 1);
    const transformed = applyCanvasOperationV2(created, transform);
    const inverseTransform = invertCanvasOperationV2(transformed, transform, {
      id: ids.operation[2]!,
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-29T12:00:02.000Z",
    });
    expect(inverseTransform.undoOf).toBe(transform.id);
    const restoredTransform = applyCanvasOperationV2(
      transformed,
      inverseTransform,
    );

    expect(content(restoredTransform)).toEqual(content(created));

    const remove = prepare(restoredTransform, {
      type: "node.delete",
      payload: { nodeId: ids.node[0] },
    }, 3);
    const removed = applyCanvasOperationV2(restoredTransform, remove);
    const restore = invertCanvasOperationV2(removed, remove, {
      id: ids.operation[4]!,
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-29T12:00:04.000Z",
    });

    expect(content(applyCanvasOperationV2(removed, restore))).toEqual(
      content(restoredTransform),
    );
  });

  it("commits and inverts an atomic batch as one revision", () => {
    const empty = createCanvasDocumentV2({
      id: ids.document,
      projectId: ids.project,
    });
    const create = prepare(empty, {
      type: "node.create",
      payload: { node: baseNode(ids.node[0]), parentId: null, index: 0 },
    }, 0);
    const created = applyCanvasOperationV2(empty, create);
    const batch = prepare(created, {
      type: "atomic.batch",
      payload: {
        actions: [
          {
            type: "node.transform",
            payload: {
              nodeId: ids.node[0],
              next: { x: 20, y: 30, rotation: 0, scaleX: 1, scaleY: 1 },
            },
          },
          {
            type: "node.geometry",
            payload: {
              nodeId: ids.node[0],
              next: { width: 640, height: 480 },
            },
          },
        ],
      },
    }, 1);
    const changed = applyCanvasOperationV2(created, batch);

    expect(changed.revision).toBe(created.revision + 1);
    expect(changed.nodesById[ids.node[0]]?.transform.x).toBe(20);
    expect(batch.payload).toMatchObject({
      actions: [
        { type: "node.transform", payload: { prior: { x: 0, y: 0 } } },
        { type: "node.geometry", payload: { prior: { width: 320 } } },
      ],
    });

    const inverse = invertCanvasOperationV2(changed, batch, {
      id: ids.operation[2]!,
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-07-29T12:00:02.000Z",
    });
    const restored = applyCanvasOperationV2(changed, inverse);

    expect(content(restored)).toEqual(content(created));
  });

  it("round-trips every reversible mutation family", () => {
    let operationIndex = 0;
    let document = createCanvasDocumentV2({
      id: ids.document,
      projectId: ids.project,
    });
    const setupActions: readonly CanvasActionIntentV2[] = [
      {
        type: "node.create",
        payload: { node: baseNode(ids.node[0]), parentId: null, index: 0 },
      },
      {
        type: "node.create",
        payload: {
          node: {
            ...baseNode(ids.node[1], "text"),
            parentId: ids.node[0] as CanvasNodeV2["parentId"],
            text: { characters: "Before", autoResize: "height" },
          },
          parentId: ids.node[0],
          index: 0,
        },
      },
      {
        type: "component.define",
        payload: {
          componentId: ids.component,
          next: {
            id: ids.component,
            name: "Button",
            rootNodeId: ids.node[0],
            propertyKeys: ["label"],
          },
        },
      },
      {
        type: "node.create",
        payload: {
          node: {
            ...baseNode(ids.node[2], "instance"),
            componentId: ids.component as CanvasNodeV2["componentId"],
          },
          parentId: null,
          index: 1,
        },
      },
    ];
    for (const action of setupActions) {
      const operation = prepare(document, action, operationIndex++);
      document = applyCanvasOperationV2(document, operation);
    }

    const roundTrip = (action: CanvasActionIntentV2) => {
      const before = document;
      const operation = prepare(document, action, operationIndex++);
      const changed = applyCanvasOperationV2(document, operation);
      const inverse = invertCanvasOperationV2(changed, operation, {
        id: ids.operation[operationIndex++]!,
        actor: "human",
        actorId: "local-user",
        occurredAt: "2026-07-29T13:00:00.000Z",
      });
      document = applyCanvasOperationV2(changed, inverse);
      expect(content(document)).toEqual(content(before));
    };

    roundTrip({
      type: "node.transform",
      payload: {
        nodeId: ids.node[0],
        next: { x: 10, y: 20, rotation: 2, scaleX: 1, scaleY: 1 },
      },
    });
    roundTrip({
      type: "node.geometry",
      payload: { nodeId: ids.node[0], next: { width: 400, height: 300 } },
    });
    roundTrip({
      type: "node.style",
      payload: {
        nodeId: ids.node[0],
        next: {
          opacity: 0.5,
          visible: true,
          locked: false,
          fills: [{ type: "solid", color: "#ff5470", tokenId: "color.ruby" }],
          strokes: [],
          cornerRadii: [4, 4, 4, 4],
        },
      },
    });
    roundTrip({
      type: "node.text",
      payload: {
        nodeId: ids.node[1],
        next: { characters: "After", autoResize: "width-height" },
      },
    });
    roundTrip({
      type: "node.layout",
      payload: {
        nodeId: ids.node[0],
        next: {
          mode: "horizontal",
          gap: 8,
          padding: { top: 8, right: 8, bottom: 8, left: 8 },
          alignPrimary: "center",
          alignCounter: "center",
          wrap: false,
          sizingHorizontal: "hug",
          sizingVertical: "hug",
        },
      },
    });
    roundTrip({
      type: "node.reparent",
      payload: { nodeId: ids.node[1], nextParentId: null, nextIndex: 2 },
    });
    roundTrip({
      type: "node.reorder",
      payload: {
        parentId: null,
        nextOrder: [ids.node[2], ids.node[0]],
      },
    });
    roundTrip({
      type: "component.define",
      payload: {
        componentId: ids.component,
        next: {
          id: ids.component,
          name: "Updated button",
          rootNodeId: ids.node[0],
          propertyKeys: ["label", "icon"],
        },
      },
    });
    roundTrip({
      type: "instance.override",
      payload: { nodeId: ids.node[2], key: "label", next: "Continue" },
    });
  });

  it("rejects stale hashes, forged results, bad hierarchy, and mutation", () => {
    const empty = createCanvasDocumentV2({
      id: ids.document,
      projectId: ids.project,
    });
    const create = prepare(empty, {
      type: "node.create",
      payload: { node: baseNode(ids.node[0]), parentId: null, index: 0 },
    }, 0);

    expect(() =>
      applyCanvasOperationV2(empty, {
        ...create,
        expectedBeforeHash: `sha256:${"a".repeat(64)}`,
      }),
    ).toThrow(/digest|stale/i);
    expect(() =>
      applyCanvasOperationV2(empty, {
        ...create,
        resultingHash: `sha256:${"b".repeat(64)}`,
      }),
    ).toThrow(/resulting hash/i);
    expect(() =>
      CanvasDocumentV2Schema.parse({
        ...empty,
        rootIds: [ids.node[0]],
      }),
    ).toThrow(/root|node/i);

    const created = applyCanvasOperationV2(empty, create);
    expect(Object.isFrozen(created)).toBe(true);
    expect(() => {
      (created.rootIds as string[]).push(ids.node[1]);
    }).toThrow();
  });

  it("rejects contradictory create parents instead of canonicalizing them", () => {
    const empty = createCanvasDocumentV2({
      id: ids.document,
      projectId: ids.project,
    });
    const createParent = prepare(empty, {
      type: "node.create",
      payload: { node: baseNode(ids.node[0]), parentId: null, index: 0 },
    }, 0);
    const parentDocument = applyCanvasOperationV2(empty, createParent);

    expect(() =>
      prepare(parentDocument, {
        type: "node.create",
        payload: {
          node: baseNode(ids.node[1]),
          parentId: ids.node[0],
          index: 0,
        },
      }, 1),
    ).toThrow(/parent/i);
  });

  it("rejects forged labels, targets, and undo linkage after rehashing", () => {
    const empty = createCanvasDocumentV2({
      id: ids.document,
      projectId: ids.project,
    });
    const operation = prepare(empty, {
      type: "node.create",
      payload: { node: baseNode(ids.node[0]), parentId: null, index: 0 },
    }, 0);

    expect(() =>
      applyCanvasOperationV2(
        empty,
        rehashOperation(operation, { label: "Forged label" }),
      ),
    ).toThrow(/label|metadata/i);
    expect(() =>
      applyCanvasOperationV2(
        empty,
        rehashOperation(operation, {
          targetIds: [ids.node[1] as CanvasNodeV2["id"]],
        }),
      ),
    ).toThrow(/target|metadata/i);
    expect(() =>
      applyCanvasOperationV2(
        empty,
        rehashOperation(operation, {
          undoOf: ids.operation[1] as typeof operation.undoOf,
        }),
      ),
    ).toThrow(/undo|metadata/i);
  });

  it("requires complete operation proof before deriving an inverse", () => {
    const empty = createCanvasDocumentV2({
      id: ids.document,
      projectId: ids.project,
    });
    const operation = prepare(empty, {
      type: "node.create",
      payload: { node: baseNode(ids.node[0]), parentId: null, index: 0 },
    }, 0);
    const created = applyCanvasOperationV2(empty, operation);
    const allocation = {
      id: ids.operation[1]!,
      actor: "human" as const,
      actorId: "local-user",
      occurredAt: "2026-07-29T14:00:00.000Z",
    };

    expect(() =>
      invertCanvasOperationV2(
        created,
        {
          ...operation,
          actionDigest: `sha256:${"f".repeat(64)}`,
        },
        allocation,
      ),
    ).toThrow(/digest|proof/i);
    expect(() =>
      invertCanvasOperationV2(
        created,
        rehashOperation(operation, {
          expectedBeforeHash: `sha256:${"e".repeat(64)}`,
        }),
        allocation,
      ),
    ).toThrow(/expected|proof|stale/i);
    const differentNode = {
      ...baseNode(ids.node[1]),
      id: ids.node[1] as CanvasNodeV2["id"],
    };
    expect(() =>
      invertCanvasOperationV2(
        created,
        rehashOperation(
          operation,
          {
            payload: {
              ...operation.payload,
              node: differentNode,
            },
            targetIds: [ids.node[1] as CanvasNodeV2["id"]],
          } as Partial<typeof operation>,
        ),
        allocation,
      ),
    ).toThrow(/proof|exist/i);
  });
});
