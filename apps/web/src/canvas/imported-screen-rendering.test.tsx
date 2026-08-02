import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { createCanvasWorkbenchV3TestSession } from "./canvas-workbench-v3-test-session.js";
import type { CanvasWorkbenchProject, WorkbenchNode } from "./model.js";
import { composeImportedMobileScreen } from "./imported-screen-composition.js";

const source = {
  coverageCellId: "games:mobile",
  repositoryRevision: "buzzr@abc123",
  routeId: "games",
  sourceAnchor: "app/(protected)/(tabs)/games.tsx",
  stateId: "games:default",
  viewport: { height: 844, name: "mobile" as const, width: 390 },
};
const frame: WorkbenchNode = {
  fill: "#08090a",
  hidden: false,
  id: "screen-games",
  kind: "CodeFrame",
  locked: false,
  name: "Games",
  parentId: null,
  position: { x: 120, y: 80 },
  size: { height: 844, width: 390 },
  source,
};
const semanticNodes: readonly WorkbenchNode[] = [
  {
    component: {
      atomicLevel: "organism",
      classification: "master",
      componentId: "buzzr.game-card",
      componentName: "GameCard",
      editable: {
        icon: false,
        label: true,
        selected: false,
        variant: true,
      },
      props: {
        label: "MLB",
        supportingText: "30 teams · 2 live",
        status: "LIVE",
        items: [
          {
            label: "Yankees vs Rays",
            supportingText: "Today · 6:05 PM",
            status: "LIVE",
          },
          {
            label: "Dodgers vs Padres",
            supportingText: "Today · 9:10 PM",
          },
        ],
      },
      role: "card",
      source: {
        repositoryRevision: source.repositoryRevision,
        sourceAnchor: "components/games/GameCard.tsx",
      },
    },
    fill: "#111212",
    hidden: false,
    id: "game-card",
    kind: "ComponentInstance",
    locked: false,
    name: "GameCard",
    parentId: frame.id,
    position: { x: 144, y: 240 },
    size: { height: 180, width: 342 },
  },
  {
    fill: "#f7f8f8",
    hidden: false,
    id: "game-title",
    kind: "Text",
    locked: false,
    name: "Game title",
    parentId: frame.id,
    position: { x: 160, y: 260 },
    size: { height: 24, width: 220 },
    text: "Lakers vs Celtics",
  },
];
const nodes = composeImportedMobileScreen({
  capture: {
    alt: "Buzzr Games runtime",
    appVersion: "2.1",
    assetPath: "/imports/buzzr-runtime/games-default.png",
    authority: "Buzzr runtime capture",
    accessibilitySnapshotRef: "artifact://buzzr/games.a11y.json",
    capturedAt: "2026-07-29T19:00:00.000Z",
    componentIds: ["buzzr.game-card"],
    gitSha: "abc123",
    height: 800,
    id: "capture-games",
    routeId: "games",
    screenId: "screen-games",
    screenshotSha256: "a".repeat(64),
    sourceAnchors: ["app/(protected)/(tabs)/games.tsx"],
    sourceUrl: "memi-source://repository/app/games.tsx",
    width: 368,
  },
  frame,
  semanticNodes,
});
const project: CanvasWorkbenchProject = {
  document: { id: "buzzr-mobile", nodes, revision: 1 },
  harness: { options: [{ id: "codex", label: "Codex" }], selectedId: "codex" },
  id: "buzzr-mobile",
  selectedNodeId: frame.id,
  title: "Buzzr mobile",
  trace: [],
};

function viewport(): HTMLElement {
  return screen.getByRole("region", { name: "Infinite canvas" });
}

