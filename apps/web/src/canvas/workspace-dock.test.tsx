import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  isAllowedLocalhostUrl,
  WorkspaceDock,
  type WorkspaceDockProps,
  type WorkspaceDockTab,
} from "./workspace-dock.js";
import {
  createDemoCanvasRuntimePort,
  type CanvasRuntimeRestorePreview,
} from "./canvas-runtime-port.js";
import { createAgentPatchReview } from "./agent-patch.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";

const trace = [
  {
    id: "trace-1",
    action: "Inspect selection",
    targetNodeId: "node-dashboard",
    harnessId: "codex",
  },
] as const;

const history = [
  {
    id: 1,
    label: "Move Dashboard desktop",
  },
] as const;

const files = [
  {
    id: "page-dashboard",
    kind: "page",
    name: "Dashboard page",
    detail: "/dashboard",
  },
  {
    id: "node-campaign",
    kind: "node",
    name: "Campaign card",
  },
] as const;

const settings = {
  harness: "Codex",
  model: "GPT-5.4",
  reasoning: "High",
  permission: "Ask before changes",
  connected: false,
} as const;

const workspaceDockCss = readFileSync(
  resolve("apps/web/src/canvas/workspace-dock.css"),
  "utf8",
);

function dockProps(
  overrides: Partial<WorkspaceDockProps> = {},
): WorkspaceDockProps {
  return {
    activeTab: "browser",
    browserAddress: "http://localhost:5173/dashboard",
    browserDocumentRevision: 7,
    browserLastGood: {
      documentRevision: 7,
      sessionId: "preview-session-1",
      url: "http://localhost:5173/dashboard",
      verifiedAt: "2026-07-29T06:30:00.000Z",
    },
    browserProjectId: "buzzr-ios-2-1",
    browserRevision: 1,
    browserSessionId: "preview-session-1",
    browserStatus: "ready",
    browserUrl: "http://localhost:5173/dashboard",
    collapsed: false,
    files,
    history,
    inspectorWidth: 320,
    onActiveTabChange: vi.fn(),
    onBrowserAddressChange: vi.fn(),
    onBrowserNavigate: vi.fn(),
    onBrowserReload: vi.fn(),
    onBrowserStop: vi.fn(),
    onCollapsedChange: vi.fn(),
    onSplitRatioChange: vi.fn(),
    settings,
    splitRatio: 0.5,
    trace,
    ...overrides,
  };
}

describe("isAllowedLocalhostUrl", () => {
  it.each([
    "http://localhost:3000",
    "http://localhost:5173/dashboard?mode=preview#main",
    "http://127.0.0.1:4173",
    "http://127.0.0.1:8080/nested/path",
  ])("accepts an explicit local HTTP preview URL: %s", (url) => {
    expect(isAllowedLocalhostUrl(url)).toBe(true);
  });

  it.each([
    "https://localhost:3000",
    "http://localhost",
    "http://127.0.0.1",
    "http://user:password@localhost:3000",
    "http://localhost.example.com:3000",
    "http://127.0.0.1.example.com:3000",
    "http://0.0.0.0:3000",
    "file:///tmp/index.html",
    "not a URL",
  ])("rejects a non-local or unsafe browser URL: %s", (url) => {
    expect(isAllowedLocalhostUrl(url)).toBe(false);
  });
});

