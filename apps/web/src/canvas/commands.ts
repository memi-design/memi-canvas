import type { EditorIconName } from "./icons.js";
export type CanvasTool =
  | "select" | "pan" | "Text" | "Rectangle"
  | "Ellipse" | "Line" | "Arrow"
  | "Frame";
export type ProfessionalCanvasTool =
  | CanvasTool | "Scale" | "Section" | "Slice"
  | "Pen" | "Pencil" | "Comment";
export type EditorCommandId =
  | "palette.open" | "canvas.new"
  | "tool.select" | "tool.scale" | "tool.pan" | "tool.frame"
  | "tool.section" | "tool.slice" | "tool.rectangle" | "tool.ellipse"
  | "tool.line" | "tool.arrow" | "tool.pen" | "tool.pencil"
  | "tool.text" | "tool.comment"
  | "history.undo" | "history.redo"
  | "selection.select-all" | "selection.copy" | "selection.cut"
  | "selection.paste" | "selection.duplicate" | "selection.delete"
  | "selection.group" | "selection.ungroup" | "selection.frame"
  | "selection.order-forward" | "selection.order-backward"
  | "selection.order-front" | "selection.order-back"
  | "selection.toggle-lock" | "selection.toggle-visibility"
  | "component.create" | "viewport.reset" | "viewport.fit"
  | "viewport.fit-selection" | "viewport.zoom-in" | "viewport.zoom-out"
  | "workspace.browser" | "workspace.runs"
  | "workspace.settings";
export type EditorCommandCategory =
  | "Canvas" | "Components" | "Edit" | "Tools" | "View"
  | "Workspace";
export type EditorCommandKind = "action" | "tool";
export type EditorCommandPlacement = "menu" | "palette" | "toolbar";
export type EditorShortcutModifier = "alt" | "mod" | "shift";
export interface EditorShortcut {
  readonly key: string;
  readonly code?: string;
  readonly label: string;
  readonly modifiers: readonly EditorShortcutModifier[];
}
export interface EditorCommand {
  readonly alternateShortcuts: readonly EditorShortcut[];
  readonly category: EditorCommandCategory;
  readonly disabled: boolean;
  readonly execute: () => void;
  readonly icon: EditorIconName;
  readonly id: EditorCommandId;
  readonly keywords: readonly string[];
  readonly kind: EditorCommandKind;
  readonly placements: readonly EditorCommandPlacement[];
  readonly shortcut: EditorShortcut;
  readonly title: string;
  readonly tool?: ProfessionalCanvasTool;
}
export type SelectionOrder =
  | "back" | "backward" | "forward"
  | "front";
