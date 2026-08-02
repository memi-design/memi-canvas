import { createHash } from "node:crypto";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import type {
  SourceContentHash,
  SourceRepositoryState,
  SourceWorktreeFailurePhase,
  SourceWorktreeFailureRecovery,
} from "./source-worktree.types.js";

export const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const REVISION_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
export const MAX_CHANGED_FILES = 128;
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_TOTAL_BYTES = 8_000_000;
export const MAX_COMMIT_MESSAGE_LENGTH = 240;
const BLOCKED_SEGMENTS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
]);

export class SourceWorktreeOperationError extends Error {
  readonly code = "SOURCE_WORKTREE_OPERATION_FAILED";
  readonly recovery: SourceWorktreeFailureRecovery;

  constructor(
    message: string,
    recovery: SourceWorktreeFailureRecovery,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SourceWorktreeOperationError";
    this.recovery = deepFreeze(structuredClone(recovery));
  }
}

export function deepFreeze<T>(value: T): T {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export function frozenClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export function hashSourceBytes(
  value: Uint8Array,
): SourceContentHash {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function hashSourceText(
  value: string,
): Promise<SourceContentHash> {
  return hashSourceBytes(new TextEncoder().encode(value));
}

export function hashStableValue(value: unknown): SourceContentHash {
  const stable = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) {
      return candidate.map(stable);
    }
    if (candidate !== null && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, stable(nested)]),
      );
    }
    return candidate;
  };
  return hashSourceBytes(
    new TextEncoder().encode(JSON.stringify(stable(value))),
  );
}

export function assertIdentifier(value: string, label: string): string {
  if (!IDENTIFIER_PATTERN.test(value) || value === "." || value === "..") {
    throw new Error(`${label} must be a safe local identifier.`);
  }
  return value;
}

export function assertRevision(value: string, label: string): string {
  if (!REVISION_PATTERN.test(value)) {
    throw new Error(`${label} must be an exact Git object id.`);
  }
  return value;
}

export function validateRelativeSourcePath(value: string): string {
  if (
    value.length === 0 ||
    value.length > 1_024 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error(
      "Source path must remain inside the managed source workspace.",
    );
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        BLOCKED_SEGMENTS.has(segment) ||
        segment === ".env" ||
        segment.startsWith(".env."),
    )
  ) {
    throw new Error(
      "Source path must remain inside the managed source workspace.",
    );
  }
  return value;
}

export function assertBoundedSourceText(
  value: string,
  relativePath: string,
): void {
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (value.includes("\u0000") || byteLength > MAX_FILE_BYTES) {
    throw new Error(
      `${relativePath} must contain valid bounded UTF-8 source text.`,
    );
  }
}

export function assertAbsoluteRoot(value: string, label: string): string {
  if (!isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return resolve(value);
}

export function isPathContained(
  rootPath: string,
  childPath: string,
): boolean {
  const pathFromRoot = relative(rootPath, childPath);
  return (
    pathFromRoot.length > 0 &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

export function rootsOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    isPathContained(left, right) ||
    isPathContained(right, left)
  );
}

export function stateMatches(
  current: SourceRepositoryState,
  expected: SourceRepositoryState,
): boolean {
  return (
    current.rootPath === expected.rootPath &&
    current.headRevision === expected.headRevision &&
    current.dirty === expected.dirty &&
    current.dirtyFingerprint === expected.dirtyFingerprint
  );
}

export function stateAuthorityValue(
  state: SourceRepositoryState,
): Omit<SourceRepositoryState, "capturedAt"> {
  return {
    dirty: state.dirty,
    dirtyFingerprint: state.dirtyFingerprint,
    headRevision: state.headRevision,
    rootPath: state.rootPath,
  };
}

export function parseNulPaths(value: string): readonly string[] {
  const paths = value.split("\u0000").filter((path) => path.length > 0);
  paths.forEach(validateRelativeSourcePath);
  if (new Set(paths).size !== paths.length) {
    throw new Error("Git returned duplicate changed source paths.");
  }
  return paths;
}

export function parseUntrackedPaths(status: string): readonly string[] {
  return status
    .split("\u0000")
    .filter((entry) => entry.startsWith("?? "))
    .map((entry) => validateRelativeSourcePath(entry.slice(3)))
    .sort();
}

export function parseTrackedStatusPaths(
  status: string,
): readonly string[] {
  const entries = status
    .split("\u0000")
    .filter((entry) => entry.length > 0);
  if (
    entries.some(
      (entry) =>
        entry.startsWith("?? ") ||
        entry.startsWith("!! ") ||
        entry.startsWith("R") ||
        entry.startsWith("C"),
    )
  ) {
    throw new Error(
      "Run review currently accepts existing tracked text files only.",
    );
  }
  return entries.map((entry) =>
    validateRelativeSourcePath(entry.slice(3)),
  );
}

export function recoveryFor(
  phase: SourceWorktreeFailurePhase,
  rootPath: string,
  changedPaths: readonly string[],
  context: {
    readonly approvalId?: string;
    readonly reviewDigest?: SourceContentHash;
    readonly runId?: string;
  } = {},
): SourceWorktreeFailureRecovery {
  return {
    approvalId: context.approvalId ?? null,
    changedPaths: [...changedPaths],
    originalProtected: true,
    phase,
    reviewDigest: context.reviewDigest ?? null,
    rootPath,
    runId: context.runId ?? null,
  };
}
