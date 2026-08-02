import {
  constants,
  createReadStream,
  readFileSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import {
  lstat,
  realpath,
  stat,
} from "node:fs/promises";
import {
  spawn as nodeSpawn,
  type SpawnOptions,
} from "node:child_process";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  redactLogMessage,
  type NativeCommandPort,
  type NativeCommandResult,
  type ProcessExecutionPolicy,
  type ProcessRecipe,
  type ProcessStarter,
  type RunningProcessGroup,
  sandboxProcessRecipe,
  validateProcessRecipe,
} from "@memi/capture-execution";

interface ChildProcessLike {
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(
    event: "exit",
    listener: (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => void,
  ): unknown;
}

export type NativeCaptureSpawn = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessLike;

export interface NativeCaptureDependencies {
  readonly spawn: NativeCaptureSpawn;
  readonly kill: (pid: number, signal: NodeJS.Signals) => void;
  readonly setTimer: (callback: () => void, delay: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

export interface NativeProcessBroker {
  readonly roots: readonly string[];
  readonly allowedExecutables: ReadonlySet<string>;
  readonly executableHashes: Readonly<
    Record<string, `sha256:${string}`>
  >;
  readonly sandboxExecutable: string;
  readonly dependencies: NativeCaptureDependencies;
  readonly maximumOutputBytes: number;
  readonly terminationGraceMs: number;
}

export const SANDBOX_EXECUTABLE = "/usr/bin/sandbox-exec";
export const DEFAULT_MAXIMUM_COMMAND_OUTPUT_BYTES = 64 * 1_024 * 1_024;
export const DEFAULT_TERMINATION_GRACE_MS = 2_000;
export const MAXIMUM_CONFIGURED_BYTES = 256 * 1_024 * 1_024;
const MAXIMUM_ARGUMENTS = 256;
const MAXIMUM_ARGUMENT_BYTES = 64 * 1_024;

export const defaultNativeDependencies: NativeCaptureDependencies = {
  spawn: (executable, args, options) =>
    nodeSpawn(executable, [...args], options) as unknown as ChildProcessLike,
  kill: (pid, signal) => process.kill(pid, signal),
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

export function positiveBoundedInteger(
  value: number,
  label: string,
  maximum = MAXIMUM_CONFIGURED_BYTES,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} is outside its safe range.`);
  }
  return value;
}

export function nonNegativeBoundedInteger(
  value: number,
  label: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} is outside its safe range.`);
  }
  return value;
}

export function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot));
}

