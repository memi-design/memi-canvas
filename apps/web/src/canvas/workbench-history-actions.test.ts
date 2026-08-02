import { describe, expect, it, vi } from "vitest";

import {
  createCanonicalWorkbenchAuthority,
  type CanonicalWorkbenchAuthority,
} from "./canonical-workbench-authority.js";
import { createSelectionState, type WorkbenchNode } from "./model.js";
import { createAuthoringSelectionTransaction } from "./authoring-selection.js";
import { createWorkbenchHistoryActions } from "./workbench-history-actions.js";

function rectangle(id: string, x: number, y: number): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind: "Rectangle",
    locked: false,
    name: id,
    parentId: null,
    position: { x, y },
    size: { height: 40, width: 60 },
  };
}

function authority(nodes: readonly WorkbenchNode[]) {
  return createCanonicalWorkbenchAuthority({
    documentId: "operation-native-document",
    projectId: "operation-native-project",
    scene: {
      future: [],
      nextHistoryId: 1,
      nodes,
      past: [],
      revision: 0,
      selectedNodeId: null,
    },
  });
}

function historyActions(
  canonicalAuthority: CanonicalWorkbenchAuthority,
  nodes: readonly WorkbenchNode[],
) {
  const legacyCommit = vi.fn(() => {
    throw new Error("Legacy full-array commit must not run.");
  });
  const commitActions = vi.fn(
    canonicalAuthority.commitActions.bind(canonicalAuthority),
  );
  const operationAuthority: CanonicalWorkbenchAuthority = {
    ...canonicalAuthority,
    commit: legacyCommit,
    commitActions,
  };
  const setPreviewNodes = vi.fn();
  return {
    commitActions,
    legacyCommit,
    setPreviewNodes,
    value: createWorkbenchHistoryActions({
      authority: operationAuthority,
      commandSequence: { current: 1 },
      nodes,
      selection: createSelectionState(
        nodes.length === 0 ? [] : [nodes[0]!.id],
      ),
      selectedNodeIds: nodes.length === 0 ? [] : [nodes[0]!.id],
      setCommandTrace: vi.fn(),
      setPreviewNodes,
      setTrace: vi.fn(),
      traceSequence: { current: 1 },
    }),
  };
}

