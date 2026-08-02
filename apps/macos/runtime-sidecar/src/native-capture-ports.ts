import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readlink,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  type Server,
} from "node:net";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type { CaptureAdapterV1 } from "@memi/capture-import";
import {
  type ContentAddressedArtifactStore,
  EXPO_MAESTRO_CAPTURE_ADAPTER_VERSION,
  type NativeDependencyPreparationApproval,
  type NativeDependencyPreparationInput,
  type NativeDependencyPreparationPlan,
  type NativeCommandPort,
  type NativeCommandResult,
  type BrowserLauncher,
  type PortLease,
  type ProcessExecutionPolicy,
  type ProcessRecipe,
  type ProcessStarter,
  sandboxProcessRecipe,
  type SwiftUIXCUITestEvidence,
  type SwiftUIXCUITestInput,
  type SwiftUIXCUITestPort,
} from "@memi/capture-execution/core";
import type {
  ApprovedBuildRecipe,
  CaptureApplicationUnit,
} from "@memi/capture-platforms";
import type { ImportApplicationV2 } from "@memi/protocol";

import {
  hashExecutable,
  hashValue,
  readBoundedFile,
  type SimulatorSelection,
  validateEvidenceEnvelope,
} from "./native-capture-evidence.js";
import {
  canonicalDirectory,
  canonicalExecutable,
  createNodeWorkerNativeBuildCommandPort,
  createDirectLocalProcessStarter,
  createDirectSimulatorCommandPort,
  createNativeCommandPort,
  createNativeProcessStarter,
  DEFAULT_MAXIMUM_COMMAND_OUTPUT_BYTES,
  DEFAULT_TERMINATION_GRACE_MS,
  defaultNativeDependencies,
  discoverExecutable,
  discoverExecutablePath,
  isContained,
  literalPolicy,
  type NativeCaptureDependencies,
  nonNegativeBoundedInteger,
  positiveBoundedInteger,
  SANDBOX_EXECUTABLE,
} from "./native-capture-process.js";
import {
  createNativeDependencyPreparationAuthority,
  type NativeDependencyPreparationAuthority,
} from "./native-dependency-preparation.js";
import { createReactWebCaptureAdapter } from "./native-capture-react.js";
import {
  createExpoGoCaptureAdapter,
  createExpoStandaloneCaptureAdapter,
  createSwiftUICaptureAdapter,
  localDevelopmentMetroLaunch,
} from "./native-capture-ios.js";
import {
  createManagedSimulatorPorts,
} from "./native-capture-simulator-port.js";
import {
  IOS_CAPTURE_POLICY_AUTHORITY_V3,
} from "./native-capture-policy.js";
import {
  findInstalledSimulatorApplication,
  type InstalledSimulatorApplicationCandidate,
} from "./native-development-client-simulator.js";

export type { NativeCaptureSpawn } from "./native-capture-process.js";
export { createReactWebCaptureAdapter } from "./native-capture-react.js";

/**
 * Development clients are installed in the caller's normal Simulator device
 * set. Unlike Memi-owned build simulators, discovery must retain the caller's
 * CoreSimulator home while granting access to that single data root only.
 */
export function directSimulatorSelectionPolicy(
  executable: string,
  args: readonly string[],
  roots: readonly string[],
  appDataRoot: string,
): ProcessExecutionPolicy {
  const coreSimulatorRoot = join(
    homedir(),
    "Library",
    "Developer",
    "CoreSimulator",
  );
  const base = literalPolicy(executable, args, roots, appDataRoot);
  return Object.freeze({
    ...base,
    sandboxEnvironment: Object.freeze({
      ...base.sandboxEnvironment,
      home: homedir(),
    }),
    sandbox: Object.freeze({
      ...base.sandbox,
      allowedReadRoots: Object.freeze([
        ...base.sandbox.allowedReadRoots,
        coreSimulatorRoot,
      ]),
      allowedWriteRoots: Object.freeze([
        ...base.sandbox.allowedWriteRoots,
        coreSimulatorRoot,
      ]),
      allowHostHome: true as const,
      allowedMachLookupGlobals: IOS_CAPTURE_POLICY_AUTHORITY_V3
        .simulator.machLookupGlobals,
    }),
  });
}

function xcodeDeveloperDirectoryFor(
  xcodebuildExecutable: string,
): string | null {
  const developerDirectory = dirname(dirname(dirname(xcodebuildExecutable)));
  const contentsDirectory = dirname(developerDirectory);
  return (
    basename(developerDirectory) === "Developer" &&
    basename(contentsDirectory) === "Contents" &&
    basename(dirname(contentsDirectory)).endsWith(".app")
  )
    ? developerDirectory
    : null;
}

export interface NativeCaptureToolExecutables {
  readonly node: string;
  readonly cmake: string;
  readonly xcrun: string;
  readonly simctl: string;
  readonly xcodebuild: string;
  readonly maestro: string;
  readonly npm: string;
  readonly npx: string;
  readonly pod: string;
  readonly xcuiRunner: string;
}

export interface NativeCapturePortsOptions {
  readonly appDataRoot: string;
  readonly managedWorktreeRoot: string;
  readonly artifactStore: ContentAddressedArtifactStore;
  readonly runtimeExecutablePath?: string;
  readonly toolExecutables?: Partial<NativeCaptureToolExecutables>;
  readonly maximumCommandOutputBytes?: number;
  readonly terminationGraceMs?: number;
  readonly dependencies?: Partial<NativeCaptureDependencies>;
  readonly executableSearchPath?: string;
  /** Test-only browser injection; production always resolves the Helium launcher. */
  readonly testBrowserLauncher?: BrowserLauncher;
}

