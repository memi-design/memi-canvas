import type { CanvasDocumentV3, CanvasPageId } from "@memi/protocol";

import type { CanvasPageNavigation } from "./CanvasSidebar.js";
import type { CanvasWorkbenchV3Session } from "./CanvasWorkbench.types.js";
import {
  canonicalizeReconstructionReviewsV3,
} from "./reconstruction-review-v3.js";
import type { CanvasReconstructionReview } from "./reconstruction-review.js";

interface CanvasPageContextV3Input {
  readonly activePageId: CanvasPageId;
  readonly authoritativeDocument?: CanvasDocumentV3;
  readonly legacyDocumentId: string;
  readonly navigation: CanvasPageNavigation | undefined;
  readonly onSelectPage: (pageId: string) => void;
  readonly reviews: readonly CanvasReconstructionReview[];
  readonly session: CanvasWorkbenchV3Session;
}

/** Resolves one page-scoped V3 context for navigation, rendering, and review. */
export function canvasPageContextV3({
  activePageId,
  authoritativeDocument,
  legacyDocumentId,
  navigation,
  onSelectPage,
  reviews,
  session,
}: CanvasPageContextV3Input) {
  const activeSession = Object.freeze({ ...session, activePageId });
  const document = authoritativeDocument ?? activeSession.document;
  return Object.freeze({
    navigation: navigation ?? Object.freeze({
      activePageId,
      onCreatePage: () => undefined,
      onSelectPage,
      pages: document.pageIds.map((pageId) => {
        const page = document.pagesById[pageId]!;
        return Object.freeze({
          id: page.id,
          kind: page.kind === "imported" ? "imported" : "local",
          name: page.name,
        });
      }),
    }),
    reviews: canonicalizeReconstructionReviewsV3({
      document: activeSession.document,
      legacyDocumentId,
      pageId: activePageId,
      reviews,
    }),
    session: activeSession,
  });
}
