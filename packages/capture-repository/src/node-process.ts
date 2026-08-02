import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import {
  RepositoryBoundaryError,
  throwIfAborted,
} from "./guards.js";
import { REPOSITORY_GIT_POLICY } from "./git.js";
import type {
  RepositoryGitRequest,
  RepositoryGitResult,
  RepositoryProcessPort,
} from "./types.js";

const MAX_PROCESS_OUTPUT_BYTES = 32 * 1024 * 1024;
const APPLE_SYSTEM_GIT_ENTRYPOINTS = [
  "/Library/Developer/CommandLineTools/usr/bin/git",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
] as const;
const APPLE_SYSTEM_GIT_CANONICAL_PATHS = new Set([
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
  "/Library/Developer/CommandLineTools/usr/bin/git",
]);
const VERSIONED_XCODE_GIT =
  /^\/Applications\/Xcode_[0-9]+(?:\.[0-9]+)*(?:_[A-Za-z0-9.-]+)?\.app\/Contents\/Developer\/usr\/bin\/git$/;
const APPLE_SYSTEM_GIT_CORE_PATHS = new Set([
  "/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core",
  "/Library/Developer/CommandLineTools/usr/libexec/git-core",
]);
const VERSIONED_XCODE_GIT_CORE =
  /^\/Applications\/Xcode_[0-9]+(?:\.[0-9]+)*(?:_[A-Za-z0-9.-]+)?\.app\/Contents\/Developer\/usr\/libexec\/git-core$/;
const TRUSTED_SANDBOX = "/usr/bin/sandbox-exec";
/**
 * The dynamic loader and Apple trust databases are immutable system inputs for
 * a direct Apple Git process. Keep this list deliberately small: repository
 * files are granted separately per request, and no user home or broad /Library
 * path is readable inside the sandbox.
 */
const IMMUTABLE_APPLE_SYSTEM_READ_PATHS = [
  "/System/Library",
  "/usr/lib",
  "/private/var/db",
] as const;

function samePolicy(request: RepositoryGitRequest): boolean {
  return (
    JSON.stringify(request.policy) === JSON.stringify(REPOSITORY_GIT_POLICY)
  );
}

function isReadOnlyGit(args: readonly string[]): boolean {
  const serialized = JSON.stringify(args);
  return [
    ["rev-parse", "--show-toplevel"],
    ["rev-parse", "HEAD"],
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    [
      "diff",
      "--name-status",
      "-z",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "HEAD",
      "--",
    ],
    [
      "diff",
      "--name-status",
      "-z",
      "--cached",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "HEAD",
      "--",
    ],
  ].some((allowed) => JSON.stringify(allowed) === serialized);
}

function escapeSandboxLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function createRepositoryGitSandboxProfile({
  authority,
  managedRoot,
  sourceRoot,
}: {
  readonly authority: AppleSystemGitAuthority;
  readonly managedRoot: string;
  readonly sourceRoot: string;
}): string {
  const root = escapeSandboxLiteral(managedRoot);
  const source = escapeSandboxLiteral(sourceRoot);
  return [
    "(version 1)",
    "(deny default)",
    `(allow file-read* (subpath "${source}"))`,
    `(allow file-read* (subpath "${root}"))`,
    `(allow file-read* (literal "${authority.executable}"))`,
    `(allow file-read* (subpath "${authority.gitCorePath}"))`,
    ...IMMUTABLE_APPLE_SYSTEM_READ_PATHS.map(
      (path) => `(allow file-read* (subpath "${path}"))`,
    ),
    // sandbox-exec requires the filesystem root itself during process startup;
    // this grants no descendant host paths.
    '(allow file-read* (literal "/"))',
    '(allow file-read* (literal "/dev/null"))',
    `(allow file-write* (subpath "${root}") (literal "/dev/null"))`,
    "(allow mach-lookup)",
    "(allow process-fork)",
    `(allow process-exec (literal "${authority.executable}"))`,
    `(allow process-exec (subpath "${authority.gitCorePath}"))`,
    "(allow sysctl-read)",
  ].join("\n");
}

type Realpath = (path: string) => Promise<string>;

export interface AppleSystemGitAuthority {
  readonly executable: string;
  readonly gitCorePath: string;
}

function isApprovedAppleSystemGit(path: string): boolean {
  return (
    APPLE_SYSTEM_GIT_CANONICAL_PATHS.has(path) ||
    VERSIONED_XCODE_GIT.test(path)
  );
}

function isApprovedAppleSystemGitCore(path: string): boolean {
  return (
    APPLE_SYSTEM_GIT_CORE_PATHS.has(path) ||
    VERSIONED_XCODE_GIT_CORE.test(path)
  );
}

/**
 * Resolves only the fixed direct Git binaries shipped by Apple's Command Line
 * Tools or Xcode. The xcode-select shim and shell PATH are never consulted.
 */
