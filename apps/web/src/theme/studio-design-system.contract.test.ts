import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve("apps/web/src");
const TOKEN_SOURCE = resolve(SOURCE_ROOT, "theme/studio-tokens.css");
const GLOBAL_STYLES = resolve(SOURCE_ROOT, "styles.css");
const IMPORTED_ARTWORK_ROOT = resolve(
  SOURCE_ROOT,
  "generated/imported-artwork",
);

const SOURCE_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);
const CORE_COLOR_ALIASES = [
  "--studio-surface-canvas",
  "--studio-surface-panel",
  "--studio-surface-raised",
  "--studio-surface-hover",
  "--studio-surface-strong",
  "--studio-border-subtle",
  "--studio-border-strong",
  "--studio-ink-primary",
  "--studio-ink-secondary",
  "--studio-ink-tertiary",
  "--studio-accent",
  "--studio-accent-hover",
  "--studio-accent-soft",
  "--studio-success",
  "--studio-warning",
  "--studio-danger",
] as const;

const GENERATED_ARTWORK_MARKER = "@generated imported-artwork";

function extension(filePath: string): string {
  const fileName = filePath.split(sep).at(-1) ?? "";
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot);
}

function listFiles(root: string): readonly string[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root)
    .flatMap((entry) => {
      const absolutePath = resolve(root, entry);
      return statSync(absolutePath).isDirectory()
        ? listFiles(absolutePath)
        : [absolutePath];
    })
    .sort();
}

function isIgnoredTestOrFixture(filePath: string): boolean {
  const normalized = filePath.split(sep).join("/");
  return (
    /(?:^|\/)__tests__(?:\/|$)/.test(normalized) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized) ||
    /\.(?:fixture|fixtures)\.[cm]?[jt]sx?$/.test(normalized) ||
    /(?:^|\/)(?:test-support|fixtures)(?:\/|\.|$)/.test(normalized)
  );
}

function isInside(root: string, filePath: string): boolean {
  const pathFromRoot = relative(root, filePath);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && pathFromRoot !== "..");
}

function productionSourceFiles(): readonly string[] {
  return listFiles(SOURCE_ROOT).filter(
    (filePath) =>
      SOURCE_EXTENSIONS.has(extension(filePath)) &&
      !isIgnoredTestOrFixture(filePath),
  );
}

function stripComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/(^|\s)\/\/[^\n]*/g, "$1");
}

function lineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function displayPath(filePath: string): string {
  return relative(resolve("."), filePath).split(sep).join("/");
}

function findMatches(
  filePath: string,
  pattern: RegExp,
): readonly string[] {
  const source = stripComments(readFileSync(filePath, "utf8"));
  return [...source.matchAll(pattern)].map(
    (match) =>
      `${displayPath(filePath)}:${lineNumber(source, match.index ?? 0)} ${match[0]}`,
  );
}

