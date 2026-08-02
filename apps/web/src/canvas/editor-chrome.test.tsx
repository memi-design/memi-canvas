import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorTopbar } from "./editor-chrome.js";

function renderTopbar() {
  return render(
    <EditorTopbar
      activeTool="select"
      activityOpen={false}
      canRedo={false}
      canUndo
      onActivityToggle={vi.fn()}
      onFitAll={vi.fn()}
      onMenuToggle={vi.fn()}
      onRedo={vi.fn()}
      onSettingsToggle={vi.fn()}
      onSourceToggle={vi.fn()}
      onToolSelect={vi.fn()}
      onUndo={vi.fn()}
      settingsOpen={false}
      title="Buzzr Sports 2.1 · Product canvas"
    />,
  );
}

function renderProjectTopbar() {
  return render(
    <EditorTopbar
      activeTool="select"
      activityOpen={false}
      canRedo={false}
      canUndo={false}
      onActivityToggle={vi.fn()}
      onFitAll={vi.fn()}
      onMenuToggle={vi.fn()}
      onRedo={vi.fn()}
      onSettingsToggle={vi.fn()}
      onSourceToggle={vi.fn()}
      onToolSelect={vi.fn()}
      onUndo={vi.fn()}
      settingsOpen={false}
      showBackAction
      title="Buzzr"
    />,
  );
}

describe("EditorTopbar action help", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the same structured tooltip contract across every icon action", () => {
    renderTopbar();

    const actions = screen.getAllByRole("button").filter((button) =>
      button.classList.contains("canvas-tool"),
    );

    expect(actions.length).toBeGreaterThan(10);
    for (const action of actions) {
      expect(action.getAttribute("aria-label")).toBeTruthy();
      expect(action.getAttribute("aria-describedby")).toBeTruthy();
      expect(action.getAttribute("title")).toBeNull();
    }

    expect(screen.getAllByRole("tooltip", { hidden: true })).toHaveLength(
      actions.length,
    );
  });

  it("uses a recognizable home glyph for the project-home action", () => {
    renderProjectTopbar();

    const home = screen.getByRole("button", { name: "Back to projects" });
    expect(home.querySelector('[data-icon="home"]')).toBeTruthy();
    expect(
      document.getElementById(home.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toContain("Back to projects");
  });

  it("pairs registered editor commands with their canonical shortcut", () => {
    renderTopbar();

    const toolbar = screen.getByRole("toolbar", { name: "Canvas tools" });
    const rectangle = within(toolbar).getByRole("button", {
      name: "Rectangle tool",
    });
    const tooltipId = rectangle.getAttribute("aria-describedby");
    const tooltip = document.getElementById(tooltipId ?? "");

    expect(tooltip?.textContent).toContain("Rectangle tool");
    expect(tooltip?.querySelector("kbd")?.textContent).toBe("R");
  });

  it("explains why a history action is unavailable", () => {
    renderTopbar();

    const redo = screen.getByRole("button", { name: "Redo" });
    const tooltipId = redo.getAttribute("aria-describedby");
    const tooltip = document.getElementById(tooltipId ?? "");

    expect(redo.getAttribute("aria-disabled")).toBe("true");
    expect(tooltip?.textContent).toContain("Nothing to redo yet.");
  });

  it("reveals action help only after the professional hover delay", () => {
    vi.useFakeTimers();
    renderTopbar();

    const rectangle = screen.getByRole("button", {
      name: "Rectangle tool",
    });
    const tooltip = document.getElementById(
      rectangle.getAttribute("aria-describedby") ?? "",
    );

    fireEvent.mouseEnter(rectangle);
    act(() => vi.advanceTimersByTime(399));
    expect(tooltip?.getAttribute("aria-hidden")).toBe("true");

    act(() => vi.advanceTimersByTime(1));
    expect(tooltip?.getAttribute("aria-hidden")).toBe("false");

    fireEvent.mouseLeave(rectangle);
    expect(tooltip?.getAttribute("aria-hidden")).toBe("true");
  });

  it("clears a pending reveal when the topbar unmounts", () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = renderTopbar();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Frame tool" }));

    expect(vi.getTimerCount()).toBe(1);
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
