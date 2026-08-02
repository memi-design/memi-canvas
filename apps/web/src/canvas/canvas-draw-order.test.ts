import { describe, expect, it } from "vitest";

import { canvasDrawOrder } from "./canvas-draw-order.js";
import type { WorkbenchNode } from "./model.js";

function node(
  id: string,
  kind: WorkbenchNode["kind"],
  parentId: string | null = null,
): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind,
    locked: false,
    name: id,
    parentId,
    position: { x: 0, y: 0 },
    size: { height: 100, width: 100 },
  };
}

describe("canvas draw order", () => {
  it("preserves unrelated root sibling order instead of globally sinking frames", () => {
    const rectangle = node("shape", "Rectangle");
    const frame = node("frame", "Frame");

    expect(canvasDrawOrder([rectangle, frame])).toEqual([rectangle, frame]);
  });

  it("always paints a frame before its nested layers", () => {
    const frame = node("frame", "Frame");
    const shape = node("shape", "Rectangle", "frame");
    const text = node("text", "Text", "frame");

    expect(canvasDrawOrder([shape, text, frame])).toEqual([
      frame,
      shape,
      text,
    ]);
  });

  it("keeps each container before its own descendants without crossing sibling subtrees", () => {
    const firstFrame = node("first-frame", "Frame");
    const firstChild = node("first-child", "Rectangle", firstFrame.id);
    const interstitialShape = node("interstitial", "Ellipse");
    const secondFrame = node("second-frame", "Frame");
    const secondChild = node("second-child", "Text", secondFrame.id);

    expect(
      canvasDrawOrder([
        firstFrame,
        firstChild,
        interstitialShape,
        secondFrame,
        secondChild,
      ]),
    ).toEqual([
      firstFrame,
      firstChild,
      interstitialShape,
      secondFrame,
      secondChild,
    ]);
  });
});
