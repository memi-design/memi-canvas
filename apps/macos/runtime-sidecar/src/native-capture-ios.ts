import { createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { CaptureAdapterV1 } from "@memi/capture-import";
import {
  CaptureExecutionError,
  type ContentAddressedArtifactStore,
  ExpoGoCaptureAdapter,
  type LocalDevelopmentMetroLaunch,
  ExpoMaestroCaptureAdapter,
  type AttestedMaestroFlow,
  type ExpoNativeDependencyPreparation,
  type NativeDependencyPreparationPlan,
  type DirectNativeBuildCommandPort,
  type NativeBuildConfiguration,
  type NativeCommandPort,
  type NativeCommandResult,
  type PortLease,
  type ProcessCommandRule,
  type ProcessArgumentRule,
  type ProcessExecutionPolicy,
  type ProcessRecipe,
  type ProcessStarter,
  sandboxProcessRecipe,
  SwiftUIXCUITestCaptureAdapter,
  type SwiftUIXCUITestPort,
} from "@memi/capture-execution/core";
import type {
  CaptureApplicationUnit,
  ExpoIOSCaptureConfiguration,
  IOSNativeBuildConfiguration,
  SwiftUICaptureConfiguration,
} from "@memi/capture-platforms";
import type { ImportApplicationV2 } from "@memi/protocol";

import { SANDBOX_EXECUTABLE } from "./native-capture-process.js";
import {
  prestageManagedExpoHermesXCFramework,
} from "./expo-cocoapods-normalization.js";
import type { SimulatorSelectionPort } from "./native-capture-ports.js";
import { readBoundedFile } from "./native-capture-evidence.js";
import {
  IOS_BUILD_MACH_SERVICES,
  IOS_CAPTURE_POLICY_AUTHORITY_V3,
  IOS_GENERIC_SIMULATOR_DESTINATION,
  IOS_SIMULATOR_MACH_SERVICES,
  IOS_EXPO_USER_SCRIPT_SANDBOX_SETTING,
  IOS_SWIFTUI_USER_SCRIPT_SANDBOX_SETTING,
} from "./native-capture-policy.js";
import { waitForLoopback } from "./native-capture-react.js";

export interface ExpoStandaloneAdapterAuthority {
  readonly application: ImportApplicationV2;
  readonly unit: CaptureApplicationUnit;
  readonly configuration: ExpoIOSCaptureConfiguration;
  readonly applicationRoot: string;
  readonly appDataRoot: string;
  /** Canonical Node runtime used by the generated Xcode script phases. */
  readonly nodeExecutable: string;
  readonly xcodebuildExecutable: string;
  readonly simctlExecutable: string;
  readonly simulatorDeviceSetPath: string;
  readonly maestroExecutable: string;
  readonly artifactStore: ContentAddressedArtifactStore;
  readonly commandPort: NativeCommandPort;
  /** Xcode needs a direct, but still exact-recipe validated, process route. */
  readonly directNativeBuildCommandPort?: DirectNativeBuildCommandPort;
  readonly simulatorPort: SimulatorSelectionPort;
  readonly nativeDependencyPreparation?:
    ExpoNativeDependencyPreparation;
}

export interface ExpoGoAdapterAuthority {
  readonly application: ImportApplicationV2;
  readonly unit: CaptureApplicationUnit;
  readonly configuration: ExpoIOSCaptureConfiguration;
  readonly applicationRoot: string;
  readonly appDataRoot: string;
  /** Canonical Node runtime that executes the trusted npx CLI. */
  readonly nodeExecutable: string;
  readonly npxExecutable: string;
  readonly simctlExecutable: string;
  readonly simulatorDeviceSetPath?: string;
  readonly maestroExecutable: string;
  readonly artifactStore: ContentAddressedArtifactStore;
  readonly commandPort: NativeCommandPort;
  readonly processStarter: ProcessStarter;
  readonly portLease: PortLease;
  readonly simulatorPort: SimulatorSelectionPort;
  readonly releaseDevice?: (signal: AbortSignal) => Promise<void>;
  readonly directSimulator?: true;
  /**
   * Narrowly scoped direct executor for an already-installed development
   * client. It is the only simulator route allowed to retain the login
   * session CoreSimulator requires; all other capture commands use the normal
   * sandboxed command port.
   */
  readonly directSimulatorCommandPort?: Readonly<{
    execute(
      recipe: ProcessRecipe,
      policy: ProcessExecutionPolicy,
      signal: AbortSignal,
    ): Promise<NativeCommandResult>;
  }>;
  readonly nativeDependencyPreparation?: ExpoNativeDependencyPreparation;
  readonly waitForMetro?: (
    statusUrl: string,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly localDevelopmentMetroLaunch?: LocalDevelopmentMetroLaunch;
}

export interface SwiftUIAdapterAuthority {
  readonly application: ImportApplicationV2;
  readonly unit: CaptureApplicationUnit;
  readonly configuration: SwiftUICaptureConfiguration;
  readonly applicationRoot: string;
  readonly appDataRoot: string;
  readonly xcodebuildExecutable: string;
  readonly simctlExecutable: string;
  readonly simulatorDeviceSetPath: string;
  readonly artifactStore: ContentAddressedArtifactStore;
  readonly commandPort: NativeCommandPort;
  readonly simulatorPort: SimulatorSelectionPort;
  readonly xcuiTestPort: SwiftUIXCUITestPort;
}

const literal = (value: string): ProcessArgumentRule => ({
  kind: "literal",
  value,
});

const MAXIMUM_SIMULATOR_SCREENSHOT_BYTES = 24 * 1_024 * 1_024;
const safe = (): ProcessArgumentRule => ({ kind: "safe-token" });

function nativeBuild(
  root: string,
  configuration: IOSNativeBuildConfiguration,
  expectedBundleId: string,
): NativeBuildConfiguration {
  return Object.freeze({
    container: Object.freeze({
      kind: configuration.container.kind,
      path: resolve(root, configuration.container.relativePath),
    }),
    scheme: configuration.scheme,
    configuration: configuration.configuration,
    derivedDataPath: resolve(root, configuration.derivedDataRelativePath),
    expectedBundleId,
    simulatorArchitecture: "arm64",
  });
}

function contained(root: string, candidate: string): boolean {
  const relationship = relative(resolve(root), resolve(candidate));
  return (
    relationship === "" ||
    (relationship !== ".." &&
      !relationship.startsWith(`..${sep}`) &&
      !isAbsolute(relationship))
  );
}

function attestedStandaloneFlows(
  authority: ExpoStandaloneAdapterAuthority,
): Readonly<Record<string, AttestedMaestroFlow>> {
  const { configuration } = authority;
  const bundleId = configuration.bundleId;
  if (bundleId === null) {
    return Object.freeze({});
  }
  const mapped = new Map<string, AttestedMaestroFlow>();
  for (const flow of configuration.maestroFlows) {
    if (
      flow.captureRoutePath === null ||
      flow.captureRouteId === null ||
      flow.appId !== bundleId
    ) {
      continue;
    }
    const absolutePath = resolve(authority.applicationRoot, flow.relativePath);
    if (!contained(authority.applicationRoot, absolutePath)) {
      throw new Error("Maestro flow escaped the managed application root.");
    }
    const metadata = lstatSync(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Maestro flow must be a regular managed application file.");
    }
    const actualHash = `sha256:${createHash("sha256")
      .update(readFileSync(absolutePath))
      .digest("hex")}` as const;
    if (actualHash !== flow.contentHash) {
      throw new Error("Maestro flow no longer matches the discovered content hash.");
    }
    if (mapped.has(flow.captureRoutePath)) {
      throw new Error(
        "Multiple Maestro flows target one capture route; explicit flow selection is required.",
      );
    }
    mapped.set(
      flow.captureRoutePath,
      Object.freeze({
        relativePath: flow.relativePath,
        contentHash: flow.contentHash,
      }),
    );
  }
  return Object.freeze(Object.fromEntries(mapped));
}

function trustedNodeRuntimeRoot(executable: string): string {
  return dirname(dirname(resolve(executable)));
}

function nativeBuildPath(executable: string): string {
  return `${dirname(resolve(executable))}:/usr/bin:/bin`;
}

export function resolvedNativeBuildSetting(
  output: Uint8Array,
  key: string,
): string {
  const matches = [...new TextDecoder().decode(output).matchAll(
    new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "gmu"),
  )];
  const values = [...new Set(matches.map((match) => match[1]!.trim()))];
  if (values.length !== 1) {
    throw new CaptureExecutionError(
      "prepare-fixtures",
      "NATIVE_BUILD_SETTING_INVALID",
      false,
      `Expected exactly one distinct ${key} setting from Xcode.`,
    );
  }
  const value = values[0]!;
  if (!isAbsolute(value)) {
    throw new CaptureExecutionError(
      "prepare-fixtures",
      "NATIVE_BUILD_SETTING_INVALID",
      false,
      `${key} must resolve to an absolute managed path.`,
    );
  }
  return value;
}

function managedHermesXCFrameworkPreparer(
  authority: ExpoStandaloneAdapterAuthority,
) {
  return Object.freeze({
    async prepare(input: Readonly<{
      nativeBuild: NativeBuildConfiguration;
      buildSettingsOutput: Uint8Array;
      sourceRevision: string | null;
      nativeDependencyPreparationPlan: NativeDependencyPreparationPlan | null;
      signal: AbortSignal;
    }>): Promise<void> {
      if (input.signal.aborted) {
        throw new Error("Capture was cancelled.");
      }
      if (input.sourceRevision === null) {
        throw new CaptureExecutionError(
          "validate",
          "SOURCE_REVISION_MISSING",
          false,
          "Hermes pre-stage requires a verified source revision.",
        );
      }
      if (input.nativeDependencyPreparationPlan === null) {
        throw new CaptureExecutionError(
          "prepare-fixtures",
          "NATIVE_DEPENDENCY_PREPARATION_MISSING",
          false,
          "Hermes pre-stage requires the approved dependency preparation plan.",
        );
      }
      const preparationFingerprint =
        input.nativeDependencyPreparationPlan.fingerprint;
      if (!/^sha256:[a-f0-9]{64}$/u.test(preparationFingerprint)) {
        throw new CaptureExecutionError(
          "prepare-fixtures",
          "NATIVE_DEPENDENCY_PREPARATION_MISSING",
          false,
          "Hermes pre-stage received an invalid dependency preparation fingerprint.",
        );
      }
      const xcframeworksBuildDirectory = resolvedNativeBuildSetting(
        input.buildSettingsOutput,
        "PODS_XCFRAMEWORKS_BUILD_DIR",
      );
      if (
        !contained(input.nativeBuild.derivedDataPath, xcframeworksBuildDirectory) ||
        !contained(authority.applicationRoot, xcframeworksBuildDirectory)
      ) {
        throw new CaptureExecutionError(
          "prepare-fixtures",
          "NATIVE_BUILD_SETTING_INVALID",
          false,
          "PODS_XCFRAMEWORKS_BUILD_DIR escaped the managed derived-data path.",
        );
      }
      await prestageManagedExpoHermesXCFramework({
        managedWorktreeRoot: authority.applicationRoot,
        platformRoot: authority.applicationRoot,
        repositoryRevision: input.sourceRevision,
        preparationFingerprint: preparationFingerprint as `sha256:${string}`,
        xcframeworksBuildDirectory,
      });
    },
  });
}

// Xcode resolves the SDK-to-simulator mapping from this user-owned cache
// before it can select the generic simulator destination. It is not source
// authority and is read-only here, so grant the single file rather than the
// surrounding Xcode user-data directory.
const XCODE_SIMULATOR_MAPPING_PATH = join(
  homedir(),
  "Library",
  "Developer",
  "Xcode",
  "SDKToSimulatorIndexMapping.plist",
);

/**
 * Node resolves executable and entry-point paths a segment at a time. The
 * capture worktree can live under /private while the app data directory lives
 * under a user home. Grant metadata only to those ancestors; never recursive
 * read access outside the declared capture roots.
 */
function metadataAncestors(path: string): readonly string[] {
  const ancestors: string[] = [];
  let current = resolve(path);
  while (true) {
    const parent = dirname(current);
    if (parent === current) {
      return Object.freeze(ancestors);
    }
    if (parent !== "/") {
      ancestors.push(parent);
    }
    current = parent;
  }
}

function xcodeRules(
  executable: string,
  build: NativeBuildConfiguration,
  userScriptSandboxSetting: string,
) {
  const containerFlag =
    build.container.kind === "project" ? "-project" : "-workspace";
  const common = [
    literal(containerFlag),
    literal(build.container.path),
    literal("-scheme"),
    literal(build.scheme),
    literal("-configuration"),
    literal(build.configuration),
    literal("-sdk"),
    literal("iphonesimulator"),
    literal("-jobs"),
    literal("1"),
  ];
  return [
    {
      executable,
      arguments: [
        ...common,
        literal("-destination"),
        literal(IOS_GENERIC_SIMULATOR_DESTINATION),
        literal("-derivedDataPath"),
        literal(build.derivedDataPath),
        literal(userScriptSandboxSetting),
        literal(`ARCHS=${build.simulatorArchitecture ?? "arm64"}`),
        literal("build"),
      ],
    },
    {
      executable,
      arguments: [
        ...common,
        literal("-destination"),
        literal(IOS_GENERIC_SIMULATOR_DESTINATION),
        literal("-derivedDataPath"),
        literal(build.derivedDataPath),
        literal(userScriptSandboxSetting),
        literal(`ARCHS=${build.simulatorArchitecture ?? "arm64"}`),
        literal("-showBuildSettings"),
      ],
    },
  ];
}

function nativePolicy(
  authority: ExpoStandaloneAdapterAuthority,
  build: NativeBuildConfiguration,
): ProcessExecutionPolicy {
  const nodeRuntimeRoot = trustedNodeRuntimeRoot(authority.nodeExecutable);
  return Object.freeze({
    allowedCommands: Object.freeze([
      ...xcodeRules(
        authority.xcodebuildExecutable,
        build,
        IOS_EXPO_USER_SCRIPT_SANDBOX_SETTING,
      ),
      {
        executable: authority.maestroExecutable,
        arguments: [safe(), literal("test"), safe()],
      },
      {
        executable: authority.maestroExecutable,
        arguments: [safe(), literal("hierarchy"), literal("--compact")],
      },
    ]),
    allowedCwdRoots: Object.freeze([
      authority.applicationRoot,
      authority.appDataRoot,
    ]),
    sandboxEnvironment: Object.freeze({
      home: resolve(authority.appDataRoot, "sandbox/home"),
      temporaryDirectory: resolve(authority.appDataRoot, "sandbox/tmp"),
      path: nativeBuildPath(authority.nodeExecutable),
    }),
    sandbox: Object.freeze({
      executable: SANDBOX_EXECUTABLE,
      allowedReadRoots: Object.freeze([
        authority.applicationRoot,
        authority.appDataRoot,
        nodeRuntimeRoot,
        dirname(authority.xcodebuildExecutable),
        dirname(authority.maestroExecutable),
        "/System",
        "/Library",
        "/usr",
        IOS_CAPTURE_POLICY_AUTHORITY_V3.build.xcodeReadRoot,
      ]),
      allowedWriteRoots: Object.freeze([
        authority.applicationRoot,
      ]),
      allowedReadLiterals:
        [
          ...IOS_CAPTURE_POLICY_AUTHORITY_V3.build.readLiterals,
          XCODE_SIMULATOR_MAPPING_PATH,
        ],
      allowedReadMetadataLiterals:
        IOS_CAPTURE_POLICY_AUTHORITY_V3.build.metadataLiterals,
      allowedWriteLiterals:
        IOS_CAPTURE_POLICY_AUTHORITY_V3.build.writeLiterals,
      allowedMachLookupGlobals: IOS_BUILD_MACH_SERVICES,
      network: "none" as const,
    }),
  });
}

/**
 * XcodeBuildService and CoreSimulator resolve their per-user service state
 * from HOME before the build begins. The direct native route is already
 * restricted to exact Xcode recipes; give only that route the host session,
 * while Maestro and every other capture command keep the managed sandbox home.
 */
function directNativeBuildPolicy(
  authority: ExpoStandaloneAdapterAuthority,
  build: NativeBuildConfiguration,
): ProcessExecutionPolicy {
  const base = nativePolicy(authority, build);
  const hostHome = homedir();
  return Object.freeze({
    ...base,
    sandboxEnvironment: Object.freeze({
      ...base.sandboxEnvironment,
      home: hostHome,
    }),
    sandbox: Object.freeze({
      ...base.sandbox,
      allowedReadRoots: Object.freeze([
        ...base.sandbox.allowedReadRoots,
        hostHome,
      ]),
      allowedWriteRoots: Object.freeze([
        ...base.sandbox.allowedWriteRoots,
        hostHome,
      ]),
      allowHostHome: true as const,
    }),
  });
}

function expoGoPolicy(
  authority: ExpoGoAdapterAuthority,
): ProcessExecutionPolicy {
  const metro = authority.configuration.metro;
  if (metro === null) {
    throw new Error("Expo Metro capture requires a declared Metro authority.");
  }
  const nodeRuntimeRoot = trustedNodeRuntimeRoot(authority.nodeExecutable);
  const localDependencyRoot = authority.localDevelopmentMetroLaunch?.dependencyRoot;
  return Object.freeze({
    allowedCommands: Object.freeze([
      {
        executable: authority.npxExecutable,
        arguments: [
          ...metro.args.map(literal),
          literal("--port"),
          {
            kind: "integer" as const,
            minimum: 1,
            maximum: 65_535,
          },
        ],
      },
      ...(authority.localDevelopmentMetroLaunch === undefined
        ? []
        : [{
            executable: authority.localDevelopmentMetroLaunch.executable,
            arguments: [
              literal(authority.localDevelopmentMetroLaunch.cliPath),
              literal("start"),
              literal("--dev-client"),
              literal("--localhost"),
              literal("--port"),
              {
                kind: "integer" as const,
                minimum: 1,
                maximum: 65_535,
              },
            ],
          }]),
      {
        executable: authority.maestroExecutable,
        arguments: [safe(), literal("test"), safe()],
      },
      {
        executable: authority.maestroExecutable,
        arguments: [safe(), literal("hierarchy"), literal("--compact")],
      },
    ]),
    allowedCwdRoots: Object.freeze([
      authority.applicationRoot,
      authority.appDataRoot,
    ]),
    ...(localDependencyRoot === undefined
      ? {}
      : { allowedEnvironmentKeys: ["NODE_PATH"] }),
    sandboxEnvironment: Object.freeze({
      home: resolve(authority.appDataRoot, "sandbox/home"),
      temporaryDirectory: resolve(authority.appDataRoot, "sandbox/tmp"),
      path: nativeBuildPath(authority.nodeExecutable),
    }),
    sandbox: Object.freeze({
      executable: SANDBOX_EXECUTABLE,
      allowedReadRoots: Object.freeze([
        authority.applicationRoot,
        authority.appDataRoot,
        ...(localDependencyRoot === undefined ? [] : [localDependencyRoot]),
        nodeRuntimeRoot,
        dirname(authority.npxExecutable),
        dirname(authority.maestroExecutable),
        "/System",
        "/Library",
        "/usr",
      ]),
      allowedReadMetadataRoots: Object.freeze([
        dirname(homedir()),
        ...metadataAncestors(authority.applicationRoot),
        ...metadataAncestors(authority.appDataRoot),
      ]),
      // /bin/sh resolves through this protected macOS selector when npx starts
      // Expo. It is an exact system executable literal, not a writable path.
      allowedReadLiterals: Object.freeze(["/private/var/select/sh"]),
      allowedWriteRoots: Object.freeze([
        authority.applicationRoot,
        authority.appDataRoot,
      ]),
      network: "loopback" as const,
    }),
  });
}

type SimulatorPolicyAuthority =
  | ExpoStandaloneAdapterAuthority
  | ExpoGoAdapterAuthority
  | SwiftUIAdapterAuthority;

async function selectCaptureSimulator(
  port: SimulatorSelectionPort,
  signal: AbortSignal,
) {
  try {
    return await port.selectBootedIphone(signal);
  } catch (error) {
    if (error instanceof CaptureExecutionError) {
      throw error;
    }
    throw new CaptureExecutionError(
      "launch",
      "SIMULATOR_UNAVAILABLE",
      true,
      error,
    );
  }
}

/**
 * A development client is installed in the caller's existing Simulator device
 * set, unlike Expo Go and standalone builds which use Memi's owned set. The
 * direct path is deliberately limited to CoreSimulator state: it never grants
 * a capture process access to the source checkout outside its managed worktree.
 */
export function simulatorPolicy(
  authority: SimulatorPolicyAuthority,
  commands: readonly ProcessCommandRule[],
): ProcessExecutionPolicy {
  const directSimulator =
    "directSimulator" in authority && authority.directSimulator === true;
  const coreSimulatorRoot = join(
    homedir(),
    "Library",
    "Developer",
    "CoreSimulator",
  );
  return Object.freeze({
    allowedCommands: Object.freeze([...commands]),
    allowedCwdRoots: Object.freeze([
      authority.applicationRoot,
      authority.appDataRoot,
    ]),
    sandboxEnvironment: Object.freeze({
      home: directSimulator
        ? homedir()
        : resolve(authority.appDataRoot, "sandbox/home"),
      temporaryDirectory: resolve(authority.appDataRoot, "sandbox/tmp"),
      path: "",
    }),
    sandbox: Object.freeze({
      executable: SANDBOX_EXECUTABLE,
      allowedReadRoots: Object.freeze([
        authority.applicationRoot,
        authority.appDataRoot,
        "/System",
        "/Library",
        "/usr",
        IOS_CAPTURE_POLICY_AUTHORITY_V3.simulator.xcodeReadRoot,
        ...(directSimulator ? [coreSimulatorRoot] : []),
      ]),
      allowedWriteRoots: Object.freeze([
        authority.appDataRoot,
        ...(directSimulator ? [coreSimulatorRoot] : []),
      ]),
      ...(directSimulator ? { allowHostHome: true as const } : {}),
      allowedReadLiterals:
        IOS_CAPTURE_POLICY_AUTHORITY_V3.simulator.deviceLiterals,
      allowedWriteLiterals:
        IOS_CAPTURE_POLICY_AUTHORITY_V3.simulator.deviceLiterals,
      allowRootMetadata: true,
      allowedMachLookupGlobals: IOS_SIMULATOR_MACH_SERVICES,
      network: "none" as const,
    }),
  });
}

function simctlRule(
  authority: SimulatorPolicyAuthority,
  argumentsAfterSet: readonly ProcessArgumentRule[],
): ProcessCommandRule {
  return Object.freeze({
    executable: authority.simctlExecutable,
    arguments: Object.freeze([
      ...("directSimulator" in authority && authority.directSimulator === true
        ? []
        : [
            literal("--set"),
            literal(authority.simulatorDeviceSetPath!),
          ]),
      ...argumentsAfterSet,
    ]),
  });
}

/**
 * `simctl io screenshot` writes to a path rather than consistently emitting
 * PNG bytes on stdout. Keep that transient path inside Memi app data, read it
 * through the bounded no-follow evidence reader, and remove it immediately.
 */
function simulatorScreenshotCapture(authority: ExpoGoAdapterAuthority) {
  return async (
    input: Readonly<{ readonly deviceId: string }>,
    signal: AbortSignal,
  ): Promise<Uint8Array> => {
    const evidenceRoot = resolve(authority.appDataRoot, "capture-evidence");
    const screenshotPath = resolve(
      evidenceRoot,
      `simctl-${randomBytes(13).toString("hex")}.png`,
    );
    await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
    const policy = simulatorPolicy(authority, [
      simctlRule(authority, [
        literal("io"),
        safe(),
        literal("screenshot"),
        literal("--type=png"),
        literal(screenshotPath),
      ]),
    ]);
    const recipe: ProcessRecipe = Object.freeze({
      executable: authority.simctlExecutable,
      args: Object.freeze([
        "io",
        input.deviceId,
        "screenshot",
        "--type=png",
        screenshotPath,
      ]),
      cwd: authority.applicationRoot,
    });
    try {
      if (
        authority.directSimulator === true &&
        authority.directSimulatorCommandPort !== undefined
      ) {
        await authority.directSimulatorCommandPort.execute(recipe, policy, signal);
      } else {
        await authority.commandPort.execute(
          sandboxProcessRecipe(recipe, policy),
          signal,
        );
      }
      return await readSettledEvidenceFile({
        read: () => readBoundedFile(
          screenshotPath,
          authority.appDataRoot,
          MAXIMUM_SIMULATOR_SCREENSHOT_BYTES,
        ),
        signal,
      });
    } finally {
      await rm(screenshotPath, { force: true });
    }
  };
}

export interface SettledEvidenceReadOptions {
  readonly read: () => Promise<Uint8Array>;
  readonly signal: AbortSignal;
  readonly attempts?: number;
  readonly settleDelayMs?: number;
  readonly wait?: (
    milliseconds: number,
    signal: AbortSignal,
  ) => Promise<void>;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every(
    (value, index) => value === right[index],
  );
}

function waitForEvidenceFile(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (signal.aborted) {
      reject(new Error("Native command was cancelled."));
      return;
    }
    const timer = setTimeout(resolvePromise, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Native command was cancelled."));
    }, { once: true });
  });
}

