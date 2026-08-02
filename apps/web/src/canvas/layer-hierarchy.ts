import type { WorkbenchNode } from "./model.js";

export function descendantNodeIds(
  nodes: readonly WorkbenchNode[],
  rootId: string,
): ReadonlySet<string> {
  const ids = new Set([rootId]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const node of nodes) {
      if (
        node.parentId !== null &&
        ids.has(node.parentId) &&
        !ids.has(node.id)
      ) {
        ids.add(node.id);
        changed = true;
      }
    }
  }
  return ids;
}
