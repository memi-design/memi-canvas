import { isAbsolute, parse, resolve } from "node:path";

export interface ImportRuntimeStoragePaths {
  readonly root: string;
  readonly database: string;
  readonly artifacts: string;
  readonly evidence: string;
  readonly worktrees: string;
  readonly jobs: string;
  readonly staging: string;
  readonly simulator: string;
  readonly sharedCache: string;
  readonly nativeDependencyCache: string;
  readonly toolchainCache: string;
  readonly budgetState: string;
  readonly failedRetryCheckpoint: string;
}

export interface ImportRuntimeStoragePathOptions {
  /**
   * Native React Native tooling still shells out through unquoted path
   * interpolation in a few codegen scripts. Managed worktrees therefore use
   * a dedicated, shell-safe transient root instead of inheriting an app-data
   * directory such as `Application Support`.
   */
  readonly managedWorktreeRoot?: string;
}

function resolveManagedWorktreeRoot(value: string): string {
  if (!isAbsolute(value)) {
    throw new Error("Managed worktree root must be absolute.");
  }
  const root = resolve(value);
  if (root === parse(root).root) {
    throw new Error(
      "Managed worktree root cannot be the filesystem root.",
    );
  }
  if (!/^[A-Za-z0-9_./-]+$/u.test(root)) {
    throw new Error(
      "Managed worktree root cannot contain whitespace or shell-special characters.",
    );
  }
  return root;
}

export function importRuntimeStoragePaths(
  appDataRoot: string,
  options: ImportRuntimeStoragePathOptions = {},
): ImportRuntimeStoragePaths {
  if (!isAbsolute(appDataRoot)) {
    throw new Error("Import app-data root must be absolute.");
  }
  const root = resolve(appDataRoot);
  if (root === parse(root).root) {
    throw new Error(
      "Import app-data root cannot be the filesystem root.",
    );
  }
  const worktrees =
    options.managedWorktreeRoot === undefined
      ? resolve(root, "capture-worktrees")
      : resolveManagedWorktreeRoot(options.managedWorktreeRoot);
  return Object.freeze({
    root,
    database: resolve(root, "imports.sqlite"),
    artifacts: resolve(root, "capture-artifacts"),
    evidence: resolve(root, "capture-evidence"),
    worktrees,
    jobs: resolve(root, "import-jobs"),
    staging: resolve(root, "native-app-staging"),
    simulator: resolve(root, "capture-simulator"),
    sharedCache: resolve(root, "shared-cache"),
    nativeDependencyCache: resolve(root, "native-dependency-sandbox"),
    toolchainCache: resolve(root, "toolchains"),
    budgetState: resolve(root, "storage-budget"),
    failedRetryCheckpoint: resolve(
      root,
      "storage-budget",
      "failed-retry-checkpoint-v1.json",
    ),
  });
}