/**
 * `simctl` can report success just before its PNG writer is fully quiescent.
 * Re-read the same bounded, no-follow file until two reads agree; this never
 * samples a new simulator frame and therefore cannot hide runtime motion.
 */
export async function readSettledEvidenceFile(
  options: SettledEvidenceReadOptions,
): Promise<Uint8Array> {
  const attempts = options.attempts ?? 4;
  let current = await options.read();
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    await (options.wait ?? waitForEvidenceFile)(
      options.settleDelayMs ?? 25,
      options.signal,
    );
    const next = await options.read();
    if (sameBytes(current, next)) return next;
    current = next;
  }
  throw new Error("Simulator screenshot file did not settle after capture.");
}

/**
 * Managed Expo instrumentation writes its signed attestation to the simulator
 * pasteboard. Read that bounded runtime evidence separately from Maestro's
 * accessibility hierarchy, which never contains clipboard text.
 */
function simulatorRuntimeEvidenceCapture(authority: ExpoGoAdapterAuthority) {
  return async (
    input: Readonly<{ readonly deviceId: string }>,
    signal: AbortSignal,
  ): Promise<Uint8Array> => {
    const policy = simulatorPolicy(authority, [
      simctlRule(authority, [literal("pbpaste"), safe()]),
    ]);
    const recipe: ProcessRecipe = Object.freeze({
      executable: authority.simctlExecutable,
      args: Object.freeze(["pbpaste", input.deviceId]),
      cwd: authority.applicationRoot,
    });
    if (
      authority.directSimulator === true &&
      authority.directSimulatorCommandPort !== undefined
    ) {
      const result = await authority.directSimulatorCommandPort.execute(
        recipe,
        policy,
        signal,
      );
      return result.stdout;
    }
    const result = await authority.commandPort.execute(
      sandboxProcessRecipe(recipe, policy),
      signal,
    );
    return result.stdout;
  };
}

