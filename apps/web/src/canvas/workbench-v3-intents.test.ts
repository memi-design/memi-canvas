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
  it("creates and pastes parent-first without accepting a whole scene", () => {
    const frame: WorkbenchNode = {
      ...rectangle("frame", null, 20, 30),
      kind: "Frame",
      size: { height: 240, width: 320 },
    };
    const photo = rectangle("photo", frame.id, 16, 24);
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
