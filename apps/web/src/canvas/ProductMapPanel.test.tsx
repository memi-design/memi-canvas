import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { sourceProjectFixture } from "./source-project.fixture.js";
import { buildProductMap } from "./product-map.js";
import { ProductMapPanel } from "./ProductMapPanel.js";

describe("ProductMapPanel", () => {
  it("shows grouped authority instead of a flat node dump", () => {
    render(
      <ProductMapPanel
        map={buildProductMap(sourceProjectFixture)}
        onSelectNode={vi.fn()}
        selectedNodeId={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "Product Map" })).toBeTruthy();
    expect(screen.getByText("Routes")).toBeTruthy();
    expect(screen.getByText("Components")).toBeTruthy();
    expect(screen.getAllByText("Evidence").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("list", { name: "Workspace files" }),
    ).toBeNull();
    expect(
      screen.getByRole("group", { name: "Product Map filters" }),
    ).toBeTruthy();
    expect(screen.getByText("Repository")).toBeTruthy();
  });

  it("searches source-backed components and selects their canvas node", () => {
    const onSelectNode = vi.fn();
    render(
      <ProductMapPanel
        map={buildProductMap(sourceProjectFixture)}
        onSelectNode={onSelectNode}
        selectedNodeId={null}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Button / Primary" },
    });
    const results = screen.getByRole("list", {
      name: "Product Map Components",
    });
    const button = within(results).getByRole("button", {
      name: /Button \/ Primary/i,
    });
    expect(button.getAttribute("title")).toMatch(/source-owned/i);
    expect(button.getAttribute("title")).toMatch(/fresh/i);
    fireEvent.click(button);
    expect(onSelectNode).toHaveBeenCalledWith(
      "northstar-button-primary-master",
    );
  });
});
