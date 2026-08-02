import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { ProjectIdSchema } from "@memi/protocol";

import {
  FIGMA_IMPORT_MAX_BYTES,
  normalizeFigmaJsonExport,
  parseFigmaFileUrl,
  prepareFigmaUrlImport,
} from "./figma-import.js";
import {
  createFigmaCanvasDocumentV3,
  createFigmaCanvasProject,
} from "./figma-workbench.js";
import { projectCanvasDocumentV3ToWorkbench } from "../../canvas/canvas-v3-workbench-projection.js";

const shippedMemiAppSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/MemiApp.tsx"),
  "utf8",
);

const figmaExport = {
  name: "Checkout system",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [
      {
        id: "1:1",
        name: "Checkout",
        type: "CANVAS",
        children: [
          {
            id: "2:1",
            name: "Checkout / Mobile",
            type: "FRAME",
            absoluteBoundingBox: { x: 100, y: 200, width: 390, height: 844 },
            fills: [{ type: "SOLID", color: { r: 0.02, g: 0.03, b: 0.04 }, opacity: 1 }],
            children: [
              {
                id: "3:1",
                name: "Continue",
                type: "COMPONENT",
                absoluteBoundingBox: { x: 124, y: 880, width: 342, height: 48 },
                fills: [{ type: "SOLID", color: { r: 1, g: 0.329, b: 0.439 } }],
              },
              {
                id: "3:2",
                name: "Continue label",
                type: "TEXT",
                characters: "Continue",
                absoluteBoundingBox: { x: 260, y: 896, width: 70, height: 20 },
                style: { fontFamily: "Inter", fontSize: 15, fontWeight: 500 },
              },
            ],
          },
        ],
      },
    ],
  },
  components: {
    "3:1": {
      key: "component-key",
      name: "Continue",
      description: "Primary action",
    },
  },
  styles: {
    "S:1": {
      key: "style-key",
      name: "Brand/Ruby",
      styleType: "FILL",
      description: "Primary action",
    },
  },
};

describe("Figma file URL validation", () => {
  it("accepts canonical design, file, and FigJam URLs and extracts their source identity", () => {
    expect(
      parseFigmaFileUrl(
        "https://www.figma.com/design/AbC123xyZ/Checkout?node-id=2-1",
      ),
    ).toEqual({
      fileKey: "AbC123xyZ",
      fileType: "design",
      nodeId: "2:1",
      sourceUrl:
        "https://www.figma.com/design/AbC123xyZ/Checkout?node-id=2-1",
    });
    expect(
      parseFigmaFileUrl("https://figma.com/file/AbC123xyZ/Checkout"),
    ).toMatchObject({ fileKey: "AbC123xyZ", fileType: "design" });
    expect(
      parseFigmaFileUrl("https://www.figma.com/board/AbC123xyZ/Flow"),
    ).toMatchObject({ fileKey: "AbC123xyZ", fileType: "figjam" });
  });

  it("rejects credentials, lookalike hosts, non-file paths, and malformed keys", () => {
    for (const value of [
      "https://figma.com.evil.test/design/AbC123xyZ/Checkout",
      "https://user:password@www.figma.com/design/AbC123xyZ/Checkout",
      "http://www.figma.com/design/AbC123xyZ/Checkout",
      "https://www.figma.com/community/file/AbC123xyZ",
      "https://www.figma.com/design/../Checkout",
    ]) {
      expect(() => parseFigmaFileUrl(value)).toThrow();
    }
  });

  it("reports REST import as unavailable when no credential was provided", () => {
    expect(
      prepareFigmaUrlImport(
        "https://www.figma.com/design/AbC123xyZ/Checkout",
      ),
    ).toEqual({
      status: "token-required",
      fileKey: "AbC123xyZ",
      message:
        "Figma API access requires a personal access token. No token is stored or inferred by Memi.",
    });
  });
});

