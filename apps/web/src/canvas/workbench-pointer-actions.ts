import type {
  Dispatch,
  KeyboardEvent,
  MouseEvent,
  MutableRefObject,
  PointerEvent,
  RefObject,
  SetStateAction,
} from "react";

import {
  canvasGridWorldSize,
  canvasPointFromViewport,
  changedNode,
  pointFromEvent,
  snapCanvasPoint,
  type CanvasCamera,
} from "./canvas-camera.js";
import {
  computeAlignmentSnap,
  type AlignmentGuides,
} from "./alignment-guides.js";
import type { FrameStateScheduler } from "./canvas-performance.js";
import type {
  CanvasContextMenuState,
  PointerGesture,
  SelectionMarquee,
} from "./CanvasWorkbench.types.js";
import type { ProfessionalCanvasTool } from "./commands.js";
import type { Point, WorkbenchNode } from "./model.js";
import {
  descendantNodeIds,
  duplicateWorkbenchSubtrees,
} from "./workbench-document-actions.js";
import {
  authoredPathGeometry,
  createdNodeGeometry,
  createWorkbenchNode,
  hasLockedAncestor,
  type CreationTool,
} from "./workbench-pointer-geometry.js";
import type { WorkbenchHistoryActions } from "./workbench-history-actions.js";
import type { WorkbenchIntentReceiptV3 } from "./workbench-v3-intents.js";
import type { WorkbenchSemanticCommitOptions } from "./workbench-document-actions.js";

interface PointerActionContext {
  readonly alignmentGuides: AlignmentGuides;
  readonly appendTrace: WorkbenchHistoryActions["appendTrace"];
  readonly camera: CanvasCamera;
  readonly cameraScheduler: RefObject<
    FrameStateScheduler<CanvasCamera> | null
  >;
  readonly commitPreview: WorkbenchHistoryActions["commitPreview"];
  /** V3 production sink. Pointer gestures provide only their affected nodes. */
  readonly commitIntentReceipt?: (
    label: string,
    receipt: WorkbenchIntentReceiptV3,
    options?: WorkbenchSemanticCommitOptions,
  ) => void;
  readonly commitScene: WorkbenchHistoryActions["commitScene"];
  readonly createRootNode: WorkbenchHistoryActions["createRootNode"];
  readonly gesture: MutableRefObject<PointerGesture | null>;
  readonly nodes: readonly WorkbenchNode[];
  readonly selectNode: WorkbenchHistoryActions["selectNode"];
  readonly selectNodeIds: WorkbenchHistoryActions["selectNodeIds"];
  readonly selectedNodeIds: readonly string[];
  readonly setAlignmentGuides: Dispatch<SetStateAction<AlignmentGuides>>;
  readonly setCamera: Dispatch<SetStateAction<CanvasCamera>>;
  readonly setContextMenu: Dispatch<
    SetStateAction<CanvasContextMenuState | null>
  >;
  readonly setPreviewNodes: Dispatch<
    SetStateAction<readonly WorkbenchNode[] | null>
  >;
  readonly setSelectionMarquee: Dispatch<
    SetStateAction<SelectionMarquee | null>
  >;
  readonly setTool: Dispatch<SetStateAction<ProfessionalCanvasTool>>;
  readonly spacePressed: MutableRefObject<boolean>;
  readonly suppressCanvasClick: MutableRefObject<boolean>;
  readonly tool: ProfessionalCanvasTool;
  readonly viewportElement: RefObject<HTMLDivElement | null>;
  readonly viewportPointer: MutableRefObject<Point | null>;
}

