import type {
  ComponentProps,
  CSSProperties,
  PointerEventHandler,
  RefObject,
} from "react";
import { useMemo } from "react";

import { PromptDock } from "./collaboration.js";
import { CanvasSidebar } from "./CanvasSidebar.js";
import { CanvasContextMenu } from "./CanvasContextMenu.js";
import { CommandPalette } from "./CommandPalette.js";
import { CanvasWorkspacePanel } from "./CanvasWorkspacePanel.js";
import { EditorTopbar } from "./editor-chrome.js";
import { EditorIcon } from "./icons.js";
import { CanvasNodeView } from "./parts.js";
import { canvasDrawOrder } from "./canvas-draw-order.js";
import {
  resolveComponentInstance,
  workbenchHierarchyStates,
  type WorkbenchNode,
} from "./model.js";
import type { AlignmentGuides } from "./alignment-guides.js";
import type {
  SelectionMarquee,
} from "./CanvasWorkbench.types.js";
import type { CanvasCamera } from "./canvas-camera.js";
import type { ProfessionalCanvasTool } from "./commands.js";
import { semanticOverlayVisualSignature } from "./imported-screen-composition.js";
import type { WorkbenchInteractionFeedback } from "./workbench-interaction-feedback.js";

interface CanvasViewportProps {
  readonly alignmentGuides: AlignmentGuides;
  readonly camera: CanvasCamera;
  readonly gridStyle: CSSProperties;
  readonly interactionFeedback: WorkbenchInteractionFeedback;
  readonly nodes: readonly WorkbenchNode[];
  readonly onClick: ComponentProps<"div">["onClick"];
  readonly onEmptyExit?: (() => void) | undefined;
  readonly onOpenBrowser: () => void;
  readonly onPointerCancel: PointerEventHandler<HTMLDivElement>;
  readonly onPointerDown: PointerEventHandler<HTMLDivElement>;
  readonly onPointerMove: PointerEventHandler<HTMLDivElement>;
  readonly onPointerUp: PointerEventHandler<HTMLDivElement>;
  readonly onSelectTool: (tool: ProfessionalCanvasTool) => void;
  readonly onWheel: ComponentProps<"div">["onWheel"];
  readonly onKeyDown: ComponentProps<"div">["onKeyDown"];
  readonly promptDock: ComponentProps<typeof PromptDock>;
  readonly proposalTargetIds: readonly string[];
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly selectedNodeIds: readonly string[];
  readonly selectionMarquee: SelectionMarquee | null;
  readonly tool: ProfessionalCanvasTool;
  readonly visibleNodes: readonly WorkbenchNode[];
  readonly nodeView: Pick<
    ComponentProps<typeof CanvasNodeView>,
    | "onContextMenu"
    | "onPointerDown"
    | "onResizePointerDown"
    | "onSelect"
  >;
}

export interface CanvasWorkbenchViewProps {
  readonly ariaLabel: string;
  readonly commandPalette: ComponentProps<typeof CommandPalette>;
  readonly contextMenu: ComponentProps<typeof CanvasContextMenu> | null;
  readonly layersWidth: number;
  readonly sidebar: ComponentProps<typeof CanvasSidebar>;
  readonly topbar: ComponentProps<typeof EditorTopbar>;
  readonly viewport: CanvasViewportProps;
  readonly workspace: ComponentProps<typeof CanvasWorkspacePanel>;
  readonly workspaceWarning?: string;
}

function CanvasEmptyState({
  onExit,
  onOpenBrowser,
  onSelectTool,
}: {
  readonly onExit?: () => void;
  readonly onOpenBrowser: () => void;
  readonly onSelectTool: (tool: ProfessionalCanvasTool) => void;
}) {
  return (
    <div className="canvas-empty-state">
      <EditorIcon name="frame" size={18} />
      <div className="canvas-empty-state__copy">
        <strong>Create</strong>
        <span>Empty canvas</span>
      </div>
      <div className="canvas-empty-state__actions">
        <button
          aria-label="Create frame · F"
          className="canvas-empty-state__action--primary"
          onClick={() => onSelectTool("Frame")}
          title="Create frame · F"
          type="button"
        >
          <EditorIcon name="frame" size={16} />
        </button>
        <button
          aria-label="Open localhost preview"
          onClick={onOpenBrowser}
          title="Open localhost preview"
          type="button"
        >
          <EditorIcon name="browser" size={16} />
        </button>
        {onExit === undefined ? null : (
          <button
            aria-label="Open project home"
            onClick={onExit}
            title="Open project home"
            type="button"
          >
            <EditorIcon name="home" size={16} />
          </button>
        )}
      </div>
      <small aria-label="Frame shortcut">F</small>
    </div>
  );
}

