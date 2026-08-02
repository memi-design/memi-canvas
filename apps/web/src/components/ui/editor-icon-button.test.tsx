import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorIconButton } from "./editor-icon-button.js";

describe("EditorIconButton", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes an accessible action name and a structured shortcut tooltip", () => {
    render(
      <EditorIconButton
        icon="cursor"
        label="Select tool"
        shortcut="V"
      />,
    );

    const action = screen.getByRole("button", { name: "Select tool" });
    const tooltip = screen.getByRole("tooltip", { hidden: true });

    expect(action.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(action.getAttribute("title")).toBeNull();
    expect(tooltip.getAttribute("data-placement")).toBe("bottom");
    expect(tooltip.getAttribute("aria-hidden")).toBe("true");
    expect(tooltip.textContent).toContain("Select tool");
    expect(tooltip.querySelector("kbd")?.textContent).toBe("V");
  });

  it("requests help on hover and closes after pointer departure", () => {
    const onTooltipCloseRequest = vi.fn();
    const onTooltipOpenRequest = vi.fn();
    const { rerender } = render(
      <EditorIconButton
        icon="square"
        label="Rectangle tool"
        onTooltipCloseRequest={onTooltipCloseRequest}
        onTooltipOpenRequest={onTooltipOpenRequest}
        shortcut="R"
      />,
    );

    const action = screen.getByRole("button", { name: "Rectangle tool" });
    const tooltip = screen.getByRole("tooltip", { hidden: true });

    fireEvent.mouseEnter(action);
    expect(onTooltipOpenRequest).toHaveBeenCalledOnce();

    rerender(
      <EditorIconButton
        icon="square"
        label="Rectangle tool"
        onTooltipCloseRequest={onTooltipCloseRequest}
        onTooltipOpenRequest={onTooltipOpenRequest}
        shortcut="R"
        tooltipOpen
      />,
    );
    expect(tooltip.getAttribute("aria-hidden")).toBe("false");

    fireEvent.mouseLeave(
      screen.getByRole("button", { name: "Rectangle tool" }),
    );
    expect(onTooltipCloseRequest).toHaveBeenCalledOnce();
  });

  it("provides the same delayed help to keyboard focus and dismisses on Escape", () => {
    const onParentKeyDown = vi.fn();
    const onTooltipCloseRequest = vi.fn();
    const onTooltipOpenRequest = vi.fn();
    render(
      <div onKeyDown={onParentKeyDown}>
        <EditorIconButton
          icon="comment"
          label="Comment tool"
          onTooltipCloseRequest={onTooltipCloseRequest}
          onTooltipOpenRequest={onTooltipOpenRequest}
          shortcut="C"
          tooltipOpen
        />
      </div>,
    );

    const action = screen.getByRole("button", { name: "Comment tool" });
    const tooltip = screen.getByRole("tooltip", { hidden: true });

    fireEvent.focus(action);
    expect(onTooltipOpenRequest).toHaveBeenCalledOnce();
    expect(tooltip.getAttribute("aria-hidden")).toBe("false");

    const wasNotCanceled = fireEvent.keyDown(action, { key: "Escape" });
    expect(wasNotCanceled).toBe(false);
    expect(onTooltipCloseRequest).toHaveBeenCalledOnce();
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  it("keeps unavailable actions focusable for keyboard help without executing", () => {
    const onClick = vi.fn();
    const onTooltipOpenRequest = vi.fn();
    render(
      <EditorIconButton
        disabled
        disabledReason="Nothing to redo yet."
        icon="redo"
        label="Redo"
        onClick={onClick}
        onTooltipOpenRequest={onTooltipOpenRequest}
        shortcut="⇧⌘Z"
        tooltipOpen
      />,
    );

    const action = screen.getByRole("button", { name: "Redo" });
    const tooltip = screen.getByRole("tooltip", { hidden: true });

    expect(action.getAttribute("aria-disabled")).toBe("true");
    expect(action.hasAttribute("disabled")).toBe(false);

    fireEvent.focus(action);
    expect(onTooltipOpenRequest).toHaveBeenCalledOnce();
    expect(tooltip.getAttribute("aria-hidden")).toBe("false");
    expect(tooltip.textContent).toContain("Nothing to redo yet.");

    fireEvent.click(action);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps tooltip chrome inert and honors reduced motion", () => {
    const stylesheet = readFileSync(
      resolve(
        process.cwd(),
        "apps/web/src/components/ui/editor-icon-button.css",
      ),
      "utf8",
    );

    expect(stylesheet).toMatch(/pointer-events:\s*none/);
    expect(stylesheet).toMatch(/var\(--studio-surface-strong\)/);
    expect(stylesheet).toMatch(/var\(--studio-ink-primary\)/);
    expect(stylesheet).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(stylesheet).not.toMatch(/#[\da-f]{3,8}\b/i);
  });
});
