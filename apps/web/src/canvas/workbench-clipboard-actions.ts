import {
  canReadCanvasSystemClipboard,
  copyCanvasSelection,
  createCanvasImageNodeAtPoint,
  cutCanvasSelection,
  pasteCanvasClipboard,
  readCanvasClipboardFromSystem,
  readCanvasImageFromSystem,
  readCanvasSessionClipboard,
  writeCanvasClipboardToSystem,
  type CanvasClipboardImage,
  type CanvasClipboardPayload,
  type CanvasClipboardPlacement,
} from "./canvas-clipboard.js";
import type { Point, WorkbenchNode } from "./model.js";
import type { WorkbenchHistoryActions } from "./workbench-history-actions.js";
import type { WorkbenchIntentReceiptV3 } from "./workbench-v3-intents.js";
import type { WorkbenchNodeReservation } from "./useWorkbenchNodeReservation.js";

interface ClipboardCommitOptions {
  readonly selectedIds?: readonly string[];
  readonly targetIds?: readonly string[];
}

type ClipboardCommit = (
  label: string,
  receipt: WorkbenchIntentReceiptV3,
  nodes: readonly WorkbenchNode[],
  options?: ClipboardCommitOptions,
) => void;

interface WorkbenchClipboardActionContext {
  readonly appendTrace: WorkbenchHistoryActions["appendTrace"];
  readonly commit: ClipboardCommit;
  readonly documentId: string;
  readonly getPastePoint?: () => Point | null;
  readonly nodeReservation: WorkbenchNodeReservation;
  readonly selectedNode: WorkbenchNode | undefined;
  readonly selectedNodeIds: readonly string[];
}

export type WorkbenchPastePlacement =
  | { readonly kind: "offset" }
  | { readonly kind: "cursor"; readonly point?: Point };

export interface WorkbenchClipboardActions {
  readonly copySelection: () => void;
  readonly cutSelection: () => void;
  readonly pasteImage: (image: CanvasClipboardImage, point?: Point) => void;
  readonly pasteSelection: (
    payload?: CanvasClipboardPayload | null,
    placement?: WorkbenchPastePlacement,
  ) => void;
}

function imagePasteParentId(
  selected: WorkbenchNode | undefined,
): string | null {
  if (selected === undefined) {
    return null;
  }
  return selected.kind === "Frame" ||
    selected.kind === "Group" ||
    selected.kind === "Section" ||
    selected.kind === "DraftFrame"
    ? selected.id
    : selected.parentId;
}

function pastePlacement(
  context: WorkbenchClipboardActionContext,
  placement: WorkbenchPastePlacement,
): CanvasClipboardPlacement {
  const cursor = placement.kind === "cursor"
    ? placement.point ?? context.getPastePoint?.() ?? null
    : null;
  return cursor === null ? { kind: "offset" } : { kind: "cursor", point: cursor };
}

export function createWorkbenchClipboardActions(
  context: WorkbenchClipboardActionContext,
): WorkbenchClipboardActions {
  const reportWrite = (
    promise: Promise<boolean>,
    action: "Copied" | "Cut",
    name: string,
    targetId: string,
  ) => {
    void promise.then((native) => {
      context.appendTrace(
        native
          ? `${action} ${name} to system clipboard`
          : `${action} ${name} to Memi clipboard; system clipboard unavailable`,
        targetId,
      );
    });
  };

  const copySelection = () => {
    const payload = copyCanvasSelection({
      documentId: context.documentId,
      nodes: context.nodeReservation.get(),
      selectedIds: context.selectedNodeIds,
    });
    if (payload === null) {
      return;
    }
    const selected = context.selectedNode;
    reportWrite(
      writeCanvasClipboardToSystem(payload),
      "Copied",
      selected?.name ?? `${payload.rootIds.length} layers`,
      selected?.id ?? payload.rootIds[0]!,
    );
  };

  const cutSelection = () => {
    const result = cutCanvasSelection({
      documentId: context.documentId,
      nodes: context.nodeReservation.get(),
      selectedIds: context.selectedNodeIds,
    });
    if (result === null || result.deletedIds.length === 0) {
      return;
    }
    const name = result.deletedIds.length === 1
      ? context.nodeReservation.get().find(
          ({ id }) => id === result.deletedIds[0],
        )?.name ?? "selection"
      : `${result.deletedIds.length} layers`;
    reportWrite(
      writeCanvasClipboardToSystem(result.payload),
      "Cut",
      name,
      result.deletedIds[0]!,
    );
    context.nodeReservation.set(result.nodes);
    context.commit(
      `Cut ${name}`,
      { kind: "delete", nodeIds: result.deletedIds },
      result.nodes,
      { selectedIds: [], targetIds: result.deletedIds },
    );
  };

  const pasteImage: WorkbenchClipboardActions["pasteImage"] = (image, point) => {
    const selected = context.selectedNode;
    const cursor = point ?? context.getPastePoint?.() ?? null;
    const node = createCanvasImageNodeAtPoint({
      cursor: cursor ?? {
        x: (selected?.position.x ?? 0) + 24,
        y: (selected?.position.y ?? 0) + 24,
      },
      image,
      nodes: context.nodeReservation.get(),
      parentId: imagePasteParentId(selected),
    });
    if (node === null) {
      return;
    }
    const nextNodes = [...context.nodeReservation.get(), node];
    context.nodeReservation.set(nextNodes);
    context.commit(
      "Paste image",
      { kind: "paste", nodes: [node] },
      nextNodes,
      { selectedIds: [node.id], targetIds: [node.id] },
    );
    context.appendTrace(
      cursor === null ? "Pasted image near selection" : "Pasted image at cursor",
      node.id,
    );
  };

  const pasteSelection: WorkbenchClipboardActions["pasteSelection"] = (
    eventPayload,
    placement = { kind: "offset" },
  ) => {
    const initiatingScope = context.nodeReservation.getScope();
    const commitPaste = (payload = readCanvasSessionClipboard()) => {
      const result = pasteCanvasClipboard(
        context.nodeReservation.get(),
        payload,
        pastePlacement(context, placement),
      );
      if (result === null) {
        return;
      }
      context.nodeReservation.set(result.nodes);
      const count = result.pastedNodes.length;
      context.commit(
        `Paste ${count === 1 ? result.pastedNodes[0]?.name ?? "layer" : `${count} layers`}`,
        { kind: "paste", nodes: result.pastedNodes },
        result.nodes,
        {
          selectedIds: result.selectedIds,
          targetIds: result.pastedNodes.map(({ id }) => id),
        },
      );
    };
    if (eventPayload !== undefined) {
      commitPaste(eventPayload);
      return;
    }
    const sessionPayload = readCanvasSessionClipboard();
    if (sessionPayload !== null) {
      commitPaste(sessionPayload);
      return;
    }
    if (!canReadCanvasSystemClipboard()) {
      return;
    }
    void readCanvasImageFromSystem().then((systemImage) => {
      if (!context.nodeReservation.isScopeCurrent(initiatingScope)) {
        return;
      }
      if (systemImage !== null) {
        const requested = pastePlacement(context, placement);
        pasteImage(
          systemImage,
          requested.kind === "cursor" ? requested.point : undefined,
        );
        return;
      }
      void readCanvasClipboardFromSystem().then((systemPayload) => {
        if (context.nodeReservation.isScopeCurrent(initiatingScope)) {
          commitPaste(systemPayload);
        }
      });
    });
  };

  return { copySelection, cutSelection, pasteImage, pasteSelection };
}
