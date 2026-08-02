import type {
  RepositoryManifestEntry,
  RepositoryManifestInput,
} from "./types.js";
import { stableHash } from "./shared.js";

const HARD_MAX_ENTRIES = 4_096;
const HARD_MAX_FILE_BYTES = 4 * 1024 * 1024;
const HARD_MAX_TOTAL_BYTES = 32 * 1024 * 1024;

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function validatePath(path: string, maxDepth: number): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(path)
  ) {
    throw new Error(`Manifest entry must use a contained relative path: ${path}`);
  }
  const segments = path.split("/");
  if (
    segments.length > maxDepth ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Manifest entry must use a contained relative path: ${path}`);
  }
}

export function validateRepositoryManifest(
  input: RepositoryManifestInput,
): {
  readonly entries: readonly RepositoryManifestEntry[];
  readonly repositoryFingerprint: `sha256:${string}`;
} {
  if (input.schemaVersion !== 1) {
    throw new Error("Unsupported repository manifest schema version.");
  }
  const { budgets } = input;
  assertPositiveSafeInteger(budgets.maxEntries, "Manifest entry budget");
  assertPositiveSafeInteger(budgets.maxFileBytes, "Manifest file byte budget");
  assertPositiveSafeInteger(budgets.maxTotalBytes, "Manifest total byte budget");
  assertPositiveSafeInteger(budgets.maxDepth, "Manifest path depth budget");
  if (
    budgets.maxEntries > HARD_MAX_ENTRIES ||
    budgets.maxFileBytes > HARD_MAX_FILE_BYTES ||
    budgets.maxTotalBytes > HARD_MAX_TOTAL_BYTES
  ) {
    throw new Error("Repository manifest exceeds the hard safety budget.");
  }
  if (input.entries.length > budgets.maxEntries) {
    throw new Error("Repository manifest entry budget exceeded.");
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  const entries = [...input.entries]
    .map((entry) => {
      validatePath(entry.path, budgets.maxDepth);
      if (seen.has(entry.path)) {
        throw new Error(`Duplicate repository manifest path: ${entry.path}`);
      }
      seen.add(entry.path);
      const bytes = Buffer.byteLength(entry.content, "utf8");
      if (bytes > budgets.maxFileBytes) {
        throw new Error(`Repository manifest file byte budget exceeded: ${entry.path}`);
      }
      totalBytes += bytes;
      return { path: entry.path, content: entry.content };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  if (totalBytes > budgets.maxTotalBytes) {
    throw new Error("Repository manifest total byte budget exceeded.");
  }

  return {
    entries,
    repositoryFingerprint: stableHash({
      revision: input.repository.revision,
      dirtyFileFingerprint: input.repository.dirtyFileFingerprint,
      entries,
    }),
  };
}
