import { resolve } from "node:path";

import type {
  RepositoryManifestEntry,
  RepositoryManifestInput,
} from "@memi/capture-platforms";

import {
  assertContained,
  RepositoryBoundaryError,
  throwIfAborted,
  validateRelativePath,
} from "./guards.js";
import type {
  RepositoryDirectoryEntry,
  RepositoryInventoryOptions,
} from "./types.js";

const IGNORED_DIRECTORIES = new Set([
  ".build",
  ".expo",
  ".git",
  ".next",
  ".turbo",
  "DerivedData",
  "Pods",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const SOURCE_FILE_PATTERN = /\.(?:js|jsx|swift|ts|tsx|xcscheme)$/u;

function isInventoryFile(path: string): boolean {
  const basename = path.split("/").at(-1) ?? "";
  return (
    basename === "package.json" ||
    basename === "app.json" ||
    basename === "app.config.json" ||
    basename === ".gitattributes" ||
    basename === "project.pbxproj" ||
    basename === "contents.xcworkspacedata" ||
    (path.split("/").includes(".maestro") &&
      /\.(?:yaml|yml)$/u.test(basename)) ||
    SOURCE_FILE_PATTERN.test(basename)
  );
}

function assertEntryName(entry: RepositoryDirectoryEntry): void {
  if (
    entry.name.length === 0 ||
    entry.name === "." ||
    entry.name === ".." ||
    entry.name.includes("/") ||
    entry.name.includes("\\") ||
    entry.name.includes("\0")
  ) {
    throw new RepositoryBoundaryError(
      "path-escape",
      "Repository directory returned an unsafe entry name.",
    );
  }
}

async function readText(
  options: RepositoryInventoryOptions,
  absolutePath: string,
  relativePath: string,
): Promise<RepositoryManifestEntry> {
  const canonicalPath = await options.fileSystem.realpath(absolutePath);
  assertContained(options.rootPath, canonicalPath, relativePath);
  const bytes = await options.fileSystem.readFile(canonicalPath);
  if (bytes.byteLength > options.budgets.maxFileBytes) {
    throw new RepositoryBoundaryError(
      "budget-exceeded",
      `Repository file exceeds the inventory byte budget: ${relativePath}`,
    );
  }
  try {
    return {
      path: relativePath,
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch (error) {
    throw new RepositoryBoundaryError(
      "invalid-text",
      `Repository inventory file is not valid UTF-8 text: ${relativePath}`,
      { cause: error },
    );
  }
}

export async function inventoryRepository(
  options: RepositoryInventoryOptions,
): Promise<readonly RepositoryManifestEntry[]> {
  const entries: RepositoryManifestEntry[] = [];
  let totalBytes = 0;

  async function visit(directory: string, prefix: string, depth: number) {
    throwIfAborted(options.signal);
    if (depth > options.budgets.maxDepth) {
      throw new RepositoryBoundaryError(
        "budget-exceeded",
        "Repository inventory path depth budget exceeded.",
      );
    }
    const children = [...await options.fileSystem.readDirectory(directory)].sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const child of children) {
      throwIfAborted(options.signal);
      assertEntryName(child);
      if (child.kind === "directory" && IGNORED_DIRECTORIES.has(child.name)) {
        continue;
      }
      const relativePath = validateRelativePath(
        prefix.length === 0 ? child.name : `${prefix}/${child.name}`,
      );
      const absolutePath = assertContained(
        options.rootPath,
        resolve(directory, child.name),
        relativePath,
      );
      if (child.kind === "symlink") {
        continue;
      }
      if (child.kind === "directory") {
        const canonical = await options.fileSystem.realpath(absolutePath);
        assertContained(options.rootPath, canonical, relativePath);
        await visit(canonical, relativePath, depth + 1);
      } else if (isInventoryFile(relativePath)) {
        const entry = await readText(options, absolutePath, relativePath);
        totalBytes += new TextEncoder().encode(entry.content).byteLength;
        if (
          entries.length + 1 > options.budgets.maxEntries ||
          totalBytes > options.budgets.maxTotalBytes
        ) {
          throw new RepositoryBoundaryError(
            "budget-exceeded",
            "Repository inventory safety budget exceeded.",
          );
        }
        entries.push(entry);
      }
    }
  }

  await visit(options.rootPath, "", 1);
  return entries;
}

export function toRepositoryManifest(input: {
  readonly budgets: RepositoryManifestInput["budgets"];
  readonly dirtyFileFingerprint: RepositoryManifestInput["repository"]["dirtyFileFingerprint"];
  readonly entries: readonly RepositoryManifestEntry[];
  readonly revision: string;
}): RepositoryManifestInput {
  return {
    schemaVersion: 1,
    repository: {
      revision: input.revision,
      dirtyFileFingerprint: input.dirtyFileFingerprint,
    },
    budgets: input.budgets,
    entries: input.entries,
  };
}
