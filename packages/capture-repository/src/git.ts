import {
  assertRevision,
  RepositoryBoundaryError,
  stableHash,
  throwIfAborted,
} from "./guards.js";
import type {
  RepositoryCaptureSource,
  RepositoryGitRequest,
  RepositoryGitResult,
  RepositoryProcessPort,
} from "./types.js";

export const REPOSITORY_GIT_POLICY = Object.freeze({
  allowExternalFilters: false,
  allowHooks: false,
  allowNetwork: false,
  allowShell: false,
  allowSubmodules: false,
  optionalLocks: false,
} as const);

const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;

async function runGit(
  processPort: RepositoryProcessPort,
  request: Omit<RepositoryGitRequest, "executable" | "policy">,
): Promise<RepositoryGitResult> {
  throwIfAborted(request.signal);
  const result = await processPort.runGit({
    ...request,
    executable: "git",
    policy: REPOSITORY_GIT_POLICY,
  });
  throwIfAborted(request.signal);
  const outputBytes =
    Buffer.byteLength(result.stdout, "utf8") +
    Buffer.byteLength(result.stderr, "utf8");
  if (
    !Number.isSafeInteger(result.exitCode) ||
    result.exitCode !== 0 ||
    outputBytes > MAX_GIT_OUTPUT_BYTES
  ) {
    throw new RepositoryBoundaryError(
      "git-failed",
      "The repository Git operation failed its read-only safety contract.",
    );
  }
  return result;
}

export interface RepositoryGitSnapshot {
  readonly cachedDiff: string;
  readonly headRevision: string;
  readonly status: string;
  readonly worktreeDiff: string;
}

export async function captureGitSnapshot(input: {
  readonly process: RepositoryProcessPort;
  readonly rootPath: string;
  readonly signal: AbortSignal;
}): Promise<RepositoryGitSnapshot> {
  const request = (args: readonly string[]) =>
    runGit(input.process, {
      access: "source-read-only",
      args,
      cwd: input.rootPath,
      signal: input.signal,
    });
  const reportedRoot = (
    await request(["rev-parse", "--show-toplevel"])
  ).stdout.trim();
  if (reportedRoot !== input.rootPath) {
    throw new RepositoryBoundaryError(
      "repository-root-mismatch",
      "The selected folder must be the canonical Git repository root.",
    );
  }
  const headRevision = assertRevision(
    (await request(["rev-parse", "HEAD"])).stdout.trim(),
  );
  const status = (
    await request([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ])
  ).stdout;
  const worktreeDiff = (
    await request([
      "diff",
      "--name-status",
      "-z",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "HEAD",
      "--",
    ])
  ).stdout;
  const cachedDiff = (
    await request([
      "diff",
      "--name-status",
      "-z",
      "--cached",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "HEAD",
      "--",
    ])
  ).stdout;
  return { cachedDiff, headRevision, status, worktreeDiff };
}

export function sourceFromSnapshot(input: {
  readonly inventoryFingerprint: string;
  readonly rootPath: string;
  readonly snapshot: RepositoryGitSnapshot;
}): RepositoryCaptureSource {
  const { cachedDiff, headRevision, status, worktreeDiff } = input.snapshot;
  return {
    dirty:
      status.length > 0 ||
      worktreeDiff.length > 0 ||
      cachedDiff.length > 0,
    dirtyFingerprint: stableHash({
      cachedDiff,
      headRevision,
      inventoryFingerprint: input.inventoryFingerprint,
      status,
      worktreeDiff,
    }),
    headRevision,
    rootPath: input.rootPath,
  };
}

export async function createManagedRepositorySnapshot(input: {
  readonly fileSystem: import("./types.js").RepositoryFileSystemPort;
  readonly signal: AbortSignal;
  readonly sourceRoot: string;
  readonly targetRoot: string;
}): Promise<import("./types.js").RepositoryTreeFingerprint> {
  const fingerprint = await input.fileSystem.createManagedSnapshot({
    signal: input.signal,
    sourceRoot: input.sourceRoot,
    targetRoot: input.targetRoot,
  });
  await input.fileSystem.assertManagedTreeSafe({
    rootPath: input.targetRoot,
    signal: input.signal,
  });
  throwIfAborted(input.signal);
  return fingerprint;
}
