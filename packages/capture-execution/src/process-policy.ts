import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { realpathSync } from "node:fs";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface ProcessRecipe {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface ProcessExecutionPolicy {
  readonly allowedCommands: readonly ProcessCommandRule[];
  readonly allowedCwdRoots: readonly string[];
  readonly maximumArguments?: number;
  readonly maximumArgumentLength?: number;
  readonly allowedEnvironmentKeys?: readonly string[];
  readonly sandboxEnvironment: Readonly<{
    home: string;
    temporaryDirectory: string;
    path: string;
    developerDirectory?: string | undefined;
    sdkRoot?: string | undefined;
    /** Values passed to React Native's upstream iOS glog Autoconf hook. */
    autoconfPlatformName?: "iphonesimulator" | undefined;
    autoconfCurrentArchitecture?: "arm64" | undefined;
    gitConfigNoSystem?: true | undefined;
  }>;
  readonly sandbox: Readonly<{
    executable: string;
    allowedReadRoots: readonly string[];
    allowedReadMetadataRoots?: readonly string[];
    allowedWriteRoots: readonly string[];
    allowedReadLiterals?: readonly string[];
    allowedReadMetadataLiterals?: readonly string[];
    allowedWriteLiterals?: readonly string[];
    allowRootMetadata?: boolean;
    /**
     * Allows HOME to remain the host user home only when a policy grants a
     * strictly narrower descendant root for both reads and writes.
     */
    allowHostHome?: true;
    allowedMachLookupGlobals?: readonly string[];
    network: "none" | "loopback" | "outbound";
  }>;
}

export type ProcessArgumentRule =
  | Readonly<{ kind: "literal"; value: string }>
  | Readonly<{
      kind: "integer";
      minimum: number;
      maximum: number;
    }>
  | Readonly<{ kind: "safe-token" }>
  | Readonly<{ kind: "expo-project-url" }>
  | Readonly<{
      kind: "expo-development-client-url";
      scheme: string;
    }>
  | Readonly<{
      kind: "expo-standalone-url";
      scheme: string;
    }>;

export interface ProcessCommandRule {
  readonly executable: string;
  readonly arguments: readonly ProcessArgumentRule[];
}

interface ChildProcessLike {
  readonly pid?: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface ProcessRunnerDependencies {
  readonly spawn: (
    executable: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcessLike;
  readonly kill: (pid: number, signal: NodeJS.Signals) => void;
  readonly setTimer: (callback: () => void, delay: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
  readonly existsFile: (path: string) => boolean;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const canonical = (value: string): string => {
    let current = resolve(value);
    const suffix: string[] = [];
    try {
      while (true) {
        try {
          return resolve(
            realpathSync.native(current),
            ...suffix.reverse(),
          );
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
          ) {
            throw error;
          }
          const parent = resolve(current, "..");
          if (parent === current) {
            return resolve(value);
          }
          suffix.push(current.slice(parent.length + 1));
          current = parent;
        }
      }
    } finally {
      suffix.length = 0;
    }
  };
  const pathFromRoot = relative(canonical(root), canonical(candidate));
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  );
}

function validateArgument(
  argument: string,
  maximumLength: number,
): string {
  if (
    argument.length > maximumLength ||
    Array.from(argument).some((character) => {
      const code = character.codePointAt(0);
      return code === undefined || code === 0 || code === 0x0a || code === 0x0d;
    })
  ) {
    throw new Error("Process argument is invalid or exceeds its limit.");
  }
  return argument;
}

function isExpoProjectUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const port = Number(url.port);
  const pathSegments = url.pathname.split("/");
  return (
    url.protocol === "exp:" &&
    url.hostname === "127.0.0.1" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "" &&
    Number.isSafeInteger(port) &&
    port >= 1 &&
    port <= 65_535 &&
    (
      url.pathname === "" ||
      url.pathname === "/" ||
      url.pathname.startsWith("/--/")
    ) &&
    !pathSegments.includes("..") &&
    [...url.searchParams].length <= 64
  );
}

function isExpoDevelopmentClientUrl(value: string, scheme: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9+.-]{0,127}$/u.test(scheme)) {
    return false;
  }
  let wrapper: URL;
  try {
    wrapper = new URL(value);
  } catch {
    return false;
  }
  if (
    wrapper.protocol !== `${scheme.toLowerCase()}:` ||
    wrapper.hostname !== "expo-development-client" ||
    wrapper.username !== "" ||
    wrapper.password !== "" ||
    wrapper.hash !== "" ||
    wrapper.pathname !== "/" ||
    wrapper.searchParams.size !== 1
  ) {
    return false;
  }
  const target = wrapper.searchParams.get("url");
  if (target === null) {
    return false;
  }
  try {
    const metro = new URL(target);
    const port = Number(metro.port);
    return (
      metro.protocol === "http:" &&
      metro.hostname === "127.0.0.1" &&
      metro.username === "" &&
      metro.password === "" &&
      metro.hash === "" &&
      Number.isSafeInteger(port) &&
      port >= 1 &&
      port <= 65_535 &&
      (metro.pathname === "" ||
        metro.pathname === "/" ||
        metro.pathname.startsWith("/--/")) &&
      !metro.pathname.split("/").includes("..") &&
      [...metro.searchParams].length <= 64
    );
  } catch {
    return false;
  }
}

