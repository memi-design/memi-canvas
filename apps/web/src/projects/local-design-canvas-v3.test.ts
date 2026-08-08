import { describe, expect, it } from "vitest";

import { canvasWorkbenchFixture } from "../canvas/CanvasWorkbench.fixture.js";
import { createLocalDesignCanvasDocumentV3 } from "./local-design-canvas-v3.js";

describe("local design Canvas V3 identity", () => {
  it("seeds imported journals with a separate source-backed library page", () => {
    const document = createLocalDesignCanvasDocumentV3(
      canvasWorkbenchFixture,
      undefined,
      "imported",
    );
    const importedPageId = document.pageIds[0];
    const libraryPageId = document.pageIds[1];

    expect(importedPageId).toBeDefined();
    expect(document.pagesById[importedPageId!]?.kind).toBe("imported");
    expect(document.pagesById[importedPageId!]?.rootIds).toEqual([]);
    expect(libraryPageId).toBeDefined();
    expect(document.pagesById[libraryPageId!]).toMatchObject({
      kind: "library",
      name: "Design system",
    });
    expect(document.pagesById[libraryPageId!]?.rootIds.length).toBeGreaterThan(0);
    expect(
      Object.values(document.nodesById).every(
        (node) => node.pageId === libraryPageId,
      ),
    ).toBe(true);
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
