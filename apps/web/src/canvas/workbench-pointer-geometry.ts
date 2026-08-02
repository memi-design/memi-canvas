import type { ProfessionalCanvasTool } from "./commands.js";
import {
  uniqueNodeId,
  type Point,
  type Size,
  type WorkbenchNode,
} from "./model.js";

export type CreationTool = Exclude<
  ProfessionalCanvasTool,
  "select" | "pan" | "Scale"
>;

function nodeKindForTool(tool: CreationTool): WorkbenchNode["kind"] {
  return tool === "Pen" || tool === "Pencil" ? "Vector" : tool;
}

function defaultNodeSize(kind: WorkbenchNode["kind"]): Size {
  return kind === "Text"
    ? { width: 160, height: 32 }
    : kind === "Rectangle" || kind === "Ellipse"
      ? { width: 160, height: 120 }
      : kind === "Line" || kind === "Arrow"
        ? { width: 160, height: 24 }
        : { width: 320, height: 240 };
}

export function hasLockedAncestor(
  node: WorkbenchNode,
  nodes: readonly WorkbenchNode[],
): boolean {
  const nodesById = new Map(
    nodes.map((candidate) => [candidate.id, candidate]),
  );
  let parentId = node.parentId;
  while (parentId !== null) {
    const parent = nodesById.get(parentId);
    if (parent?.locked === true) {
      return true;
    }
    parentId = parent?.parentId ?? null;
  }
  return false;
}

export function createWorkbenchNode(
  tool: CreationTool,
  at: Point,
  nodes: readonly WorkbenchNode[],
  size = defaultNodeSize(nodeKindForTool(tool)),
  centered = false,
): WorkbenchNode {
  const kind = nodeKindForTool(tool);
  const ordinal = nodes.filter((node) => node.kind === kind).length + 1;
  const name = `${tool} ${ordinal}`;
  const path =
    kind === "Line" || kind === "Arrow"
      ? [
          { x: 0, y: size.height / 2 },
          { x: size.width, y: size.height / 2 },
        ]
      : kind === "Vector"
        ? [
            { x: 0, y: size.height },
            { x: size.width * 0.4, y: 0 },
            { x: size.width, y: size.height * 0.6 },
          ]
        : undefined;
  return {
    id: uniqueNodeId(nodes, `node-${kind.toLowerCase()}`),
    kind,
    name,
    parentId: null,
    position: centered
      ? {
          x: at.x - size.width / 2,
          y: at.y - size.height / 2,
        }
      : at,
    size,
    locked: false,
    hidden: false,
    ...(path === undefined ? {} : { path }),
    ...(kind === "Text"
      ? { text: "Text" }
      : kind === "Comment"
        ? { text: "Comment" }
        : {}),
    ...(kind === "Text" ||
    kind === "Rectangle" ||
    kind === "Ellipse" ||
    kind === "Frame" ||
    kind === "Section" ||
    kind === "Comment"
      ? { fill: "white" }
      : {}),
    ...(kind === "Line" || kind === "Arrow" || kind === "Vector"
      ? { stroke: "white" }
      : {}),
  };
}

export function authoredPathGeometry(points: readonly Point[]): {
  readonly path: readonly Point[];
  readonly position: Point;
  readonly size: Size;
} {
  const minimumX = Math.min(...points.map(({ x }) => x));
  const minimumY = Math.min(...points.map(({ y }) => y));
  const maximumX = Math.max(...points.map(({ x }) => x));
  const maximumY = Math.max(...points.map(({ y }) => y));
  return {
    position: { x: minimumX, y: minimumY },
    size: {
      width: Math.max(1, maximumX - minimumX),
      height: Math.max(1, maximumY - minimumY),
    },
    path: points.map(({ x, y }) => ({
      x: x - minimumX,
      y: y - minimumY,
    })),
  };
}

export function createdNodeGeometry(
  origin: Point,
  current: Point,
  constrain: boolean,
  fromCenter: boolean,
): { readonly position: Point; readonly size: Size } {
  let deltaX = current.x - origin.x;
  let deltaY = current.y - origin.y;
  if (constrain) {
    const dimension = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    deltaX = (deltaX < 0 ? -1 : 1) * dimension;
    deltaY = (deltaY < 0 ? -1 : 1) * dimension;
  }
  if (fromCenter) {
    return {
      position: {
        x: origin.x - Math.abs(deltaX),
        y: origin.y - Math.abs(deltaY),
      },
      size: {
        width: Math.max(1, Math.abs(deltaX) * 2),
        height: Math.max(1, Math.abs(deltaY) * 2),
      },
    };
  }
  return {
    position: {
      x: Math.min(origin.x, origin.x + deltaX),
      y: Math.min(origin.y, origin.y + deltaY),
    },
    size: {
      width: Math.max(1, Math.abs(deltaX)),
      height: Math.max(1, Math.abs(deltaY)),
    },
  };
}