function isExpoStandaloneUrl(value: string, scheme: string): boolean {
  if (
    !/^[A-Za-z][A-Za-z0-9+.-]{0,127}$/u.test(scheme) ||
    !value.startsWith(`${scheme}:///`) ||
    value.includes("#")
  ) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const query = url.searchParams;
  const encodedSegments = url.pathname.slice(1).split("/");
  try {
    return (
      url.protocol === `${scheme.toLowerCase()}:` &&
      url.hostname === "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      query.size === 2 &&
      query.getAll("__memi_capture").length === 1 &&
      query.getAll("__memi_state").length === 1 &&
      /^[0-9A-HJKMNP-TV-Z]{26}$/u.test(
        query.get("__memi_capture") ?? "",
      ) &&
      (query.get("__memi_state")?.length ?? 0) > 0 &&
      (query.get("__memi_state")?.length ?? 0) <= 160 &&
      (url.pathname === "/" || encodedSegments.every((segment) => {
        const decoded = decodeURIComponent(segment);
        return (
          decoded.length > 0 &&
          decoded !== "." &&
          decoded !== ".." &&
          !decoded.includes("/") &&
          !decoded.includes("\\") &&
          !decoded.includes("\0")
        );
      }))
    );
  } catch {
    return false;
  }
}

function matchesArgumentRule(
  argument: string,
  rule: ProcessArgumentRule,
): boolean {
  switch (rule.kind) {
    case "literal":
      return argument === rule.value;
    case "integer": {
      if (!/^\d+$/u.test(argument)) {
        return false;
      }
      const value = Number(argument);
      return (
        Number.isSafeInteger(value) &&
        value >= rule.minimum &&
        value <= rule.maximum
      );
    }
    case "safe-token":
      return /^[a-zA-Z0-9._:@/=-]+$/u.test(argument);
    case "expo-project-url":
      return isExpoProjectUrl(argument);
    case "expo-development-client-url":
      return isExpoDevelopmentClientUrl(argument, rule.scheme);
    case "expo-standalone-url":
      return isExpoStandaloneUrl(argument, rule.scheme);
  }
}

export function validateProcessRecipe(
  recipe: ProcessRecipe,
  policy: ProcessExecutionPolicy,
): ProcessRecipe {
  const matchingCommand = policy.allowedCommands.find(
    (command) =>
      command.executable === recipe.executable &&
      command.arguments.length === recipe.args.length &&
      command.arguments.every((rule, index) =>
        matchesArgumentRule(recipe.args[index] ?? "", rule),
      ),
  );
  if (!isAbsolute(recipe.executable) || matchingCommand === undefined) {
    throw new Error("Process executable is not on the exact allowlist.");
  }
  const maximumArguments = policy.maximumArguments ?? 128;
  const maximumArgumentLength = policy.maximumArgumentLength ?? 4_096;
  if (recipe.args.length > maximumArguments) {
    throw new Error("Process argument count exceeds its limit.");
  }
  const cwd = resolve(recipe.cwd);
  if (
    !isAbsolute(recipe.cwd) ||
    !policy.allowedCwdRoots.some((root) => isWithinRoot(cwd, root))
  ) {
    throw new Error("Process working directory is outside managed roots.");
  }
  const environmentEntries = Object.entries(recipe.environment ?? {});
  const allowedEnvironmentKeys = policy.allowedEnvironmentKeys ?? [];
  if (
    environmentEntries.some(
      ([key, value]) =>
        !allowedEnvironmentKeys.includes(key) ||
        !/^[A-Z][A-Z0-9_]{0,63}$/u.test(key) ||
        value.length > 4_096 ||
        value.includes("\u0000") ||
        value.includes("\r") ||
        value.includes("\n"),
    )
  ) {
    throw new Error(
      "Process environment contains an unapproved key or value.",
    );
  }
  const environment =
    environmentEntries.length > 0
      ? Object.freeze(Object.fromEntries(environmentEntries))
      : undefined;
  return Object.freeze({
    executable: recipe.executable,
    args: Object.freeze(
      recipe.args.map((argument) =>
        validateArgument(argument, maximumArgumentLength),
      ),
    ),
    cwd,
    ...(environment ? { environment } : {}),
  });
}

