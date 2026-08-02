import type { CanvasWorkbenchV3Session } from "./CanvasWorkbench.types.js";
import type { CanvasWorkbenchProject } from "./model.js";
import { createLocalDesignCanvasDocumentV3 } from "../projects/local-design-canvas-v3.js";
import { createEphemeralCanvasDocumentPersistence } from "../runtime/runtime-client-canvas-document-persistence.js";

/**
 * Exercise the same V3 authority boundary as production consumers while
 * keeping each isolated view test independent from browser or native storage.
 */
export function createCanvasWorkbenchV3TestSession(
  project: CanvasWorkbenchProject,
): CanvasWorkbenchV3Session {
  const document = createLocalDesignCanvasDocumentV3(project);
  const activePageId = document.pageIds[0];
  if (activePageId === undefined) {
    throw new Error("A workbench test project must contain an active page.");
  }
  return Object.freeze({
    activePageId,
    document,
    persistence: createEphemeralCanvasDocumentPersistence(),
  });
}
