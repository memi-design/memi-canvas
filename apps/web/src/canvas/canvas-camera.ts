import type {
  CanvasWorkbenchProject,
  Point,
  WorkbenchNode,
} from "./model.js";
import { replaceNode } from "./model.js";

export interface CanvasCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export const MIN_CANVAS_ZOOM = 0.02;
export const MAX_CANVAS_ZOOM = 8;

export interface CanvasGridMetrics {
  readonly majorPixels: number;
  readonly majorWorld: number;
  readonly majorX: number;
  readonly majorY: number;
  readonly minorPixels: number;
  readonly minorWorld: number;
  readonly minorX: number;
  readonly minorY: number;
}

function positiveModulo(value: number, divisor: number): number {
  const result = ((value % divisor) + divisor) % divisor;
  return Math.round(result * 1_000_000) / 1_000_000;
}

export function canvasGridWorldSize(zoom: number): number {
  const targetWorld = 12 / clampCanvasZoom(zoom);
  const magnitude = 10 ** Math.floor(Math.log10(targetWorld));
  const normalized = targetWorld / magnitude;
  const interval =
    normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
  return interval * magnitude;
}

export function canvasGridMetrics(
  camera: CanvasCamera,
): CanvasGridMetrics {
  const minorWorld = canvasGridWorldSize(camera.zoom);
  const majorWorld = minorWorld * 4;
  const minorPixels = minorWorld * camera.zoom;
  const majorPixels = majorWorld * camera.zoom;
  return {
    majorPixels,
    majorWorld,
    majorX: positiveModulo(camera.x, majorPixels),
    majorY: positiveModulo(camera.y, majorPixels),
    minorPixels,
    minorWorld,
    minorX: positiveModulo(camera.x, minorPixels),
    minorY: positiveModulo(camera.y, minorPixels),
  };
}

export function snapCanvasPoint(point: Point, gridSize: number): Point {
  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    return { ...point };
  }
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

export function clampCanvasZoom(zoom: number): number {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

export function canvasPointFromViewport(
  camera: CanvasCamera,
  viewportPoint: Point,
): Point {
  return {
    x: (viewportPoint.x - camera.x) / camera.zoom,
    y: (viewportPoint.y - camera.y) / camera.zoom,
  };
}

export function viewportPointFromCanvas(
  camera: CanvasCamera,
  canvasPoint: Point,
): Point {
  return {
    x: camera.x + canvasPoint.x * camera.zoom,
    y: camera.y + canvasPoint.y * camera.zoom,
  };
}

export function panCamera(
  camera: CanvasCamera,
  delta: Point,
): CanvasCamera {
  return {
    ...camera,
    x: camera.x + delta.x,
    y: camera.y + delta.y,
  };
}

export function zoomCameraAt(
  camera: CanvasCamera,
  viewportAnchor: Point,
  requestedZoom: number,
): CanvasCamera {
  const zoom = clampCanvasZoom(requestedZoom);
  const canvasAnchor = canvasPointFromViewport(camera, viewportAnchor);
  return {
    x: viewportAnchor.x - canvasAnchor.x * zoom,
    y: viewportAnchor.y - canvasAnchor.y * zoom,
    zoom,
  };
}

export function pointFromEvent(event: {
  readonly clientX: number;
  readonly clientY: number;
}): Point {
  return { x: event.clientX, y: event.clientY };
}

export function changedNode(
  nodes: readonly WorkbenchNode[],
  nodeId: string,
  changes: Partial<WorkbenchNode>,
): readonly WorkbenchNode[] {
  return replaceNode(nodes, nodeId, (node) => ({ ...node, ...changes }));
}

export function fittedCamera(
  nodes: readonly WorkbenchNode[],
  viewportWidth: number,
  viewportHeight: number,
  maximumZoom: number,
): CanvasCamera {
  if (nodes.length === 0) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const minimumX = Math.min(...nodes.map((node) => node.position.x));
  const minimumY = Math.min(...nodes.map((node) => node.position.y));
  const maximumX = Math.max(
    ...nodes.map((node) => node.position.x + node.size.width),
  );
  const maximumY = Math.max(
    ...nodes.map((node) => node.position.y + node.size.height),
  );
  const padding = 64;
  const contentWidth = Math.max(1, maximumX - minimumX);
  const contentHeight = Math.max(1, maximumY - minimumY);
  const zoom = Math.max(
    0.05,
    Math.min(
      maximumZoom,
      (viewportWidth - padding * 2) / contentWidth,
      (viewportHeight - padding * 2) / contentHeight,
    ),
  );
  return {
    x: (viewportWidth - contentWidth * zoom) / 2 - minimumX * zoom,
    y: (viewportHeight - contentHeight * zoom) / 2 - minimumY * zoom,
    zoom: Math.round(zoom * 100) / 100,
  };
}

export function initialCamera(
  project: CanvasWorkbenchProject,
): CanvasCamera {
  if (project.document.nodes.length <= 10) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const selected =
    project.document.nodes.find(
      (node) => node.id === project.selectedNodeId,
    ) ?? project.document.nodes[0];
  const zoom = 0.75;
  return selected === undefined
    ? fittedCamera(project.document.nodes, 1000, 700, 0.18)
    : {
        x: 72 - selected.position.x * zoom,
        y: 72 - selected.position.y * zoom,
        zoom,
      };
}
