import type {
  HistoryEntry,
  SceneState,
  WorkbenchNode,
} from "./model.js";

/**
 * Transitional renderer boundary only. Canonical V2 remains the live
 * document and history authority; this shape exists to validate the legacy
 * WorkbenchNode projection while the renderer is migrated node-by-node.
 */
export interface LegacyWorkbenchProjection {
  readonly future: readonly HistoryEntry[];
  readonly nextHistoryId: number;
  readonly nodes: readonly WorkbenchNode[];
  readonly past: readonly HistoryEntry[];
  readonly revision: number;
  readonly selectedNodeId: string | null;
}

export function createLegacyWorkbenchProjection(input: {
  readonly nodes: readonly WorkbenchNode[];
  readonly revision: number;
  readonly selectedNodeId: string | null;
}): LegacyWorkbenchProjection {
  const projection: SceneState = {
    future: [],
    nextHistoryId: 1,
    nodes: input.nodes,
    past: [],
    revision: input.revision,
    selectedNodeId: input.selectedNodeId,
  };
  return projection;
}
