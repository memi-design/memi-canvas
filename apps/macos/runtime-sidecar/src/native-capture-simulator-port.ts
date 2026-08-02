import {
  lstat,
  readlink,
  readdir,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  type NativeCommandPort,
  type ProcessExecutionPolicy,
  type ProcessRecipe,
  sandboxProcessRecipe,
} from "@memi/capture-execution/core";

import type { SimulatorSelection } from "./native-capture-evidence.js";
import {
  SANDBOX_EXECUTABLE,
} from "./native-capture-process.js";
import {
  IOS_CAPTURE_POLICY_AUTHORITY_V3,
  IOS_SIMULATOR_MACH_SERVICES,
} from "./native-capture-policy.js";
import {
  createManagedSimulatorAuthority,
  createManagedSimulatorFileStatePort,
  discoverManagedSimulatorProfile,
  EXPO_GO_BUNDLE_ID,
  MEMI_CAPTURE_SIMULATOR_NAME,
  type ManagedSimulatorAuthority,
  type ManagedSimulatorRecordV1,
  type ManagedSimulatorSelection,
  type ManagedSimulatorStatePort,
} from "./native-capture-simulator.js";

export interface ManagedSimulatorPorts {
  readonly simulatorPort: {
    selectBootedIphone(signal: AbortSignal): Promise<SimulatorSelection>;
  };
  readonly expoGoSimulatorPort: {
    selectBootedIphone(signal: AbortSignal): Promise<SimulatorSelection>;
  };
  readonly releaseManagedSimulator: (
    signal: AbortSignal,
  ) => Promise<void>;
  readonly purgeManagedSimulator: (
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly describeManagedSimulatorProfile: (
    signal: AbortSignal,
  ) => Promise<Readonly<{
    runtimeIdentifier: string;
    deviceTypeIdentifier: string;
  }>>;
}

interface ManagedSimulatorPortsOptions {
  readonly appDataRoot: string;
  readonly managedWorktreeRoot: string;
  readonly commandPort: NativeCommandPort;
  readonly simctlExecutable: string;
  readonly roots: readonly string[];
}

const literal = (value: string) => ({
  kind: "literal" as const,
  value,
});
const safe = () => ({ kind: "safe-token" as const });
const UUID_PATTERN =
  /^[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}$/u;

function managedSimulatorPolicy(
  options: ManagedSimulatorPortsOptions,
): ProcessExecutionPolicy {
  const executable = options.simctlExecutable;
  const deviceSetPath = join(
    options.appDataRoot,
    "sandbox",
    "home",
    "Library",
    "Developer",
    "CoreSimulator",
    "Devices",
  );
  const legacyDeviceSetPath = join(
    options.appDataRoot,
    "capture-simulator",
    "device-set",
  );
  const prefixFor = (path: string) => [
    literal("--set"),
    literal(path),
  ];
  const prefix = prefixFor(deviceSetPath);
  const listCommands = [
    ["runtimes", "available", "--json"],
    ["devicetypes", "--json"],
    ["devices", "available", "--json"],
  ].map((argumentsAfterList) => Object.freeze({
    executable,
    arguments: Object.freeze([
      ...prefix,
      literal("list"),
      ...argumentsAfterList.map(literal),
    ]),
  }));
  const oneDeviceCommands = [
    "boot",
    "shutdown",
    "erase",
    "delete",
  ].map((command) => Object.freeze({
    executable,
    arguments: Object.freeze([
      ...prefix,
      literal(command),
      safe(),
    ]),
  }));
  const purgeCommands = [deviceSetPath, legacyDeviceSetPath].flatMap(
    (path) => {
      const purgePrefix = prefixFor(path);
      return [
        Object.freeze({
          executable,
          arguments: Object.freeze([
            ...purgePrefix,
            literal("list"),
            literal("devices"),
            literal("--json"),
          ]),
        }),
        ...["shutdown", "delete"].map((command) => Object.freeze({
          executable,
          arguments: Object.freeze([
            ...purgePrefix,
            literal(command),
            safe(),
          ]),
        })),
      ];
    },
  );
  return Object.freeze({
    allowedCommands: Object.freeze([
      ...listCommands,
      Object.freeze({
          executable,
          arguments: Object.freeze([
          ...prefix,
          literal("create"),
          literal(MEMI_CAPTURE_SIMULATOR_NAME),
          safe(),
          safe(),
        ]),
      }),
      ...oneDeviceCommands,
      ...purgeCommands,
      Object.freeze({
          executable,
          arguments: Object.freeze([
          ...prefix,
          literal("bootstatus"),
          safe(),
          literal("-b"),
        ]),
      }),
      Object.freeze({
          executable,
          arguments: Object.freeze([
          ...prefix,
          literal("get_app_container"),
          safe(),
          literal(EXPO_GO_BUNDLE_ID),
          literal("app"),
        ]),
      }),
    ]),
    allowedCwdRoots: options.roots,
    sandboxEnvironment: Object.freeze({
      home: resolve(options.appDataRoot, "sandbox/home"),
      temporaryDirectory: resolve(options.appDataRoot, "sandbox/tmp"),
      path: "",
    }),
    sandbox: Object.freeze({
      executable: SANDBOX_EXECUTABLE,
      allowedReadRoots: Object.freeze([
        ...options.roots,
        options.appDataRoot,
        "/System",
        "/Library",
        "/usr",
        IOS_CAPTURE_POLICY_AUTHORITY_V3.simulator.xcodeReadRoot,
      ]),
      allowedWriteRoots: Object.freeze([
        options.appDataRoot,
        ...options.roots,
      ]),
      allowedReadLiterals: Object.freeze(["/dev/null"]),
      allowedWriteLiterals: Object.freeze(["/dev/null"]),
      allowRootMetadata: true,
      allowedMachLookupGlobals: IOS_SIMULATOR_MACH_SERVICES,
      network: "none" as const,
    }),
  });
}

interface OwnedDeviceSet {
  readonly canonicalPath: string;
  readonly diagnosticLink: string | null;
}

interface PurgeDevice {
  readonly deviceId: string;
  readonly name: string;
  readonly runtimeIdentifier: string;
  readonly state: "Booted" | "Shutdown";
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function assertContained(root: string, candidate: string): void {
  const relationship = relative(root, candidate);
  if (
    relationship === "" ||
    relationship === ".." ||
    relationship.startsWith(`..${sep}`) ||
    isAbsolute(relationship)
  ) {
    throw new Error("Managed simulator device set escapes app data.");
  }
}

async function inspectOwnedDeviceSet(
  root: string,
  path: string,
  allowedLinkTarget: string | null,
): Promise<OwnedDeviceSet | null> {
  assertContained(root, path);
  const canonicalRoot = await realpath(root);
  const canonicalPath = resolve(
    canonicalRoot,
    relative(resolve(root), resolve(path)),
  );
  const canonicalAllowedTarget = allowedLinkTarget === null
    ? null
    : resolve(
        canonicalRoot,
        relative(resolve(root), resolve(allowedLinkTarget)),
      );
  let current = canonicalRoot;
  for (const segment of relative(
    canonicalRoot,
    canonicalPath,
  ).split(sep)) {
    current = join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      if (current !== canonicalPath || canonicalAllowedTarget === null) {
        throw new Error(
          "Managed simulator device set may not be symbolic.",
        );
      }
      const declaredTarget = resolve(
        dirname(current),
        await readlink(current),
      );
      if (
        declaredTarget !== canonicalAllowedTarget ||
        (await realpath(current)) !== canonicalAllowedTarget
      ) {
        throw new Error(
          "Managed simulator diagnostic link is not canonical.",
        );
      }
      return Object.freeze({
        canonicalPath: canonicalAllowedTarget,
        diagnosticLink: path,
      });
    }
    if (
      !metadata.isDirectory() ||
      (await realpath(current)) !== current
    ) {
      throw new Error(
        "Managed simulator device set is not canonical.",
      );
    }
  }
  return Object.freeze({
    canonicalPath,
    diagnosticLink: null,
  });
}

function parsePurgeDevices(bytes: Uint8Array): readonly PurgeDevice[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Managed simulator purge inventory is invalid JSON.");
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Managed simulator purge inventory is invalid.");
  }
  const devices = (parsed as Record<string, unknown>).devices;
  if (devices === null || typeof devices !== "object") {
    throw new Error("Managed simulator purge inventory omits devices.");
  }
  const results: PurgeDevice[] = [];
  for (const [runtimeIdentifier, entries] of Object.entries(devices)) {
    if (!Array.isArray(entries)) {
      throw new Error("Managed simulator purge runtime is invalid.");
    }
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object") {
        throw new Error("Managed simulator purge device is invalid.");
      }
      const record = entry as Record<string, unknown>;
      if (
        record.isAvailable !== true ||
        typeof record.name !== "string" ||
        typeof record.udid !== "string" ||
        !UUID_PATTERN.test(record.udid) ||
        (record.state !== "Booted" && record.state !== "Shutdown")
      ) {
        throw new Error(
          "Managed simulator purge device evidence is invalid.",
        );
      }
      results.push(Object.freeze({
        deviceId: record.udid,
        name: record.name,
        runtimeIdentifier,
        state: record.state,
      }));
    }
  }
  return Object.freeze(results);
}

