import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import "./command-palette.css";
import {
  dispatchEditorShortcut,
  executeEditorCommand,
  filterEditorCommands,
  type EditorCommand,
} from "./commands.js";

export interface CommandPaletteProps {
  readonly commands: readonly EditorCommand[];
  readonly installGlobalShortcuts?: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

function focusableElements(dialog: HTMLDivElement): readonly HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>("input, button:not(:disabled)")];
}

// Atomic Design: organism — searchable, stateful access to editor commands.
export function CommandPalette({
  commands,
  installGlobalShortcuts = true,
  onOpenChange,
  open,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const matchingCommands = filterEditorCommands(commands, query);

  useEffect(() => {
    if (open) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setQuery("");
      searchRef.current?.focus();
      return;
    }

    setQuery("");
    returnFocusRef.current?.focus();
    returnFocusRef.current = null;
  }, [open]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (
        open &&
        event.key === "Escape" &&
        !event.repeat &&
        !event.isComposing
      ) {
        event.preventDefault();
        onOpenChange(false);
        return;
      }

      if (installGlobalShortcuts) {
        dispatchEditorShortcut(commands, event);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [commands, installGlobalShortcuts, onOpenChange, open]);

  function containFocus(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (dialogRef.current === null) {
      return;
    }

    const focusable = focusableElements(dialogRef.current);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }

    const activeIndex = focusable.indexOf(
      document.activeElement as HTMLElement,
    );
    if (event.key === "Enter" && document.activeElement === first) {
      const firstCommand = focusable[1];
      if (firstCommand !== undefined) {
        event.preventDefault();
        firstCommand.click();
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        (Math.max(activeIndex, 0) + direction + focusable.length) %
        focusable.length;
      focusable[nextIndex]?.focus();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className="command-palette__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div
        aria-labelledby="command-palette-title"
        aria-modal="true"
        className="command-palette"
        onKeyDown={containFocus}
        ref={dialogRef}
        role="dialog"
      >
        <header className="command-palette__header">
          <h2 id="command-palette-title">Command palette</h2>
          <kbd>Esc</kbd>
        </header>
        <label className="command-palette__search">
          <span>Search commands</span>
          <input
            aria-label="Search commands"
            autoCapitalize="none"
            autoComplete="off"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search commands"
            ref={searchRef}
            spellCheck={false}
            type="search"
            value={query}
          />
        </label>

        {matchingCommands.length > 0 ? (
          <ul aria-label="Commands" className="command-palette__list">
            {matchingCommands.map((item) => (
              <li key={item.id}>
                <button
                  aria-label={`${item.title}, ${item.category}, ${item.shortcut.label}`}
                  disabled={item.disabled}
                  onClick={() => {
                    if (executeEditorCommand(item)) {
                      onOpenChange(false);
                    }
                  }}
                  type="button"
                >
                  <span className="command-palette__command-copy">
                    <strong>{item.title}</strong>
                    <small>{item.category}</small>
                  </span>
                  <kbd>{item.shortcut.label}</kbd>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="command-palette__empty" role="status">
            No commands match “{query}”.
          </p>
        )}
      </div>
    </div>
  );
}