export async function canonicalDirectory(
  path: string,
  label: string,
): Promise<string> {
  if (!isAbsolute(path) || resolve(path) === "/") {
    throw new Error(`${label} must be a bounded absolute directory.`);
  }
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} must be a real directory without symbolic links.`);
  }
  return realpath(path);
}

export async function canonicalExecutable(
  path: string,
  required: boolean,
): Promise<string | null> {
  if (!isAbsolute(path)) {
    if (required) {
      throw new Error("Capture executable paths must be absolute.");
    }
    return null;
  }
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() && !metadata.isSymbolicLink()) {
      throw new Error("Capture executables must be real executable files.");
    }
    const canonical = await realpath(path);
    const target = await stat(canonical);
    if (!target.isFile() || (target.mode & constants.S_IXUSR) === 0) {
      throw new Error("Capture executables must be real executable files.");
    }
    return canonical;
  } catch (error) {
    if (
      !required &&
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export async function discoverExecutable(
  name: string,
  searchPath: string,
  knownCandidates: readonly string[],
): Promise<string | null> {
  const candidates = searchPath.split(":").flatMap((directory) => {
    if (!isAbsolute(directory)) return [];
    return [resolve(directory, name)];
  });
  for (const candidate of [...candidates, ...knownCandidates]) {
    try {
      const executable = await canonicalExecutable(candidate, false);
      if (executable === null) continue;
      const directory = await stat(dirname(executable));
      if (!directory.isDirectory() || (directory.mode & 0o022) !== 0) {
        continue;
      }
      return executable;
    } catch {
      // Missing and untrusted candidates are ignored.
    }
  }
  return null;
}

export async function discoverExecutablePath(
  name: string,
  searchPath: string,
  knownCandidates: readonly string[],
): Promise<string | null> {
  const pathCandidates = searchPath.split(":").flatMap((directory) => {
    if (!isAbsolute(directory)) {
      return [];
    }
    return [resolve(directory, name)];
  });
  for (const candidate of [...pathCandidates, ...knownCandidates]) {
    try {
      const directory = await stat(resolve(candidate, ".."));
      if (!directory.isDirectory() || (directory.mode & 0o022) !== 0) {
        continue;
      }
      const executable = await canonicalExecutable(candidate, false);
      if (executable !== null) {
        return candidate;
      }
    } catch {
      // Missing and untrusted candidates are ignored.
    }
  }
  return null;
}

function validateStrings(recipe: ProcessRecipe): void {
  if (
    recipe.args.length > MAXIMUM_ARGUMENTS ||
    recipe.args.some((argument) =>
      argument.length > MAXIMUM_ARGUMENT_BYTES ||
      argument.includes("\0") ||
      argument.includes("\r") ||
      argument.includes("\n"))
  ) {
    throw new Error("Native command arguments exceed their safe bounds.");
  }
  for (const [key, value] of Object.entries(recipe.environment ?? {})) {
    if (
      !/^[A-Z][A-Z0-9_]{0,63}$/u.test(key) ||
      value.length > 4_096 ||
      value.includes("\0") ||
      value.includes("\r") ||
      value.includes("\n")
    ) {
      throw new Error("Native command environment is invalid.");
    }
  }
}

async function containedPath(
  roots: readonly string[],
  candidate: string,
): Promise<string> {
  if (!isAbsolute(candidate)) {
    throw new Error("Native command path must be absolute.");
  }
  let canonical: string;
  try {
    canonical = await realpath(candidate);
  } catch {
    throw new Error(
      "Native command path must exist inside app data or a managed worktree.",
    );
  }
  if (!roots.some((root) => isContained(root, canonical))) {
    throw new Error(
      "Native command path must remain inside app data or a managed worktree.",
    );
  }
  return canonical;
}

function terminateGroup(
  pid: number,
  broker: NativeProcessBroker,
): unknown {
  try {
    broker.dependencies.kill(-pid, "SIGTERM");
  } catch {
    // The process group may already have exited.
  }
  return broker.dependencies.setTimer(() => {
    try {
      broker.dependencies.kill(-pid, "SIGKILL");
    } catch {
      // The process group may exit during the grace interval.
    }
  }, broker.terminationGraceMs);
}

function terminateProcess(
  pid: number,
  broker: NativeProcessBroker,
): unknown {
  try {
    broker.dependencies.kill(pid, "SIGTERM");
  } catch {
    // The process may already have exited.
  }
  return broker.dependencies.setTimer(() => {
    try {
      broker.dependencies.kill(pid, "SIGKILL");
    } catch {
      // The process may exit during the grace interval.
    }
  }, broker.terminationGraceMs);
}

async function executableHash(
  path: string,
): Promise<`sha256:${string}`> {
  const digest = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolvePromise);
  });
  return `sha256:${digest.digest("hex")}`;
}

function executableHashSync(path: string): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(readFileSync(path))
    .digest("hex")}`;
}

async function assertExecutableIntegrity(
  path: string,
  broker: NativeProcessBroker,
): Promise<void> {
  const expected = broker.executableHashes[path];
  let actual: `sha256:${string}` | undefined;
  try {
    actual = await executableHash(path);
  } catch {
    actual = undefined;
  }
  if (expected === undefined || actual !== expected) {
    throw new Error("Capture executable integrity changed after approval.");
  }
}

function assertExecutableIntegritySync(
  path: string,
  broker: NativeProcessBroker,
): void {
  const expected = broker.executableHashes[path];
  let actual: `sha256:${string}` | undefined;
  try {
    actual = executableHashSync(path);
  } catch {
    actual = undefined;
  }
  if (expected === undefined || actual !== expected) {
    throw new Error("Capture executable integrity changed after approval.");
  }
}

