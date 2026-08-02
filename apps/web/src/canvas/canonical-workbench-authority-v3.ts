import type {
  CanvasDocumentV3,
  CanvasDocumentV3PersistencePort,
  CanvasOperationV3,
} from "@memi/protocol";
import {
  WorkspaceHistoryStateSchemaV1,
  type WorkspaceHistoryStateV1,
} from "@memi/protocol";
import {
  hashCanvasDocumentV3,
  invertCanvasOperationV3,
  migrateCanvasDocumentV2ToV3,
  type CanvasDocumentV3PersistencePolicy,
} from "@memi/canvas-document";

import {
  CanonicalCanvasJournalV3,
  type CanonicalCanvasCommitIntentV3,
} from "./canonical-canvas-journal-v3.js";
import {
  migrateLegacyCanvasState,
  type LegacyCanvasMigrationReceipt,
} from "./canvas-state-migration.js";
import type { LegacyWorkbenchProjection } from "./legacy-workbench-projection.js";
import type { SelectionState } from "./model.js";

export interface LegacyWorkbenchV3MigrationOptions {
  readonly legacyDocumentId: string;
  readonly legacyProjectId: string;
}

export interface LegacyWorkbenchV3Migration {
  readonly document: CanvasDocumentV3;
  readonly legacyReceipt: LegacyCanvasMigrationReceipt;
  readonly selection: SelectionState;
  readonly strategy: "legacy-workbench-via-canvas-v2-to-v3";
}

export interface CanonicalWorkbenchSnapshotV3 {
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly committing: boolean;
  readonly document: CanvasDocumentV3;
  readonly error: string | null;
  readonly selection: SelectionState;
  readonly snapshotRequired: boolean;
}

export interface OpenCanonicalWorkbenchAuthorityV3 {
  readonly document: CanvasDocumentV3;
  readonly persistence: CanvasDocumentV3PersistencePort;
  readonly persistencePolicy?: CanvasDocumentV3PersistencePolicy;
  readonly selection: SelectionState;
  readonly history?: WorkspaceHistoryStateV1;
}

type WorkbenchListener = () => void;

interface PendingPostCommitSelection {
  readonly selection: SelectionState;
  readonly selectionVersion: number;
}

export interface CanonicalWorkbenchHistoryInputV3 {
  readonly actor: "human" | "agent" | "system";
  readonly actorId: string;
  readonly id: string;
  readonly occurredAt: string;
  readonly traceId?: string | null;
}

interface UndoEntry {
  readonly operation: CanvasOperationV3;
  readonly selectionAfter: SelectionState;
  readonly selectionBefore: SelectionState;
}

interface RedoEntry {
  readonly original: UndoEntry;
  readonly undoOperation: CanvasOperationV3;
}

export type CanonicalWorkbenchHistoryStateV3 = WorkspaceHistoryStateV1;

function workspaceSelection(selection: SelectionState) {
  return {
    anchorId: selection.anchorId,
    editingNodeId: selection.editingId,
    focusedNodeId: selection.focusedId,
    selectedIds: [...selection.selectedIds],
  };
}

