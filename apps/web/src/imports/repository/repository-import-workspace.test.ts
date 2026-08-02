import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("repository import workspace style contract", () => {
  const css = readFileSync(
    resolve(
      "apps/web/src/imports/repository/repository-import-workspace.css",
    ),
    "utf8",
  );
  const dialogCss = readFileSync(
    resolve("apps/web/src/imports/figma/figma-import-dialog.css"),
    "utf8",
  );

  it("uses Studio tokens instead of raw chrome colors", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).toContain("var(--studio-accent)");
    expect(css).toContain("var(--studio-surface-panel)");
  });

  it("uses OKLCH blending and a proportional interface face for import chrome", () => {
    expect(css).toContain("in oklch");
    expect(css).not.toContain("in srgb");
    expect(dialogCss).toContain('"Inter Variable"');
    expect(dialogCss).not.toContain("font-family: var(--studio-font-sans)");
  });

  it("disables progress animation when reduced motion is requested", () => {
    expect(css).toMatch(/@media\s+\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(
      /\.repository-import-progress__indeterminate[\s\S]*animation:\s*none/,
    );
  });
});
