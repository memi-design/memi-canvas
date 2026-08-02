import type { CanvasWorkbenchProject } from "./model.js";

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Stable source identity for a workbench session boundary.
 *
 * This intentionally has no dependency on the legacy autosave module: a V3
 * workbench can key its session without loading or writing a SceneState.
 */
export function canvasSourceFingerprint(
  project: CanvasWorkbenchProject,
): `fnv1a64:${string}` {
  const sourceNodes = project.document.nodes
    .filter(
      (node) =>
        node.source !== undefined ||
        node.kind === "CodeFrame" ||
        node.kind === "RoutePlaceholder" ||
        node.kind === "ReferenceFrame" ||
        node.component?.classification === "master",
    )
    .map((node) => ({
      id: node.id,
      kind: node.kind,
      position: node.position,
      size: node.size,
      source: node.source,
      reference: node.reference,
      component: node.component,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return `fnv1a64:${fnv1a64(
    JSON.stringify({
      documentId: project.document.id,
      revision: project.document.revision,
      sourceNodes,
    }),
  )}`;
}