const LITERAL_COLOR_PATTERN =
  /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|lab|lch|color)\(\s*[-+]?(?:\d|\.\d)/gi;
const RAW_DURATION_PATTERN = /(?:^|[^\w-])(?:\d*\.)?\d+m?s\b/gi;
const CSS_FONT_WEIGHT_PATTERN = /font-weight\s*:\s*(\d+|bold|bolder)\b/gi;
const JS_FONT_WEIGHT_PATTERN =
  /fontWeight\s*:\s*(?:"|')?(\d+|bold|bolder)(?:"|')?\b/gi;

describe("consolidated Memi Studio design system contract", () => {
  it("uses a proportional interface family and reserves mono for code", () => {
    const tokenSource = stripComments(readFileSync(TOKEN_SOURCE, "utf8"));

    expect(tokenSource).toMatch(
      /--studio-font-interface\s*:[^;]*"Inter Variable"[^;]*;/,
    );
    expect(tokenSource).toMatch(
      /--studio-font-sans\s*:\s*var\(--studio-font-interface\)\s*;/,
    );
    expect(tokenSource).toMatch(
      /--studio-font-mono\s*:[^;]*"SFMono-Regular"[^;]*;/,
    );
  });

  it("does not ship the retired terminal display font in editor chrome", () => {
    const violations = productionSourceFiles().flatMap((filePath) =>
      findMatches(filePath, /Berkeley Mono/gi),
    );

    expect(
      violations,
      "Editor chrome must use the Studio interface family; reserve the mono token for compact code and identifiers only.",
    ).toEqual([]);
  });

  it("uses OKLCH when chrome blends Studio colors", () => {
    const violations = productionSourceFiles().flatMap((filePath) =>
      findMatches(filePath, /color-mix\(\s*in\s+srgb/gi),
    );

    expect(
      violations,
      "Studio blending must use OKLCH so dark and light mode preserve neutral contrast and ruby intent.",
    ).toEqual([]);
  });

  it("defines color primitives once and makes every semantic color an alias", () => {
    const tokenSource = stripComments(readFileSync(TOKEN_SOURCE, "utf8"));
    const primitiveDeclarations = [
      ...tokenSource.matchAll(
        /(--studio-color-[\w-]+)\s*:\s*([^;]+);/g,
      ),
    ];
    const missingAliases = CORE_COLOR_ALIASES.filter(
      (alias) => !new RegExp(`${alias}\\s*:`).test(tokenSource),
    );
    const nonAliasedSemantics = CORE_COLOR_ALIASES.flatMap((alias) => {
      const declarations = [
        ...tokenSource.matchAll(
          new RegExp(
            `${alias}\\s*:\\s*([^;]+);`,
            "g",
          ),
        ),
      ];

      return declarations
        .filter((declaration) => {
          const value = declaration[1]?.trim() ?? "";
          return !/^var\(--studio-color-[\w-]+\)$/.test(value);
        })
        .map((declaration) => `${alias}: ${declaration[1]?.trim()}`);
    });

    expect(
      primitiveDeclarations.length,
      "studio-tokens.css must define reusable --studio-color-* primitives",
    ).toBeGreaterThan(0);
    expect(
      primitiveDeclarations.every(([, , value]) =>
        value?.trim().startsWith("oklch("),
      ),
      "Studio primitives must use OKLCH values",
    ).toBe(true);
    expect(missingAliases, "all required semantic aliases must exist").toEqual(
      [],
    );
    expect(
      nonAliasedSemantics,
      "semantic color tokens must alias primitives instead of repeating literals",
    ).toEqual([]);
  });

  it("keeps literal chrome colors in the Studio token source only", () => {
    const chromeFiles = productionSourceFiles().filter(
      (filePath) =>
        filePath !== TOKEN_SOURCE &&
        !isInside(IMPORTED_ARTWORK_ROOT, filePath),
    );
    const violations = chromeFiles.flatMap((filePath) =>
      findMatches(filePath, LITERAL_COLOR_PATTERN),
    );

    expect(
      violations,
      [
        "Move each literal to apps/web/src/theme/studio-tokens.css.",
        "Imported product artwork belongs in apps/web/src/generated/imported-artwork/.",
      ].join(" "),
    ).toEqual([]);
  });

  it("uses motion tokens for every duration outside the token source", () => {
    const violations = productionSourceFiles()
      .filter(
        (filePath) =>
          filePath !== TOKEN_SOURCE &&
          !isInside(IMPORTED_ARTWORK_ROOT, filePath),
      )
      .flatMap((filePath) => findMatches(filePath, RAW_DURATION_PATTERN));

    expect(
      violations,
      "Raw ms/s durations must be declared once in studio-tokens.css and consumed with var(...)",
    ).toEqual([]);
  });

  it("provides one global tokenized reduced-motion override", () => {
    const tokenSource = stripComments(readFileSync(TOKEN_SOURCE, "utf8"));
    const globalStyles = stripComments(readFileSync(GLOBAL_STYLES, "utf8"));
    const reducedMotionBlock =
      globalStyles.match(
        /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/,
      )?.[1] ?? "";

    expect(tokenSource).toMatch(
      /--studio-motion-reduced\s*:\s*(?:\d*\.)?\d+m?s\s*;/,
    );
    expect(reducedMotionBlock).toContain(
      "animation-duration: var(--studio-motion-reduced) !important;",
    );
    expect(reducedMotionBlock).toContain(
      "transition-duration: var(--studio-motion-reduced) !important;",
    );
    expect(reducedMotionBlock).toContain("scroll-behavior: auto !important;");
  });

  it("keeps all editor chrome font weights between 400 and 600", () => {
    const violations = productionSourceFiles()
      .filter((filePath) => !isInside(IMPORTED_ARTWORK_ROOT, filePath))
      .flatMap((filePath) => {
        const source = stripComments(readFileSync(filePath, "utf8"));
        const matches = [
          ...source.matchAll(CSS_FONT_WEIGHT_PATTERN),
          ...source.matchAll(JS_FONT_WEIGHT_PATTERN),
        ];

        return matches.flatMap((match) => {
          const rawWeight = match[1]?.toLowerCase() ?? "";
          const weight =
            rawWeight === "bold" || rawWeight === "bolder"
              ? 700
              : Number(rawWeight);

          return weight >= 400 && weight <= 600
            ? []
            : [
                `${displayPath(filePath)}:${lineNumber(
                  source,
                  match.index ?? 0,
                )} ${match[0]}`,
              ];
        });
      });

    expect(
      violations,
      "Memi chrome uses weights 400, 500, and rare 600 only",
    ).toEqual([]);
  });

  it("isolates literal imported product colors in an explicit generated boundary", () => {
    const importedArtworkFiles = productionSourceFiles().filter((filePath) =>
      isInside(IMPORTED_ARTWORK_ROOT, filePath),
    );
    const misplacedProductColorFiles = productionSourceFiles()
      .filter(
        (filePath) =>
          filePath !== TOKEN_SOURCE &&
          !isInside(IMPORTED_ARTWORK_ROOT, filePath),
      )
      .filter(
        (filePath) =>
          findMatches(filePath, LITERAL_COLOR_PATTERN).length > 0,
      )
      .map(displayPath);
    const unmarkedGeneratedFiles = importedArtworkFiles
      .filter(
        (filePath) =>
          findMatches(filePath, LITERAL_COLOR_PATTERN).length > 0,
      )
      .filter(
        (filePath) =>
          !readFileSync(filePath, "utf8").includes(GENERATED_ARTWORK_MARKER),
      )
      .map(displayPath);

    expect(
      misplacedProductColorFiles,
      "Static product artwork colors must not live beside editor chrome",
    ).toEqual([]);
    expect(
      unmarkedGeneratedFiles,
      `Generated color-bearing files must include "${GENERATED_ARTWORK_MARKER}"`,
    ).toEqual([]);
  });
});