async function validateSandboxedRecipe(
  recipe: ProcessRecipe,
  broker: NativeProcessBroker,
): Promise<ProcessRecipe> {
  validateStrings({ ...recipe, args: recipe.args.slice(2) });
  if (
    recipe.args[1] === undefined ||
    recipe.args[1].length > MAXIMUM_ARGUMENT_BYTES ||
    recipe.args[1].includes("\0")
  ) {
    throw new Error("Native sandbox policy exceeds its safe bounds.");
  }
  const cwd = await containedPath(broker.roots, recipe.cwd);
  const outer = await canonicalExecutable(recipe.executable, true);
  if (
    outer !== broker.sandboxExecutable ||
    recipe.args[0] !== "-p" ||
    recipe.args.length < 3
  ) {
    throw new Error("Native command must use the trusted sandbox executable.");
  }
  const underlying = await canonicalExecutable(recipe.args[2]!, true);
  if (
    underlying === null ||
    !broker.allowedExecutables.has(underlying)
  ) {
    throw new Error("Native command executable is not on the fixed allowlist.");
  }
  await assertExecutableIntegrity(outer!, broker);
  await assertExecutableIntegrity(underlying, broker);
  return Object.freeze({
    executable: outer,
    args: Object.freeze([...recipe.args]),
    cwd,
    ...(recipe.environment === undefined
      ? {}
      : { environment: Object.freeze({ ...recipe.environment }) }),
  });
}

async function validateDirectRecipe(
  recipe: ProcessRecipe,
  policy: ProcessExecutionPolicy,
  broker: NativeProcessBroker,
): Promise<ProcessRecipe> {
  // Reuse the canonical policy validator for its environment and path checks;
  // the returned wrapper is not executed on this CoreSimulator-only route.
  const sandboxed = sandboxProcessRecipe(recipe, policy);
  const requested = validateProcessRecipe(recipe, policy);
  validateStrings(requested);
  const cwd = await containedPath(broker.roots, requested.cwd);
  const executable = await canonicalExecutable(requested.executable, true);
  if (executable === null || !broker.allowedExecutables.has(executable)) {
    throw new Error("Native command executable is not on the fixed allowlist.");
  }
  await assertExecutableIntegrity(executable, broker);
  return Object.freeze({
    executable,
    args: Object.freeze([...requested.args]),
    cwd,
    ...(sandboxed.environment === undefined
      ? {}
      : { environment: Object.freeze({ ...sandboxed.environment }) }),
  });
}

function spawnOptions(
  recipe: ProcessRecipe,
  detached = true,
): SpawnOptions {
  return {
    cwd: recipe.cwd,
    detached,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: recipe.environment,
  };
}

const MAXIMUM_FAILURE_EVIDENCE_LENGTH = 8_192;
const FAILURE_TAIL_LENGTH = 4_096;

/**
 * Bun's child-process bridge can stop servicing the runtime socket while an
 * Xcode build is blocked in CoreSimulator/XcodeBuildService. The worker is a
 * fixed Node program: it receives only the already validated recipe as a
 * base64url payload, forwards bounded stdout/stderr, and terminates the
 * detached build group when the broker cancels it. It is never constructed
 * from user-provided code or shell text.
 */
