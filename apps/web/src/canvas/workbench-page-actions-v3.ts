import { CanvasPageIdSchema, type CanvasPageId } from "@memi/protocol";

import type { CanonicalWorkbenchAuthorityV3 } from "./canonical-workbench-authority-v3.js";
import { createSelectionState } from "./model.js";
import { createCanvasOperationId } from "./workbench-v3-session-bridge.js";

export interface CreateWorkbenchPageV3Options {
  readonly createOperationId?: typeof createCanvasOperationId;
  readonly now?: () => string;
}

const pendingPageCreations = new WeakMap<
  CanonicalWorkbenchAuthorityV3,
  Promise<CanvasPageId>
>();

async function commitWorkbenchPageV3(
  authority: CanonicalWorkbenchAuthorityV3,
  options: CreateWorkbenchPageV3Options,
): Promise<CanvasPageId> {
  const document = authority.getSnapshot().document;
  const operationId = (options.createOperationId ?? createCanvasOperationId)();
  const pageId = CanvasPageIdSchema.parse(`pag_${operationId.slice(4)}`);
  const pageNumber = document.pageIds.length + 1;

  await authority.commit(
    {
      action: {
        type: "page.define",
        payload: {
          pageId,
          next: {
            id: pageId,
            kind: "design",
            name: `Page ${pageNumber}`,
            rootIds: [],
          },
        },
      },
      actor: "human",
      actorId: "local-user",
      id: operationId,
      label: `Create Page ${pageNumber}`,
      occurredAt: (options.now ?? (() => new Date().toISOString()))(),
    },
    createSelectionState(),
  );

  return pageId;
}

/** Create one serialized empty design page through the canonical journal. */
export function createWorkbenchPageV3(
  authority: CanonicalWorkbenchAuthorityV3,
  options: CreateWorkbenchPageV3Options = {},
): Promise<CanvasPageId> {
  const pending = pendingPageCreations.get(authority);
  const ready = pending?.then(
    () => undefined,
    () => undefined,
  ) ?? Promise.resolve();
  const creation = ready.then(() =>
    commitWorkbenchPageV3(authority, options),
  );
  pendingPageCreations.set(authority, creation);
  void creation.finally(() => {
    if (pendingPageCreations.get(authority) === creation) {
      pendingPageCreations.delete(authority);
    }
  }).catch(() => undefined);
  return creation;
}
