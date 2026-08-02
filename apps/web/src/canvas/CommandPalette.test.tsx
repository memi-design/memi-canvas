import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./CommandPalette.js";
import {
  createEditorCommands,
  type EditorCommandCallbacks,
} from "./commands.js";

function callbacks(
  overrides: Partial<EditorCommandCallbacks> = {},
): EditorCommandCallbacks {
  return {
    onDeleteSelection: vi.fn(),
    onDuplicateSelection: vi.fn(),
    onFitCanvas: vi.fn(),
    onNewCanvas: vi.fn(),
    onOpenBrowser: vi.fn(),
    onOpenPalette: vi.fn(),
    onOpenRuns: vi.fn(),
    onOpenSettings: vi.fn(),
    onRedo: vi.fn(),
    onSelectTool: vi.fn(),
    onUndo: vi.fn(),
    ...overrides,
  };
}

describe("CommandPalette", () => {
  it("stays mounted for global shortcuts and opens through injected state", () => {
    const onOpenChange = vi.fn();
    const commandCallbacks = callbacks({
      onOpenPalette: () => onOpenChange(true),
    });
    render(
      <CommandPalette
        commands={createEditorCommands(commandCallbacks)}
        onOpenChange={onOpenChange}
        open={false}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("renders an accessible searchable list with command metadata", () => {
    render(
      <CommandPalette
        commands={createEditorCommands(callbacks(), {
          canDeleteSelection: false,
        })}
        onOpenChange={vi.fn()}
        open
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("searchbox", { name: "Search commands" }))
      .toBe(document.activeElement);

    const list = screen.getByRole("list", { name: "Commands" });
    const deleteButton = within(list).getByRole("button", {
      name: /delete selection/i,
    }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.textContent).toContain("Edit");
    expect(deleteButton.textContent).toContain("Delete");

    const browserButton = within(list).getByRole("button", {
      name: /open browser/i,
    });
    expect(browserButton.textContent).toContain("Workspace");
    expect(browserButton.textContent).toMatch(/Ctrl.*B/i);
  });

  it("filters one command list by title, category, and shortcut", () => {
    render(
      <CommandPalette
        commands={createEditorCommands(callbacks())}
        onOpenChange={vi.fn()}
        open
      />,
    );
    const search = screen.getByRole("searchbox", {
      name: "Search commands",
    });

    fireEvent.change(search, { target: { value: "rectangle" } });
    expect(
      within(screen.getByRole("list", { name: "Commands" }))
        .getAllByRole("button"),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: /rectangle tool/i })).toBeTruthy();

    fireEvent.change(search, { target: { value: "workspace" } });
    expect(
      within(screen.getByRole("list", { name: "Commands" }))
        .getAllByRole("button"),
    ).toHaveLength(3);

    fireEvent.change(search, { target: { value: "ctrl b" } });
    expect(
      within(screen.getByRole("list", { name: "Commands" }))
        .getAllByRole("button"),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: /open browser/i })).toBeTruthy();
  });

  it("runs the first filtered command with Enter and navigates results with arrows", () => {
    const onOpenChange = vi.fn();
    const onSelectTool = vi.fn();
    render(
      <CommandPalette
        commands={createEditorCommands(callbacks({ onSelectTool }))}
        onOpenChange={onOpenChange}
        open
      />,
    );
    const search = screen.getByRole("searchbox", {
      name: "Search commands",
    });
    fireEvent.change(search, { target: { value: "rectangle" } });
    const rectangle = screen.getByRole("button", {
      name: /rectangle tool/i,
    });

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rectangle);
    fireEvent.keyDown(rectangle, { key: "ArrowUp" });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onSelectTool).toHaveBeenCalledWith("Rectangle");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("executes an enabled command and requests that the palette close", () => {
    const onOpenBrowser = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CommandPalette
        commands={createEditorCommands(callbacks({ onOpenBrowser }))}
        onOpenChange={onOpenChange}
        open
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open browser/i }));

    expect(onOpenBrowser).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not execute or close for a disabled command", () => {
    const onUndo = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CommandPalette
        commands={createEditorCommands(callbacks({ onUndo }), {
          canUndo: false,
        })}
        onOpenChange={onOpenChange}
        open
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^undo\b/i }));

    expect(onUndo).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes on Escape from the search input without dispatching commands", () => {
    const onOpenChange = vi.fn();
    const commandCallbacks = callbacks();
    render(
      <CommandPalette
        commands={createEditorCommands(commandCallbacks)}
        onOpenChange={onOpenChange}
        open
      />,
    );

    fireEvent.keyDown(
      screen.getByRole("searchbox", { name: "Search commands" }),
      { key: "Escape" },
    );

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(commandCallbacks.onSelectTool).not.toHaveBeenCalled();
  });

  it("keeps Escape inert during repeats and IME composition", () => {
    const onOpenChange = vi.fn();
    render(
      <CommandPalette
        commands={createEditorCommands(callbacks())}
        onOpenChange={onOpenChange}
        open
      />,
    );

    fireEvent.keyDown(document, { key: "Escape", repeat: true });
    fireEvent.keyDown(document, { isComposing: true, key: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("contains focus and closes only when the backdrop itself is pressed", () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <CommandPalette
        commands={createEditorCommands(callbacks())}
        onOpenChange={onOpenChange}
        open
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    const search = screen.getByRole("searchbox", {
      name: "Search commands",
    });
    const commandButtons = screen.getAllByRole("button");
    const lastCommand = commandButtons.at(-1);
    expect(lastCommand).toBeDefined();

    lastCommand?.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(search);

    search.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastCommand);

    fireEvent.mouseDown(dialog);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    const backdrop = container.querySelector(".command-palette__backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop as Element);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows a useful empty state and clears stale search when reopened", () => {
    const commandCallbacks = callbacks();
    const onOpenChange = vi.fn();
    const commands = createEditorCommands(commandCallbacks);
    const { rerender } = render(
      <CommandPalette
        commands={commands}
        onOpenChange={onOpenChange}
        open
      />,
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search commands" }),
      { target: { value: "no command matches this" } },
    );
    expect(screen.getByRole("status").textContent).toMatch(/no commands/i);

    rerender(
      <CommandPalette
        commands={commands}
        onOpenChange={onOpenChange}
        open={false}
      />,
    );
    rerender(
      <CommandPalette
        commands={commands}
        onOpenChange={onOpenChange}
        open
      />,
    );

    expect(
      (
        screen.getByRole("searchbox", {
          name: "Search commands",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
  });
});