describe("WorkspaceDock", () => {
  it("uses a declared Studio surface token for preview and agent panels", () => {
    expect(workspaceDockCss).not.toContain("--studio-surface-base");
    expect(workspaceDockCss).toContain(
      "background: var(--studio-surface-canvas);",
    );
  });

  it("renders the five controlled workspace tabs and reports tab changes", () => {
    const onActiveTabChange = vi.fn();
    render(<WorkspaceDock {...dockProps({ onActiveTabChange })} />);

    const tabs = screen.getByRole("tablist", { name: "Workspace tools" });
    expect(within(tabs).getAllByRole("tab")).toHaveLength(5);
    expect(within(tabs).getByRole("tab", { name: "Inspect" })).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: "Browser" })).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: "Runs" })).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: "Files" })).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: "Settings" })).toBeTruthy();

    fireEvent.click(within(tabs).getByRole("tab", { name: "Runs" }));
    expect(onActiveTabChange).toHaveBeenCalledWith("runs");
  });

  it("renders icon-only tabs with accessible labels and native tooltips", () => {
    render(<WorkspaceDock {...dockProps()} />);

    const tabs = screen.getByRole("tablist", { name: "Workspace tools" });

    for (const name of ["Inspect", "Browser", "Runs", "Files", "Settings"]) {
      const tab = within(tabs).getByRole("tab", { name });
      expect(tab.textContent).toBe("");
      expect(tab.getAttribute("title")).toContain(name);
      expect(tab.querySelector("svg")).toBeTruthy();
    }
  });

  it("uses the compact inspector width and a bounded split for Browser and Runs", () => {
    const props = dockProps({
      activeTab: "inspect",
      inspectorWidth: 412,
    });
    const { rerender } = render(<WorkspaceDock {...props} />);

    const inspectorDock = screen.getByRole("complementary", {
      name: "Workspace",
    });
    expect(inspectorDock.getAttribute("data-layout")).toBe("inspector");
    expect(inspectorDock.getAttribute("style")).toContain(
      "--workspace-dock-width: 412px",
    );
    expect(screen.queryByRole("separator")).toBeNull();

    rerender(<WorkspaceDock {...props} activeTab="browser" />);
    const splitDock = screen.getByRole("complementary", {
      name: "Workspace",
    });
    expect(splitDock.getAttribute("data-layout")).toBe("split");
    expect(screen.getByRole("separator", { name: "Resize workspace" }))
      .toBeTruthy();

    rerender(<WorkspaceDock {...props} activeTab="runs" />);
    expect(
      screen.getByRole("complementary", { name: "Workspace" }).getAttribute(
        "data-layout",
      ),
    ).toBe("split");
  });

  it("restores a controlled split ratio and reports keyboard resize writeback", () => {
    const onSplitRatioChange = vi.fn();
    const originalWidth = globalThis.innerWidth;
    Object.defineProperty(globalThis, "innerWidth", {
      configurable: true,
      value: 1_440,
    });

    try {
      render(
        <WorkspaceDock
          {...dockProps({
            onSplitRatioChange,
            splitRatio: 0.6,
          })}
        />,
      );

      const separator = screen.getByRole("separator", {
        name: "Resize workspace",
      });
      expect(separator.getAttribute("aria-valuenow")).toBe("864");

      fireEvent.keyDown(separator, { key: "ArrowRight" });
      expect(onSplitRatioChange).toHaveBeenCalledWith(
        848 / 1_440,
      );
    } finally {
      Object.defineProperty(globalThis, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    }
  });

  it("resizes the split from the keyboard within its declared bounds", () => {
    render(<WorkspaceDock {...dockProps({ activeTab: "browser" })} />);

    const separator = screen.getByRole("separator", {
      name: "Resize workspace",
    });
    const initialWidth = Number(separator.getAttribute("aria-valuenow"));
    fireEvent.keyDown(separator, { key: "ArrowRight" });

    expect(Number(separator.getAttribute("aria-valuenow"))).toBe(
      initialWidth - 16,
    );
    expect(Number(separator.getAttribute("aria-valuemin"))).toBeGreaterThan(0);
    expect(Number(separator.getAttribute("aria-valuemax"))).toBeGreaterThan(
      Number(separator.getAttribute("aria-valuemin")),
    );
  });

  it("resizes the split continuously from its left-edge pointer handle", () => {
    render(<WorkspaceDock {...dockProps({ activeTab: "browser" })} />);

    const separator = screen.getByRole("separator", {
      name: "Resize workspace",
    });
    const initialWidth = Number(separator.getAttribute("aria-valuenow"));

    fireEvent.pointerDown(separator, { clientX: 600, pointerId: 7 });
    fireEvent.pointerMove(separator, { clientX: 632, pointerId: 7 });
    fireEvent.pointerUp(separator, { clientX: 632, pointerId: 7 });

    expect(Number(separator.getAttribute("aria-valuenow"))).toBe(
      initialWidth - 32,
    );
  });

  it("reclamps a wide split when the host window becomes narrower", () => {
    const originalWidth = globalThis.innerWidth;
    Object.defineProperty(globalThis, "innerWidth", {
      configurable: true,
      value: 1728,
    });

    try {
      render(<WorkspaceDock {...dockProps({ activeTab: "browser" })} />);
      const separator = screen.getByRole("separator", {
        name: "Resize workspace",
      });
      expect(separator.getAttribute("aria-valuenow")).toBe("864");

      Object.defineProperty(globalThis, "innerWidth", {
        configurable: true,
        value: 1000,
      });
      fireEvent(globalThis.window, new Event("resize"));

      expect(separator.getAttribute("aria-valuenow")).toBe("432");
      expect(separator.getAttribute("aria-valuemax")).toBe("432");
    } finally {
      Object.defineProperty(globalThis, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    }
  });

  it("supports roving keyboard navigation across tabs", () => {
    const onActiveTabChange = vi.fn();
    render(<WorkspaceDock {...dockProps({ onActiveTabChange })} />);

    const browserTab = screen.getByRole("tab", { name: "Browser" });
    const runsTab = screen.getByRole("tab", { name: "Runs" });
    browserTab.focus();
    fireEvent.keyDown(browserTab, { key: "ArrowRight" });

    expect(onActiveTabChange).toHaveBeenCalledWith("runs");
    expect(document.activeElement).toBe(runsTab);
  });

  it.each([
    ["ArrowLeft", "inspect"],
    ["Home", "inspect"],
    ["End", "settings"],
  ] as const)("handles %s in the workspace tablist", (key, expectedTab) => {
    const onActiveTabChange = vi.fn();
    render(<WorkspaceDock {...dockProps({ onActiveTabChange })} />);

    const browserTab = screen.getByRole("tab", { name: "Browser" });
    fireEvent.keyDown(browserTab, { key });

    expect(onActiveTabChange).toHaveBeenCalledWith(expectedTab);
    expect(document.activeElement).toBe(
      screen.getByRole("tab", {
        name: expectedTab[0]?.toUpperCase() + expectedTab.slice(1),
      }),
    );
  });

  it("wraps ArrowRight from the final tab", () => {
    const onActiveTabChange = vi.fn();
    render(
      <WorkspaceDock
        {...dockProps({ activeTab: "settings", onActiveTabChange })}
      />,
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: "Settings" }), {
      key: "ArrowRight",
    });

    expect(onActiveTabChange).toHaveBeenCalledWith("inspect");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Inspect" }),
    );
  });

  it("keeps collapse state controlled and leaves an accessible expand action", () => {
    const onCollapsedChange = vi.fn();
    const props = dockProps({ onCollapsedChange });
    const { rerender } = render(<WorkspaceDock {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse workspace" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);

    rerender(<WorkspaceDock {...props} collapsed />);
    expect(screen.queryByRole("tabpanel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand workspace" }));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });

  it("validates the controlled address before requesting navigation", () => {
    const onBrowserAddressChange = vi.fn();
    const onBrowserNavigate = vi.fn();
    const props = dockProps({
      browserAddress: "https://example.com",
      onBrowserAddressChange,
      onBrowserNavigate,
    });
    const { rerender } = render(<WorkspaceDock {...props} />);

    const address = screen.getByRole("textbox", { name: "Preview address" });
    expect(address.getAttribute("aria-invalid")).toBe("true");
    expect(
      (
        screen.getByRole("button", {
          name: "Open preview",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/localhost URL with an explicit port/i),
    ).toBeTruthy();

    fireEvent.change(address, {
      target: { value: "http://localhost:4173" },
    });
    expect(onBrowserAddressChange).toHaveBeenCalledWith(
      "http://localhost:4173",
    );

    rerender(
      <WorkspaceDock
        {...props}
        browserAddress="http://localhost:4173"
      />,
    );
    expect(screen.getByTitle("Local workspace preview").getAttribute("src")).toBe(
      "http://localhost:5173/dashboard",
    );
    fireEvent.submit(screen.getByRole("form", { name: "Preview address" }));
    expect(onBrowserNavigate).toHaveBeenCalledWith(
      "http://localhost:4173",
    );
  });

  it("refuses to embed the editor origin even when it is localhost", () => {
    const editorOrigin = globalThis.location.origin;
    render(
      <WorkspaceDock
        {...dockProps({
          browserAddress: editorOrigin,
          browserUrl: editorOrigin,
        })}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Open preview",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByTitle("Local workspace preview")).toBeNull();
  });

  it("allows only the explicit deterministic demo route on the editor origin", () => {
    const demoUrl = `${globalThis.location.origin}/demo-preview.html`;
    render(
      <WorkspaceDock
        {...dockProps({
          browserAddress: demoUrl,
          browserStatus: "connecting",
          browserUrl: demoUrl,
        })}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Open preview",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.getByTitle("Local workspace preview").getAttribute("src"))
      .toContain("/demo-preview.html?");
  });

  it("treats localhost aliases on the editor port as the same origin", () => {
    const current = new URL(globalThis.location.origin);
    const alias =
      current.hostname === "localhost" ? "127.0.0.1" : "localhost";
    const aliasOrigin = `${current.protocol}//${alias}${
      current.port === "" ? "" : `:${current.port}`
    }`;
    render(
      <WorkspaceDock
        {...dockProps({
          browserAddress: aliasOrigin,
          browserUrl: aliasOrigin,
        })}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Open preview",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByTitle("Local workspace preview")).toBeNull();
  });

  it("renders an isolated iframe only for an allowed browser URL", () => {
    const onBrowserReload = vi.fn();
    const onBrowserStop = vi.fn();
    render(
      <WorkspaceDock
        {...dockProps({ onBrowserReload, onBrowserStop })}
      />,
    );

    const preview = screen.getByTitle("Local workspace preview");
    expect(preview.tagName).toBe("IFRAME");
    expect(preview.getAttribute("src")).toBe(
      "http://localhost:5173/dashboard",
    );
    expect(preview.getAttribute("sandbox")).toContain("allow-scripts");
    expect(preview.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    expect(preview.getAttribute("sandbox")).not.toContain("allow-popups");
    expect(screen.getByRole("status").textContent).toMatch(/ready/i);

    fireEvent.click(screen.getByRole("button", { name: "Reload preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
    expect(onBrowserReload).toHaveBeenCalledOnce();
    expect(onBrowserStop).toHaveBeenCalledOnce();
  });

  it("never treats an arbitrary localhost frame message as verified preview evidence", () => {
    const onBrowserReady = vi.fn();
    render(<WorkspaceDock {...dockProps({ onBrowserReady })} />);

    const preview = screen.getByTitle(
      "Local workspace preview",
    ) as HTMLIFrameElement;
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "memi:preview-ready",
          documentRevision: 7,
          projectId: "buzzr-ios-2-1",
          sessionId: "preview-session-1",
          verifiedAt: "2026-07-29T06:30:00.000Z",
        },
        origin: new URL(preview.src).origin,
        source: preview.contentWindow,
      }),
    );

    expect(onBrowserReady).not.toHaveBeenCalled();
  });

  it("accepts revision-bound readiness from the isolated built-in preview fixture", () => {
    const demoUrl = `${globalThis.location.origin}/demo-preview.html`;
    const onBrowserReady = vi.fn();
    render(
      <WorkspaceDock
        {...dockProps({
          browserAddress: demoUrl,
          browserStatus: "connecting",
          browserUrl: demoUrl,
          onBrowserReady,
        })}
      />,
    );

    const preview = screen.getByTitle(
      "Local workspace preview",
    ) as HTMLIFrameElement;
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "memi:preview-ready",
          documentRevision: 7,
          projectId: "buzzr-ios-2-1",
          sessionId: "preview-session-1",
          verifiedAt: "2026-07-29T06:30:00.000Z",
        },
        origin: globalThis.location.origin,
        source: preview.contentWindow,
      }),
    );

    expect(onBrowserReady).toHaveBeenCalledWith({
      documentRevision: 7,
      projectId: "buzzr-ios-2-1",
      sessionId: "preview-session-1",
      verifiedAt: "2026-07-29T06:30:00.000Z",
    });
  });

  it("opens a valid running localhost preview in Helium through the host callback", () => {
    const onOpenInHelium = vi.fn();
    render(
      <WorkspaceDock
        {...dockProps({
          onOpenInHelium,
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open preview in Helium" }),
    );
    expect(onOpenInHelium).toHaveBeenCalledWith(
      "http://localhost:5173/dashboard",
    );
  });

  it("does not offer Helium for an invalid or unavailable preview", () => {
    const props = dockProps({
      browserUrl: "https://example.com",
      onOpenInHelium: vi.fn(),
    });
    const { rerender } = render(<WorkspaceDock {...props} />);

    expect(
      screen.queryByRole("button", { name: "Open preview in Helium" }),
    ).toBeNull();

    rerender(
      <WorkspaceDock
        {...props}
        browserUnavailableReason="Preview process stopped."
        browserUrl="http://localhost:4173"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Open preview in Helium" }),
    ).toBeNull();
  });

  it("shows an explicit unavailable state instead of an iframe", () => {
    render(
      <WorkspaceDock
        {...dockProps({
          browserUnavailableReason:
            "Start the local preview server to browse this workspace.",
        })}
      />,
    );

    expect(screen.queryByTitle("Local workspace preview")).toBeNull();
    expect(
      screen.getByText(
        "Start the local preview server to browse this workspace.",
      ),
    ).toBeTruthy();
  });

  it("displays supplied trace and history in Runs", () => {
    render(<WorkspaceDock {...dockProps({ activeTab: "runs" })} />);

    expect(screen.getByRole("log", { name: "Trace" })).toBeTruthy();
    expect(screen.getByText("Inspect selection")).toBeTruthy();
    expect(screen.getByText("node-dashboard")).toBeTruthy();
    expect(
      within(
        screen.getByRole("list", { name: "Semantic history" }),
      ).getByText("Move Dashboard desktop"),
    ).toBeTruthy();
  });

  it("keeps approve, apply, verify, request changes, rollback, and restore as explicit actions", async () => {
    vi.useFakeTimers();
    const port = createDemoCanvasRuntimePort();
    const submission = await port.submit({
      documentId: canvasWorkbenchFixture.document.id,
      documentNodes: canvasWorkbenchFixture.document.nodes,
      documentRevision: canvasWorkbenchFixture.document.revision,
      harnessId: "codex",
      modelId: "gpt-5.5",
      permissionPolicy: "approval",
      projectId: canvasWorkbenchFixture.id,
      prompt: "Create a canvas-only draft.",
      promptMode: "propose",
      reasoningEffort: "xhigh",
      selectedNodeIds: ["node-campaign-card"],
      viewport: { height: 700, width: 1000, x: 0, y: 0, zoom: 1 },
    });
    await vi.runAllTimersAsync();
    const waiting = await port.getRun(submission.runId);
    const review = createAgentPatchReview(
      waiting.proposal!.patch,
      waiting.proposal!.baseRevision,
    );
    const onApproveAgentPatch = vi.fn();
    const onApplyAgentPatch = vi.fn();
    const onRequestAgentChanges = vi.fn();
    const onVerifyAgentPatch = vi.fn();
    const onRestoreCheckpoint = vi.fn();
    const onCancelRestore = vi.fn();
    const onConfirmRestore = vi.fn();
    const onRollbackAgentPatch = vi.fn();
    const props = dockProps({
      activeTab: "runs",
      agentPatchReview: review,
      onApplyAgentPatch,
      onApproveAgentPatch,
      onCancelRestore,
      onConfirmRestore,
      onRequestAgentChanges,
      onRestoreCheckpoint,
      onRollbackAgentPatch,
      onVerifyAgentPatch,
      runtimeSnapshot: waiting,
    });
    const { rerender } = render(<WorkspaceDock {...props} />);

    expect(
      screen.getByRole("heading", { name: "Task", level: 3 }),
    ).toBeTruthy();
    expect(screen.getByText("Create a canvas-only draft.")).toBeTruthy();
    expect(screen.getByRole("log", { name: "Agent activity" })).toBeTruthy();
    expect(
      screen.getByText(/private model reasoning is never displayed/i),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /approve agent patch/i }));
    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    expect(onApproveAgentPatch).toHaveBeenCalledOnce();
    expect(onRequestAgentChanges).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /apply agent patch/i })).toBeNull();

    const approval = await port.approve({
      baseRevision: waiting.proposal!.baseRevision,
      proposalDigest: waiting.proposal!.digest,
      proposalId: waiting.proposal!.id,
      runId: waiting.runId,
    });
    const approved = await port.getRun(waiting.runId);
    rerender(<WorkspaceDock {...props} runtimeSnapshot={approved} />);
    fireEvent.click(screen.getByRole("button", { name: /apply agent patch/i }));
    expect(onApplyAgentPatch).toHaveBeenCalledOnce();

    const applying = await port.apply({
      approval,
      currentRevision: waiting.proposal!.baseRevision,
      runId: waiting.runId,
    });
    const appliedReview = {
      ...review,
      currentRevision: review.currentRevision + 1,
      message: "Applied through the command bus.",
      status: "applied" as const,
    };
    rerender(
      <WorkspaceDock
        {...props}
        agentPatchReview={appliedReview}
        runtimeSnapshot={applying}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /verify agent patch/i }));
    expect(onVerifyAgentPatch).toHaveBeenCalledOnce();

    const complete = await port.verify({
      documentNodes: waiting.proposal!.patch.proposedNodes,
      documentRevision: waiting.proposal!.baseRevision + 1,
      previewEvidence: {
        documentRevision: waiting.proposal!.baseRevision + 1,
        projectId: canvasWorkbenchFixture.id,
        sessionId: "preview-session-test",
        verifiedAt: "2026-07-29T06:31:00.000Z",
      },
      runId: waiting.runId,
    });
    const checkpoint = await port.checkpoint({
      documentNodes: complete.proposal!.patch.proposedNodes,
      documentRevision: waiting.proposal!.baseRevision + 1,
      runId: waiting.runId,
      selectedNodeIds: ["node-campaign-card"],
    });
    rerender(
      <WorkspaceDock
        {...props}
        agentPatchReview={appliedReview}
        runtimeSnapshot={{ ...complete, checkpoint }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /restore checkpoint/i }));
    const restorePreview: CanvasRuntimeRestorePreview = {
      changedNodeCount: 2,
      checkpoint,
      checkpointNodeCount: checkpoint.documentNodes.length,
      currentDocumentRevision: checkpoint.documentRevision + 1,
      currentNodeCount: checkpoint.documentNodes.length + 1,
      effectsExcluded: true,
      expectedDocumentDigest: complete.verification!.documentDigest,
      id: "restore-preview-test",
      projectId: canvasWorkbenchFixture.id,
    };
    rerender(
      <WorkspaceDock
        {...props}
        agentPatchReview={appliedReview}
        restorePreview={restorePreview}
        runtimeSnapshot={{ ...complete, checkpoint }}
      />,
    );
    const dialog = screen.getByRole("dialog", {
      name: "Review checkpoint restore",
    });
    expect(document.activeElement).toBe(dialog);
    expect(within(dialog).getByText(/2 canvas nodes change/i)).toBeTruthy();
    expect(within(dialog).getByText(/external actions are excluded/i)).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm restore" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /roll back applied draft/i }),
    );
    expect(onRestoreCheckpoint).toHaveBeenCalledOnce();
    expect(onCancelRestore).toHaveBeenCalledOnce();
    expect(onConfirmRestore).toHaveBeenCalledOnce();
    expect(onRollbackAgentPatch).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("warns when the Demo thread is not durably recoverable", () => {
    const runtimeSnapshot = {
      approval: null,
      checkpoint: null,
      durability: {
        reason: "Quota exceeded",
        status: "volatile" as const,
      },
      envelope: {
        documentId: "document-1",
        documentNodes: [],
        documentRevision: 1,
        harnessId: "codex",
        modelId: "gpt-5.5",
        permissionPolicy: "approval" as const,
        projectId: "project-1",
        prompt: "Inspect",
        promptMode: "plan" as const,
        reasoningEffort: "xhigh" as const,
        selectedNodeIds: ["node-1"],
        viewport: { height: 700, width: 1000, x: 0, y: 0, zoom: 1 },
      },
      events: [],
      proposal: null,
      runId: "run-1",
      state: "Ready" as const,
      threadId: "thread-1",
      verification: null,
    };
    render(
      <WorkspaceDock
        {...dockProps({
          activeTab: "runs",
          runtimeSnapshot,
        })}
      />,
    );

    expect(screen.getByRole("alert").textContent).toMatch(
      /recovery unavailable.*quota exceeded/i,
    );
  });

  it("displays supplied node and page names in Files", () => {
    render(<WorkspaceDock {...dockProps({ activeTab: "files" })} />);

    const fileList = screen.getByRole("list", { name: "Workspace files" });
    expect(within(fileList).getByText("Dashboard page")).toBeTruthy();
    expect(within(fileList).getByText("/dashboard")).toBeTruthy();
    expect(within(fileList).getByText("Campaign card")).toBeTruthy();
  });

  it("shows controlled settings with a safe disconnected status", () => {
    render(<WorkspaceDock {...dockProps({ activeTab: "settings" })} />);

    const panel = screen.getByRole("tabpanel", { name: "Settings" });
    expect(within(panel).getByText("Codex")).toBeTruthy();
    expect(within(panel).getByText("GPT-5.4")).toBeTruthy();
    expect(within(panel).getByText("High")).toBeTruthy();
    expect(within(panel).getByText("Ask before changes")).toBeTruthy();
    expect(
      within(panel).getByRole("status").textContent,
    ).toMatch(/disconnected.*local preview only/i);
  });

  it.each<WorkspaceDockTab>(["runs", "files"])(
    "renders a useful empty state for an empty %s panel",
    (activeTab) => {
      render(
        <WorkspaceDock
          {...dockProps({
            activeTab,
            files: [],
            history: [],
            trace: [],
          })}
        />,
      );

      expect(screen.getByRole("tabpanel").textContent).toMatch(
        /no (runs|files)/i,
      );
    },
  );
});
