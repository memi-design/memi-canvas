import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import { createCanvasWorkbenchV3TestSession } from "./canvas-workbench-v3-test-session.js";

function viewport(): HTMLElement {
  return screen.getByRole("region", { name: "Infinite canvas" });
}

async function renderWorkbench() {
  const v3Session = createCanvasWorkbenchV3TestSession(canvasWorkbenchFixture);
  render(
    <CanvasWorkbench
      project={canvasWorkbenchFixture}
      v3Session={v3Session}
    />,
  );
  await screen.findByRole("toolbar", { name: "Canvas tools" });
  return v3Session;
}

describe("CanvasWorkbench command-bus integration", () => {
  it("routes human document mutations and history traversal through traceable editor commands", async () => {
    const v3Session = await renderWorkbench();

    fireEvent.click(screen.getByRole("button", { name: "Rectangle tool" }));
    fireEvent.click(viewport(), { clientX: 640, clientY: 360 });
    const rectangle = await screen.findByRole("button", {
      name: "Rectangle 2 on canvas",
    });
    fireEvent.click(rectangle);
    const xField = await screen.findByRole("spinbutton", { name: "X" });
    fireEvent.change(xField, {
      target: { value: "720" },
    });
    fireEvent.blur(xField);
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate selection" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Undo" }).getAttribute(
          "aria-disabled",
        ),
      ).toBe("false");
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Redo" }).getAttribute(
          "aria-disabled",
        ),
      ).toBe("false");
    });
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));

    const initialRevision = canvasWorkbenchFixture.document.revision;
    await waitFor(async () => {
      const journal = await v3Session.persistence.load({
        schemaVersion: 1,
        documentId: v3Session.document.id,
        projectId: v3Session.document.projectId,
      });
      expect(journal?.operations.map(({ label }) => label)).toEqual([
        "Create Rectangle 2",
        "Move Rectangle 2",
        "Duplicate Rectangle 2",
        "Undo Duplicate Rectangle 2",
        "Redo Duplicate Rectangle 2",
      ]);
      expect(journal?.operations.map(({ expectedRevision }) => expectedRevision)).toEqual([
        initialRevision,
        initialRevision + 1,
        initialRevision + 2,
        initialRevision + 3,
        initialRevision + 4,
      ]);
    });

    expect(
      await screen.findByRole("button", { name: "Rectangle 2 on canvas" }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", {
        name: "Rectangle 2 copy on canvas",
      }),
    ).toBeTruthy();
  });
});
