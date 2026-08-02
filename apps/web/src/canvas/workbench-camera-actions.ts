import type { RefObject, WheelEvent } from "react";

import {
  fittedCamera,
  panCamera,
  zoomCameraAt,
  type CanvasCamera,
} from "./canvas-camera.js";
import type { FrameStateScheduler } from "./canvas-performance.js";
import type { WorkbenchNode } from "./model.js";
import type { WorkbenchHistoryActions } from "./workbench-history-actions.js";

interface CameraActionContext {
  readonly cameraScheduler: RefObject<
    FrameStateScheduler<CanvasCamera> | null
  >;
  readonly gesture: {
    readonly current: unknown | null;
  };
  readonly nodes: readonly WorkbenchNode[];
  readonly selectNodeIds: WorkbenchHistoryActions["selectNodeIds"];
  readonly selectedNodeIds: readonly string[];
  readonly viewportElement: RefObject<HTMLDivElement | null>;
  readonly viewportSize: {
    readonly height: number;
    readonly width: number;
  };
}

export interface WorkbenchCameraActions {
  readonly fitAll: () => void;
  readonly fitSelection: () => void;
  readonly handleWheel: (event: WheelEvent<HTMLDivElement>) => void;
  readonly selectAndRevealNode: (nodeId: string) => void;
  readonly zoomBy: (factor: number) => void;
}

export function createWorkbenchCameraActions(
  context: CameraActionContext,
): WorkbenchCameraActions {
  const selectAndRevealNode = (nodeId: string) => {
    const node = context.nodes.find(
      (candidate) => candidate.id === nodeId,
    );
    context.selectNodeIds([nodeId]);
    if (node === undefined) {
      return;
    }
    context.cameraScheduler.current?.schedule((current) => ({
      ...current,
      x:
        context.viewportSize.width / 2 -
        (node.position.x + node.size.width / 2) * current.zoom,
      y:
        context.viewportSize.height / 2 -
        (node.position.y + node.size.height / 2) * current.zoom,
    }));
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (context.gesture.current !== null) {
      return;
    }
    if (!event.ctrlKey) {
      context.cameraScheduler.current?.schedule((current) =>
        panCamera(current, { x: -event.deltaX, y: -event.deltaY }),
      );
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointer = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    context.cameraScheduler.current?.schedule((current) => {
      const nextZoom =
        Math.round(
          current.zoom * Math.exp(-event.deltaY * 0.001) * 1000,
        ) / 1000;
      return zoomCameraAt(current, pointer, nextZoom);
    });
  };

  const fitAll = () => {
    const bounds =
      context.viewportElement.current?.getBoundingClientRect();
    context.cameraScheduler.current?.schedule(
      fittedCamera(
        context.nodes,
        bounds && bounds.width > 0 ? bounds.width : 1000,
        bounds && bounds.height > 0 ? bounds.height : 700,
        1,
      ),
    );
  };

  const fitSelection = () => {
    const selected = context.nodes.filter((node) =>
      context.selectedNodeIds.includes(node.id),
    );
    if (selected.length === 0) {
      return;
    }
    const bounds =
      context.viewportElement.current?.getBoundingClientRect();
    context.cameraScheduler.current?.schedule(
      fittedCamera(
        selected,
        bounds && bounds.width > 0 ? bounds.width : 1000,
        bounds && bounds.height > 0 ? bounds.height : 700,
        2,
      ),
    );
  };

  const zoomBy = (factor: number) => {
    const bounds =
      context.viewportElement.current?.getBoundingClientRect();
    const pointer = {
      x: (bounds?.width ?? 1000) / 2,
      y: (bounds?.height ?? 700) / 2,
    };
    context.cameraScheduler.current?.schedule((current) =>
      zoomCameraAt(
        current,
        pointer,
        Math.round(current.zoom * factor * 1000) / 1000,
      ),
    );
  };

  return {
    fitAll,
    fitSelection,
    handleWheel,
    selectAndRevealNode,
    zoomBy,
  };
}
