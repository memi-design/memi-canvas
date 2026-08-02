import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { basename } from "node:path";

import {
  canonicalizeExecutable,
  canonicalDirectoryRoot,
  canonicalizeSandboxPaths,
  isPathWithin,
  SandboxPathError,
} from "./paths";
import { createBoundedOutputCollector, emptySandboxOutput } from "./output";
import { buildMacOSSandboxProfile } from "./profile";
import type {
  MacOSSandboxExecProviderOptions,
  SandboxAvailability,
  SandboxCleanupEvidence,
  SandboxOutput,
  SandboxProvider,
  SandboxProviderEvidence,
  SandboxRunReason,
  SandboxRunRequest,
  SandboxRunResult,
  SandboxRunStatus,
} from "./types";

const DEFAULT_SANDBOX_EXECUTABLE = "/usr/bin/sandbox-exec";
const DEFAULT_TERMINATION_GRACE_MS = 100;
const CANARY_TIMEOUT_MS = 1_000;
const CANARY_EXECUTABLE = "/usr/bin/true";
const CANARY_ALLOW_PROFILE = "(version 1)(allow default)";
const CANARY_DENY_PROFILE = "(version 1)(deny default)";
const MAX_ARGUMENT_COUNT = 256;
const MAX_ARGUMENT_BYTES = 16_384;
const MAX_ARGUMENT_BYTES_TOTAL = 131_072;
const MAX_ENVIRONMENT_ENTRIES = 128;
const MAX_ENVIRONMENT_VALUE_BYTES = 32_768;
const MAX_ENVIRONMENT_BYTES_TOTAL = 131_072;
const MAX_TIMEOUT_MS = 86_400_000;
const MAX_OUTPUT_BYTES = 67_108_864;
const PROHIBITED_SHELL_NAMES = new Set([
  "bash",
  "csh",
  "dash",
  "fish",
  "ksh",
  "powershell",
  "pwsh",
  "sh",
  "tcsh",
  "zsh",
]);

interface TerminationState {
  status: Extract<
    SandboxRunStatus,
    "timed-out" | "output-limit-exceeded" | "failed"
  >;
  reason: Extract<
    SandboxRunReason,
    | "timeout"
    | "aborted"
    | "stdout-limit-exceeded"
    | "stderr-limit-exceeded"
  >;
}

function frozenOptions(
  options: MacOSSandboxExecProviderOptions,
): Required<
  Pick<
    MacOSSandboxExecProviderOptions,
    | "platform"
    | "sandboxExecutable"
    | "terminationGraceMs"
    | "feasibilityMode"
  >
> &
  Pick<
    MacOSSandboxExecProviderOptions,
    | "allowedExecutables"
    | "allowedEnvironmentKeys"
    | "authorizedSourceRoots"
    | "authorizedWorktreeRoots"
    | "authorizedTempRoots"
  > {
  return Object.freeze({
    allowedExecutables: Object.freeze([...options.allowedExecutables]),
    allowedEnvironmentKeys: Object.freeze([
      ...options.allowedEnvironmentKeys,
    ]),
    authorizedSourceRoots: Object.freeze([
      ...options.authorizedSourceRoots,
    ]),
    authorizedWorktreeRoots: Object.freeze([
      ...options.authorizedWorktreeRoots,
    ]),
    authorizedTempRoots: Object.freeze([
      ...options.authorizedTempRoots,
    ]),
    platform: options.platform ?? process.platform,
    sandboxExecutable:
      options.sandboxExecutable ?? DEFAULT_SANDBOX_EXECUTABLE,
    terminationGraceMs:
      options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
    feasibilityMode: options.feasibilityMode ?? false,
  });
}

const NOT_STARTED_CLEANUP: SandboxCleanupEvidence = Object.freeze({
  verified: true,
  scope: "not-started",
  remainingDescendants: "none",
});

const UNVERIFIED_PROCESS_GROUP_CLEANUP: SandboxCleanupEvidence =
  Object.freeze({
    verified: false,
    scope: "process-group-only",
    remainingDescendants: "unknown",
  });

function result(input: {
  readonly status: SandboxRunStatus;
  readonly reason: SandboxRunReason;
  readonly enforced: boolean;
  readonly startedAt: number;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly stdout?: SandboxOutput;
  readonly stderr?: SandboxOutput;
  readonly providerEvidence?: SandboxProviderEvidence | null;
  readonly cleanupEvidence?: SandboxCleanupEvidence;
}): SandboxRunResult {
  return Object.freeze({
    providerId: "macos-sandbox-exec",
    status: input.status,
    reason: input.reason,
    enforced: input.enforced,
    providerEvidence: input.providerEvidence ?? null,
    cleanupEvidence: input.cleanupEvidence ?? NOT_STARTED_CLEANUP,
    exitCode: input.exitCode ?? null,
    signal: input.signal ?? null,
    durationMs: Math.max(0, Date.now() - input.startedAt),
    stdout: input.stdout ?? emptySandboxOutput(),
    stderr: input.stderr ?? emptySandboxOutput(),
  });
}

