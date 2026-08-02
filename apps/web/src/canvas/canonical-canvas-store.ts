import {
  CanvasDocumentV2Schema,
  CanvasOperationV2Schema,
  type CanvasActionIntentV2,
  type CanvasDocumentV2,
  type CanvasOperationV2,
  type OperationId,
} from "@memi/protocol";
import {
  applyCanvasOperationV2,
  invertCanvasOperationV2,
  prepareCanvasOperationV2,
} from "@memi/canvas-document";

import type { SelectionState, ViewportState } from "./model.js";

export const CANONICAL_SNAPSHOT_OPERATION_THRESHOLD = 250;
export const CANONICAL_SNAPSHOT_BYTE_THRESHOLD = 2_000_000;
export const CANONICAL_HISTORY_MAX_ENTRIES = 1_000;

export interface CanvasSnapshotState {
  readonly operationBytes: number;
  readonly operationCount: number;
  readonly required: boolean;
}

export interface CanonicalCanvasSnapshot {
  readonly document: CanvasDocumentV2;
  readonly selection: SelectionState;
  readonly viewport: ViewportState;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly snapshot: CanvasSnapshotState;
}

export interface CanvasGuide {
  readonly axis: "x" | "y";
  readonly position: number;
}

export interface CanvasGesture {
  readonly kind: "draw" | "marquee" | "move" | "pan" | "resize" | "rotate";
  readonly pointerId: number;
  readonly origin: { readonly x: number; readonly y: number };
}

export interface CanvasTransientState {
  readonly hoveredNodeId: string | null;
  readonly pointer: { readonly x: number; readonly y: number } | null;
  readonly gesture: CanvasGesture | null;
  readonly guides: readonly CanvasGuide[];
}

export interface CanvasHistoryEntryV2 {
  readonly id: OperationId;
  readonly label: string;
  readonly operation: CanvasOperationV2;
  readonly selectionBefore: SelectionState;
  readonly selectionAfter: SelectionState;
}

export interface CanvasHistorySnapshot {
  readonly past: readonly CanvasHistoryEntryV2[];
  readonly future: readonly CanvasHistoryEntryV2[];
}

export interface HistoryOperationAllocation {
  readonly id: OperationId;
  readonly actor: "human" | "agent" | "system";
  readonly actorId: string;
  readonly occurredAt: string;
}

export type CanvasDispatchResult =
  | { readonly ok: true; readonly revision: number; readonly changed?: false }
  | {
      readonly ok: false;
      readonly code: "stale-operation" | "invalid-operation";
      readonly message: string;
    };

export interface CanonicalCanvasStore {
  getSnapshot(): CanonicalCanvasSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeSelector<T>(
    selector: (snapshot: CanonicalCanvasSnapshot) => T,
    listener: (value: T, previous: T) => void,
    equals?: (left: T, right: T) => boolean,
  ): () => void;
  getTransientSnapshot(): CanvasTransientState;
  subscribeTransient(listener: () => void): () => void;
  setTransient(
    next:
      | CanvasTransientState
      | ((current: CanvasTransientState) => CanvasTransientState),
  ): void;
  setSelection(selection: SelectionState): void;
  setViewport(viewport: ViewportState): void;
  dispatch(
    operation: CanvasOperationV2,
    options?: {
      readonly historyLabel?: string;
      readonly selectionAfter?: SelectionState;
    },
  ): CanvasDispatchResult;
  dispatchIntent(
    action: CanvasActionIntentV2,
    options: {
      readonly actor: "human" | "agent" | "system";
      readonly actorId: string;
      readonly historyLabel?: string;
      readonly id: OperationId;
      readonly occurredAt: string;
      readonly selectionAfter?: SelectionState;
    },
  ): CanvasDispatchResult;
  undo(): CanvasDispatchResult;
  redo(): CanvasDispatchResult;
  getHistorySnapshot(): CanvasHistorySnapshot;
  acknowledgeSnapshot(): void;
}

