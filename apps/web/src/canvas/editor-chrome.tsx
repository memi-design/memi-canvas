import { EditorIconButton } from "../components/ui/editor-icon-button.js";
import {
  createEditorCommands,
  executeEditorCommand,
  type ProfessionalCanvasTool,
} from "./commands.js";
import { EditorIcon } from "./icons.js";
import { useEffect, useRef, useState } from "react";

export type { CanvasTool, ProfessionalCanvasTool } from "./commands.js";

interface EditorTopbarProps {
  readonly activeTool: ProfessionalCanvasTool;
  readonly activityOpen: boolean;
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly onActivityToggle: () => void;
  readonly onFitAll: () => void;
  readonly onMenuToggle: () => void;
  readonly onRedo: () => void;
  readonly onSettingsToggle: () => void;
  readonly onSourceToggle: () => void;
  readonly onToolSelect: (tool: ProfessionalCanvasTool) => void;
  readonly onUndo: () => void;
  readonly settingsOpen: boolean;
  readonly showBackAction?: boolean;
  readonly title: string;
}

const ACTION_HELP_DELAY_MS = 400;

// Atomic Design: organism — compact icon-first editor command surface.
export function EditorTopbar({
  activeTool,
  activityOpen,
  canRedo,
  canUndo,
  onActivityToggle,
  onFitAll,
  onMenuToggle,
  onRedo,
  onSettingsToggle,
  onSourceToggle,
  onToolSelect,
  onUndo,
  settingsOpen,
  showBackAction = false,
  title,
}: EditorTopbarProps) {
  const [openActionHelp, setOpenActionHelp] = useState<string | null>(null);
  const pendingActionHelp = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  const cancelPendingActionHelp = () => {
    if (pendingActionHelp.current === undefined) {
      return;
    }
    clearTimeout(pendingActionHelp.current);
    pendingActionHelp.current = undefined;
  };

  const scheduleActionHelp = (actionId: string) => {
    cancelPendingActionHelp();
    pendingActionHelp.current = setTimeout(() => {
      pendingActionHelp.current = undefined;
      setOpenActionHelp(actionId);
    }, ACTION_HELP_DELAY_MS);
  };

  const closeActionHelp = (actionId: string) => {
    cancelPendingActionHelp();
    setOpenActionHelp((current) => current === actionId ? null : current);
  };

  useEffect(() => cancelPendingActionHelp, []);

  const toolbarCommands = createEditorCommands(
    {
      onFitCanvas: onFitAll,
      onRedo,
      onSelectProfessionalTool: onToolSelect,
      onSelectTool: (tool) => onToolSelect(tool),
      onUndo,
    },
    { canRedo, canUndo },
  ).filter(({ placements }) => placements.includes("toolbar"));

  return (
    <header className="canvas-topbar">
      <EditorIconButton
        className="canvas-tool"
        icon={showBackAction ? "home" : "menu"}
        label={showBackAction ? "Back to projects" : "Main menu"}
        onClick={onMenuToggle}
        shortcut={showBackAction ? undefined : "⌘K"}
        tooltipAlign="start"
        tooltipOpen={openActionHelp === "menu"}
        onTooltipCloseRequest={() => closeActionHelp("menu")}
        onTooltipOpenRequest={() => scheduleActionHelp("menu")}
      />
      <div aria-label="Canvas tools" className="canvas-toolbar" role="toolbar">
        {toolbarCommands.map((command) => (
          <EditorIconButton
            className="canvas-tool"
            disabled={command.disabled}
            disabledReason={
              command.id === "history.undo"
                ? "Nothing to undo yet."
                : command.id === "history.redo"
                  ? "Nothing to redo yet."
                  : undefined
            }
            icon={command.icon}
            key={command.id}
            label={command.title}
            onClick={() => executeEditorCommand(command)}
            onTooltipCloseRequest={() => closeActionHelp(command.id)}
            onTooltipOpenRequest={() => scheduleActionHelp(command.id)}
            pressed={
              command.kind === "tool"
                ? activeTool === command.tool
                : undefined
            }
            shortcut={command.shortcut.label}
            tooltipOpen={openActionHelp === command.id}
          />
        ))}
      </div>
      <button className="canvas-file-title" type="button">
        <h1>{title.replace(" · Product canvas", "")}</h1>
        <EditorIcon name="chevron-down" size={12} />
      </button>
      <div className="canvas-top-actions">
        <EditorIconButton
          className="canvas-tool"
          icon="activity"
          label="Agent activity"
          onClick={onActivityToggle}
          onTooltipCloseRequest={() => closeActionHelp("activity")}
          onTooltipOpenRequest={() => scheduleActionHelp("activity")}
          pressed={activityOpen}
          shortcut="⇧⌘/Ctrl+R"
          tooltipOpen={openActionHelp === "activity"}
        />
        <EditorIconButton
          className="canvas-tool"
          icon="settings"
          label="Harness settings"
          onClick={onSettingsToggle}
          onTooltipCloseRequest={() => closeActionHelp("settings")}
          onTooltipOpenRequest={() => scheduleActionHelp("settings")}
          pressed={settingsOpen}
          shortcut="⌘/Ctrl+,"
          tooltipOpen={openActionHelp === "settings"}
        />
        <EditorIconButton
          className="canvas-tool"
          icon="code"
          label="Source"
          onClick={onSourceToggle}
          onTooltipCloseRequest={() => closeActionHelp("source")}
          onTooltipOpenRequest={() => scheduleActionHelp("source")}
          tooltipAlign="end"
          tooltipOpen={openActionHelp === "source"}
        />
      </div>
    </header>
  );
}