/**
 * Capture must not mistake intentional continuous motion for unstable runtime
 * output. Enable iOS Reduce Motion for the managed session only, then restore
 * the simulator's prior setting during adapter cleanup.
 */
function simulatorAnimationFreeze(authority: ExpoGoAdapterAuthority) {
  return async (
    input: Readonly<{ readonly deviceId: string }>,
    signal: AbortSignal,
  ): Promise<(restoreSignal: AbortSignal) => Promise<void>> => {
    const execute = async (
      args: readonly string[],
      commandSignal: AbortSignal,
    ): Promise<NativeCommandResult> => {
      const policy = simulatorPolicy(authority, [
        simctlRule(authority, args.map((value) => literal(value))),
      ]);
      const recipe: ProcessRecipe = Object.freeze({
        executable: authority.simctlExecutable,
        args: Object.freeze([...args]),
        cwd: authority.applicationRoot,
      });
      if (
        authority.directSimulator === true &&
        authority.directSimulatorCommandPort !== undefined
      ) {
        return authority.directSimulatorCommandPort.execute(
          recipe,
          policy,
          commandSignal,
        );
      }
      return authority.commandPort.execute(
        sandboxProcessRecipe(recipe, policy),
        commandSignal,
      );
    };
    const settingArguments = [
      "spawn",
      input.deviceId,
      "defaults",
      "read",
      "com.apple.Accessibility",
      "ReduceMotionEnabled",
    ] as const;
    const current = new TextDecoder().decode(
      (await execute(settingArguments, signal)).stdout,
    ).trim();
    if (current !== "0" && current !== "1") {
      throw new Error("Simulator Reduce Motion setting was not readable.");
    }
    if (current === "1") return async () => undefined;
    await execute([
      "spawn",
      input.deviceId,
      "defaults",
      "write",
      "com.apple.Accessibility",
      "ReduceMotionEnabled",
      "-bool",
      "YES",
    ], signal);
    return async (restoreSignal) => {
      await execute([
        "spawn",
        input.deviceId,
        "defaults",
        "write",
        "com.apple.Accessibility",
        "ReduceMotionEnabled",
        "-bool",
        "NO",
      ], restoreSignal);
    };
  };
}

