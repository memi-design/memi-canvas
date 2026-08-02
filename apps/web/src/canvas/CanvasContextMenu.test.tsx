import { describe, expect, it } from "vitest";

import { clampContextMenuPosition } from "./CanvasContextMenu.js";

describe("canvas context menu placement", () => {
  it("flips an overflowing menu inside the visible viewport", () => {
    expect(
      clampContextMenuPosition(
        { x: 980, y: 740 },
        { height: 420, width: 280 },
        { height: 768, width: 1_024 },
      ),
    ).toEqual({ x: 736, y: 340 });
  });

  it("keeps keyboard and synthetic positions away from negative edges", () => {
    expect(
      clampContextMenuPosition(
        { x: -40, y: -20 },
        { height: 200, width: 240 },
        { height: 768, width: 1_024 },
      ),
    ).toEqual({ x: 8, y: 8 });
  });
});
