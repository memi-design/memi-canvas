import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface PackageJson {
  readonly exports: {
    readonly ".": {
      readonly types: string;
      readonly default: string;
    };
    readonly "./projector": {
      readonly types: string;
      readonly default: string;
    };
  };
  readonly dependencies: Readonly<Record<string, string>>;
}

interface SourceFile {
  readonly path: string;
  readonly source: string;
}

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const LOCAL_IMPORT =
  /(?:from\s+|import\s*\(\s*)["'](\.[^"']+)["']/gu;
const FORBIDDEN_ROOT_IMPORT =
  /(?:from\s+|import\s*\(\s*)["'](?:node:|@memi\/(?:runtime|product-import|canonical-json)|[^"']*(?:sqlite))[^"']*["']/iu;

function typescriptPath(importer: string, specifier: string): string {
  const resolved = resolve(dirname(importer), specifier);
  return resolved.endsWith(".js")
    ? `${resolved.slice(0, -3)}.ts`
    : resolved;
}

async function rootImportGraph(entry: string): Promise<readonly SourceFile[]> {
  const pending = [entry];
  const visited = new Set<string>();
  const sources: SourceFile[] = [];
  while (pending.length > 0) {
    const path = pending.shift()!;
    if (visited.has(path)) {
      continue;
    }
    visited.add(path);
    const source = await readFile(path, "utf8");
    sources.push({
      path: relative(PACKAGE_ROOT, path).replaceAll("\\", "/"),
      source,
    });
    for (const match of source.matchAll(LOCAL_IMPORT)) {
      pending.push(typescriptPath(path, match[1]!));
    }
  }
  return sources.sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

describe("@memi/workspace-documentation package boundary", () => {
  it("exposes a browser-safe root and an explicit Node-only projector subpath", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(PACKAGE_ROOT, "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.exports).toEqual({
      ".": {
        types: "./src/index.ts",
        default: "./src/index.ts",
      },
      "./projector": {
        types: "./src/projector.ts",
        default: "./src/projector.ts",
      },
    });
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      "@memi/canonical-json",
      "@memi/product-import",
      "@memi/protocol",
      "zod",
    ]);
  });

  it("keeps the complete root import graph browser-safe and Zod-only", async () => {
    const sources = await rootImportGraph(
      resolve(PACKAGE_ROOT, "src/index.ts"),
    );
    const violations = sources.flatMap(({ path, source }) => {
      const imports = [...source.matchAll(
        /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/gu,
      )].map((match) => match[1]!);
      return [
        ...(FORBIDDEN_ROOT_IMPORT.test(source)
          ? [`${path}: forbidden root capability import`]
          : []),
        ...imports
          .filter(
            (specifier) =>
              !specifier.startsWith(".") && specifier !== "zod",
          )
          .map((specifier) => `${path}: ${specifier}`),
        ...(/\b(?:Buffer|process|require|__dirname|__filename)\b/u.test(
          source,
        )
          ? [`${path}: Node global`]
          : []),
      ];
    });

    expect(sources.map((source) => source.path)).toContain(
      "src/index.ts",
    );
    expect(violations).toEqual([]);
  });

  it("does not let the projector call runtime or own persistence", async () => {
    const projector = await readFile(
      resolve(PACKAGE_ROOT, "src/projector.ts"),
      "utf8",
    );

    expect(projector).not.toMatch(
      /@memi\/runtime|replayCanvasTrace\s*\(|new\s+DurableRuntime|\b(?:DatabaseSync|sqlite|readFile|writeFile|fetch)\b/u,
    );
    expect(projector).not.toMatch(
      /(?:child_process|net|http|https|WebSocket|openai|anthropic)/iu,
    );
  });
});
