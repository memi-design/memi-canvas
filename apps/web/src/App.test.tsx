import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";

const verifiedEvidence = {
  evidenceLevel: "verified",
  sourceRevision: "fixture@abc123",
  sourceAnchor: "src/screens/Dashboard.tsx:24",
  runtimeEvidence: "Fixture runtime reproduced",
  validationResult: "passed",
} as const;

const projectFixture = {
  id: "northstar-commerce",
  title: "Northstar Commerce",
  status: "Imported",
  coverage: {
    requiredCaptureIds: [
      "dashboard-desktop",
      "dashboard-tablet",
      "dashboard-mobile",
      "checkout-desktop",
      "checkout-tablet",
      "checkout-mobile",
    ],
  },
  screens: [
    {
      id: "dashboard-default",
      name: "Dashboard",
      route: "/dashboard",
      state: "Default",
      captures: [
        {
          id: "dashboard-desktop",
          viewport: "desktop",
          label: "Desktop",
          dimensions: "1440 × 900",
          coverageHealth: "current",
          frameKind: "CodeFrame",
          ...verifiedEvidence,
        },
        {
          id: "dashboard-tablet",
          viewport: "tablet",
          label: "Tablet",
          dimensions: "834 × 1112",
          coverageHealth: "current",
          frameKind: "CodeFrame",
          ...verifiedEvidence,
        },
        {
          id: "dashboard-mobile",
          viewport: "mobile",
          label: "Mobile",
          dimensions: "390 × 844",
          coverageHealth: "current",
          frameKind: "CodeFrame",
          ...verifiedEvidence,
        },
      ],
    },
    {
      id: "checkout-validation-error",
      name: "Checkout",
      route: "/checkout",
      state: "Validation error",
      captures: [
        {
          id: "checkout-desktop",
          viewport: "desktop",
          label: "Desktop",
          dimensions: "1440 × 900",
          coverageHealth: "current",
          frameKind: "CodeFrame",
          evidenceLevel: "verified",
          sourceRevision: "fixture@abc123",
          sourceAnchor: "src/screens/Checkout.tsx:88",
          runtimeEvidence: "Validation-error fixture reproduced",
          validationResult: "passed",
        },
        {
          id: "checkout-tablet",
          viewport: "tablet",
          label: "Tablet",
          dimensions: "834 × 1112",
          coverageHealth: "blocked",
          blocker: "Fixture for validation state is unavailable",
          attemptedEvidence: "Route discovery and isolated preview startup",
        },
        {
          id: "checkout-mobile",
          viewport: "mobile",
          label: "Mobile",
          dimensions: "390 × 844",
          coverageHealth: "partial",
          frameKind: "CodeFrame",
          evidenceLevel: "observed",
          missingEvidence: "Current source anchor and validation result",
        },
      ],
    },
  ],
  selectedCaptureId: "checkout-desktop",
  task: {
    id: "task-mobile-checkout",
    title: "Correct checkout spacing",
    status: "Awaiting approval",
    harness: "codex",
    harnesses: [
      { id: "codex", label: "Codex" },
      { id: "claude", label: "Claude" },
    ],
  },
  trace: [
    {
      id: "trace-context",
      type: "context",
      status: "complete",
      actorKind: "human",
      actor: "Sarvesh",
      action: "Attached Checkout · Desktop",
      timestamp: "10:42:01",
      targetCaptureId: "checkout-desktop",
      targetLabel: "Checkout · Desktop",
    },
    {
      id: "trace-routing",
      type: "routing",
      status: "complete",
      actorKind: "human",
      actor: "Sarvesh",
      action: "Selected Codex harness",
      timestamp: "10:42:03",
      harness: "Codex",
      targetCaptureId: "checkout-desktop",
      targetLabel: "Checkout · Desktop",
    },
    {
      id: "trace-task",
      type: "task",
      status: "complete",
      actorKind: "agent",
      actor: "Codex",
      action: "Started task",
      timestamp: "10:42:04",
      harness: "Codex",
      targetCaptureId: "checkout-desktop",
      targetLabel: "Checkout · Desktop",
    },
    {
      id: "trace-plan",
      type: "plan",
      status: "complete",
      actorKind: "agent",
      actor: "Codex",
      action: "Published plan",
      timestamp: "10:42:06",
      harness: "Codex",
      targetCaptureId: "dashboard-tablet",
      targetLabel: "Dashboard · Tablet",
    },
    {
      id: "trace-proposal",
      type: "proposal",
      status: "complete",
      actorKind: "agent",
      actor: "Codex",
      action: "Created spacing proposal",
      timestamp: "10:42:08",
      harness: "Codex",
      targetCaptureId: "checkout-desktop",
      targetLabel: "Checkout · Desktop",
    },
    {
      id: "trace-approval",
      type: "approval",
      status: "waiting",
      actorKind: "system",
      actor: "Memi",
      action: "Requested approval",
      timestamp: "10:42:09",
      targetCaptureId: "checkout-desktop",
      targetLabel: "Checkout · Desktop",
    },
  ],
} as const;

