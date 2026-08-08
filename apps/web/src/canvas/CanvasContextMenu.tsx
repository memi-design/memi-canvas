import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { StudioMenuItem } from "../components/ui/studio-menu-item.js";
import type { WorkbenchNode } from "./model.js";

export interface CanvasContextMenuProps {
  readonly canCut: boolean;
  readonly canDelete: boolean;
  readonly canDetach: boolean;
  readonly canGroup: boolean;
  readonly canPaste: boolean;
  readonly canUngroup: boolean;
  readonly node: WorkbenchNode;
  readonly onClose: () => void;
  readonly onCopy: () => void;
  readonly onCut: () => void;
  readonly onDelete: () => void;
  readonly onDetach: () => void;
  readonly onDuplicate: () => void;
  readonly onCreateComponent?: () => void;
  readonly onFrame?: () => void;
  readonly onGroup: () => void;
  readonly onAskAgent?: () => void;
  readonly onOpenSource?: () => void;
  readonly onOrder: (
    direction: "forward" | "backward" | "front" | "back",
  ) => void;
  readonly onPaste: () => void;
  readonly onPasteAtCursor: () => void;
  readonly onUngroup: () => void;
  readonly onToggleLock?: () => void;
  readonly onToggleVisibility?: () => void;
  readonly x: number;
  readonly y: number;
}

interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

interface MenuSize {
  readonly height: number;
  readonly width: number;
}

export function clampContextMenuPosition(
  requested: MenuPoint,
  menu: MenuSize,
  viewport: MenuSize,
  margin = 8,
): MenuPoint {
  return {
    x: Math.max(
      margin,
      Math.min(requested.x, viewport.width - menu.width - margin),
    ),
    y: Math.max(
      margin,
      Math.min(requested.y, viewport.height - menu.height - margin),
    ),
  };
}

// Atomic Design: molecule — keyboard-accessible actions for a canvas selection.
export function CanvasContextMenu({
  canCut,
  canDelete,
  canDetach,
  canGroup,
  canPaste,
  canUngroup,
  node,
  onClose,
  onCopy,
  onCut,
  onDelete,
  onDetach,
  onDuplicate,
  onCreateComponent,
  onFrame,
  onGroup,
  onAskAgent,
  onOpenSource,
  onOrder,
  onPaste,
  onPasteAtCursor,
  onUngroup,
  onToggleLock,
  onToggleVisibility,
  x,
  y,
}: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(() =>
    clampContextMenuPosition(
      { x, y },
      { height: 560, width: 240 },
      {
        height: globalThis.innerHeight,
        width: globalThis.innerWidth,
      },
    ),
  );

  useLayoutEffect(() => {
    const bounds = menuRef.current?.getBoundingClientRect();
    if (bounds === undefined) {
      return;
    }
    setPosition(
      clampContextMenuPosition(
        { x, y },
        { height: bounds.height, width: bounds.width },
        {
          height: globalThis.innerHeight,
          width: globalThis.innerWidth,
        },
      ),
    );
  }, [x, y]);

  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
      ?.focus();
    const handleOutsidePointer = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
    };
  }, [onClose]);

  const action = (callback: () => void) => () => {
    callback();
    onClose();
  };

  return (
    <div
      aria-label="Canvas selection actions"
      className="canvas-context-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
          return;
        }
        event.preventDefault();
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]:not([disabled])',
          ),
        );
        const currentIndex = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const offset = event.key === "ArrowDown" ? 1 : -1;
        items[
          (currentIndex + offset + items.length) % items.length
        ]?.focus();
      }}
      ref={menuRef}
      role="menu"
      style={{ left: position.x, top: position.y }}
    >
      <div className="canvas-context-menu__label">{node.name}</div>
      <button
        disabled={!canCut}
        onClick={action(onCut)}
        role="menuitem"
        type="button"
      >
        Cut <kbd>⌘X</kbd>
      </button>
      <button onClick={action(onCopy)} role="menuitem" type="button">
        Copy <kbd>⌘C</kbd>
      </button>
      <button
        disabled={!canPaste}
        onClick={action(onPaste)}
        role="menuitem"
        type="button"
      >
        Paste <kbd>⌘V</kbd>
      </button>
      <button
        disabled={!canPaste}
        onClick={action(onPasteAtCursor)}
        role="menuitem"
        type="button"
      >
        Paste at cursor
      </button>
      <div aria-hidden="true" className="canvas-context-menu__separator" />
      <button
        aria-label="Duplicate"
        onClick={action(onDuplicate)}
        role="menuitem"
        type="button"
      >
        Duplicate <kbd>⌘D</kbd>
      </button>
      {canDetach ? (
        <button onClick={action(onDetach)} role="menuitem" type="button">
          Detach from source
        </button>
      ) : null}
      <button
        disabled={!canGroup}
        onClick={action(onGroup)}
        role="menuitem"
        type="button"
      >
        Group selection <kbd>⌘G</kbd>
      </button>
      {onFrame === undefined ? null : (
        <button onClick={action(onFrame)} role="menuitem" type="button">
          Frame selection <kbd>⌥⌘G</kbd>
        </button>
      )}
      <button
        disabled={!canUngroup}
        onClick={action(onUngroup)}
        role="menuitem"
        type="button"
      >
        Ungroup <kbd>⇧⌘G</kbd>
      </button>
      {onCreateComponent === undefined ? null : (
        <button
          onClick={action(onCreateComponent)}
          role="menuitem"
          type="button"
        >
          Create component
        </button>
      )}
      <div aria-hidden="true" className="canvas-context-menu__separator" />
      <button
        onClick={action(() => onOrder("front"))}
        role="menuitem"
        type="button"
      >
        Bring to front
      </button>
      <button
        onClick={action(() => onOrder("forward"))}
        role="menuitem"
        type="button"
      >
        Bring forward <kbd>⌘]</kbd>
      </button>
      <button
        onClick={action(() => onOrder("backward"))}
        role="menuitem"
        type="button"
      >
        Send backward <kbd>⌘[</kbd>
      </button>
      <button
        onClick={action(() => onOrder("back"))}
        role="menuitem"
        type="button"
      >
        Send to back
      </button>
      {onToggleVisibility === undefined ? null : (
        <button
          onClick={action(onToggleVisibility)}
          role="menuitem"
          type="button"
        >
          {node.hidden ? "Show selection" : "Hide selection"}
        </button>
      )}
      {onToggleLock === undefined ? null : (
        <button
          onClick={action(onToggleLock)}
          role="menuitem"
          type="button"
        >
          {node.locked ? "Unlock selection" : "Lock selection"}
        </button>
      )}
      {onOpenSource === undefined ? null : (
        <button onClick={action(onOpenSource)} role="menuitem" type="button">
          Open source
        </button>
      )}
      {onAskAgent === undefined ? null : (
        <button onClick={action(onAskAgent)} role="menuitem" type="button">
          Ask agent about selection
        </button>
      )}
      <div aria-hidden="true" className="canvas-context-menu__separator" />
      <StudioMenuItem
        aria-label="Delete"
        aria-disabled={!canDelete}
        disabled={!canDelete}
        onClick={action(onDelete)}
        role="menuitem"
        tone="danger"
      >
        Delete <kbd>⌫</kbd>
      </StudioMenuItem>
    </div>
  );
}
