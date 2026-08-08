import { describe, expect, it } from "vitest";

import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";
import { CanvasPageIdSchema, type CanvasPageId } from "@memi/protocol";

import {
  compileWorkbenchIntentReceiptV3,
  type WorkbenchIntentReceiptV3,
} from "./workbench-v3-intents.js";
import { projectCanvasDocumentV3ToWorkbench } from "./canvas-v3-workbench-projection.js";
import type { WorkbenchNode } from "./model.js";

const ids = {
  document: "doc_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
  project: "prj_01J00000000000000000000000",
} as const;
const pageId: CanvasPageId = CanvasPageIdSchema.parse(ids.page);

function document() {
  return createCanvasDocumentV3({
    id: ids.document,
    initialPage: { id: pageId, kind: "design", name: "Canvas" },
    projectId: ids.project,
  });
}

function rectangle(
  id: string,
  parentId: string | null,
  x: number,
  y: number,
): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind: "Rectangle",
    locked: false,
    name: id,
    parentId,
    position: { x, y },
    size: { height: 40, width: 60 },
  };
}

function applyReceipt(
  current: ReturnType<typeof document>,
  receipt: WorkbenchIntentReceiptV3,
) {
  const action = compileWorkbenchIntentReceiptV3({
    document: current,
    pageId,
    receipt,
  });
  return {
    action,
    document: applyCanvasOperationV3(
      current,
      prepareCanvasOperationV3(current, {
        action,
        actor: "human",
        actorId: "local-user",
        id: `opn_01J0000000000000000000000${current.revision}`,
        label: receipt.kind,
        occurredAt: "2026-08-02T12:00:00.000Z",
      }),
    ),
  };
}

