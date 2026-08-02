import { useRef } from "react";

import type { CanvasWorkbenchV3Session } from "./CanvasWorkbench.types.js";
import type { CanonicalWorkbenchAuthorityV3 } from "./canonical-workbench-authority-v3.js";
import {
  createV3WorkbenchHistoryActions,
} from "./workbench-history-actions.js";
import {
  compileWorkbenchIntentReceiptV3,
  type WorkbenchIntentReceiptV3,
} from "./workbench-v3-intents.js";

export function createRecoveredSerialQueue(onFailure: (message: string) => void) {
  let pending = Promise.resolve();
  return (task: () => Promise<void>) => {
    pending = pending.then(task, task).catch((error: unknown) => {
      onFailure(
        (
          error instanceof Error
            ? error.message
            : "Canvas V3 mutation failed."
        ).slice(0, 256),
      );
    });
    return pending;
  };
}

export function useWorkbenchV3SessionBridge(input: {
  readonly authority: CanonicalWorkbenchAuthorityV3 | null;
  readonly session: CanvasWorkbenchV3Session;
  readonly onFailure: (message: string) => void;
}) {
  const latest = useRef(input);
  latest.current = input;
  const queue = useRef(
    createRecoveredSerialQueue((message) => input.onFailure(message)),
  );
  const history = input.authority === null
    ? null
    : createV3WorkbenchHistoryActions({
        authority: input.authority,
        actorId: "local-user",
        createOperationId: () =>
          `opn_${globalThis.crypto.randomUUID().replaceAll("-", "")}`,
        now: () => new Date().toISOString(),
      });

  const commitIntentReceipt = (
    label: string,
    receipt: WorkbenchIntentReceiptV3,
    options: { readonly selectedIds?: readonly string[] } = {},
  ) => {
    const task = async () => {
      const current = latest.current;
      if (current.authority === null) {
        throw new Error("Canvas V3 is still opening; mutation was not accepted.");
      }
      const currentHistory = createV3WorkbenchHistoryActions({
        authority: current.authority,
        actorId: "local-user",
        createOperationId: () =>
          `opn_${globalThis.crypto.randomUUID().replaceAll("-", "")}`,
        now: () => new Date().toISOString(),
      });
      const action = compileWorkbenchIntentReceiptV3({
        document: current.authority.getSnapshot().document,
        pageId: current.session.activePageId,
        receipt,
      });
      const selectedIds = options.selectedIds;
      await currentHistory.commitSemanticAction({
        action,
        label,
        ...(selectedIds === undefined
          ? {}
          : {
              selectionAfter: {
                anchorId: selectedIds.at(-1) ?? null,
                editingId: null,
                focusedId: selectedIds.at(-1) ?? null,
                selectedIds,
              },
            }),
      });
    };
    void queue.current(task);
  };

  const historyTask = (kind: "undo" | "redo") => {
    void queue.current(async () => {
      const current = latest.current;
      if (current.authority === null) {
        throw new Error("Canvas V3 is still opening; history was not accepted.");
      }
      const currentHistory = createV3WorkbenchHistoryActions({
        authority: current.authority,
        actorId: "local-user",
        createOperationId: () =>
          `opn_${globalThis.crypto.randomUUID().replaceAll("-", "")}`,
        now: () => new Date().toISOString(),
      });
      if (kind === "undo") await currentHistory.undoScene();
      else await currentHistory.redoScene();
    });
  };

  return {
    commitIntentReceipt,
    history,
    redoScene: () => historyTask("redo"),
    undoScene: () => historyTask("undo"),
  };
}