export const NODE_NATIVE_BUILD_WORKER = String.raw`
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const encoded = process.argv[1];
let recipe;
try {
  recipe = JSON.parse(Buffer.from(encoded ?? "", "base64url").toString("utf8"));
} catch {
  process.stderr.write("Memi native build worker received an invalid recipe.\\n");
  process.exit(64);
}
if (
  typeof recipe?.executable !== "string" ||
  !Array.isArray(recipe?.args) ||
  typeof recipe?.cwd !== "string" ||
  recipe.args.some((value) => typeof value !== "string")
) {
  process.stderr.write("Memi native build worker received an invalid command.\\n");
  process.exit(64);
}

const temporaryDirectory = recipe.environment?.TMPDIR;
if (typeof temporaryDirectory !== "string" || !isAbsolute(temporaryDirectory)) {
  process.stderr.write("Memi native build worker requires a managed temporary directory.\\n");
  process.exit(64);
}
const diagnosticsDirectory = join(temporaryDirectory, "memi-native-build-diagnostics");
const transcriptPath = join(diagnosticsDirectory, "native-build-" + process.pid + ".log");
let transcriptDescriptor;
try {
  mkdirSync(diagnosticsDirectory, { recursive: true, mode: 0o700 });
  transcriptDescriptor = openSync(transcriptPath, "w", 0o600);
} catch (error) {
  process.stderr.write("Memi native build worker could not create its managed transcript: " + String(error?.message ?? error) + "\\n");
  process.exit(70);
}

const child = spawn(recipe.executable, recipe.args, {
  cwd: recipe.cwd,
  env: recipe.environment,
  // The worker owns this process group. Xcode can spawn independent script
  // phases, so signalling only xcodebuild leaves those phases alive after a
  // cancelled capture and consumes the user's disk/CPU in the background.
  detached: true,
  shell: false,
  // Xcode's build service can block while forwarding a script phase through
  // an inherited pipe even if Node drains the outer xcodebuild stream. A
  // managed temporary file avoids that transport entirely; only a bounded
  // tail is returned to the broker after the build exits.
  stdio: ["ignore", transcriptDescriptor, transcriptDescriptor],
});
// Keep only a small tail for a build. The -showBuildSettings action is different: its
// complete output is a bounded, machine-generated input to source-safe build
// preparation. Truncating that output can silently discard the setting we
// must resolve, so retain the entire modest settings report instead.
const maximumWorkerReportBytes = recipe.args.includes("-showBuildSettings")
  ? 512 * 1024
  : 4 * 1024;
const createOutputTail = () => {
  let chunks = [];
  let byteLength = 0;
  let truncated = false;
  return {
    append: (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (bytes.byteLength === 0) return;
      chunks.push(bytes);
      byteLength += bytes.byteLength;
      while (byteLength > maximumWorkerReportBytes) {
        truncated = true;
        const discarded = byteLength - maximumWorkerReportBytes;
        const first = chunks[0];
        if (first.byteLength <= discarded) {
          chunks.shift();
          byteLength -= first.byteLength;
        } else {
          chunks[0] = first.subarray(discarded);
          byteLength -= discarded;
        }
      }
    },
    writeTo: (stream) => {
      if (truncated) stream.write("[Memi native build output truncated]\\n");
      if (byteLength > 0) stream.write(Buffer.concat(chunks, byteLength));
    },
  };
};
const stdoutTail = createOutputTail();
const stderrTail = createOutputTail();
let transcriptClosed = false;
const cleanupTranscript = () => {
  if (!transcriptClosed) {
    transcriptClosed = true;
    try { closeSync(transcriptDescriptor); } catch {}
  }
  try { rmSync(transcriptPath, { force: true }); } catch {}
};
const appendTranscript = () => {
  if (!transcriptClosed) {
    transcriptClosed = true;
    try { closeSync(transcriptDescriptor); } catch {}
  }
  try { stdoutTail.append(readFileSync(transcriptPath)); } catch {}
  cleanupTranscript();
};
const signalGroup = (signal) => {
  try { process.kill(-child.pid, signal); } catch {}
};
const descendantProcessIds = () => new Promise((resolve) => {
  // Xcode's build service can place script phases in their own process group.
  // Snapshot the validated build's descendants before terminating its group so
  // those escaping scripts stay addressable after their parent exits. The ps
  // fixed and local; the only signalled PIDs are descendants of this child.
  let output = "";
  let settled = false;
  const settle = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolve(value);
  };
  let inspector;
  const timeout = setTimeout(() => {
    try { inspector?.kill("SIGKILL"); } catch {}
    settle([]);
  }, 250);
  try {
    inspector = spawn("/bin/ps", ["-axo", "pid=,ppid="], {
      cwd: "/",
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    inspector.stdout?.on("data", (chunk) => { output += String(chunk); });
    inspector.once("error", () => settle([]));
    inspector.once("exit", () => {
      const childrenByParent = new Map();
      for (const line of output.split(/\r?\n/)) {
        const [pidText, parentText] = line.trim().split(/\s+/);
        const pid = Number(pidText);
        const parentPid = Number(parentText);
        if (
          Number.isSafeInteger(pid) && pid > 0 &&
          Number.isSafeInteger(parentPid) && parentPid > 0
        ) {
          const children = childrenByParent.get(parentPid) ?? [];
          children.push(pid);
          childrenByParent.set(parentPid, children);
        }
      }
      const matches = [];
      const queue = [child.pid];
      const visited = new Set(queue);
      while (queue.length > 0) {
        const parentPid = queue.shift();
        for (const pid of childrenByParent.get(parentPid) ?? []) {
          if (visited.has(pid)) continue;
          visited.add(pid);
          matches.push(pid);
          queue.push(pid);
        }
      }
      settle(matches);
    });
  } catch {
    settle([]);
  }
});
const signalDescendants = (processIds, signal) => {
  for (const pid of [...processIds].reverse()) {
    try { process.kill(pid, signal); } catch {}
  }
};
let terminating = false;
let nativeExitCode = null;
const terminate = () => {
  if (terminating) return;
  terminating = true;
  void (async () => {
    const descendants = await descendantProcessIds();
    signalDescendants(descendants, "SIGTERM");
    signalGroup("SIGTERM");
    setTimeout(() => {
      signalDescendants(descendants, "SIGKILL");
      signalGroup("SIGKILL");
      process.exit(nativeExitCode ?? 1);
    }, 250);
  })();
};
process.once("SIGTERM", terminate);
process.once("SIGINT", terminate);
child.once("error", (error) => {
  cleanupTranscript();
  process.stderr.write(String(error?.message ?? error) + "\\n");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  nativeExitCode = code;
  appendTranscript();
  stdoutTail.writeTo(process.stdout);
  stderrTail.writeTo(process.stderr);
  if (!terminating) process.exitCode = code ?? 1;
});
`;

