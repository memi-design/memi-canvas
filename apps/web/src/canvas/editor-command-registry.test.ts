import { describe, expect, it, vi } from "vitest";

import {
  createEditorCommands,
  dispatchEditorShortcut,
  filterEditorCommands,
  type EditorCommand,
  type EditorCommandCallbacks,
  type EditorKeyboardEvent,
  type EditorShortcut,
} from "./commands.js";

interface ProfessionalCommandMetadata {
  readonly icon: string;
  readonly kind: "action" | "tool";
  readonly keywords: readonly string[];
  readonly placements: readonly ("menu" | "palette" | "toolbar")[];
  readonly tool?: string;
}

const coreToolCommands = [
  ["tool.select", "select", "V"],
  ["tool.scale", "Scale", "K"],
  ["tool.pan", "pan", "H"],
  ["tool.frame", "Frame", "F"],
  ["tool.section", "Section", "⇧S"],
  ["tool.slice", "Slice", "S"],
  ["tool.rectangle", "Rectangle", "R"],
  ["tool.ellipse", "Ellipse", "O"],
  ["tool.line", "Line", "L"],
  ["tool.arrow", "Arrow", "⇧L"],
  ["tool.pen", "Pen", "P"],
  ["tool.pencil", "Pencil", "⇧P"],
  ["tool.text", "Text", "T"],
  ["tool.comment", "Comment", "C"],
] as const;

const coreActionIds = [
  "palette.open",
  "canvas.new",
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
] as const;

function callbackProxy(): EditorCommandCallbacks {
  const callbacks = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        const existing = callbacks.get(property);
        if (existing !== undefined) {
          return existing;
        }
        const callback = vi.fn();
        callbacks.set(property, callback);
        return callback;
      },
    },
  ) as EditorCommandCallbacks;
}

function keyboardEvent(
  shortcut: EditorShortcut,
  target: EventTarget | null = null,
): EditorKeyboardEvent {
  const modifiers: readonly string[] = shortcut.modifiers;
  return {
    altKey: modifiers.includes("alt"),
    code: shortcut.code ?? "",
    ctrlKey: shortcut.modifiers.includes("mod"),
    isComposing: false,
    key: shortcut.key,
    metaKey: false,
    preventDefault: vi.fn(),
    repeat: false,
    shiftKey: shortcut.modifiers.includes("shift"),
    target,
  };
}

function metadata(command: EditorCommand): ProfessionalCommandMetadata {
  return command as EditorCommand & ProfessionalCommandMetadata;
}

describe("professional editor command registry contract", () => {
  it("publishes the complete core tool and action families from one registry", () => {
    const commands = createEditorCommands(callbackProxy());
    const ids = commands.map(({ id }) => id);

    expect(ids).toEqual(
      expect.arrayContaining([
        ...coreToolCommands.map(([id]) => id),
        ...coreActionIds,
      ]),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("provides toolbar, menu, and palette metadata without a second tool map", () => {
    const commands = createEditorCommands(callbackProxy());

    for (const [id, tool, shortcutLabel] of coreToolCommands) {
      const command = commands.find((candidate) => candidate.id === id);
      expect(command, `${id} must be registered`).toBeDefined();

      const item = metadata(command!);
      expect(item.kind, `${id} kind`).toBe("tool");
      expect(item.tool, `${id} tool`).toBe(tool);
      expect(item.icon, `${id} icon`).toMatch(/\S/u);
      expect(item.keywords, `${id} keywords`).not.toHaveLength(0);
      expect(item.placements, `${id} placements`).toEqual(
        expect.arrayContaining(["toolbar", "palette"]),
      );
      expect(command?.shortcut.label).toBe(shortcutLabel);
    }

    for (const id of coreActionIds) {
      const command = commands.find((candidate) => candidate.id === id);
      expect(command, `${id} must be registered`).toBeDefined();
      const item = metadata(command!);
      expect(item.kind, `${id} kind`).toBe("action");
      expect(item.icon, `${id} icon`).toMatch(/\S/u);
      expect(item.placements, `${id} placements`).toContain("palette");
    }
  });

  it.each([
    ["tool.scale", "k", {}],
    ["tool.section", "s", { shiftKey: true }],
    ["tool.slice", "s", {}],
    ["tool.pen", "p", {}],
    ["tool.pencil", "p", { shiftKey: true }],
    ["tool.comment", "c", {}],
    ["selection.select-all", "a", { ctrlKey: true }],
    ["selection.copy", "c", { ctrlKey: true }],
    ["selection.cut", "x", { ctrlKey: true }],
    ["selection.paste", "v", { ctrlKey: true }],
    ["selection.group", "g", { ctrlKey: true }],
    ["selection.ungroup", "g", { ctrlKey: true, shiftKey: true }],
    ["selection.frame", "g", { altKey: true, ctrlKey: true }],
    ["selection.order-forward", "]", { ctrlKey: true }],
    ["selection.order-backward", "[", { ctrlKey: true }],
    ["selection.order-front", "]", { altKey: true, ctrlKey: true }],
    ["selection.order-back", "[", { altKey: true, ctrlKey: true }],
    ["viewport.reset", "!", { code: "Digit0", shiftKey: true }],
    ["viewport.fit-selection", "@", { code: "Digit2", shiftKey: true }],
    ["viewport.zoom-in", "=", {}],
    ["viewport.zoom-out", "-", {}],
  ] as const)(
    "resolves %s through the canonical shortcut dispatcher",
    (expectedId, key, overrides) => {
      const event: EditorKeyboardEvent = {
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

      const matched = dispatchEditorShortcut(
        createEditorCommands(callbackProxy()),
        event,
      );

      expect(matched?.id).toBe(expectedId);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    },
  );

  it.each(["input", "textarea", "contenteditable"] as const)(
    "suppresses every registered shortcut while editing text in %s",
    (editingSurface) => {
      const root =
        editingSurface === "contenteditable"
          ? document.createElement("div")
          : document.createElement(editingSurface);
      const target =
        editingSurface === "contenteditable"
          ? document.createElement("span")
          : root;
      if (editingSurface === "contenteditable") {
        root.setAttribute("contenteditable", "true");
        root.append(target);
      }

      const commands = createEditorCommands(callbackProxy());
      for (const command of commands) {
        for (const shortcut of [
          command.shortcut,
          ...command.alternateShortcuts,
        ]) {
          const event = keyboardEvent(shortcut, target);
          expect(
            dispatchEditorShortcut(commands, event),
            `${command.id} must not fire while editing text`,
          ).toBeNull();
          expect(event.preventDefault).not.toHaveBeenCalled();
        }
      }
    },
  );

  it("indexes palette aliases and tool vocabulary from registry metadata", () => {
    const commands = createEditorCommands(callbackProxy());

    expect(filterEditorCommands(commands, "pointer").map(({ id }) => id))
      .toContain("tool.select");
    expect(filterEditorCommands(commands, "freehand").map(({ id }) => id))
      .toContain("tool.pencil");
    expect(filterEditorCommands(commands, "fit selection").map(({ id }) => id))
      .toEqual(["viewport.fit-selection"]);
    expect(filterEditorCommands(commands, "bring to front").map(({ id }) => id))
      .toEqual(["selection.order-front"]);
  });
});
