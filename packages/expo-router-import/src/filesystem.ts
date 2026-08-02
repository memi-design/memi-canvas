import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  open,
  opendir,
  realpath,
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type { ContentHash, ImportBudgets } from "./types.js";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const IMPORT_ROOTS = ["app", "components", "constants", "src"] as const;
const HARD_MAX_FILES = 10_000;
const HARD_MAX_ENTRIES = 100_000;
const HARD_MAX_DEPTH = 128;
const HARD_MAX_FILE_BYTES = 16 * 1024 * 1024;
const HARD_MAX_TOTAL_BYTES = 128 * 1024 * 1024;

export type StaticSourceRole = "manifest" | "route" | "token" | "component";

export interface VerifiedStaticSource {
  readonly sourcePath: string;
  readonly role: StaticSourceRole;
  readonly bytes: Buffer;
  readonly contentHash: ContentHash;
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly nlink: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

interface DiscoveryResult {
  readonly sourcePaths: readonly string[];
  readonly remainingFiles: number;
  readonly remainingEntries: number;
}

function sha256(bytes: Buffer | string): ContentHash {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function extension(path: string): string {
  const match = path.match(/\.[^./]+$/u);
  return match?.[0].toLowerCase() ?? "";
}

function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extension(path)) && !path.endsWith(".d.ts");
}

function roleFor(sourcePath: string): StaticSourceRole | null {
  if (sourcePath === "package.json") {
    return "manifest";
  }
  if (!isSourceFile(sourcePath)) {
    return null;
  }
  if (sourcePath.startsWith(`app${sep}`) || sourcePath.startsWith("app/")) {
    return "route";
  }
  if (sourcePath.startsWith("components/")) {
    return "component";
  }
  const basename = sourcePath.split("/").at(-1) ?? "";
  const tokenName =
    /(?:^|[-_.])(colors?|design-system|palette|shadow|spacing|token|tokens|typograph(?:y|ic)?|radius)(?:[-_.]|$)/iu;
  if (
    sourcePath.startsWith("constants/") ||
    sourcePath.startsWith("src/theme/") ||
    (tokenName.test(basename) && !sourcePath.includes("/services/"))
  ) {
    return "token";
  }
  if (
    sourcePath.includes("/components/") ||
    sourcePath.includes("/screens/") ||
    sourcePath.includes("/atoms/") ||
    sourcePath.includes("/molecules/") ||
    sourcePath.includes("/organisms/")
  ) {
    return "component";
  }
  return null;
}

function isContained(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function identity(stats: BigIntStats): FileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    nlink: stats.nlink,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
  };
}

function sameIdentity(expected: FileIdentity, actual: BigIntStats): boolean {
  const found = identity(actual);
  return (
    expected.dev === found.dev &&
    expected.ino === found.ino &&
    expected.mode === found.mode &&
    expected.nlink === found.nlink &&
    expected.size === found.size &&
    expected.mtimeNs === found.mtimeNs &&
    expected.ctimeNs === found.ctimeNs
  );
}

function assertBudgets(budgets: ImportBudgets): void {
  if (
    !Number.isSafeInteger(budgets.maxFiles) ||
    budgets.maxFiles <= 0 ||
    budgets.maxFiles > HARD_MAX_FILES ||
    !Number.isSafeInteger(budgets.maxEntries) ||
    budgets.maxEntries <= 0 ||
    budgets.maxEntries > HARD_MAX_ENTRIES ||
    !Number.isSafeInteger(budgets.maxDepth) ||
    budgets.maxDepth <= 0 ||
    budgets.maxDepth > HARD_MAX_DEPTH ||
    !Number.isSafeInteger(budgets.maxFileBytes) ||
    budgets.maxFileBytes <= 0 ||
    budgets.maxFileBytes > HARD_MAX_FILE_BYTES ||
    !Number.isSafeInteger(budgets.maxTotalBytes) ||
    budgets.maxTotalBytes < budgets.maxFileBytes ||
    budgets.maxTotalBytes > HARD_MAX_TOTAL_BYTES
  ) {
    throw new Error("Expo import budgets are invalid or exceed hard limits.");
  }
}

async function assertCanonicalPath(
  root: string,
  candidate: string,
  sourcePath: string,
): Promise<void> {
  const canonical = await realpath(candidate);
  if (!isContained(root, canonical) || canonical !== candidate) {
    throw new Error(
      `Expo import source resolves through a symbolic link or outside the project: ${sourcePath}`,
    );
  }
}

