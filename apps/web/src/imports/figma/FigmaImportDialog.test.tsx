import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FigmaImportDialog } from "./FigmaImportDialog.js";

const localExport = JSON.stringify({
  name: "Checkout system",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [{ id: "1:1", name: "Checkout", type: "CANVAS" }],
  },
});

describe("Figma import dialog", () => {
  it("keeps URL import honest when no Figma credential is configured", () => {
    render(
      <FigmaImportDialog
        onClose={() => undefined}
        onImport={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Figma file URL"), {
      target: {
        value: "https://www.figma.com/design/AbC123xyZ/Checkout",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check Figma URL" }));

    expect(screen.getByRole("status").textContent).toMatch(
      /requires a personal access token/i,
    );
    expect(screen.queryByText(/connected/i)).toBeNull();
  });

  it("imports a pasted local JSON export and returns a normalized document", () => {
    const onImport = vi.fn();
    render(
      <FigmaImportDialog
        onClose={() => undefined}
        onImport={onImport}
      />,
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "Local JSON export" }),
    );
    fireEvent.change(screen.getByLabelText("Figma JSON export"), {
      target: { value: localExport },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Import local Figma JSON" }),
    );

    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: "Checkout system",
        document: expect.objectContaining({
          rootIds: ["figma-1-1"],
        }),
      }),
    );
  });

  it("mounts a fresh file input when switching away from the controlled URL field", () => {
    render(
      <FigmaImportDialog
        onClose={() => undefined}
        onImport={() => undefined}
      />,
    );

    const urlField = screen.getByLabelText("Figma file URL");
    fireEvent.click(
      screen.getByRole("tab", { name: "Local JSON export" }),
    );

    expect(screen.getByLabelText("Choose JSON file")).not.toBe(urlField);
  });

  it("shows bounded validation failures without closing or importing", () => {
    const onImport = vi.fn();
    render(
      <FigmaImportDialog
        onClose={() => undefined}
        onImport={onImport}
      />,
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "Local JSON export" }),
    );
    fireEvent.change(screen.getByLabelText("Figma JSON export"), {
      target: { value: '{"name":"Broken"}' },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Import local Figma JSON" }),
    );

    expect(screen.getByRole("alert").textContent).toMatch(/document/i);
    expect(onImport).not.toHaveBeenCalled();
  });

  it("is keyboard-dismissible and has an accessible modal name", () => {
    const onClose = vi.fn();
    render(
      <FigmaImportDialog onClose={onClose} onImport={() => undefined} />,
    );

    expect(
      screen.getByRole("dialog", { name: "Import from Figma" }),
    ).toBeTruthy();
    fireEvent.keyDown(globalThis.window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
