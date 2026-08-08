import { describe, expect, it } from "vitest";

import { createWorkbenchNode } from "./workbench-pointer-geometry.js";

describe("workbench pointer geometry", () => {
  it("keeps same-kind authoring IDs unique after V3 projection", () => {
    const first = createWorkbenchNode("Frame", { x: 0, y: 0 }, []);
    const projectedFirst = {
      ...first,
      id: "node_v3_projected_frame",
    };

    const second = createWorkbenchNode(
      "Frame",
      { x: 400, y: 0 },
      [projectedFirst],
    );

    expect(second.id).not.toBe(first.id);
  });
});
