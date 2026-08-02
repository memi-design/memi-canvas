import { useEffect, useState } from "react";

import {
  EditorIcon,
  type EditorIconName,
} from "../canvas/icons.js";
import type {
  WhiteboardAction,
  WhiteboardItem,
} from "./whiteboard-model.js";

const MOVE_STEP = 24;

export function WhiteboardToolButton({
  disabled,
  icon,
  label,
  onClick,
  shortcut,
}: {
  readonly disabled?: boolean;
  readonly icon: EditorIconName;
  readonly label: string;
  readonly onClick: () => void;
  readonly shortcut: string;
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      title={`${label} · ${shortcut}`}
      type="button"
    >
      <EditorIcon name={icon} />
    </button>
  );
}

export function WhiteboardItemGlyph({
  item,
}: {
  readonly item: WhiteboardItem;
}) {
  if (item.kind === "sticky") {
    return <span className="whiteboard-item-copy">{item.text}</span>;
  }
  if (item.kind === "text") {
    return <span className="whiteboard-text-copy">{item.text}</span>;
  }
  if (item.kind === "section") {
    return <strong>{item.title}</strong>;
  }
  return <span className="whiteboard-connector-label">Connection</span>;
}

function CoordinateInput({
  label,
  onCommit,
  value,
}: {
  readonly label: "X" | "Y";
  readonly onCommit: (value: number) => void;
  readonly value: number;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    onCommit(parsed);
  };

  return (
    <label>
      <span>{label}</span>
      <input
        aria-label={label}
        inputMode="numeric"
        onBlur={commit}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
        type="number"
        value={draft}
      />
    </label>
  );
}

// Atomic Design: molecule — editable properties for one whiteboard item.
export function WhiteboardPropertyEditor({
  item,
  dispatch,
}: {
  readonly item: WhiteboardItem | undefined;
  readonly dispatch: (action: WhiteboardAction) => void;
}) {
  if (item === undefined) {
    return (
      <div className="whiteboard-inspector-empty">
        <span aria-hidden="true">↖</span>
        <p>Select an item to edit it.</p>
      </div>
    );
  }
  if (item.kind === "connector") {
    return (
      <div className="whiteboard-connection-summary">
        <span>Connection</span>
        <code>{item.fromItemId}</code>
        <span aria-hidden="true">→</span>
        <code>{item.toItemId}</code>
      </div>
    );
  }

  const contentLabel =
    item.kind === "section"
      ? "Section title"
      : item.kind === "sticky"
        ? "Sticky note content"
        : "Text note content";
  const content = item.kind === "section" ? item.title : item.text;
  const move = (x: number, y: number) => {
    dispatch({
      type: "move",
      itemId: item.id,
      position: { x, y },
    });
  };

  return (
    <div className="whiteboard-properties">
      <label>
        <span>{contentLabel}</span>
        <textarea
          aria-label={contentLabel}
          value={content}
          onChange={(event) => {
            dispatch({
              type: "update-content",
              itemId: item.id,
              content: event.currentTarget.value,
            });
          }}
        />
      </label>
      <div className="whiteboard-coordinate-row">
        <CoordinateInput
          label="X"
          onCommit={(value) => {
            move(value, item.position.y);
          }}
          value={item.position.x}
        />
        <CoordinateInput
          label="Y"
          onCommit={(value) => {
            move(item.position.x, value);
          }}
          value={item.position.y}
        />
      </div>
      <div aria-label="Move selected item" className="whiteboard-nudge-grid">
        <button
          aria-label="Move up"
          onClick={() => {
            move(item.position.x, item.position.y - MOVE_STEP);
          }}
          type="button"
        >
          ↑
        </button>
        <button
          aria-label="Move left"
          onClick={() => {
            move(item.position.x - MOVE_STEP, item.position.y);
          }}
          type="button"
        >
          ←
        </button>
        <button
          aria-label="Move down"
          onClick={() => {
            move(item.position.x, item.position.y + MOVE_STEP);
          }}
          type="button"
        >
          ↓
        </button>
        <button
          aria-label="Move right"
          onClick={() => {
            move(item.position.x + MOVE_STEP, item.position.y);
          }}
          type="button"
        >
          →
        </button>
      </div>
    </div>
  );
}