export interface EditorCommandCallbacks {
  readonly onDeleteSelection: () => void;
  readonly onDuplicateSelection: () => void;
  readonly onFitCanvas: () => void;
  readonly onNewCanvas: () => void;
  readonly onOpenBrowser: () => void;
  readonly onOpenPalette: () => void;
  readonly onOpenRuns: () => void;
  readonly onOpenSettings: () => void;
  readonly onRedo: () => void;
  readonly onSelectTool: (tool: CanvasTool) => void;
  readonly onUndo: () => void;
  readonly onCopySelection?: () => void;
  readonly onCreateComponent?: () => void;
  readonly onCutSelection?: () => void;
  readonly onFitSelection?: () => void;
  readonly onFrameSelection?: () => void;
  readonly onGroupSelection?: () => void;
  readonly onOrderSelection?: (order: SelectionOrder) => void;
  readonly onPasteSelection?: () => void;
  readonly onResetZoom?: () => void;
  readonly onSelectAll?: () => void;
  readonly onSelectProfessionalTool?: (tool: ProfessionalCanvasTool) => void;
  readonly onToggleLock?: () => void;
  readonly onToggleVisibility?: () => void;
  readonly onUngroupSelection?: () => void;
  readonly onZoomIn?: () => void;
  readonly onZoomOut?: () => void;
}
export interface EditorCommandAvailability {
  readonly canDeleteSelection?: boolean;
  readonly canDuplicateSelection?: boolean;
  readonly canRedo?: boolean;
  readonly canUndo?: boolean;
}
export interface EditorKeyboardEvent {
  readonly altKey: boolean;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly isComposing: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly shiftKey: boolean;
  readonly target: EventTarget | null;
  preventDefault(): void;
}
interface CommandDefinition {
  readonly alternateShortcuts?: readonly EditorShortcut[];
  readonly category: EditorCommandCategory;
  readonly disabled?: boolean;
  readonly execute?: (() => void) | undefined;
  readonly icon: EditorIconName;
  readonly id: EditorCommandId;
  readonly keywords?: readonly string[];
  readonly kind?: EditorCommandKind;
  readonly placements?: readonly EditorCommandPlacement[];
  readonly shortcut: EditorShortcut;
  readonly title: string;
  readonly tool?: ProfessionalCanvasTool;
}
const noOp = (): void => undefined;
const paletteAndMenu = ["palette", "menu"] as const;
const toolbarPaletteAndMenu = ["toolbar", "palette", "menu"] as const;
function shortcut(
  key: string,
  label: string,
  modifiers: readonly EditorShortcutModifier[] = [],
  code?: string,
): EditorShortcut {
  return Object.freeze({
    key,
    label,
    modifiers: Object.freeze([...modifiers]),
    ...(code === undefined ? {} : { code }),
  });
}
function command(definition: CommandDefinition): EditorCommand {
  return Object.freeze({
    alternateShortcuts: Object.freeze(
      [...(definition.alternateShortcuts ?? [])].map((item) =>
        Object.freeze({
          ...item,
          modifiers: Object.freeze([...item.modifiers]),
        }),
      ),
    ),
    category: definition.category,
    disabled: definition.disabled ?? false,
    execute: definition.execute ?? noOp,
    icon: definition.icon,
    id: definition.id,
    keywords: Object.freeze([...(definition.keywords ?? [])]),
    kind: definition.kind ?? "action",
    placements: Object.freeze([
      ...(definition.placements ?? paletteAndMenu),
    ]),
    shortcut: Object.freeze({
      ...definition.shortcut,
      modifiers: Object.freeze([...definition.shortcut.modifiers]),
    }),
    title: definition.title,
    ...(definition.tool === undefined ? {} : { tool: definition.tool }),
  });
}
function toolCommand({
  callbacks,
  icon,
  id,
  keywords,
  shortcut: toolShortcut,
  title,
  tool,
}: {
  readonly callbacks: Partial<EditorCommandCallbacks>;
  readonly icon: EditorIconName;
  readonly id: EditorCommandId;
  readonly keywords: readonly string[];
  readonly shortcut: EditorShortcut;
  readonly title: string;
  readonly tool: ProfessionalCanvasTool;
}): EditorCommand {
  const isCurrentTool = (
    [
      "select",
      "pan",
      "Text",
      "Rectangle",
      "Ellipse",
      "Line",
      "Arrow",
      "Frame",
    ] as readonly ProfessionalCanvasTool[]
  ).includes(tool);
  const select = isCurrentTool
    ? callbacks.onSelectTool === undefined
      ? undefined
      : () => callbacks.onSelectTool?.(tool as CanvasTool)
    : callbacks.onSelectProfessionalTool === undefined
      ? undefined
      : () => callbacks.onSelectProfessionalTool?.(tool);

  return command({
    category: "Tools",
    disabled: select === undefined,
    execute: select,
    icon,
    id,
    keywords,
    kind: "tool",
    placements: toolbarPaletteAndMenu,
    shortcut: toolShortcut,
    title,
    tool,
  });
}
function optionalAction(
  definition: Omit<CommandDefinition, "disabled" | "execute">,
  callback: (() => void) | undefined,
): EditorCommand {
  return command({
    ...definition,
    disabled: callback === undefined,
    execute: callback,
  });
}
export function createEditorCommands(
  callbacks: Partial<EditorCommandCallbacks>,
  availability: EditorCommandAvailability = {},
): readonly EditorCommand[] {
  const canDeleteSelection = availability.canDeleteSelection ?? true;
  const canDuplicateSelection = availability.canDuplicateSelection ?? true;
  const canRedo = availability.canRedo ?? true;
  const canUndo = availability.canUndo ?? true;

  return Object.freeze([
    optionalAction(
      {
        category: "View",
        icon: "search",
        id: "palette.open",
        keywords: ["commands", "quick actions"],
        shortcut: shortcut("k", "⌘/Ctrl+K", ["mod"]),
        title: "Open command palette",
      },
      callbacks.onOpenPalette,
    ),
    optionalAction(
      {
        category: "Canvas",
        icon: "plus",
        id: "canvas.new",
        keywords: ["create", "document", "page"],
        shortcut: shortcut("n", "⌘/Ctrl+N", ["mod"]),
        title: "New canvas",
      },
      callbacks.onNewCanvas,
    ),
    toolCommand({
      callbacks,
      icon: "cursor",
      id: "tool.select",
      keywords: ["move", "pointer"],
      shortcut: shortcut("v", "V"),
      title: "Select tool",
      tool: "select",
    }),
    toolCommand({
      callbacks,
      icon: "scale",
      id: "tool.scale",
      keywords: ["resize", "transform"],
      shortcut: shortcut("k", "K"),
      title: "Scale tool",
      tool: "Scale",
    }),
    toolCommand({
      callbacks,
      icon: "hand",
      id: "tool.pan",
      keywords: ["hand", "move canvas"],
      shortcut: shortcut("h", "H"),
      title: "Pan tool",
      tool: "pan",
    }),
    toolCommand({
      callbacks,
      icon: "frame",
      id: "tool.frame",
      keywords: ["artboard", "container"],
      shortcut: shortcut("f", "F"),
      title: "Frame tool",
      tool: "Frame",
    }),
    toolCommand({
      callbacks,
      icon: "section",
      id: "tool.section",
      keywords: ["organize", "region"],
      shortcut: shortcut("s", "⇧S", ["shift"]),
      title: "Section tool",
      tool: "Section",
    }),
    toolCommand({
      callbacks,
      icon: "slice",
      id: "tool.slice",
      keywords: ["export", "crop"],
      shortcut: shortcut("s", "S"),
      title: "Slice tool",
      tool: "Slice",
    }),
    toolCommand({
      callbacks,
      icon: "square",
      id: "tool.rectangle",
      keywords: ["shape", "box"],
      shortcut: shortcut("r", "R"),
      title: "Rectangle tool",
      tool: "Rectangle",
    }),
    toolCommand({
      callbacks,
      icon: "circle",
      id: "tool.ellipse",
      keywords: ["shape", "oval"],
      shortcut: shortcut("o", "O"),
      title: "Ellipse tool",
      tool: "Ellipse",
    }),
    toolCommand({
      callbacks,
      icon: "line",
      id: "tool.line",
      keywords: ["stroke", "segment"],
      shortcut: shortcut("l", "L"),
      title: "Line tool",
      tool: "Line",
    }),
    toolCommand({
      callbacks,
      icon: "arrow",
      id: "tool.arrow",
      keywords: ["connector", "direction"],
      shortcut: shortcut("l", "⇧L", ["shift"]),
      title: "Arrow tool",
      tool: "Arrow",
    }),
    toolCommand({
      callbacks,
      icon: "pen",
      id: "tool.pen",
      keywords: ["vector", "path", "bezier"],
      shortcut: shortcut("p", "P"),
      title: "Pen tool",
      tool: "Pen",
    }),
    toolCommand({
      callbacks,
      icon: "pencil",
      id: "tool.pencil",
      keywords: ["freehand", "draw"],
      shortcut: shortcut("p", "⇧P", ["shift"]),
      title: "Pencil tool",
      tool: "Pencil",
    }),
    toolCommand({
      callbacks,
      icon: "text",
      id: "tool.text",
      keywords: ["type", "label"],
      shortcut: shortcut("t", "T"),
      title: "Text tool",
      tool: "Text",
    }),
    toolCommand({
      callbacks,
      icon: "comment",
      id: "tool.comment",
      keywords: ["feedback", "annotation"],
      shortcut: shortcut("c", "C"),
      title: "Comment tool",
      tool: "Comment",
    }),
    command({
      category: "Edit",
      disabled: callbacks.onUndo === undefined || !canUndo,
      execute: callbacks.onUndo,
      icon: "undo",
      id: "history.undo",
      keywords: ["history", "revert"],
      placements: toolbarPaletteAndMenu,
      shortcut: shortcut("z", "⌘/Ctrl+Z", ["mod"]),
      title: "Undo",
    }),
    command({
      category: "Edit",
      disabled: callbacks.onRedo === undefined || !canRedo,
      execute: callbacks.onRedo,
      icon: "redo",
      id: "history.redo",
      keywords: ["history", "repeat"],
      placements: toolbarPaletteAndMenu,
      shortcut: shortcut("z", "⇧⌘/Ctrl+Z", ["mod", "shift"]),
      title: "Redo",
    }),
    optionalAction(
      {
        category: "Edit",
        icon: "cursor",
        id: "selection.select-all",
        keywords: ["everything", "all layers"],
        shortcut: shortcut("a", "⌘/Ctrl+A", ["mod"]),
        title: "Select all",
      },
      callbacks.onSelectAll,
    ),
    optionalAction(
      {
        category: "Edit",
        icon: "duplicate",
        id: "selection.copy",
        keywords: ["clipboard"],
        shortcut: shortcut("c", "⌘/Ctrl+C", ["mod"]),
        title: "Copy selection",
      },
      callbacks.onCopySelection,
    ),
    optionalAction(
      {
        category: "Edit",
        icon: "cut",
        id: "selection.cut",
        keywords: ["clipboard"],
        shortcut: shortcut("x", "⌘/Ctrl+X", ["mod"]),
        title: "Cut selection",
      },
      callbacks.onCutSelection,
    ),
    optionalAction(
      {
        category: "Edit",
        icon: "paste",
        id: "selection.paste",
        keywords: ["clipboard"],
        shortcut: shortcut("v", "⌘/Ctrl+V", ["mod"]),
        title: "Paste",
      },
      callbacks.onPasteSelection,
    ),
    command({
      category: "Edit",
      disabled:
        callbacks.onDuplicateSelection === undefined ||
        !canDuplicateSelection,
      execute: callbacks.onDuplicateSelection,
      icon: "duplicate",
      id: "selection.duplicate",
      keywords: ["clone", "copy"],
      shortcut: shortcut("d", "⌘/Ctrl+D", ["mod"]),
      title: "Duplicate selection",
    }),
    command({
      alternateShortcuts: [shortcut("Backspace", "Backspace")],
      category: "Edit",
      disabled:
        callbacks.onDeleteSelection === undefined || !canDeleteSelection,
      execute: callbacks.onDeleteSelection,
      icon: "trash",
      id: "selection.delete",
      keywords: ["remove"],
      shortcut: shortcut("Delete", "Delete"),
      title: "Delete selection",
    }),
    optionalAction(
      {
        category: "Edit",
        icon: "group",
        id: "selection.group",
        keywords: ["combine"],
        shortcut: shortcut("g", "⌘/Ctrl+G", ["mod"]),
        title: "Group selection",
      },
      callbacks.onGroupSelection,
    ),
    optionalAction(
      {
        category: "Edit",
        icon: "ungroup",
        id: "selection.ungroup",
        keywords: ["separate"],
        shortcut: shortcut("g", "⇧⌘/Ctrl+G", ["mod", "shift"]),
        title: "Ungroup selection",
      },
      callbacks.onUngroupSelection,
    ),
    optionalAction(
      {
        category: "Edit",
        icon: "frame",
        id: "selection.frame",
        keywords: ["wrap", "container"],
        shortcut: shortcut("g", "⌥⌘/Ctrl+G", ["alt", "mod"]),
        title: "Frame selection",
      },
      callbacks.onFrameSelection,
    ),
    optionalAction(
      {
        category: "Edit",
        icon: "layers",
        id: "selection.order-forward",
        keywords: ["bring forward", "layer order"],
        shortcut: shortcut("]", "⌘/Ctrl+] ", ["mod"]),
        title: "Bring forward",
      },
      callbacks.onOrderSelection === undefined
        ? undefined
        : () => callbacks.onOrderSelection?.("forward"),
    ),
    optionalAction(
      {
        category: "Edit",
        icon: "layers",
        id: "selection.order-backward",
        keywords: ["send backward", "layer order"],
        shortcut: shortcut("[", "⌘/Ctrl+[", ["mod"]),
        title: "Send backward",
      },
      callbacks.onOrderSelection === undefined
        ? undefined
        : () => callbacks.onOrderSelection?.("backward"),
    ),
    optionalAction(
      {
        category: "Edit",
        icon: "layers",
        id: "selection.order-front",
        keywords: ["bring to front", "layer order"],
        shortcut: shortcut("]", "⌥⌘/Ctrl+]", ["alt", "mod"]),
        title: "Bring to front",
      },
      callbacks.onOrderSelection === undefined
        ? undefined
        : () => callbacks.onOrderSelection?.("front"),
    ),
    optionalAction(
      {
        category: "Edit",
        icon: "layers",
        id: "selection.order-back",
        keywords: ["send to back", "layer order"],
        shortcut: shortcut("[", "⌥⌘/Ctrl+[", ["alt", "mod"]),
        title: "Send to back",
      },
      callbacks.onOrderSelection === undefined
        ? undefined
        : () => callbacks.onOrderSelection?.("back"),
    ),
    optionalAction(
      {
        category: "Edit",
        icon: "lock",
        id: "selection.toggle-lock",
        keywords: ["unlock", "protect"],
        shortcut: shortcut("l", "⇧⌘/Ctrl+L", ["mod", "shift"]),
        title: "Lock or unlock selection",
      },
      callbacks.onToggleLock,
    ),
    optionalAction(
      {
        category: "Edit",
        icon: "eye",
        id: "selection.toggle-visibility",
        keywords: ["hide", "show"],
        shortcut: shortcut("h", "⇧⌘/Ctrl+H", ["mod", "shift"]),
        title: "Show or hide selection",
      },
      callbacks.onToggleVisibility,
    ),
    optionalAction(
      {
        category: "Components",
        icon: "component",
        id: "component.create",
        keywords: ["master", "design system", "reusable"],
        shortcut: shortcut("k", "⌥⌘/Ctrl+K", ["alt", "mod"]),
        title: "Create component",
      },
      callbacks.onCreateComponent,
    ),
    optionalAction(
      {
        category: "View",
        icon: "fit",
        id: "viewport.reset",
        keywords: ["actual size", "100 percent"],
        shortcut: shortcut("0", "⇧0", ["shift"], "Digit0"),
        title: "Reset zoom to 100%",
      },
      callbacks.onResetZoom,
    ),
    command({
      category: "View",
      disabled: callbacks.onFitCanvas === undefined,
      execute: callbacks.onFitCanvas,
      icon: "fit",
      id: "viewport.fit",
      keywords: ["fit all", "zoom to content"],
      placements: toolbarPaletteAndMenu,
      shortcut: shortcut("1", "⇧1", ["shift"], "Digit1"),
      title: "Fit canvas",
    }),
    optionalAction(
      {
        category: "View",
        icon: "fit",
        id: "viewport.fit-selection",
        keywords: ["fit selection", "zoom to selection"],
        shortcut: shortcut("2", "⇧2", ["shift"], "Digit2"),
        title: "Fit selection",
      },
      callbacks.onFitSelection,
    ),
    optionalAction(
      {
        alternateShortcuts: [shortcut("+", "+", ["shift"])],
        category: "View",
        icon: "zoom-in",
        id: "viewport.zoom-in",
        keywords: ["magnify", "increase zoom"],
        shortcut: shortcut("=", "+"),
        title: "Zoom in",
      },
      callbacks.onZoomIn,
    ),
    optionalAction(
      {
        category: "View",
        icon: "zoom-out",
        id: "viewport.zoom-out",
        keywords: ["reduce", "decrease zoom"],
        shortcut: shortcut("-", "−"),
        title: "Zoom out",
      },
      callbacks.onZoomOut,
    ),
    optionalAction(
      {
        category: "Workspace",
        icon: "browser",
        id: "workspace.browser",
        keywords: ["preview", "localhost"],
        shortcut: shortcut("b", "⌘/Ctrl+B", ["mod"]),
        title: "Open browser",
      },
      callbacks.onOpenBrowser,
    ),
    optionalAction(
      {
        category: "Workspace",
        icon: "activity",
        id: "workspace.runs",
        keywords: ["agents", "trace", "history"],
        shortcut: shortcut("r", "⇧⌘/Ctrl+R", ["mod", "shift"]),
        title: "Open runs",
      },
      callbacks.onOpenRuns,
    ),
    optionalAction(
      {
        category: "Workspace",
        icon: "settings",
        id: "workspace.settings",
        keywords: ["preferences", "harness", "model"],
        shortcut: shortcut(",", "⌘/Ctrl+,", ["mod"]),
        title: "Open settings",
      },
      callbacks.onOpenSettings,
    ),
  ]);
}
function normalizedSearchText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replaceAll("⌘", " command ctrl ")
    .replaceAll("⌥", " alt option ")
    .replaceAll("⇧", " shift ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function filterEditorCommands(
  commands: readonly EditorCommand[],
  query: string,
): readonly EditorCommand[] {
  const searchTerms = normalizedSearchText(query).split(/\s+/u).filter(Boolean);

  if (searchTerms.length === 0) {
    return commands;
  }

  return Object.freeze(
    commands.filter((item) => {
      const searchableText = normalizedSearchText(
        [
          item.title,
          item.category,
          item.shortcut.label,
          ...item.alternateShortcuts.map(({ label }) => label),
          ...item.keywords,
        ].join(" "),
      );
      const searchableTokens = searchableText.split(/\s+/u);
      return searchTerms.every((term) =>
        term.length === 1
          ? searchableTokens.includes(term)
          : searchableText.includes(term),
      );
    }),
  );
}
function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  let element: Element | null = target;
  while (element !== null) {
    const tagName = element.tagName.toLocaleLowerCase();
    if (
      tagName === "input" ||
      tagName === "textarea" ||
      tagName === "select"
    ) {
      return true;
    }

    const contentEditable = element.getAttribute("contenteditable");
    if (contentEditable !== null) {
      return contentEditable.toLocaleLowerCase() !== "false";
    }
    element = element.parentElement;
  }

  return false;
}
function matchesShortcut(
  event: EditorKeyboardEvent,
  candidate: EditorShortcut,
): boolean {
  const needsAlt = candidate.modifiers.includes("alt");
  const needsMod = candidate.modifiers.includes("mod");
  const needsShift = candidate.modifiers.includes("shift");
  const hasMod = event.metaKey || event.ctrlKey;

  if (
    event.altKey !== needsAlt ||
    hasMod !== needsMod ||
    event.shiftKey !== needsShift
  ) {
    return false;
  }

  const normalizedKey = event.key.toLocaleLowerCase();
  const expectedKey = candidate.key.toLocaleLowerCase();
  return (
    normalizedKey === expectedKey ||
    (candidate.code !== undefined && event.code === candidate.code)
  );
}
export function executeEditorCommand(commandToExecute: EditorCommand): boolean {
  if (commandToExecute.disabled) {
    return false;
  }

  commandToExecute.execute();
  return true;
}
export function dispatchEditorShortcut(
  commands: readonly EditorCommand[],
  event: EditorKeyboardEvent,
): EditorCommand | null {
  if (
    event.repeat ||
    event.isComposing ||
    (event.key !== "Escape" && isEditableElement(event.target))
  ) {
    return null;
  }

  const matchedCommand = commands.find((item) =>
    [item.shortcut, ...item.alternateShortcuts].some((candidate) =>
      matchesShortcut(event, candidate),
    ),
  );

  if (matchedCommand === undefined || matchedCommand.disabled) {
    return null;
  }

  event.preventDefault();
  executeEditorCommand(matchedCommand);
  return matchedCommand;
}