function restoredHistory(
  operations: readonly CanvasOperationV3[],
  selection: SelectionState,
  persisted?: WorkspaceHistoryStateV1,
): { readonly redo: readonly RedoEntry[]; readonly undo: readonly UndoEntry[] } {
  const undo: UndoEntry[] = [];
  const redo: RedoEntry[] = [];
  const immutable = immutableSelection(selection);
  for (const operation of operations) {
    if (operation.undoOf === null) {
      undo.push({
        operation,
        selectionAfter: immutable,
        selectionBefore: immutable,
      });
      redo.length = 0;
      continue;
    }
    const undoEntry = undo.at(-1);
    if (undoEntry?.operation.id === operation.undoOf) {
      undo.pop();
      redo.push({ original: undoEntry, undoOperation: operation });
      continue;
    }
    const redoEntry = redo.at(-1);
    if (redoEntry?.undoOperation.id === operation.undoOf) {
      redo.pop();
      undo.push({
        operation,
        selectionAfter: redoEntry.original.selectionAfter,
        selectionBefore: redoEntry.original.selectionBefore,
      });
    }
  }
  if (
    persisted !== undefined &&
    persisted.undo.length === undo.length &&
    persisted.redo.length === redo.length &&
    persisted.undo.every((entry, index) => entry.operationId === undo[index]?.operation.id) &&
    persisted.redo.every(
      (entry, index) =>
        entry.operationId === redo[index]?.original.operation.id &&
        entry.undoOperationId === redo[index]?.undoOperation.id,
    )
  ) {
    for (const [index, entry] of persisted.undo.entries()) {
      const operation = undo[index];
      if (operation !== undefined) {
        undo[index] = {
          operation: operation.operation,
          selectionAfter: immutableSelection({
            anchorId: entry.selectionAfter.anchorId,
            editingId: entry.selectionAfter.editingNodeId,
            focusedId: entry.selectionAfter.focusedNodeId,
            selectedIds: entry.selectionAfter.selectedIds,
          }),
          selectionBefore: immutableSelection({
            anchorId: entry.selectionBefore.anchorId,
            editingId: entry.selectionBefore.editingNodeId,
            focusedId: entry.selectionBefore.focusedNodeId,
            selectedIds: entry.selectionBefore.selectedIds,
          }),
        };
      }
    }
    for (const [index, entry] of persisted.redo.entries()) {
      const operation = redo[index];
      if (operation !== undefined) {
        redo[index] = {
          original: {
            operation: operation.original.operation,
            selectionAfter: immutableSelection({
              anchorId: entry.selectionAfter.anchorId,
              editingId: entry.selectionAfter.editingNodeId,
              focusedId: entry.selectionAfter.focusedNodeId,
              selectedIds: entry.selectionAfter.selectedIds,
            }),
            selectionBefore: immutableSelection({
              anchorId: entry.selectionBefore.anchorId,
              editingId: entry.selectionBefore.editingNodeId,
              focusedId: entry.selectionBefore.focusedNodeId,
              selectedIds: entry.selectionBefore.selectedIds,
            }),
          },
          undoOperation: operation.undoOperation,
        };
      }
    }
  }
  return Object.freeze({
    redo: Object.freeze([...redo]),
    undo: Object.freeze([...undo]),
  });
}

function immutableSelection(selection: SelectionState): SelectionState {
  return Object.freeze({
    anchorId: selection.anchorId,
    editingId: selection.editingId,
    focusedId: selection.focusedId,
    selectedIds: Object.freeze([...selection.selectedIds]),
  });
}

function assertSelection(
  selection: SelectionState,
  document: CanvasDocumentV3,
): void {
  if (new Set(selection.selectedIds).size !== selection.selectedIds.length) {
    throw new Error("Canvas V3 selection identities must be unique.");
  }
  const ids = [
    ...selection.selectedIds,
    selection.anchorId,
    selection.focusedId,
    selection.editingId,
  ].filter((id): id is string => id !== null);
  if (ids.some((id) => document.nodesById[id] === undefined)) {
    throw new Error("Canvas selection references a missing V3 node.");
  }
}

function pruneSelection(
  selection: SelectionState,
  document: CanvasDocumentV3,
): SelectionState {
  const present = (id: string | null): string | null =>
    id !== null && document.nodesById[id] !== undefined ? id : null;
  return immutableSelection({
    anchorId: present(selection.anchorId),
    editingId: present(selection.editingId),
    focusedId: present(selection.focusedId),
    selectedIds: selection.selectedIds.filter(
      (id, index) =>
        document.nodesById[id] !== undefined &&
        selection.selectedIds.indexOf(id) === index,
    ),
  });
}

