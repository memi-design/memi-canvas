import { describe, expect, it } from "vitest";

import {
  canvasPointFromViewport,
  canvasGridMetrics,
  changedNode,
  clampCanvasZoom,
  fittedCamera,
  initialCamera,
  panCamera,
  pointFromEvent,
  viewportPointFromCanvas,
  snapCanvasPoint,
  zoomCameraAt,
  type CanvasCamera,
} from "./canvas-camera.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";

describe("canvas camera math", () => {
  const camera: CanvasCamera = { x: 80, y: -40, zoom: 2 };

  it("converts points between viewport and canvas coordinates", () => {
    const canvasPoint = canvasPointFromViewport(camera, {
      x: 320,
      y: 260,
    });

    expect(canvasPoint).toEqual({ x: 120, y: 150 });
    expect(viewportPointFromCanvas(camera, canvasPoint)).toEqual({
      x: 320,
      y: 260,
    });
  });

  it("zooms around the pointer without moving the anchored canvas point", () => {
    const pointer = { x: 500, y: 350 };
    const anchoredPoint = canvasPointFromViewport(camera, pointer);
    const zoomed = zoomCameraAt(camera, pointer, 4);

    expect(zoomed).toEqual({ x: -340, y: -430, zoom: 4 });
    expect(viewportPointFromCanvas(zoomed, anchoredPoint)).toEqual(pointer);
    expect(camera).toEqual({ x: 80, y: -40, zoom: 2 });
  });

  it("pans immutably and clamps zoom to the editor range", () => {
    expect(panCamera(camera, { x: 12, y: -8 })).toEqual({
      x: 92,
      y: -48,
      zoom: 2,
    });
    expect(clampCanvasZoom(0.001)).toBe(0.02);
    expect(clampCanvasZoom(1.25)).toBe(1.25);
    expect(clampCanvasZoom(12)).toBe(8);
    expect(zoomCameraAt(camera, { x: 0, y: 0 }, 100).zoom).toBe(8);
    expect(camera).toEqual({ x: 80, y: -40, zoom: 2 });
  });

  it("keeps an adaptive grid anchored to the camera across zoom thresholds", () => {
    expect(canvasGridMetrics({ x: -10, y: 18, zoom: 0.2 })).toEqual({
      majorPixels: 40,
      majorWorld: 200,
      majorX: 30,
      majorY: 18,
      minorPixels: 10,
      minorWorld: 50,
      minorX: 0,
      minorY: 8,
    });
    expect(canvasGridMetrics({ x: 11, y: -7, zoom: 2 })).toEqual({
      majorPixels: 40,
      majorWorld: 20,
      majorX: 11,
      majorY: 33,
      minorPixels: 10,
      minorWorld: 5,
      minorX: 1,
      minorY: 3,
    });
  });

  it("snaps authored geometry to the active world grid without mutating input", () => {
    const point = { x: 29, y: -23 };
    expect(snapCanvasPoint(point, 16)).toEqual({ x: 32, y: -16 });
    expect(point).toEqual({ x: 29, y: -23 });
  });

  it("fits content with padding and handles empty scenes", () => {
    expect(fittedCamera([], 1000, 700, 1)).toEqual({
      x: 0,
      y: 0,
      zoom: 1,
    });
    expect(
      fittedCamera(
        [
          {
            id: "node",
            kind: "Rectangle",
            name: "Node",
            parentId: null,
            position: { x: 100, y: 200 },
            size: { width: 200, height: 100 },
            locked: false,
            hidden: false,
          },
        ],
        1000,
        700,
        1,
      ),
    ).toEqual({ x: 300, y: 100, zoom: 1 });
  });

  it("retains compatibility helpers for the current workbench", () => {
    expect(pointFromEvent({ clientX: 2, clientY: 3 })).toEqual({
      x: 2,
      y: 3,
    });
    const nodes = changedNode(
      canvasWorkbenchFixture.document.nodes,
      canvasWorkbenchFixture.selectedNodeId,
      { name: "Changed" },
    );
    expect(
      nodes.find(
        ({ id }) => id === canvasWorkbenchFixture.selectedNodeId,
      )?.name,
    ).toBe("Changed");
    expect(initialCamera(canvasWorkbenchFixture)).toEqual({
      x: 0,
      y: 0,
      zoom: 1,
    });
    const largeProject = {
      ...canvasWorkbenchFixture,
      selectedNodeId: "missing",
      document: {
        ...canvasWorkbenchFixture.document,
        nodes: Array.from({ length: 11 }, (_, index) => ({
          ...canvasWorkbenchFixture.document.nodes[0]!,
          id: `node-${index}`,
          position: { x: index * 10, y: index * 5 },
        })),
      },
    };
    expect(initialCamera(largeProject)).toEqual({
      x: 72,
      y: 72,
      zoom: 0.75,
    });
    expect(
      fittedCamera(largeProject.document.nodes, 1, 1, 1).zoom,
    ).toBe(0.05);
  });
});
