import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  App,
  type AvailableCapture,
  type EvidenceLevel,
  type ImportedProject,
  type VerifiedCapture,
} from "./App";
import { demoProject } from "./demo-project";

const baseScreen = demoProject.screens[0]!;
const baseCell = baseScreen.captures[0]!;

function projectWithEvidence(
  evidenceLevel: EvidenceLevel,
): ImportedProject {
  const capture: AvailableCapture = {
    id: `evidence-${evidenceLevel}`,
    viewport: "desktop",
    label: "Desktop",
    dimensions: "1440 × 900",
    coverageHealth: "current",
    frameKind: "CodeFrame",
    evidenceLevel,
    ...(evidenceLevel === "verified"
      ? {
          sourceRevision: "fixture@verified",
          sourceAnchor: "src/App.tsx:1",
          runtimeEvidence: "Fixture reproduced",
          validationResult: "passed",
        }
      : {}),
  } as AvailableCapture;

  return {
    ...demoProject,
    screens: [
      {
        ...baseScreen,
        captures: [capture],
      },
    ],
    selectedCaptureId: capture.id,
  };
}

describe("M0 workspace branch behavior", () => {
  it.each<[EvidenceLevel, string]>([
    ["verified", "Verified evidence"],
    ["observed", "Observed evidence"],
    ["inferred", "Inferred evidence"],
    ["reference", "Reference evidence"],
    ["proposed", "Proposed evidence"],
  ])("labels %s evidence without upgrading its truth", (level, label) => {
    render(<App project={projectWithEvidence(level)} />);

    expect(
      within(
        screen.getByRole("region", { name: "Selected screen context" }),
      ).getByText(label),
    ).toBeTruthy();
  });

  it("ignores unmatched matrix keys and selects with Space", () => {
    render(<App project={demoProject} />);

    const tablet = screen.getByRole("button", {
      name: /Dashboard Default Tablet, CodeFrame/,
    });
    const mobile = screen.getByRole("button", {
      name: /Dashboard Default Mobile, CodeFrame/,
    });

    tablet.focus();
    fireEvent.keyDown(tablet, { key: "PageDown" });
    expect(document.activeElement).toBe(tablet);

    mobile.focus();
    fireEvent.keyDown(mobile, { key: " " });
    expect(mobile.getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back to the first known frame when a stored selection is missing", () => {
    render(
      <App
        project={{
          ...demoProject,
          selectedCaptureId: "capture-no-longer-present",
        }}
      />,
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
    expect(within(context).getByText("Desktop · 1440 × 900")).toBeTruthy();
  });

  it("preserves local harness switching when no callback is supplied", () => {
    render(<App project={demoProject} />);

    const harness = screen.getByRole("combobox", {
      name: "Harness",
    }) as HTMLSelectElement;
    fireEvent.change(harness, { target: { value: "claude" } });

    expect(harness.value).toBe("claude");
  });

  it("uses honest default blocked explanations", () => {
    const project: ImportedProject = {
      ...demoProject,
      screens: [
        {
          id: "blocked-screen",
          name: "Checkout",
          route: "/checkout",
          state: "Unavailable fixture",
          captures: [
            {
              id: "blocked-without-reason",
              viewport: "tablet",
              label: "Tablet",
              dimensions: "834 × 1112",
              coverageHealth: "blocked",
            },
          ],
        },
      ],
      selectedCaptureId: "blocked-without-reason",
    };
    render(<App project={project} />);

    const blocked = screen.getByRole("button", {
      name: /Checkout Unavailable fixture Tablet, Blocked coverage/,
    });
    expect(
      within(blocked).getByText("Capture evidence is unavailable"),
    ).toBeTruthy();
    expect(within(blocked).getByText("Attempted: No evidence recorded")).toBeTruthy();
  });

  it("derives complete status when every required state has verified evidence", () => {
    const verifiedCell = baseCell as AvailableCapture;
    render(
      <App
        project={{
          ...demoProject,
          coverage: { requiredCaptureIds: [verifiedCell.id] },
          screens: [{ ...baseScreen, captures: [verifiedCell] }],
          selectedCaptureId: verifiedCell.id,
        }}
      />,
    );

    const coverage = screen.getByRole("status", {
      name: "Import coverage",
    });
    expect(within(coverage).getByText("Complete")).toBeTruthy();
    expect(within(coverage).queryByText(/100%/)).toBeNull();
  });

  it("does not count stale verified evidence toward project completion", () => {
    const staleCapture: VerifiedCapture = {
      ...(baseCell as VerifiedCapture),
      id: "stale-verified-capture",
      coverageHealth: "stale",
    };
    render(
      <App
        project={{
          ...demoProject,
          coverage: { requiredCaptureIds: [staleCapture.id] },
          screens: [{ ...baseScreen, captures: [staleCapture] }],
          selectedCaptureId: staleCapture.id,
        }}
      />,
    );

    const coverage = screen.getByRole("status", {
      name: "Import coverage",
    });
    expect(
      within(coverage).getByText("0 of 1 required states verified"),
    ).toBeTruthy();
    expect(within(coverage).getByText("Incomplete")).toBeTruthy();

    const context = screen.getByRole("region", {
      name: "Selected screen context",
    });
    expect(within(context).getByText("Verified evidence")).toBeTruthy();
    expect(within(context).getByText("Stale coverage")).toBeTruthy();
  });

  it("dedupes requirements and ignores optional cells when deriving completion", () => {
    const requiredDesktop = {
      ...(baseCell as VerifiedCapture),
      id: "required-desktop",
    };
    const requiredTablet = {
      ...(baseCell as VerifiedCapture),
      id: "required-tablet",
      label: "Tablet",
      viewport: "tablet",
      dimensions: "834 × 1112",
    };
    const optionalBlocked = {
      id: "optional-blocked",
      viewport: "mobile",
      label: "Mobile",
      dimensions: "390 × 844",
      coverageHealth: "blocked",
      blocker: "Optional fixture is unavailable",
      attemptedEvidence: "Optional route discovery",
    } as const;
    render(
      <App
        project={{
          ...demoProject,
          coverage: {
            requiredCaptureIds: [
              requiredDesktop.id,
              requiredTablet.id,
              requiredTablet.id,
            ],
          },
          screens: [
            {
              ...baseScreen,
              captures: [
                requiredDesktop,
                requiredTablet,
                optionalBlocked,
              ],
            },
          ],
          selectedCaptureId: requiredDesktop.id,
        }}
      />,
    );

    const coverage = screen.getByRole("status", {
      name: "Import coverage",
    });
    expect(
      within(coverage).getByText("2 of 2 required states verified"),
    ).toBeTruthy();
    expect(within(coverage).getByText("0 partial")).toBeTruthy();
    expect(within(coverage).getByText("0 blocked")).toBeTruthy();
    expect(within(coverage).getByText("Complete")).toBeTruthy();
  });

  it("keeps missing requirements unmet when duplicate captures share one ID", () => {
    const duplicatedCapture = {
      ...(baseCell as VerifiedCapture),
      id: "required-present",
    };
    render(
      <App
        project={{
          ...demoProject,
          coverage: {
            requiredCaptureIds: [
              duplicatedCapture.id,
              "required-missing",
            ],
          },
          screens: [
            {
              ...baseScreen,
              id: "duplicate-row-a",
              captures: [duplicatedCapture],
            },
            {
              ...baseScreen,
              id: "duplicate-row-b",
              captures: [duplicatedCapture],
            },
          ],
          selectedCaptureId: duplicatedCapture.id,
        }}
      />,
    );

    const coverage = screen.getByRole("status", {
      name: "Import coverage",
    });
    expect(
      within(coverage).getByText("1 of 2 required states verified"),
    ).toBeTruthy();
    expect(within(coverage).getByText("Incomplete")).toBeTruthy();
  });

  it("resets selection, harness, trace, and resolution when project identity changes", () => {
    const { rerender } = render(<App project={demoProject} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /Dashboard Default Mobile, CodeFrame/,
      }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Harness" }), {
      target: { value: "claude" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /Checkout Validation error Tablet, Blocked coverage/,
      }),
    );
    expect(
      screen.getByRole("status", { name: "Capture resolution" }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("log", { name: "Trace" })).getByText(
        "Switched harness from Codex to Claude",
      ),
    ).toBeTruthy();

    const nextProject: ImportedProject = {
      ...demoProject,
      id: "northstar-settings",
      title: "Northstar Settings",
      selectedCaptureId: "dashboard-tablet",
      task: {
        ...demoProject.task,
        harness: "codex",
      },
      trace: [demoProject.trace[0]!],
    };
    rerender(<App project={nextProject} />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Northstar Settings",
      }),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("region", { name: "Selected screen context" }),
      ).getByText("Tablet · 834 × 1112"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("combobox", { name: "Harness" }) as HTMLSelectElement)
        .value,
    ).toBe("codex");
    expect(
      within(screen.getByRole("log", { name: "Trace" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("status", { name: "Capture resolution" }),
    ).toBeNull();
  });

  it("keeps the workspace usable when no captures exist", () => {
    render(
      <App
        project={{
          ...demoProject,
          screens: [],
          selectedCaptureId: "missing",
        }}
      />,
    );

    const context = screen.getByRole("region", {
      name: "Selected screen context",
    });
    expect(
      within(context).getByText(
        "Select a screen capture to inspect its evidence.",
      ),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("article", {
          name: "Agent task: Correct checkout spacing",
        }),
      ).getByText("No target"),
    ).toBeTruthy();
  });
});