describe("workbench V3 semantic intent receipts", () => {
  it("compiles a compact node.name receipt against the current active-page node", () => {
    const card = rectangle("card", null, 20, 30);
    const current = applyReceipt(document(), {
      kind: "create",
      nodes: [card],
    }).document;
    const nodeId = Object.values(current.nodesById)[0]!.id;
    const receipt = {
      kind: "node.name" as const,
      next: "Renamed card",
      nodeId: card.id,
    };

    const action = compileWorkbenchIntentReceiptV3({
      document: current,
      pageId,
      receipt,
    });

    expect(action).toEqual({
      type: "node.name",
      payload: { next: "Renamed card", nodeId },
    });
    expect(Object.isFrozen(action)).toBe(true);
    expect(Object.isFrozen(action.payload)).toBe(true);
    expect(applyReceipt(current, receipt).document.nodesById[nodeId]?.name).toBe(
      "Renamed card",
    );
    expect(() =>
      compileWorkbenchIntentReceiptV3({
        document: current,
        pageId,
        receipt: { ...receipt, next: `  ${card.name}  ` },
      }),
    ).toThrow("current value");
    expect(() =>
      compileWorkbenchIntentReceiptV3({
        document: current,
        pageId,
        receipt: { ...receipt, next: "   " },
      }),
    ).toThrow("between 1 and 512");
  });

  it("compiles exact inspector property receipts without freezing caller data", () => {
    const textNode: WorkbenchNode = {
      ...rectangle("title", null, 24, 36),
      kind: "Text",
      text: "Before",
    };
    const current = applyReceipt(document(), {
      kind: "create",
      nodes: [textNode],
    }).document;
    const nodeId = Object.values(current.nodesById).find(
      (node) => node.name === "title",
    )!.id;
    const node = current.nodesById[nodeId]!;
    const receipts = [
      {
        kind: "node.transform" as const,
        next: { ...node.transform, rotation: 18, x: 80, y: 96 },
        nodeId: textNode.id,
      },
      {
        kind: "node.geometry" as const,
        next: { height: 72, width: 260 },
        nodeId: textNode.id,
      },
      {
        kind: "node.style" as const,
        next: { ...node.style, opacity: 0.72, visible: false },
        nodeId: textNode.id,
      },
      {
        kind: "node.text" as const,
        next: { ...node.text!, characters: "After" },
        nodeId: textNode.id,
      },
      {
        kind: "node.layout" as const,
        next: { ...node.layout, gap: 24 },
        nodeId: textNode.id,
      },
    ];

    const actions = receipts.map((receipt) =>
      compileWorkbenchIntentReceiptV3({ document: current, pageId, receipt }),
    );

    expect(actions.map(({ type }) => type)).toEqual([
      "node.transform",
      "node.geometry",
      "node.style",
      "node.text",
      "node.layout",
    ]);
    expect(actions.map((action) => action.payload)).toEqual(
      receipts.map(({ next }) => ({ next, nodeId })),
    );
    for (const [index, action] of actions.entries()) {
      expect(Object.isFrozen(action)).toBe(true);
      expect(Object.isFrozen(action.payload)).toBe(true);
      expect(Object.isFrozen(receipts[index]!.next)).toBe(false);
    }
    const updated = receipts.reduce(
      (candidate, receipt) => applyReceipt(candidate, receipt).document,
      current,
    );
    const updatedNode = updated.nodesById[nodeId]!;
    expect(updatedNode.transform).toEqual(receipts[0]!.next);
    expect(updatedNode.geometry).toEqual(receipts[1]!.next);
    expect(updatedNode.style).toEqual(receipts[2]!.next);
    expect(updatedNode.text).toEqual(receipts[3]!.next);
    expect(updatedNode.layout).toEqual(receipts[4]!.next);
  });

  it("uses the current document to reject missing targets, non-text targets, and no-op values", () => {
    const card = rectangle("card", null, 20, 30);
    const current = applyReceipt(document(), {
      kind: "create",
      nodes: [card],
    }).document;
    const node = Object.values(current.nodesById)[0]!;

    expect(() =>
      compileWorkbenchIntentReceiptV3({
        document: current,
        pageId,
        receipt: {
          kind: "node.geometry",
          next: node.geometry,
          nodeId: card.id,
        },
      }),
    ).toThrow("current value");
    expect(() =>
      compileWorkbenchIntentReceiptV3({
        document: current,
        pageId,
        receipt: {
          kind: "node.text",
          next: { autoResize: "width-height", characters: "Nope" },
          nodeId: card.id,
        },
      }),
    ).toThrow("text node");
    expect(() =>
      compileWorkbenchIntentReceiptV3({
        document: current,
        pageId,
        receipt: {
          kind: "node.transform",
          next: node.transform,
          nodeId: "missing",
        },
      }),
    ).toThrow("existing node");
  });

  it("creates and pastes parent-first without accepting a whole scene", () => {
    const frame: WorkbenchNode = {
      ...rectangle("frame", null, 20, 30),
      kind: "Frame",
      size: { height: 240, width: 320 },
    };
    // Workbench nodes use absolute canvas positions; V3 stores this child
    // relative to its parent and must project it back to the same point.
    const photo = rectangle("photo", frame.id, 36, 54);
    const { action, document: next } = applyReceipt(document(), {
      kind: "paste",
      nodes: [frame, photo],
    });

    expect(action).toMatchObject({
      type: "atomic.batch",
      payload: { actions: [{ type: "node.create" }, { type: "node.create" }] },
    });
    const [createdFrame, createdPhoto] = Object.values(next.nodesById);
    expect(createdFrame?.childIds).toEqual([createdPhoto?.id]);
    expect(createdPhoto?.parentId).toBe(createdFrame?.id);
    expect(createdPhoto?.transform).toMatchObject({ x: 16, y: 24 });
    expect(projectCanvasDocumentV3ToWorkbench(next, pageId)[1]?.position)
      .toEqual(photo.position);
  });

  it("groups with explicit local child transforms and preserves sibling ordering", () => {
    const a = rectangle("a", null, 100, 80);
    const b = rectangle("b", null, 160, 120);
    const c = rectangle("c", null, 240, 120);
    const seeded = applyReceipt(document(), { kind: "create", nodes: [a, b, c] }).document;
    const group: WorkbenchNode = {
      ...rectangle("group", null, 100, 80),
      kind: "Group",
      size: { height: 80, width: 120 },
    };
    const { action, document: next } = applyReceipt(seeded, {
      kind: "group",
      container: group,
      children: [
        { ...a, parentId: group.id, position: { x: 0, y: 0 } },
        { ...b, parentId: group.id, position: { x: 60, y: 40 } },
      ],
    });

    expect(action).toMatchObject({
      type: "atomic.batch",
      payload: {
        actions: [
          { type: "node.create" },
          { type: "node.transform" },
          { type: "node.reparent" },
          { type: "node.transform" },
          { type: "node.reparent" },
        ],
      },
    });
    const rootIds = next.pagesById[pageId]!.rootIds;
    const groupId = rootIds[0]!;
    expect(rootIds).toEqual([groupId, expect.any(String)]);
    expect(next.nodesById[groupId]?.childIds).toEqual(
      ["a", "b"].map((id) =>
        Object.values(next.nodesById).find((node) => node.name === id)?.id,
      ),
    );
    expect(
      Object.values(next.nodesById).find((node) => node.name === "a")?.transform,
    ).toMatchObject({ x: 0, y: 0 });
    expect(
      Object.values(next.nodesById).find((node) => node.name === "b")?.transform,
    ).toMatchObject({ x: 60, y: 40 });
  });

  it("compiles resize, style, reparent, order, and deletion as narrow actions", () => {
    const parent = { ...rectangle("parent", null, 0, 0), kind: "Frame" as const };
    const card = rectangle("card", null, 20, 30);
    let current = applyReceipt(document(), { kind: "create", nodes: [parent, card] }).document;
    const cardId = Object.values(current.nodesById).find((node) => node.name === "card")!.id;
    const parentId = Object.values(current.nodesById).find((node) => node.name === "parent")!.id;

    const resized = { ...card, size: { height: 80, width: 180 } };
    expect(compileWorkbenchIntentReceiptV3({ document: current, pageId, receipt: { kind: "resize", nodes: [resized] } })).toMatchObject({ type: "node.geometry", payload: { nodeId: cardId } });
    current = applyReceipt(current, { kind: "resize", nodes: [resized] }).document;
    const styled = { ...resized, fill: "#123456", locked: true };
    expect(compileWorkbenchIntentReceiptV3({ document: current, pageId, receipt: { kind: "style", nodes: [styled] } })).toMatchObject({ type: "node.style", payload: { nodeId: cardId, next: { locked: true } } });
    current = applyReceipt(current, { kind: "style", nodes: [styled] }).document;
    current = applyReceipt(current, { kind: "reparent", nodes: [{ ...styled, parentId: parent.id, position: { x: 20, y: 30 } }] }).document;
    expect(current.nodesById[cardId]?.parentId).toBe(parentId);
    const order = compileWorkbenchIntentReceiptV3({ document: current, pageId, receipt: { kind: "order", parentId: parent.id, orderedNodeIds: [card.id] } });
    expect(order).toMatchObject({ type: "node.reorder", payload: { parentId, nextOrder: [cardId] } });
    const deleted = compileWorkbenchIntentReceiptV3({ document: current, pageId, receipt: { kind: "delete", nodeIds: [card.id] } });
    expect(deleted).toMatchObject({ type: "node.delete", payload: { nodeId: cardId } });
  });

  it("uses stable ids, freezes payloads, and does not reparent an unchanged parent", () => {
    const parent = { ...rectangle("parent", null, 0, 0), kind: "Frame" as const };
    const child = rectangle("child", parent.id, 12, 18);
    const first = compileWorkbenchIntentReceiptV3({
      document: document(), pageId, receipt: { kind: "paste", nodes: [parent, child] },
    });
    const second = compileWorkbenchIntentReceiptV3({
      document: document(), pageId, receipt: { kind: "paste", nodes: [parent, child] },
    });
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.payload)).toBe(true);
    expect(Object.isFrozen(first.type === "atomic.batch" ? first.payload.actions : first)).toBe(true);

    const current = applyReceipt(document(), { kind: "paste", nodes: [parent, child] }).document;
    const moved = compileWorkbenchIntentReceiptV3({
      document: current,
      pageId,
      receipt: { kind: "reparent", nodes: [{ ...child, position: { x: 24, y: 36 } }] },
    });
    expect(moved).toMatchObject({ type: "node.transform" });
    expect(moved).not.toMatchObject({ type: "atomic.batch" });
  });

  it("compiles an explicit detach receipt without a node.replace fallback", () => {
    const source = rectangle("source-card", null, 20, 30);
    const current = applyReceipt(document(), { kind: "create", nodes: [source] }).document;
    const detached: WorkbenchNode = {
      ...source,
      frameContent: "Source card",
      kind: "DraftFrame",
      provenance: {
        coverageCellId: "default",
        repositoryRevision: "buzzr@abc123",
        routeId: "home",
        sourceAnchor: "src/Card.tsx#Card",
        stateId: "default",
      },
    };

    const action = compileWorkbenchIntentReceiptV3({
      document: current,
      pageId,
      receipt: { kind: "detach", node: detached },
    });

    expect(action).toMatchObject({
      type: "atomic.batch",
      payload: { actions: [{ type: "node.delete" }, { type: "node.create" }] },
    });
    expect(JSON.stringify(action)).not.toContain("node.replace");
    const next = applyReceipt(current, { kind: "detach", node: detached }).document;
    const node = Object.values(next.nodesById)[0]!;
    expect(node).toMatchObject({
      content: { type: "frame", value: "Source card" },
      provenance: { repositoryRevision: "buzzr@abc123" },
      sourceBinding: null,
    });
  });

  it("rejects unsupported replacement fallbacks", () => {
    expect(() =>
      compileWorkbenchIntentReceiptV3({
        document: document(),
        pageId,
        receipt: { kind: "replace", node: rectangle("card", null, 0, 0) },
      }),
    ).toThrow("node.replace");
  });
});
