import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve("apps/web/src/canvas/workbench.css"),
  "utf8",
);
const interactionsCss = readFileSync(
  resolve("apps/web/src/canvas/interactions.css"),
  "utf8",
);
const gridCss = readFileSync(
  resolve("apps/web/src/canvas/canvas-grid.css"),
  "utf8",
);

const artworkSelectorPrefixes = [
  ".canvas-node__surface",
  ".canvas-node--",
  ".component-preview",
  ".reference-frame",
  ".source-frame-preview",
];

const chromeCss = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
  .filter(([, selector]) => {
    const normalizedSelector = selector?.trim() ?? "";
    return !artworkSelectorPrefixes.some((prefix) =>
      normalizedSelector.includes(prefix),
    );
  })
  .map((match) => match[0])
  .join("\n");

describe("Memi editor Studio theme contract", () => {
  it("aliases editor chrome to the shared neutral and ruby tokens", () => {
    expect(css).toContain("--canvas-bg: var(--studio-surface-canvas);");
    expect(css).toContain("--chrome: var(--studio-surface-panel);");
    expect(css).toContain("--panel: var(--studio-surface-panel);");
    expect(css).toContain("--panel-raised: var(--studio-surface-hover);");
    expect(css).toContain("--line: var(--studio-border-subtle);");
    expect(css).toContain("--muted: var(--studio-ink-secondary);");
    expect(css).toContain("--text: var(--studio-ink-primary);");
    expect(css).toContain("--accent: var(--studio-accent);");
    expect(css).toContain("--accent-dark: var(--studio-accent-soft);");
    expect(css).toContain("font-family: var(--studio-font-sans);");
  });

  it("keeps raw product colors inside artwork instead of editor chrome", () => {
    expect(chromeCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(chromeCss).not.toMatch(/\brgba?\(/i);
    expect(chromeCss).not.toContain("%23");
    expect(css).toContain(".source-frame-preview__topbar strong");
    expect(css).toContain("color: var(--studio-accent);");
  });

  it("uses ruby selection tokens and keeps chrome weights at 600 or below", () => {
    expect(css).toMatch(
      /\.canvas-tool\[aria-pressed="true"\][\s\S]*?background:\s*var\(--accent-dark\)/,
    );
    expect(css).toMatch(
      /\.layers-tree \.layer-leaf\[aria-selected="true"\][\s\S]*?background:\s*var\(--accent-dark\)/,
    );
    expect(interactionsCss).toMatch(
      /\.canvas-node__selection-bounds[\s\S]*?border-color:\s*var\(--accent\)/,
    );
    expect(interactionsCss).toMatch(
      /\.canvas-node__selection-bounds[\s\S]*?inset:\s*0[\s\S]*?position:\s*absolute[\s\S]*?pointer-events:\s*none/,
    );
    expect(interactionsCss).toMatch(
      /\.canvas-node__selection-handle[\s\S]*?height:\s*calc\(8px \* var\(--canvas-inverse-zoom\)\)[\s\S]*?position:\s*absolute[\s\S]*?width:\s*calc\(8px \* var\(--canvas-inverse-zoom\)\)/,
    );
    expect(interactionsCss).toContain(
      ".canvas-node__selection-handle--nw",
    );
    expect(interactionsCss).toContain(
      ".canvas-node__selection-handle--se",
    );
    expect(css).not.toContain(".canvas-node__selection-bounds {");
    expect(css).not.toContain(".canvas-node__selection-handle {");

    const weights = Array.from(
      chromeCss.matchAll(/font-weight:\s*(\d+)/g),
      (match) => Number(match[1]),
    );
    expect(weights.every((weight) => weight <= 600)).toBe(true);
  });

  it("keeps spatial grid, guides, inspector groups, and chat dock in the editor contract", () => {
    expect(gridCss).toContain("--canvas-grid-minor");
    expect(gridCss).toContain("--canvas-grid-major");
    expect(gridCss).toContain("background-position:");
    expect(css).toContain(".canvas-alignment-guide");
    expect(css).toContain(".inspector-section");
    expect(css).toContain("max-width: 760px");
    expect(css).not.toContain("left: 252px");
  });

  it("renders both adaptive grid scales at a restrained 2.5 percent opacity", () => {
    expect(gridCss).toContain("--canvas-grid-line-opacity: 2.5%");
    expect(
      gridCss.match(/var\(--canvas-grid-line-opacity\)/g)?.length,
    ).toBe(4);
    expect(gridCss).not.toMatch(
      /color-mix\(in oklch, var\(--line(?:-strong)?\) (?:34|62)%/,
    );
  });

  it("keeps the detached metadata tag visible below edge-adjacent artwork", () => {
    expect(css).toMatch(
      /\.canvas-node__metadata-tag[\s\S]*?top:\s*calc\(100% \+ \(6px \* var\(--canvas-inverse-zoom\)\)\)/,
    );
    expect(css).not.toMatch(
      /\.canvas-node__metadata-tag[\s\S]*?bottom:\s*calc\(100%/,
    );
  });

  it("keeps transform handles and tool cursors usable at every canvas zoom", () => {
    expect(css).toContain("--canvas-inverse-zoom");
    expect(css).toMatch(
      /\.canvas-node__resize[\s\S]*?width:\s*calc\(12px \* var\(--canvas-inverse-zoom\)\)/,
    );
    expect(css).toContain(
      '.canvas-viewport[data-tool="Text"] .canvas-node__surface',
    );
    expect(css).toContain(
      ") .canvas-node__surface {\n  cursor: crosshair;",
    );
  });

  it("visually separates hover, locked, and source-linked interaction states", () => {
    expect(interactionsCss).toMatch(
      /\.canvas-node:not\(\[data-selected="true"\]\)[\s\S]*?\.canvas-node__surface:hover[\s\S]*?outline:/,
    );
    expect(interactionsCss).toMatch(
      /\.canvas-node\[data-interaction-restriction="locked"\][\s\S]*?\.canvas-node__selection-bounds/,
    );
    expect(interactionsCss).toMatch(
      /\.canvas-node\[data-interaction-restriction="source-linked"\][\s\S]*?\.canvas-node__selection-bounds/,
    );
    expect(interactionsCss).toMatch(
      /\.canvas-node\[data-interaction-restriction="source-linked"\]\[data-direct-manipulation="move"\][\s\S]*?\.canvas-node__selection-bounds[\s\S]*?var\(--accent-soft\)/,
    );
    expect(interactionsCss).toMatch(
      /\.canvas-node\[data-moving="true"\][\s\S]*?cursor:\s*grabbing/,
    );
    expect(interactionsCss).toMatch(
      /\.canvas-node__drop-target[\s\S]*?pointer-events:\s*none[\s\S]*?position:\s*absolute/,
    );
  });
});
