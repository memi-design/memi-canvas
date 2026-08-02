import { describe, expect, it } from "vitest";

import {
  createCommandBus,
  createDocumentCommand,
} from "./command-bus.js";
import { moveNodes } from "./editor-core.js";
import {
  createSelectionState,
  type DesignDocument,
  type DocumentNode,
} from "./model.js";

const originalNode: DocumentNode = {
  id: "node",
  kind: "Rectangle",
  name: "Node",
  parentId: null,
  childIds: [],
  position: { x: 10, y: 20 },
  size: { width: 100, height: 80 },
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  styles: {},
  constraints: { horizontal: "left", vertical: "top" },
};

const originalDocument: DesignDocument = {
  id: "document",
  revision: 3,
  nodes: [originalNode],
  rootIds: ["node"],
};

describe("immutable editor command bus", () => {
  it("applies a command, builds an inverse, and preserves the source document", () => {
    const command = createDocumentCommand({
      id: "move-1",
      actor: "human",
      label: "Move Node",
      targetIds: ["node"],
      apply: (document) => moveNodes(document, ["node"], { x: 8, y: -4 }),
    });

    const result = command.apply(originalDocument);
    const restored = command.invert(result).apply(result.document);

    expect(result.document.nodes[0]?.position).toEqual({ x: 18, y: 16 });
    expect(result.document.revision).toBe(4);
    expect(restored.document).toEqual(originalDocument);
    expect(originalDocument.nodes[0]).toBe(originalNode);
  });

  it("records trace metadata and supports undo and redo snapshots", () => {
    const bus = createCommandBus({
      document: originalDocument,
      selection: createSelectionState(["node"]),
    });
    const command = createDocumentCommand({
      id: "agent-move",
      actor: "agent",
      label: "Move Node",
      targetIds: ["node"],
      apply: (document) => moveNodes(document, ["node"], { x: 5, y: 5 }),
    });
    const snapshots: {
      readonly revision: number;
      readonly canUndo: boolean;
      readonly canRedo: boolean;
    }[] = [];
    const unsubscribe = bus.subscribe(() => {
      const snapshot = bus.getSnapshot();
      snapshots.push({
        revision: snapshot.document.revision,
        canUndo: snapshot.canUndo,
        canRedo: snapshot.canRedo,
      });
    });

    const clearedSelection = createSelectionState();
    bus.dispatch(command, { selection: clearedSelection });
    expect(bus.getSnapshot().document.nodes[0]?.position).toEqual({
      x: 15,
      y: 25,
    });
    expect(bus.getSnapshot().selection).toBe(clearedSelection);
    expect(bus.getSnapshot().trace.at(-1)).toMatchObject({
      actor: "agent",
      commandId: "agent-move",
      label: "Move Node",
      targetIds: ["node"],
      beforeRevision: 3,
      afterRevision: 4,
      result: "applied",
    });

    bus.undo();
    expect(bus.getSnapshot().document).toEqual(originalDocument);
    expect(bus.getSnapshot().selection.selectedIds).toEqual(["node"]);
    expect(bus.getSnapshot().trace.at(-1)).toMatchObject({
      label: "Undo Move Node",
      undoOf: "agent-move",
    });
    bus.redo();
    expect(bus.getSnapshot().document.nodes[0]?.position).toEqual({
      x: 15,
      y: 25,
    });
    expect(bus.getSnapshot().selection.selectedIds).toEqual([]);
    expect(snapshots).toEqual([
      { revision: 4, canUndo: true, canRedo: false },
      { revision: 3, canUndo: false, canRedo: true },
      { revision: 4, canUndo: true, canRedo: false },
    ]);

    unsubscribe();
  });

  it("updates selection immutably through the external-store contract", () => {
    const initialSelection = createSelectionState(["node"]);
    const bus = createCommandBus({
      document: originalDocument,
      selection: initialSelection,
    });
    const observedSelections: string[][] = [];
    const unsubscribe = bus.subscribe(() => {
      observedSelections.push([...bus.getSnapshot().selection.selectedIds]);
    });
    const nextSelection = createSelectionState(["other"]);

    bus.setSelection(nextSelection);
    bus.setSelection(nextSelection);

    expect(bus.getSnapshot().selection).toBe(nextSelection);
    expect(initialSelection.selectedIds).toEqual(["node"]);
    expect(observedSelections).toEqual([["other"]]);
    unsubscribe();
  });

  it("records no-op and failed commands without corrupting history", () => {
    const bus = createCommandBus({
      document: originalDocument,
      selection: createSelectionState(),
    });
    const noOp = createDocumentCommand({
      id: "no-op",
      actor: "system",
      label: "No operation",
      targetIds: [],
      apply: (document) => document,
    });
    const failure = createDocumentCommand({
      id: "failure",
      actor: "agent",
      label: "Fail",
      targetIds: ["node"],
      apply: () => {
        throw new Error("revision conflict");
      },
    });
    const nonErrorFailure = createDocumentCommand({
      id: "string-failure",
      actor: "system",
      label: "String failure",
      targetIds: [],
      apply: () => {
        throw "plain failure";
      },
    });

    bus.dispatch(noOp);
    expect(bus.getSnapshot().trace.at(-1)?.result).toBe("no-op");
    expect(() => bus.dispatch(failure)).toThrow("revision conflict");
    expect(bus.getSnapshot().trace.at(-1)).toMatchObject({
      commandId: "failure",
      result: "failed",
      failure: "revision conflict",
    });
    expect(bus.getSnapshot().document).toBe(originalDocument);
    expect(() => bus.dispatch(nonErrorFailure)).toThrow();
    expect(bus.getSnapshot().trace.at(-1)?.failure).toBe("plain failure");
  });

  it("returns false when there is no history to traverse", () => {
    const bus = createCommandBus({
      document: originalDocument,
      selection: createSelectionState(),
    });

    expect(bus.undo()).toBe(false);
    expect(bus.redo()).toBe(false);
  });
});
