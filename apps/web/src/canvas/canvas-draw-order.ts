import type { WorkbenchNode } from "./model.js";

/**
 * Frames are visual containers: they are always painted before their
 * contents. Unrelated sibling subtrees retain document order, so a later frame
 * cannot unexpectedly jump behind artwork that belongs to another subtree.
 */
export function canvasDrawOrder(
  nodes: readonly WorkbenchNode[],
): readonly WorkbenchNode[] {
  const childrenByParent = new Map<string | null, WorkbenchNode[]>();
  for (const node of nodes) {
    const siblings = childrenByParent.get(node.parentId) ?? [];
    childrenByParent.set(node.parentId, [...siblings, node]);
  }
  const ordered: WorkbenchNode[] = [];
  const visited = new Set<string>();
  const visit = (node: WorkbenchNode): void => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    ordered.push(node);
    for (const child of childrenByParent.get(node.id) ?? []) {
      visit(child);
    }
  };

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root);
  }
  for (const node of nodes) {
    visit(node);
  }
  return ordered;
}
