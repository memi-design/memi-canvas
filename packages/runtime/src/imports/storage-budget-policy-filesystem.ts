import { lstat, readdir, statfs } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export interface StorageEntryInspection {
  readonly path: string;
  readonly bytes: number;
  readonly modifiedAtMs: number;
}

export function isMissingStorageEntry(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export async function inspectStorageTree(
  path: string,
  symbolicLinks: "reject" | "entry" = "reject",
  ignoredPaths: readonly string[] = [],
): Promise<StorageEntryInspection | null> {
  const normalized = resolve(path);
  if (ignoredPaths.includes(normalized)) return null;
  let metadata;
  try {
    metadata = await lstat(normalized);
  } catch (error) {
    if (isMissingStorageEntry(error)) return null;
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    if (symbolicLinks === "entry") {
      return Object.freeze({
        path,
        bytes: metadata.size,
        modifiedAtMs: metadata.mtimeMs,
      });
    }
    throw new Error("Memi storage cleanup may not traverse symbolic links.");
  }
  if (metadata.isFile()) {
    return Object.freeze({
      path,
      bytes: metadata.size,
      modifiedAtMs: metadata.mtimeMs,
    });
  }
  if (!metadata.isDirectory()) {
    throw new Error("Memi storage contains an unsupported entry type.");
  }
  let bytes = 0;
  let modifiedAtMs = metadata.mtimeMs;
  for (const entry of await readdir(normalized)) {
    const inspected = await inspectStorageTree(
      resolve(normalized, entry),
      symbolicLinks,
      ignoredPaths,
    );
    if (inspected === null) continue;
    bytes += inspected.bytes;
    modifiedAtMs = Math.max(modifiedAtMs, inspected.modifiedAtMs);
    if (!Number.isSafeInteger(bytes)) {
      throw new Error("Memi storage byte accounting overflowed.");
    }
  }
  return Object.freeze({ path, bytes, modifiedAtMs });
}

export async function inspectStorageChildren(
  root: string,
  symbolicLinks: "reject" | "entry" = "reject",
  nestedSymbolicLinks: "reject" | "entry" = symbolicLinks,
): Promise<readonly StorageEntryInspection[]> {
  let metadata;
  try {
    metadata = await lstat(root);
  } catch (error) {
    if (isMissingStorageEntry(error)) return Object.freeze([]);
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Memi storage root must be a real directory.");
  }
  const entries: StorageEntryInspection[] = [];
  for (const name of await readdir(root)) {
    const path = resolve(root, name);
    const child = await lstat(path);
    if (child.isSymbolicLink()) {
      if (symbolicLinks === "reject") {
        throw new Error("Memi storage cleanup may not traverse symbolic links.");
      }
      entries.push(Object.freeze({
        path,
        bytes: child.size,
        modifiedAtMs: child.mtimeMs,
      }));
      continue;
    }
    const inspected = await inspectStorageTree(path, nestedSymbolicLinks);
    if (inspected !== null) entries.push(inspected);
  }
  return Object.freeze(entries);
}

export function storageEntriesBytes(
  entries: readonly StorageEntryInspection[],
): number {
  return entries.reduce((total, entry) => total + entry.bytes, 0);
}

export function storagePathsOverlap(
  path: string,
  protectedPaths: readonly string[],
): boolean {
  return protectedPaths.some((protectedPath) => {
    const fromPath = relative(path, protectedPath);
    const fromProtected = relative(protectedPath, path);
    return (
      fromPath === "" ||
      (!fromPath.startsWith("..") && !isAbsolute(fromPath)) ||
      (!fromProtected.startsWith("..") && !isAbsolute(fromProtected))
    );
  });
}

export async function availableStorageBytes(root: string): Promise<number> {
  const statistics = await statfs(root);
  const bytes = Number(statistics.bavail) * Number(statistics.bsize);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("Available storage could not be measured safely.");
  }
  return bytes;
}
