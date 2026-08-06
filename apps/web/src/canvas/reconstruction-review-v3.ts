import { mapLegacyCanvasIdV2 } from "@memi/canvas-document";
import type { CanvasDocumentV3, CanvasPageId } from "@memi/protocol";

import type { CanvasReconstructionReview } from "./reconstruction-review.js";
import { canonicalWorkbenchNodeIdV3 } from "./workbench-v3-intents.js";

/**
 * Imported review metadata may still carry the legacy projection identities
 * used by the capture adapter. Resolve those identities once at the V3 UI
 * boundary so selection, confidence, evidence, and difference overlays all
 * address the canonical document.
 */
export function canonicalizeReconstructionReviewsV3(input: {
  readonly document: CanvasDocumentV3;
  readonly legacyDocumentId: string;
  readonly pageId: CanvasPageId;
  readonly reviews: readonly CanvasReconstructionReview[];
}): readonly CanvasReconstructionReview[] {
  const canonicalId = (id: string) => {
    if (input.document.nodesById[id] !== undefined) return id;
    const migratedId = mapLegacyCanvasIdV2(
      "node",
      `${input.legacyDocumentId}:${id}`,
    ).canonicalId;
    if (input.document.nodesById[migratedId] !== undefined) {
      return migratedId;
    }
    return canonicalWorkbenchNodeIdV3(input.document, input.pageId, id);
  };

  return input.reviews.map((review) => ({
    ...review,
    confidenceByNodeId: Object.fromEntries(
      Object.entries(review.confidenceByNodeId).map(([nodeId, confidence]) => [
        canonicalId(nodeId),
        confidence,
      ]),
    ),
    differenceOverlayNodeId:
      review.differenceOverlayNodeId === null
        ? null
        : canonicalId(review.differenceOverlayNodeId),
    evidenceNodeId: canonicalId(review.evidenceNodeId),
    frameId: canonicalId(review.frameId),
  }));
}