function invalidBounds(request: SandboxRunRequest): boolean {
  return (
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs <= 0 ||
    request.timeoutMs > MAX_TIMEOUT_MS ||
    !Number.isSafeInteger(request.maxStdoutBytes) ||
    request.maxStdoutBytes <= 0 ||
    request.maxStdoutBytes > MAX_OUTPUT_BYTES ||
    !Number.isSafeInteger(request.maxStderrBytes) ||
    request.maxStderrBytes <= 0 ||
    request.maxStderrBytes > MAX_OUTPUT_BYTES
  );
}

function requestTooLarge(request: SandboxRunRequest): boolean {
  if (request.args.length > MAX_ARGUMENT_COUNT) {
    return true;
  }

  let argumentBytes = 0;
  for (const argument of request.args) {
    const bytes = Buffer.byteLength(argument);
    argumentBytes += bytes;
    if (
      bytes > MAX_ARGUMENT_BYTES ||
      argument.includes("\0") ||
      argumentBytes > MAX_ARGUMENT_BYTES_TOTAL
    ) {
      return true;
    }
  }

  const environmentEntries = Object.entries(request.environment);
  if (environmentEntries.length > MAX_ENVIRONMENT_ENTRIES) {
    return true;
  }

  let environmentBytes = 0;
  for (const [key, value] of environmentEntries) {
    const valueBytes = Buffer.byteLength(value);
    environmentBytes += Buffer.byteLength(key) + valueBytes;
    if (
      valueBytes > MAX_ENVIRONMENT_VALUE_BYTES ||
      value.includes("\0") ||
      environmentBytes > MAX_ENVIRONMENT_BYTES_TOTAL
    ) {
      return true;
    }
  }

  return false;
}

function providerEvidence(profile: string): SandboxProviderEvidence {
  return Object.freeze({
    provider: "macos-sandbox-exec",
    platform: "darwin",
    enforcement: "enforced",
    policyHash: `sha256:${createHash("sha256").update(profile).digest("hex")}`,
  });
}

function canaryExitCode(
  sandboxExecutable: string,
  profile: string,
): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(
      sandboxExecutable,
      ["-p", profile, CANARY_EXECUTABLE],
      {
        env: {},
        shell: false,
        stdio: "ignore",
      },
    );
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(exitCode);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, CANARY_TIMEOUT_MS);
    child.once("error", () => finish(null));
    child.once("close", (exitCode) => finish(exitCode));
  });
}

async function passesEnforcementCanary(
  sandboxExecutable: string,
): Promise<boolean> {
  const allowExit = await canaryExitCode(
    sandboxExecutable,
    CANARY_ALLOW_PROFILE,
  );
  if (allowExit !== 0) {
    return false;
  }
  const denyExit = await canaryExitCode(
    sandboxExecutable,
    CANARY_DENY_PROFILE,
  );
  return denyExit !== null && denyExit !== 0;
}

function minimalEnvironment(
  request: SandboxRunRequest,
  allowedKeys: ReadonlySet<string>,
  canonicalTempRoot: string,
): Readonly<Record<string, string>> | null {
  const requestedKeys = Object.keys(request.environment);
  if (requestedKeys.some((key) => !allowedKeys.has(key))) {
    return null;
  }

  return Object.freeze({
    ...request.environment,
    TMPDIR: canonicalTempRoot,
    MEMI_SANDBOX: "1",
  });
}

function signalProcessGroup(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) {
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ESRCH"
    ) {
      child.kill(signal);
    }
  }
}

function processClose(
  child: ChildProcess,
): Promise<{
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly spawnError: Error | null;
}> {
  return new Promise((resolve) => {
    let spawnError: Error | null = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (exitCode, signal) => {
      resolve({ exitCode, signal, spawnError });
    });
  });
}

export class MacOSSandboxExecProvider implements SandboxProvider {
  readonly #options: ReturnType<typeof frozenOptions>;
  #availabilityProbe: Promise<SandboxAvailability> | null = null;

  constructor(options: MacOSSandboxExecProviderOptions) {
    this.#options = frozenOptions(options);
  }

  async availability(): Promise<SandboxAvailability> {
    this.#availabilityProbe ??= this.#probeAvailability();
    return this.#availabilityProbe;
  }