export interface RunningProcessGroup {
  readonly child: ChildProcessLike;
  readonly cancelled: Promise<void>;
  cancel(): void;
}

const defaultDependencies: ProcessRunnerDependencies = {
  spawn: (executable, args, options) =>
    nodeSpawn(executable, [...args], options) as ChildProcess,
  kill: (pid, signal) => process.kill(pid, signal),
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: (timer) => clearTimeout(timer as NodeJS.Timeout),
  existsFile: (path) => existsSync(path),
};

function sandboxEnvironment(
  policy: ProcessExecutionPolicy,
): Readonly<Record<string, string>> {
  const {
    home,
    temporaryDirectory,
    path,
    developerDirectory,
    sdkRoot,
    autoconfPlatformName,
    autoconfCurrentArchitecture,
    gitConfigNoSystem,
  } = policy.sandboxEnvironment;
  const homeIsManaged = policy.allowedCwdRoots.some((root) =>
    isWithinRoot(home, root),
  );
  const homeIsNarrowHostAuthority =
    policy.sandbox.allowHostHome === true &&
    policy.sandbox.allowedReadRoots.some((root) =>
      isWithinRoot(root, home),
    ) &&
    policy.sandbox.allowedWriteRoots.some((root) =>
      isWithinRoot(root, home),
    );
  if (
    !isAbsolute(home) ||
    !isAbsolute(temporaryDirectory) ||
    (!homeIsManaged && !homeIsNarrowHostAuthority) ||
    !policy.allowedCwdRoots.some((root) =>
      isWithinRoot(temporaryDirectory, root),
    )
  ) {
    throw new Error("Sandbox HOME and TMPDIR must be inside managed roots.");
  }
  if (
    sdkRoot !== undefined &&
    (!isAbsolute(sdkRoot) ||
      !policy.sandbox.allowedReadRoots.some((root) =>
        isWithinRoot(sdkRoot, root),
      ))
  ) {
    throw new Error("Sandbox SDKROOT must be inside an approved read-only root.");
  }
  if (
    developerDirectory !== undefined &&
    (!isAbsolute(developerDirectory) ||
      !policy.sandbox.allowedReadRoots.some((root) =>
        isWithinRoot(developerDirectory, root),
      ))
  ) {
    throw new Error(
      "Sandbox DEVELOPER_DIR must be inside an approved read-only root.",
    );
  }
  return {
    HOME: home,
    LANG: "en_US.UTF-8",
    PATH: path,
    TMPDIR: temporaryDirectory,
    ...(developerDirectory === undefined
      ? {}
      : { DEVELOPER_DIR: developerDirectory }),
    ...(sdkRoot === undefined ? {} : { SDKROOT: sdkRoot }),
    ...(autoconfPlatformName === undefined
      ? {}
      : { PLATFORM_NAME: autoconfPlatformName }),
    ...(autoconfCurrentArchitecture === undefined
      ? {}
      : { CURRENT_ARCH: autoconfCurrentArchitecture }),
    ...(gitConfigNoSystem === true ? { GIT_CONFIG_NOSYSTEM: "1" } : {}),
  };
}

function sandboxLiteral(value: string): string {
  if (
    !isAbsolute(value) ||
    value.includes("\u0000") ||
    value.includes("\r") ||
    value.includes("\n") ||
    value.includes('"')
  ) {
    throw new Error("Sandbox path must be an absolute safe literal.");
  }
  return value.replaceAll("\\", "\\\\");
}