export function createExpoGoCaptureAdapter(
  authority: ExpoGoAdapterAuthority,
): CaptureAdapterV1 | null {
  const configuration = authority.configuration;
  if (
    (configuration.runtime !== "expo-go" &&
      configuration.runtime !== "development-client") ||
    (configuration.runtime === "expo-go" && configuration.bundleId !== null) ||
    (configuration.runtime === "development-client" &&
      (configuration.bundleId === null || configuration.scheme === null)) ||
    configuration.nativeBuild !== null ||
    configuration.metro === null ||
    configuration.metro.executable !== "npx" ||
    (configuration.runtime === "expo-go" &&
      configuration.metro.routeAuthority !== "expo-go-project-url") ||
    (configuration.runtime === "development-client" &&
      configuration.metro.routeAuthority !==
        "expo-development-client-url")
  ) {
    return null;
  }
  const flowByRoute = Object.fromEntries(
    configuration.maestroFlows.flatMap((flow) =>
      flow.mapping === "route" && flow.routePath !== null
        ? [[flow.routePath, flow.relativePath] as const]
        : []),
  );
  return new ExpoGoCaptureAdapter({
    applications: [authority.application],
    managedWorktreeRoot: authority.applicationRoot,
    projectRoot: authority.applicationRoot,
    metro:
      configuration.metro.routeAuthority === "expo-go-project-url"
        ? {
            executable: authority.npxExecutable,
            args: configuration.metro.args,
            appId: configuration.metro.appId,
            routeAuthority: "expo-go-project-url",
          }
        : {
            executable: authority.npxExecutable,
            args: configuration.metro.args,
            appId: configuration.metro.appId,
            routeAuthority: "expo-development-client-url",
            scheme: configuration.metro.scheme,
            routeScheme: configuration.scheme!,
          },
    deviceResolver: (signal) =>
      selectCaptureSimulator(authority.simulatorPort, signal),
    simctlExecutable: authority.simctlExecutable,
    ...(authority.directSimulator === true
      ? {
          directSimulator: true as const,
          ...(authority.directSimulatorCommandPort === undefined
            ? {}
            : {
                directSimulatorCommandPort:
                  authority.directSimulatorCommandPort,
              }),
        }
      : { simulatorDeviceSetPath: authority.simulatorDeviceSetPath! }),
    maestroExecutable: authority.maestroExecutable,
    artifactStore: authority.artifactStore,
    commandPort: authority.commandPort,
    processStarter: authority.processStarter,
    processPolicy: expoGoPolicy(authority),
    simulatorProcessPolicy: simulatorPolicy(authority, [
      simctlRule(authority, [
        literal("openurl"),
        safe(),
        configuration.metro.routeAuthority === "expo-go-project-url"
          ? { kind: "expo-project-url" as const }
          : {
              kind: "expo-development-client-url" as const,
              scheme: configuration.metro.scheme,
            },
      ]),
      ...(configuration.metro.routeAuthority ===
      "expo-development-client-url"
        ? [simctlRule(authority, [
            literal("openurl"),
            safe(),
            {
              kind: "expo-standalone-url" as const,
              scheme: configuration.scheme!,
            },
          ])]
        : []),
      simctlRule(authority, [
        literal("io"),
        safe(),
        literal("screenshot"),
        literal("--type=png"),
        literal("-"),
      ]),
      simctlRule(authority, [
        literal("terminate"),
        safe(),
        literal(configuration.metro.appId),
      ]),
    ]),
    portLease: authority.portLease,
    ...(authority.releaseDevice
      ? { releaseDevice: authority.releaseDevice }
      : {}),
    waitForMetro: authority.waitForMetro ?? waitForLoopback,
    captureSimulatorScreenshot: simulatorScreenshotCapture(authority),
    readSimulatorRuntimeEvidence: simulatorRuntimeEvidenceCapture(authority),
    ...(configuration.runtime === "development-client"
      ? { freezeSimulatorAnimations: simulatorAnimationFreeze(authority) }
      : {}),
    flowByRoute,
    ...(authority.nativeDependencyPreparation === undefined
      ? {}
      : { nativeDependencyPreparation: authority.nativeDependencyPreparation }),
    ...(configuration.runtime === "development-client"
      ? { managedRuntimeInstrumentation: true as const }
      : {}),
    ...(authority.localDevelopmentMetroLaunch === undefined
      ? {}
      : { localDevelopmentMetroLaunch: authority.localDevelopmentMetroLaunch }),
  });
}

