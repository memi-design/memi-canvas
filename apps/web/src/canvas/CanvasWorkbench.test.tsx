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
import { createSceneState } from "./model.js";
import { sourceProjectFixture } from "./source-project.fixture.js";
import {
  createCanvasAutosave,
  type CanvasAutosave,
} from "./persistence.js";
import {
  createDemoCanvasRuntimePort,
  type CanvasRuntimePortV1,
} from "./canvas-runtime-port.js";

function renderWorkbench(
  props: {
    readonly onHarnessChange?: (harnessId: string) => void;
    readonly onSendAgentContext?: (context: AgentSelectionContext) => void;
    readonly persistence?: CanvasAutosave;
    readonly runtimePort?: CanvasRuntimePortV1;
  } = {},
): void {
  render(<CanvasWorkbench project={canvasWorkbenchFixture} {...props} />);
}

function viewport(): HTMLElement {
  return screen.getByRole("region", { name: "Infinite canvas" });
}

function selectLayer(name: RegExp): HTMLElement {
  const layer = within(
    screen.getByRole("tree", { name: "Layers" }),
  ).getByRole("treeitem", { name });
  fireEvent.click(layer);
  return layer;
}

describe("CanvasWorkbench first usable contract", () => {
  it("renders lightweight chrome around an unbounded pan-and-zoom viewport", async () => {
    renderWorkbench();

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

  it("supports standard keyboard navigation across the nested layers tree", () => {
    renderWorkbench();

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

  it("shares selection across canvas and layers, then groups manipulation into semantic history", () => {
    renderWorkbench();

    fireEvent.click(
      screen.getByRole("button", { name: "Campaign card on canvas" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Campaign card on canvas" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    const dashboardLayer = selectLayer(/Dashboard desktop.*CodeFrame/);
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
    expect(x.value).toBe("140");
    expect(y.value).toBe("143");
    fireEvent.click(screen.getByRole("button", { name: "Agent activity" }));
    const history = screen.getByRole("list", { name: "Semantic history" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(1);
    expect(within(history).getByText("Move Dashboard desktop")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Inspect" }));
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
    expect(
      (screen.getByRole("spinbutton", { name: "Width" }) as HTMLInputElement)
        .value,
    ).toBe("760");

    fireEvent.keyDown(viewport(), { key: "ArrowRight" });
    expect(reopenedX.value).toBe("141");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(reopenedX.value).toBe("140");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(reopenedX.value).toBe("141");
  });

  it("creates primitives and supports inspector edit, duplicate, delete, lock, and hide", () => {
    renderWorkbench();

    for (const tool of ["Text", "Rectangle", "Frame"]) {
      fireEvent.click(screen.getByRole("button", { name: `${tool} tool` }));
      fireEvent.click(viewport(), { clientX: 640, clientY: 360 });
      expect(
        screen.getByRole("heading", { level: 2, name: `${tool} 2` }),
      ).toBeTruthy();
    }

    selectLayer(/Welcome headline.*Text/);
    const name = screen.getByRole("textbox", {
      name: "Name",
    }) as HTMLInputElement;
    const text = screen.getByRole("textbox", {
      name: "Text content",
    }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Primary greeting" } });
    fireEvent.blur(name);
    fireEvent.change(text, { target: { value: "Good morning, Ada" } });
    fireEvent.blur(text);
    expect(
      screen.getByRole("button", { name: "Primary greeting on canvas" })
        .textContent,
    ).toContain("Good morning, Ada");

    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate selection" }),
    );
    expect(
      within(screen.getByRole("tree", { name: "Layers" })).getByRole(
        "treeitem",
        { name: /Primary greeting copy.*Text/ },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete selection" }));
    expect(
      within(screen.getByRole("tree", { name: "Layers" })).queryByRole(
        "treeitem",
        { name: /Primary greeting copy.*Text/ },
      ),
    ).toBeNull();

    selectLayer(/Promo panel.*Rectangle/);
    fireEvent.click(screen.getByRole("button", { name: "Lock selection" }));
    expect(
      screen
        .getByRole("button", { name: "Promo panel on canvas" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide selection" }));
    expect(
      screen.queryByRole("button", { name: "Promo panel on canvas" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show selection" }),
    ).toBeTruthy();
  });

  it("duplicates or detaches a CodeFrame as a draft without source-authority cloning", () => {
    renderWorkbench();
    selectLayer(/Dashboard desktop.*CodeFrame/);

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
    expect(within(inspector).getByText("Kind: DraftFrame")).toBeTruthy();
    expect(
      within(inspector).getByText("Authority: canvas document"),
    ).toBeTruthy();
    expect(
      within(inspector).getByText(
        "Detached from src/routes/dashboard.tsx:24 at fixture@abc123",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(inspector).getByText("Kind: CodeFrame")).toBeTruthy();

    fireEvent.click(
      within(inspector).getByRole("button", {
        name: "Detach from source",
      }),
    );

    expect(within(inspector).getByText("Kind: DraftFrame")).toBeTruthy();
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

  it("lists source component masters as assets and duplicates them as instances", () => {
    render(<CanvasWorkbench project={sourceProjectFixture} />);

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

    expect(within(inspector).getByText("Instance · atom · button")).toBeTruthy();
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
    expect(
      screen.queryByRole("button", {
        name: "Button / Primary copy on canvas",
      }),
    ).toBeNull();
  }, 10_000);

  it("reveals a layer selected from the navigator in the current viewport", async () => {
    render(<CanvasWorkbench project={sourceProjectFixture} />);
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
    renderWorkbench({ onHarnessChange, onSendAgentContext });
    selectLayer(/Dashboard desktop.*CodeFrame/);

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
    fireEvent.blur(screen.getByRole("spinbutton", { name: "X" }));
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
    expect(submitted).toMatchObject({
      documentId: "document-northstar",
      harnessId: "claude",
      nodeIds: ["node-dashboard-desktop"],
      revision: 8,
      prompt: "Audit the spacing and propose a fix",
      promptMode: "plan",
      modelId: "gpt-5.5",
      permissionPolicy: "approval",
      reasoningEffort: "xhigh",
      capsule: {
        selectedIds: ["node-dashboard-desktop"],
      },
    });
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
    renderWorkbench({ runtimePort });
    selectLayer(/Dashboard desktop.*CodeFrame/);

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

  it("recovers local scene, semantic history, selection, and trace, then continues autosaving", async () => {
    localStorage.clear();
    const persistence = createCanvasAutosave(localStorage);
    const scene = {
      ...createSceneState(canvasWorkbenchFixture),
      selectedNodeId: "node-campaign-card",
      revision: 8,
      past: [
        {
          id: 1,
          label: "Move Dashboard desktop",
          before: canvasWorkbenchFixture.document.nodes,
          after: canvasWorkbenchFixture.document.nodes,
          beforeSelectedNodeId: "node-dashboard-desktop",
          afterSelectedNodeId: "node-campaign-card",
          beforeRevision: 7,
          afterRevision: 8,
        },
      ],
      nextHistoryId: 2,
    };
    const trace = [
      ...canvasWorkbenchFixture.trace,
      {
        id: "workbench-trace-7",
        action: "Recovered local edit",
        targetNodeId: "node-campaign-card",
      },
    ];
    expect(
      persistence.save(canvasWorkbenchFixture, scene, trace),
    ).toBe(true);

    renderWorkbench({ persistence });

    expect(
      selectLayer(/Campaign card.*DraftFrame/).getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Agent activity" }));
    expect(
      within(screen.getByRole("list", { name: "Semantic history" }))
        .getByText("Move Dashboard desktop"),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("log", { name: "Trace" })).getByText(
        "Recovered local edit",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Inspect" }));

    fireEvent.change(screen.getByRole("spinbutton", { name: "X" }), {
      target: { value: "999" },
    });
    fireEvent.blur(screen.getByRole("spinbutton", { name: "X" }));
    fireEvent.change(screen.getByRole("combobox", {
      name: "Agent harness",
    }), {
      target: { value: "claude" },
    });
    await waitFor(() => {
      const saved = persistence.load(canvasWorkbenchFixture);
      expect(saved?.scene.revision).toBe(9);
      expect(
        saved?.trace.some(({ id }) => id === "workbench-trace-8"),
      ).toBe(true);
      expect(
        saved?.trace.some(
          ({ id, action }) =>
            id.startsWith("editor-command-trace-") &&
            action.startsWith("Human ·"),
        ),
      ).toBe(true);
    });
  });

  it("persists an undo state with a future command and a monotonic history identity", async () => {
    localStorage.clear();
    const persistence = createCanvasAutosave(localStorage);
    renderWorkbench({ persistence });

    fireEvent.click(screen.getByRole("button", { name: "Rectangle tool" }));
    fireEvent.click(screen.getByRole("region", { name: "Infinite canvas" }), {
      clientX: 640,
      clientY: 360,
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => {
      const recovered = persistence.load(canvasWorkbenchFixture);
      expect(recovered?.scene.future).toHaveLength(1);
      expect(recovered?.scene.nextHistoryId).toBeGreaterThan(
        recovered?.scene.future[0]?.id ?? 0,
      );
    });
  });
});