export interface WorkbenchPointerActions {
  readonly handleViewportClick: (
    event: MouseEvent<HTMLDivElement>,
  ) => void;
  readonly handleViewportKeyDown: (
    event: KeyboardEvent<HTMLDivElement>,
  ) => void;
  readonly handleViewportPointerCancel: (
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  readonly handleViewportPointerMove: (
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  readonly handleViewportPointerUp: (
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  readonly startMove: (
    node: WorkbenchNode,
    event: PointerEvent<HTMLButtonElement>,
  ) => void;
  readonly startCreate: (
    event: PointerEvent<HTMLDivElement>,
  ) => void;
  readonly startResize: (
    node: WorkbenchNode,
    event: PointerEvent<HTMLButtonElement>,
  ) => void;
}

export function createWorkbenchPointerActions(
  context: PointerActionContext,
): WorkbenchPointerActions {
  const commit = (
    label: string,
    receipt: WorkbenchIntentReceiptV3,
    before: readonly WorkbenchNode[],
    targetIds: readonly string[],
    selectedIds?: readonly string[],
  ) => {
    if (context.commitIntentReceipt !== undefined) {
      context.commitIntentReceipt(label, receipt, {
        ...(selectedIds === undefined ? {} : { selectedIds }),
        targetIds,
      });
      context.setPreviewNodes(null);
      return;
    }
    context.commitPreview(label, before, targetIds);
  };
  const create = (label: string, node: WorkbenchNode) => {
    if (context.commitIntentReceipt !== undefined) {
      context.commitIntentReceipt(label, { kind: "create", nodes: [node] }, {
        selectedIds: [node.id], targetIds: [node.id],
      });
      context.setPreviewNodes(null);
      return;
    }
    context.createRootNode(label, node);
  };
  const startMove: WorkbenchPointerActions["startMove"] = (
    node,
    event,
  ) => {
    if (
      context.tool === "pan" ||
      event.button === 1 ||
      context.spacePressed.current
    ) {
      return;
    }
    event.stopPropagation();
    if (
      (context.tool !== "select" && context.tool !== "Scale") ||
      node.locked ||
      event.button !== 0
    ) {
      return;
    }
    if (event.shiftKey) {
      context.selectNode(node.id, true);
      return;
    }
    const activeSelection = context.selectedNodeIds.includes(node.id)
      ? context.selectedNodeIds
      : [node.id];
    if (!context.selectedNodeIds.includes(node.id)) {
      context.selectNodeIds(activeSelection);
    }
    const selectedSet = new Set(activeSelection);
    const movableRoots = activeSelection
      .map((id) =>
        context.nodes.find((candidate) => candidate.id === id),
      )
      .filter(
        (candidate): candidate is WorkbenchNode =>
          candidate !== undefined &&
          !candidate.locked &&
          !hasLockedAncestor(candidate, context.nodes),
      )
      .filter((candidate) => {
        let parentId = candidate.parentId;
        while (parentId !== null) {
          if (selectedSet.has(parentId)) {
            return false;
          }
          parentId =
            context.nodes.find(({ id }) => id === parentId)?.parentId ??
            null;
        }
        return true;
      });
    if (movableRoots.length === 0) {
      return;
    }
    const duplicated = event.altKey;
    let gestureNodes = context.nodes;
    let gestureIds = movableRoots.map(({ id }) => id);
    let positions = Object.fromEntries(
      context.nodes
        .filter(({ id }) =>
          descendantNodeIds(context.nodes, gestureIds).includes(id),
        )
        .map((candidate) => [candidate.id, candidate.position]),
    );
    if (duplicated) {
      const copies = duplicateWorkbenchSubtrees(
        movableRoots,
        context.nodes,
        { x: 0, y: 0 },
      );
      gestureNodes = [...context.nodes, ...copies];
      const copyIds = new Set(copies.map(({ id }) => id));
      gestureIds = copies
        .filter(
          ({ parentId }) =>
            parentId === null || !copyIds.has(parentId),
        )
        .map(({ id }) => id);
      positions = Object.fromEntries(
        copies.map((copy) => [copy.id, copy.position]),
      );
      context.setPreviewNodes(gestureNodes);
    }
    context.gesture.current = {
      type: "move",
      pointerId: event.pointerId,
      origin: pointFromEvent(event),
      nodeIds: gestureIds,
      nodeName: node.name,
      initialNodes: gestureNodes,
      positions,
      duplicated,
      camera: context.camera,
    };
    context.viewportElement.current?.setPointerCapture?.(
      event.pointerId,
    );
  };

  const startCreate: WorkbenchPointerActions["startCreate"] = (event) => {
    if (
      event.button !== 0 ||
      context.tool === "select" ||
      context.tool === "pan" ||
      context.tool === "Scale" ||
      event.target !== event.currentTarget
    ) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const viewportPoint = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    const originCanvas = snapCanvasPoint(
      canvasPointFromViewport(context.camera, viewportPoint),
      canvasGridWorldSize(context.camera.zoom),
    );
    const node = createWorkbenchNode(
      context.tool,
      originCanvas,
      context.nodes,
      { height: 1, width: 1 },
    );
    context.gesture.current = {
      type: "create",
      pointerId: event.pointerId,
      initialNodes: context.nodes,
      node,
      originCanvas,
      originViewport: viewportPoint,
      points: [originCanvas],
      dragged: false,
      tool: context.tool,
      camera: context.camera,
    };
    context.setContextMenu(null);
    context.setPreviewNodes([...context.nodes, node]);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const startResize: WorkbenchPointerActions["startResize"] = (
    node,
    event,
  ) => {
    event.stopPropagation();
    context.gesture.current = {
      type: "resize",
      pointerId: event.pointerId,
      origin: pointFromEvent(event),
      nodeId: node.id,
      nodeName: node.name,
      initialNodes: context.nodes,
      camera: context.camera,
      size: node.size,
    };
    context.viewportElement.current?.setPointerCapture?.(
      event.pointerId,
    );
  };

  const handleViewportPointerMove: WorkbenchPointerActions["handleViewportPointerMove"] =
    (event) => {
      const pointerBounds =
        context.viewportElement.current?.getBoundingClientRect();
      if (pointerBounds !== undefined) {
        context.viewportPointer.current = {
          x: event.clientX - pointerBounds.left,
          y: event.clientY - pointerBounds.top,
        };
      }
      const active = context.gesture.current;
      if (active === null || active.pointerId !== event.pointerId) {
        return;
      }
      if (active.type === "pan") {
        context.cameraScheduler.current?.schedule({
          ...active.camera,
          x: active.camera.x + event.clientX - active.origin.x,
          y: active.camera.y + event.clientY - active.origin.y,
        });
        return;
      }

      if (active.type === "marquee") {
        const bounds =
          context.viewportElement.current?.getBoundingClientRect();
        const current = {
          x: event.clientX - (bounds?.left ?? 0),
          y: event.clientY - (bounds?.top ?? 0),
        };
        const left = Math.min(active.origin.x, current.x);
        const top = Math.min(active.origin.y, current.y);
        const right = Math.max(active.origin.x, current.x);
        const bottom = Math.max(active.origin.y, current.y);
        context.setSelectionMarquee({
          active: true,
          height: bottom - top,
          width: right - left,
          x: left,
          y: top,
        });
        const worldLeft =
          (left - active.camera.x) / active.camera.zoom;
        const worldTop = (top - active.camera.y) / active.camera.zoom;
        const worldRight =
          (right - active.camera.x) / active.camera.zoom;
        const worldBottom =
          (bottom - active.camera.y) / active.camera.zoom;
        const intersectingIds = context.nodes
          .filter(
            (node) =>
              !node.hidden &&
              !node.locked &&
              node.position.x < worldRight &&
              node.position.x + node.size.width > worldLeft &&
              node.position.y < worldBottom &&
              node.position.y + node.size.height > worldTop,
          )
          .map((node) => node.id);
        context.selectNodeIds(
          active.additive
            ? [...active.initialSelectedIds, ...intersectingIds]
            : intersectingIds,
        );
        return;
      }

      if (active.type === "create") {
        const bounds =
          context.viewportElement.current?.getBoundingClientRect();
        const viewportPoint = {
          x: event.clientX - (bounds?.left ?? 0),
          y: event.clientY - (bounds?.top ?? 0),
        };
        const current = snapCanvasPoint(
          canvasPointFromViewport(active.camera, viewportPoint),
          canvasGridWorldSize(active.camera.zoom),
        );
        if (
          active.tool === "Pen" ||
          active.tool === "Pencil"
        ) {
          const previous = active.points.at(-1);
          const points =
            previous?.x === current.x && previous.y === current.y
              ? active.points
              : [...active.points, current];
          const geometry = authoredPathGeometry(points);
          const node = {
            ...active.node,
            ...geometry,
          };
          context.gesture.current = {
            ...active,
            dragged: points.length > 1,
            node,
            points,
          };
          context.setPreviewNodes([...active.initialNodes, node]);
          return;
        }
        if (active.tool === "Line" || active.tool === "Arrow") {
          const opposite = event.altKey
            ? {
                x: active.originCanvas.x * 2 - current.x,
                y: active.originCanvas.y * 2 - current.y,
              }
            : active.originCanvas;
          const points = [opposite, current];
          const geometry = authoredPathGeometry(points);
          const node = {
            ...active.node,
            ...geometry,
          };
          context.gesture.current = {
            ...active,
            dragged:
              active.dragged ||
              Math.hypot(
                viewportPoint.x - active.originViewport.x,
                viewportPoint.y - active.originViewport.y,
              ) >= 3,
            node,
            points,
          };
          context.setPreviewNodes([...active.initialNodes, node]);
          return;
        }
        const geometry = createdNodeGeometry(
          active.originCanvas,
          current,
          event.shiftKey,
          event.altKey,
        );
        const node = {
          ...active.node,
          position: geometry.position,
          size: geometry.size,
        };
        context.gesture.current = {
          ...active,
          dragged:
            active.dragged ||
            Math.hypot(
              viewportPoint.x - active.originViewport.x,
              viewportPoint.y - active.originViewport.y,
            ) >= 3,
          node,
        };
        context.setPreviewNodes([...active.initialNodes, node]);
        return;
      }

      const deltaX =
        (event.clientX - active.origin.x) / active.camera.zoom;
      const deltaY =
        (event.clientY - active.origin.y) / active.camera.zoom;

      if (active.type === "move") {
        const previewIds = descendantNodeIds(
          active.initialNodes,
          active.nodeIds,
        );
        const movingNodes = previewIds.flatMap((nodeId) => {
          const node = active.initialNodes.find(
            ({ id }) => id === nodeId,
          );
          const position = active.positions[nodeId];
          return node === undefined || position === undefined
            ? []
            : [{ ...node, position }];
        });
        const snap = computeAlignmentSnap({
          delta: { x: deltaX, y: deltaY },
          movingNodes,
          sceneNodes: active.initialNodes,
          threshold: 6 / active.camera.zoom,
          gridSize: canvasGridWorldSize(active.camera.zoom),
        });
        context.setAlignmentGuides(snap.guides);
        const movableIds = new Set(previewIds);
        context.setPreviewNodes(
          active.initialNodes.map((node) => {
            const position = active.positions[node.id];
            return !movableIds.has(node.id) || position === undefined
              ? node
              : {
                  ...node,
                  position: {
                    x: position.x + snap.delta.x,
                    y: position.y + snap.delta.y,
                  },
                };
          }),
        );
        return;
      }

      context.setPreviewNodes(
        changedNode(active.initialNodes, active.nodeId, {
          size: {
            width: Math.max(1, active.size.width + deltaX),
            height: Math.max(1, active.size.height + deltaY),
          },
        }),
      );
    };

  const handleViewportPointerUp: WorkbenchPointerActions["handleViewportPointerUp"] =
    (event) => {
      const active = context.gesture.current;
      if (active === null || active.pointerId !== event.pointerId) {
        return;
      }
      if (active.type === "pan") {
        context.cameraScheduler.current?.flush();
      }
      context.gesture.current = null;
      context.setAlignmentGuides({ horizontal: [], vertical: [] });
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      if (active.type === "marquee") {
        context.setSelectionMarquee(null);
        context.suppressCanvasClick.current = true;
        return;
      }
      if (active.type === "create") {
        const node = active.dragged
          ? active.node
          : createWorkbenchNode(
              active.tool,
              active.originCanvas,
              active.initialNodes,
              undefined,
              true,
            );
        context.suppressCanvasClick.current = true;
        create(`Create ${node.name}`, node);
        context.appendTrace(`Created ${node.name}`, node.id);
        context.setTool("select");
        return;
      }
      if (active.type === "move" || active.type === "resize") {
        context.suppressCanvasClick.current = true;
        const label =
          active.type === "move" && active.duplicated
            ? `Duplicate and move ${active.nodeName}`
            : `${active.type === "move" ? "Move" : "Resize"} ${active.nodeName}`;
        const targetIds = active.type === "move"
          ? active.duplicated
            ? descendantNodeIds(context.nodes, active.nodeIds)
            : active.nodeIds
          : [active.nodeId];
        const affected = context.nodes.filter((node) =>
          targetIds.includes(node.id),
        );
        commit(
          label,
          active.type === "resize"
            ? { kind: "resize", nodes: affected }
            : active.duplicated
              ? { kind: "paste", nodes: affected }
              : { kind: "move", nodes: affected },
          active.initialNodes,
          targetIds,
          active.type === "move" && active.duplicated
            ? active.nodeIds
            : undefined,
        );
        context.appendTrace(
          active.type === "move" && active.duplicated
            ? `Duplicated and moved ${active.nodeName}`
            : `${active.type === "move" ? "Moved" : "Resized"} ${active.nodeName}`,
          active.type === "move"
            ? active.nodeIds.at(-1) ?? "canvas"
            : active.nodeId,
        );
      }
    };

  const handleViewportPointerCancel: WorkbenchPointerActions["handleViewportPointerCancel"] =
    (event) => {
      const active = context.gesture.current;
      if (active === null || active.pointerId !== event.pointerId) {
        return;
      }
      context.gesture.current = null;
      context.setAlignmentGuides({ horizontal: [], vertical: [] });
      if (active.type === "pan") {
        context.cameraScheduler.current?.cancel();
        context.setCamera(active.camera);
        return;
      }
      if (active.type === "marquee") {
        context.selectNodeIds(active.initialSelectedIds);
        context.setSelectionMarquee(null);
        return;
      }
      context.setPreviewNodes(null);
    };

  const createNode = (selectedTool: CreationTool, at: Point) => {
    const node = createWorkbenchNode(
      selectedTool,
      at,
      context.nodes,
      undefined,
      true,
    );
    create(`Create ${node.name}`, node);
    context.setTool("select");
  };

  const handleViewportClick: WorkbenchPointerActions["handleViewportClick"] =
    (event) => {
      if (context.suppressCanvasClick.current) {
        context.suppressCanvasClick.current = false;
        return;
      }
      if (
        event.target === event.currentTarget &&
        (context.tool === "select" || context.tool === "Scale")
      ) {
        context.selectNodeIds([]);
        context.setContextMenu(null);
        return;
      }
      if (
        event.target !== event.currentTarget ||
        context.tool === "select" ||
        context.tool === "pan" ||
        context.tool === "Scale"
      ) {
        return;
      }
      const bounds = event.currentTarget.getBoundingClientRect();
      createNode(
        context.tool,
        snapCanvasPoint(
          canvasPointFromViewport(context.camera, {
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          }),
          canvasGridWorldSize(context.camera.zoom),
        ),
      );
    };

  const handleViewportKeyDown: WorkbenchPointerActions["handleViewportKeyDown"] =
    (event) => {
      if (
        ![
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(event.key)
      ) {
        return;
      }
      const selectedSet = new Set(context.selectedNodeIds);
      const movableRoots = context.selectedNodeIds
        .map((id) => context.nodes.find((node) => node.id === id))
        .filter(
          (node): node is WorkbenchNode =>
            node !== undefined &&
            !node.locked &&
            !hasLockedAncestor(node, context.nodes),
        )
        .filter((node) => {
          let parentId = node.parentId;
          while (parentId !== null) {
            if (selectedSet.has(parentId)) {
              return false;
            }
            parentId =
              context.nodes.find(({ id }) => id === parentId)
                ?.parentId ?? null;
          }
          return true;
        });
      if (movableRoots.length === 0) {
        return;
      }
      const movableIds = descendantNodeIds(
        context.nodes,
        movableRoots.map(({ id }) => id),
      );
      const movableSet = new Set(movableIds);
      event.preventDefault();
      const amount = event.shiftKey ? 10 : 1;
      const offset = {
        x:
          event.key === "ArrowLeft"
            ? -amount
            : event.key === "ArrowRight"
              ? amount
              : 0,
        y:
          event.key === "ArrowUp"
            ? -amount
            : event.key === "ArrowDown"
              ? amount
              : 0,
      };
      const label =
        movableRoots.length === 1
          ? `Nudge ${movableRoots[0]?.name ?? "selection"}`
          : `Nudge ${movableRoots.length} layers`;
      const nextNodes = context.nodes.map((node) =>
        movableSet.has(node.id) && !node.locked
          ? {
              ...node,
              position: {
                x: node.position.x + offset.x,
                y: node.position.y + offset.y,
              },
            }
          : node,
      );
      if (context.commitIntentReceipt !== undefined) {
        context.commitIntentReceipt(label, {
          kind: "move",
          nodes: nextNodes.filter((node) => movableSet.has(node.id)),
        }, { targetIds: movableIds });
      } else {
      context.commitScene(
        label,
        nextNodes,
        { targetIds: movableIds },
      );
      }
    };

  void context.alignmentGuides;
  return {
    handleViewportClick,
    handleViewportKeyDown,
    handleViewportPointerCancel,
    handleViewportPointerMove,
    handleViewportPointerUp,
    startCreate,
    startMove,
    startResize,
  };
}