export function localDevelopmentMetroLaunch(
  nodeExecutable: string,
  applicationRoot: string,
): LocalDevelopmentMetroLaunch | null {
  try {
    const canonicalRoot = realpathSync.native(applicationRoot);
    const dependencyRoot = realpathSync.native(
      resolve(canonicalRoot, "node_modules"),
    );
    const candidate = resolve(dependencyRoot, "expo", "bin", "cli");
    const canonical = realpathSync.native(candidate);
    if (
      !lstatSync(canonical).isFile() ||
      !contained(dependencyRoot, canonical)
    ) {
      return null;
    }
    return Object.freeze({
      executable: nodeExecutable,
      cliPath: canonical,
      dependencyRoot,
      environment: Object.freeze({ NODE_PATH: dependencyRoot }),
    });
  } catch {
    return null;
  }
}

export function createExpoStandaloneCaptureAdapter(
  authority: ExpoStandaloneAdapterAuthority,
): CaptureAdapterV1 | null {
  const configuration = authority.configuration;
  if (
    configuration.runtime !== "standalone" ||
    configuration.nativeBuild === null ||
    configuration.bundleId === null
  ) {
    return null;
  }
  const build = nativeBuild(
    authority.applicationRoot,
    configuration.nativeBuild,
    configuration.bundleId,
  );
  const flowByRoute = attestedStandaloneFlows(authority);
  return new ExpoMaestroCaptureAdapter({
    applications: [authority.application],
    managedWorktreeRoot: authority.applicationRoot,
    stagingRoot: join(authority.appDataRoot, "native-app-staging"),
    runtime: "standalone",
    scheme: configuration.scheme,
    managedRuntimeInstrumentation: true,
    nativeBuild: build,
    deviceResolver: (signal) =>
      selectCaptureSimulator(authority.simulatorPort, signal),
    xcodebuildExecutable: authority.xcodebuildExecutable,
    simctlExecutable: authority.simctlExecutable,
    simulatorDeviceSetPath: authority.simulatorDeviceSetPath,
    maestroExecutable: authority.maestroExecutable,
    artifactStore: authority.artifactStore,
    commandPort: authority.commandPort,
    ...(authority.directNativeBuildCommandPort === undefined
      ? {}
      : {
          directNativeBuildCommandPort: authority.directNativeBuildCommandPort,
          nativeBuildProcessPolicy: directNativeBuildPolicy(authority, build),
        }),
    processPolicy: nativePolicy(authority, build),
    ...(authority.nativeDependencyPreparation === undefined
      ? {}
      : {
          nativeDependencyPreparation:
            authority.nativeDependencyPreparation,
          nativeBuildPreparer: managedHermesXCFrameworkPreparer(authority),
        }),
    simulatorProcessPolicy: simulatorPolicy(authority, [
      simctlRule(authority, [
        literal("install"),
        safe(),
        safe(),
      ]),
      simctlRule(authority, [
        literal("launch"),
        literal("--terminate-running-process"),
        safe(),
        safe(),
      ]),
      simctlRule(authority, [
        literal("openurl"),
        safe(),
        {
          kind: "expo-standalone-url",
          scheme: configuration.scheme ?? "",
        },
      ]),
      simctlRule(authority, [
        literal("pbpaste"),
        safe(),
      ]),
      simctlRule(authority, [
        literal("io"),
        safe(),
        literal("screenshot"),
        literal("--type=png"),
        literal("-"),
      ]),
      simctlRule(authority, [
        literal("terminate"),
        safe(),
        safe(),
      ]),
    ]),
    flowByRoute,
  });
}

