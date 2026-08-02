import { describe, expect, it } from "vitest";

import {
  CanvasNodeSchema,
  CoverageHealthSchema,
  EvidenceLevelSchema,
  FrameAuthoritySchema,
  FrameKindSchema,
  ProductManifestSchema,
} from "../src/index.js";
import { ids, productManifestFixture } from "./fixtures.js";

describe("canonical truth dimensions", () => {
  it("freezes frame authority, evidence level, and coverage health independently", () => {
    expect(FrameKindSchema.options).toEqual([
      "code-frame",
      "draft-frame",
      "snapshot-frame",
      "reference-frame",
    ]);
    expect(FrameAuthoritySchema.options).toEqual([
      "product-source",
      "canvas-document",
      "evidence-store",
      "external-reference",
    ]);
    expect(EvidenceLevelSchema.options).toEqual([
      "verified",
      "observed",
      "inferred",
      "reference",
      "proposed",
    ]);
    expect(CoverageHealthSchema.options).toEqual([
      "current",
      "partial",
      "blocked",
      "stale",
      "not-captured",
    ]);
  });

  it("rejects a frame whose authority contradicts its kind", () => {
    expect(
      CanvasNodeSchema.safeParse({
        id: ids.canvasNode,
        kind: "code-frame",
        authority: "canvas-document",
        evidenceLevel: "inferred",
        coverageHealth: "partial",
        parentId: null,
        position: { x: 0, y: 0 },
        size: { width: 1440, height: 900 },
        source: {
          routeId: ids.route,
          stateId: ids.state,
          coverageCellId: ids.coverageCell,
        },
      }).success,
    ).toBe(false);
  });
});

describe("source-mode authority", () => {
  it("accepts repository authority only on repository-backed modes", () => {
    expect(ProductManifestSchema.parse(productManifestFixture)).toEqual(
      productManifestFixture,
    );
  });

  it.each([
    {
      importMode: "running-url",
      source: {
        kind: "running-url",
        url: "http://127.0.0.1:4173",
      },
    },
    {
      importMode: "screenshot-folder",
      source: {
        kind: "screenshot-folder",
        root: "/workspace/screenshots",
        contentFingerprint: `sha256:${"c".repeat(64)}`,
      },
    },
    {
      importMode: "blank",
      source: {
        kind: "blank",
      },
    },
  ] as const)(
    "rejects fabricated repository fields for $importMode",
    ({ importMode, source }) => {
      const dimensions = productManifestFixture.dimensions;
      const result = ProductManifestSchema.safeParse({
        schemaVersion: 1,
        projectId: ids.project,
        importMode,
        source: {
          ...source,
          revision: "0123456789abcdef0123456789abcdef01234567",
          dirty: false,
        },
        dimensions,
      });

      expect(result.success).toBe(false);
    },
  );
});