describe("evidence-backed editable screen rendering", () => {
  it("renders the editable reconstruction while evidence remains hidden", async () => {
    render(
      <CanvasWorkbench
        project={project}
        v3Session={createCanvasWorkbenchV3TestSession(project)}
      />,
    );
    await screen.findByRole("region", { name: "Infinite canvas" });

    expect(
      screen.queryByRole("img", { name: "Buzzr Games runtime" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Games runtime reference on canvas",
      }),
    ).toBeNull();

    const card = screen
      .getByRole("button", { name: "GameCard on canvas" })
      .closest("[data-node-id]");
    expect(card?.getAttribute("data-semantic-overlay")).toBe("false");
    expect(within(card as HTMLElement).getByText("MLB")).toBeTruthy();
  });

  it("groups, context-selects, and transforms editable layers without changing evidence", async () => {
    const onSceneChange = vi.fn();
    render(
      <CanvasWorkbench
        onSceneChange={onSceneChange}
        project={project}
        v3Session={createCanvasWorkbenchV3TestSession(project)}
      />,
    );
    await screen.findByRole("region", { name: "Infinite canvas" });
    const card = screen.getByRole("button", { name: "GameCard on canvas" });
    const title = screen.getByRole("button", { name: "Game title on canvas" });

    fireEvent.contextMenu(card, { clientX: 300, clientY: 240 });
    expect(
      screen.getByRole("menu", { name: "Canvas selection actions" }),
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(card);
    fireEvent.click(title, { shiftKey: true });
    fireEvent.keyDown(document, { key: "g", metaKey: true });
    const group = await screen.findByRole("button", { name: "Group 1 on canvas" });
    expect(
      screen
        .getByRole("button", { name: "GameCard on canvas" })
        .closest("[data-node-id]")
        ?.getAttribute("data-semantic-overlay"),
    ).toBe("false");
    fireEvent.pointerDown(group, {
      button: 0,
      clientX: 160,
      clientY: 240,
      pointerId: 73,
    });
    fireEvent.pointerMove(viewport(), {
      buttons: 1,
      clientX: 200,
      clientY: 280,
      pointerId: 73,
    });
    fireEvent.pointerUp(viewport(), {
      button: 0,
      clientX: 200,
      clientY: 280,
      pointerId: 73,
    });

    expect(
      screen.queryByRole("button", {
        name: "Games runtime reference on canvas",
      }),
    ).toBeNull();
    expect(
      group.closest<HTMLElement>("[data-node-id]")?.style.left,
    ).not.toBe("0px");
  });

  it("edits the reconstruction and restores authored values on undo", async () => {
    render(
      <CanvasWorkbench
        project={project}
        v3Session={createCanvasWorkbenchV3TestSession(project)}
      />,
    );
    await screen.findByRole("region", { name: "Infinite canvas" });
    const card = screen.getByRole("button", {
      name: "GameCard on canvas",
    });

    expect(
      card.closest("[data-node-id]")?.getAttribute(
        "data-semantic-overlay",
      ),
    ).toBe("false");
    expect(within(card).getByText("MLB")).toBeTruthy();
    expect(
      screen.queryByRole("img", { name: "Buzzr Games runtime" }),
    ).toBeNull();

    fireEvent.click(card);
    fireEvent.change(screen.getByLabelText("Fill color"), {
      target: { value: "#ff5470" },
    });

    expect(within(card).getByText("MLB")).toBeTruthy();
    expect(within(card).getByText("30 teams · 2 live")).toBeTruthy();
    expect(within(card).getByText("Yankees vs Rays")).toBeTruthy();
    expect(within(card).getByText("Today · 6:05 PM")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(within(card).getByText("MLB")).toBeTruthy();

    const title = screen.getByRole("button", {
      name: "Game title on canvas",
    });
    fireEvent.click(title);
    fireEvent.change(screen.getByLabelText("Text content"), {
      target: { value: "Edited matchup" },
    });
    fireEvent.blur(screen.getByLabelText("Text content"));

    expect(await within(title).findByText("Edited matchup")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => {
      expect(within(title).queryByText("Edited matchup")).toBeNull();
      expect(within(title).getByText("Lakers vs Celtics")).toBeTruthy();
    });
  });
});