export function buildSandboxProfile(
  policy: ProcessExecutionPolicy,
): string {
  const readRoots = [
    ...policy.sandbox.allowedReadRoots,
    ...policy.allowedCwdRoots,
  ];
  const writeRoots = [
    ...policy.sandbox.allowedWriteRoots,
    ...(policy.sandbox.allowHostHome === true
      ? []
      : [policy.sandboxEnvironment.home]),
    policy.sandboxEnvironment.temporaryDirectory,
  ];
  const clauses = [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow sysctl-read)",
    // dyld resolves protected system libraries from the APFS root before
    // descending into the explicitly allowed runtime roots. This permits only
    // that exact bootstrap read; it does not grant recursive root access.
    '(allow file-read-data (literal "/"))',
    ...(policy.sandbox.allowRootMetadata === true
      ? ['(allow file-read-metadata (literal "/"))']
      : []),
    ...readRoots.map(
      (root) => `(allow file-read* (subpath "${sandboxLiteral(root)}"))`,
    ),
    ...(policy.sandbox.allowedReadMetadataRoots ?? []).map(
      (root) =>
        `(allow file-read-metadata (subpath "${sandboxLiteral(root)}"))`,
    ),
    ...(policy.sandbox.allowedReadLiterals ?? []).map(
      (path) => `(allow file-read* (literal "${sandboxLiteral(path)}"))`,
    ),
    ...(policy.sandbox.allowedReadMetadataLiterals ?? []).map(
      (path) =>
        `(allow file-read-metadata (literal "${sandboxLiteral(path)}"))`,
    ),
    ...writeRoots.map(
      (root) => `(allow file-write* (subpath "${sandboxLiteral(root)}"))`,
    ),
    ...(policy.sandbox.allowedWriteLiterals ?? []).map(
      (path) => `(allow file-write* (literal "${sandboxLiteral(path)}"))`,
    ),
  ];
  for (const service of policy.sandbox.allowedMachLookupGlobals ?? []) {
    if (!/^[A-Za-z0-9._@-]{1,192}$/u.test(service)) {
      throw new Error("Sandbox Mach service contains an invalid name.");
    }
    clauses.push(
      `(allow mach-lookup (global-name "${service}"))`,
    );
  }
  if (policy.sandbox.network === "loopback") {
    clauses.push(
      '(allow network-bind (local ip "localhost:*"))',
      '(allow network-outbound (remote ip "localhost:*"))',
    );
  } else if (policy.sandbox.network === "outbound") {
    clauses.push("(allow network-outbound)");
  }
  return clauses.join("\n");
}

export function sandboxProcessRecipe(
  recipe: ProcessRecipe,
  policy: ProcessExecutionPolicy,
  existsFile: (path: string) => boolean = existsSync,
): ProcessRecipe {
  const validated = validateProcessRecipe(recipe, policy);
  if (
    policy.sandbox.executable !== "/usr/bin/sandbox-exec" ||
    !existsFile(policy.sandbox.executable)
  ) {
    throw new Error("Trusted macOS sandbox-exec is unavailable.");
  }
  return Object.freeze({
    executable: policy.sandbox.executable,
    args: Object.freeze([
      "-p",
      buildSandboxProfile(policy),
      validated.executable,
      ...validated.args,
    ]),
    cwd: validated.cwd,
    environment: Object.freeze({
      ...sandboxEnvironment(policy),
      ...validated.environment,
    }),
  });
}

export class ProcessGroupRunner {
  readonly #dependencies: ProcessRunnerDependencies;

  constructor(
    dependencies: Partial<ProcessRunnerDependencies> = defaultDependencies,
  ) {
    this.#dependencies = { ...defaultDependencies, ...dependencies };
  }

  start(
    recipe: ProcessRecipe,
    policy: ProcessExecutionPolicy,
    signal: AbortSignal,
  ): RunningProcessGroup {
    const sandboxed = sandboxProcessRecipe(
      recipe,
      policy,
      this.#dependencies.existsFile,
    );
    const child = this.#dependencies.spawn(
      sandboxed.executable,
      sandboxed.args,
      {
        cwd: sandboxed.cwd,
        detached: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: sandboxed.environment,
      },
    );
    if (child.pid === undefined) {
      throw new Error("Process runner did not receive a child PID.");
    }
    const pid = child.pid;
    let resolved = false;
    let resolveCancelled!: () => void;
    const cancelled = new Promise<void>((resolvePromise) => {
      resolveCancelled = resolvePromise;
    });
    const finish = (): void => {
      if (!resolved) {
        resolved = true;
        resolveCancelled();
      }
    };
    const cancel = (): void => {
      if (resolved) {
        return;
      }
      try {
        this.#dependencies.kill(-pid, "SIGTERM");
      } catch {
        // The process may already have exited.
      }
      const timer = this.#dependencies.setTimer(() => {
        try {
          this.#dependencies.kill(-pid, "SIGKILL");
        } catch {
          // The process may already have exited.
        }
        finish();
      }, 2_000);
      child.once("exit", () => {
        this.#dependencies.clearTimer(timer);
        finish();
      });
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
    }
    return Object.freeze({ child, cancelled, cancel });
  }
}