async function discoverDirectory(
  root: string,
  candidate: string,
  remainingFiles: number,
  remainingEntries: number,
  depth: number,
  maxDepth: number,
): Promise<DiscoveryResult> {
  if (remainingEntries === 0) {
    throw new Error("Expo import entry count budget exceeded.");
  }
  if (depth > maxDepth) {
    throw new Error("Expo import directory depth budget exceeded.");
  }
  const nextRemainingEntries = remainingEntries - 1;
  let initial: BigIntStats;
  try {
    initial = await lstat(candidate, { bigint: true });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        sourcePaths: [],
        remainingFiles,
        remainingEntries: nextRemainingEntries,
      };
    }
    throw error;
  }
  const sourcePath = relative(root, candidate).split(sep).join("/");
  const sourceRole = roleFor(sourcePath);
  const countsTowardFileBudget =
    !initial.isDirectory() && sourceRole !== null;
  if (countsTowardFileBudget && remainingFiles === 0) {
    throw new Error("Expo import file count budget exceeded.");
  }
  const nextRemainingFiles = countsTowardFileBudget
    ? remainingFiles - 1
    : remainingFiles;
  if (initial.isSymbolicLink()) {
    throw new Error(`Expo import source is a symbolic link: ${sourcePath}`);
  }
  await assertCanonicalPath(root, candidate, sourcePath);
  if (!initial.isDirectory()) {
    return {
      sourcePaths: sourceRole === null ? [] : [sourcePath],
      remainingFiles: nextRemainingFiles,
      remainingEntries: nextRemainingEntries,
    };
  }
  let entries: readonly string[] = [];
  const directory = await opendir(candidate);
  for await (const entry of directory) {
    if (entries.length >= nextRemainingEntries) {
      throw new Error("Expo import entry count budget exceeded.");
    }
    entries = [...entries, entry.name];
  }
  entries = [...entries].sort();
  let nested: readonly string[] = [];
  let nestedRemainingFiles = nextRemainingFiles;
  let nestedRemainingEntries = nextRemainingEntries;
  for (const entry of entries) {
    const discovered = await discoverDirectory(
      root,
      join(candidate, entry),
      nestedRemainingFiles,
      nestedRemainingEntries,
      depth + 1,
      maxDepth,
    );
    nested = [...nested, ...discovered.sourcePaths];
    nestedRemainingFiles = discovered.remainingFiles;
    nestedRemainingEntries = discovered.remainingEntries;
  }
  const current = await lstat(candidate, { bigint: true });
  if (!current.isDirectory() || !sameIdentity(identity(initial), current)) {
    throw new Error(`Expo import directory changed during discovery: ${sourcePath}`);
  }
  await assertCanonicalPath(root, candidate, sourcePath);
  return {
    sourcePaths: nested,
    remainingFiles: nestedRemainingFiles,
    remainingEntries: nestedRemainingEntries,
  };
}

async function readBounded(
  handle: Awaited<ReturnType<typeof open>>,
  maxFileBytes: number,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(maxFileBytes + 1);
  let total = 0;
  while (total < buffer.byteLength) {
    const { bytesRead } = await handle.read(
      buffer,
      total,
      buffer.byteLength - total,
      total,
    );
    if (bytesRead === 0) {
      break;
    }
    total += bytesRead;
    if (total > maxFileBytes) {
      throw new Error("Expo import file byte budget exceeded.");
    }
  }
  return buffer.subarray(0, total);
}

async function readVerifiedSource(
  root: string,
  sourcePath: string,
  maxFileBytes: number,
): Promise<VerifiedStaticSource> {
  const candidate = resolve(root, sourcePath);
  if (!isContained(root, candidate)) {
    throw new Error(`Expo import source escapes the project: ${sourcePath}`);
  }
  const initial = await lstat(candidate, { bigint: true });
  if (initial.isSymbolicLink()) {
    throw new Error(`Expo import source is a symbolic link: ${sourcePath}`);
  }
  if (!initial.isFile() || initial.nlink !== 1n) {
    throw new Error(`Expo import source is not an independent regular file: ${sourcePath}`);
  }
  if (initial.size > BigInt(maxFileBytes)) {
    throw new Error(`Expo import file byte budget exceeded: ${sourcePath}`);
  }
  await assertCanonicalPath(root, candidate, sourcePath);
  const expected = identity(initial);
  const handle = await open(
    candidate,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(expected, opened)) {
      throw new Error(`Expo import source changed during snapshot: ${sourcePath}`);
    }
    const bytes = await readBounded(handle, maxFileBytes);
    const final = await handle.stat({ bigint: true });
    if (!sameIdentity(expected, final)) {
      throw new Error(`Expo import source changed during snapshot: ${sourcePath}`);
    }
    const pathFinal = await lstat(candidate, { bigint: true });
    if (!sameIdentity(expected, pathFinal)) {
      throw new Error(`Expo import source changed during snapshot: ${sourcePath}`);
    }
    await assertCanonicalPath(root, candidate, sourcePath);
    return {
      sourcePath,
      role: roleFor(sourcePath) ?? "manifest",
      bytes,
      contentHash: sha256(bytes),
    };
  } finally {
    await handle.close();
  }
}

export async function readStaticSources(
  rootDir: string,
  budgets: ImportBudgets,
): Promise<{
  readonly files: readonly VerifiedStaticSource[];
  readonly sourceFingerprint: ContentHash;
}> {
  assertBudgets(budgets);
  const root = await realpath(resolve(rootDir));
  const roots = ["package.json", ...IMPORT_ROOTS];
  let remainingFiles = budgets.maxFiles;
  let remainingEntries = budgets.maxEntries;
  let discoveredPaths: readonly string[] = [];
  for (const entry of roots) {
    const discovered = await discoverDirectory(
      root,
      join(root, entry),
      remainingFiles,
      remainingEntries,
      0,
      budgets.maxDepth,
    );
    discoveredPaths = [...discoveredPaths, ...discovered.sourcePaths];
    remainingFiles = discovered.remainingFiles;
    remainingEntries = discovered.remainingEntries;
  }
  const discovered = discoveredPaths
    .filter((path) => roleFor(path) !== null)
    .sort();
  const sourcePaths = [...new Set(discovered)];
  if (sourcePaths.length > budgets.maxFiles) {
    throw new Error("Expo import file count budget exceeded.");
  }
  let files: readonly VerifiedStaticSource[] = [];
  let totalBytes = 0;
  for (const sourcePath of sourcePaths) {
    const file = await readVerifiedSource(root, sourcePath, budgets.maxFileBytes);
    totalBytes += file.bytes.byteLength;
    if (totalBytes > budgets.maxTotalBytes) {
      throw new Error("Expo import total byte budget exceeded.");
    }
    files = [...files, file];
  }
  const fingerprintMaterial = files
    .map((file) => `${file.sourcePath}\0${file.contentHash}\n`)
    .join("");
  return {
    files,
    sourceFingerprint: sha256(fingerprintMaterial),
  };
}
