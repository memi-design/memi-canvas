import {
  canReadCanvasSystemClipboard,
  hasCanvasSessionClipboard,
  isCanvasNodeDeletable,
} from "./canvas-clipboard.js";
import type { CanvasContextMenuProps } from "./CanvasContextMenu.js";
import type { CanvasContextMenuState } from "./CanvasWorkbench.types.js";
import type { WorkbenchNode } from "./model.js";
import type { WorkbenchDocumentActions } from "./workbench-document-actions.js";

type ContextMenuActions = Pick<
  WorkbenchDocumentActions,
  | "copySelection"
  | "createComponentFromSelection"
  | "cutSelection"
  | "deleteSelection"
  | "detachSelection"
  | "duplicateSelection"
  | "frameSelection"
  | "groupSelection"
  | "orderSelection"
  | "pasteSelection"
  | "toggleSelectionProperty"
  | "ungroupSelection"
>;

interface WorkbenchContextMenuInput {
  readonly actions: ContextMenuActions;
  readonly canDeleteSelection: boolean;
  readonly contextMenu: CanvasContextMenuState | null;
  readonly nodes: readonly WorkbenchNode[];
  readonly onAskAgent: (nodeName: string) => void;
  readonly onClose: () => void;
  readonly onOpenSource?: (sourcePath: string) => void;
  readonly selectedNodeIds: readonly string[];
}

/** Projects workbench selection state into the context-menu action contract. */
export function createWorkbenchContextMenuProps({
  actions,
  canDeleteSelection,
  contextMenu,
  nodes,
  onAskAgent,
  onClose,
  onOpenSource,
  selectedNodeIds,
}: WorkbenchContextMenuInput): CanvasContextMenuProps | null {
  const node = contextMenu === null
    ? undefined
    : nodes.find((candidate) => candidate.id === contextMenu.nodeId);
  if (contextMenu === null || node === undefined) {
    return null;
  }
  const sourcePath =
    node.component?.source?.sourceAnchor ?? node.source?.sourceAnchor;
  return {
    canCut: canDeleteSelection,
    canDelete: isCanvasNodeDeletable(node),
    canDetach:
      (node.kind === "CodeFrame" || node.kind === "RoutePlaceholder") &&
      node.source !== undefined,
    canGroup: selectedNodeIds.length > 1,
    canPaste: hasCanvasSessionClipboard() || canReadCanvasSystemClipboard(),
    canUngroup: selectedNodeIds.some(
      (id) => nodes.find((candidate) => candidate.id === id)?.kind ===
        ("Group" as never),
    ),
    node,
    onAskAgent: () => onAskAgent(node.name),
    onClose,
    onCopy: actions.copySelection,
    onCreateComponent: actions.createComponentFromSelection,
    onCut: actions.cutSelection,
    onDelete: actions.deleteSelection,
    onDetach: actions.detachSelection,
    onDuplicate: actions.duplicateSelection,
    onFrame: actions.frameSelection,
    onGroup: actions.groupSelection,
    ...(sourcePath === undefined || onOpenSource === undefined
      ? {}
      : { onOpenSource: () => onOpenSource(sourcePath) }),
    onOrder: actions.orderSelection,
    onPaste: actions.pasteSelection,
    onPasteAtCursor: () => actions.pasteSelection(undefined, {
      kind: "cursor",
      point: contextMenu.canvasPoint,
    }),
    onToggleLock: () => actions.toggleSelectionProperty("locked"),
    onToggleVisibility: () => actions.toggleSelectionProperty("hidden"),
    onUngroup: actions.ungroupSelection,
    x: contextMenu.x,
    y: contextMenu.y,
  };
}