export interface NativeCaptureAdapterExecutionContext {
  readonly managedRootPath: string;
  readonly applicationRootPath: string;
  readonly sourceApplicationRootPath?: string;
  readonly repositoryRevision?: string | null;
  readonly dependencyPreparation?:
    | Readonly<{
        readonly plan: NativeDependencyPreparationPlan;
        readonly approval: NativeDependencyPreparationApproval;
      }>
    | null;
}

export interface SimulatorSelectionPort {
  selectBootedIphone(signal: AbortSignal): Promise<SimulatorSelection>;
}

const SIMULATOR_DEVICE_ID_PATTERN =
  /^[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}$/u;

interface ExistingDevelopmentClientSimulatorPortOptions {
  readonly bundleId: string;
  readonly coreSimulatorRoot: string;
  readonly discoverInstalledApplication?: (
    input: Readonly<{
      readonly bundleId: string;
      readonly coreSimulatorRoot: string;
    }>,
  ) => Promise<InstalledSimulatorApplicationCandidate | null>;
  readonly execute: (
    args: readonly string[],
    signal: AbortSignal,
  ) => Promise<NativeCommandResult>;
}

function selectedExistingDevelopmentClientDevice(
  bytes: Uint8Array,
  expectedDeviceId: string,
): Readonly<{
  readonly selection: SimulatorSelection;
  readonly requiresBoot: boolean;
}> {
  if (!SIMULATOR_DEVICE_ID_PATTERN.test(expectedDeviceId)) {
    throw new Error("Installed development client has an invalid simulator identifier.");
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
    readonly devices?: Readonly<
      Record<string, readonly Readonly<{
        readonly name?: unknown;
        readonly udid?: unknown;
        readonly state?: unknown;
        readonly isAvailable?: unknown;
        readonly deviceTypeIdentifier?: unknown;
      }>[]>
    >;
  };
  const selected = Object.entries(parsed.devices ?? {})
    .flatMap(([runtime, devices]) =>
      devices.map((device) => ({ runtime, ...device })))
    .find((device) => device.udid === expectedDeviceId);
  if (
    selected === undefined ||
    selected.isAvailable !== true ||
    typeof selected.name !== "string" ||
    (typeof selected.deviceTypeIdentifier === "string"
      ? !selected.deviceTypeIdentifier.startsWith(
          "com.apple.CoreSimulator.SimDeviceType.iPhone-",
        )
      : !/\biPhone\b/u.test(selected.name)) ||
    (selected.state !== "Booted" && selected.state !== "Shutdown")
  ) {
    throw new Error(
      "The simulator containing the installed development client is unavailable.",
    );
  }
  return Object.freeze({
    selection: Object.freeze({
      deviceId: expectedDeviceId,
      name: selected.name,
      runtime: selected.runtime,
    }),
    requiresBoot: selected.state === "Shutdown",
  });
}

/**
 * Reuse only the iPhone simulator that contains the exact requested bundle.
 * This avoids opening a Buzzr URL in an unrelated booted simulator, and never
 * creates, erases, or deletes a caller-owned device.
 */
export function createExistingDevelopmentClientSimulatorPort(
  options: ExistingDevelopmentClientSimulatorPortOptions,
): SimulatorSelectionPort {
  const discover =
    options.discoverInstalledApplication ?? findInstalledSimulatorApplication;
  return Object.freeze({
    async selectBootedIphone(signal: AbortSignal): Promise<SimulatorSelection> {
      const installed = await discover({
        bundleId: options.bundleId,
        coreSimulatorRoot: options.coreSimulatorRoot,
      });
      if (installed === null) {
        throw new Error(
          `The ${options.bundleId} development client is not installed in an available iPhone simulator.`,
        );
      }
      const listed = await options.execute(
        ["list", "devices", "available", "--json"],
        signal,
      );
      const selected = selectedExistingDevelopmentClientDevice(
        listed.stdout,
        installed.deviceId,
      );
      if (selected.requiresBoot) {
        await options.execute(["boot", installed.deviceId], signal);
        await options.execute(["bootstatus", installed.deviceId, "-b"], signal);
      }
      return selected.selection;
    },
  });
}

export interface XcuiTestPortOptions {
  readonly maximumEvidenceBytes?: number;
}

export interface RecipeApprovalAuthority {
  describe(input: {
    readonly application: ImportApplicationV2;
    readonly unit: CaptureApplicationUnit;
    readonly adapter: CaptureAdapterV1;
    readonly recipe: ApprovedBuildRecipe;
  }): Promise<{
    readonly resolvedExecutable: string;
    readonly environmentFingerprint: `sha256:${string}`;
  }>;
  createNonce(): string;
  expiresAt(now: Date): string;
}

