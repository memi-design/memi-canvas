import type { CanvasDocumentV3PersistencePort } from "@memi/protocol";

import type { RuntimeClientV1 } from "./runtime-client.js";

/**
 * Adapts the private authenticated runtime client to the narrow V3 journal
 * persistence port used by the canvas authority. The renderer never receives
 * a database path or writes storage directly.
 */
export function createRuntimeClientCanvasDocumentPersistence(
  runtime: Pick<RuntimeClientV1, "canvasDocuments">,
): CanvasDocumentV3PersistencePort {
  const port: CanvasDocumentV3PersistencePort = {
    async load(identity) {
      const result = await runtime.canvasDocuments.load({ identity });
      return result.journal;
    },
    async initialize(snapshot) {
      await runtime.canvasDocuments.initialize({ snapshot });
    },
    async append(append) {
      const result = await runtime.canvasDocuments.append({ append });
      return result.receipt;
    },
    async checkpoint(snapshot) {
      await runtime.canvasDocuments.checkpoint({ snapshot });
    },
  };
  return Object.freeze(port);
}