describe("offline Figma JSON normalization", () => {
  it("normalizes pages, frames, components, text, tokens, and authentic fills immutably", () => {
    const input = JSON.stringify(figmaExport);
    const result = normalizeFigmaJsonExport(input, {
      fileKey: "local-checkout",
      importedAt: "2026-07-29T03:00:00.000Z",
    });

    expect(result.projectName).toBe("Checkout system");
    expect(result.document.rootIds).toEqual(["figma-1-1"]);
    expect(result.document.nodes.map(({ id }) => id)).toEqual([
      "figma-1-1",
      "figma-2-1",
      "figma-3-1",
      "figma-3-2",
    ]);
    expect(result.document.nodes).toHaveLength(4);
    expect(result.document.nodes.find(({ id }) => id === "figma-2-1")).toMatchObject({
      kind: "Frame",
      parentId: "figma-1-1",
      position: { x: 100, y: 200 },
      size: { width: 390, height: 844 },
      styles: {
        fills: figmaExport.document.children[0]?.children?.[0]?.fills,
      },
      provenance: {
        repositoryRevision: "figma:local-checkout",
        sourceAnchor: "figma://file/local-checkout/node/2:1",
      },
    });
    expect(result.document.nodes.find(({ id }) => id === "figma-3-1")).toMatchObject({
      kind: "Component",
      parentId: "figma-2-1",
      position: { x: 24, y: 680 },
      styles: {
        fills: figmaExport.document.children[0]?.children?.[0]?.children?.[0]?.fills,
      },
    });
    expect(result.document.nodes.find(({ id }) => id === "figma-3-2")?.styles).toMatchObject({
      text: "Continue",
      textStyle: { fontFamily: "Inter", fontSize: 15, fontWeight: 500 },
    });
    expect(result.components).toEqual([
      expect.objectContaining({ nodeId: "3:1", key: "component-key", name: "Continue" }),
    ]);
    expect(result.tokens).toEqual([
      expect.objectContaining({ id: "S:1", key: "style-key", name: "Brand/Ruby", type: "FILL" }),
    ]);
    expect(JSON.parse(input)).toEqual(figmaExport);
  });

  it("creates an editable compatibility scene for the current canvas renderer", () => {
    const result = normalizeFigmaJsonExport(JSON.stringify(figmaExport), {
      fileKey: "local-checkout",
      importedAt: "2026-07-29T03:00:00.000Z",
    });
    const project = createFigmaCanvasProject(result, "checkout-import");

    expect(project).toMatchObject({
      id: "checkout-import",
      title: "Checkout system",
      selectedNodeId: "figma-1-1",
      document: {
        id: "document-local-checkout-import",
        revision: 1,
      },
      trace: [
        {
          action: "Imported local Figma JSON · 4 nodes",
          targetNodeId: "figma-1-1",
        },
      ],
    });
    expect(
      project.document.nodes.find(({ id }) => id === "figma-3-1"),
    ).toMatchObject({
      kind: "DraftFrame",
      position: { x: 124, y: 880 },
      fill: "rgb(100% 32.9% 43.9%)",
      provenance: {
        repositoryRevision: "figma:local-checkout",
      },
    });
    expect(
      project.document.nodes.find(({ id }) => id === "figma-3-2"),
    ).toMatchObject({
      kind: "Text",
      text: "Continue",
      position: { x: 260, y: 896 },
    });
  });

  it("seeds the same Figma structure into a V3 project identity", () => {
    const result = normalizeFigmaJsonExport(JSON.stringify(figmaExport), {
      fileKey: "local-checkout",
      importedAt: "2026-07-29T03:00:00.000Z",
    });
    const document = createFigmaCanvasDocumentV3(
      result,
      "checkout-import",
      ProjectIdSchema.parse("prj_01J00000000000000000000000"),
    );

    expect(document).toMatchObject({
      schemaVersion: 3,
      projectId: "prj_01J00000000000000000000000",
    });
    expect(Object.keys(document.nodesById)).toHaveLength(4);
    expect(document.operationCursor).toBeNull();
    expect(document.stateHash).toMatch(/^sha256:/u);
    expect(
      projectCanvasDocumentV3ToWorkbench(document, document.pageIds[0]!),
    ).toHaveLength(4);
  });

  it("rejects oversized, deeply nested, malformed, duplicate, and dangling exports", () => {
    expect(() =>
      normalizeFigmaJsonExport("x".repeat(FIGMA_IMPORT_MAX_BYTES + 1), {
        fileKey: "oversized",
      }),
    ).toThrow(/size limit/i);

    const nested: Record<string, unknown> = {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
    };
    let cursor = nested;
    for (let depth = 0; depth < 40; depth += 1) {
      const child: Record<string, unknown> = {
        id: `depth:${depth}`,
        name: `Depth ${depth}`,
        type: "FRAME",
      };
      cursor.children = [child];
      cursor = child;
    }
    expect(() =>
      normalizeFigmaJsonExport(
        JSON.stringify({ name: "Deep", document: nested }),
        { fileKey: "deep" },
      ),
    ).toThrow(/depth/i);

    expect(() =>
      normalizeFigmaJsonExport(
        JSON.stringify({
          name: "Duplicate",
          document: {
            id: "0:0",
            name: "Document",
            type: "DOCUMENT",
            children: [
              { id: "1:1", name: "One", type: "FRAME" },
              { id: "1:1", name: "Two", type: "FRAME" },
            ],
          },
        }),
        { fileKey: "duplicate" },
      ),
    ).toThrow(/duplicate/i);

    expect(() =>
      normalizeFigmaJsonExport('{"name":"Missing document"}', {
        fileKey: "malformed",
      }),
    ).toThrow(/document/i);
  });
});

describe("Figma production authority boundary", () => {
  it("does not reintroduce the legacy scene/autosave path for Figma imports", () => {
    expect(shippedMemiAppSource).toContain("createFigmaCanvasDocumentV3");
    expect(shippedMemiAppSource).toContain(
      "initializeCanvasDocumentV3Persistence",
    );
    expect(shippedMemiAppSource).not.toContain("createSceneState");
    expect(shippedMemiAppSource).not.toContain("createCanvasAutosave");
  });
});
