import type {
  DesignDocument,
  SelectionState,
} from "./model.js";

export type CommandActor = "human" | "agent" | "system";

export interface CommandResult {
  readonly beforeDocument: DesignDocument;
  readonly document: DesignDocument;
  readonly changedNodeIds: readonly string[];
}

export interface EditorCommand {
  readonly id: string;
  readonly actor: CommandActor;
  readonly label: string;
  readonly targetIds: readonly string[];
  apply(document: DesignDocument): CommandResult;
  invert(result: CommandResult): EditorCommand;
}

export interface CommandTrace {
  readonly actor: CommandActor;
  readonly commandId: string;
  readonly label: string;
  readonly targetIds: readonly string[];
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly durationMs: number;
  readonly result: "applied" | "no-op" | "failed";
  readonly undoOf?: string;
  readonly failure?: string;
}

export interface CommandBusSnapshot {
  readonly document: DesignDocument;
  readonly selection: SelectionState;
  readonly trace: readonly CommandTrace[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

interface CommandHistoryEntry {
  readonly command: EditorCommand;
  readonly inverse: EditorCommand;
  readonly beforeSelection: SelectionState;
  readonly afterSelection: SelectionState;
}

export interface CommandBus {
  getSnapshot(): CommandBusSnapshot;
  subscribe(listener: () => void): () => void;
  setSelection(selection: SelectionState): void;
  dispatch(
    command: EditorCommand,
    options?: { readonly selection?: SelectionState },
  ): CommandResult;
  undo(): boolean;
  redo(): boolean;
}

interface CommandDefinition {
  readonly id: string;
  readonly actor: CommandActor;
  readonly label: string;
  readonly targetIds: readonly string[];
  readonly apply: (document: DesignDocument) => DesignDocument;
}

function changedNodeIds(
  before: DesignDocument,
  after: DesignDocument,
): readonly string[] {
  const beforeById = new Map(before.nodes.map((node) => [node.id, node]));
  const afterById = new Map(after.nodes.map((node) => [node.id, node]));
  return [...new Set([...beforeById.keys(), ...afterById.keys()])].filter(
    (id) =>
      JSON.stringify(beforeById.get(id)) !== JSON.stringify(afterById.get(id)),
  );
}

function snapshotCommand(
  definition: Omit<CommandDefinition, "apply">,
  snapshot: DesignDocument,
): EditorCommand {
  return createDocumentCommand({
    ...definition,
    apply: () => structuredClone(snapshot),
  });
}

export function createDocumentCommand(
  definition: CommandDefinition,
): EditorCommand {
  const targetIds = Object.freeze([...definition.targetIds]);
  return Object.freeze({
    id: definition.id,
    actor: definition.actor,
    label: definition.label,
    targetIds,
    apply(document: DesignDocument): CommandResult {
      const nextDocument = definition.apply(document);
      return {
        beforeDocument: document,
        document: nextDocument,
        changedNodeIds: changedNodeIds(document, nextDocument),
      };
    },
    invert(result: CommandResult): EditorCommand {
      return snapshotCommand(
        {
          id: `${definition.id}:inverse`,
          actor: definition.actor,
          label: `Undo ${definition.label}`,
          targetIds,
        },
        result.beforeDocument,
      );
    },
  });
}

function timestamp(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function createCommandBus(initial: {
  readonly document: DesignDocument;
  readonly selection: SelectionState;
}): CommandBus {
  let document = initial.document;
  let selection = initial.selection;
  let trace: readonly CommandTrace[] = [];
  let past: readonly CommandHistoryEntry[] = [];
  let future: readonly CommandHistoryEntry[] = [];
  const listeners = new Set<() => void>();

  const notify = (): void => {
    listeners.forEach((listener) => listener());
  };

  const snapshot = (): CommandBusSnapshot => ({
    document,
    selection,
    trace,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  });

  const applyCommand = (
    command: EditorCommand,
    options: { readonly undoOf?: string } = {},
  ): CommandResult => {
    const startedAt = timestamp();
    const beforeRevision = document.revision;
    try {
      const result = command.apply(document);
      document = result.document;
      trace = [
        ...trace,
        {
          actor: command.actor,
          commandId: command.id,
          label: command.label,
          targetIds: [...command.targetIds],
          beforeRevision,
          afterRevision: document.revision,
          durationMs: Math.max(0, timestamp() - startedAt),
          result:
            result.changedNodeIds.length === 0 &&
            result.beforeDocument.revision === result.document.revision
              ? "no-op"
              : "applied",
          ...(options.undoOf === undefined
            ? {}
            : { undoOf: options.undoOf }),
        },
      ];
      return result;
    } catch (error) {
      trace = [
        ...trace,
        {
          actor: command.actor,
          commandId: command.id,
          label: command.label,
          targetIds: [...command.targetIds],
          beforeRevision,
          afterRevision: document.revision,
          durationMs: Math.max(0, timestamp() - startedAt),
          result: "failed",
          failure: error instanceof Error ? error.message : String(error),
          ...(options.undoOf === undefined
            ? {}
            : { undoOf: options.undoOf }),
        },
      ];
      notify();
      throw error;
    }
  };

  return {
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setSelection(nextSelection) {
      if (nextSelection === selection) {
        return;
      }
      selection = nextSelection;
      notify();
    },
    dispatch(command, options = {}) {
      const beforeSelection = selection;
      const result = applyCommand(command);
      const afterSelection = options.selection ?? beforeSelection;
      selection = afterSelection;
      if (
        result.changedNodeIds.length > 0 ||
        result.beforeDocument.revision !== result.document.revision ||
        afterSelection !== beforeSelection
      ) {
        past = [
          ...past,
          {
            command,
            inverse: command.invert(result),
            beforeSelection,
            afterSelection,
          },
        ];
        future = [];
      }
      notify();
      return result;
    },
    undo() {
      const entry = past.at(-1);
      if (entry === undefined) {
        return false;
      }
      applyCommand(entry.inverse, { undoOf: entry.command.id });
      selection = entry.beforeSelection;
      past = past.slice(0, -1);
      future = [entry, ...future];
      notify();
      return true;
    },
    redo() {
      const entry = future[0];
      if (entry === undefined) {
        return false;
      }
      applyCommand(entry.command);
      selection = entry.afterSelection;
      future = future.slice(1);
      past = [...past, entry];
      notify();
      return true;
    },
  };
}
