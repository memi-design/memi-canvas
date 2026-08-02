import {
  createCommandBus,
  createDocumentCommand,
  type CommandActor,
  type CommandBus,
  type CommandTrace,
} from "./command-bus.js";
import {
  createSelectionState,
  designDocumentFromWorkbench,
  type DesignDocument,
  type SceneState,
  type SelectionState,
  type WorkbenchNode,
} from "./model.js";

export interface LegacySceneMutation {
  readonly actor: CommandActor;
  readonly id: string;
  readonly label: string;
  readonly nodes: readonly WorkbenchNode[];
  readonly selection: SelectionState;
  readonly targetIds: readonly string[];
}

export interface SceneCommandAdapter {
  dispatch(mutation: LegacySceneMutation): CommandTrace;
  getBus(): CommandBus;
  redo(): CommandTrace | null;
  setSelection(selection: SelectionState): void;
  undo(): CommandTrace | null;
}

function documentFromSceneNodes(
  documentId: string,
  revision: number,
  nodes: readonly WorkbenchNode[],
): DesignDocument {
  return designDocumentFromWorkbench({
    id: documentId,
    revision,
    nodes,
  });
}

function commandForSnapshot(input: {
  readonly actor: CommandActor;
  readonly document: DesignDocument;
  readonly id: string;
  readonly label: string;
  readonly targetIds: readonly string[];
}) {
  return createDocumentCommand({
    actor: input.actor,
    id: input.id,
    label: input.label,
    targetIds: input.targetIds,
    apply: () => structuredClone(input.document),
  });
}

function latestTrace(bus: CommandBus): CommandTrace {
  const trace = bus.getSnapshot().trace.at(-1);
  if (trace === undefined) {
    throw new Error("The editor command completed without a trace event.");
  }
  return trace;
}

function seedCommandBus(
  documentId: string,
  scene: SceneState,
  selection: SelectionState,
): CommandBus {
  const firstEntry = scene.past[0];
  const initialDocument =
    firstEntry === undefined
      ? documentFromSceneNodes(documentId, scene.revision, scene.nodes)
      : documentFromSceneNodes(
          documentId,
          firstEntry.beforeRevision,
          firstEntry.before,
        );
  const initialSelection =
    firstEntry === undefined
      ? selection
      : createSelectionState(
          firstEntry.beforeSelectedNodeId === null
            ? []
            : [firstEntry.beforeSelectedNodeId],
        );
  const bus = createCommandBus({
    document: initialDocument,
    selection: initialSelection,
  });
  const recoverableHistory = [...scene.past, ...scene.future];
  for (const entry of recoverableHistory) {
    bus.dispatch(
      commandForSnapshot({
        actor: "system",
        document: documentFromSceneNodes(
          documentId,
          entry.afterRevision,
          entry.after,
        ),
        id: `recovered-history-${entry.id}`,
        label: entry.label,
        targetIds: [],
      }),
      {
        selection: createSelectionState(
          entry.afterSelectedNodeId === null
            ? []
            : [entry.afterSelectedNodeId],
        ),
      },
    );
  }
  for (let index = 0; index < scene.future.length; index += 1) {
    bus.undo();
  }
  bus.setSelection(selection);
  return bus;
}

export function createSceneCommandAdapter(input: {
  readonly documentId: string;
  readonly scene: SceneState;
  readonly selection: SelectionState;
}): SceneCommandAdapter {
  const bus = seedCommandBus(
    input.documentId,
    input.scene,
    input.selection,
  );

  return {
    dispatch(mutation) {
      const current = bus.getSnapshot().document;
      const candidate = documentFromSceneNodes(
        input.documentId,
        current.revision + 1,
        mutation.nodes,
      );
      const document =
        JSON.stringify(current.nodes) === JSON.stringify(candidate.nodes) &&
        JSON.stringify(current.rootIds) === JSON.stringify(candidate.rootIds)
          ? current
          : candidate;
      bus.dispatch(
        commandForSnapshot({
          actor: mutation.actor,
          document,
          id: mutation.id,
          label: mutation.label,
          targetIds: mutation.targetIds,
        }),
        { selection: mutation.selection },
      );
      return latestTrace(bus);
    },
    getBus() {
      return bus;
    },
    redo() {
      return bus.redo() ? latestTrace(bus) : null;
    },
    setSelection(selection) {
      bus.setSelection(selection);
    },
    undo() {
      return bus.undo() ? latestTrace(bus) : null;
    },
  };
}

export function commandTraceAction(trace: CommandTrace): string {
  const actor = `${trace.actor[0]?.toLocaleUpperCase() ?? ""}${trace.actor.slice(1)}`;
  return `${actor} · ${trace.label} · r${trace.beforeRevision} → r${trace.afterRevision} · ${trace.result}`;
}
