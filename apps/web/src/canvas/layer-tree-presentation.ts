import type { EditorIconName } from "./icons.js";
import type { WorkbenchNode } from "./model.js";

export function layerNodeAriaLabel(node: WorkbenchNode): string {
  return node.kind === "ReferenceFrame" && node.locked
    ? `${node.name} ${node.kind} Locked reference`
    : `${node.name} ${node.kind}`;
}

export function layerIcon(node: WorkbenchNode): EditorIconName {
  if (node.kind === "Text") return "text";
  if (node.kind === "Rectangle") return "square";
  if (node.kind === "Ellipse") return "circle";
  if (node.kind === "Line" || node.kind === "Vector") return "line";
  if (node.kind === "Arrow") return "arrow";
  if (node.kind === "Section") return "section";
  if (node.kind === "Comment") return "context";
  if (node.kind === "ComponentInstance") return "layers";
  if (node.source !== undefined) return "route";
  return "frame";
}

export function layerLabel(node: WorkbenchNode): string {
  if (node.source === undefined) return node.name;
  return node.name.split(" / ").at(-1) ?? node.name;
}
