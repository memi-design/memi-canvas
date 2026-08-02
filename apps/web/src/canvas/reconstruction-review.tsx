import type { WorkbenchNode } from "./model.js";

export interface CanvasReconstructionReview {
  readonly confidenceByNodeId: Readonly<
    Record<
      string,
      Readonly<{
        basis: readonly string[];
        score: number;
      }>
    >
  >;
  readonly differenceOverlayNodeId: string | null;
  readonly differenceOverlayVisible?: boolean;
  readonly evidenceNodeId: string;
  readonly fidelity: Readonly<{
    diffArtifactId: string | null;
    evaluatedAt: string | null;
    maximumGeometryDelta: number | null;
    ssim: number | null;
  }> | null;
  readonly frameId: string;
  readonly reviewStatus: "needs-review" | "verified";
  readonly scenarioId: string;
}

function belongsToReview(
  nodeId: string,
  review: CanvasReconstructionReview,
  nodesById: ReadonlyMap<string, WorkbenchNode>,
): boolean {
  if (
    nodeId === review.frameId ||
    nodeId === review.evidenceNodeId ||
    nodeId === review.differenceOverlayNodeId
  ) {
    return true;
  }
  const visited = new Set<string>();
  let current = nodesById.get(nodeId);
  while (current !== undefined && current.parentId !== null) {
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    if (current.parentId === review.frameId) return true;
    current = nodesById.get(current.parentId);
  }
  return false;
}

export function findSelectedReconstructionReview(
  reviews: readonly CanvasReconstructionReview[],
  nodes: readonly WorkbenchNode[],
  selectedNodeIds: readonly string[],
): CanvasReconstructionReview | null {
  const selectedNodeId = selectedNodeIds.at(-1);
  if (selectedNodeId === undefined) return null;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return (
    reviews.find((review) =>
      belongsToReview(selectedNodeId, review, nodesById),
    ) ?? null
  );
}

export function projectDifferenceOverlayVisibility(
  nodes: readonly WorkbenchNode[],
  reviews: readonly CanvasReconstructionReview[],
  visibleScenarioIds: ReadonlySet<string>,
): readonly WorkbenchNode[] {
  const visibleDifferenceIds = new Set(
    reviews.flatMap((review) =>
      visibleScenarioIds.has(review.scenarioId) &&
      review.differenceOverlayNodeId !== null
        ? [review.differenceOverlayNodeId]
        : [],
    ),
  );
  const differenceIds = new Set(
    reviews.flatMap(({ differenceOverlayNodeId }) =>
      differenceOverlayNodeId === null ? [] : [differenceOverlayNodeId],
    ),
  );
  const evidenceIds = new Set(
    reviews.map(({ evidenceNodeId }) => evidenceNodeId),
  );
  return Object.freeze(
    nodes.map((node) => {
      if (evidenceIds.has(node.id)) {
        return node.hidden && node.locked
          ? node
          : Object.freeze({ ...node, hidden: true, locked: true });
      }
      if (!differenceIds.has(node.id)) return node;
      if (node.kind !== "ReferenceFrame" || !node.locked) {
        return node.hidden
          ? node
          : Object.freeze({ ...node, hidden: true });
      }
      const hidden = !visibleDifferenceIds.has(node.id);
      return node.hidden === hidden
        ? node
        : Object.freeze({ ...node, hidden });
    }),
  );
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// Atomic Design: molecule — compact, read-only evidence review controls.
export function ReconstructionReviewPanel({
  compareVisible,
  onCompareChange,
  review,
  selectedNodeId,
}: {
  readonly compareVisible: boolean;
  readonly onCompareChange: (visible: boolean) => void;
  readonly review: CanvasReconstructionReview;
  readonly selectedNodeId: string | null;
}) {
  const confidence =
    selectedNodeId === null
      ? undefined
      : review.confidenceByNodeId[selectedNodeId];
  const fidelity = review.fidelity;
  return (
    <section
      aria-label="Reconstruction review"
      className="inspector-section reconstruction-review"
    >
      <header className="reconstruction-review__header">
        <span>Runtime comparison</span>
        <strong data-status={review.reviewStatus}>
          {review.reviewStatus === "verified" ? "Verified" : "Needs review"}
        </strong>
      </header>
      <div className="reconstruction-review__metrics">
        {fidelity?.ssim === null || fidelity === null ? null : (
          <span>{percentage(fidelity.ssim)} SSIM</span>
        )}
        {fidelity?.maximumGeometryDelta === null || fidelity === null ? null : (
          <span>{fidelity.maximumGeometryDelta}px geometry</span>
        )}
        {confidence === undefined ? null : (
          <span>{Math.round(confidence.score * 100)}% confidence</span>
        )}
      </div>
      {review.differenceOverlayNodeId === null ||
      fidelity?.diffArtifactId === null ||
      fidelity === null ? null : (
        <button
          aria-pressed={compareVisible}
          onClick={() => onCompareChange(!compareVisible)}
          type="button"
        >
          {compareVisible ? "Hide" : "Show"} difference overlay
        </button>
      )}
    </section>
  );
}
