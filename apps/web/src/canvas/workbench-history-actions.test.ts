import { describe, expect, it, vi } from "vitest";

import {
  CanvasDocumentAppendReceiptV3Schema,
  type CanvasDocumentIdentityV3,
  type CanvasDocumentJournalV3,
  type CanvasDocumentV3PersistencePort,
} from "@memi/protocol";
import { createCanvasDocumentV3 } from "@memi/canvas-document";

import {
  createCanonicalWorkbenchAuthority,
  type CanonicalWorkbenchAuthority,
} from "./canonical-workbench-authority.js";
import {
  CanonicalWorkbenchAuthorityV3,
  migrateLegacyWorkbenchProjectionToV3,
} from "./canonical-workbench-authority-v3.js";
import { createLegacyWorkbenchProjection } from "./legacy-workbench-projection.js";
import { createSelectionState, type WorkbenchNode } from "./model.js";
import { createAuthoringSelectionTransaction } from "./authoring-selection.js";
import {
  createWorkbenchHistoryActions,
} from "./workbench-history-actions.js";
import { createV3WorkbenchHistoryActions } from "./workbench-v3-history-actions.js";

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

function v3MemoryPort(): CanvasDocumentV3PersistencePort {
  let journal: CanvasDocumentJournalV3 | null = null;
  return {
    load: vi.fn(async (_identity: CanvasDocumentIdentityV3) => journal),
    initialize: vi.fn(async (snapshot) => {
      journal = {
        schemaVersion: 1,
        kind: "canvas-document-v3-journal",
        identity: snapshot.identity,
        snapshot,
        operations: [],
        operationBytes: 0,
      };
    }),
    append: vi.fn(async (request) => {
      if (journal === null) throw new Error("journal not initialized");
      journal = {
        ...journal,
        operations: [...journal.operations, request.operation],
        operationBytes: journal.operationBytes + 1,
      };
      return CanvasDocumentAppendReceiptV3Schema.parse({
        schemaVersion: 1,
        identity: request.identity,
        operationId: request.operation.id,
        revision: request.operation.expectedRevision + 1,
        stateHash: request.operation.resultingHash,
      });
    }),
    checkpoint: vi.fn(async () => undefined),
  };
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
  it("adds and toggles nodes against the latest V3 selection", async () => {
    const migration = migrateLegacyWorkbenchProjectionToV3(
      createLegacyWorkbenchProjection({
        nodes: [rectangle("card", 20, 30), rectangle("headline", 80, 90)],
        revision: 0,
        selectedNodeId: null,
      }),
      {
        legacyDocumentId: "selection-document",
        legacyProjectId: "selection-project",
      },
    );
    const canonicalAuthority = await CanonicalWorkbenchAuthorityV3.open({
      document: migration.document,
      persistence: v3MemoryPort(),
      selection: migration.selection,
    });
    const actions = createV3WorkbenchHistoryActions({
      authority: canonicalAuthority,
      actorId: "local-user",
      createOperationId: () => "opn_01J00000000000000000000000",
      now: () => "2026-08-02T12:00:00.000Z",
    });
    const cardId = migration.legacyReceipt.nodeIds.card!;
    const headlineId = migration.legacyReceipt.nodeIds.headline!;

    actions.selectNode(cardId, false);
    actions.selectNode(headlineId, true);
    expect(canonicalAuthority.getSnapshot().selection.selectedIds).toEqual([
      cardId,
      headlineId,
    ]);

    actions.selectNode(cardId, true);
    expect(canonicalAuthority.getSnapshot().selection.selectedIds).toEqual([
      headlineId,
    ]);
  });

  it("commits renderer edits through V3 semantic operations and durable inverse history", async () => {
    const document = createCanvasDocumentV3({
      id: "doc_01J00000000000000000000000",
      projectId: "prj_01J00000000000000000000000",
      initialPage: {
        id: "pag_01J00000000000000000000000",
        kind: "design",
        name: "Canvas",
      },
    });
    const authority = await CanonicalWorkbenchAuthorityV3.open({
      document,
      persistence: v3MemoryPort(),
      selection: createSelectionState([]),
    });
    const actions = createV3WorkbenchHistoryActions({
      authority,
      actorId: "local-user",
      createOperationId: (() => {
        let sequence = 0;
        return () =>
          `opn_01J0000000000000000000000${sequence++}`;
      })(),
      now: () => "2026-08-02T12:00:00.000Z",
    });
    const nodeId = "nod_01J00000000000000000000000";

    await actions.commitSemanticAction({
      action: {
        type: "node.create",
        payload: {
          parentId: null,
          index: 0,
          node: {
            id: nodeId,
            pageId: document.pageIds[0]!,
            kind: "rectangle",
            name: "Card",
            parentId: null,
            childIds: [],
            transform: { x: 24, y: 32, rotation: 0, scaleX: 1, scaleY: 1 },
            geometry: { width: 160, height: 80 },
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
          },
        },
      },
      label: "Create card",
      selectionAfter: createSelectionState([nodeId]),
    });

    const undo = await actions.undoScene();
    const redo = await actions.redoScene();

    expect(undo).toMatchObject({ type: "node.delete" });
    expect(redo).toMatchObject({ type: "node.create" });
    expect(authority.getSnapshot()).toMatchObject({
      canRedo: false,
      canUndo: true,
      document: { revision: 3 },
      selection: { selectedIds: [nodeId] },
    });
    expect("commitActions" in actions).toBe(false);
    expect(JSON.stringify(actions)).not.toContain("WorkbenchNode");
  });

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
