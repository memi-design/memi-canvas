import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readStaticSources } from "./filesystem.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("Expo Router source traversal budgets", () => {
  it("stops at maxFiles before traversing later directory entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-expo-traversal-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "app", "zzz"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"name":"bounded"}\n');
    await writeFile(join(root, "app", "000.tsx"), "export default 0;\n");
    await writeFile(join(root, "app", "001.tsx"), "export default 1;\n");
    await symlink("/etc/hosts", join(root, "app", "zzz", "escape.tsx"));

    await expect(
      readStaticSources(root, {
        maxFiles: 2,
        maxEntries: 32,
        maxDepth: 8,
        maxFileBytes: 1_024,
        maxTotalBytes: 4_096,
      }),
    ).rejects.toThrow("Expo import file count budget exceeded.");
  });

  it("does not charge ignored files or directories against maxFiles", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-expo-traversal-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "app", "empty", "nested"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"name":"bounded"}\n');
    await writeFile(join(root, "app", "index.tsx"), "export default 0;\n");
    await writeFile(join(root, "app", "notes.txt"), "ignored\n");

    await expect(
      readStaticSources(root, {
        maxFiles: 2,
        maxEntries: 32,
        maxDepth: 8,
        maxFileBytes: 1_024,
        maxTotalBytes: 4_096,
      }),
    ).resolves.toMatchObject({
      files: [
        { sourcePath: "app/index.tsx" },
        { sourcePath: "package.json" },
      ],
    });
  });

  it("bounds ignored directory entries and nesting before descent", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-expo-traversal-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "app", "a", "b", "c"), {
      recursive: true,
    });
    await writeFile(join(root, "package.json"), '{"name":"bounded"}\n');
    await writeFile(join(root, "app", "notes.txt"), "ignored\n");

    await expect(
      readStaticSources(root, {
        maxFiles: 8,
        maxEntries: 2,
        maxDepth: 8,
        maxFileBytes: 1_024,
        maxTotalBytes: 4_096,
      }),
    ).rejects.toThrow("Expo import entry count budget exceeded.");

    await expect(
      readStaticSources(root, {
        maxFiles: 8,
        maxEntries: 32,
        maxDepth: 1,
        maxFileBytes: 1_024,
        maxTotalBytes: 4_096,
      }),
    ).rejects.toThrow("Expo import directory depth budget exceeded.");
  });
});
