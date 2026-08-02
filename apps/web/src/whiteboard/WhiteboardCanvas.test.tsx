import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WhiteboardCanvas } from "./WhiteboardCanvas.js";

function board(): HTMLElement {
  return screen.getByRole("listbox", { name: "Whiteboard items" });
}

describe("WhiteboardCanvas organism", () => {
  it("renders a starter board and creates notes with explicit controls", () => {
    render(<WhiteboardCanvas />);

    expect(
      screen.getByRole("region", { name: "Memi whiteboard" }),
    ).toBeTruthy();
    expect(board().getAttribute("aria-multiselectable")).toBe("true");
    expect(
      within(board()).getByRole("option", {
        name: "Sticky note: What should we solve?",
      }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add sticky note" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Sticky note content",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("New idea");
    expect(within(board()).getAllByRole("option")).toHaveLength(6);

    fireEvent.click(screen.getByRole("button", { name: "Add text note" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Text note content",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Start typing");
  });

  it("edits and moves the selected note using the properties panel", () => {
    const onStateChange = vi.fn();
    render(<WhiteboardCanvas onStateChange={onStateChange} />);

    fireEvent.click(
      within(board()).getByRole("option", {
        name: "Sticky note: What should we solve?",
      }),
    );
    const editor = screen.getByRole("textbox", {
      name: "Sticky note content",
    });
    fireEvent.change(editor, { target: { value: "Validated problem" } });
    fireEvent.click(screen.getByRole("button", { name: "Move right" }));
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));

    expect(
      within(board()).getByRole("option", {
        name: "Sticky note: Validated problem",
      }),
    ).toBeTruthy();
    expect(
      (screen.getByRole("spinbutton", { name: "X" }) as HTMLInputElement).value,
    ).toBe("184");
    expect(
      (screen.getByRole("spinbutton", { name: "Y" }) as HTMLInputElement).value,
    ).toBe("214");
    expect(onStateChange).toHaveBeenCalled();
  });

  it("commits valid coordinate drafts on blur without snapping empty input", () => {
    render(<WhiteboardCanvas />);
    fireEvent.click(
      within(board()).getByRole("option", {
        name: "Sticky note: What should we solve?",
      }),
    );
    const x = screen.getByRole("spinbutton", { name: "X" }) as HTMLInputElement;

    fireEvent.change(x, { target: { value: "" } });
    expect(x.value).toBe("");
    expect(screen.getByText("0 edits")).toBeTruthy();
    fireEvent.blur(x);
    expect(x.value).toBe("160");
    expect(screen.getByText("0 edits")).toBeTruthy();

    fireEvent.change(x, { target: { value: "240" } });
    expect(screen.getByText("0 edits")).toBeTruthy();
    fireEvent.blur(x);
    expect(x.value).toBe("240");
    expect(screen.getByText("1 edits")).toBeTruthy();
  });

  it("uses roving keyboard focus and keyboard selection", () => {
    render(<WhiteboardCanvas />);

    const options = within(board()).getAllByRole("option");
    options[0]?.focus();
    fireEvent.keyDown(options[0] as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1] as HTMLElement, { key: "Enter" });
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(options[1] as HTMLElement, {
      key: "Enter",
      shiftKey: true,
    });
    expect(options[1]?.getAttribute("aria-selected")).toBe("false");
  });

  it("connects two selected authoring items and creates sections", () => {
    render(<WhiteboardCanvas />);

    const stickyOptions = within(board()).getAllByRole("option", {
      name: /Sticky note:/,
    });
    fireEvent.click(stickyOptions[0] as HTMLElement);
    fireEvent.click(stickyOptions[1] as HTMLElement, { metaKey: true });
    const connect = screen.getByRole("button", {
      name: "Connect selected items",
    });
    expect((connect as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(connect);
    expect(
      within(board()).getAllByRole("option", { name: /Connector from/ }),
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Section title",
        }) as HTMLTextAreaElement
    ).value,
    ).toBe("New section");
  });

  it("uses compact icon tools and creates common items from shortcuts", () => {
    render(<WhiteboardCanvas />);

    const stickyButton = screen.getByRole("button", {
      name: "Add sticky note",
    });
    expect(stickyButton.getAttribute("title")).toContain("N");
    expect(within(stickyButton).queryByText("Sticky")).toBeNull();

    fireEvent.keyDown(board(), { key: "n" });
    expect(
      within(board()).getAllByRole("option", { name: /Sticky note:/ }),
    ).toHaveLength(3);
    fireEvent.keyDown(board(), { key: "t" });
    expect(
      within(board()).getAllByRole("option", { name: /Text note:/ }),
    ).toHaveLength(2);
    fireEvent.keyDown(board(), { key: "s" });
    expect(
      within(board()).getAllByRole("option", { name: /Section:/ }),
    ).toHaveLength(2);
  });

  it("zooms around the whiteboard viewport with controls and modifier-wheel", async () => {
    render(<WhiteboardCanvas />);

    expect(screen.getByText("100%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => {
      expect(screen.getByText("125%")).toBeTruthy();
    });

    fireEvent.wheel(board(), {
      clientX: 300,
      clientY: 200,
      ctrlKey: true,
      deltaY: 100,
    });
    await waitFor(() => {
      expect(screen.getByText("100%")).toBeTruthy();
    });
  });

  it("groups and deletes selected items from the item context menu", () => {
    render(<WhiteboardCanvas />);

    const stickyOptions = within(board()).getAllByRole("option", {
      name: /Sticky note:/,
    });
    fireEvent.click(stickyOptions[0] as HTMLElement);
    fireEvent.click(stickyOptions[1] as HTMLElement, { metaKey: true });
    fireEvent.contextMenu(stickyOptions[1] as HTMLElement, {
      clientX: 240,
      clientY: 180,
    });

    const menu = screen.getByRole("menu", { name: "Whiteboard item actions" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Group" }));

    fireEvent.contextMenu(stickyOptions[0] as HTMLElement, {
      clientX: 240,
      clientY: 180,
    });
    expect(
      within(screen.getByRole("menu", { name: "Whiteboard item actions" }))
        .getByRole("menuitem", { name: "Ungroup" }),
    ).toBeTruthy();

    fireEvent.keyDown(board(), { key: "Backspace" });
    expect(
      within(board()).queryAllByRole("option", { name: /Sticky note:/ }),
    ).toHaveLength(0);
    expect(
      within(board()).queryAllByRole("option", { name: /Connector from/ }),
    ).toHaveLength(0);
  });
});
