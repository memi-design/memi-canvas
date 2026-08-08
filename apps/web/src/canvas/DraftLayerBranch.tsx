import type { KeyboardEvent } from "react";

import { EditorIcon } from "./icons.js";
import {
  layerIcon,
  layerLabel,
  layerNodeAriaLabel,
} from "./layer-tree-presentation.js";
import type { WorkbenchNode } from "./model.js";
import type { useDraftLayerMoves } from "./use-draft-layer-moves.js";

interface DraftLayerBranchProps {
  readonly childrenByParentId: ReadonlyMap<string, readonly WorkbenchNode[]>;
  readonly draftIds: ReadonlySet<string>;
  readonly expanded: ReadonlySet<string>;
  readonly focusAdjacent: (
    event: KeyboardEvent<HTMLLIElement>,
    direction: "first" | "last" | "next" | "previous",
  ) => void;
  readonly focusedItemId: string;
  readonly moves: ReturnType<typeof useDraftLayerMoves>;
  readonly node: WorkbenchNode;
  readonly onFocus: (nodeId: string) => void;
  readonly onSelect: (nodeId: string) => void;
  readonly selectedNodeId: string | null;
  readonly toggle: (branchId: string) => void;
}

export function DraftLayerBranch(props: DraftLayerBranchProps) {
  const { node } = props;
  const children = (props.childrenByParentId.get(node.id) ?? []).filter(
    (candidate) => props.draftIds.has(candidate.id),
  );
  const branchId = `draft-${node.id}`;
  const isExpanded = props.expanded.has(branchId);
  const movable = props.moves.movable(node);
  const common = {
    "aria-keyshortcuts": movable
      ? "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
      : undefined,
    "aria-label": layerNodeAriaLabel(node),
    "aria-selected": node.id === props.selectedNodeId,
    ...props.moves.dragProps(node),
    onFocus: () => props.onFocus(node.id),
    role: "treeitem" as const,
    tabIndex: node.id === props.focusedItemId ? 0 : -1,
  };
  const navigate = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      props.focusAdjacent(
        event,
        event.key === "ArrowDown" ? "next" : "previous",
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      props.focusAdjacent(event, event.key === "Home" ? "first" : "last");
    }
  };
  if (children.length === 0) {
    return (
      <li
        {...common}
        className="layer-leaf"
        onClick={() => props.onSelect(node.id)}
        onKeyDown={(event) => {
          if (props.moves.handleMoveKey(event, node)) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onSelect(node.id);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            event.currentTarget.parentElement
              ?.closest<HTMLElement>('[role="treeitem"]')
              ?.focus();
          } else navigate(event);
        }}
      >
        <span className="layer-row-icon">
          <EditorIcon name={layerIcon(node)} size={14} />
        </span>
        <span className="layer-row-label">{layerLabel(node)}</span>
        {node.locked ? (
          <span className="layer-row-state" title="Locked">
            <EditorIcon name="lock" size={12} />
          </span>
        ) : null}
      </li>
    );
  }
  return (
    <li
      {...common}
      aria-expanded={isExpanded}
      className="layer-group layer-node-branch"
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (props.moves.handleMoveKey(event, node)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect(node.id);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          if (!isExpanded) props.toggle(branchId);
          else {
            event.currentTarget
              .querySelector<HTMLElement>(
                ':scope > [role="group"] > [role="treeitem"]',
              )
              ?.focus();
          }
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          if (isExpanded) props.toggle(branchId);
          else {
            event.currentTarget.parentElement
              ?.closest<HTMLElement>('[role="treeitem"]')
              ?.focus();
          }
        } else navigate(event);
      }}
    >
      <div
        className="layer-group-row"
        onClick={(event) => {
          event.stopPropagation();
          props.onSelect(node.id);
        }}
      >
        <span
          aria-hidden="true"
          className="layer-branch-toggle"
          onClick={(event) => {
            event.stopPropagation();
            props.toggle(branchId);
          }}
        >
          <EditorIcon
            name={isExpanded ? "chevron-down" : "chevron-right"}
            size={12}
          />
        </span>
        <EditorIcon name={layerIcon(node)} size={14} />
        <span>{layerLabel(node)}</span>
        {node.locked ? (
          <span className="layer-row-state" title="Locked">
            <EditorIcon name="lock" size={12} />
          </span>
        ) : null}
      </div>
      {isExpanded ? (
        <ul className="layer-group-children" role="group">
          {children.map((child) => (
            <DraftLayerBranch {...props} key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
