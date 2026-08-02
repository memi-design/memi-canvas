import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PromptDock } from "./collaboration.js";
import type { WorkbenchNode } from "./model.js";

const selectedNode: WorkbenchNode = {
  id: "buzzr-screen-games",
  kind: "DraftFrame",
  name: "Games",
  parentId: null,
  position: { x: 0, y: 0 },
  size: { width: 390, height: 844 },
  locked: false,
  hidden: false,
  source: {
    repositoryRevision: "a6ce2458",
    routeId: "games",
    stateId: "default",
    coverageCellId: "games-mobile",
    sourceAnchor: "src/features/games/screens/GamesTabScreen.tsx",
    viewport: { name: "mobile", width: 390, height: 844 },
  },
};

function renderPromptDock(
  overrides: Partial<React.ComponentProps<typeof PromptDock>> = {},
) {
  const props: React.ComponentProps<typeof PromptDock> = {
    documentRevision: 18,
    harnessId: "codex",
    harnessOptions: [
      { id: "codex", label: "Codex" },
      { id: "claude-code", label: "Claude Code" },
    ],
    modelId: "gpt-5.5",
    onHarnessChange: vi.fn(),
    onModelChange: vi.fn(),
    onPromptChange: vi.fn(),
    onPromptModeChange: vi.fn(),
    onSettingsToggle: vi.fn(),
    onSubmit: vi.fn(),
    permissionPolicy: "approval",
    prompt: "",
    promptMode: "plan",
    runtimeConnected: true,
    selectedNode,
    settingsOpen: false,
    ...overrides,
  };

  return { ...render(<PromptDock {...props} />), props };
}

describe("PromptDock", () => {
  it("starts compact, identifies the selected context, and explains configuration actions", () => {
    const { props } = renderPromptDock();

    const dock = screen.getByRole("region", { name: "Agent prompt" });
    expect(dock.getAttribute("data-expanded")).toBe("false");
    expect(within(dock).getByText("Games")).toBeTruthy();
    expect(within(dock).getByText("Revision 18")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Prompt mode" }).getAttribute("title"),
    ).toContain("Plan");
    expect(
      screen.getByRole("combobox", { name: "Agent harness" }).getAttribute(
        "title",
      ),
    ).toContain("Codex");
    expect(
      screen.getByRole("combobox", { name: "Model" }).getAttribute("title"),
    ).toContain("GPT-5.5");
    expect(screen.getByRole("button", { name: "Expand prompt" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "Connected runtime",
    );

    fireEvent.click(screen.getByRole("button", { name: "Prompt settings" }));
    expect(props.onSettingsToggle).toHaveBeenCalledTimes(1);
    expect(dock.getAttribute("data-expanded")).toBe("true");
  });

  it("places agent configuration in a toolbar above the prompt input", () => {
    renderPromptDock();

    const dock = screen.getByRole("region", { name: "Agent prompt" });
    const toolbar = within(dock).getByRole("toolbar", {
      name: "Agent configuration",
    });
    const prompt = within(dock).getByRole("textbox", { name: "Prompt" });

    expect(
      toolbar.compareDocumentPosition(prompt) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(toolbar).getByRole("combobox", {
      name: "Prompt mode",
    })).toBeTruthy();
    expect(within(toolbar).getByRole("combobox", {
      name: "Agent harness",
    })).toBeTruthy();
    expect(within(toolbar).getByRole("combobox", {
      name: "Model",
    })).toBeTruthy();
  });

  it("expands on focus and can cancel a prompt draft back to compact mode", () => {
    const onPromptChange = vi.fn();
    renderPromptDock({
      onPromptChange,
      prompt: "Make the games filters easier to scan",
    });

    const textarea = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.focus(textarea);
    expect(
      screen.getByRole("region", { name: "Agent prompt" }).getAttribute(
        "data-expanded",
      ),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Collapse prompt" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel prompt" }));
    expect(onPromptChange).toHaveBeenCalledWith("");
    expect(
      screen.getByRole("region", { name: "Agent prompt" }).getAttribute(
        "data-expanded",
      ),
    ).toBe("false");
  });

  it("collapses on Escape without discarding the draft", () => {
    const onPromptChange = vi.fn();
    renderPromptDock({
      onPromptChange,
      prompt: "Keep this instruction for later",
    });

    const textarea = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.focus(textarea);
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(onPromptChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: "Agent prompt" }).getAttribute(
        "data-expanded",
      ),
    ).toBe("false");
  });

  it("submits with Enter or Command-Enter while Shift-Enter preserves a newline", () => {
    const onSubmit = vi.fn();
    renderPromptDock({
      onSubmit,
      prompt: "Propose a clearer games card",
    });
    const textarea = screen.getByRole("textbox", { name: "Prompt" });

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("does not submit an unavailable draft from the keyboard", () => {
    const onSubmit = vi.fn();
    const { rerender, props } = renderPromptDock({
      onSubmit,
      prompt: "   ",
    });
    const textarea = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(<PromptDock {...props} prompt="Inspect this" selectedNode={undefined} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Prompt" }), {
      key: "Enter",
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("reports disconnected preparation honestly without implying provider execution", () => {
    renderPromptDock({ runtimeConnected: false });

    expect(screen.getByRole("status").textContent).toContain(
      "prepared locally",
    );
    expect(screen.getAllByText("Disconnected").length).toBeGreaterThan(0);
    expect(screen.queryByText(/thinking/i)).toBeNull();
  });
});
