import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appStyles = readFileSync(
  resolve("apps/web/src/styles.css"),
  "utf8",
);
const docsStyles = readFileSync(
  resolve("apps/web/src/workspace-documentation.css"),
  "utf8",
);
const sidebarStyles = readFileSync(
  resolve("apps/web/src/canvas/canvas-sidebar.css"),
  "utf8",
);

describe("secondary Studio surfaces", () => {
  it("alias app-level documentation surfaces to the shared Studio tokens", () => {
    expect(appStyles).toContain("--surface-canvas: var(--studio-surface-canvas);");
    expect(appStyles).toContain("--surface-panel: var(--studio-surface-panel);");
    expect(appStyles).toContain("--surface-elevated: var(--studio-surface-raised);");
    expect(appStyles).toContain("--surface-strong: var(--studio-surface-strong);");
    expect(appStyles).toContain("--ink-primary: var(--studio-ink-primary);");
    expect(appStyles).toContain("--ink-secondary: var(--studio-ink-secondary);");
    expect(appStyles).toContain("--border-subtle: var(--studio-border-subtle);");
    expect(appStyles).toContain("--border-strong: var(--studio-border-strong);");
    expect(appStyles).toContain("--accent: var(--studio-accent);");
    expect(appStyles).toContain("--accent-soft: var(--studio-accent-soft);");
    expect(appStyles).toContain("font-family: var(--studio-font-sans);");
  });

  it("does not carry the former olive, beige, or warm documentation chrome", () => {
    for (const legacyColor of [
      "#eef1ec",
      "#f9faf7",
      "#202a25",
      "#176b4a",
      "#dceee5",
      "#8a5a12",
      "#f7ead3",
      "#9b3b35",
      "#f9dfdc",
      "#2b3731",
      "#e9b6b1",
      "#cc827a",
      "#7c4a45",
    ]) {
      expect(appStyles).not.toContain(legacyColor);
      expect(docsStyles).not.toContain(legacyColor);
    }
  });

  it("keeps secondary chrome typography within the 400 to 600 weight range", () => {
    const weights = [
      ...appStyles.matchAll(/font-weight:\s*(\d+)/g),
      ...docsStyles.matchAll(/font-weight:\s*(\d+)/g),
      ...sidebarStyles.matchAll(/font-weight:\s*(\d+)/g),
    ].map((match) => Number(match[1]));

    expect(weights.length).toBeGreaterThan(0);
    expect(weights.every((weight) => weight >= 400 && weight <= 600)).toBe(true);
  });
});