const EMPTY_SELECTION: SelectionState = {
  anchorId: null,
  editingId: null,
  focusedId: null,
  selectedIds: [],
};

const DEFAULT_VIEWPORT: ViewportState = {
  pointerMode: "idle",
  translation: { x: 0, y: 0 },
  viewportSize: { height: 0, width: 0 },
  zoom: 1,
};

const EMPTY_TRANSIENT: CanvasTransientState = {
  gesture: null,
  guides: [],
  hoveredNodeId: null,
  pointer: null,
};

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const object = value as object;
  if (seen.has(object)) {
    return value;
  }
  seen.add(object);
  Object.values(object).forEach((nested) => deepFreeze(nested, seen));
  return Object.freeze(value);
}

function immutableClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => valuesEqual(item, right[index]))
    );
  }
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        valuesEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function assertSelection(
  selection: SelectionState,
  document: CanvasDocumentV2,
): void {
  if (new Set(selection.selectedIds).size !== selection.selectedIds.length) {
    throw new Error("Canvas selection identities must be unique.");
  }
  const ids = [
    ...selection.selectedIds,
    selection.anchorId,
    selection.focusedId,
    selection.editingId,
  ].filter((id): id is string => id !== null);
  if (ids.some((id) => document.nodesById[id] === undefined)) {
    throw new Error("Canvas selection references a missing canonical node.");
  }
}

function validSelection(
  selection: SelectionState,
  document: CanvasDocumentV2,
): SelectionState {
  const present = (id: string | null): string | null =>
    id !== null && document.nodesById[id] !== undefined ? id : null;
  return immutableClone({
    anchorId: present(selection.anchorId),
    editingId: present(selection.editingId),
    focusedId: present(selection.focusedId),
    selectedIds: selection.selectedIds.filter(
      (id) => document.nodesById[id] !== undefined,
    ),
  });
}

function assertViewport(viewport: ViewportState): void {
  const numbers = [
    viewport.translation.x,
    viewport.translation.y,
    viewport.viewportSize.width,
    viewport.viewportSize.height,
    viewport.zoom,
  ];
  if (
    numbers.some((value) => !Number.isFinite(value)) ||
    viewport.zoom <= 0 ||
    viewport.viewportSize.width < 0 ||
    viewport.viewportSize.height < 0
  ) {
    throw new Error("Canvas viewport contains invalid numeric values.");
  }
}

function operationBytes(operation: CanvasOperationV2): number {
  return new TextEncoder().encode(JSON.stringify(operation)).byteLength;
}

function snapshotState(
  operationCount: number,
  operationByteCount: number,
): CanvasSnapshotState {
  return {
    operationBytes: operationByteCount,
    operationCount,
    required:
      operationCount >= CANONICAL_SNAPSHOT_OPERATION_THRESHOLD ||
      operationByteCount >= CANONICAL_SNAPSHOT_BYTE_THRESHOLD,
  };
}

function failure(error: unknown): CanvasDispatchResult {
  const message =
    error instanceof Error ? error.message : "Canonical canvas operation failed.";
  return {
    code: /stale|expected-before|exact resulting document/iu.test(message)
      ? "stale-operation"
      : "invalid-operation",
    message,
    ok: false,
  };
}

