import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkbenchNode } from "./model.js";
import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import {
  ReconstructionReviewPanel,
  findSelectedReconstructionReview,
  projectDifferenceOverlayVisibility,
  type CanvasReconstructionReview,
} from "./reconstruction-review.js";

const review: CanvasReconstructionReview = {
  confidenceByNodeId: {
    child: {
      basis: ["runtime-geometry", "source-anchor"],
      score: 0.97,
    },
  },
  differenceOverlayNodeId: "difference",
  evidenceNodeId: "evidence",
  fidelity: {
    diffArtifactId: "art_01J00000000000000000000004",
    evaluatedAt: "2026-07-29T12:00:00.000Z",
    maximumGeometryDelta: 0.5,
    ssim: 0.991,
  },
  frameId: "frame",
  reviewStatus: "verified",
  scenarioId: "scenario",
};

const nodes: readonly WorkbenchNode[] = [
  {
    hidden: false,
    id: "frame",
    kind: "Frame",
    locked: false,
    name: "Home",
    parentId: null,
    position: { x: 0, y: 0 },
    size: { height: 844, width: 390 },
  },
  {
    hidden: false,
    id: "child",
    kind: "Rectangle",
    locked: false,
    name: "Continue",
    parentId: "frame",
    position: { x: 24, y: 120 },
    size: { height: 48, width: 342 },
  },
  {
    hidden: true,
    id: "difference",
    kind: "ReferenceFrame",
    locked: true,
    name: "Home difference",
    parentId: null,
    position: { x: 0, y: 0 },
    reference: {
      alt: "Home difference overlay",
      appVersion: "revision-1",
      authority: "local-runtime-difference",
      capturedAt: "2026-07-29T12:00:00.000Z",
      sourceUrl: "memi-source://repository/src/Home.tsx",
      src: "/imports/artifacts/art_01J00000000000000000000004.png",
    },
    size: { height: 844, width: 390 },
  },
  {
    hidden: true,
    id: "evidence",
    kind: "ReferenceFrame",
    locked: true,
    name: "Home evidence",
    parentId: null,
    position: { x: 0, y: 0 },
    reference: {
      alt: "Home runtime evidence",
      appVersion: "revision-1",
      authority: "local-runtime-capture",
      capturedAt: "2026-07-29T12:00:00.000Z",
      sourceUrl: "memi-source://repository/src/Home.tsx",
      src: "/imports/artifacts/art_01J00000000000000000000005.png",
    },
    size: { height: 844, width: 390 },
  },
];

describe("canvas reconstruction review", () => {
  it("resolves a screen-level review from a selected descendant", () => {
    expect(findSelectedReconstructionReview([review], nodes, ["child"]))
      .toBe(review);
    expect(findSelectedReconstructionReview([review], nodes, ["missing"]))
      .toBeNull();
  });

  it("projects only the reviewed difference node and keeps evidence hidden", () => {
    const projected = projectDifferenceOverlayVisibility(
      nodes,
      [review],
      new Set(["scenario"]),
    );

    expect(nodes.find(({ id }) => id === "difference")).toMatchObject({
      hidden: true,
    });
    expect(projected.find(({ id }) => id === "difference")).toMatchObject({
      hidden: false,
    });
    expect(projected.find(({ id }) => id === "evidence")).toMatchObject({
      hidden: true,
      locked: true,
    });

    const hiddenAgain = projectDifferenceOverlayVisibility(
      projected,
      [review],
      new Set(),
    );
    expect(hiddenAgain.find(({ id }) => id === "difference")).toMatchObject({
      hidden: true,
      locked: true,
    });
  });

  it("renders verified fidelity and exposes an accessible compare toggle", () => {
    const onCompareChange = vi.fn();
    render(
      <ReconstructionReviewPanel
        compareVisible={false}
        onCompareChange={onCompareChange}
        review={review}
        selectedNodeId="child"
      />,
    );

    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("99.1% SSIM")).toBeTruthy();
    expect(screen.getByText("0.5px geometry")).toBeTruthy();
    expect(screen.getByText("97% confidence")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Show difference overlay" }),
    );
    expect(onCompareChange).toHaveBeenCalledWith(true);
  });

  it("shows needs-review without offering a missing difference artifact", () => {
    render(
      <ReconstructionReviewPanel
        compareVisible={false}
        onCompareChange={vi.fn()}
        review={{
          ...review,
          differenceOverlayNodeId: null,
          fidelity: null,
          reviewStatus: "needs-review",
        }}
        selectedNodeId="child"
      />,
    );

    expect(screen.getByText("Needs review")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /difference overlay/iu }),
    ).toBeNull();
  });

  it("wires the selected screen review and compare state into the workbench", () => {
    render(
      <CanvasWorkbench
        project={{
          ...canvasWorkbenchFixture,
          selectedNodeId: "child",
          document: {
            ...canvasWorkbenchFixture.document,
            nodes,
          },
        }}
        reconstructionReviews={[review]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Show difference overlay" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("treeitem", {
        name: /Home (difference|evidence) ReferenceFrame/iu,
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(screen.queryByText("Home evidence")).toBeNull();
    expect(screen.queryByText("Home difference")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Inspect" }));
    const restoredToggle = screen.getByRole("button", {
      name: "Show difference overlay",
    });
    expect(restoredToggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(restoredToggle);
    expect(
      screen.getByRole("button", { name: "Hide difference overlay" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Home difference on canvas" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Home evidence on canvas" }),
    ).toBeNull();
  });
});