/** Explicit one-way compatibility seam; never used for normal V3 commits. */
export function migrateLegacyWorkbenchProjectionToV3(
  scene: LegacyWorkbenchProjection,
  options: LegacyWorkbenchV3MigrationOptions,
): LegacyWorkbenchV3Migration {
  const v2 = migrateLegacyCanvasState(scene, options);
  if (!v2.ok) {
    throw new Error(`Legacy canvas migration failed: ${v2.issues.join(" ")}`);
  }
  const v3 = migrateCanvasDocumentV2ToV3(v2.document);
  const revisionAligned = {
    ...v3.document,
    operationCursor: null,
    revision: scene.revision,
  };
  const document = Object.freeze({
    ...revisionAligned,
    stateHash: hashCanvasDocumentV3(revisionAligned),
  });
  return Object.freeze({
    document,
    legacyReceipt: v2.receipt,
    selection: immutableSelection(v2.selection),
    strategy: "legacy-workbench-via-canvas-v2-to-v3",
  });
}

/**
 * V3 workbench authority. Public mutation accepts semantic operation intents;
 * the legacy WorkbenchNode array exists only in the migration function above.
 */
export class CanonicalWorkbenchAuthorityV3 {
  readonly #journal: CanonicalCanvasJournalV3;
  readonly #listeners = new Set<WorkbenchListener>();
  readonly #pendingPostCommitSelections = new Map<
    string,
    PendingPostCommitSelection
  >();
  readonly #redo = new Array<RedoEntry>();
  readonly #undo = new Array<UndoEntry>();
  #selection: SelectionState;
  #selectionVersion = 0;

