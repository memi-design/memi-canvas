import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CanvasSidebar } from "./CanvasSidebar.js";

const navigation = {
  activePageId: "page-one",
  onCreatePage: vi.fn(),
  onSelectPage: vi.fn(),
  pages: [{ id: "page-one", kind: "local" as const, name: "Page one" }],
};

const productMap = {
  groups: [],
  projectId: "project-one",
  totalCount: 0,
};

describe("CanvasSidebar", () => {
  it("keeps icon-first workspace views named and exposes an accessible empty layer state", () => {
    render(
      <CanvasSidebar
        initialMode="layers"
        navigation={navigation}
        nodes={[]}
        onSelectNode={vi.fn()}
        productMap={productMap}
        selectedNodeId={null}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe("No layers");
    const assets = screen.getByRole("button", { name: "Assets" });
    expect(assets.getAttribute("data-tooltip")).toBe("Assets");
    fireEvent.click(assets);
    expect(screen.getByText("No components")).toBeTruthy();
  });
});
