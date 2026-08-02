import { describe, expect, it, vi } from "vitest";

import {
  createEditorCommands,
  dispatchEditorShortcut,
  filterEditorCommands,
  type EditorCommandCallbacks,
  type EditorKeyboardEvent,
} from "./commands.js";

function callbacks(): EditorCommandCallbacks {
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
  };
}

function keyboardEvent(
  key: string,
  overrides: Partial<EditorKeyboardEvent> = {},
): EditorKeyboardEvent {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    isComposing: false,
    key,
    metaKey: false,
    preventDefault: vi.fn(),
    repeat: false,
    shiftKey: false,
    target: null,
    ...overrides,
  };
}

describe("editor command registry", () => {
  it("creates a frozen declarative registry with every required command", () => {
    const commands = createEditorCommands(callbacks(), {
      canDeleteSelection: false,
      canDuplicateSelection: false,
      canRedo: false,
      canUndo: true,
    });

    expect(commands.map(({ id }) => id)).toEqual([
      "palette.open",
      "canvas.new",
      "tool.select",
      "tool.scale",
      "tool.pan",
      "tool.frame",
      "tool.section",
      "tool.slice",
      "tool.rectangle",
      "tool.ellipse",
      "tool.line",
      "tool.arrow",
      "tool.pen",
      "tool.pencil",
      "tool.text",
      "tool.comment",
      "history.undo",
      "history.redo",
      "selection.select-all",
      "selection.copy",
      "selection.cut",
      "selection.paste",
      "selection.duplicate",
      "selection.delete",
      "selection.group",
      "selection.ungroup",
      "selection.frame",
      "selection.order-forward",
      "selection.order-backward",
      "selection.order-front",
      "selection.order-back",
      "selection.toggle-lock",
      "selection.toggle-visibility",
      "component.create",
      "viewport.reset",
      "viewport.fit",
      "viewport.fit-selection",
      "viewport.zoom-in",
      "viewport.zoom-out",
      "workspace.browser",
      "workspace.runs",
      "workspace.settings",
    ]);
    expect(Object.isFrozen(commands)).toBe(true);
    expect(commands.every((command) => Object.isFrozen(command))).toBe(true);
    expect(
      commands.find(({ id }) => id === "history.undo")?.disabled,
    ).toBe(false);
    expect(
      commands.find(({ id }) => id === "history.redo")?.disabled,
    ).toBe(true);
    expect(
      commands.find(({ id }) => id === "selection.delete")?.disabled,
    ).toBe(true);
  });

  it.each([
    ["k", { metaKey: true }, "onOpenPalette"],
    ["n", { ctrlKey: true }, "onNewCanvas"],
    ["v", {}, "onSelectTool"],
    ["h", {}, "onSelectTool"],
    ["t", {}, "onSelectTool"],
    ["r", {}, "onSelectTool"],
    ["o", {}, "onSelectTool"],
    ["l", {}, "onSelectTool"],
    ["l", { shiftKey: true }, "onSelectTool"],
    ["f", {}, "onSelectTool"],
    ["z", { metaKey: true }, "onUndo"],
    ["z", { ctrlKey: true, shiftKey: true }, "onRedo"],
    ["1", { shiftKey: true }, "onFitCanvas"],
    ["d", { metaKey: true }, "onDuplicateSelection"],
    ["Delete", {}, "onDeleteSelection"],
    ["Backspace", {}, "onDeleteSelection"],
    ["b", { ctrlKey: true }, "onOpenBrowser"],
    ["r", { metaKey: true, shiftKey: true }, "onOpenRuns"],
    [",", { ctrlKey: true }, "onOpenSettings"],
  ] as const)(
    "dispatches %s with modifiers %o",
    (key, modifiers, callbackName) => {
      const commandCallbacks = callbacks();
      const event = keyboardEvent(key, modifiers);
      const command = dispatchEditorShortcut(
        createEditorCommands(commandCallbacks, {
          canDeleteSelection: true,
          canDuplicateSelection: true,
          canRedo: true,
          canUndo: true,
        }),
        event,
      );

      expect(command).not.toBeNull();
      expect(commandCallbacks[callbackName]).toHaveBeenCalledTimes(1);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    },
  );

  it("passes the canonical canvas tool to the injected callback", () => {
    const commandCallbacks = callbacks();
    const commands = createEditorCommands(commandCallbacks);

    dispatchEditorShortcut(commands, keyboardEvent("v"));
    dispatchEditorShortcut(commands, keyboardEvent("H"));
    dispatchEditorShortcut(commands, keyboardEvent("t"));
    dispatchEditorShortcut(commands, keyboardEvent("R"));
    dispatchEditorShortcut(commands, keyboardEvent("o"));
    dispatchEditorShortcut(commands, keyboardEvent("l"));
    dispatchEditorShortcut(
      commands,
      keyboardEvent("L", { shiftKey: true }),
    );
    dispatchEditorShortcut(commands, keyboardEvent("f"));

    expect(commandCallbacks.onSelectTool).toHaveBeenNthCalledWith(1, "select");
    expect(commandCallbacks.onSelectTool).toHaveBeenNthCalledWith(2, "pan");
    expect(commandCallbacks.onSelectTool).toHaveBeenNthCalledWith(3, "Text");
    expect(commandCallbacks.onSelectTool).toHaveBeenNthCalledWith(
      4,
      "Rectangle",
    );
    expect(commandCallbacks.onSelectTool).toHaveBeenNthCalledWith(5, "Ellipse");
    expect(commandCallbacks.onSelectTool).toHaveBeenNthCalledWith(6, "Line");
    expect(commandCallbacks.onSelectTool).toHaveBeenNthCalledWith(7, "Arrow");
    expect(commandCallbacks.onSelectTool).toHaveBeenNthCalledWith(8, "Frame");
  });

  it.each([
    ["repeat", { repeat: true }],
    ["composition", { isComposing: true }],
  ] as const)("ignores %s keyboard events", (_name, eventState) => {
    const commandCallbacks = callbacks();
    const event = keyboardEvent("k", {
      metaKey: true,
      ...eventState,
    });

    expect(
      dispatchEditorShortcut(createEditorCommands(commandCallbacks), event),
    ).toBeNull();
    expect(commandCallbacks.onOpenPalette).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each(["input", "textarea", "select"])(
    "suppresses commands inside a %s",
    (tagName) => {
      const target = document.createElement(tagName);
      const commandCallbacks = callbacks();

      expect(
        dispatchEditorShortcut(
          createEditorCommands(commandCallbacks),
          keyboardEvent("n", { metaKey: true, target }),
        ),
      ).toBeNull();
      expect(commandCallbacks.onNewCanvas).not.toHaveBeenCalled();
    },
  );

  it("suppresses commands inside nested contenteditable regions", () => {
    const editor = document.createElement("div");
    const nestedTarget = document.createElement("span");
    editor.setAttribute("contenteditable", "true");
    editor.append(nestedTarget);

    const commandCallbacks = callbacks();
    expect(
      dispatchEditorShortcut(
        createEditorCommands(commandCallbacks),
        keyboardEvent("Delete", { target: nestedTarget }),
      ),
    ).toBeNull();
    expect(commandCallbacks.onDeleteSelection).not.toHaveBeenCalled();
  });

  it("allows commands from an explicitly non-editable nested region", () => {
    const editor = document.createElement("div");
    const nonEditableRegion = document.createElement("div");
    const nestedTarget = document.createElement("span");
    editor.setAttribute("contenteditable", "true");
    nonEditableRegion.setAttribute("contenteditable", "false");
    nonEditableRegion.append(nestedTarget);
    editor.append(nonEditableRegion);

    const commandCallbacks = callbacks();
    dispatchEditorShortcut(
      createEditorCommands(commandCallbacks),
      keyboardEvent("v", { target: nestedTarget }),
    );

    expect(commandCallbacks.onSelectTool).toHaveBeenCalledWith("select");
  });

  it("matches the physical Shift+1 key even when key reports an exclamation", () => {
    const commandCallbacks = callbacks();

    dispatchEditorShortcut(
      createEditorCommands(commandCallbacks),
      keyboardEvent("!", { code: "Digit1", shiftKey: true }),
    );

    expect(commandCallbacks.onFitCanvas).toHaveBeenCalledTimes(1);
  });

  it.each([
    keyboardEvent("v", { altKey: true }),
    keyboardEvent("v", { ctrlKey: true }),
    keyboardEvent("v", { shiftKey: true }),
    keyboardEvent("not-a-command"),
  ])("does not claim non-matching shortcut shapes", (event) => {
    const commandCallbacks = callbacks();

    expect(
      dispatchEditorShortcut(createEditorCommands(commandCallbacks), event),
    ).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(commandCallbacks.onSelectTool).not.toHaveBeenCalled();
  });

  it("leaves disabled shortcuts available to the host application", () => {
    const commandCallbacks = callbacks();
    const event = keyboardEvent("z", { metaKey: true });

    const command = dispatchEditorShortcut(
      createEditorCommands(commandCallbacks, { canUndo: false }),
      event,
    );

    expect(command).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(commandCallbacks.onUndo).not.toHaveBeenCalled();
  });

  it("filters by title, category, and human-readable shortcut", () => {
    const commands = createEditorCommands(callbacks());

    expect(filterEditorCommands(commands, "duplicate").map(({ id }) => id))
      .toEqual(["selection.duplicate"]);
    expect(
      filterEditorCommands(commands, "workspace").map(({ id }) => id),
    ).toEqual([
      "workspace.browser",
      "workspace.runs",
      "workspace.settings",
    ]);
    expect(filterEditorCommands(commands, "ctrl b").map(({ id }) => id))
      .toEqual(["workspace.browser"]);
    expect(filterEditorCommands(commands, "  ").length).toBe(commands.length);
  });
});