  private constructor(
    journal: CanonicalCanvasJournalV3,
    selection: SelectionState,
    persistedHistory?: WorkspaceHistoryStateV1,
  ) {
    this.#journal = journal;
    this.#selection = pruneSelection(
      selection,
      journal.getSnapshot().document,
    );
    const restored = restoredHistory(
      journal.getOperationLog(),
      this.#selection,
      persistedHistory,
    );
    this.#undo.push(...restored.undo);
    this.#redo.push(...restored.redo);
    this.#journal.subscribe(() => {
      const journalSnapshot = this.#journal.getSnapshot();
      const postCommitSelection = journalSnapshot.document.operationCursor === null
        ? undefined
        : this.#pendingPostCommitSelections.get(
            journalSnapshot.document.operationCursor,
          );
      if (postCommitSelection !== undefined) {
        this.#pendingPostCommitSelections.delete(
          journalSnapshot.document.operationCursor!,
        );
        this.#selection = pruneSelection(
          this.#selectionVersion === postCommitSelection.selectionVersion
            ? postCommitSelection.selection
            : this.#selection,
          journalSnapshot.document,
        );
      } else {
        this.#selection = pruneSelection(
          this.#selection,
          journalSnapshot.document,
        );
      }
      this.#notify();
    });
  }

  static async open(
    input: OpenCanonicalWorkbenchAuthorityV3,
  ): Promise<CanonicalWorkbenchAuthorityV3> {
    const journal = await CanonicalCanvasJournalV3.open(
      input.document,
      input.persistence,
      input.persistencePolicy,
    );
    return new CanonicalWorkbenchAuthorityV3(
      journal,
      input.selection,
      input.history,
    );
  }

  getSnapshot = (): CanonicalWorkbenchSnapshotV3 => {
    const journal = this.#journal.getSnapshot();
    return Object.freeze({
      canRedo: this.#redo.length > 0,
      canUndo: this.#undo.length > 0,
      committing: journal.committing,
      document: journal.document,
      error: journal.error,
      selection: this.#selection,
      snapshotRequired: journal.snapshotRequired,
    });
  };

  subscribe = (listener: WorkbenchListener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getHistoryState = (): CanonicalWorkbenchHistoryStateV3 =>
    WorkspaceHistoryStateSchemaV1.parse({
      redo: this.#redo.map(({ original, undoOperation }) =>
        ({
          operationId: original.operation.id,
          selectionAfter: workspaceSelection(original.selectionAfter),
          selectionBefore: workspaceSelection(original.selectionBefore),
          undoOperationId: undoOperation.id,
        }),
      ),
      undo: this.#undo.map((entry) =>
        ({
          operationId: entry.operation.id,
          selectionAfter: workspaceSelection(entry.selectionAfter),
          selectionBefore: workspaceSelection(entry.selectionBefore),
        }),
      ),
    });

  async commit(
    intent: CanonicalCanvasCommitIntentV3,
    selectionAfter?: SelectionState,
  ): Promise<CanvasOperationV3> {
    if (this.#journal.getSnapshot().committing) {
      throw new Error("Canvas V3 cannot commit while a durable operation is pending.");
    }
    const selectionBefore = this.#selection;
    let historyRecorded = false;
    const selectionVersion = this.#selectionVersion;
    if (selectionAfter !== undefined) {
      this.#pendingPostCommitSelections.set(intent.id, {
        selection: selectionAfter,
        selectionVersion,
      });
    }
    try {
      return await this.#journal.commit(intent, (_nextDocument, operation) => {
        this.#undo.push({
          operation,
          selectionAfter: immutableSelection(selectionAfter ?? selectionBefore),
          selectionBefore,
        });
        this.#redo.length = 0;
        historyRecorded = true;
      });
    } catch (error) {
      if (historyRecorded) {
        this.#undo.pop();
      }
      this.#pendingPostCommitSelections.delete(intent.id);
      throw error;
    }
  }

  async undo(input: CanonicalWorkbenchHistoryInputV3): Promise<CanvasOperationV3> {
    if (this.#journal.getSnapshot().committing) {
      throw new Error("Canvas V3 cannot undo while a durable operation is pending.");
    }
    const original = this.#undo.at(-1);
    if (original === undefined) {
      throw new Error("Canvas V3 has no operation to undo.");
    }
    let historyRecorded = false;
    try {
      return await this.#journal.commitPrepared(
        () =>
          invertCanvasOperationV3(
            this.#journal.getSnapshot().document,
            original.operation,
            {
              ...input,
              label: `Undo ${original.operation.label}`,
            },
          ),
        (_nextDocument, undoOperation) => {
          this.#pendingPostCommitSelections.set(input.id, {
            selection: original.selectionBefore,
            selectionVersion: this.#selectionVersion,
          });
          this.#undo.pop();
          this.#redo.push({ original, undoOperation });
          historyRecorded = true;
        },
      );
    } catch (error) {
      if (historyRecorded) {
        this.#redo.pop();
        this.#undo.push(original);
      }
      this.#pendingPostCommitSelections.delete(input.id);
      throw error;
    }
  }

  async redo(input: CanonicalWorkbenchHistoryInputV3): Promise<CanvasOperationV3> {
    if (this.#journal.getSnapshot().committing) {
      throw new Error("Canvas V3 cannot redo while a durable operation is pending.");
    }
    const entry = this.#redo.at(-1);
    if (entry === undefined) {
      throw new Error("Canvas V3 has no operation to redo.");
    }
    let historyRecorded = false;
    try {
      return await this.#journal.commitPrepared(
        () =>
          invertCanvasOperationV3(
            this.#journal.getSnapshot().document,
            entry.undoOperation,
            {
              ...input,
              label: `Redo ${entry.original.operation.label}`,
            },
          ),
        (_nextDocument, redoOperation) => {
          this.#pendingPostCommitSelections.set(input.id, {
            selection: entry.original.selectionAfter,
            selectionVersion: this.#selectionVersion,
          });
          this.#redo.pop();
          this.#undo.push({
            operation: redoOperation,
            selectionAfter: entry.original.selectionAfter,
            selectionBefore: entry.original.selectionBefore,
          });
          historyRecorded = true;
        },
      );
    } catch (error) {
      if (historyRecorded) {
        this.#undo.pop();
        this.#redo.push(entry);
      }
      this.#pendingPostCommitSelections.delete(input.id);
      throw error;
    }
  }

  setSelection(selection: SelectionState): void {
    assertSelection(selection, this.#journal.getSnapshot().document);
    this.#selectionVersion += 1;
    this.#selection = immutableSelection(selection);
    this.#notify();
  }

  async checkpoint(persistedAt: string): Promise<void> {
    await this.#journal.checkpoint(persistedAt);
    // A checkpoint materializes the baseline and truncates the persisted tail.
    // Keep current- and restart-history semantics aligned.
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