  async #probeAvailability(): Promise<SandboxAvailability> {
    if (this.#options.platform !== "darwin") {
      return Object.freeze({
        providerId: "macos-sandbox-exec",
        platform: this.#options.platform,
        available: false,
        enforced: false,
        ready: false,
        networkMode: "deny",
        limitations: Object.freeze([
          "The M0 provider supports only macOS.",
          "No unenforced child-process fallback is permitted.",
        ]),
      });
    }

    try {
      await access(this.#options.sandboxExecutable, constants.X_OK);
      if (
        !(await passesEnforcementCanary(
          this.#options.sandboxExecutable,
        ))
      ) {
        return Object.freeze({
          providerId: "macos-sandbox-exec",
          platform: this.#options.platform,
          available: false,
          enforced: false,
          ready: false,
          networkMode: "deny",
          limitations: Object.freeze([
            "The configured provider failed its live allow/deny canary.",
            "No unenforced child-process fallback is permitted.",
          ]),
        });
      }
      return Object.freeze({
        providerId: "macos-sandbox-exec",
        platform: this.#options.platform,
        available: true,
        enforced: false,
        ready: false,
        networkMode: "deny",
        limitations: Object.freeze([
          "sandbox-exec is deprecated by Apple.",
          "Detached descendants can escape process-group cleanup.",
          "This provider is M0 feasibility evidence and is not execution-ready.",
        ]),
      });
    } catch {
      return Object.freeze({
        providerId: "macos-sandbox-exec",
        platform: this.#options.platform,
        available: false,
        enforced: false,
        ready: false,
        networkMode: "deny",
        limitations: Object.freeze([
          "sandbox-exec is unavailable on this host.",
          "No unenforced child-process fallback is permitted.",
        ]),
      });
    }
  }

