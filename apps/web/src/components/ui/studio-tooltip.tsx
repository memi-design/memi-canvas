import type { ReactNode } from "react";

export type StudioTooltipAlign = "center" | "end" | "start";
export type StudioTooltipPlacement = "bottom" | "left" | "right" | "top";

export interface StudioTooltipProps {
  readonly align?: StudioTooltipAlign | undefined;
  readonly children: ReactNode;
  readonly description?: string | undefined;
  readonly id: string;
  readonly label: string;
  readonly open: boolean;
  readonly placement?: StudioTooltipPlacement | undefined;
  readonly shortcut?: string | undefined;
}

// Atomic Design: atom — delayed, non-interactive action help for editor chrome.
export function StudioTooltip({
  align = "center",
  children,
  description,
  id,
  label,
  open,
  placement = "bottom",
  shortcut,
}: StudioTooltipProps) {
  return (
    <span
      className="studio-tooltip-anchor"
      data-tooltip-open={open ? "true" : "false"}
    >
      {children}
      <span
        aria-hidden={open ? "false" : "true"}
        className="studio-tooltip"
        data-align={align}
        data-placement={placement}
        id={id}
        role="tooltip"
      >
        <span className="studio-tooltip-heading">
          <span className="studio-tooltip-label">{label}</span>
          {shortcut === undefined ? null : (
            <kbd className="studio-tooltip-shortcut">{shortcut}</kbd>
          )}
        </span>
        {description === undefined ? null : (
          <span className="studio-tooltip-description">{description}</span>
        )}
      </span>
    </span>
  );
}
