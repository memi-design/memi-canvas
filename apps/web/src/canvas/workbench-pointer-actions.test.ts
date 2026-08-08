import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { PointerGesture } from "./CanvasWorkbench.types.js";
import type { WorkbenchNode } from "./model.js";
import { createWorkbenchPointerActions } from "./workbench-pointer-actions.js";

function node(
  id: string,
  kind: WorkbenchNode["kind"],
  parentId: string | null,
  x: number,
  y: number,
): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind,
    locked: false,
    name: id,
    parentId,
    position: { x, y },
    size: { height: 100, width: 100 },
  };
}

function pointerEvent<Element extends HTMLElement = HTMLButtonElement>(
  values: Partial<ReactPointerEvent<Element>>,
): ReactPointerEvent<Element> {
  return {
    altKey: false,
    button: 0,
    buttons: 1,
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    shiftKey: false,
    stopPropagation: vi.fn(),
    ...values,
  } as unknown as ReactPointerEvent<Element>;
}

function actionHarness() {
  const gesture = { current: null as PointerGesture | null };
  const commitIntentReceipt = vi.fn();
  const selectNodeIds = vi.fn();
  let previewNodes: readonly WorkbenchNode[] | null = null;
  const setPreviewNodes: Dispatch<
    SetStateAction<readonly WorkbenchNode[] | null>
  > = (next) => {
    previewNodes =
      typeof next === "function" ? next(previewNodes) : next;
  };
  const viewport = Object.assign(document.createElement("div"), {
    releasePointerCapture: vi.fn(),
    setPointerCapture: vi.fn(),
  });
  const create = (nodes: readonly WorkbenchNode[]) =>
    createWorkbenchPointerActions({
      alignmentGuides: { horizontal: [], vertical: [] },
      appendTrace: vi.fn(),
      camera: { x: 0, y: 0, zoom: 1 },
      cameraScheduler: { current: null },
      commitIntentReceipt,
      commitPreview: vi.fn(),
      commitScene: vi.fn(),
      createRootNode: vi.fn(),
      gesture,
      nodes,
      selectNode: vi.fn(),
      selectNodeIds,
      selectedNodeIds: [nodes[0]?.id ?? ""],
      setAlignmentGuides: vi.fn(),
      setCamera: vi.fn(),
      setContextMenu: vi.fn(),
      setPreviewNodes,
      setSelectionMarquee: vi.fn(),
      setTool: vi.fn(),
      spacePressed: { current: false },
      suppressCanvasClick: { current: false },
      tool: "select",
      viewportElement: { current: viewport },
      viewportPointer: { current: null },
    });
  return {
    commitIntentReceipt,
    create,
    gesture,
    preview: () => previewNodes,
    selectNodeIds,
    viewport,
  };
}

describe("workbench pointer actions", () => {
  it("keeps the public pointer-action facade small enough to audit", () => {
    const source = readFileSync(
      resolve("apps/web/src/canvas/workbench-pointer-actions.ts"),
      "utf8",
    );

    expect(source.split("\n").length).toBeLessThanOrEqual(800);
  });

  it("previews every descendant but commits only the moved hierarchy root", () => {
    const group = node("Group 1", "Group", null, 100, 120);
    const campaign = node("Campaign card", "DraftFrame", group.id, 920, 160);
    const headline = node("Welcome headline", "Text", campaign.id, 952, 192);
    const harness = actionHarness();

    harness.create([group, campaign, headline]).startMove(
      group,
      pointerEvent({ clientX: 100, clientY: 100, pointerId: 43 }),
    );
    harness.create([group, campaign, headline]).handleViewportPointerMove(
      pointerEvent<HTMLDivElement>({
        clientX: 140,
        clientY: 130,
        pointerId: 43,
      }),
    );

    expect(
      harness.preview()?.map(({ id, position }) => ({ id, position })),
    ).toEqual([
      { id: group.id, position: { x: 140, y: 150 } },
      { id: campaign.id, position: { x: 960, y: 190 } },
      { id: headline.id, position: { x: 992, y: 222 } },
    ]);

    const preview = harness.preview() ?? [];
    harness.create(preview).handleViewportPointerUp(
      {
        ...pointerEvent({ pointerId: 43 }),
        currentTarget: harness.viewport,
      } as unknown as ReactPointerEvent<HTMLDivElement>,
    );

    expect(harness.commitIntentReceipt).toHaveBeenCalledWith(
      "Move Group 1",
      { kind: "move", nodes: [expect.objectContaining({ id: group.id })] },
      { targetIds: [group.id] },
    );
  });

  it("commits the highlighted container as the moved node parent", () => {
    const target = {
      ...node("Checkout exploration", "Frame", null, 0, 0),
      size: { height: 300, width: 300 },
    };
    const campaign = node("Campaign card", "DraftFrame", null, 400, 400);
    const harness = actionHarness();

    harness.create([target, campaign]).startMove(
      campaign,
      pointerEvent({ clientX: 400, clientY: 400, pointerId: 47 }),
    );
    harness.create([target, campaign]).handleViewportPointerMove(
      pointerEvent<HTMLDivElement>({
        clientX: 50,
        clientY: 50,
        pointerId: 47,
      }),
    );

    const preview = harness.preview() ?? [];
    harness.create(preview).handleViewportPointerUp(
      {
        ...pointerEvent({ clientX: 50, clientY: 50, pointerId: 47 }),
        currentTarget: harness.viewport,
      } as unknown as ReactPointerEvent<HTMLDivElement>,
    );

    expect(harness.commitIntentReceipt).toHaveBeenCalledWith(
      "Move Campaign card into Checkout exploration",
      {
        kind: "reparent",
        nodes: [
          expect.objectContaining({
            id: campaign.id,
            parentId: target.id,
            position: { x: 50, y: 50 },
          }),
        ],
      },
      { targetIds: [campaign.id] },
    );
  });

  it("defers selecting option-drag copies and persists a parent-relative subtree", () => {
    const campaign = node("Campaign card", "DraftFrame", null, 920, 160);
    const headline = node("Welcome headline", "Text", campaign.id, 952, 192);
    const harness = actionHarness();

    harness.create([campaign, headline]).startMove(
      campaign,
      pointerEvent({ altKey: true, clientX: 920, clientY: 160, pointerId: 10 }),
    );
    expect(harness.selectNodeIds).not.toHaveBeenCalled();

    const copies = harness.preview() ?? [];
    harness.create(copies).handleViewportPointerMove(
      pointerEvent<HTMLDivElement>({
        altKey: true,
        clientX: 1020,
        clientY: 210,
        pointerId: 10,
      }),
    );
    const moved = harness.preview() ?? [];
    harness.create(moved).handleViewportPointerUp(
      {
        ...pointerEvent({ altKey: true, pointerId: 10 }),
        currentTarget: harness.viewport,
      } as unknown as ReactPointerEvent<HTMLDivElement>,
    );

    expect(harness.commitIntentReceipt).toHaveBeenCalledWith(
      "Duplicate and move Campaign card",
      {
        kind: "paste",
        nodes: [
          expect.objectContaining({
            name: "Campaign card copy",
            parentId: null,
            position: { x: 1020, y: 210 },
          }),
          expect.objectContaining({
            name: "Welcome headline copy",
            position: { x: 1052, y: 242 },
          }),
        ],
      },
      expect.objectContaining({
        selectedIds: [expect.stringContaining("Campaign card-copy")],
      }),
    );
  });
});