export interface NativeCapturePorts {
  readonly artifactStore: ContentAddressedArtifactStore;
  readonly commandPort: NativeCommandPort;
  /** Only the approved local Expo development-client launch may use this. */
  readonly developmentClientProcessStarter: ProcessStarter;
  readonly processStarter: ProcessStarter;
  readonly portLease: PortLease;
  readonly simulatorPort: SimulatorSelectionPort;
  readonly purgeManagedSimulator: (
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly approvalAuthority: RecipeApprovalAuthority;
  readonly adapterFor: (
    application: ImportApplicationV2,
    unit: CaptureApplicationUnit,
    context: NativeCaptureAdapterExecutionContext,
  ) => CaptureAdapterV1 | null;
  readonly nativeDependencyPreparationFor: (input: {
    readonly application: ImportApplicationV2;
    readonly unit: CaptureApplicationUnit;
    readonly context: Omit<
      NativeCaptureAdapterExecutionContext,
      "dependencyPreparation"
    >;
    readonly adapter: CaptureAdapterV1;
  }) => Promise<NativeDependencyPreparationInput | null>;
  readonly resolveFixture?: undefined;
  readonly executables: Readonly<
    Record<keyof NativeCaptureToolExecutables, string | null>
  >;
  createXcuiTestPort(options?: XcuiTestPortOptions): SwiftUIXCUITestPort;
}

const DEFAULT_MAXIMUM_EVIDENCE_BYTES = 16 * 1_024 * 1_024;

function sourceAnchorsMatch(
  expected: SwiftUIXCUITestInput["scenario"]["sourceAnchor"],
  actual: SwiftUIXCUITestEvidence["sourceAnchor"],
): boolean {
  if (expected === null || actual === null) {
    return expected === actual;
  }
  return (
    expected.relativePath === actual.relativePath &&
    expected.symbol === actual.symbol &&
    expected.contentHash === actual.contentHash
  );
}

interface PortReservation {
  readonly server: Server;
  readonly signal: AbortSignal;
  readonly abort: () => void;
  readonly claimed: boolean;
}

function createPortReservations(): {
  readonly portLease: PortLease;
  claim(args: readonly string[]): void;
} {
  let reservations: Readonly<Record<number, PortReservation>> =
    Object.freeze({});
  const remove = (port: number): void => {
    const { [port]: _removed, ...remaining } = reservations;
    reservations = Object.freeze(remaining);
  };
  const close = (port: number): void => {
    const reservation = reservations[port];
    if (reservation === undefined) {
      return;
    }
    reservation.signal.removeEventListener("abort", reservation.abort);
    if (reservation.server.listening) {
      reservation.server.close();
    }
    remove(port);
  };
  const portLease: PortLease = Object.freeze({
    async acquire(signal: AbortSignal) {
      if (signal.aborted) {
        throw new Error("Loopback lease was cancelled.");
      }
      const port = await new Promise<number>((resolvePromise, reject) => {
        const server = createServer();
        const cancelBeforeListen = (): void => {
          server.close();
          reject(new Error("Loopback lease was cancelled."));
        };
        signal.addEventListener("abort", cancelBeforeListen, { once: true });
        server.once("error", (error) => {
          signal.removeEventListener("abort", cancelBeforeListen);
          reject(error);
        });
        server.listen(
          { host: "127.0.0.1", port: 0, exclusive: true },
          () => {
            signal.removeEventListener("abort", cancelBeforeListen);
            if (signal.aborted) {
              server.close();
              reject(new Error("Loopback lease was cancelled."));
              return;
            }
            const address = server.address();
            if (address === null || typeof address === "string") {
              server.close();
              reject(new Error("Loopback port allocation failed."));
              return;
            }
            const abort = (): void => close(address.port);
            reservations = Object.freeze({
              ...reservations,
              [address.port]: Object.freeze({
                server,
                signal,
                abort,
                claimed: false,
              }),
            });
            signal.addEventListener("abort", abort, { once: true });
            resolvePromise(address.port);
          },
        );
      });
      return port;
    },
    async release(port: number) {
      if (reservations[port] === undefined) {
        throw new Error("Loopback port lease is not active.");
      }
      close(port);
    },
  });
  return Object.freeze({
    portLease,
    claim(args: readonly string[]) {
      const candidate = args
        .filter((argument) => /^\d{1,5}$/u.test(argument))
        .map(Number)
        .find((port) => reservations[port] !== undefined);
      if (candidate === undefined) {
        return;
      }
      const reservation = reservations[candidate]!;
      if (reservation.claimed) {
        throw new Error("Loopback port lease was already claimed.");
      }
      if (reservation.server.listening) {
        reservation.server.close();
      }
      reservations = Object.freeze({
        ...reservations,
        [candidate]: Object.freeze({
          ...reservation,
          claimed: true,
        }),
      });
    },
  });
}

function authorityKey(
  application: ImportApplicationV2,
  unit: CaptureApplicationUnit,
): string {
  return `${application.id}:${unit.cacheKey}`;
}

const OWNED_SIMULATOR_DEVICE_SET_RELATIVE_LINK =
  "../../../../../capture-simulator/device-set";

function missingPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function ensureCanonicalAppDataDirectory(
  appDataRoot: string,
  target: string,
): Promise<void> {
  const relationship = relative(appDataRoot, target);
  if (
    relationship === "" ||
    relationship === ".." ||
    relationship.startsWith(`..${sep}`) ||
    isAbsolute(relationship)
  ) {
    throw new Error(
      "Managed simulator startup directory escapes app data.",
    );
  }
  let current = appDataRoot;
  for (const segment of relationship.split(sep)) {
    current = join(current, segment);
    let metadata = await lstat(current).catch((error: unknown) => {
      if (missingPath(error)) return null;
      throw error;
    });
    if (metadata === null) {
      await mkdir(current, { mode: 0o700 });
      metadata = await lstat(current);
    }
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      realpathSync.native(current) !== current
    ) {
      throw new Error(
        "Managed simulator startup directories must be canonical and non-symbolic.",
      );
    }
  }
}