/**
 * Preserve explicit tool diagnostics as well as the end of a verbose process
 * transcript. CocoaPods commonly prints the only actionable line before a
 * long Ruby stack trace, so a plain tail can hide the reason a retry cannot
 * succeed. The resulting text is still redacted and bounded before it reaches
 * a durable import failure.
 */
export function boundedFailureEvidence(
  stdout: readonly Buffer[],
  stderr: readonly Buffer[],
): string {
  const combined = Buffer.concat([
    ...stdout,
    ...stderr,
  ]).toString("utf8");
  const lines = combined.split(/\r?\n/u);
  const explicitDiagnostics = lines.flatMap((line, index) =>
    /^\s*\[!\]|\b(?:error|failed|denied|not permitted|no such file|command not found|invalid)\b/iu.test(line)
      ? lines.slice(index, index + 5)
      : [],
  ).slice(0, 24);
  const diagnosticPrefix = explicitDiagnostics.join("\n");
  const tail = combined.slice(-FAILURE_TAIL_LENGTH);
  const redacted = redactLogMessage(
    [diagnosticPrefix, tail].filter((value) => value.length > 0).join("\n"),
    Number.MAX_SAFE_INTEGER,
  ).trim();
  return redacted.length <= MAXIMUM_FAILURE_EVIDENCE_LENGTH
    ? redacted
    : `${redacted.slice(0, MAXIMUM_FAILURE_EVIDENCE_LENGTH - FAILURE_TAIL_LENGTH - 1)}\n…${redacted.slice(-FAILURE_TAIL_LENGTH)}`;
}

function failedCommandMessage(
  recipe: ProcessRecipe,
  stdout: readonly Buffer[],
  stderr: readonly Buffer[],
  code: number | null,
  exitSignal: NodeJS.Signals | null,
): string {
  const executable = basename(recipe.args[2] ?? recipe.executable);
  const command = [
    executable,
    (recipe.args[2] === undefined ? recipe.args : recipe.args.slice(3)).join(" "),
  ].filter((value) => value.length > 0).join(" ");
  const evidence = boundedFailureEvidence(stdout, stderr);
  return [
    `${redactLogMessage(command)} exited unsuccessfully (${
      String(code ?? exitSignal ?? "unknown")
    }).`,
    evidence,
  ].filter((value) => value.length > 0).join(" ");
}