describe("operation-native workbench history actions", () => {
  it("updates a newly created root through the same operation gateway", () => {
    const canonicalAuthority = authority([]);
    const created = rectangle("new-card", 40, 50);
    canonicalAuthority.createRootNode({
      actor: "human",
      label: "Create new-card",
      node: created,
    });
    const current = canonicalAuthority.getSnapshot().nodes;
    const desired = current.map((node) =>
      node.id === created.id
        ? { ...node, position: { ...node.position, x: 720 } }
        : node,
    );
    const actions = historyActions(canonicalAuthority, current);

    actions.value.commitScene("Move new-card", desired, {
      targetIds: [created.id],
    });

    expect(actions.commitActions).toHaveBeenCalledTimes(1);
    expect(canonicalAuthority.getSnapshot().revision).toBe(2);
    expect(
      canonicalAuthority.getSnapshot().nodes.find(({ id }) => id === created.id)
        ?.position.x,
    ).toBe(720);
  });

  it("commits one pointer preview as transform and geometry intents", () => {
    const canonicalAuthority = authority([rectangle("card", 20, 30)]);
    const before = canonicalAuthority.getSnapshot().nodes;
    const preview = [
      {
        ...before[0]!,
        position: { x: 80, y: 96 },
        size: { height: 120, width: 240 },
      },
    ];
    const actions = historyActions(canonicalAuthority, preview);

    actions.value.commitPreview("Transform selection", before, ["card"]);

    expect(actions.legacyCommit).not.toHaveBeenCalled();
    expect(actions.commitActions).toHaveBeenCalledTimes(1);
    expect(actions.commitActions.mock.calls[0]?.[0].actions).toEqual([
      expect.objectContaining({ type: "node.transform" }),
      expect.objectContaining({ type: "node.geometry" }),
    ]);
    expect(canonicalAuthority.getSnapshot().history.past).toHaveLength(1);
    expect(actions.setPreviewNodes).toHaveBeenCalledWith(null);
  });

  it("commits an option-drag duplicate from durable state instead of its transient base", () => {
    const canonicalAuthority = authority([rectangle("card", 20, 30)]);
    const original = canonicalAuthority.getSnapshot().nodes[0]!;
    const copy = {
      ...original,
      id: "card-copy-1",
      name: "card copy",
    };
    const gestureBase = [original, copy];
    const preview = [
      original,
      { ...copy, position: { x: 96, y: 112 } },
    ];
    const actions = historyActions(canonicalAuthority, preview);

    actions.value.commitPreview("Duplicate and move card", gestureBase, [
      copy.id,
    ]);

    expect(actions.commitActions.mock.calls[0]?.[0].actions).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          node: expect.objectContaining({
            id: copy.id,
            position: { x: 96, y: 112 },
          }),
        }),
        type: "node.create",
      }),
    ]);
    expect(
      canonicalAuthority.getSnapshot().nodes.find(({ id }) => id === copy.id),
    ).toMatchObject({ position: { x: 96, y: 112 } });
    expect(canonicalAuthority.getSnapshot().history.past).toHaveLength(1);
  });

  it("commits group hierarchy changes without handing arrays to authority", () => {
    const seeded = [rectangle("a", 100, 80), rectangle("b", 180, 120)];
    const canonicalAuthority = authority(seeded);
    const before = canonicalAuthority.getSnapshot().nodes;
    const group: WorkbenchNode = {
      ...rectangle("group", 100, 80),
      kind: "Group",
      size: { height: 80, width: 140 },
    };
    const desired = [
      group,
      { ...before[0]!, parentId: group.id },
      { ...before[1]!, parentId: group.id },
    ];
    const actions = historyActions(canonicalAuthority, before);

    actions.value.commitScene("Group selection", desired, {
      selectedIds: [group.id],
      targetIds: [group.id, "a", "b"],
    });

    expect(actions.legacyCommit).not.toHaveBeenCalled();
    expect(actions.commitActions).toHaveBeenCalledTimes(1);
    expect(
      actions.commitActions.mock.calls[0]?.[0].actions.map(({ type }) => type),
    ).toEqual(["node.create", "node.reparent", "node.reparent"]);
    expect(canonicalAuthority.getSnapshot().selection.selectedIds).toEqual([
      group.id,
    ]);
    expect(canonicalAuthority.getSnapshot().history.past).toHaveLength(1);
  });

  it("commits one inspector transaction across the complete selection", () => {
    const seeded = [rectangle("a", 100, 80), rectangle("b", 180, 120)];
    const canonicalAuthority = authority(seeded);
    const current = canonicalAuthority.getSnapshot().nodes;
    const actions = historyActions(canonicalAuthority, current);
    const transaction = createAuthoringSelectionTransaction(
      "Set selection fill",
      current,
      (node) => ({ ...node, fill: "oklch(0.7 0.2 20)" }),
    );

    actions.value.commitSelectionTransaction(transaction);

    expect(actions.legacyCommit).not.toHaveBeenCalled();
    expect(actions.commitActions).toHaveBeenCalledTimes(1);
    expect(
      actions.commitActions.mock.calls[0]?.[0].actions.map(({ type }) => type),
    ).toEqual(["node.replace", "node.replace"]);
    expect(canonicalAuthority.getSnapshot().history.past).toHaveLength(1);
    expect(
      canonicalAuthority.getSnapshot().nodes.map(({ fill }) => fill),
    ).toEqual(["oklch(0.7 0.2 20)", "oklch(0.7 0.2 20)"]);
  });
});
