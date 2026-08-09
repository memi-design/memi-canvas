import {
  lstat,
  readlink,
  realpath,
  symlink,
  unlink,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface PreparedManagedDependencyBridge {
  readonly bridgePath: string;
  readonly canonicalDependencyRoot: string;
  readonly created: boolean;
}

function contained(root: string, candidate: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot === "" || (
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Makes a trusted, read-only package tree project-local for Metro without
 * copying dependencies or writing to the source checkout.
 */
export async function prepareManagedDependencyBridge(
  input: Readonly<{
    readonly projectRoot: string;
    readonly dependencyRoot: string;
  }>,
): Promise<PreparedManagedDependencyBridge> {
  const canonicalProjectRoot = await realpath(input.projectRoot);
  const canonicalDependencyRoot = await realpath(input.dependencyRoot);
  if (!(await lstat(canonicalDependencyRoot)).isDirectory()) {
    throw new Error("Managed dependency authority must be a directory.");
  }
  const bridgePath = resolve(canonicalProjectRoot, "node_modules");
  if (!contained(canonicalProjectRoot, bridgePath)) {
    throw new Error("Managed dependency bridge escaped the project root.");
  }

  try {
    const existing = await lstat(bridgePath);
    if (!existing.isDirectory() && !existing.isSymbolicLink()) {
      throw new Error("Managed node_modules path is not a dependency tree.");
    }
    if (await realpath(bridgePath) !== canonicalDependencyRoot) {
      throw new Error("Managed node_modules points to a different dependency tree.");
    }
    return Object.freeze({
      bridgePath,
      canonicalDependencyRoot,
      created: false,
    });
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  await symlink(canonicalDependencyRoot, bridgePath, "dir");
  const created = await lstat(bridgePath);
  if (
    !created.isSymbolicLink() ||
    await readlink(bridgePath) !== canonicalDependencyRoot
  ) {
    throw new Error("Managed dependency bridge could not be verified.");
  }
  return Object.freeze({
    bridgePath,
    canonicalDependencyRoot,
    created: true,
  });
}

/** Removes only the exact symbolic link created by Memi. */
export async function restoreManagedDependencyBridge(
  prepared: PreparedManagedDependencyBridge,
): Promise<void> {
  if (!prepared.created) return;
  try {
    const bridge = await lstat(prepared.bridgePath);
    if (
      !bridge.isSymbolicLink() ||
      await readlink(prepared.bridgePath) !== prepared.canonicalDependencyRoot
    ) {
      throw new Error("Managed dependency bridge changed before cleanup.");
    }
    await unlink(prepared.bridgePath);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}
