import {
  EditorIcon,
  type EditorIconName,
} from "../../canvas/icons.js";
import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  useId,
  useRef,
} from "react";
import "./editor-icon-button.css";
import {
  StudioTooltip,
  type StudioTooltipAlign,
  type StudioTooltipPlacement,
} from "./studio-tooltip.js";

export interface EditorIconButtonProps {
  readonly className?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly disabledReason?: string | undefined;
  readonly icon: EditorIconName;
  readonly label: string;
  readonly onClick?: (() => void) | undefined;
  readonly pressed?: boolean | undefined;
  readonly shortcut?: string | undefined;
  readonly tooltipAlign?: StudioTooltipAlign | undefined;
  readonly tooltipOpen?: boolean | undefined;
  readonly onTooltipCloseRequest?: (() => void) | undefined;
  readonly onTooltipOpenRequest?: (() => void) | undefined;
  readonly tooltipPlacement?: StudioTooltipPlacement | undefined;
}

// Atomic Design: atom — shared accessible icon action for editor chrome.
export function EditorIconButton({
  className,
  disabled,
  disabledReason,
  icon,
  label,
  onClick,
  onTooltipCloseRequest,
  onTooltipOpenRequest,
  pressed,
  shortcut,
  tooltipAlign,
  tooltipOpen = false,
  tooltipPlacement,
}: EditorIconButtonProps) {
  const tooltipId = `editor-action-help-${useId().replaceAll(":", "")}`;
  const focused = useRef(false);
  const hovered = useRef(false);

  const handleMouseEnter = (_event: MouseEvent<HTMLSpanElement>) => {
    hovered.current = true;
    onTooltipOpenRequest?.();
  };

  const handleMouseLeave = (_event: MouseEvent<HTMLSpanElement>) => {
    hovered.current = false;
    if (!focused.current) {
      onTooltipCloseRequest?.();
    }
  };

  const handleFocus = (_event: FocusEvent<HTMLSpanElement>) => {
    focused.current = true;
    onTooltipOpenRequest?.();
  };

  const handleBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    focused.current = false;
    if (!hovered.current) {
      onTooltipCloseRequest?.();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "Escape" || !tooltipOpen) {
      return;
    }
    onTooltipCloseRequest?.();
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <StudioTooltip
      align={tooltipAlign}
      description={disabled ? disabledReason : undefined}
      id={tooltipId}
      label={label}
      open={tooltipOpen}
      placement={tooltipPlacement}
      shortcut={shortcut}
    >
      <span
        className="editor-icon-button-trigger"
        onBlur={handleBlur}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <button
          aria-disabled={disabled}
          aria-describedby={tooltipId}
          aria-label={label}
          aria-pressed={pressed}
          className={[
            "editor-icon-button",
            "text-sm",
            "px-3",
            "gap-2",
            "md:px-4",
            className,
          ].filter(Boolean).join(" ")}
          onClick={disabled ? undefined : onClick}
          type="button"
        >
          <EditorIcon name={icon} />
        </button>
      </span>
    </StudioTooltip>
  );
}