export function createSwiftUICaptureAdapter(
  authority: SwiftUIAdapterAuthority,
): CaptureAdapterV1 {
  const configuration = authority.configuration;
  const build = Object.freeze({
    container: Object.freeze({
      kind: configuration.container.kind,
      path: resolve(
        authority.applicationRoot,
        configuration.container.relativePath,
      ),
    }),
    scheme: configuration.scheme,
    configuration: "Debug" as const,
    derivedDataPath: resolve(
      authority.applicationRoot,
      configuration.derivedDataRelativePath,
    ),
    expectedBundleId: null,
  });
  const processPolicy: ProcessExecutionPolicy = Object.freeze({
    allowedCommands: Object.freeze([
      ...xcodeRules(
        authority.xcodebuildExecutable,
        build,
        IOS_SWIFTUI_USER_SCRIPT_SANDBOX_SETTING,
      ),
    ]),
    allowedCwdRoots: Object.freeze([
      authority.applicationRoot,
      authority.appDataRoot,
    ]),
    sandboxEnvironment: Object.freeze({
      home: resolve(authority.appDataRoot, "sandbox/home"),
      temporaryDirectory: resolve(authority.appDataRoot, "sandbox/tmp"),
      path: "",
    }),
    sandbox: Object.freeze({
      executable: SANDBOX_EXECUTABLE,
      allowedReadRoots: Object.freeze([
        authority.applicationRoot,
        authority.appDataRoot,
        dirname(authority.xcodebuildExecutable),
        "/System",
        "/Library",
        "/usr",
        IOS_CAPTURE_POLICY_AUTHORITY_V3.build.xcodeReadRoot,
      ]),
      allowedWriteRoots: Object.freeze([
        authority.applicationRoot,
      ]),
      allowedReadLiterals:
        IOS_CAPTURE_POLICY_AUTHORITY_V3.build.readLiterals,
      allowedReadMetadataLiterals:
        IOS_CAPTURE_POLICY_AUTHORITY_V3.build.metadataLiterals,
      allowedWriteLiterals:
        IOS_CAPTURE_POLICY_AUTHORITY_V3.build.writeLiterals,
      allowedMachLookupGlobals: IOS_BUILD_MACH_SERVICES,
      network: "none" as const,
    }),
  });
  return new SwiftUIXCUITestCaptureAdapter({
    applications: [authority.application],
    managedWorktreeRoot: authority.applicationRoot,
    stagingRoot: join(authority.appDataRoot, "native-app-staging"),
    nativeBuild: build,
    deviceResolver: (signal) =>
      selectCaptureSimulator(authority.simulatorPort, signal),
    xcodebuildExecutable: authority.xcodebuildExecutable,
    simctlExecutable: authority.simctlExecutable,
    simulatorDeviceSetPath: authority.simulatorDeviceSetPath,
    artifactStore: authority.artifactStore,
    commandPort: authority.commandPort,
    processPolicy,
    simulatorProcessPolicy: simulatorPolicy(authority, [
      simctlRule(authority, [
        literal("install"),
        safe(),
        safe(),
      ]),
      simctlRule(authority, [
        literal("launch"),
        literal("--terminate-running-process"),
        safe(),
        safe(),
      ]),
      simctlRule(authority, [
        literal("io"),
        safe(),
        literal("screenshot"),
        literal("--type=png"),
        literal("-"),
      ]),
      simctlRule(authority, [
        literal("terminate"),
        safe(),
        safe(),
      ]),
    ]),
    xcuiTestPort: authority.xcuiTestPort,
  });
}
