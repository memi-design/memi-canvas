import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CanvasWorkbench,
  type AgentSelectionContext,
} from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import { createCanvasWorkbenchV3TestSession } from "./canvas-workbench-v3-test-session.js";
import type { CanvasWorkbenchV3Session } from "./CanvasWorkbench.types.js";
import { sourceProjectFixture } from "./source-project.fixture.js";
import {
  createDemoCanvasRuntimePort,
  type CanvasRuntimePortV1,
} from "./canvas-runtime-port.js";

async function renderWorkbench(
  props: {
    readonly onHarnessChange?: (harnessId: string) => void;
    readonly onSendAgentContext?: (context: AgentSelectionContext) => void;
    readonly runtimePort?: CanvasRuntimePortV1;
    readonly v3Session?: CanvasWorkbenchV3Session;
  } = {},
) {
  const {
    v3Session = createCanvasWorkbenchV3TestSession(canvasWorkbenchFixture),
    ...workbenchProps
  } = props;
  const view = render(
    <CanvasWorkbench
      project={canvasWorkbenchFixture}
      v3Session={v3Session}
      {...workbenchProps}
    />,
  );
  await screen.findByRole("toolbar", { name: "Canvas tools" });
  return { v3Session, view };
}

async function renderSourceWorkbench(): Promise<void> {
  render(
    <CanvasWorkbench
      project={sourceProjectFixture}
      v3Session={createCanvasWorkbenchV3TestSession(sourceProjectFixture)}
    />,
  );
  await screen.findByRole("toolbar", { name: "Canvas tools" });
}

function viewport(): HTMLElement {
  return screen.getByRole("region", { name: "Infinite canvas" });
}

async function selectLayer(name: RegExp): Promise<HTMLElement> {
  const tree = screen.getByRole("tree", { name: "Layers" });
  for (;;) {
    const collapsed = within(tree)
      .getAllByRole("treeitem")
      .find((item) => item.getAttribute("aria-expanded") === "false");
    if (collapsed === undefined) {
      break;
    }
    fireEvent.click(collapsed.querySelector(".layer-group-row")!);
    await waitFor(() => {
      expect(collapsed.getAttribute("aria-expanded")).toBe("true");
    });
  }
  const layer = await within(tree).findByRole("treeitem", { name });
  fireEvent.click(layer);
  await waitFor(() => {
    expect(layer.getAttribute("aria-selected")).toBe("true");
  });
  return layer;
}

