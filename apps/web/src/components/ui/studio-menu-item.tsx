import type { ButtonHTMLAttributes, ReactNode } from "react";

import "./studio-menu-item.css";

export interface StudioMenuItemProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "className"
  > {
  readonly children: ReactNode;
  readonly tone?: "danger" | "default";
}

// Atomic Design: atom — shared keyboard-ready action row for editor menus.
export function StudioMenuItem({
  children,
  tone = "default",
  ...buttonProps
}: StudioMenuItemProps) {
  return (
    <button
      {...buttonProps}
      className="studio-menu-item text-sm text-foreground px-3 gap-2 sm:px-3 md:px-4 lg:px-4 sm:py-2 md:py-2 lg:py-2"
      data-tone={tone}
      type="button"
    >
      {children}
    </button>
  );
}
