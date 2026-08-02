import { useRef } from "react";
import { OperationIdSchema, type OperationId } from "@memi/protocol";

import type { CanvasWorkbenchV3Session } from "./CanvasWorkbench.types.js";
import type { CanonicalWorkbenchAuthorityV3 } from "./canonical-workbench-authority-v3.js";
import {
  createV3WorkbenchHistoryActions,
} from "./workbench-history-actions.js";
import {
  canonicalWorkbenchNodeIdV3,
  compileWorkbenchIntentReceiptV3,
  type WorkbenchIntentReceiptV3,
} from "./workbench-v3-intents.js";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_SORTABLE_TIMESTAMP = 0xffff_ffff_ffff;

export interface CreateCanvasOperationIdOptions {
  readonly now?: number;
  readonly randomBytes?: () => Uint8Array;
}

function encodeCrockford(value: bigint, length: number): string {
  return Array.from({ length }, (_, index) => {
    const shift = BigInt((length - index - 1) * 5);
    return CROCKFORD_BASE32[Number((value >> shift) & 31n)]!;
  }).join("");
}

function secureRandomBytes(): Uint8Array {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Create one protocol-valid, time-sortable ULID-shaped operation identity. */
export function createCanvasOperationId(
  options: CreateCanvasOperationIdOptions = {},
): OperationId {
  const now = options.now ?? Date.now();
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now > MAX_SORTABLE_TIMESTAMP
  ) {
    throw new Error("Canvas operation time is outside the sortable ID range.");
  }
  const randomBytes = (options.randomBytes ?? secureRandomBytes)();
  if (randomBytes.byteLength !== 10) {
    throw new Error("Canvas operation entropy must contain exactly 10 bytes.");
  }
  const randomValue = Array.from(randomBytes).reduce(
    (value, byte) => (value << 8n) | BigInt(byte),
    0n,
  );
  return OperationIdSchema.parse(
    `opn_${encodeCrockford(BigInt(now), 10)}${encodeCrockford(randomValue, 16)}`,
  );
}

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

/** Canonicalize the legacy projection selection at the V3 commit boundary. */
export function canonicalizeWorkbenchSelectionIdsV3(input: {
  readonly document: CanvasWorkbenchV3Session["document"];
  readonly pageId: CanvasWorkbenchV3Session["activePageId"];
  readonly selectedIds: readonly string[];
}): readonly string[] {
  return [...new Set(input.selectedIds.map((id) =>
    canonicalWorkbenchNodeIdV3(input.document, input.pageId, id),
  ))];
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
        createOperationId: createCanvasOperationId,
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
        createOperationId: createCanvasOperationId,
        now: () => new Date().toISOString(),
      });
      const action = compileWorkbenchIntentReceiptV3({
        document: current.authority.getSnapshot().document,
        pageId: current.session.activePageId,
        receipt,
      });
      const selectedIds = options.selectedIds === undefined
        ? undefined
        : canonicalizeWorkbenchSelectionIdsV3({
            document: current.authority.getSnapshot().document,
            pageId: current.session.activePageId,
            selectedIds: options.selectedIds,
          });
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
        createOperationId: createCanvasOperationId,
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
