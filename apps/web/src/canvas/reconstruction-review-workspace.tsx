import { useMemo, useState, type ReactNode } from "react";

import type {
  CanvasPageNavigation,
  CanvasPageNavigationItem,
} from "./CanvasSidebar.js";
import type { CanvasWorkbenchProject, WorkbenchNode } from "./model.js";
import {
  ReconstructionReviewPanel,
  findSelectedReconstructionReview,
  projectDifferenceOverlayVisibility,
  type CanvasReconstructionReview,
} from "./reconstruction-review.js";
import type { WorkspaceDockFileItem } from "./workspace-dock.js";

export const EMPTY_RECONSTRUCTION_REVIEWS:
  readonly CanvasReconstructionReview[] = Object.freeze([]);

interface ReconstructionReviewWorkspaceInput {
  readonly nodes: readonly WorkbenchNode[];
  readonly pageNavigation: CanvasPageNavigation | undefined;
  readonly project: CanvasWorkbenchProject;
  readonly reviews: readonly CanvasReconstructionReview[];
  readonly selectedNodeId: string | null;
  readonly selectedNodeIds: readonly string[];
}

interface ReconstructionReviewWorkspaceProjection {
  readonly inspectorReview: ReactNode;
  readonly navigableNodes: readonly WorkbenchNode[];
  readonly navigation: CanvasPageNavigation;
  readonly projectedNodes: readonly WorkbenchNode[];
  readonly workspaceFiles: readonly WorkspaceDockFileItem[];
}

function reconstructionArtifactIds(
  reviews: readonly CanvasReconstructionReview[],
): ReadonlySet<string> {
  return new Set(
    reviews.flatMap((review) => [
      review.evidenceNodeId,
      ...(review.differenceOverlayNodeId === null
        ? []
        : [review.differenceOverlayNodeId]),
    ]),
  );
}

/**
 * Keeps runtime evidence and difference images out of editor navigation while
 * projecting their transient compare visibility into the viewport.
 */
export function useReconstructionReviewWorkspace({
  nodes,
  pageNavigation,
  project,
  reviews,
  selectedNodeId,
  selectedNodeIds,
}: ReconstructionReviewWorkspaceInput): ReconstructionReviewWorkspaceProjection {
  const [visibleScenarioIds, setVisibleScenarioIds] =
    useState<ReadonlySet<string>>(
      () =>
        new Set(
          reviews.flatMap((review) =>
            review.differenceOverlayVisible ? [review.scenarioId] : [],
          ),
        ),
    );
  const projectedNodes = useMemo(
    () =>
      projectDifferenceOverlayVisibility(
        nodes,
        reviews,
        visibleScenarioIds,
      ),
    [nodes, reviews, visibleScenarioIds],
  );
  const artifactIds = useMemo(
    () => reconstructionArtifactIds(reviews),
    [reviews],
  );
  const navigableNodes = useMemo(
    () => nodes.filter(({ id }) => !artifactIds.has(id)),
    [artifactIds, nodes],
  );
  const selectedReview = findSelectedReconstructionReview(
    reviews,
    nodes,
    selectedNodeIds,
  );
  const navigation: CanvasPageNavigation = pageNavigation ?? {
    activePageId: project.id,
    onCreatePage: () => undefined,
    onSelectPage: () => undefined,
    pages: [
      {
        id: project.id,
        kind: "local",
        name: project.title.replace(" · Product canvas", ""),
      },
    ],
  };

  return {
    inspectorReview:
      selectedReview === null ? null : (
        <ReconstructionReviewPanel
          compareVisible={visibleScenarioIds.has(selectedReview.scenarioId)}
          onCompareChange={(visible) => {
            setVisibleScenarioIds((current) => {
              const next = new Set(current);
              if (visible) next.add(selectedReview.scenarioId);
              else next.delete(selectedReview.scenarioId);
              return next;
            });
          }}
          review={selectedReview}
          selectedNodeId={selectedNodeId}
        />
      ),
    navigableNodes,
    navigation,
    projectedNodes,
    workspaceFiles: reconstructionWorkspaceFiles(
      navigation.pages,
      navigableNodes,
    ),
  };
}

export function reconstructionWorkspaceFiles(
  pages: readonly CanvasPageNavigationItem[],
  navigableNodes: readonly WorkbenchNode[],
): readonly WorkspaceDockFileItem[] {
  return [
    ...pages.map((page) => ({
      id: `page-${page.id}`,
      name: page.name,
      kind: "page" as const,
      detail: page.kind === "imported" ? "Source import" : "Canvas",
    })),
    ...navigableNodes.map((node) => ({
      id: `node-${node.id}`,
      name: node.name,
      kind: "node" as const,
      detail: node.kind,
    })),
  ];
}
