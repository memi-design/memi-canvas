import type { CanvasWorkbenchProject, WorkbenchNode } from "./model.js";

export interface HistoryEntry {
  readonly id: number;
  readonly label: string;
  readonly before: readonly WorkbenchNode[];
  readonly after: readonly WorkbenchNode[];
  readonly beforeSelectedNodeId: string | null;
  readonly afterSelectedNodeId: string | null;
  readonly beforeRevision: number;
  readonly afterRevision: number;
}

export interface SceneState {
  readonly nodes: readonly WorkbenchNode[];
  readonly selectedNodeId: string | null;
  readonly revision: number;
  readonly past: readonly HistoryEntry[];
  readonly future: readonly HistoryEntry[];
  readonly nextHistoryId: number;
}

export const SCENE_HISTORY_MAX_ENTRIES = 100;

export type SceneAction =
  | { readonly type: "select"; readonly nodeId: string | null }
  | { readonly type: "preview"; readonly nodes: readonly WorkbenchNode[] }
  | {
      readonly type: "commit-preview";
      readonly label: string;
      readonly before: readonly WorkbenchNode[];
    }
  | {
      readonly type: "commit";
      readonly label: string;
      readonly nodes: readonly WorkbenchNode[];
      readonly selectedNodeId?: string | null;
    }
  | { readonly type: "undo" }
  | { readonly type: "redo" };

function sameNodes(
  left: readonly WorkbenchNode[],
  right: readonly WorkbenchNode[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function historyEntry(
  state: SceneState,
  label: string,
  before: readonly WorkbenchNode[],
  after: readonly WorkbenchNode[],
  beforeSelectedNodeId: string | null,
  afterSelectedNodeId: string | null,
): HistoryEntry {
  return {
    after,
    afterRevision: state.revision + 1,
    afterSelectedNodeId,
    before,
    beforeRevision: state.revision,
    beforeSelectedNodeId,
    id: state.nextHistoryId,
    label,
  };
}

export function createSceneState(project: CanvasWorkbenchProject): SceneState {
  return {
    future: [],
    nextHistoryId: 1,
    nodes: structuredClone(project.document.nodes),
    past: [],
    revision: project.document.revision,
    selectedNodeId: project.selectedNodeId,
  };
}

export function sceneReducer(
  state: SceneState,
  action: SceneAction,
): SceneState {
  if (action.type === "select") {
    return { ...state, selectedNodeId: action.nodeId };
  }
  if (action.type === "preview") {
    return { ...state, nodes: action.nodes };
  }
  if (action.type === "commit-preview") {
    if (sameNodes(action.before, state.nodes)) return state;
    return {
      ...state,
      future: [],
      nextHistoryId: state.nextHistoryId + 1,
      past: [
        ...state.past,
        historyEntry(
          state,
          action.label,
          action.before,
          state.nodes,
          state.selectedNodeId,
          state.selectedNodeId,
        ),
      ].slice(-SCENE_HISTORY_MAX_ENTRIES),
      revision: state.revision + 1,
    };
  }
  if (action.type === "commit") {
    if (sameNodes(state.nodes, action.nodes)) return state;
    const selectedNodeId =
      action.selectedNodeId === undefined
        ? state.selectedNodeId
        : action.selectedNodeId;
    return {
      ...state,
      future: [],
      nextHistoryId: state.nextHistoryId + 1,
      nodes: action.nodes,
      past: [
        ...state.past,
        historyEntry(
          state,
          action.label,
          state.nodes,
          action.nodes,
          state.selectedNodeId,
          selectedNodeId,
        ),
      ].slice(-SCENE_HISTORY_MAX_ENTRIES),
      revision: state.revision + 1,
      selectedNodeId,
    };
  }
  if (action.type === "undo") {
    const entry = state.past.at(-1);
    return entry === undefined
      ? state
      : {
          ...state,
          future: [entry, ...state.future].slice(0, SCENE_HISTORY_MAX_ENTRIES),
          nodes: entry.before,
          past: state.past.slice(0, -1),
          revision: entry.beforeRevision,
          selectedNodeId: entry.beforeSelectedNodeId,
        };
  }
  const entry = state.future[0];
  return entry === undefined
    ? state
    : {
        ...state,
        future: state.future.slice(1),
        nodes: entry.after,
        past: [...state.past, entry].slice(-SCENE_HISTORY_MAX_ENTRIES),
        revision: entry.afterRevision,
        selectedNodeId: entry.afterSelectedNodeId,
      };
}