async function executeValidatedRecipe(
  validated: ProcessRecipe,
  signal: AbortSignal,
  broker: NativeProcessBroker,
  detached = true,
): Promise<NativeCommandResult> {
  if (signal.aborted) {
    throw new Error("Native command was cancelled.");
  }
  const child = broker.dependencies.spawn(
    validated.executable,
    validated.args,
    spawnOptions(validated, detached),
  );
  if (child.pid === undefined) {
    throw new Error("Native command did not produce a process identifier.");
  }
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  let exceeded = false;
  let terminationTimer: unknown;
  const cancel = (): void => {
    terminationTimer ??= detached
      ? terminateGroup(child.pid!, broker)
      : terminateProcess(child.pid!, broker);
  };
  const append = (target: Buffer[], chunk: unknown): void => {
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    outputBytes += bytes.byteLength;
    if (outputBytes > broker.maximumOutputBytes) {
      exceeded = true;
      cancel();
    } else {
      target.push(bytes);
    }
  };
  child.stdout?.on("data", (chunk) => append(stdout, chunk));
  child.stderr?.on("data", (chunk) => append(stderr, chunk));
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await new Promise<NativeCommandResult>((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("exit", (code, exitSignal) => {
        try {
          broker.dependencies.kill(detached ? -child.pid! : child.pid!, "SIGKILL");
        } catch {
          // The process group already exited. This is the expected fast path.
        }
        if (terminationTimer !== undefined) {
          broker.dependencies.clearTimer(terminationTimer);
        }
        if (exceeded) {
          reject(new Error("Native command output exceeded its byte limit."));
        } else if (signal.aborted) {
          reject(new Error("Native command was cancelled."));
        } else if (code !== 0) {
          reject(new Error(failedCommandMessage(
            validated,
            stdout,
            stderr,
            code,
            exitSignal,
          )));
        } else {
          resolvePromise({
            stdout: new Uint8Array(Buffer.concat(stdout)),
            stderr: Buffer.concat(stderr).toString("utf8"),
          });
        }
      });
    });
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

async function executeRecipe(
  recipe: ProcessRecipe,
  signal: AbortSignal,
  broker: NativeProcessBroker,
): Promise<NativeCommandResult> {
  return executeValidatedRecipe(
    await validateSandboxedRecipe(recipe, broker),
    signal,
    broker,
  );
}

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

function startValidatedRecipe(
  recipe: ProcessRecipe,
  signal: AbortSignal,
  broker: NativeProcessBroker,
): RunningProcessGroup {
  const child = broker.dependencies.spawn(
    recipe.executable,
    recipe.args,
    spawnOptions(recipe),
  );
  if (child.pid === undefined) {
    throw new Error("React launch did not produce a process identifier.");
  }
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", () => undefined);
  let terminationTimer: unknown;
  let resolveCancelled!: () => void;
  const cancelled = new Promise<void>((resolvePromise) => {
    resolveCancelled = resolvePromise;
  });
  const cancel = (): void => {
    terminationTimer ??= terminateGroup(child.pid!, broker);
  };
  child.once("exit", () => {
    if (terminationTimer !== undefined) {
      broker.dependencies.clearTimer(terminationTimer);
    }
    resolveCancelled();
  });
  child.once("error", () => resolveCancelled());
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) {
    cancel();
  }
  return Object.freeze({ child, cancelled, cancel });
}

function canonicalLaunchCwd(
  cwd: string,
  broker: NativeProcessBroker,
): string {
  const canonicalCwd = realpathOrNull(cwd);
  if (
    canonicalCwd === null ||
    !broker.roots.some((root) => isContained(root, canonicalCwd))
  ) {
    throw new Error("React launch cwd is outside managed roots.");
  }
  return canonicalCwd;
}

function startRecipe(
  recipe: ProcessRecipe,
  policy: ProcessExecutionPolicy,
  signal: AbortSignal,
  broker: NativeProcessBroker,
): RunningProcessGroup {
  const sandboxed = sandboxProcessRecipe(
    { ...recipe, cwd: canonicalLaunchCwd(recipe.cwd, broker) },
    policy,
  );
  validateStrings({ ...sandboxed, args: sandboxed.args.slice(2) });
  const underlying = realpathOrNull(sandboxed.args[2]!);
  if (
    underlying === null ||
    !broker.allowedExecutables.has(underlying)
  ) {
    throw new Error("React launch executable is not on the fixed allowlist.");
  }
  const outer = realpathOrNull(sandboxed.executable);
  if (outer !== broker.sandboxExecutable) {
    throw new Error("React launch must use the trusted sandbox executable.");
  }
  assertExecutableIntegritySync(outer, broker);
  assertExecutableIntegritySync(underlying, broker);
  return startValidatedRecipe(sandboxed, signal, broker);
}

