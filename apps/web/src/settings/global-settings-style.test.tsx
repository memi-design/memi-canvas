import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  resolve(process.cwd(), "apps/web/src/settings/global-settings.css"),
  "utf8",
);

describe("global settings Studio chrome", () => {
  it("uses the shared neutral and ruby token contract", () => {
    expect(stylesheet).toContain(
      "--settings-accent: var(--studio-accent);",
    );
    expect(stylesheet).toContain(
      "--settings-bg: var(--studio-surface-canvas);",
    );
    expect(stylesheet).toContain(
      "font-family: var(--studio-font-sans);",
    );
  });

  it("does not carry the former emerald, blue, olive, or warm chrome palette", () => {
    for (const legacyColor of [
      "#161817",
      "#1d201e",
      "#242825",
      "#2a302c",
      "#343a36",
      "#4b544e",
      "#28d995",
      "#81baff",
      "#102017",
      "#092218",
      "rgb(40 217 149",
      "rgb(82 157 247",
    ]) {
      expect(stylesheet).not.toContain(legacyColor);
    }
  });

  it("keeps editor chrome typography within the 400 to 600 weight range", () => {
    const weights = [
      ...stylesheet.matchAll(/font-weight:\s*(\d+)/g),
    ].map((match) => Number(match[1]));

    expect(weights.length).toBeGreaterThan(0);
    expect(weights.every((weight) => weight >= 400 && weight <= 600)).toBe(
      true,
    );
  });
});