  async run(request: SandboxRunRequest): Promise<SandboxRunResult> {
    const startedAt = Date.now();
    const availability = await this.availability();
    if (!availability.available) {
      return result({
        status: "provider-unavailable",
        reason:
          this.#options.platform === "darwin"
            ? "provider-missing"
            : "unsupported-platform",
        enforced: false,
        startedAt,
      });
    }

    if (!this.#options.feasibilityMode) {
      return result({
        status: "provider-unavailable",
        reason: "security-gate-failed",
        enforced: false,
        startedAt,
      });
    }

    if (invalidBounds(request)) {
      return result({
        status: "denied",
        reason: "invalid-resource-bounds",
        enforced: true,
        startedAt,
      });
    }

    if (requestTooLarge(request)) {
      return result({
        status: "denied",
        reason: "request-too-large",
        enforced: true,
        startedAt,
      });
    }

    if (PROHIBITED_SHELL_NAMES.has(basename(request.executable))) {
      return result({
        status: "denied",
        reason: "shell-interpreter-prohibited",
        enforced: true,
        startedAt,
      });
    }

    let canonicalPaths;
    try {
      canonicalPaths = await canonicalizeSandboxPaths(request);
    } catch (error) {
      return result({
        status: "denied",
        reason:
          error instanceof SandboxPathError ? error.reason : "invalid-root",
        enforced: true,
        startedAt,
      });
    }

    let authorizedRoots;
    try {
      authorizedRoots = {
        source: await Promise.all(
          this.#options.authorizedSourceRoots.map(
            canonicalDirectoryRoot,
          ),
        ),
        worktree: await Promise.all(
          this.#options.authorizedWorktreeRoots.map(
            canonicalDirectoryRoot,
          ),
        ),
        temp: await Promise.all(
          this.#options.authorizedTempRoots.map(canonicalDirectoryRoot),
        ),
      };
    } catch {
      return result({
        status: "denied",
        reason: "invalid-root",
        enforced: true,
        startedAt,
      });
    }

    const rootsAuthorized =
      canonicalPaths.sourceRoots.every((root) =>
        authorizedRoots.source.some((authorized) =>
          isPathWithin(authorized, root),
        ),
      ) &&
      authorizedRoots.worktree.some((authorized) =>
        isPathWithin(authorized, canonicalPaths.worktreeRoot),
      ) &&
      authorizedRoots.temp.some((authorized) =>
        isPathWithin(authorized, canonicalPaths.tempRoot),
      );
    if (!rootsAuthorized) {
      return result({
        status: "denied",
        reason: "root-not-authorized",
        enforced: true,
        startedAt,
      });
    }

    if (PROHIBITED_SHELL_NAMES.has(basename(canonicalPaths.executable))) {
      return result({
        status: "denied",
        reason: "shell-interpreter-prohibited",
        enforced: true,
        startedAt,
      });
    }

    const allowedExecutables = await Promise.all(
      this.#options.allowedExecutables.map(async (executable) => {
        try {
          return await canonicalizeExecutable(executable);
        } catch {
          return null;
        }
      }),
    );
    if (!allowedExecutables.includes(canonicalPaths.executable)) {
      return result({
        status: "denied",
        reason: "executable-not-allowed",
        enforced: true,
        startedAt,
      });
    }

    const environment = minimalEnvironment(
      request,
      new Set(this.#options.allowedEnvironmentKeys),
      canonicalPaths.tempRoot,
    );
    if (environment === null) {
      return result({
        status: "denied",
        reason: "environment-key-not-allowed",
        enforced: true,
        startedAt,
      });
    }

    if (request.signal?.aborted === true) {
      return result({
        status: "failed",
        reason: "aborted",
        enforced: true,
        startedAt,
      });
    }

    return this.#spawnEnforced({
      request,
      startedAt,
      environment,
      profile: buildMacOSSandboxProfile(canonicalPaths),
      executable: canonicalPaths.executable,
      cwd: canonicalPaths.cwd,
    });
  }

  async #spawnEnforced(input: {
    readonly request: SandboxRunRequest;
    readonly startedAt: number;
    readonly environment: Readonly<Record<string, string>>;
    readonly profile: string;
    readonly executable: string;
    readonly cwd: string;
  }): Promise<SandboxRunResult> {
    const evidence = providerEvidence(input.profile);
    const stdout = createBoundedOutputCollector(
      input.request.maxStdoutBytes,
    );
    const stderr = createBoundedOutputCollector(
      input.request.maxStderrBytes,
    );
    const child = spawn(
      this.#options.sandboxExecutable,
      ["-p", input.profile, input.executable, ...input.request.args],
      {
        cwd: input.cwd,
        detached: true,
        env: input.environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const termination: { current: TerminationState | null } = {
      current: null,
    };
    let escalation: Promise<void> | null = null;

    const terminate = (state: TerminationState) => {
      if (termination.current !== null) {
        return;
      }
      termination.current = state;
      signalProcessGroup(child, "SIGTERM");
      escalation = new Promise((resolve) => {
        setTimeout(() => {
          signalProcessGroup(child, "SIGKILL");
          resolve();
        }, this.#options.terminationGraceMs);
      });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.push(chunk)) {
        terminate({
          status: "output-limit-exceeded",
          reason: "stdout-limit-exceeded",
        });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.push(chunk)) {
        terminate({
          status: "output-limit-exceeded",
          reason: "stderr-limit-exceeded",
        });
      }
    });

    const timeout = setTimeout(() => {
      terminate({ status: "timed-out", reason: "timeout" });
    }, input.request.timeoutMs);
    const abort = () => {
      terminate({ status: "failed", reason: "aborted" });
    };
    input.request.signal?.addEventListener("abort", abort, { once: true });

    const closed = await processClose(child);
    clearTimeout(timeout);
    input.request.signal?.removeEventListener("abort", abort);
    if (escalation !== null) {
      await escalation;
    }

    const stdoutOutput = stdout.output();
    const stderrOutput = stderr.output();
    if (termination.current !== null) {
      return result({
        ...termination.current,
        enforced: true,
        startedAt: input.startedAt,
        exitCode: closed.exitCode,
        signal: closed.signal,
        stdout: stdoutOutput,
        stderr: stderrOutput,
        providerEvidence: evidence,
        cleanupEvidence: UNVERIFIED_PROCESS_GROUP_CLEANUP,
      });
    }

    if (closed.spawnError !== null) {
      return result({
        status: "failed",
        reason: "spawn-error",
        enforced: true,
        startedAt: input.startedAt,
        exitCode: closed.exitCode,
        signal: closed.signal,
        stdout: stdoutOutput,
        stderr: stderrOutput,
        providerEvidence: evidence,
        cleanupEvidence: UNVERIFIED_PROCESS_GROUP_CLEANUP,
      });
    }

    return result({
      status:
        closed.exitCode === 0 && closed.signal === null
          ? "completed"
          : "failed",
      reason:
        closed.exitCode === 0 && closed.signal === null
          ? "completed"
          : "nonzero-exit",
      enforced: true,
      startedAt: input.startedAt,
      exitCode: closed.exitCode,
      signal: closed.signal,
      stdout: stdoutOutput,
      stderr: stderrOutput,
      providerEvidence: evidence,
      cleanupEvidence: UNVERIFIED_PROCESS_GROUP_CLEANUP,
    });
  }
}