describe("M0 imported product workspace", () => {
  it("identifies fixture-backed import truth and derives verified coverage", () => {
    render(<App project={projectFixture} />);

    const banner = screen.getByRole("banner");
    expect(
      within(banner).getByRole("heading", {
        level: 1,
        name: "Northstar Commerce",
      }),
    ).toBeTruthy();
    expect(within(banner).getByText("Imported")).toBeTruthy();
    expect(
      within(banner).getByText(
        "Demo · Fixture-backed; no live model or repository write occurred.",
      ),
    ).toBeTruthy();

    const coverage = screen.getByRole("status", {
      name: "Import coverage",
    });
    expect(
      within(coverage).getByText("4 of 6 required states verified"),
    ).toBeTruthy();
    expect(within(coverage).getByText("1 partial")).toBeTruthy();
    expect(within(coverage).getByText("1 blocked")).toBeTruthy();
    expect(within(coverage).getByText("Incomplete")).toBeTruthy();
  });

  it("renders rich responsive matrix labels without assigning a frame to blocked cells", () => {
    render(<App project={projectFixture} />);

    const matrix = screen.getByRole("table", {
      name: "Responsive screen matrix",
    });
    expect(
      within(matrix)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Screen", "Desktop", "Tablet", "Mobile"]);

    expect(
      within(matrix).getByRole("button", {
        name: "Dashboard Default Desktop, CodeFrame, Verified evidence, Current coverage",
      }),
    ).toBeTruthy();
    expect(
      within(matrix).getByRole("button", {
        name: "Checkout Validation error Mobile, CodeFrame, Observed evidence, Partial coverage",
      }),
    ).toBeTruthy();
    expect(
      within(matrix).getByRole("button", {
        name: /Checkout Validation error Tablet, Blocked coverage.*Fixture for validation state is unavailable/,
      }),
    ).toBeTruthy();
  });

  it("shows independent frame, evidence, coverage, and source-anchor truth", () => {
    render(<App project={projectFixture} />);

    const context = screen.getByRole("region", {
      name: "Selected screen context",
    });
    expect(
      within(context).getByRole("heading", {
        level: 2,
        name: "Checkout",
      }),
    ).toBeTruthy();
    expect(within(context).getByText("Desktop · 1440 × 900")).toBeTruthy();
    expect(within(context).getByText("CodeFrame")).toBeTruthy();
    expect(within(context).getByText("Verified evidence")).toBeTruthy();
    expect(within(context).getByText("Current coverage")).toBeTruthy();
    expect(within(context).getByText("fixture@abc123")).toBeTruthy();
    expect(
      within(context).getByText("src/screens/Checkout.tsx:88"),
    ).toBeTruthy();
    expect(within(context).getByText("Validation passed")).toBeTruthy();
    expect(within(context).queryByText("Source-backed evidence")).toBeNull();
  });

  it("supports horizontal and vertical matrix keyboard navigation", () => {
    render(<App project={projectFixture} />);

    const dashboardDesktop = screen.getByRole("button", {
      name: /Dashboard Default Desktop, CodeFrame/,
    });
    const dashboardTablet = screen.getByRole("button", {
      name: /Dashboard Default Tablet, CodeFrame/,
    });
    const checkoutDesktop = screen.getByRole("button", {
      name: /Checkout Validation error Desktop, CodeFrame/,
    });

    dashboardDesktop.focus();
    fireEvent.keyDown(dashboardDesktop, { key: "ArrowRight" });
    expect(document.activeElement).toBe(dashboardTablet);

    fireEvent.keyDown(dashboardTablet, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(dashboardDesktop);

    fireEvent.keyDown(dashboardDesktop, { key: "ArrowDown" });
    expect(document.activeElement).toBe(checkoutDesktop);

    fireEvent.keyDown(checkoutDesktop, { key: "ArrowUp" });
    expect(document.activeElement).toBe(dashboardDesktop);

    fireEvent.keyDown(dashboardDesktop, { key: "End" });
    const dashboardMobile = screen.getByRole("button", {
      name: /Dashboard Default Mobile, CodeFrame/,
    });
    expect(document.activeElement).toBe(dashboardMobile);

    fireEvent.keyDown(dashboardMobile, { key: "Home" });
    expect(document.activeElement).toBe(dashboardDesktop);
  });

  it("provides F6 region cycling and a non-spatial screen outline", () => {
    render(<App project={projectFixture} />);

    const workspace = screen.getByRole("main", { name: "Canvas workspace" });
    const inspector = screen.getByRole("complementary", {
      name: "Inspector and collaboration",
    });
    const trace = screen.getByRole("log", { name: "Trace" });

    const dashboardDesktop = screen.getByRole("button", {
      name: /Dashboard Default Desktop, CodeFrame/,
    });
    dashboardDesktop.focus();
    fireEvent.keyDown(dashboardDesktop, { key: "F6" });
    expect(document.activeElement).toBe(inspector);
    fireEvent.keyDown(inspector, { key: "F6" });
    expect(document.activeElement).toBe(trace);
    fireEvent.keyDown(trace, { key: "F6", shiftKey: true });
    expect(document.activeElement).toBe(inspector);

    const outline = within(workspace).getByRole("navigation", {
      name: "Screen outline",
    });
    fireEvent.click(
      within(outline).getByRole("button", {
        name: "Outline Dashboard Default Tablet",
      }),
    );
    expect(
      within(
        screen.getByRole("region", { name: "Selected screen context" }),
      ).getByText("Tablet · 834 × 1112"),
    ).toBeTruthy();
  });

  it("shows blocked evidence attempts and a working Resolve capture action", () => {
    render(<App project={projectFixture} />);

    const blocked = screen.getByRole("button", {
      name: /Checkout Validation error Tablet, Blocked coverage/,
    });
    expect(
      within(blocked).getByText(
        "Fixture for validation state is unavailable",
      ),
    ).toBeTruthy();
    expect(
      within(blocked).getByText(
        "Attempted: Route discovery and isolated preview startup",
      ),
    ).toBeTruthy();
    expect(within(blocked).getByText("Resolve capture")).toBeTruthy();
    expect(blocked.querySelector(".capture-cell__preview")).toBeNull();

    fireEvent.click(blocked);
    expect(
      screen.getByRole("status", { name: "Capture resolution" }).textContent,
    ).toMatch(/Fixture for validation state is unavailable/);
  });

  it("keeps task context visible and appends a routing event on harness switch", () => {
    const onHarnessChange = vi.fn();
    render(
      <App project={projectFixture} onHarnessChange={onHarnessChange} />,
    );

    const task = screen.getByRole("article", {
      name: "Agent task: Correct checkout spacing",
    });
    expect(within(task).getByText("Checkout · Desktop")).toBeTruthy();
    expect(within(task).getByText("Canvas write")).toBeTruthy();
    expect(
      within(task).getByText(
        "Reversible canvas proposal only. No source write, commit, push, or deploy.",
      ),
    ).toBeTruthy();

    fireEvent.change(
      within(task).getByRole("combobox", { name: "Harness" }),
      { target: { value: "claude" } },
    );

    expect(onHarnessChange).toHaveBeenCalledWith("claude");
    expect(within(task).getByText("Checkout · Desktop")).toBeTruthy();
    expect(
      within(screen.getByRole("log", { name: "Trace" })).getByText(
        "Switched harness from Codex to Claude",
      ),
    ).toBeTruthy();
  });

  it("shows the truthful pre-approval causal trace and locates event targets", () => {
    render(<App project={projectFixture} />);

    const trace = screen.getByRole("log", { name: "Trace" });
    const events = within(trace).getAllByRole("listitem");
    expect(events).toHaveLength(6);
    expect(events.map((event) => event.textContent)).toEqual([
      expect.stringMatching(/Context.*Complete.*Human.*Sarvesh.*Attached/),
      expect.stringMatching(/Routing.*Complete.*Human.*Sarvesh.*Codex/),
      expect.stringMatching(/Task.*Complete.*Agent.*Codex.*Started/),
      expect.stringMatching(/Plan.*Complete.*Agent.*Codex.*Published/),
      expect.stringMatching(/Proposal.*Complete.*Agent.*Codex.*Created/),
      expect.stringMatching(/Approval.*Waiting.*System.*Memi.*Requested/),
    ]);

    fireEvent.click(
      within(trace).getByRole("button", {
        name: "Locate target for Published plan",
      }),
    );
    const context = screen.getByRole("region", {
      name: "Selected screen context",
    });
    expect(
      within(context).getByRole("heading", {
        level: 2,
        name: "Dashboard",
      }),
    ).toBeTruthy();
    expect(within(context).getByText("Tablet · 834 × 1112")).toBeTruthy();
  });
});
