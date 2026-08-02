import { describe, expect, it } from "vitest";

import { createRepositoryCanvasProject } from "../imports/repository/repository-workbench.js";
import { sourceProjectFixture } from "./source-project.fixture.js";
import {
  buildProductMap,
  filterProductMap,
} from "./product-map.js";

describe("Product Map", () => {
  it("lists source-derived components and tokens before runtime screen capture", () => {
    const project = createRepositoryCanvasProject(
      {
        schemaVersion: 1,
        projectName: "Northstar",
        rootPath: "/Projects/northstar",
        revision: "a1b2c3d4",
        platform: "react-native-expo",
        dirty: false,
        files: [],
        screens: [],
        components: [
          {
            id: "primary-button",
            name: "Primary button",
            sourcePath: "components/ui/PrimaryButton.tsx",
          },
        ],
        tokens: [
          {
            id: "theme-colors",
            name: "Colors",
            sourcePath: "src/theme/colors.ts",
          },
        ],
      },
      "northstar-import",
      "codex",
    );

    const map = buildProductMap(project);
    const components = map.groups.find(({ id }) => id === "components")?.items;
    const tokens = map.groups.find(({ id }) => id === "tokens")?.items;

    expect(components).toEqual([
      expect.objectContaining({
        authority: "source-owned",
        label: "Primary button",
        nodeId: "repository-component-primary-button",
        sourcePath: "components/ui/PrimaryButton.tsx",
        status: "fresh",
        supportingText: "atom · button",
      }),
    ]);
    expect(tokens).toEqual([
      expect.objectContaining({
        authority: "source-owned",
        label: "Colors",
        nodeId: "repository-token-theme-colors",
        sourcePath: "src/theme/colors.ts",
        status: "fresh",
        supportingText: "Declared source token",
      }),
    ]);
  });

  it("projects repository truth into bounded product categories", () => {
    const map = buildProductMap(sourceProjectFixture);

    expect(map.groups.map(({ label }) => label)).toEqual([
      "Routes",
      "Screen families",
      "Components",
      "Tokens",
      "Flows",
      "Evidence",
      "Findings",
    ]);
    expect(
      map.groups.find(({ id }) => id === "components")?.count,
    ).toBeGreaterThan(0);
    expect(map.totalCount).toBe(
      map.groups.reduce((total, group) => total + group.count, 0),
    );
  });

  it("links every route inventory item to an on-canvas mobile route", () => {
    const map = buildProductMap(sourceProjectFixture);
    const items = map.groups.flatMap(({ items }) => items);
    const routes = items.filter(({ category }) => category === "routes");
    const evidence = items.filter(({ category }) => category === "evidence");

    expect(routes).toHaveLength(2);
    expect(routes.every(({ nodeId }) => nodeId !== undefined)).toBe(true);
    expect(routes.some(({ authority }) => authority === "source-owned"))
      .toBe(true);
    expect(routes.some(({ status }) => status === "placeholder")).toBe(true);
    expect(routes.every(({ status }) => status !== "stale")).toBe(true);
    expect(
      routes.every(
        ({ nodeId }) =>
          ["CodeFrame", "RoutePlaceholder"].includes(
            sourceProjectFixture.document.nodes.find(
              ({ id }) => id === nodeId,
            )?.kind ?? "",
          ),
      ),
    ).toBe(true);
    expect(evidence).toHaveLength(0);
    expect(
      items.some(
        ({ authority, sourcePath }) =>
          authority === "source-owned" &&
          sourcePath?.includes("Button"),
      ),
    ).toBe(true);
  });

  it("projects the current trace into reviewable findings", () => {
    const traceItem = {
      action: "Runtime capture failed for /dashboard",
      id: "workbench-trace-live-failure",
      targetNodeId: "northstar-home",
    };
    const map = buildProductMap({
      ...sourceProjectFixture,
      trace: [...sourceProjectFixture.trace, traceItem],
    });
    const findings = map.groups.find(({ id }) => id === "findings");

    expect(findings?.items).toContainEqual(
      expect.objectContaining({
        id: `finding-${traceItem.id}`,
        label: traceItem.action,
        nodeId: traceItem.targetNodeId,
        status: "blocked",
      }),
    );
  });

  it("searches and filters by label, category, authority, and status", () => {
    const map = buildProductMap(sourceProjectFixture);
    const result = filterProductMap(map, {
      authority: "source-owned",
      category: "components",
      query: "button",
      status: "fresh",
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.id).toBe("components");
    expect(result.groups[0]?.items.length).toBeGreaterThan(0);
    expect(
      result.groups[0]?.items.every(
        ({ authority, label, sourcePath, status }) =>
          authority === "source-owned" &&
          `${label} ${sourcePath ?? ""}`.toLowerCase().includes("button") &&
          status === "fresh",
      ),
    ).toBe(true);
  });
});