async function ensureManagedSimulatorDeviceSetPath(input: {
  readonly appDataRoot: string;
  readonly simulatorStateRoot: string;
  readonly simulatorDeviceSetPath: string;
}): Promise<void> {
  if (
    input.simulatorStateRoot !==
      join(input.appDataRoot, "capture-simulator") ||
    input.simulatorDeviceSetPath !== join(
      input.appDataRoot,
      "sandbox",
      "home",
      "Library",
      "Developer",
      "CoreSimulator",
      "Devices",
    )
  ) {
    throw new Error(
      "Managed simulator diagnostic authority is not app-owned.",
    );
  }
  const ownedDeviceSetPath = join(
    input.simulatorStateRoot,
    "device-set",
  );
  const metadata = await lstat(
    input.simulatorDeviceSetPath,
  ).catch((error: unknown) => {
    if (missingPath(error)) return null;
    throw error;
  });
  if (metadata === null) {
    await mkdir(input.simulatorDeviceSetPath, {
      mode: 0o700,
    });
    return;
  }
  if (metadata.isDirectory()) {
    if (
      realpathSync.native(input.simulatorDeviceSetPath) !==
        input.simulatorDeviceSetPath
    ) {
      throw new Error(
        "Managed simulator device set must be a canonical app-owned directory.",
      );
    }
    await chmod(input.simulatorDeviceSetPath, 0o700);
    return;
  }
  if (!metadata.isSymbolicLink()) {
    throw new Error(
      "Managed simulator device set must remain a directory or the exact owned diagnostic link.",
    );
  }
  const declaredTarget = await readlink(
    input.simulatorDeviceSetPath,
  );
  const resolvedDeclaredTarget = resolve(
    dirname(input.simulatorDeviceSetPath),
    declaredTarget,
  );
  if (
    declaredTarget !== OWNED_SIMULATOR_DEVICE_SET_RELATIVE_LINK ||
    resolvedDeclaredTarget !== ownedDeviceSetPath
  ) {
    throw new Error(
      "Managed simulator device set link must target the exact owned simulator path.",
    );
  }
  let ownedMetadata = await lstat(
    ownedDeviceSetPath,
  ).catch((error: unknown) => {
    if (missingPath(error)) return null;
    throw error;
  });
  if (ownedMetadata === null) {
    await mkdir(ownedDeviceSetPath, { mode: 0o700 });
    ownedMetadata = await lstat(ownedDeviceSetPath);
  }
  if (
    ownedMetadata.isSymbolicLink() ||
    !ownedMetadata.isDirectory() ||
    realpathSync.native(ownedDeviceSetPath) !== ownedDeviceSetPath ||
    realpathSync.native(input.simulatorDeviceSetPath) !==
      ownedDeviceSetPath
  ) {
    throw new Error(
      "Managed simulator device set link target must resolve to a canonical owned directory.",
    );
  }
  await chmod(ownedDeviceSetPath, 0o700);
}

