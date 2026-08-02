import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = import.meta.dirname;

async function sourceFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return await sourceFiles(path);
    }
    if (
      entry.isFile() &&
      path.endsWith(".ts") &&
      !path.endsWith(".test.ts")
    ) {
      return [path];
    }
    return [];
  }));
  return nested.flat();
}

describe("packaged sidecar import boundary", () => {
  it("keeps production runtime-sidecar sources off the capture-execution barrel", async () => {
    const files = await sourceFiles(SOURCE_ROOT);
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (source.includes('from "@memi/capture-execution"')) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
