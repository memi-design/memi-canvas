import type { WorkbenchNode } from "./model.js";

// Atomic Design: atom — editor metadata that never becomes authored artwork.
export function CanvasNodeMetadataTag({
  node,
}: {
  readonly node: WorkbenchNode;
}) {
  const sourceBinding =
    node.source !== undefined || node.component?.source !== undefined
      ? "source-linked"
      : "canvas-only";

  return (
    <span
      aria-hidden="true"
      className="canvas-node__metadata-tag"
      data-artwork="false"
      data-source-binding={sourceBinding}
      data-testid={`canvas-node-tag-${node.id}`}
    >
      {node.name}
    </span>
  );
}