function startDirectLocalRecipe(
  recipe: ProcessRecipe,
  policy: ProcessExecutionPolicy,
  signal: AbortSignal,
  broker: NativeProcessBroker,
): RunningProcessGroup {
  const sandboxed = sandboxProcessRecipe(
    { ...recipe, cwd: canonicalLaunchCwd(recipe.cwd, broker) },
    policy,
  );
  const executable = realpathOrNull(sandboxed.args[2]!);
  if (
    executable === null ||
    !broker.allowedExecutables.has(executable)
  ) {
    throw new Error("Direct local launch executable is not on the fixed allowlist.");
  }
  assertExecutableIntegritySync(executable, broker);
  const direct = Object.freeze({
    executable,
    args: Object.freeze(sandboxed.args.slice(3)),
    cwd: sandboxed.cwd,
    ...(sandboxed.environment === undefined
      ? {}
      : { environment: sandboxed.environment }),
  });
  validateStrings(direct);
  return startValidatedRecipe(direct, signal, broker);
}

export function createNativeCommandPort(
  broker: NativeProcessBroker,
): NativeCommandPort {
  let tail: Promise<void> = Promise.resolve();
  return Object.freeze({
    async execute(recipe: ProcessRecipe, signal: AbortSignal) {
      const preceding = tail;
      let release!: () => void;
      tail = new Promise<void>((resolvePromise) => {
        release = resolvePromise;
      });
      await preceding;
      try {
        return await executeRecipe(recipe, signal, broker);
      } finally {
        release();
      }
    },
  });
}

/**
 * CoreSimulator rejects sandbox-exec clients. This separate path retains the
 * exact command allowlist, executable integrity check, contained working
 * directory, scrubbed environment, output cap, and process-group cancellation
 * of the normal broker, but intentionally omits only sandbox-exec. It is used
 * only for simulator control and Maestro hierarchy reads against that device.
 */
export function createDirectNativeCommandPort(
  broker: NativeProcessBroker,
): Readonly<{
  execute(
    recipe: ProcessRecipe,
    policy: ProcessExecutionPolicy,
    signal: AbortSignal,
  ): Promise<NativeCommandResult>;
}> {
  let tail: Promise<void> = Promise.resolve();
  return Object.freeze({
    async execute(
      recipe: ProcessRecipe,
      policy: ProcessExecutionPolicy,
      signal: AbortSignal,
    ): Promise<NativeCommandResult> {
      const preceding = tail;
      let release!: () => void;
      tail = new Promise<void>((resolvePromise) => {
        release = resolvePromise;
      });
      await preceding;
      try {
        return await executeValidatedRecipe(
          await validateDirectRecipe(recipe, policy, broker),
          signal,
          broker,
          false,
        );
      } finally {
        release();
      }
    },
  });
}

export interface NodeWorkerNativeBuildPortOptions {
  /** A canonical Node binary that is also present in the broker allowlist. */
  readonly nodeExecutable: string;
  /** The one native executable this worker may execute. */
  readonly nativeBuildExecutable: string;
}

function nodeWorkerRecipe(
  nodeExecutable: string,
  nativeRecipe: ProcessRecipe,
): ProcessRecipe {
  const encodedRecipe = Buffer.from(
    JSON.stringify(nativeRecipe),
    "utf8",
  ).toString("base64url");
  return Object.freeze({
    executable: nodeExecutable,
    args: Object.freeze([
      "--input-type=module",
      "-e",
      NODE_NATIVE_BUILD_WORKER,
      encodedRecipe,
    ]),
    cwd: nativeRecipe.cwd,
    ...(nativeRecipe.environment === undefined
      ? {}
      : { environment: nativeRecipe.environment }),
  });
}

/**
 * Runs exactly one approved native build through Node instead of Bun. This
 * isolates XcodeBuildService's blocking behavior from the Bun RPC event loop,
 * so imports remain observable and cancellable while Xcode is busy.
 */
