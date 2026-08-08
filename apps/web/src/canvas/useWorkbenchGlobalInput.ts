import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";

import {
  hasCanvasImageInPasteData,
  readCanvasClipboardFromPasteData,
  readCanvasImageFromPasteData,
  type CanvasClipboardImage,
  type CanvasClipboardPayload,
} from "./canvas-clipboard.js";
import type { CanvasCamera } from "./canvas-camera.js";
import type { FrameStateScheduler } from "./canvas-performance.js";
import type {
  CanvasContextMenuState,
  PointerGesture,
  SelectionMarquee,
} from "./CanvasWorkbench.types.js";
import {
  dispatchEditorShortcut,
  type EditorCommand,
} from "./commands.js";
import type { WorkbenchNode } from "./model.js";
import type { WorkbenchNodeReservation } from "./useWorkbenchNodeReservation.js";

interface WorkbenchGlobalInputOptions {
  readonly cameraScheduler: RefObject<FrameStateScheduler<CanvasCamera> | null>;
  readonly commands: readonly EditorCommand[];
  readonly gesture: RefObject<PointerGesture | null>;
  readonly nodeReservation: Pick<
    WorkbenchNodeReservation,
    "getScope" | "isScopeCurrent"
  >;
  readonly pasteImage: (image: CanvasClipboardImage) => unknown;
  readonly pasteSelection: (payload?: CanvasClipboardPayload) => unknown;
  readonly selectNodeIds: (nodeIds: readonly string[]) => void;
  readonly setCamera: Dispatch<SetStateAction<CanvasCamera>>;
  readonly setContextMenu: Dispatch<SetStateAction<CanvasContextMenuState | null>>;
  readonly setPreviewNodes: Dispatch<SetStateAction<readonly WorkbenchNode[] | null>>;
  readonly setSelectionMarquee: Dispatch<SetStateAction<SelectionMarquee | null>>;
  readonly spacePressed: RefObject<boolean>;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return (
    element?.matches("input, textarea, select, [contenteditable=true]") ??
    false
  );
}

/** Keeps global keyboard and clipboard listeners outside the render workbench. */
export function useWorkbenchGlobalInput({
  cameraScheduler,
  commands,
  gesture,
  nodeReservation,
  pasteImage,
  pasteSelection,
  selectNodeIds,
  setCamera,
  setContextMenu,
  setPreviewNodes,
  setSelectionMarquee,
  spacePressed,
}: WorkbenchGlobalInputOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === " ") {
        event.preventDefault();
        spacePressed.current = true;
        return;
      }
      if (event.key === "Escape") {
        setContextMenu(null);
        const active = gesture.current;
        if (active?.type === "pan") {
          cameraScheduler.current?.cancel();
          setCamera(active.camera);
        } else if (active?.type === "marquee") {
          selectNodeIds(active.initialSelectedIds);
          setSelectionMarquee(null);
        } else if (active !== null) {
          setPreviewNodes(null);
        }
        gesture.current = null;
        return;
      }
      if (gesture.current === null) dispatchEditorShortcut(commands, event);
    };
    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === " ") spacePressed.current = false;
    };
    const handlePaste = (event: globalThis.ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const payload = readCanvasClipboardFromPasteData(event.clipboardData);
      if (payload !== null) {
        event.preventDefault();
        pasteSelection(payload);
        return;
      }
      if (!hasCanvasImageInPasteData(event.clipboardData)) return;
      event.preventDefault();
      const initiatingScope = nodeReservation.getScope();
      void readCanvasImageFromPasteData(event.clipboardData).then((image) => {
        if (
          image !== null &&
          nodeReservation.isScopeCurrent(initiatingScope)
        ) {
          pasteImage(image);
        }
      });
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("paste", handlePaste);
    };
  });
}
