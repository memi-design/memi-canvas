import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { createCanvasWorkbenchV3TestSession } from "./canvas-workbench-v3-test-session.js";
import type {
  CanvasWorkbenchProject,
  WorkbenchNode,
} from "./model.js";
import { Layers } from "./parts.js";

const source = {
  coverageCellId: "games:mobile",
  repositoryRevision: "buzzr@abc123",
  routeId: "games",
  sourceAnchor: "app/(protected)/(tabs)/games.tsx",
  stateId: "games:default",
  viewport: { height: 800, name: "mobile" as const, width: 368 },
};

const nodes: readonly WorkbenchNode[] = [
  {
    fill: "#08090a",
    hidden: false,
    id: "screen-games",
    kind: "CodeFrame",
    locked: false,
    name: "Games",
    parentId: null,
    position: { x: 120, y: 80 },
    size: { height: 800, width: 368 },
    source,
  },
  {
    hidden: false,
    id: "capture-games",
    kind: "ReferenceFrame",
    locked: true,
    name: "Games runtime reference",
    parentId: "screen-games",
    position: { x: 120, y: 80 },
    reference: {
      alt: "Buzzr Games runtime",
      appVersion: "2.1",
      authority: "Buzzr runtime capture",
      capturedAt: "2026-07-29T19:00:00.000Z",
      sourceUrl: "memi-source://repository/app/games.tsx",
      src: "/imports/buzzr-runtime/games-default.png",
    },
    size: { height: 800, width: 368 },
  },
  {
    hidden: false,
    id: "games-list",
    kind: "Group",
    locked: false,
    name: "Games list",
    parentId: "screen-games",
    position: { x: 136, y: 224 },
    provenance: {
      coverageCellId: source.coverageCellId,
      repositoryRevision: source.repositoryRevision,
      routeId: source.routeId,
      sourceAnchor: source.sourceAnchor,
      stateId: source.stateId,
    },
    size: { height: 260, width: 336 },
  },
  {
    fill: "#111212",
    hidden: false,
    id: "game-card",
    kind: "Rectangle",
    locked: false,
    name: "Game card",
    parentId: "games-list",
    position: { x: 144, y: 240 },
    provenance: {
      coverageCellId: source.coverageCellId,
      repositoryRevision: source.repositoryRevision,
      routeId: source.routeId,
      sourceAnchor: "components/games/GameCard.tsx",
      stateId: source.stateId,
    },
    size: { height: 180, width: 320 },
  },
];

const detachedEvidenceNodes: readonly WorkbenchNode[] = [
  {
    fill: "#08090a",
    hidden: false,
    id: "editable-games",
    kind: "Frame",
    locked: false,
    name: "Games reconstruction",
    parentId: null,
    position: { x: 560, y: 80 },
    provenance: {
      captureState: "captured",
      coverageCellId: source.coverageCellId,
      repositoryRevision: source.repositoryRevision,
      routeId: source.routeId,
      sourceAnchor: source.sourceAnchor,
      stateId: source.stateId,
    },
    size: { height: 800, width: 368 },
  },
  {
    hidden: true,
    id: "detached-games-evidence",
    kind: "ReferenceFrame",
    locked: true,
    name: "Games evidence",
    parentId: null,
    position: { x: 560, y: 80 },
    provenance: {
      captureState: "captured",
      coverageCellId: source.coverageCellId,
      repositoryRevision: source.repositoryRevision,
      routeId: source.routeId,
      sourceAnchor: source.sourceAnchor,
      stateId: source.stateId,
    },
    reference: {
      alt: "Buzzr Games evidence",
      appVersion: "2.1",
      authority: "Buzzr runtime capture",
      capturedAt: "2026-07-29T19:00:00.000Z",
      sourceUrl: "memi-source://repository/app/games.tsx",
      src: "/imports/buzzr-runtime/games-default.png",
    },
    size: { height: 800, width: 368 },
  },
  {
    fill: "#111212",
    hidden: false,
    id: "editable-game-card",
    kind: "Rectangle",
    locked: false,
    name: "Editable game card",
    parentId: "editable-games",
    position: { x: 576, y: 240 },
    provenance: {
      captureState: "captured",
      coverageCellId: source.coverageCellId,
      repositoryRevision: source.repositoryRevision,
      routeId: source.routeId,
      sourceAnchor: "components/games/GameCard.tsx",
      stateId: source.stateId,
    },
    size: { height: 180, width: 336 },
  },
];

const project: CanvasWorkbenchProject = {
  document: {
    id: "buzzr-imported-layers",
    nodes,
    revision: 1,
  },
  harness: {
    options: [{ id: "codex", label: "Codex" }],
    selectedId: "codex",
  },
  id: "buzzr-imported-layers",
  selectedNodeId: "screen-games",
  title: "Buzzr mobile",
  trace: [],
};

