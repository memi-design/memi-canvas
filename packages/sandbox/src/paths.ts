import { lstat, realpath, stat } from "node:fs/promises";
import {
  isAbsolute,
  join,
  parse,
  relative,
  sep,
} from "node:path";

export interface CanonicalSandboxPaths {
  readonly executable: string;
  readonly cwd: string;
  readonly sourceRoots: readonly string[];
  readonly worktreeRoot: string;
  readonly tempRoot: string;
}

export class SandboxPathError extends Error {
  readonly reason:
    | "symlink-root-prohibited"
    | "executable-symlink-prohibited"
    | "invalid-root"
    | "overlapping-roots"
    | "cwd-outside-writable-roots";

  constructor(
    reason: SandboxPathError["reason"],
    message: string,
  ) {
    super(message);
    this.name = "SandboxPathError";
    this.reason = reason;
  }
}

async function canonicalRegularFile(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new SandboxPathError(
      "invalid-root",
      `Executable path must be absolute: ${path}`,
    );
  }

  await assertNoSymlinkComponents(
    path,
    "executable-symlink-prohibited",
  );

  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (!metadata.isFile()) {
    throw new SandboxPathError(
      "invalid-root",
      `Executable is not a regular file: ${path}`,
    );
  }
  return canonical;
}

export async function canonicalDirectoryRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new SandboxPathError(
      "invalid-root",
      `Sandbox root must be absolute: ${path}`,
    );
  }

  await assertNoSymlinkComponents(path, "symlink-root-prohibited");

  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) {
    throw new SandboxPathError(
      "invalid-root",
      `Sandbox root is not a directory: ${path}`,
    );
  }
  return canonical;
}

async function assertNoSymlinkComponents(
  path: string,
  reason:
    | "symlink-root-prohibited"
    | "executable-symlink-prohibited",
): Promise<void> {
  const root = parse(path).root;
  let current = root;
  for (const segment of path
    .slice(root.length)
    .split(sep)
    .filter(Boolean)) {
    current = join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new SandboxPathError(
        reason,
        `Sandbox paths cannot contain symlinks: ${current}`,
      );
    }
  }
}

export function isPathWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  );
}

function rootsOverlap(left: string, right: string): boolean {
  return isPathWithin(left, right) || isPathWithin(right, left);
}

function assertDisjointRoots(
  sourceRoots: readonly string[],
  worktreeRoot: string,
  tempRoot: string,
): void {
  const writableRoots = [worktreeRoot, tempRoot];
  if (rootsOverlap(worktreeRoot, tempRoot)) {
    throw new SandboxPathError(
      "overlapping-roots",
      "Worktree and temp roots must be disjoint.",
    );
  }

  for (const sourceRoot of sourceRoots) {
    if (writableRoots.some((root) => rootsOverlap(sourceRoot, root))) {
      throw new SandboxPathError(
        "overlapping-roots",
        `Read-only source root overlaps a writable root: ${sourceRoot}`,
      );
    }
  }
}

export async function canonicalizeSandboxPaths(input: {
  readonly executable: string;
  readonly cwd: string;
  readonly sourceRoots: readonly string[];
  readonly worktreeRoot: string;
  readonly tempRoot: string;
}): Promise<CanonicalSandboxPaths> {
  const [executable, cwd, worktreeRoot, tempRoot, ...sourceRoots] =
    await Promise.all([
      canonicalRegularFile(input.executable),
      canonicalDirectoryRoot(input.cwd),
      canonicalDirectoryRoot(input.worktreeRoot),
      canonicalDirectoryRoot(input.tempRoot),
      ...input.sourceRoots.map(canonicalDirectoryRoot),
    ]);

  assertDisjointRoots(sourceRoots, worktreeRoot, tempRoot);

  if (
    !isPathWithin(worktreeRoot, cwd) &&
    !isPathWithin(tempRoot, cwd)
  ) {
    throw new SandboxPathError(
      "cwd-outside-writable-roots",
      `Working directory must be within a writable root: ${cwd}`,
    );
  }

  return {
    executable,
    cwd,
    sourceRoots: Object.freeze([...sourceRoots]),
    worktreeRoot,
    tempRoot,
  };
}

export async function canonicalizeExecutable(
  executable: string,
): Promise<string> {
  return canonicalRegularFile(executable);
}