export async function createNativeCapturePorts(
  options: NativeCapturePortsOptions,
): Promise<NativeCapturePorts> {
  if (
    options.testBrowserLauncher !== undefined &&
    process.env.NODE_ENV !== "test"
  ) {
    throw new Error("A test browser launcher is unavailable in production.");
  }
  const appDataRoot = await canonicalDirectory(
    options.appDataRoot,
    "Memi app data",
  );
  const managedWorktreeRoot = await canonicalDirectory(
    options.managedWorktreeRoot,
    "Managed worktree",
  );
  const roots = Object.freeze([appDataRoot, managedWorktreeRoot]);
  const simulatorStateRoot = join(appDataRoot, "capture-simulator");
  const simulatorDeviceSetPath = join(
    appDataRoot,
    "sandbox",
    "home",
    "Library",
    "Developer",
    "CoreSimulator",
    "Devices",
  );
  await ensureCanonicalAppDataDirectory(
    appDataRoot,
    join(appDataRoot, "sandbox", "home"),
  );
  await ensureCanonicalAppDataDirectory(
    appDataRoot,
    join(appDataRoot, "sandbox", "tmp"),
  );
  await ensureCanonicalAppDataDirectory(
    appDataRoot,
    simulatorStateRoot,
  );
  await ensureCanonicalAppDataDirectory(
    appDataRoot,
    join(appDataRoot, "native-app-staging"),
  );
  await ensureCanonicalAppDataDirectory(
    appDataRoot,
    dirname(simulatorDeviceSetPath),
  );
  await ensureManagedSimulatorDeviceSetPath({
    appDataRoot,
    simulatorStateRoot,
    simulatorDeviceSetPath,
  });
  const defaults: NativeCaptureToolExecutables = {
    node: "/usr/local/bin/node",
    cmake: join(
      appDataRoot,
      "toolchains",
      "cmake-3.31.6",
      "cmake",
      "data",
      "bin",
      "cmake",
    ),
    xcrun: "/usr/bin/xcrun",
    simctl:
      "/Applications/Xcode.app/Contents/Developer/usr/bin/simctl",
    xcodebuild:
      "/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild",
    maestro: join(appDataRoot, "tools", "maestro"),
    npm: join(appDataRoot, "tools", "npm"),
    npx: join(appDataRoot, "tools", "npx"),
    pod: "/usr/local/bin/pod",
    xcuiRunner: join(
      dirname(options.runtimeExecutablePath ?? process.execPath),
      "memi-xcui-capture",
    ),
  };
  const searchPath =
    options.executableSearchPath ?? process.env.PATH ?? "";
  const requestedNpmExecutable =
    options.toolExecutables?.npm ??
    await discoverExecutablePath(
      "npm",
      searchPath,
      [
        join(homedir(), ".local", "bin", "npm"),
        join(homedir(), ".hermes", "bin", "npm"),
      ],
    );
  const entries = await Promise.all(
    (Object.keys(defaults) as (keyof NativeCaptureToolExecutables)[])
      .map(async (key) => [
        key,
        options.toolExecutables?.[key] === undefined
          ? key === "node" ||
              key === "cmake" ||
              key === "npm" ||
              key === "npx" ||
              key === "pod" ||
              key === "maestro"
            ? await discoverExecutable(
                key,
                searchPath,
                key === "maestro"
                  ? [join(homedir(), ".maestro", "bin", "maestro")]
                  : key === "node"
                    ? [
                        "/opt/homebrew/bin/node",
                        "/usr/local/bin/node",
                      ]
                    : key === "cmake"
                      ? [
                          join(
                            appDataRoot,
                            "toolchains",
                            "cmake-3.31.6",
                            "cmake",
                            "data",
                            "bin",
                            "cmake",
                          ),
                          "/opt/homebrew/bin/cmake",
                          "/usr/local/bin/cmake",
                        ]
                    : key === "pod"
                      ? [
                          "/opt/homebrew/bin/pod",
                          "/usr/local/bin/pod",
                        ]
                  : [
                      join(homedir(), ".local", "bin", key),
                      join(homedir(), ".hermes", "bin", key),
                    ],
              )
            : await canonicalExecutable(defaults[key], false)
          : await canonicalExecutable(options.toolExecutables[key]!, true),
      ] as const),
  );
  const executables = Object.freeze(Object.fromEntries(entries)) as
    NativeCapturePorts["executables"];
  const sandboxExecutable = await canonicalExecutable(
    SANDBOX_EXECUTABLE,
    true,
  );
  if (sandboxExecutable === null) {
    throw new Error("The trusted macOS sandbox executable is unavailable.");
  }
  // Dependency preparation performs a fixed `git --version` provenance check
  // immediately before CocoaPods. Keep that system executable integrity-bound
  // in the same broker allowlist as the approved Node and capture tools.
  const systemGitExecutable = await canonicalExecutable("/usr/bin/git", true);
  if (systemGitExecutable === null) {
    throw new Error("The trusted system Git executable is unavailable.");
  }
  const allowedExecutables = new Set([
    ...Object.values(executables).filter(
      (value): value is string => value !== null,
    ),
    systemGitExecutable,
  ]);
  const executableHashes = Object.freeze(Object.fromEntries(
    await Promise.all(
      [...allowedExecutables, sandboxExecutable]
        .sort((left, right) => left.localeCompare(right))
        .map(async (executable) => [
          executable,
          await hashExecutable(executable),
        ] as const),
    ),
  )) as Readonly<Record<string, `sha256:${string}`>>;
  const toolAuthority = Object.freeze({
    sandbox: Object.freeze({
      path: sandboxExecutable,
      hash: executableHashes[sandboxExecutable],
    }),
    tools: Object.freeze(Object.fromEntries(
      (Object.keys(executables) as (keyof NativeCaptureToolExecutables)[])
        .sort((left, right) => left.localeCompare(right))
        .map((key) => {
          const path = executables[key];
          return [
            key,
            path === null
              ? null
              : Object.freeze({
                path,
                hash: executableHashes[path],
              }),
          ] as const;
        }),
    )),
  });
  const broker = Object.freeze({
    roots,
    allowedExecutables,
    executableHashes,
    sandboxExecutable,
    dependencies: {
      ...defaultNativeDependencies,
      ...options.dependencies,
    },
    maximumOutputBytes: positiveBoundedInteger(
      options.maximumCommandOutputBytes ??
        DEFAULT_MAXIMUM_COMMAND_OUTPUT_BYTES,
      "Maximum native command output",
    ),
    terminationGraceMs: nonNegativeBoundedInteger(
      options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
      "Native process termination grace",
      30_000,
    ),
  });
  const commandPort = createNativeCommandPort(broker);
  let dependencyPreparationAuthority:
    NativeDependencyPreparationAuthority | null = null;
  if (
    executables.node !== null &&
    requestedNpmExecutable !== null
  ) {
    const developerDirectory = executables.xcodebuild === null
      ? null
      : xcodeDeveloperDirectoryFor(executables.xcodebuild);
    dependencyPreparationAuthority =
      await createNativeDependencyPreparationAuthority({
        appDataRoot,
        commandPort,
        nodeExecutable: executables.node,
        npmExecutable: requestedNpmExecutable,
        ...(executables.pod === null
          ? {}
          : { podExecutable: executables.pod }),
        ...(executables.cmake === null
          ? {}
          : { cmakeExecutable: executables.cmake }),
        ...(developerDirectory === null
          ? {}
          : {
              developerDirectory,
            }),
      });
  }
  const nativeProcessStarter = createNativeProcessStarter(broker);
  const directLocalProcessStarter = createDirectLocalProcessStarter(broker);
  const directNativeBuildCommandPort =
    executables.node !== null && executables.xcodebuild !== null
      ? createNodeWorkerNativeBuildCommandPort(broker, {
          nodeExecutable: executables.node,
          nativeBuildExecutable: executables.xcodebuild,
        })
      : undefined;
  const directSimulatorCommandPort = createDirectSimulatorCommandPort(broker);
  const portReservations = createPortReservations();
  const portLease = portReservations.portLease;
  const developmentClientProcessStarter: ProcessStarter = Object.freeze({
    start(
      recipe: ProcessRecipe,
      policy: ProcessExecutionPolicy,
      signal: AbortSignal,
    ) {
      portReservations.claim(recipe.args);
      return directLocalProcessStarter.start(recipe, policy, signal);
    },
  });
  const processStarter: ProcessStarter = Object.freeze({
    start(
      recipe: ProcessRecipe,
      policy: ProcessExecutionPolicy,
      signal: AbortSignal,
    ) {
      portReservations.claim(recipe.args);
      return nativeProcessStarter.start(recipe, policy, signal);
    },
  });
  const requireTool = (
    key: keyof NativeCaptureToolExecutables,
  ): string => {
    const executable = executables[key];
    if (executable === null) {
      throw new Error(`Capture tool ${key} is unavailable.`);
    }
    return executable;
  };
  const {
    simulatorPort,
    purgeManagedSimulator,
    expoGoSimulatorPort,
    releaseManagedSimulator,
    describeManagedSimulatorProfile,
  } = createManagedSimulatorPorts({
    appDataRoot,
    managedWorktreeRoot,
    commandPort,
    simctlExecutable: requireTool("simctl"),
    roots,
  });
  const developmentClientSimulatorPortFor = (
    bundleId: string,
  ): SimulatorSelectionPort =>
    createExistingDevelopmentClientSimulatorPort({
      bundleId,
      coreSimulatorRoot: join(
        homedir(),
        "Library",
        "Developer",
        "CoreSimulator",
      ),
      execute: async (args, signal) => {
        const executable = requireTool("simctl");
        const policy = directSimulatorSelectionPolicy(
          executable,
          args,
          roots,
          appDataRoot,
        );
        return directSimulatorCommandPort.execute(
          { executable, args, cwd: managedWorktreeRoot },
          {
            ...policy,
            sandbox: {
              ...policy.sandbox,
              allowedReadRoots: [
                ...policy.sandbox.allowedReadRoots,
                IOS_CAPTURE_POLICY_AUTHORITY_V3.simulator.xcodeReadRoot,
              ],
            },
          },
          signal,
        );
      },
    });
  let executionAuthorities: Readonly<
    Record<string, NativeCaptureAdapterExecutionContext>
  > = Object.freeze({});
  const approvalAuthority: RecipeApprovalAuthority = Object.freeze({
    async describe(input: Parameters<RecipeApprovalAuthority["describe"]>[0]) {
      const authority =
        executionAuthorities[authorityKey(input.application, input.unit)];
      if (authority === undefined) {
        throw new Error("Approved recipe has no managed execution authority.");
      }
      const requestedCwd = isAbsolute(input.recipe.cwd)
        ? input.recipe.cwd
        : resolve(authority.managedRootPath, input.recipe.cwd);
      let canonicalCwd: string;
      try {
        canonicalCwd = realpathSync.native(requestedCwd);
      } catch {
        throw new Error("Approved recipe cwd does not exist.");
      }
      if (
        canonicalCwd === "/" ||
        canonicalCwd !== resolve(requestedCwd) ||
        !isContained(authority.managedRootPath, canonicalCwd) ||
        !isContained(authority.applicationRootPath, canonicalCwd)
      ) {
        throw new Error("Approved recipe cwd escapes its managed application.");
      }
      const executable = requireTool(input.recipe.executable);
      const simulatorAuthority =
        input.application.platform === "expo-ios" ||
          input.application.platform === "swiftui"
          ? await describeManagedSimulatorProfile(
              new AbortController().signal,
            )
          : null;
      return {
        resolvedExecutable: executable,
        environmentFingerprint: hashValue({
          adapter: input.adapter.metadata,
          applicationId: input.application.id,
          executableHash: await hashExecutable(executable),
          toolAuthority,
          nativePolicyAuthority:
            simulatorAuthority === null
              ? null
              : Object.freeze({
                  policy: IOS_CAPTURE_POLICY_AUTHORITY_V3,
                  deviceSetPath: simulatorDeviceSetPath,
                  runtimeIdentifier:
                    simulatorAuthority.runtimeIdentifier,
                  deviceTypeIdentifier:
                    simulatorAuthority.deviceTypeIdentifier,
                  adapterCapabilities:
                    input.adapter.metadata.capabilities,
                }),
          canonicalCwd,
          recipe: input.recipe,
          platform: process.platform,
          architecture: process.arch,
        }),
      };
    },
    createNonce: () => randomBytes(16).toString("hex"),
    expiresAt: (now: Date) =>
      new Date(now.getTime() + 10 * 60 * 1_000).toISOString(),
  });
  const createXcuiTestPort = (
    portOptions: XcuiTestPortOptions = {},
  ): SwiftUIXCUITestPort => {
    const maximumEvidenceBytes = positiveBoundedInteger(
      portOptions.maximumEvidenceBytes ?? DEFAULT_MAXIMUM_EVIDENCE_BYTES,
      "Maximum XCUITest evidence",
      64 * 1_024 * 1_024,
    );
    return Object.freeze({
      async runScenario(
        input: SwiftUIXCUITestInput,
        signal: AbortSignal,
      ): Promise<SwiftUIXCUITestEvidence> {
        if (
          !/^[A-Za-z0-9._:-]{1,160}$/u.test(input.deviceId) ||
          !/^[A-Za-z0-9.-]{1,255}$/u.test(input.bundleId) ||
          !/^[A-Za-z0-9._-]{1,160}$/u.test(input.launchId)
        ) {
          throw new Error("XCUITest scenario identifiers are invalid.");
        }
        const executable = requireTool("xcuiRunner");
        const runRoot = join(
          appDataRoot,
          "capture-evidence",
          input.launchId,
        );
        await mkdir(runRoot, { recursive: true, mode: 0o700 });
        const inputPath = join(runRoot, "scenario.json");
        const outputPath = join(runRoot, "evidence.json");
        await writeFile(inputPath, JSON.stringify(input), {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
        const args = [
          "--device",
          input.deviceId,
          "--bundle-id",
          input.bundleId,
          "--scenario",
          inputPath,
          "--output",
          outputPath,
        ];
        const helperPolicy = literalPolicy(
          executable,
          args,
          roots,
          appDataRoot,
        );
        const recipe = sandboxProcessRecipe(
          { executable, args, cwd: managedWorktreeRoot },
          {
            ...helperPolicy,
            sandbox: {
              ...helperPolicy.sandbox,
              allowedReadRoots: [
                ...helperPolicy.sandbox.allowedReadRoots,
                "/Applications/Xcode.app",
              ],
              allowedWriteRoots: [appDataRoot],
            },
          },
        );
        await commandPort.execute(recipe, signal);
        const envelope = validateEvidenceEnvelope(
          JSON.parse(new TextDecoder().decode(
            await readBoundedFile(
              outputPath,
              appDataRoot,
              maximumEvidenceBytes,
            ),
          )),
        );
        if (
          !sourceAnchorsMatch(
            input.scenario.sourceAnchor,
            envelope.sourceAnchor,
          )
        ) {
          throw new Error(
            "XCUITest runtime source evidence does not match the scenario.",
          );
        }
        const [hierarchy, geometry] = await Promise.all([
          readBoundedFile(
            envelope.hierarchyPath,
            appDataRoot,
            maximumEvidenceBytes,
          ),
          readBoundedFile(
            envelope.geometryPath,
            appDataRoot,
            maximumEvidenceBytes,
          ),
        ]);
        return Object.freeze({
          route: envelope.route,
          state: envelope.state,
          readinessMatched: envelope.readinessMatched,
          blank: envelope.blank,
          splash: envelope.splash,
          errorBoundary: envelope.errorBoundary,
          hierarchy,
          geometry,
          sourceAnchor: envelope.sourceAnchor,
        });
      },
    });
  };
  const adapterFor = (
    application: ImportApplicationV2,
    unit: CaptureApplicationUnit,
    context: NativeCaptureAdapterExecutionContext,
  ): CaptureAdapterV1 | null => {
    if (unit.status !== "supported") {
      return null;
    }
    let managedRootPath: string;
    let applicationRootPath: string;
    try {
      managedRootPath = realpathSync.native(context.managedRootPath);
      applicationRootPath = realpathSync.native(
        context.applicationRootPath,
      );
    } catch {
      return null;
    }
    if (
      !isContained(managedWorktreeRoot, managedRootPath) ||
      !isContained(managedRootPath, applicationRootPath)
    ) {
      return null;
    }
    executionAuthorities = Object.freeze({
      ...executionAuthorities,
      [authorityKey(application, unit)]: Object.freeze({
        managedRootPath,
        applicationRootPath,
      }),
    });
    if (
      application.platform === "expo-ios" &&
      unit.platform === "expo-ios" &&
      unit.captureConfiguration?.kind === "expo-ios" &&
      executables.simctl !== null &&
      executables.maestro !== null
    ) {
      if (
        (unit.captureConfiguration.runtime === "expo-go" ||
          unit.captureConfiguration.runtime === "development-client") &&
        executables.npx !== null
      ) {
        const dependencyPreparation =
          unit.captureConfiguration.runtime === "development-client"
            ? undefined
            : context.dependencyPreparation === undefined
              ? undefined
              : context.dependencyPreparation === null ||
                  dependencyPreparationAuthority === null
                ? null
                : dependencyPreparationAuthority.hookFor({
                    ...dependencyPreparationAuthority.inputFor({
                      managedWorktreeRoot: managedRootPath,
                      platformRoot: applicationRootPath,
                      repositoryRevision:
                        context.dependencyPreparation.plan.repositoryRevision,
                      // The sealed dependency plan is keyed by adapter metadata
                      // version. Keep the execution-time reconstruction identical
                      // to the planning path; adapter identity is tracked separately.
                      adapterVersion: "1.0.0",
                      workspaceRelativePath: "ios/MemiMetro.xcworkspace",
                    }),
                    approval: context.dependencyPreparation.approval,
                  });
        if (dependencyPreparation === null) {
          return null;
        }
        const developmentClientSimulatorPort =
          unit.captureConfiguration.runtime === "development-client"
            ? unit.captureConfiguration.bundleId === null
              ? null
              : developmentClientSimulatorPortFor(
                  unit.captureConfiguration.bundleId,
                )
            : undefined;
        if (
          unit.captureConfiguration.runtime === "development-client" &&
          developmentClientSimulatorPort === null
        ) {
          return null;
        }
        return createExpoGoCaptureAdapter({
          application,
          unit,
          configuration: unit.captureConfiguration,
          applicationRoot: applicationRootPath,
          appDataRoot,
          nodeExecutable: requireTool("node"),
          npxExecutable: executables.npx,
          simctlExecutable: executables.simctl,
          ...(unit.captureConfiguration.runtime === "development-client"
            ? {
                directSimulator: true as const,
                directSimulatorCommandPort,
              }
            : { simulatorDeviceSetPath }),
          maestroExecutable: executables.maestro,
          artifactStore: options.artifactStore,
          commandPort,
          processStarter:
            unit.captureConfiguration.runtime === "development-client"
              ? developmentClientProcessStarter
              : processStarter,
          portLease,
          simulatorPort:
            unit.captureConfiguration.runtime === "development-client"
              ? developmentClientSimulatorPort!
              : expoGoSimulatorPort,
          ...(unit.captureConfiguration.runtime === "development-client"
            ? {}
            : { releaseDevice: releaseManagedSimulator }),
          ...(dependencyPreparation === undefined
            ? {}
            : { nativeDependencyPreparation: dependencyPreparation }),
          ...(unit.captureConfiguration.runtime === "development-client"
            ? (() => {
                const localMetro = localDevelopmentMetroLaunch(
                  requireTool("node"),
                  context.sourceApplicationRootPath ?? applicationRootPath,
                );
                return localMetro === null
                  ? {}
                  : { localDevelopmentMetroLaunch: localMetro };
              })()
            : {}),
        });
      }
      if (executables.xcodebuild === null) {
        return null;
      }
      const dependencyPreparation =
        context.dependencyPreparation === undefined
          ? undefined
          : context.dependencyPreparation === null ||
              dependencyPreparationAuthority === null
            ? null
            : dependencyPreparationAuthority.hookFor({
                ...dependencyPreparationAuthority.inputFor({
                  managedWorktreeRoot: managedRootPath,
                  platformRoot: applicationRootPath,
                  repositoryRevision:
                    context.dependencyPreparation.plan.repositoryRevision,
                  adapterVersion:
                    EXPO_MAESTRO_CAPTURE_ADAPTER_VERSION,
                  workspaceRelativePath:
                    unit.captureConfiguration.nativeBuild
                      ?.container.kind === "workspace"
                      ? unit.captureConfiguration.nativeBuild
                          .container.relativePath
                      : unit.captureConfiguration.nativeBuild
                          ?.container.relativePath.replace(
                            /\.xcodeproj$/u,
                            ".xcworkspace",
                          ) ?? "ios/unknown.xcworkspace",
                }),
                approval:
                  context.dependencyPreparation.approval,
              });
      if (dependencyPreparation === null) {
        return null;
      }
      return createExpoStandaloneCaptureAdapter({
        application,
        unit,
        configuration: unit.captureConfiguration,
        applicationRoot: applicationRootPath,
        appDataRoot,
        nodeExecutable: requireTool("node"),
        xcodebuildExecutable: executables.xcodebuild,
        simctlExecutable: executables.simctl,
        simulatorDeviceSetPath,
        maestroExecutable: executables.maestro,
        artifactStore: options.artifactStore,
        commandPort,
        ...(directNativeBuildCommandPort === undefined
          ? {}
          : { directNativeBuildCommandPort }),
        simulatorPort,
        ...(dependencyPreparation === undefined
          ? {}
          : { nativeDependencyPreparation: dependencyPreparation }),
      });
    }
    if (
      application.platform === "swiftui" &&
      unit.platform === "swiftui" &&
      unit.captureConfiguration?.kind === "swiftui" &&
      executables.xcodebuild !== null &&
      executables.simctl !== null &&
      executables.xcuiRunner !== null
    ) {
      return createSwiftUICaptureAdapter({
        application,
        unit,
        configuration: unit.captureConfiguration,
        applicationRoot: applicationRootPath,
        appDataRoot,
        xcodebuildExecutable: executables.xcodebuild,
        simctlExecutable: executables.simctl,
        simulatorDeviceSetPath,
        artifactStore: options.artifactStore,
        commandPort,
        simulatorPort,
        xcuiTestPort: createXcuiTestPort(),
      });
    }
    if (
      application.platform !== "react-web" ||
      unit.platform !== "react-web" ||
      unit.buildRecipe?.executable !== "npm"
    ) {
      return null;
    }
    return createReactWebCaptureAdapter({
      application,
      unit,
      managedRootPath,
      applicationRoot: applicationRootPath,
      executable: requireTool("npm"),
      appDataRoot,
      artifactStore: options.artifactStore,
      processStarter,
      portLease,
      ...(options.testBrowserLauncher === undefined
        ? {}
        : { browserLauncher: options.testBrowserLauncher }),
    });
  };
  const nativeDependencyPreparationFor:
    NativeCapturePorts["nativeDependencyPreparationFor"] =
      async ({ application, unit, context, adapter }) => {
        if (
          application.platform !== "expo-ios" ||
          unit.platform !== "expo-ios" ||
          unit.captureConfiguration?.kind !== "expo-ios" ||
          (unit.captureConfiguration.runtime !== "standalone" &&
            unit.captureConfiguration.runtime !== "development-client") ||
          (unit.captureConfiguration.runtime === "standalone" &&
            unit.captureConfiguration.nativeBuild === null) ||
          unit.captureConfiguration.runtime === "development-client" ||
          context.repositoryRevision === null ||
          context.repositoryRevision === undefined ||
          dependencyPreparationAuthority === null ||
          (unit.captureConfiguration.runtime === "standalone"
            ? adapter.metadata.id !== "maestro-expo-ios"
            : adapter.metadata.id !== "expo-development-client-ios")
        ) {
          return null;
        }
        const nativeBuild = unit.captureConfiguration.nativeBuild;
        const workspaceRelativePath =
          nativeBuild!.container.kind === "workspace"
              ? nativeBuild!.container.relativePath
              : nativeBuild!.container.relativePath.replace(
                  /\.xcodeproj$/u,
                  ".xcworkspace",
                );
        return dependencyPreparationAuthority.inputFor({
          managedWorktreeRoot: context.managedRootPath,
          platformRoot: context.applicationRootPath,
          repositoryRevision: context.repositoryRevision,
          adapterVersion: adapter.metadata.version,
          workspaceRelativePath,
        });
      };
  return Object.freeze({
    artifactStore: options.artifactStore,
    commandPort,
    developmentClientProcessStarter,
    processStarter,
    portLease,
    simulatorPort,
    purgeManagedSimulator,
    approvalAuthority,
    adapterFor,
    nativeDependencyPreparationFor,
    executables,
    createXcuiTestPort,
  });
}
