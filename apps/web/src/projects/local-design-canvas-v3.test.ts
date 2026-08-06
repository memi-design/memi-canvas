import { describe, expect, it } from "vitest";

import { canvasWorkbenchFixture } from "../canvas/CanvasWorkbench.fixture.js";
import { createLocalDesignCanvasDocumentV3 } from "./local-design-canvas-v3.js";

describe("local design Canvas V3 identity", () => {
  it("seeds imported journals without legacy placeholder nodes", () => {
    const document = createLocalDesignCanvasDocumentV3(
      canvasWorkbenchFixture,
      undefined,
      "imported",
    );
    const pageId = document.pageIds[0];

    expect(pageId).toBeDefined();
    expect(document.pagesById[pageId!]?.kind).toBe("imported");
    expect(document.pagesById[pageId!]?.rootIds).toEqual([]);
    expect(document.nodesById).toEqual({});
  });

  it("retains migrated authoring nodes for a design journal", () => {
    const document = createLocalDesignCanvasDocumentV3(
      canvasWorkbenchFixture,
      undefined,
      "design",
    );

    expect(Object.keys(document.nodesById)).not.toHaveLength(0);
  });
});