function CanvasViewport({
  alignmentGuides,
  camera,
  gridStyle,
  interactionFeedback,
  nodes,
  nodeView,
  onClick,
  onEmptyExit,
  onKeyDown,
  onOpenBrowser,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onSelectTool,
  onWheel,
  promptDock,
  proposalTargetIds,
  ref,
  selectedNodeIds,
  selectionMarquee,
  tool,
  visibleNodes,
}: CanvasViewportProps) {
  const hierarchyStates = useMemo(
    () => workbenchHierarchyStates(nodes),
    [nodes],
  );
  const drawOrderedVisibleNodes = useMemo(() => {
    const visibleIds = new Set(visibleNodes.map(({ id }) => id));
    return canvasDrawOrder(nodes).filter(({ id }) => visibleIds.has(id));
  }, [nodes, visibleNodes]);
  const semanticOverlayIds = useMemo(() => {
    const runtimeBackedParentIds = new Set(
        nodes.flatMap((node) =>
          node.kind === "ReferenceFrame" &&
          node.locked &&
          node.parentId !== null
            ? [node.parentId]
            : [],
        ),
      );
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const overlayIds = new Set<string>();
    for (const node of nodes) {
      if (node.kind === "ReferenceFrame") {
        continue;
      }
      const seen = new Set<string>();
      let parentId = node.parentId;
      while (parentId !== null && !seen.has(parentId)) {
        if (runtimeBackedParentIds.has(parentId)) {
          overlayIds.add(node.id);
          break;
        }
        seen.add(parentId);
        parentId = nodesById.get(parentId)?.parentId ?? null;
      }
    }
    return overlayIds;
  }, [nodes]);
  return (
    <div
      aria-label="Infinite canvas"
      className="canvas-viewport"
      data-camera-x={camera.x}
      data-camera-y={camera.y}
      data-selection-count={selectedNodeIds.length}
      data-tool={tool}
      data-zoom={camera.zoom}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onLostPointerCapture={onPointerCancel}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      ref={ref}
      role="region"
      style={gridStyle}
      tabIndex={0}
    >
      {selectionMarquee ? (
        <div
          aria-hidden="true"
          className="canvas-selection-marquee"
          data-active={selectionMarquee.active}
          data-testid="selection-marquee"
          style={{
            height: selectionMarquee.height,
            left: selectionMarquee.x,
            top: selectionMarquee.y,
            width: selectionMarquee.width,
          }}
        />
      ) : null}
      {nodes.length === 0 ? (
        <CanvasEmptyState
          {...(onEmptyExit === undefined
            ? {}
            : { onExit: onEmptyExit })}
          onOpenBrowser={onOpenBrowser}
          onSelectTool={onSelectTool}
        />
      ) : null}
      <div
        className="canvas-scene"
        style={
          {
            "--canvas-inverse-zoom": 1 / camera.zoom,
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          } as CSSProperties
        }
      >
        {alignmentGuides.vertical.map((x) => (
          <div
            aria-hidden="true"
            className="canvas-alignment-guide canvas-alignment-guide--vertical"
            key={`vertical-${x}`}
            style={{
              height: 2_000_000,
              left: x,
              top: -1_000_000,
              width: 1 / camera.zoom,
            }}
          />
        ))}
        {alignmentGuides.horizontal.map((y) => (
          <div
            aria-hidden="true"
            className="canvas-alignment-guide canvas-alignment-guide--horizontal"
            key={`horizontal-${y}`}
            style={{
              height: 1 / camera.zoom,
              left: -1_000_000,
              top: y,
              width: 2_000_000,
            }}
          />
        ))}
        {drawOrderedVisibleNodes.map((node) => {
          const resolvedNode = resolveComponentInstance(
              {
                ...node,
                ...hierarchyStates.get(node.id),
              },
              nodes,
            );
          const semanticOverlay =
              node.kind !== "ReferenceFrame" &&
              semanticOverlayIds.has(node.id);
          return (
            <CanvasNodeView
              key={node.id}
              node={resolvedNode}
              {...nodeView}
              proposed={proposalTargetIds.includes(node.id)}
              semanticOverlay={semanticOverlay}
              semanticOverride={
                semanticOverlay &&
                node.semanticBaseline !== undefined &&
                semanticOverlayVisualSignature(node) !==
                  node.semanticBaseline
              }
              dropTarget={interactionFeedback.dropTargetId === node.id}
              moving={interactionFeedback.movingNodeIds.includes(node.id)}
              selected={selectedNodeIds.includes(node.id)}
            />
          );
        })}
        {interactionFeedback.dropTargetId === null ? null : (
          <output
            aria-label={`Valid drop target: ${
              nodes.find(({ id }) => id === interactionFeedback.dropTargetId)
                ?.name ?? "Canvas container"
            }`}
            className="canvas-node__selection-status"
            role="status"
          />
        )}
      </div>
      <output
        aria-label="Viewport transform"
        className="canvas-zoom-control"
        role="status"
      >
        {Math.round(camera.zoom * 100)}%
      </output>
      <PromptDock {...promptDock} />
    </div>
  );
}

// Atomic Design: template — composes editor chrome around the canvas organism.
export function CanvasWorkbenchView({
  ariaLabel,
  commandPalette,
  contextMenu,
  layersWidth,
  sidebar,
  topbar,
  viewport,
  workspace,
  workspaceWarning,
}: CanvasWorkbenchViewProps) {
  return (
    <main
      aria-label={ariaLabel}
      className="canvas-workbench"
      style={
        {
          "--canvas-layers-width": `${layersWidth}px`,
        } as CSSProperties
      }
    >
      <EditorTopbar {...topbar} />
      {workspaceWarning ? (
        <div className="canvas-persistence-warning" role="status">
          {workspaceWarning}
        </div>
      ) : null}
      <CanvasSidebar {...sidebar} />
      <CanvasViewport {...viewport} />
      {contextMenu === null ? null : (
        <CanvasContextMenu {...contextMenu} />
      )}
      <CanvasWorkspacePanel {...workspace} />
      <CommandPalette {...commandPalette} />
    </main>
  );
}
