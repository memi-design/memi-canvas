import { describe, expect, it, vi } from "vitest";

import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import type { WorkbenchNode } from "./model.js";
import { createWorkbenchInspectorV3Actions } from "./workbench-inspector-v3-actions.js";

const first = canvasWorkbenchFixture.document.nodes[0] as WorkbenchNode;
const second = canvasWorkbenchFixture.document.nodes[1] as WorkbenchNode;

function subject(nodes: readonly WorkbenchNode[] = [first]) {
  const commitIntentReceipt = vi.fn();
  const setPreview = vi.fn();
  return {
    commitIntentReceipt,
    setPreview,
    actions: createWorkbenchInspectorV3Actions({ commitIntentReceipt, projectNodes: nodes, setPreview }),
  };
}

describe("workbench inspector V3 actions", () => {
  it("emits compact transform, geometry, style, text, and layout receipts", () => {
    const { actions, commitIntentReceipt } = subject();
    const cases = [
      (node: WorkbenchNode) => ({ ...node, position: { ...node.position, x: 44 } }),
      (node: WorkbenchNode) => ({ ...node, size: { ...node.size, width: 44 } }),
      (node: WorkbenchNode) => ({ ...node, fill: "#123456" }),
      (node: WorkbenchNode) => ({ ...node, name: "Renamed" }),
      (node: WorkbenchNode) => ({ ...node, layout: { ...(node.layout ?? { mode: "none", gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 }, alignPrimary: "start", alignCounter: "start", wrap: false, sizingHorizontal: "fixed", sizingVertical: "fixed" }), gap: 8 } }),
    ];
    cases.forEach((update, index) => actions.commit({ label: `edit-${index}`, targetIds: [first.id], update }));
    expect(commitIntentReceipt.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ kind: "move" }),
      expect.objectContaining({ kind: "resize" }),
      expect.objectContaining({ kind: "style" }),
      expect.objectContaining({ kind: "node.name" }),
      expect.objectContaining({ kind: "node.layout" }),
    ]);
  });

  it("never maps non-text content changes to node.text", () => {
    const { actions, commitIntentReceipt } = subject();
    actions.commit({ label: "unsafe", targetIds: [first.id], update: (node) => ({ ...node, text: "not a text node", frameContent: "also unsupported" }) });
    expect(commitIntentReceipt).not.toHaveBeenCalled();
  });

  it("batches multi-target edits, previews only in memory, clears after enqueue, and never passes a scene", () => {
    const { actions, commitIntentReceipt, setPreview } = subject([first, second]);
    const mutation = { label: "Move two", targetIds: [first.id, second.id], update: (node: WorkbenchNode) => ({ ...node, position: { ...node.position, x: node.position.x + 1 } }) };
    actions.preview(mutation);
    expect(setPreview).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: first.id })]));
    actions.commit(mutation);
    expect(commitIntentReceipt).toHaveBeenCalledWith(
      "Move two",
      expect.objectContaining({ kind: "move" }),
      { selectedIds: [first.id, second.id] },
    );
    expect(setPreview).toHaveBeenLastCalledWith(null);
    actions.clearPreview();
    expect(setPreview).toHaveBeenLastCalledWith(null);
    expect(commitIntentReceipt.mock.calls[0]).toHaveLength(3);
    expect(JSON.stringify(commitIntentReceipt.mock.calls[0])).not.toContain('"scene"');
  });
});