describe("CanvasWorkbench first usable contract", () => {
  it("renders lightweight chrome around an unbounded pan-and-zoom viewport", async () => {
    await renderWorkbench();

    expect(
      screen.getByRole("toolbar", { name: "Canvas tools" }),
    ).toBeTruthy();
    expect(screen.getByRole("tree", { name: "Layers" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Inspector" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Agent prompt" })).toBeTruthy();
    expect(screen.queryByRole("log", { name: "Trace" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pan tool" }));
    fireEvent.pointerDown(viewport(), {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 5010,
      clientY: -3990,
    });
    fireEvent.pointerUp(viewport(), {
      pointerId: 1,
      clientX: 5010,
      clientY: -3990,
    });
    fireEvent.wheel(viewport(), {
      ctrlKey: true,
      deltaY: -100,
      clientX: 400,
      clientY: 300,
    });

    await waitFor(() => {
      expect(Number(viewport().getAttribute("data-camera-x"))).toBeGreaterThan(
        5000,
      );
      expect(Number(viewport().getAttribute("data-camera-y"))).toBeLessThan(
        -4000,
      );
      expect(Number(viewport().getAttribute("data-zoom"))).toBeGreaterThan(1);
      expect(
        screen.getByRole("status", { name: "Viewport transform" }).textContent,
      ).toContain("111%");
    });
  });

  it("supports standard keyboard navigation across the nested layers tree", async () => {
    await renderWorkbench();

    const tree = screen.getByRole("tree", { name: "Layers" });
    const routeInventory = within(tree).getByRole("treeitem", {
      name: "Route inventory",
    });
    act(() => {
      routeInventory.focus();
    });
    fireEvent.keyDown(routeInventory, { key: "ArrowLeft" });
    expect(routeInventory.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(routeInventory, { key: "ArrowRight" });
    expect(routeInventory.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(routeInventory, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("role")).toBe("treeitem");
    expect(document.activeElement?.getAttribute("aria-label")).not.toBe(
      "Route inventory",
    );
    expect(
      within(tree)
        .getAllByRole("treeitem")
        .filter((item) => item.tabIndex === 0),
    ).toEqual([document.activeElement]);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    const visibleItems = within(tree).getAllByRole("treeitem");
    expect(document.activeElement).toBe(visibleItems.at(-1));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(visibleItems[0]);
  });

  it("shares selection across canvas and layers, then groups manipulation into semantic history", async () => {
    const { v3Session } = await renderWorkbench();

    fireEvent.click(
      screen.getByRole("button", { name: "Campaign card on canvas" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Campaign card on canvas" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    const dashboardLayer = await selectLayer(/Dashboard desktop.*CodeFrame/);
    expect(dashboardLayer.getAttribute("aria-selected")).toBe("true");

    const dashboard = screen.getByRole("button", {
      name: "Dashboard desktop on canvas",
    });
    fireEvent.pointerDown(dashboard, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 40,
      clientY: 30,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 60,
      clientY: 40,
    });
    fireEvent.pointerUp(viewport(), {
      pointerId: 1,
      clientX: 60,
      clientY: 40,
    });

    const x = screen.getByRole("spinbutton", { name: "X" }) as HTMLInputElement;
    const y = screen.getByRole("spinbutton", { name: "Y" }) as HTMLInputElement;
    await waitFor(() => {
      expect(x.value).toBe("140");
      expect(y.value).toBe("143");
    });
    await waitFor(async () => {
      const journal = await v3Session.persistence.load({
        schemaVersion: 1,
        documentId: v3Session.document.id,
        projectId: v3Session.document.projectId,
      });
      expect(journal?.operations.map(({ label }) => label)).toEqual([
        "Move Dashboard desktop",
      ]);
    });
    const reopenedX = screen.getByRole("spinbutton", {
      name: "X",
    }) as HTMLInputElement;

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "Resize Dashboard desktop southeast",
      }),
      { pointerId: 2, clientX: 720, clientY: 450 },
    );
    fireEvent.pointerMove(viewport(), {
      pointerId: 2,
      clientX: 760,
      clientY: 480,
    });
    fireEvent.pointerUp(viewport(), {
      pointerId: 2,
      clientX: 760,
      clientY: 480,
    });
    await waitFor(() => {
      expect(
        (screen.getByRole("spinbutton", { name: "Width" }) as HTMLInputElement)
          .value,
      ).toBe("760");
    });

    fireEvent.keyDown(viewport(), { key: "ArrowRight" });
    await waitFor(() => {
      expect(reopenedX.value).toBe("141");
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(reopenedX.value).toBe("140");
    });
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => {
      expect(reopenedX.value).toBe("141");
    });
  });

  it("creates primitives and supports inspector edit, duplicate, delete, lock, and hide", async () => {
    await renderWorkbench();

    for (const tool of ["Text", "Rectangle", "Frame"]) {
      fireEvent.click(screen.getByRole("button", { name: `${tool} tool` }));
      fireEvent.click(viewport(), { clientX: 640, clientY: 360 });
      const created = await screen.findByRole("button", {
        name: `${tool} 2 on canvas`,
      });
      fireEvent.click(created);
      expect(
        await screen.findByRole("heading", { level: 2, name: `${tool} 2` }),
      ).toBeTruthy();
    }

    await selectLayer(/Welcome headline.*Text/);
    const name = screen.getByRole("textbox", {
      name: "Name",
    }) as HTMLInputElement;
    const text = screen.getByRole("textbox", {
      name: "Text content",
    }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Primary greeting" } });
    await act(async () => {
      fireEvent.blur(name);
    });
    fireEvent.change(text, { target: { value: "Good morning, Ada" } });
    await act(async () => {
      fireEvent.blur(text);
    });
    expect(
      (await screen.findByRole("button", { name: "Primary greeting on canvas" }))
        .textContent,
    ).toContain("Good morning, Ada");

    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate selection" }),
    );
    expect(
      await within(screen.getByRole("tree", { name: "Layers" })).findByRole(
        "treeitem",
        { name: /Primary greeting copy.*Text/ },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete selection" }));
    await waitFor(() => {
      expect(
        within(screen.getByRole("tree", { name: "Layers" })).queryByRole(
          "treeitem",
          { name: /Primary greeting copy.*Text/ },
        ),
      ).toBeNull();
    });

    await selectLayer(/Promo panel.*Rectangle/);
    fireEvent.click(screen.getByRole("button", { name: "Lock selection" }));
    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Promo panel on canvas" })
          .getAttribute("aria-disabled"),
      ).toBe("true");
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide selection" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Promo panel on canvas" }),
      ).toBeNull();
    });
    expect(
      screen.getByRole("button", { name: "Show selection" }),
    ).toBeTruthy();
  });

  it("duplicates or detaches a CodeFrame as a draft without source-authority cloning", async () => {
    await renderWorkbench();
    await selectLayer(/Dashboard desktop.*CodeFrame/);

    const inspector = screen.getByRole("region", { name: "Inspector" });
    expect(within(inspector).getByText("Kind: CodeFrame")).toBeTruthy();
    expect(
      within(inspector).getByText("Authority: product source"),
    ).toBeTruthy();
    fireEvent.click(
      within(inspector).getByRole("button", {
        name: "Duplicate selection",
      }),
    );
    expect(await within(inspector).findByText("Kind: DraftFrame")).toBeTruthy();
    expect(
      within(inspector).getByText("Authority: canvas document"),
    ).toBeTruthy();
    expect(
      within(inspector).getByText(
        "Detached from src/routes/dashboard.tsx:24 at fixture@abc123",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await within(inspector).findByText("Kind: CodeFrame")).toBeTruthy();

    fireEvent.click(
      within(inspector).getByRole("button", {
        name: "Detach from source",
      }),
    );

    expect(await within(inspector).findByText("Kind: DraftFrame")).toBeTruthy();
    expect(
      within(inspector).getByText("Authority: canvas document"),
    ).toBeTruthy();
    expect(
      within(inspector).getByText(
        "Detached from src/routes/dashboard.tsx:24 at fixture@abc123",
      ),
    ).toBeTruthy();
    expect(
      within(inspector).getByRole("textbox", { name: "Frame content" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Agent activity" }));
    expect(
      within(screen.getByRole("log", { name: "Trace" })).getByText(
        "Detached Dashboard desktop from product source",
      ),
    ).toBeTruthy();
  });

  it("lists source component masters as assets and duplicates them as instances", async () => {
    await renderSourceWorkbench();

    fireEvent.click(screen.getByRole("button", { name: "Assets" }));
    const assets = screen.getByRole("list", { name: "Source components" });
    expect(within(assets).getAllByRole("listitem")).toHaveLength(1);

    fireEvent.click(
      within(assets).getByRole("button", {
        name: /Button \/ Primary/,
      }),
    );
    const inspector = screen.getByRole("region", { name: "Inspector" });
    expect(within(inspector).getByText("Master · atom · button")).toBeTruthy();

    fireEvent.click(
      within(inspector).getByRole("button", {
        name: "Duplicate selection",
      }),
    );

    expect(await within(inspector).findByText("Instance · atom · button")).toBeTruthy();
    expect(within(inspector).getByText(/Master: northstar-button-primary-master/))
      .toBeTruthy();

    fireEvent.click(
      within(assets).getByRole("button", {
        name: /Button \/ Primary/,
      }),
    );
    fireEvent.change(
      within(inspector).getByRole("textbox", { name: "Component label" }),
      { target: { value: "Updated master" } },
    );
    fireEvent.blur(
      within(inspector).getByRole("textbox", { name: "Component label" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    fireEvent.keyDown(
      within(screen.getByRole("tree", { name: "Layers" })).getByRole(
        "treeitem",
        { name: "Drafts" },
      ),
      { key: "Enter" },
    );
    fireEvent.click(
      within(screen.getByRole("tree", { name: "Layers" })).getByRole(
        "treeitem",
        { name: /Button \/ Primary copy.*ComponentInstance/ },
      ),
    );
    expect(
      screen.getByRole("button", {
        name: "Button / Primary copy on canvas",
      }).textContent,
    ).toContain("Updated master");

    fireEvent.click(
      within(inspector).getByRole("button", {
        name: "Delete selection",
      }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: "Button / Primary copy on canvas",
        }),
      ).toBeNull();
    });
  }, 10_000);

  it("reveals a layer selected from the navigator in the current viewport", async () => {
    await renderSourceWorkbench();
    const canvas = screen.getByRole("region", { name: "Infinite canvas" });
    const initialCameraX = canvas.getAttribute("data-camera-x");

    fireEvent.click(screen.getByRole("button", { name: "Assets" }));
    fireEvent.click(
      within(screen.getByRole("list", { name: "Source components" })).getByRole(
        "button",
        { name: /Button \/ Primary/ },
      ),
    );

    await waitFor(() => {
      expect(canvas.getAttribute("data-camera-x")).not.toBe(initialCameraX);
      expect(
        screen.getByRole("button", { name: "Button / Primary on canvas" }),
      ).toBeTruthy();
    });
  }, 10_000);

  it("switches harnesses and sends only the selected node into a bounded agent context capsule", async () => {
    const onHarnessChange = vi.fn();
    const onSendAgentContext = vi.fn();
    await renderWorkbench({ onHarnessChange, onSendAgentContext });
    await selectLayer(/Dashboard desktop.*CodeFrame/);

    const context = screen.getByRole("region", { name: "Agent prompt" });
    expect(within(context).getByText("Dashboard desktop")).toBeTruthy();
    expect(within(context).queryByText("Campaign card")).toBeNull();

    const harness = screen.getByRole("combobox", {
      name: "Agent harness",
    }) as HTMLSelectElement;
    fireEvent.change(harness, { target: { value: "claude" } });
    expect(harness.value).toBe("claude");
    expect(onHarnessChange).toHaveBeenCalledWith("claude");
    fireEvent.click(screen.getByRole("button", { name: "Agent activity" }));
    expect(
      within(screen.getByRole("log", { name: "Trace" })).getByText(
        "Switched harness from Codex to Claude for Dashboard desktop",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Inspect" }));

    fireEvent.change(screen.getByRole("spinbutton", { name: "X" }), {
      target: { value: "101" },
    });
    await act(async () => {
      fireEvent.blur(screen.getByRole("spinbutton", { name: "X" }));
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
      target: { value: "Audit the spacing and propose a fix" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit prompt" }),
    );
    await waitFor(() => {
      expect(onSendAgentContext).toHaveBeenCalledTimes(1);
    });
    const submitted = onSendAgentContext.mock.calls[0]?.[0];
    const selectedDashboardId = screen
      .getByRole("button", { name: "Dashboard desktop on canvas" })
      .closest<HTMLElement>("[data-node-id]")
      ?.dataset.nodeId;
    expect(selectedDashboardId).toBeTruthy();
    expect(submitted).toMatchObject({
      documentId: "document-northstar",
      harnessId: "claude",
      revision: 8,
      prompt: "Audit the spacing and propose a fix",
      promptMode: "plan",
      modelId: "gpt-5.5",
      permissionPolicy: "approval",
      reasoningEffort: "xhigh",
    });
    expect(submitted.nodeIds).toEqual([selectedDashboardId]);
    expect(submitted.capsule.selectedIds).toEqual([selectedDashboardId]);
    expect(JSON.stringify(submitted.capsule)).not.toContain("Campaign card");
    expect(new TextEncoder().encode(JSON.stringify(submitted.capsule)).length)
      .toBeLessThanOrEqual(65_536);
    expect(
      within(screen.getByRole("log", { name: "Trace" })).getByText(
        "Submitted plan prompt for Dashboard desktop to Claude · gpt-5.5",
      ),
    ).toBeTruthy();
  });

  it("preserves the prompt when the runtime rejects a submission", async () => {
    const demoRuntime = createDemoCanvasRuntimePort();
    const runtimePort: CanvasRuntimePortV1 = {
      ...demoRuntime,
      submit: vi.fn().mockRejectedValue(new Error("Runtime unavailable")),
    };
    await renderWorkbench({ runtimePort });
    await selectLayer(/Dashboard desktop.*CodeFrame/);

    const prompt = screen.getByRole("textbox", {
      name: "Prompt",
    }) as HTMLTextAreaElement;
    fireEvent.change(prompt, {
      target: { value: "Propose a clearer dashboard hierarchy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit prompt" }));

    await waitFor(() => {
      expect(prompt.value).toBe("Propose a clearer dashboard hierarchy");
      expect(
        within(screen.getByRole("log", { name: "Trace" })).getByText(
          "Runtime submission failed: Runtime unavailable",
        ),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Product Map" }));
    expect(
      within(
        screen.getByRole("list", { name: "Product Map Findings" }),
      ).getByText("Runtime submission failed: Runtime unavailable"),
    ).toBeTruthy();
  });

  it("recovers durable V3 edits across remounts and continues journaling", async () => {
    const initialSession = createCanvasWorkbenchV3TestSession(
      canvasWorkbenchFixture,
    );
    const { view } = await renderWorkbench({ v3Session: initialSession });
    await selectLayer(/Dashboard desktop.*CodeFrame/);

    const xField = screen.getByRole("spinbutton", {
      name: "X",
    }) as HTMLInputElement;
    fireEvent.change(xField, { target: { value: "222" } });
    await act(async () => {
      fireEvent.blur(xField);
    });
    await waitFor(async () => {
      const journal = await initialSession.persistence.load({
        schemaVersion: 1,
        documentId: initialSession.document.id,
        projectId: initialSession.document.projectId,
      });
      expect(journal?.operations.map(({ label }) => label)).toEqual([
        "Move Dashboard desktop",
      ]);
    });

    view.unmount();
    const recoveredSession = Object.freeze({
      ...initialSession,
      persistence: initialSession.persistence,
    });
    await renderWorkbench({ v3Session: recoveredSession });
    await selectLayer(/Dashboard desktop.*CodeFrame/);
    expect(
      (screen.getByRole("spinbutton", { name: "X" }) as HTMLInputElement)
        .value,
    ).toBe("222");

    const recoveredX = screen.getByRole("spinbutton", { name: "X" });
    fireEvent.change(recoveredX, { target: { value: "333" } });
    await act(async () => {
      fireEvent.blur(recoveredX);
    });
    await waitFor(async () => {
      const journal = await recoveredSession.persistence.load({
        schemaVersion: 1,
        documentId: recoveredSession.document.id,
        projectId: recoveredSession.document.projectId,
      });
      expect(journal?.operations.map(({ expectedRevision }) => expectedRevision))
        .toEqual([
          canvasWorkbenchFixture.document.revision,
          canvasWorkbenchFixture.document.revision + 1,
        ]);
    });
  });

  it("persists an undo operation with a durable V3 history identity", async () => {
    const v3Session = createCanvasWorkbenchV3TestSession(canvasWorkbenchFixture);
    await renderWorkbench({ v3Session });

    fireEvent.click(screen.getByRole("button", { name: "Rectangle tool" }));
    fireEvent.click(viewport(), { clientX: 640, clientY: 360 });
    expect(
      await screen.findByRole("button", { name: "Rectangle 2 on canvas" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Undo" }).getAttribute(
          "aria-disabled",
        ),
      ).toBe("false");
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(async () => {
      const journal = await v3Session.persistence.load({
        schemaVersion: 1,
        documentId: v3Session.document.id,
        projectId: v3Session.document.projectId,
      });
      expect(journal?.operations).toHaveLength(2);
      expect(journal?.operations[1]?.undoOf).toBe(journal?.operations[0]?.id);
      expect(journal?.operations.map(({ expectedRevision }) => expectedRevision))
        .toEqual([
          canvasWorkbenchFixture.document.revision,
          canvasWorkbenchFixture.document.revision + 1,
        ]);
    });
    expect(
      screen.queryByRole("button", { name: "Rectangle 2 on canvas" }),
    ).toBeNull();
  });
});
