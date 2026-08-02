import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";

function viewport(): HTMLElement {
  return screen.getByRole("region", { name: "Infinite canvas" });
}

describe("CanvasWorkbench command-bus integration", () => {
  it("routes human document mutations and history traversal through traceable editor commands", () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} />);

    fireEvent.click(screen.getByRole("button", { name: "Rectangle tool" }));
    fireEvent.click(viewport(), { clientX: 640, clientY: 360 });
    fireEvent.change(screen.getByRole("spinbutton", { name: "X" }), {
      target: { value: "720" },
    });
    fireEvent.blur(screen.getByRole("spinbutton", { name: "X" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate selection" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    fireEvent.click(screen.getByRole("button", { name: "Agent activity" }));

    const commandTrace = screen.getByRole("log", { name: "Trace" });
    const initialRevision = canvasWorkbenchFixture.document.revision;
    expect(
      within(commandTrace).getByText(
        `Human · Create Rectangle 2 · r${initialRevision} → r${initialRevision + 1} · applied`,
      ),
    ).toBeTruthy();
    expect(
      within(commandTrace).getByText(
        `Human · Move Rectangle 2 · r${initialRevision + 1} → r${initialRevision + 2} · applied`,
      ),
    ).toBeTruthy();
    expect(
      within(commandTrace).getByText(
        `Human · Duplicate Rectangle 2 · r${initialRevision + 2} → r${initialRevision + 3} · applied`,
      ),
    ).toBeTruthy();
    expect(
      within(commandTrace).getByText(
        `Human · Undo Duplicate Rectangle 2 · r${initialRevision + 3} → r${initialRevision + 4} · applied`,
      ),
    ).toBeTruthy();
    expect(
      within(commandTrace).getByText(
        `Human · Duplicate Rectangle 2 · r${initialRevision + 4} → r${initialRevision + 5} · applied`,
      ),
    ).toBeTruthy();

    const history = screen.getByRole("list", {
      name: "Semantic history",
    });
    expect(within(history).getAllByRole("listitem")).toHaveLength(3);
  });
});