function persistedDeviceId(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Partial<ManagedSimulatorRecordV1>;
  return (
    record.version === 1 &&
    record.deviceName === MEMI_CAPTURE_SIMULATOR_NAME &&
    typeof record.deviceId === "string" &&
    UUID_PATTERN.test(record.deviceId)
  ) ? record.deviceId : null;
}

function selection(
  managed: ManagedSimulatorSelection,
): SimulatorSelection {
  return Object.freeze({
    deviceId: managed.deviceId,
    name: managed.deviceName,
    runtime: managed.runtimeIdentifier,
  });
}

export function createManagedSimulatorPorts(
  options: ManagedSimulatorPortsOptions,
): ManagedSimulatorPorts {
  let managedSimulator: ManagedSimulatorAuthority | null = null;
  let pendingSimulator: Promise<ManagedSimulatorAuthority> | null = null;
  const policy = managedSimulatorPolicy(options);
  const deviceSetPath = join(
    options.appDataRoot,
    "sandbox",
    "home",
    "Library",
    "Developer",
    "CoreSimulator",
    "Devices",
  );
  const simulatorStateRoot = join(
    options.appDataRoot,
    "capture-simulator",
  );
  const legacyDeviceSetPath = join(
    simulatorStateRoot,
    "device-set",
  );
  const statePort: ManagedSimulatorStatePort =
    createManagedSimulatorFileStatePort({
      root: options.appDataRoot,
      path: join(simulatorStateRoot, "authority.json"),
    });
  const authorizeRecipe = (recipe: ProcessRecipe): ProcessRecipe =>
    sandboxProcessRecipe(recipe, policy);
  const profile = (signal: AbortSignal) =>
    discoverManagedSimulatorProfile({
      commandPort: options.commandPort,
      simctlExecutable: options.simctlExecutable,
      deviceSetPath,
      cwd: options.managedWorktreeRoot,
      authorizeRecipe,
      signal,
    });

  const authority = async (
    signal: AbortSignal,
  ): Promise<ManagedSimulatorAuthority> => {
    if (managedSimulator !== null) {
      return managedSimulator;
    }
    if (pendingSimulator === null) {
      pendingSimulator = profile(signal).then((profile) =>
        createManagedSimulatorAuthority({
          commandPort: options.commandPort,
          simctlExecutable: options.simctlExecutable,
          deviceSetPath,
          cwd: options.managedWorktreeRoot,
          runtimeIdentifier: profile.runtimeIdentifier,
          deviceTypeIdentifier: profile.deviceTypeIdentifier,
          statePort,
          authorizeRecipe,
        }),
      ).then((value) => {
        managedSimulator = value;
        return value;
      }).finally(() => {
        pendingSimulator = null;
      });
    }
    return pendingSimulator;
  };

  const executePurgeCommand = async (
    args: readonly string[],
    signal: AbortSignal,
  ) => options.commandPort.execute(authorizeRecipe({
    executable: options.simctlExecutable,
    args: [
      "--set",
      legacyDeviceSetPath,
      ...args,
    ],
    cwd: options.managedWorktreeRoot,
  }), signal);

  const purgeLegacyOwnedDeviceSet = async (
    signal: AbortSignal,
  ): Promise<boolean | null> => {
    const ownedSet = await inspectOwnedDeviceSet(
      options.appDataRoot,
      legacyDeviceSetPath,
      null,
    );
    if (ownedSet === null) return null;
    const devices = parsePurgeDevices(
      (await executePurgeCommand(
        ["list", "devices", "--json"],
        signal,
      )).stdout,
    );
    if (
      devices.length > 1 ||
      devices.some((device) =>
        device.name !== MEMI_CAPTURE_SIMULATOR_NAME)
    ) {
      throw new Error(
        "Managed simulator purge set is not exclusively Memi-owned.",
      );
    }
    const device = devices[0];
    const loaded = await statePort.load();
    const persistedId = persistedDeviceId(loaded);
    if (loaded !== null && persistedId === null) {
      throw new Error("Managed simulator purge authority is invalid.");
    }
    if (
      device !== undefined &&
      persistedId !== null &&
      persistedId !== device.deviceId
    ) {
      throw new Error(
        "Managed simulator purge authority contradicts its exact UDID.",
      );
    }
    if (device?.state === "Booted") {
      await executePurgeCommand(
        ["shutdown", device.deviceId],
        signal,
      );
    }
    if (device !== undefined) {
      await executePurgeCommand(
        ["delete", device.deviceId],
        signal,
      );
    }
    await statePort.clear();
    if ((await readdir(ownedSet.canonicalPath)).length !== 0) {
      throw new Error(
        "Managed simulator device set was not empty after deletion.",
      );
    }
    await rmdir(ownedSet.canonicalPath);
    if (ownedSet.diagnosticLink !== null) {
      await unlink(ownedSet.diagnosticLink);
    }
    if ((await readdir(simulatorStateRoot)).length === 0) {
      await rmdir(simulatorStateRoot);
    }
    return device !== undefined;
  };

  return Object.freeze({
    describeManagedSimulatorProfile: profile,
    simulatorPort: Object.freeze({
      async selectBootedIphone(signal: AbortSignal) {
        return selection(await (await authority(signal)).acquire(signal));
      },
    }),
    expoGoSimulatorPort: Object.freeze({
      async selectBootedIphone(signal: AbortSignal) {
        const simulator = await authority(signal);
        const selected = await simulator.resetForExpoGo(signal);
        const args = [
          "simctl",
          "get_app_container",
          selected.deviceId,
          EXPO_GO_BUNDLE_ID,
          "app",
        ];
        try {
          await options.commandPort.execute(
            authorizeRecipe({
              executable: options.simctlExecutable,
              args: [
                "--set",
                deviceSetPath,
                ...args.slice(1),
              ],
              cwd: options.managedWorktreeRoot,
            }),
            signal,
          );
        } catch {
          await simulator.cleanup(new AbortController().signal);
          throw new Error(
            "EXPO_GO_NOT_INSTALLED: install a trusted Expo Go build in the Memi capture simulator before capture.",
          );
        }
        return selection(selected);
      },
    }),
    async releaseManagedSimulator(_signal: AbortSignal) {
      if (managedSimulator !== null) {
        await managedSimulator.cleanup(new AbortController().signal);
      }
    },
    async purgeManagedSimulator(signal: AbortSignal) {
      try {
        const removedLegacy = await purgeLegacyOwnedDeviceSet(signal);
        if (removedLegacy !== null) return removedLegacy;
        if (managedSimulator === null) {
          const simulator = await authority(signal);
          return await simulator.delete(signal);
        }
        return await managedSimulator.delete(signal);
      } finally {
        managedSimulator = null;
        pendingSimulator = null;
      }
    },
  });
}
