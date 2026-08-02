import type {
  CanvasDocumentV3,
  ProjectId,
} from "@memi/protocol";
import {
  createLocalDesignCanvasDocumentV3,
} from "../../projects/local-design-canvas-v3.js";
import type {
  CanvasWorkbenchProject,
  DocumentNode,
  Point,
  WorkbenchNode,
  WorkbenchNodeKind,
} from "../../canvas/model.js";
import type { FigmaImportResult } from "./figma-import.js";

const SAFE_PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u;

function workbenchKind(node: DocumentNode): WorkbenchNodeKind {
  if (node.kind === "Text") {
    return "Text";
  }
  if (node.kind === "Rectangle") {
    return "Rectangle";
  }
  if (node.kind === "Section" || node.kind === "Frame") {
    return "Frame";
  }
  return "DraftFrame";
}

function paintFill(styles: Readonly<Record<string, unknown>>): string | undefined {
  const fills = styles.fills;
  if (!Array.isArray(fills)) {
    return undefined;
  }
  const paint = fills.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).type === "SOLID" &&
      (candidate as Record<string, unknown>).visible !== false,
  ) as Readonly<Record<string, unknown>> | undefined;
  if (
    paint === undefined ||
    paint.color === null ||
    typeof paint.color !== "object" ||
    Array.isArray(paint.color)
  ) {
    return undefined;
  }
  const color = paint.color as Readonly<Record<string, unknown>>;
  const r = color.r;
  const g = color.g;
  const b = color.b;
  if (
    typeof r !== "number" ||
    typeof g !== "number" ||
    typeof b !== "number" ||
    ![r, g, b].every(Number.isFinite)
  ) {
    return undefined;
  }
  const channels = [r, g, b].map((channel) =>
    `${Number((Math.max(0, Math.min(1, channel)) * 100).toFixed(4))}%`,
  );
  const opacity =
    typeof paint.opacity === "number" && Number.isFinite(paint.opacity)
      ? Math.max(0, Math.min(1, paint.opacity))
      : 1;
  return opacity === 1
    ? `rgb(${channels.join(" ")})`
    : `rgb(${channels.join(" ")} / ${opacity})`;
}

function absolutePositions(
  nodes: readonly DocumentNode[],
): ReadonlyMap<string, Point> {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const cache = new Map<string, Point>();
  function resolve(node: DocumentNode, path: ReadonlySet<string>): Point {
    const cached = cache.get(node.id);
    if (cached !== undefined) {
      return cached;
    }
    if (path.has(node.id)) {
      throw new Error("Figma import contains a parent cycle.");
    }
    const nextPath = new Set([...path, node.id]);
    const parent =
      node.parentId === null ? undefined : byId.get(node.parentId);
    if (node.parentId !== null && parent === undefined) {
      throw new Error("Figma import contains a dangling parent.");
    }
    const parentPosition =
      parent === undefined ? { x: 0, y: 0 } : resolve(parent, nextPath);
    const position = {
      x: parentPosition.x + node.position.x,
      y: parentPosition.y + node.position.y,
    };
    cache.set(node.id, position);
    return position;
  }
  for (const node of nodes) {
    resolve(node, new Set());
  }
  return cache;
}

function workbenchNodes(
  result: FigmaImportResult,
): readonly WorkbenchNode[] {
  const positions = absolutePositions(result.document.nodes);
  return result.document.nodes.map((node) => {
    const text =
      typeof node.styles.text === "string" ? node.styles.text : undefined;
    const fill = paintFill(node.styles);
    return {
      id: node.id,
      kind: workbenchKind(node),
      name: node.name,
      parentId: node.parentId,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      size: { ...node.size },
      locked: node.locked,
      hidden: node.hidden,
      ...(text === undefined ? {} : { text }),
      ...(fill === undefined ? {} : { fill }),
      ...(node.provenance === undefined
        ? {}
        : { provenance: structuredClone(node.provenance) }),
      ...(workbenchKind(node) === "Text"
        ? {}
        : { frameContent: `Figma ${node.kind} · ${result.provenance.fileKey}` }),
    };
  });
}

export function createFigmaCanvasProject(
  result: FigmaImportResult,
  projectId: string,
): CanvasWorkbenchProject {
  if (!SAFE_PROJECT_ID.test(projectId)) {
    throw new Error("The imported project identity is invalid.");
  }
  const nodes = workbenchNodes(result);
  const selectedNodeId = result.document.rootIds[0] ?? null;
  return Object.freeze({
    id: projectId,
    title: result.projectName,
    selectedNodeId,
    document: {
      id: `document-local-${projectId}`,
      revision: 1,
      nodes,
    },
    harness: {
      selectedId: "codex",
      options: [
        { id: "codex", label: "Codex" },
        { id: "claude", label: "Claude Code" },
      ],
    },
    trace:
      selectedNodeId === null
        ? []
        : [
            {
              id: `trace-figma-import-${projectId}`,
              action: `Imported local Figma JSON · ${nodes.length} nodes`,
              targetNodeId: selectedNodeId,
            },
          ],
  });
}

/**
 * Figma is imported as an initial CanvasDocumentV3 snapshot. Once opened, all
 * user mutations are appended to the V3 operation journal; the compatibility
 * workbench projection is never written through the legacy scene autosave.
 */
export function createFigmaCanvasDocumentV3(
  result: FigmaImportResult,
  projectId: string,
  runtimeProjectId: ProjectId,
): CanvasDocumentV3 {
  return createLocalDesignCanvasDocumentV3(
    createFigmaCanvasProject(result, projectId),
    runtimeProjectId,
    "design",
  );
}