describe("screenshot-backed imported screen layers", () => {
  it("groups an editable provenance-linked reconstruction and detached evidence under its imported route", () => {
    render(
      <Layers
        nodes={detachedEvidenceNodes}
        onSelect={vi.fn()}
        selectedNodeId="editable-games"
      />,
    );

    expect(
      screen.getByRole("treeitem", { name: "Route inventory" }),
    ).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "Drafts" })).toBeNull();
    const reconstruction = screen.getByRole("treeitem", {
      name: "Games reconstruction Frame",
    });
    expect(reconstruction.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(reconstruction)
        .getAllByRole("treeitem")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual([
      "Editable game card Rectangle",
      "Games evidence ReferenceFrame Locked reference",
    ]);
  });

  it("projects the imported frame as an ordered hierarchy with a locked reference", () => {
    render(
      <Layers
        nodes={nodes}
        onSelect={vi.fn()}
        selectedNodeId="screen-games"
      />,
    );

    const frame = screen.getByRole("treeitem", {
      name: "Games CodeFrame",
    });
    expect(frame.getAttribute("aria-expanded")).toBe("true");

    const descendants = within(frame).getAllByRole("treeitem");
    expect(
      descendants.map((item) => item.getAttribute("aria-label")),
    ).toEqual([
      "Games runtime reference ReferenceFrame Locked reference",
      "Games list Group",
      "Game card Rectangle",
    ]);
    expect(descendants[0]?.getAttribute("aria-disabled")).toBe("true");
    expect(within(descendants[0]!).getByText("Reference")).toBeTruthy();
  });

  it("supports expansion and nested keyboard navigation and selection", () => {
    const onSelect = vi.fn();
    render(
      <Layers
        nodes={nodes}
        onSelect={onSelect}
        selectedNodeId="screen-games"
      />,
    );

    const frame = screen.getByRole("treeitem", {
      name: "Games CodeFrame",
    });
    act(() => {
      frame.focus();
    });
    fireEvent.keyDown(frame, { key: "ArrowLeft" });
    expect(frame.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(frame, { key: "ArrowRight" });
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Games runtime reference ReferenceFrame Locked reference",
    );

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowDown",
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Games list Group",
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "Enter",
    });
    expect(onSelect).toHaveBeenLastCalledWith("games-list");

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowRight",
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Game card Rectangle",
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: " ",
    });
    expect(onSelect).toHaveBeenLastCalledWith("game-card");
  });

  it("keeps the locked runtime reference navigable but non-selectable", () => {
    const onSelect = vi.fn();
    render(
      <Layers
        nodes={nodes}
        onSelect={onSelect}
        selectedNodeId="screen-games"
      />,
    );

    const reference = screen.getByRole("treeitem", {
      name: "Games runtime reference ReferenceFrame Locked reference",
    });
    act(() => {
      reference.focus();
    });
    fireEvent.click(reference);
    fireEvent.keyDown(reference, { key: "Enter" });
    fireEvent.keyDown(reference, { key: " " });

    expect(document.activeElement).toBe(reference);
    expect(onSelect).not.toHaveBeenCalledWith("capture-games");
  });

  it("selects an editable semantic child in Inspector without moving the reference", async () => {
    render(
      <CanvasWorkbench
        project={project}
        v3Session={createCanvasWorkbenchV3TestSession(project)}
      />,
    );
    await screen.findByRole("tree", { name: "Layers" });
    for (let depth = 0; depth < 6; depth += 1) {
      screen
        .getAllByRole("treeitem")
        .filter((item) => item.getAttribute("aria-expanded") === "false")
        .forEach((item) => fireEvent.keyDown(item, { key: "ArrowRight" }));
    }
    await screen.findByRole("treeitem", { name: "Games CodeFrame" });

    const reference = screen
      .getByRole("button", {
        name: "Games runtime reference on canvas",
      })
      .closest<HTMLElement>("[data-node-id]");
    const referencePosition = {
      left: reference?.style.left,
      top: reference?.style.top,
    };
    const frame = screen.getByRole("treeitem", {
      name: "Games CodeFrame",
    });
    fireEvent.click(
      within(frame).getByRole("treeitem", {
        name: "Game card Rectangle",
      }),
    );

    expect(
      within(screen.getByRole("region", { name: "Inspector" })).getByRole(
        "heading",
        { name: "Game card" },
      ),
    ).toBeTruthy();
    expect(reference?.getAttribute("data-selected")).toBe("false");
    expect({
      left: reference?.style.left,
      top: reference?.style.top,
    }).toEqual(referencePosition);
  });
});
