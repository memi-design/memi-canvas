import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  type CanvasBrandTruth,
  findCanvasBrandDivergences,
  findUnqualifiedProductionClaims,
  inspectPublicTruth,
} from "../../../scripts/public-truth-boundary.js";

const MANIFEST_CANVAS_TRUTH = Object.freeze({
  identity: "memi Canvas",
  status: "development",
  license: "Apache-2.0",
  repository: "https://github.com/memi-design/memi-canvas",
  iconSha256:
    "da068f20ba9e0e43f59ebde8602b43342f8c77fef2c080155a18d5a8fd0e25c2",
  iconSourceUrl:
    "https://raw.githubusercontent.com/memi-design/memi-canvas/main/apps/macos/src-tauri/icons/source/MemiCanvas-Iteration-02.icon/icon.json",
}) satisfies CanvasBrandTruth;

describe("Memi Canvas public truth boundary", () => {
  it("rejects unqualified production importer and source-editing claims", () => {
    const source = [
      "This is not a toy. Memi Canvas is a production importer.",
      "Production source editing is available from the canvas.",
      "The editor mutates repository source in production.",
    ].join("\n");

    expect(findUnqualifiedProductionClaims(source, "public-copy.md")).toEqual([
      expect.objectContaining({
        code: "unqualified-production-claim",
        line: 1,
      }),
      expect.objectContaining({
        code: "unqualified-production-claim",
        line: 2,
      }),
      expect.objectContaining({
        code: "unqualified-production-claim",
        line: 3,
      }),
    ]);
  });

  it("accepts explicit development and no-go qualifications", () => {
    const source = [
      "Memi Canvas is not a production importer.",
      "Production source editing remains disabled while the security veto is active.",
      "Repository source mutation in production is planned, not available today.",
      "The importer is an in-development fixture, not production-ready.",
    ].join("\n");

    expect(findUnqualifiedProductionClaims(source, "public-copy.md")).toEqual(
      [],
    );
  });

  it("does not mistake ordinary production source files for editing claims", () => {
    expect(
      findUnqualifiedProductionClaims(
        "The build compiles production source files and verifies the bundle.",
        "build-notes.md",
      ),
    ).toEqual([]);
  });

  it.each([
    ["identity", "Memi Canvas"],
    ["status", "available"],
    ["license", "MIT"],
    ["repository", "https://github.com/example/memi-canvas"],
    ["iconSha256", "0".repeat(64)],
    ["iconSourceUrl", "https://example.com/icon.json"],
  ] as const)("rejects %s drift from the checked-in manifest", (field, value) => {
    const publicTruth = Object.freeze({
      ...MANIFEST_CANVAS_TRUTH,
      [field]: value,
    });

    expect(
      findCanvasBrandDivergences(MANIFEST_CANVAS_TRUTH, publicTruth),
    ).toEqual([
      expect.objectContaining({
        code: "brand-manifest-divergence",
        detail: expect.stringContaining(field),
      }),
    ]);
  });

  it("keeps the manifest gate offline-only", async () => {
    const source = await readFile(
      new URL("../../../scripts/public-truth-boundary.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/\bfetch\s*\(|\bhttps?\.(?:get|request)\s*\(/u);
  });

  it("keeps the checked-in public brand and capability surfaces truthful", async () => {
    await expect(inspectPublicTruth(process.cwd())).resolves.toEqual([]);
  });
});
