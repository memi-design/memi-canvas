import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CanvasNodeView, Inspector } from "./parts.js";
import type { WorkbenchNode } from "./model.js";

const referenceNode: WorkbenchNode = {
  id: "runtime-reference-screen",
  kind: "ReferenceFrame",
  name: "Imported product screen",
  parentId: null,
  position: { x: 120, y: 160 },
  size: { width: 600, height: 1_299 },
  locked: true,
  hidden: false,
  reference: {
    alt: "Verified runtime screenshot for an imported product",
    appVersion: "fixture",
    authority: "Runtime evidence",
    capturedAt: "2026-07-29T02:46:14Z",
    sourceUrl: "memi-source://repository/app/screens/Home.tsx",
    src: "/fixtures/reference/product-screen.png",
  },
};

describe("production reference frames", () => {
  it("renders the real image without claiming that it is editable source", () => {
    render(
      <CanvasNodeView
        node={referenceNode}
        onPointerDown={vi.fn()}
        onResizePointerDown={vi.fn()}
        onSelect={vi.fn()}
        selected
      />,
    );

    const image = screen.getByRole("img", {
      name: "Verified runtime screenshot for an imported product",
    });
    expect(image.getAttribute("src")).toBe(
      "/fixtures/reference/product-screen.png",
    );
    expect(screen.getByText("Production reference")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: /Resize Imported product screen/,
      }),
    ).toBeNull();
  });

  it("exposes version and immutable authority in the inspector", () => {
    render(
      <Inspector
        node={referenceNode}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onDetach={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );

    const inspector = screen.getByRole("region", { name: "Inspector" });
    expect(within(inspector).getByText("Production reference")).toBeTruthy();
    expect(
      within(inspector).getByText("Runtime evidence · fixture"),
    ).toBeTruthy();
    expect(
      within(inspector).getByRole("link", { name: "Open source evidence" }),
    ).toBeTruthy();
    expect(
      within(inspector).queryByRole("textbox", { name: "Name" }),
    ).toBeNull();
  });
});
