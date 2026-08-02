import { describe, expect, it } from "vitest";

import { createRepositoryCanvasProject } from "./repository-workbench.js";
import type { RepositoryImportManifest } from "./repository-import.js";

const manifest: RepositoryImportManifest = {
  schemaVersion: 1,
  projectName: "Northstar",
  rootPath: "/Projects/northstar",
  revision: "a1b2c3d4",
  remote: "https://example.com/team/northstar.git",
  platform: "swiftui",
  dirty: false,
  files: [],
  screens: [
    {
      id: "home",
      name: "Home",
      sourcePath: "Northstar/Screens/HomeView.swift",
      route: "HomeView",
    },
    {
      id: "settings",
      name: "Settings",
      sourcePath: "Northstar/Screens/SettingsView.swift",
      route: "SettingsView",
    },
  ],
  components: [
    {
      id: "primary-button",
      name: "Primary button",
      sourcePath: "Northstar/Components/PrimaryButton.swift",
    },
  ],
  tokens: [
    {
      id: "theme",
      name: "Theme",
      sourcePath: "Northstar/Design/Theme.swift",
    },
  ],
};

describe("repository canvas projection", () => {
  it("keeps scan-only routes in metadata and never fabricates screen frames", () => {
    const project = createRepositoryCanvasProject(
      manifest,
      "northstar-import",
      "claude",
    );

    expect(project.title).toBe("Northstar");
    expect(
      project.document.nodes.filter(({ kind }) => kind === "RoutePlaceholder"),
    ).toHaveLength(0);
    expect(
      project.document.nodes.filter(({ kind }) => kind === "Component"),
    ).toHaveLength(1);
    expect(
      project.document.nodes.find(({ name }) => name === "Design system"),
    ).toMatchObject({ kind: "Section", parentId: null });
    expect(
      project.document.nodes.find(({ name }) => name === "Primary button"),
    ).toMatchObject({
      component: {
        atomicLevel: "atom",
        classification: "master",
        componentId: "source:primary-button",
        componentName: "Primary button",
        props: { label: "Primary button" },
        role: "button",
        source: {
          exportName: "Primary button",
          repositoryRevision: "a1b2c3d4",
          sourceAnchor: "Northstar/Components/PrimaryButton.swift",
        },
      },
      parentId: "repository-design-system-northstar-import",
      provenance: {
        sourceAnchor: "Northstar/Components/PrimaryButton.swift",
      },
    });
    expect(
      project.document.nodes.find(({ name }) => name === "Theme"),
    ).toMatchObject({
      kind: "Text",
      parentId: "repository-design-system-northstar-import",
      provenance: {
        sourceAnchor: "Northstar/Design/Theme.swift",
      },
    });
    expect(project.harness.selectedId).toBe("claude");
    expect(project.repositoryCatalog?.routes).toHaveLength(2);
    expect(JSON.stringify(project)).not.toMatch(/buzzr/iu);
  });
});
