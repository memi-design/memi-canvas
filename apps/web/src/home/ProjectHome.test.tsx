import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ProjectHome,
  type HomeProject,
  type ProjectHomeProps,
} from "./ProjectHome.js";

const projects: readonly HomeProject[] = [
  {
    id: "buzzr",
    kind: "design",
    name: "Buzzr product",
    provenance: {
      detail: "App Store + local repository",
      label: "Verified import",
    },
    status: "attention",
    thumbnail: {
      alt: "Buzzr product generative project pattern",
      countLabel: "71 routes",
      coverage: {
        captured: 5,
        scenarios: 116,
      },
      presentation: "generative-pattern",
    },
    updatedAt: "2026-07-28T16:00:00.000Z",
    updatedLabel: "Edited today",
  },
  {
    id: "journey",
    kind: "whiteboard",
    name: "First-run journey",
    provenance: {
      detail: "Local workspace",
      label: "Local",
    },
    status: "draft",
    updatedAt: "2026-07-27T16:00:00.000Z",
    updatedLabel: "Edited yesterday",
  },
  {
    id: "archive",
    kind: "design",
    name: "Archive concepts",
    provenance: {
      detail: "Local workspace",
      label: "Local",
    },
    status: "attention",
    updatedAt: "2026-07-01T16:00:00.000Z",
    updatedLabel: "Edited Jul 1",
  },
];

const fourthProject: HomeProject = {
  id: "systems",
  kind: "design",
  name: "System library",
  provenance: {
    detail: "Local workspace",
    label: "Local",
  },
  status: "syncing",
  updatedAt: "2026-06-20T16:00:00.000Z",
  updatedLabel: "Edited Jun 20",
};

function homeProps(
  overrides: Partial<ProjectHomeProps> = {},
): ProjectHomeProps {
  return {
    onCreateProject: vi.fn(),
    onImportProject: vi.fn(),
    onOpenProject: vi.fn(),
    projects,
    userName: "Sarvesh",
    workspaceName: "Memi Studio",
    ...overrides,
  };
}

