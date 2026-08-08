import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import type { CanvasPageId } from "@memi/protocol";

import type { CanvasPageNavigation } from "./CanvasSidebar.js";
import type { CanvasWorkbenchV3Session } from "./CanvasWorkbench.types.js";
import type { CanonicalWorkbenchAuthorityV3 } from "./canonical-workbench-authority-v3.js";
import type { CollaborationTraceItem } from "./collaboration.js";
import type { CanvasReconstructionReview } from "./reconstruction-review.js";
import { canvasPageContextV3 } from "./canvas-page-navigation-v3.js";
import { createWorkbenchPageV3 } from "./workbench-page-actions-v3.js";
import { useWorkbenchV3SessionBridge } from "./workbench-v3-session-bridge.js";

interface WorkbenchPageSessionV3Input {
  readonly activePageId: CanvasPageId;
  readonly authority: CanonicalWorkbenchAuthorityV3 | null;
  readonly legacyDocumentId: string;
  readonly navigation: CanvasPageNavigation | undefined;
  readonly reviews: readonly CanvasReconstructionReview[];
  readonly selectActivePage: (pageId: string) => void;
  readonly session: CanvasWorkbenchV3Session;
  readonly setTrace: Dispatch<SetStateAction<readonly CollaborationTraceItem[]>>;
  readonly traceSequence: MutableRefObject<number>;
}

/** Owns page creation, navigation, and serialized V3 history wiring. */
export function useWorkbenchPageSessionV3(
  input: WorkbenchPageSessionV3Input,
) {
  const reportFailure = (message: string) => input.setTrace((current) => [
    ...current,
    {
      action: message,
      id: `workbench-v3-error-${input.traceSequence.current++}`,
      targetNodeId: "canvas",
    },
  ]);
  const createPage = () => {
    if (input.authority === null) {
      reportFailure("Canvas V3 is still opening; page was not created.");
      return;
    }
    void createWorkbenchPageV3(input.authority)
      .then(input.selectActivePage)
      .catch((error: unknown) => reportFailure(
        error instanceof Error ? error.message : "Canvas page creation failed.",
      ));
  };
  const pageContext = canvasPageContextV3({
    activePageId: input.activePageId,
    legacyDocumentId: input.legacyDocumentId,
    navigation: input.navigation,
    onCreatePage: createPage,
    onSelectPage: input.selectActivePage,
    reviews: input.reviews,
    session: input.session,
    ...(input.authority === null
      ? {}
      : { authoritativeDocument: input.authority.getSnapshot().document }),
  });
  return {
    pageContext,
    ...useWorkbenchV3SessionBridge({
      authority: input.authority,
      onFailure: reportFailure,
      session: pageContext.session,
    }),
  };
}