export async function resolveTrustedAppleGit(
  resolvePath: Realpath = realpath,
): Promise<string> {
  for (const entrypoint of APPLE_SYSTEM_GIT_ENTRYPOINTS) {
    try {
      const canonicalPath = await resolvePath(entrypoint);
      if (isApprovedAppleSystemGit(canonicalPath)) {
        return canonicalPath;
      }
    } catch {
      // An absent Xcode installation may still have the Command Line Tools.
    }
  }
  throw new RepositoryBoundaryError(
    "git-failed",
    "No approved Apple system Git executable is available.",
  );
}

export async function resolveTrustedAppleGitAuthority({
  resolve = realpath,
}: {
  readonly resolve?: Realpath;
} = {}): Promise<AppleSystemGitAuthority> {
  const executable = await resolveTrustedAppleGit(resolve);
  const gitCorePath = await resolve(
    join(dirname(dirname(executable)), "libexec", "git-core"),
  );
  if (!isApprovedAppleSystemGitCore(gitCorePath)) {
    throw new RepositoryBoundaryError(
      "git-failed",
      "The direct Apple system Git executable resolved an unapproved git-core directory.",
    );
  }
  return { executable, gitCorePath };
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The verified close event may have won the race.
    }
  }
}

export class NodeRepositoryProcess implements RepositoryProcessPort {
  constructor(private readonly managedRoot: string) {}

  private async validate(
    request: RepositoryGitRequest,
  ): Promise<AppleSystemGitAuthority> {
    if (
      process.platform !== "darwin" ||
      request.executable !== "git" ||
      !samePolicy(request) ||
      !isAbsolute(request.cwd) ||
      request.args.some((argument) => argument.includes("\0"))
    ) {
      throw new RepositoryBoundaryError(
        "git-failed",
        "Git request violated the repository process policy.",
      );
    }
    const trustedGit = await resolveTrustedAppleGitAuthority();
    if (
      request.access === "source-read-only" &&
      isReadOnlyGit(request.args)
    ) {
      return trustedGit;
    }
    throw new RepositoryBoundaryError(
      "git-failed",
      "Git request is not in the capture allowlist.",
    );
  }

  async runGit(request: RepositoryGitRequest): Promise<RepositoryGitResult> {
    const authority = await this.validate(request);
    throwIfAborted(request.signal);
    const canonicalManagedRoot = await realpath(this.managedRoot);
    let canonicalSourceRoot: string;
    try {
      canonicalSourceRoot = await realpath(request.cwd);
    } catch {
      throw new RepositoryBoundaryError(
        "git-failed",
        "Git request working directory could not be resolved.",
      );
    }
    return new Promise((resolvePromise, reject) => {
      const child = spawn(
        TRUSTED_SANDBOX,
        [
          "-p",
          createRepositoryGitSandboxProfile({
            authority,
            managedRoot: canonicalManagedRoot,
            sourceRoot: canonicalSourceRoot,
          }),
          authority.executable,
          ...request.args,
        ],
        {
          cwd: request.cwd,
          detached: true,
          env: {
            GIT_ATTR_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_OPTIONAL_LOCKS: "0",
            GIT_TERMINAL_PROMPT: "0",
            HOME: canonicalManagedRoot,
            LC_ALL: "C",
            TMPDIR: canonicalManagedRoot,
          },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      let outputBytes = 0;
      let terminalError: unknown;
      let killTimer: ReturnType<typeof setTimeout> | undefined;

      const stop = (error: unknown) => {
        if (terminalError !== undefined || child.pid === undefined) return;
        terminalError = error;
        killGroup(child.pid, "SIGTERM");
        killTimer = setTimeout(() => {
          if (child.pid !== undefined) killGroup(child.pid, "SIGKILL");
        }, 1_000);
      };
      const onAbort = () =>
        stop(
          request.signal.reason ??
            new DOMException("Operation cancelled.", "AbortError"),
        );
      const append = (current: Uint8Array[], chunk: Buffer): void => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
          stop(
            new RepositoryBoundaryError(
              "git-failed",
              "Git output exceeded the repository safety budget.",
            ),
          );
          return;
        }
        current.push(Uint8Array.from(chunk));
      };

      request.signal.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
      child.once("error", (error) => {
        terminalError = error;
      });
      child.once("close", (exitCode) => {
        if (killTimer !== undefined) clearTimeout(killTimer);
        request.signal.removeEventListener("abort", onAbort);
        if (terminalError !== undefined) {
          reject(terminalError);
          return;
        }
        resolvePromise({
          exitCode: exitCode ?? -1,
          stderr: Buffer.concat(stderr).toString("utf8"),
          stdout: Buffer.concat(stdout).toString("utf8"),
        });
      });
    });
  }
}
