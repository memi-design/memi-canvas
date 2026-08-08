import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import { createCanvasWorkbenchV3TestSession } from "./canvas-workbench-v3-test-session.js";
import { Inspector } from "./parts.js";

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

function viewport(): HTMLElement {
  return screen.getByRole("region", { name: "Infinite canvas" });
}

function canvasNode(name: string): HTMLElement {
  return screen.getByRole("button", { name: `${name} on canvas` });
}

describe("CanvasWorkbench professional interaction contract", () => {
  it("uses a compact icon-first inspector when nothing is selected", async () => {
    render(
      <Inspector
        node={undefined}
        onChange={() => undefined}
        onDelete={() => undefined}
        onDetach={() => undefined}
        onDuplicate={() => undefined}
      />,
    );

    expect(screen.getByLabelText("No selection")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "No selection" }),
    ).toBeTruthy();
  });

  it("supports additive selection, toggle selection, and clearing on empty canvas", async () => {
    render(
      <CanvasWorkbench
        project={canvasWorkbenchFixture}
        v3Session={createCanvasWorkbenchV3TestSession(canvasWorkbenchFixture)}
      />,
    );
    await screen.findByRole("toolbar", { name: "Canvas tools" });

    fireEvent.pointerDown(canvasNode("Campaign card"), {
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(viewport(), { button: 0, pointerId: 1 });
    fireEvent.pointerDown(canvasNode("Welcome headline"), {
      button: 0,
      pointerId: 2,
      shiftKey: true,
    });
    fireEvent.pointerUp(viewport(), {
      button: 0,
      pointerId: 2,
      shiftKey: true,
    });

    expect(canvasNode("Campaign card").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(canvasNode("Welcome headline").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(viewport().getAttribute("data-selection-count")).toBe("2");

    fireEvent.pointerDown(canvasNode("Campaign card"), {
      button: 0,
      pointerId: 3,
      shiftKey: true,
    });
    fireEvent.pointerUp(viewport(), {
      button: 0,
      pointerId: 3,
      shiftKey: true,
    });
    await waitFor(() => {
      expect(canvasNode("Campaign card").getAttribute("aria-pressed")).toBe(
        "false",
      );
      expect(viewport().getAttribute("data-selection-count")).toBe("1");
    });

    fireEvent.click(viewport());
    await waitFor(() => {
      expect(viewport().getAttribute("data-selection-count")).toBe("0");
    });
    expect(
      screen.getByRole("heading", { level: 2, name: "No selection" }),
    ).toBeTruthy();
  });

  it("makes the selected object visually identifiable with a dedicated bounds affordance", async () => {
    await renderWorkbench();

    fireEvent.pointerDown(canvasNode("Campaign card"), {
      button: 0,
      pointerId: 31,
    });
    fireEvent.pointerUp(viewport(), { button: 0, pointerId: 31 });

    expect(
      screen.getByLabelText("Selection bounds for Campaign card"),
    ).toBeTruthy();
    const campaignId = canvasNode("Campaign card")
      .closest<HTMLElement>("[data-node-id]")
      ?.dataset.nodeId;
    expect(campaignId).toBeTruthy();
    expect(
      screen.getByTestId(`canvas-node-tag-${campaignId}`).textContent,
    ).toContain("Campaign card");
  });

  it("marks only an eligible canvas container as the active drop target while moving", async () => {
    await renderWorkbench();

    const campaign = canvasNode("Campaign card");
    const checkout = canvasNode("Checkout exploration");
    const dashboard = canvasNode("Dashboard desktop");

    fireEvent.pointerDown(campaign, {
      button: 0,
      clientX: 960,
      clientY: 180,
      pointerId: 37,
    });
    fireEvent.pointerMove(viewport(), {
      buttons: 1,
      clientX: 220,
      clientY: 800,
      pointerId: 37,
    });

    expect(
      checkout.parentElement?.getAttribute("data-drop-target"),
    ).toBe("true");
    expect(campaign.parentElement?.getAttribute("data-moving")).toBe(
      "true",
    );
    expect(
      screen.getByRole("status", {
        name: "Valid drop target: Checkout exploration",
      }),
    ).toBeTruthy();

    fireEvent.pointerMove(viewport(), {
      buttons: 1,
      clientX: 220,
      clientY: 220,
      pointerId: 37,
    });

    expect(
      dashboard.parentElement?.getAttribute("data-drop-target"),
    ).toBe("false");
    expect(
      screen.queryByRole("status", { name: /Valid drop target:/ }),
    ).toBeNull();

    fireEvent.pointerCancel(viewport(), {
      button: 0,
      pointerId: 37,
    });

    expect(campaign.parentElement?.getAttribute("data-moving")).toBe(
      "false",
    );
  });

  it("marquee-selects intersecting unlocked nodes as one ordered selection", async () => {
    await renderWorkbench();

    fireEvent.pointerDown(viewport(), {
      pointerId: 7,
      clientX: 900,
      clientY: 140,
      button: 0,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 7,
      clientX: 1290,
      clientY: 410,
      buttons: 1,
    });

    expect(
      screen.getByTestId("selection-marquee").getAttribute("data-active"),
    ).toBe("true");

    fireEvent.pointerUp(viewport(), {
      pointerId: 7,
      clientX: 1290,
      clientY: 410,
      button: 0,
    });

    expect(viewport().getAttribute("data-selection-count")).toBe("3");
    expect(canvasNode("Campaign card").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(canvasNode("Welcome headline").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(canvasNode("Promo panel").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("keeps the marquee under the pointer when the viewport is offset by editor chrome", async () => {
    await renderWorkbench();
    const canvas = viewport();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      bottom: 680,
      height: 600,
      left: 240,
      right: 1_040,
      top: 80,
      width: 800,
      x: 240,
      y: 80,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(canvas, {
      pointerId: 17,
      clientX: 260,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 17,
      clientX: 300,
      clientY: 140,
      buttons: 1,
    });

    const marquee = screen.getByTestId("selection-marquee");
    expect(marquee.style.left).toBe("20px");
    expect(marquee.style.top).toBe("20px");
    expect(marquee.style.width).toBe("40px");
    expect(marquee.style.height).toBe("40px");
  });

  it("pans with an ordinary wheel and zooms around the pointer with ctrl-wheel", async () => {
    await renderWorkbench();

    fireEvent.wheel(viewport(), {
      deltaX: 24,
      deltaY: 40,
      clientX: 400,
      clientY: 300,
    });
    await waitFor(() => {
      expect(viewport().getAttribute("data-camera-x")).toBe("-24");
      expect(viewport().getAttribute("data-camera-y")).toBe("-40");
      expect(viewport().getAttribute("data-zoom")).toBe("1");
    });

    fireEvent.wheel(viewport(), {
      ctrlKey: true,
      deltaY: -100,
      clientX: 400,
      clientY: 300,
    });
    await waitFor(() => {
      expect(Number(viewport().getAttribute("data-zoom"))).toBeGreaterThan(1);
      expect(Number(viewport().getAttribute("data-camera-x"))).toBeLessThan(
        -24,
      );
      expect(Number(viewport().getAttribute("data-camera-y"))).toBeLessThan(
        -40,
      );
    });
  });

  it("supports transient space-pan and middle-mouse pan without changing tools", async () => {
    await renderWorkbench();
    const selectTool = screen.getByRole("button", { name: "Select tool" });

    fireEvent.keyDown(document, { key: " " });
    fireEvent.pointerDown(viewport(), {
      pointerId: 8,
      clientX: 10,
      clientY: 20,
      button: 0,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 8,
      clientX: 60,
      clientY: 80,
    });
    fireEvent.pointerUp(viewport(), {
      pointerId: 8,
      clientX: 60,
      clientY: 80,
      button: 0,
    });
    fireEvent.keyUp(document, { key: " " });

    await waitFor(() => {
      expect(viewport().getAttribute("data-camera-x")).toBe("50");
      expect(viewport().getAttribute("data-camera-y")).toBe("60");
      expect(selectTool.getAttribute("aria-pressed")).toBe("true");
    });

    fireEvent.pointerDown(viewport(), {
      pointerId: 9,
      clientX: 60,
      clientY: 80,
      button: 1,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 9,
      clientX: 90,
      clientY: 100,
    });
    fireEvent.pointerUp(viewport(), {
      pointerId: 9,
      clientX: 90,
      clientY: 100,
      button: 1,
    });

    await waitFor(() => {
      expect(viewport().getAttribute("data-camera-x")).toBe("80");
      expect(viewport().getAttribute("data-camera-y")).toBe("80");
    });
  });

  it("starts pan gestures over artwork instead of moving or swallowing the pointer", async () => {
    await renderWorkbench();
    const canvas = viewport();
    const campaign = canvasNode("Campaign card");
    const initialLeft = campaign.parentElement?.style.left;
    const initialTop = campaign.parentElement?.style.top;

    fireEvent.click(screen.getByRole("button", { name: "Pan tool" }));
    fireEvent.pointerDown(campaign, {
      pointerId: 19,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 19,
      clientX: 140,
      clientY: 130,
      buttons: 1,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 19,
      clientX: 140,
      clientY: 130,
      button: 0,
    });

    await waitFor(() => {
      expect(canvas.getAttribute("data-camera-x")).toBe("40");
      expect(canvas.getAttribute("data-camera-y")).toBe("30");
    });
    expect(campaign.parentElement?.style.left).toBe(initialLeft);
    expect(campaign.parentElement?.style.top).toBe(initialTop);
  });

  it("selects all, groups, ungroups, duplicates, deletes, and orders through shortcuts", async () => {
    await renderWorkbench();

    fireEvent.keyDown(document, { key: "a", metaKey: true });
    expect(viewport().getAttribute("data-selection-count")).toBe("5");

    fireEvent.keyDown(document, { key: "g", metaKey: true });
    expect(
      await within(screen.getByRole("tree", { name: "Layers" })).findByRole(
        "treeitem",
        { name: /Group 1.*Group/ },
      ),
    ).toBeTruthy();
    expect(viewport().getAttribute("data-selection-count")).toBe("1");

    fireEvent.keyDown(document, { key: "g", metaKey: true, shiftKey: true });
    await waitFor(() => {
      expect(
        within(screen.getByRole("tree", { name: "Layers" })).queryByRole(
          "treeitem",
          { name: /Group 1.*Group/ },
        ),
      ).toBeNull();
    });

    fireEvent.click(canvasNode("Campaign card"));
    await waitFor(() => {
      expect(canvasNode("Campaign card").getAttribute("aria-pressed")).toBe(
        "true",
      );
    });
    fireEvent.keyDown(document, { key: "d", metaKey: true });
    expect(
      await screen.findByRole("button", {
        name: "Campaign card copy on canvas",
      }),
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: "]", metaKey: true, altKey: true });
    fireEvent.keyDown(document, { key: "Backspace" });
    await waitFor(() => {
      expect(screen.queryByRole("button", {
        name: "Campaign card copy on canvas",
      })).toBeNull();
    });
  });

  it("moves a group and its descendants as one visual hierarchy", async () => {
    await renderWorkbench();
    fireEvent.click(canvasNode("Campaign card"));
    fireEvent.click(canvasNode("Checkout exploration"), { shiftKey: true });
    fireEvent.keyDown(document, { key: "g", metaKey: true });

    const group = await screen.findByRole("button", {
      name: "Group 1 on canvas",
    });
    const campaign = canvasNode("Campaign card");
    const headline = canvasNode("Welcome headline");
    const campaignBefore = {
      left: campaign.parentElement?.style.left,
      top: campaign.parentElement?.style.top,
    };
    const headlineBefore = {
      left: headline.parentElement?.style.left,
      top: headline.parentElement?.style.top,
    };
    fireEvent.pointerDown(group, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 43,
    });
    fireEvent.pointerMove(viewport(), {
      buttons: 1,
      clientX: 140,
      clientY: 130,
      pointerId: 43,
    });
    fireEvent.pointerUp(viewport(), {
      button: 0,
      clientX: 140,
      clientY: 130,
      pointerId: 43,
    });

    await waitFor(() => {
      expect(campaign.parentElement?.style.left).not.toBe(campaignBefore.left);
      expect(campaign.parentElement?.style.top).not.toBe(campaignBefore.top);
      expect(headline.parentElement?.style.left).not.toBe(headlineBefore.left);
      expect(headline.parentElement?.style.top).not.toBe(headlineBefore.top);
    });
  });

  it("nudges a selected group and its descendants as one hierarchy", async () => {
    await renderWorkbench();
    fireEvent.click(canvasNode("Campaign card"));
    fireEvent.click(canvasNode("Checkout exploration"), { shiftKey: true });
    fireEvent.keyDown(document, { key: "g", metaKey: true });

    const group = await screen.findByRole("button", {
      name: "Group 1 on canvas",
    });
    const campaign = canvasNode("Campaign card");
    const child = canvasNode("Welcome headline");
    const before = {
      campaign: campaign.parentElement?.style.left,
      child: child.parentElement?.style.left,
      group: group.parentElement?.style.left,
    };
    fireEvent.keyDown(viewport(), { key: "ArrowRight" });

    await waitFor(() => {
      expect(group.parentElement?.style.left).not.toBe(before.group);
      expect(campaign.parentElement?.style.left).not.toBe(before.campaign);
      expect(child.parentElement?.style.left).not.toBe(before.child);
    });
  });

  it("inherits hidden and locked interaction state from group ancestry", async () => {
    const base = {
      hidden: false,
      kind: "Rectangle" as const,
      locked: false,
      position: { x: 100, y: 100 },
      size: { height: 100, width: 100 },
    };
    const hiddenProject = {
      ...canvasWorkbenchFixture,
      document: {
        ...canvasWorkbenchFixture.document,
        nodes: [
          {
            ...base,
            hidden: true,
            id: "hidden-group",
            kind: "Group" as const,
            name: "Hidden group",
            parentId: null,
          },
          {
            ...base,
            id: "hidden-child",
            name: "Hidden child",
            parentId: "hidden-group",
          },
        ],
      },
      selectedNodeId: null,
    };
    const { unmount } = render(
      <CanvasWorkbench
        project={hiddenProject}
        v3Session={createCanvasWorkbenchV3TestSession(hiddenProject)}
      />,
    );
    await screen.findByRole("toolbar", { name: "Canvas tools" });
    expect(
      screen.queryByRole("button", { name: "Hidden child on canvas" }),
    ).toBeNull();
    unmount();

    const lockedProject = {
      ...hiddenProject,
      document: {
        ...hiddenProject.document,
        nodes: [
          {
            ...base,
            id: "locked-group",
            kind: "Group" as const,
            locked: true,
            name: "Locked group",
            parentId: null,
          },
          {
            ...base,
            id: "locked-child",
            name: "Locked child",
            parentId: "locked-group",
          },
        ],
      },
    };
    render(
      <CanvasWorkbench
        project={lockedProject}
        v3Session={createCanvasWorkbenchV3TestSession(lockedProject)}
      />,
    );
    await screen.findByRole("toolbar", { name: "Canvas tools" });
    expect(
      screen
        .getByRole("button", { name: "Locked child on canvas" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("opens an accessible contextual menu and protects source-backed nodes", async () => {
    await renderWorkbench();

    fireEvent.contextMenu(canvasNode("Dashboard desktop"), {
      clientX: 320,
      clientY: 240,
    });

    const menu = screen.getByRole("menu", {
      name: "Canvas selection actions",
    });
    expect(within(menu).getByRole("menuitem", {
      name: "Detach from source",
    })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", {
      name: /Delete/,
    }).getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Detach from source" }),
    );
    expect(
      await within(screen.getByRole("region", { name: "Inspector" })).findByText(
        "Kind: DraftFrame",
      ),
    ).toBeTruthy();

    fireEvent.contextMenu(canvasNode("Dashboard desktop"), {
      clientX: 320,
      clientY: 240,
    });
    fireEvent.click(
      within(
        screen.getByRole("menu", { name: "Canvas selection actions" }),
      ).getByRole("menuitem", { name: /Duplicate/ }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Dashboard desktop copy on canvas",
      }),
    ).toBeTruthy();
  });

  it("right-click selects the target before opening actions for it", async () => {
    await renderWorkbench();
    fireEvent.click(canvasNode("Campaign card"));

    fireEvent.contextMenu(canvasNode("Welcome headline"), {
      clientX: 320,
      clientY: 240,
    });

    expect(canvasNode("Campaign card").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(canvasNode("Welcome headline").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen.getByRole("menu", {
        name: "Canvas selection actions",
      }).textContent,
    ).toContain("Welcome headline");
  });

  it("frames, componentizes, and locks a selection through canonical actions", async () => {
    await renderWorkbench();

    fireEvent.click(canvasNode("Campaign card"));
    fireEvent.keyDown(document, { key: "g", metaKey: true, altKey: true });
    expect(
      await screen.findByRole("button", { name: "Frame 2 on canvas" }),
    ).toBeTruthy();

    fireEvent.keyDown(document, { key: "k", metaKey: true, altKey: true });
    const component = await screen.findByRole("button", {
      name: "Component 1 on canvas",
    });
    expect(component).toBeTruthy();

    fireEvent.contextMenu(component, { clientX: 320, clientY: 240 });
    const menu = screen.getByRole("menu", {
      name: "Canvas selection actions",
    });
    expect(
      within(menu).queryByRole("menuitem", { name: "Open source" }),
    ).toBeNull();
    expect(
      within(menu).getByRole("menuitem", {
        name: "Ask agent about selection",
      }),
    ).toBeTruthy();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Lock selection" }),
    );

    await waitFor(() => {
      expect(component.getAttribute("aria-disabled")).toBe("true");
    });
  });

  it("creates a local component master that can immediately place an instance", async () => {
    await renderWorkbench();

    fireEvent.click(canvasNode("Campaign card"));
    fireEvent.keyDown(document, { key: "k", metaKey: true, altKey: true });

    fireEvent.click(screen.getByRole("button", { name: "Assets" }));
    const assets = await screen.findByRole("list", {
      name: "Source components",
    });
    expect(
      within(assets).getByRole("button", { name: /Component 1/ }),
    ).toBeTruthy();

    fireEvent.click(canvasNode("Component 1"));
    fireEvent.keyDown(document, { key: "d", metaKey: true });

    expect(
      await screen.findByRole("button", {
        name: "Component 1 copy on canvas",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Component 1 copy on canvas" })
        .closest("[data-node-kind]")
        ?.getAttribute("data-node-kind"),
    ).toBe("ComponentInstance");
  });

  it("duplicates a detached draft with option-drag and commits one history entry", async () => {
    const v3Session = await renderWorkbench();

    const campaign = canvasNode("Campaign card");
    fireEvent.pointerDown(campaign, {
      pointerId: 10,
      clientX: 920,
      clientY: 160,
      altKey: true,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 10,
      clientX: 1020,
      clientY: 210,
      altKey: true,
    });
    fireEvent.pointerUp(viewport(), {
      pointerId: 10,
      clientX: 1020,
      clientY: 210,
      altKey: true,
    });

    expect(
      await screen.findByRole("button", {
        name: "Campaign card copy on canvas",
      }),
    ).toBeTruthy();
    await waitFor(async () => {
      const journal = await v3Session.persistence.load({
        schemaVersion: 1,
        documentId: v3Session.document.id,
        projectId: v3Session.document.projectId,
      });
      expect(journal?.operations.map(({ label }) => label)).toEqual([
        "Duplicate and move Campaign card",
      ]);
    });
  });

  it("commits a real reparent when a move lands on a valid container target", async () => {
    const v3Session = await renderWorkbench();

    const campaign = canvasNode("Campaign card");
    fireEvent.pointerDown(campaign, {
      pointerId: 44,
      clientX: 960,
      clientY: 180,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 44,
      clientX: 220,
      clientY: 800,
      buttons: 1,
    });
    fireEvent.pointerUp(viewport(), {
      pointerId: 44,
      clientX: 220,
      clientY: 800,
      buttons: 1,
    });

    await waitFor(async () => {
      const journal = await v3Session.persistence.load({
        schemaVersion: 1,
        documentId: v3Session.document.id,
        projectId: v3Session.document.projectId,
      });
      expect(journal?.operations.map(({ label }) => label)).toEqual([
        "Move Campaign card into Checkout exploration",
      ]);
      expect(journal?.operations.map((operation) => operation.action.type)).toEqual([
        "atomic.batch",
      ]);
      expect(
        journal?.operations.flatMap((operation) =>
          operation.action.type === "atomic.batch"
            ? operation.action.payload.actions.map(({ type }) => type)
            : [operation.action.type],
        ),
      ).toContain("node.reparent");
    });
  });

  it("rolls back an unfinished move when pointer capture is lost", async () => {
    await renderWorkbench();

    const campaign = canvasNode("Campaign card");
    const node = campaign.parentElement;
    const initialLeft = node?.style.left;
    const initialTop = node?.style.top;

    fireEvent.pointerDown(campaign, {
      pointerId: 21,
      clientX: 920,
      clientY: 160,
      button: 0,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 21,
      clientX: 1_020,
      clientY: 210,
      buttons: 1,
    });

    expect(node?.style.left).not.toBe(initialLeft);
    expect(node?.style.top).not.toBe(initialTop);

    fireEvent.lostPointerCapture(viewport(), { pointerId: 21 });

    expect(node?.style.left).toBe(initialLeft);
    expect(node?.style.top).toBe(initialTop);
    fireEvent.click(screen.getByRole("button", { name: "Agent activity" }));
    expect(
      within(
        screen.getByRole("list", { name: "Semantic history" }),
      ).queryAllByRole("listitem"),
    ).toHaveLength(0);
  });

  it("keeps camera and drag scale stable while an object gesture is active", async () => {
    await renderWorkbench();

    const campaign = canvasNode("Campaign card");
    fireEvent.pointerDown(campaign, {
      pointerId: 22,
      clientX: 920,
      clientY: 160,
      button: 0,
    });
    fireEvent.wheel(viewport(), {
      ctrlKey: true,
      deltaY: -100,
      clientX: 920,
      clientY: 160,
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    fireEvent.pointerMove(viewport(), {
      pointerId: 22,
      clientX: 1_020,
      clientY: 210,
      buttons: 1,
    });

    expect(viewport().getAttribute("data-zoom")).toBe("1");
    expect(campaign.parentElement?.style.left).toBe("1020px");
    expect(
      Math.abs(Number.parseFloat(campaign.parentElement?.style.top ?? "") - 210),
    ).toBeLessThanOrEqual(6);
  });
});
