import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GlobalSettingsPanel } from "./GlobalSettingsPanel.js";
import { DEFAULT_GLOBAL_AGENT_SETTINGS } from "./global-settings.js";

describe("GlobalSettingsPanel", () => {
  it("separates declared compatibility from connected runtime truth", () => {
    render(
      <GlobalSettingsPanel
        initialSettings={DEFAULT_GLOBAL_AGENT_SETTINGS}
        onClose={vi.fn()}
        onSave={vi.fn()}
        storageAvailable
      />,
    );

    const runtime = screen.getByRole("region", {
      name: "Agent runtime status",
    });
    expect(within(runtime).getByText("Declared compatible")).toBeTruthy();
    expect(within(runtime).getByText("Not connected")).toBeTruthy();
    expect(
      within(runtime).getByText(/Execution is unavailable until/i),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /run|execute/i }),
    ).toBeNull();
  });

  it.each([
    ["Codex local runtime", "Codex local runtime"],
    [undefined, "Codex"],
  ])(
    "renders a reported runtime connection without implying a settings action executes",
    (runtimeLabel, expectedLabel) => {
      render(
        <GlobalSettingsPanel
          initialSettings={DEFAULT_GLOBAL_AGENT_SETTINGS}
          onClose={vi.fn()}
          onSave={vi.fn()}
          runtimeConnections={[
            {
              harnessId: "codex",
              state: "connected",
              ...(runtimeLabel === undefined ? {} : { runtimeLabel }),
            },
          ]}
          storageAvailable
        />,
      );

      const runtime = screen.getByRole("region", {
        name: "Agent runtime status",
      });
      expect(within(runtime).getByText("Connected runtime")).toBeTruthy();
      expect(
        within(runtime).getByText(
          new RegExp(`${expectedLabel} reported a connection`, "i"),
        ),
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /run|execute/i }),
      ).toBeNull();
    },
  );

  it("saves harness, model, reasoning, and permission as one validated draft", () => {
    const onSave = vi.fn();
    render(
      <GlobalSettingsPanel
        initialSettings={DEFAULT_GLOBAL_AGENT_SETTINGS}
        onClose={vi.fn()}
        onSave={onSave}
        storageAvailable
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "gpt-5.4" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Harness" }), {
      target: { value: "claude-code" },
    });
    expect(
      (screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement)
        .value,
    ).toBe("claude-adapter-default");
    fireEvent.change(screen.getByRole("combobox", { name: "Reasoning" }), {
      target: { value: "medium" },
    });
    fireEvent.click(
      screen.getByRole("radio", { name: /Inspect only/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onSave).toHaveBeenCalledWith({
      ...DEFAULT_GLOBAL_AGENT_SETTINGS,
      harnessId: "claude-code",
      modelId: "claude-adapter-default",
      reasoningEffort: "medium",
      permissionPolicy: "inspect-only",
    });
  });

  it("keeps Helium localhost policy visible and immutable", () => {
    render(
      <GlobalSettingsPanel
        initialSettings={DEFAULT_GLOBAL_AGENT_SETTINGS}
        onClose={vi.fn()}
        onSave={vi.fn()}
        storageAvailable
      />,
    );

    const browserPolicy = screen.getByRole("region", {
      name: "Browser policy",
    });
    expect(within(browserPolicy).getByText("Helium")).toBeTruthy();
    expect(
      within(browserPolicy).getByText(/explicit local HTTP port/i),
    ).toBeTruthy();
    expect(within(browserPolicy).queryByRole("combobox")).toBeNull();
  });

  it("warns when changes can only live for the current session", () => {
    render(
      <GlobalSettingsPanel
        initialSettings={DEFAULT_GLOBAL_AGENT_SETTINGS}
        onClose={vi.fn()}
        onSave={vi.fn()}
        storageAvailable={false}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Settings cannot be persisted",
    );
  });

  it("closes back to project Home without saving", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(
      <GlobalSettingsPanel
        initialSettings={DEFAULT_GLOBAL_AGENT_SETTINGS}
        onClose={onClose}
        onSave={onSave}
        storageAvailable
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Back to project Home" }),
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the panel open and reports an unexpected persistence failure", () => {
    const onClose = vi.fn();
    render(
      <GlobalSettingsPanel
        initialSettings={DEFAULT_GLOBAL_AGENT_SETTINGS}
        onClose={onClose}
        onSave={() => false}
        storageAvailable
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "Settings were not saved",
    );
  });
});