export function createNodeWorkerNativeBuildCommandPort(
  broker: NativeProcessBroker,
  options: NodeWorkerNativeBuildPortOptions,
): Readonly<{
  execute(
    recipe: ProcessRecipe,
    policy: ProcessExecutionPolicy,
    signal: AbortSignal,
  ): Promise<NativeCommandResult>;
}> {
  let tail: Promise<void> = Promise.resolve();
  return Object.freeze({
    async execute(
      recipe: ProcessRecipe,
      policy: ProcessExecutionPolicy,
      signal: AbortSignal,
    ): Promise<NativeCommandResult> {
      const preceding = tail;
      let release!: () => void;
      tail = new Promise<void>((resolvePromise) => {
        release = resolvePromise;
      });
      await preceding;
      try {
        const [validatedRecipe, nodeExecutable, nativeBuildExecutable] = await Promise.all([
          validateDirectRecipe(recipe, policy, broker),
          canonicalExecutable(options.nodeExecutable, true),
          canonicalExecutable(options.nativeBuildExecutable, true),
        ]);
        if (
          nodeExecutable === null ||
          nativeBuildExecutable === null ||
          !broker.allowedExecutables.has(nodeExecutable) ||
          !broker.allowedExecutables.has(nativeBuildExecutable) ||
          validatedRecipe.executable !== nativeBuildExecutable
        ) {
          throw new Error("Native build worker is not authorized for this executable.");
        }
        await assertExecutableIntegrity(nodeExecutable, broker);
        return executeValidatedRecipe(
          nodeWorkerRecipe(nodeExecutable, validatedRecipe),
          signal,
          broker,
          false,
        );
      } finally {
        release();
      }
    },
  });
}

/**
 * CoreSimulator has the same sandbox incompatibility as Xcode's build
 * service. Keep the historical name at the call site while sharing the exact
 * allowlist, executable-integrity, contained-cwd, scrubbed-environment, and
 * process-group-cancellation checks with the native-build route.
 */
export function createDirectSimulatorCommandPort(
  broker: NativeProcessBroker,
): Readonly<{
  execute(
    recipe: ProcessRecipe,
    policy: ProcessExecutionPolicy,
    signal: AbortSignal,
  ): Promise<NativeCommandResult>;
}> {
  return createDirectNativeCommandPort(broker);
}

/**
 * Metro's development server cannot start inside sandbox-exec on current macOS
 * builds (its watcher blocks before binding loopback). This is an explicit,
 * narrowly scoped fallback for an already approved local development-client
 * recipe: executable integrity, exact arguments, managed cwd, scrubbed env,
 * and process-group cancellation are still enforced. It is never used for
 * arbitrary commands, preparation, screenshots, or simulator control.
 */
export function createDirectLocalProcessStarter(
  broker: NativeProcessBroker,
): ProcessStarter {
  return Object.freeze({
    start: (
      recipe: ProcessRecipe,
      policy: ProcessExecutionPolicy,
      signal: AbortSignal,
    ) => startDirectLocalRecipe(recipe, policy, signal, broker),
  });
}

export function createNativeProcessStarter(
  broker: NativeProcessBroker,
): ProcessStarter {
  return Object.freeze({
    start: (
      recipe: ProcessRecipe,
      policy: ProcessExecutionPolicy,
      signal: AbortSignal,
    ) => startRecipe(recipe, policy, signal, broker),
  });
}

export function literalPolicy(
  executable: string,
  args: readonly string[],
  roots: readonly string[],
  appDataRoot: string,
): ProcessExecutionPolicy {
  return {
    allowedCommands: [{
      executable,
      arguments: args.map((value) => ({ kind: "literal", value })),
    }],
    allowedCwdRoots: roots,
    sandboxEnvironment: {
      home: resolve(appDataRoot, "sandbox/home"),
      temporaryDirectory: resolve(appDataRoot, "sandbox/tmp"),
      path: "",
    },
    sandbox: {
      executable: SANDBOX_EXECUTABLE,
      allowedReadRoots: [...roots, appDataRoot, "/System", "/Library", "/usr"],
      allowedWriteRoots: [appDataRoot, ...roots],
      network: "none",
    },
  };
}