describe("ProjectHome", () => {
  it("uses the shipped Icon Composer artwork across native and web branding", () => {
    const iconDocument = JSON.parse(
      readFileSync(
        resolve(
          "apps/macos/src-tauri/icons/source/MemiCanvas-Iteration-02.icon/icon.json",
        ),
        "utf8",
      ),
    ) as {
      readonly groups: readonly [{ readonly name: string }];
    };
    const nativePng = readFileSync(
      resolve("apps/macos/src-tauri/icons/icon.png"),
    );
    const webPng = readFileSync(
      resolve("apps/web/public/memi-canvas-icon.png"),
    );
    const nativeIcns = readFileSync(
      resolve("apps/macos/src-tauri/icons/icon.icns"),
    );
    const webDocument = readFileSync(resolve("apps/web/index.html"), "utf8");

    expect(iconDocument.groups[0].name).toBe(
      "Memi Canvas — Iteration 02 Single Heart",
    );
    expect(nativePng.readUInt32BE(16)).toBe(512);
    expect(nativePng.readUInt32BE(20)).toBe(512);
    expect(createHash("sha256").update(nativePng).digest("hex")).toBe(
      "da068f20ba9e0e43f59ebde8602b43342f8c77fef2c080155a18d5a8fd0e25c2",
    );
    expect(webPng.equals(nativePng)).toBe(true);
    expect(nativeIcns.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(webDocument).toContain(
      '<link rel="icon" type="image/png" href="/memi-canvas-icon.png" />',
    );
    expect(webDocument).toContain(
      '<link rel="apple-touch-icon" href="/memi-canvas-icon.png" />',
    );
  });

  it("edits the local workspace identity from the profile control", () => {
    const onProfileChange = vi.fn();
    render(<ProjectHome {...homeProps({ onProfileChange })} />);

    fireEvent.click(screen.getByRole("button", { name: "Open profile" }));
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Sarvesh" },
    });
    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Product Studio" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(onProfileChange).toHaveBeenCalledWith({
      userName: "Sarvesh",
      workspaceName: "Product Studio",
    });
    expect(screen.queryByRole("dialog", { name: "Workspace profile" })).toBeNull();
  });

  it("presents the app icon and compact project metadata as one hierarchy", () => {
    render(<ProjectHome {...homeProps()} />);

    const brandIcon = document.querySelector<HTMLImageElement>(
      ".project-home-brand__icon",
    );
    const buzzr = screen.getByRole("button", {
      name: /Open Buzzr product/,
    });
    const localDraft = screen.getByRole("button", {
      name: /Open First-run journey/,
    });

    expect(brandIcon?.getAttribute("src")).toBe("/memi-canvas-icon.png");
    expect(brandIcon?.getAttribute("alt")).toBe("");
    expect(buzzr.getAttribute("data-project-kind")).toBe("design");
    expect(buzzr.getAttribute("data-project-status")).toBe("attention");
    expect(buzzr.querySelectorAll("img")).toHaveLength(0);
    expect(
      buzzr.querySelector(".project-preview-pattern"),
    ).toBeTruthy();
    expect(within(buzzr).queryByText("Coverage partial")).toBeNull();
    expect(within(buzzr).getByText("71 routes")).toBeTruthy();
    expect(within(buzzr).getByText("Edited today · 116 mobile states"))
      .toBeTruthy();
    expect(within(buzzr).getByText("5 of 116 runtime captures")).toBeTruthy();
    expect(
      within(buzzr)
        .getByRole("progressbar", { name: /screen capture progress/ })
        .getAttribute("max"),
    ).toBe("116");
    expect(
      within(buzzr).getByText("App Store + local repository").getAttribute(
        "title",
      ),
    ).toBe("App Store + local repository");
    expect(
      within(buzzr).getByText(/^Edited today/).closest("time")?.getAttribute(
        "dateTime",
      ),
    ).toBe("2026-07-28T16:00:00.000Z");
    expect(within(localDraft).queryByText("Draft")).toBeNull();
    expect(
      readFileSync(
        resolve("apps/web/src/home/project-home.css"),
        "utf8",
      ),
    ).toContain("aspect-ratio: 16 / 9");
  });

  it("removes grid preview sizing constraints in compact list cards", () => {
    const styles = readFileSync(
      resolve("apps/web/src/home/project-home.css"),
      "utf8",
    );
    const listPreviewRule =
      styles.match(
        /\.project-home-grid--list \.project-home-card__preview\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(listPreviewRule).toContain("aspect-ratio: auto");
    expect(listPreviewRule).toContain("min-height: 0");
    expect(listPreviewRule).toContain("max-height: none");
    expect(listPreviewRule).toContain("width: 100%");
  });

  it("lets shader previews fill responsive card tracks without a dead column", () => {
    const styles = readFileSync(
      resolve("apps/web/src/home/project-home.css"),
      "utf8",
    );
    const previewRule =
      styles.match(/\.project-home-card__preview\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(previewRule).toContain("width: 100%");
    expect(previewRule).toContain("aspect-ratio: 16 / 9");
    expect(previewRule).toContain("min-height: 0");
    expect(previewRule).toContain("max-height: none");
  });

  it("keeps recent cards at a stable default footprint instead of promoting a lone card", () => {
    const styles = readFileSync(
      resolve("apps/web/src/home/project-home.css"),
      "utf8",
    );
    const gridRule =
      styles.match(/\.project-home-grid\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(gridRule).toContain(
      "grid-template-columns: repeat(auto-fill, minmax(280px, 340px))",
    );
    expect(gridRule).toContain("gap: 12px");
    expect(gridRule).toContain("align-items: start");
    expect(styles).not.toContain(
      ".project-home-grid > li:last-child:nth-child(3n + 1)",
    );
    expect(styles).toContain(
      ".project-home-grid--list > li {\n  max-inline-size: none;",
    );
  });

  it("renders a project launcher with recent work sorted by actual recency", () => {
    render(<ProjectHome {...homeProps()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Recent work" }),
    ).toBeTruthy();
    const grid = screen.getByRole("list", { name: "Recent projects" });
    expect(grid.getAttribute("data-project-count")).toBe("3");
    const cards = within(grid).getAllByRole("button");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      expect.stringContaining("Buzzr product"),
      expect.stringContaining("First-run journey"),
      expect.stringContaining("Archive concepts"),
    ]);
    expect(within(cards[0]!).getByText("Verified import")).toBeTruthy();
    expect(
      within(cards[0]!).getByText("App Store + local repository"),
    ).toBeTruthy();
  });

  it("uses a document-derived preview when no runtime capture is available", () => {
    render(<ProjectHome {...homeProps()} />);

    const archive = screen.getByRole("button", {
      name: /Open Archive concepts/,
    });
    expect(archive.querySelector("img")).toBeNull();
    expect(
      archive.querySelector("[data-preview-source='document']"),
    ).toBeTruthy();
  });

  it("creates distinct design and whiteboard projects", () => {
    const onCreateProject = vi.fn();
    render(<ProjectHome {...homeProps({ onCreateProject })} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Create design project" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create whiteboard project" }),
    );

    expect(onCreateProject.mock.calls).toEqual([["design"], ["whiteboard"]]);
  });

  it("opens projects and supports spatial keyboard movement across cards", () => {
    const onOpenProject = vi.fn();
    render(<ProjectHome {...homeProps({ onOpenProject })} />);

    const buzzr = screen.getByRole("button", {
      name: /Open Buzzr product/,
    });
    const journey = screen.getByRole("button", {
      name: /Open First-run journey/,
    });
    buzzr.focus();
    fireEvent.keyDown(buzzr, { key: "ArrowRight" });
    expect(document.activeElement).toBe(journey);

    fireEvent.keyDown(journey, { key: "Enter" });
    expect(onOpenProject).toHaveBeenCalledWith("journey");
  });

  it("uses the rendered column count for vertical project navigation", () => {
    render(
      <ProjectHome
        {...homeProps({ projects: [...projects, fourthProject] })}
      />,
    );

    const grid = screen.getByRole("list", { name: "Recent projects" });
    grid.style.setProperty("--project-grid-columns", "2");
    const buzzr = screen.getByRole("button", {
      name: /Open Buzzr product/,
    });
    const archive = screen.getByRole("button", {
      name: /Open Archive concepts/,
    });
    buzzr.focus();
    fireEvent.keyDown(buzzr, { key: "ArrowDown" });

    expect(document.activeElement).toBe(archive);
  });

  it("honors the command keys advertised by the launcher", () => {
    const onCreateProject = vi.fn();
    render(<ProjectHome {...homeProps({ onCreateProject })} />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole("searchbox", { name: "Search projects" }),
    );

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    fireEvent.keyDown(window, {
      key: "n",
      metaKey: true,
      shiftKey: true,
    });
    expect(onCreateProject.mock.calls).toEqual([["design"], ["whiteboard"]]);
  });

  it("switches between Recents, Projects, and Templates without hiding creation", () => {
    const onCreateLandingPageDemo = vi.fn();
    render(<ProjectHome {...homeProps({ onCreateLandingPageDemo })} />);

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "All projects" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Start from a template" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create design project" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create whiteboard project" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Landing page demo" }),
    );
    expect(onCreateLandingPageDemo).toHaveBeenCalledTimes(1);
  });

  it("filters projects by name and presents a useful empty result", () => {
    render(<ProjectHome {...homeProps()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), {
      target: { value: "buzz" },
    });
    expect(
      screen.getByRole("button", { name: /Open Buzzr product/ }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Open First-run journey/ }),
    ).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), {
      target: { value: "missing" },
    });
    expect(screen.getByText("No projects match “missing”")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Clear project search" }),
    ).toBeTruthy();
  });

  it("keeps import and settings actions explicit", () => {
    const onImportProject = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <ProjectHome
        {...homeProps({ onImportProject, onOpenSettings })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Import project" }));
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));

    expect(onImportProject).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("uses the shared neutral Studio tokens and ruby as the product accent", () => {
    const tokens = readFileSync(
      resolve("apps/web/src/theme/studio-tokens.css"),
      "utf8",
    );

    expect(tokens).toContain("--studio-color-surface-canvas: oklch(");
    expect(tokens).toContain(
      "--studio-surface-canvas: var(--studio-color-surface-canvas)",
    );
    expect(tokens).toContain(
      "--studio-surface-panel: var(--studio-color-surface-panel)",
    );
    expect(tokens).toContain(
      "--studio-surface-raised: var(--studio-color-surface-raised)",
    );
    expect(tokens).toContain(
      "--studio-border-subtle: var(--studio-color-border-subtle)",
    );
    expect(tokens).toContain(
      "--studio-border-strong: var(--studio-color-border-strong)",
    );
    expect(tokens).toContain(
      "--studio-ink-primary: var(--studio-color-ink-primary)",
    );
    expect(tokens).toContain(
      "--studio-accent: var(--studio-color-accent)",
    );
    expect(tokens).toContain(
      "--studio-accent-soft: var(--studio-color-accent-soft)",
    );
    expect(tokens).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expect(tokens).toContain("Inter Variable");
    expect(tokens).not.toContain("Berkeley Mono");
  });

  it("offers compact design, whiteboard, repository, and Figma import actions", () => {
    const onCreateProject = vi.fn();
    const onImportProject = vi.fn();
    const onImportFigma = vi.fn();
    render(
      <ProjectHome
        {...homeProps({
          onCreateProject,
          onImportFigma,
          onImportProject,
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Create design project" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create whiteboard project" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import project" }));
    fireEvent.click(screen.getByRole("button", { name: "Import from Figma" }));

    expect(onCreateProject.mock.calls).toEqual([["design"], ["whiteboard"]]);
    expect(onImportProject).toHaveBeenCalledOnce();
    expect(onImportFigma).toHaveBeenCalledOnce();
  });

  it("switches project density and sorts without mutating the input", () => {
    const input = [...projects];
    render(<ProjectHome {...homeProps({ projects: input })} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Sort projects" }), {
      target: { value: "name" },
    });
    expect(
      within(screen.getByRole("list", { name: "Recent projects" }))
        .getAllByRole("button")
        .map((card) => card.getAttribute("aria-label")),
    ).toEqual([
      expect.stringContaining("Archive concepts"),
      expect.stringContaining("Buzzr product"),
      expect.stringContaining("First-run journey"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(
      screen.getByRole("list", { name: "Recent projects" }).className,
    ).toContain("project-home-grid--list");
    expect(input).toEqual(projects);
  });

  it("opens a project context menu and routes durable project actions", () => {
    const onProjectAction = vi.fn();
    render(<ProjectHome {...homeProps({ onProjectAction })} />);

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /Open Buzzr product/ }),
    );
    const menu = screen.getByRole("menu", {
      name: "Buzzr product actions",
    });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Duplicate" }));

    expect(onProjectAction).toHaveBeenCalledWith("buzzr", "duplicate");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("names destructive deletion truthfully", () => {
    const onProjectAction = vi.fn();
    render(
      <ProjectHome
        {...homeProps({
          enabledProjectActions: ["delete"],
          onProjectAction,
        })}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /Open Buzzr product/ }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Delete permanently" }),
    );

    expect(onProjectAction).toHaveBeenCalledWith("buzzr", "delete");
  });

  it("supports a complete neutral light counterpart", () => {
    render(<ProjectHome {...homeProps()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Switch to light theme" }),
    );
    expect(screen.getByTestId("project-home").getAttribute("data-theme")).toBe(
      "light",
    );
    expect(document.documentElement.dataset.studioTheme).toBe("light");
    expect(
      screen.getByRole("button", { name: "Switch to dark theme" }),
    ).toBeTruthy();
  });
});