export function createCanonicalCanvasStore(options: {
  readonly document: CanvasDocumentV2;
  readonly selection?: SelectionState;
  readonly viewport?: ViewportState;
  readonly transient?: CanvasTransientState;
  readonly allocateHistoryOperation: (
    direction: "undo" | "redo",
    entry: CanvasHistoryEntryV2,
  ) => HistoryOperationAllocation;
  readonly onSnapshotRequired?: (snapshot: CanonicalCanvasSnapshot) => void;
  readonly onStoreError?: (error: unknown) => void;
}): CanonicalCanvasStore {
  let document = deepFreeze(
    CanvasDocumentV2Schema.parse(structuredClone(options.document)),
  );
  let selection = immutableClone(options.selection ?? EMPTY_SELECTION);
  let viewport = immutableClone(options.viewport ?? DEFAULT_VIEWPORT);
  let transient = immutableClone(options.transient ?? EMPTY_TRANSIENT);
  assertSelection(selection, document);
  assertViewport(viewport);

  let history: CanvasHistorySnapshot = deepFreeze({ future: [], past: [] });
  let operationCount = 0;
  let operationByteCount = 0;
  let durableSnapshot: CanonicalCanvasSnapshot = deepFreeze({
    canRedo: false,
    canUndo: false,
    document,
    selection,
    snapshot: snapshotState(0, 0),
    viewport,
  });
  const durableListeners = new Set<() => void>();
  const transientListeners = new Set<() => void>();
  const appliedOperations = new Map<
    OperationId,
    { readonly actionDigest: string; readonly resultingHash: string }
  >();

  const reportError = (error: unknown): void => {
    if (options.onStoreError !== undefined) {
      try {
        options.onStoreError(error);
      } catch (reportingError) {
        console.error("Canonical canvas error reporter failed.", reportingError);
      }
      return;
    }
    console.error("Canonical canvas subscriber failed.", error);
  };

  const notify = (listeners: ReadonlySet<() => void>): void => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        reportError(error);
      }
    }
  };

  const rebuildSnapshot = (): void => {
    durableSnapshot = deepFreeze({
      canRedo: history.future.length > 0,
      canUndo: history.past.length > 0,
      document,
      selection,
      snapshot: snapshotState(operationCount, operationByteCount),
      viewport,
    });
  };

  const publish = (wasRequired: boolean): void => {
    rebuildSnapshot();
    notify(durableListeners);
    if (!wasRequired && durableSnapshot.snapshot.required) {
      try {
        options.onSnapshotRequired?.(durableSnapshot);
      } catch (error) {
        reportError(error);
      }
    }
  };

  const count = (operation: CanvasOperationV2): void => {
    operationCount += 1;
    operationByteCount += operationBytes(operation);
  };

  const traverseHistory = (
    entry: CanvasHistoryEntryV2,
    direction: "undo" | "redo",
  ): CanvasDispatchResult => {
    const wasRequired = durableSnapshot.snapshot.required;
    try {
      const inverse = invertCanvasOperationV2(
        document,
        entry.operation,
        options.allocateHistoryOperation(direction, entry),
      );
      const next = applyCanvasOperationV2(document, inverse);
      if (next === document) {
        return { changed: false, ok: true, revision: document.revision };
      }
      document = next;
      selection = validSelection(
        direction === "undo"
          ? entry.selectionBefore
          : entry.selectionAfter,
        document,
      );
      const movedEntry = deepFreeze({ ...entry, operation: inverse });
      history =
        direction === "undo"
          ? deepFreeze({
              future: [movedEntry, ...history.future].slice(
                0,
                CANONICAL_HISTORY_MAX_ENTRIES,
              ),
              past: history.past.slice(0, -1),
            })
          : deepFreeze({
              future: history.future.slice(1),
              past: [...history.past, movedEntry].slice(
                -CANONICAL_HISTORY_MAX_ENTRIES,
              ),
            });
      count(inverse);
      publish(wasRequired);
      return { ok: true, revision: document.revision };
    } catch (error) {
      return failure(error);
    }
  };

  const store: CanonicalCanvasStore = {
    getSnapshot: () => durableSnapshot,
    subscribe(listener) {
      durableListeners.add(listener);
      return () => durableListeners.delete(listener);
    },
    subscribeSelector(selector, listener, equals = Object.is) {
      let previous = selector(durableSnapshot);
      const durableListener = (): void => {
        const value = selector(durableSnapshot);
        if (!equals(value, previous)) {
          const oldValue = previous;
          previous = value;
          listener(value, oldValue);
        }
      };
      durableListeners.add(durableListener);
      return () => durableListeners.delete(durableListener);
    },
    getTransientSnapshot: () => transient,
    subscribeTransient(listener) {
      transientListeners.add(listener);
      return () => transientListeners.delete(listener);
    },
    setTransient(next) {
      const value = typeof next === "function" ? next(transient) : next;
      if (valuesEqual(value, transient)) {
        return;
      }
      transient = immutableClone(value);
      notify(transientListeners);
    },
    setSelection(nextSelection) {
      assertSelection(nextSelection, document);
      if (valuesEqual(nextSelection, selection)) {
        return;
      }
      selection = immutableClone(nextSelection);
      publish(durableSnapshot.snapshot.required);
    },
    setViewport(nextViewport) {
      assertViewport(nextViewport);
      if (valuesEqual(nextViewport, viewport)) {
        return;
      }
      viewport = immutableClone(nextViewport);
      publish(durableSnapshot.snapshot.required);
    },
    dispatch(untrustedOperation, dispatchOptions = {}) {
      try {
        const operation = deepFreeze(
          CanvasOperationV2Schema.parse(
            structuredClone(untrustedOperation),
          ),
        );
        const existing = appliedOperations.get(operation.id);
        if (
          existing !== undefined &&
          existing.actionDigest === operation.actionDigest &&
          existing.resultingHash === operation.resultingHash
        ) {
          return { changed: false, ok: true, revision: document.revision };
        }
        const wasRequired = durableSnapshot.snapshot.required;
        const next = applyCanvasOperationV2(document, operation);
        const selectionBefore = selection;
        document = next;
        selection = validSelection(
          dispatchOptions.selectionAfter ?? selection,
          document,
        );
        const entry = deepFreeze({
          id: operation.id,
          label: dispatchOptions.historyLabel ?? operation.label,
          operation,
          selectionAfter: selection,
          selectionBefore,
        });
        appliedOperations.set(operation.id, {
          actionDigest: operation.actionDigest,
          resultingHash: operation.resultingHash,
        });
        history = deepFreeze({
          future: [],
          past: [...history.past, entry].slice(
            -CANONICAL_HISTORY_MAX_ENTRIES,
          ),
        });
        count(operation);
        publish(wasRequired);
        return { ok: true, revision: document.revision };
      } catch (error) {
        return failure(error);
      }
    },
    dispatchIntent(action, dispatchOptions) {
      try {
        const operation = prepareCanvasOperationV2(document, {
          action,
          actor: dispatchOptions.actor,
          actorId: dispatchOptions.actorId,
          id: dispatchOptions.id,
          occurredAt: dispatchOptions.occurredAt,
        });
        return store.dispatch(operation, {
          ...(dispatchOptions.historyLabel === undefined
            ? {}
            : { historyLabel: dispatchOptions.historyLabel }),
          ...(dispatchOptions.selectionAfter === undefined
            ? {}
            : { selectionAfter: dispatchOptions.selectionAfter }),
        });
      } catch (error) {
        return failure(error);
      }
    },
    undo() {
      const entry = history.past.at(-1);
      return entry === undefined
        ? { changed: false, ok: true, revision: document.revision }
        : traverseHistory(entry, "undo");
    },
    redo() {
      const entry = history.future[0];
      return entry === undefined
        ? { changed: false, ok: true, revision: document.revision }
        : traverseHistory(entry, "redo");
    },
    getHistorySnapshot: () => history,
    acknowledgeSnapshot() {
      if (operationCount === 0 && operationByteCount === 0) {
        return;
      }
      const wasRequired = durableSnapshot.snapshot.required;
      operationCount = 0;
      operationByteCount = 0;
      publish(wasRequired);
    },
  };
  return Object.freeze(store);
}
