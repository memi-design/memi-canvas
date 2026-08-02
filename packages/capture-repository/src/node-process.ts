import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";

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
const TRUSTED_GIT =
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git";
const TRUSTED_SANDBOX = "/usr/bin/sandbox-exec";

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

function sandboxProfile(managedRoot: string): string {
  const root = escapeSandboxLiteral(managedRoot);
  return [
    "(version 1)",
    "(deny default)",
    "(allow file-read*)",
    `(allow file-write* (subpath "${root}") (literal "/dev/null"))`,
    "(allow mach-lookup)",
    "(allow process-fork)",
    `(allow process-exec (literal "${TRUSTED_GIT}")`,
    '  (subpath "/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core"))',
    "(allow sysctl-read)",
  ].join("\n");
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

  private async validate(request: RepositoryGitRequest): Promise<string> {
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
    const trustedGit = await realpath(TRUSTED_GIT);
    if (trustedGit !== TRUSTED_GIT) {
      throw new RepositoryBoundaryError(
        "git-failed",
        "The trusted system Git executable did not resolve exactly.",
      );
    }
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
    const trustedGit = await this.validate(request);
    throwIfAborted(request.signal);
    const canonicalManagedRoot = await realpath(this.managedRoot);
    return new Promise((resolvePromise, reject) => {
      const child = spawn(
        TRUSTED_SANDBOX,
        [
          "-p",
          sandboxProfile(canonicalManagedRoot),
          trustedGit,
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
