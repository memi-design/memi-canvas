import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

import type { ContentHash } from "@memi/capture-platforms";

import type { RepositoryBoundaryErrorCode } from "./types.js";

export class RepositoryBoundaryError extends Error {
  readonly code: RepositoryBoundaryErrorCode;

  constructor(
    code: RepositoryBoundaryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryBoundaryError";
    this.code = code;
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Operation cancelled.", "AbortError");
  }
}

export function assertAbsoluteNonRoot(
  path: string,
  code: "invalid-managed-root" | "invalid-source-root",
  label: string,
): string {
  if (
    !isAbsolute(path) ||
    resolve(path) !== path ||
    path === "/" ||
    path.includes("\0")
  ) {
    throw new RepositoryBoundaryError(
      code,
      `${label} must be an absolute, normalized, non-root path.`,
    );
  }
  return path;
}

export function isContained(rootPath: string, candidatePath: string): boolean {
  const child = relative(rootPath, candidatePath);
  return (
    child.length > 0 &&
    child !== ".." &&
    !child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(child)
  );
}

export function rootsOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    isContained(left, right) ||
    isContained(right, left)
  );
}

export function assertContained(
  rootPath: string,
  candidatePath: string,
  relativePath: string,
): string {
  if (!isContained(rootPath, candidatePath)) {
    throw new RepositoryBoundaryError(
      "path-escape",
      `Repository entry escaped its source root: ${relativePath}`,
    );
  }
  return candidatePath;
}

export function validateRelativePath(path: string): string {
  const segments = path.split("/");
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new RepositoryBoundaryError(
      "path-escape",
      `Repository entry is not a contained relative path: ${path}`,
    );
  }
  return path;
}

export function sha256(value: string | Uint8Array): ContentHash {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function stableHash(value: unknown): ContentHash {
  return sha256(JSON.stringify(value));
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

export function assertRevision(value: string): string {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value)) {
    throw new RepositoryBoundaryError(
      "git-failed",
      "Git returned an invalid repository revision.",
    );
  }
  return value;
}

export function assertCaptureId(value: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(value)) {
    throw new RepositoryBoundaryError(
      "invalid-capture-id",
      "Capture id must be a bounded lowercase identifier.",
    );
  }
  return value;
}
