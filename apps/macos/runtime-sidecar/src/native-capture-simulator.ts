import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  open,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import type {
  NativeCommandPort,
  ProcessRecipe,
} from "@memi/capture-execution";

export const MEMI_CAPTURE_SIMULATOR_NAME =
  "Memi Canvas Capture iPhone";
export const EXPO_GO_BUNDLE_ID = "host.exp.Exponent";

const RECORD_VERSION = 1;
const UUID_PATTERN =
  /^[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}$/u;
const RUNTIME_PATTERN =
  /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9]+(?:-[0-9]+)*$/u;
const DEVICE_TYPE_PATTERN =
  /^com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-[A-Za-z0-9-]+$/u;

export interface ManagedSimulatorRecordV1 {
  readonly version: 1;
  readonly deviceId: string;
  readonly deviceName: typeof MEMI_CAPTURE_SIMULATOR_NAME;
  readonly runtimeIdentifier: string;
  readonly deviceTypeIdentifier: string;
}

export interface ManagedSimulatorStatePort {
  load(): Promise<unknown>;
  save(record: ManagedSimulatorRecordV1): Promise<void>;
  clear(): Promise<void>;
}

export interface ManagedSimulatorSelection {
  readonly deviceId: string;
  readonly deviceName: typeof MEMI_CAPTURE_SIMULATOR_NAME;
  readonly runtimeIdentifier: string;
  readonly deviceTypeIdentifier: string;
  readonly reused: boolean;
}

export interface ManagedSimulatorAuthority {
  acquire(signal: AbortSignal): Promise<ManagedSimulatorSelection>;
  /**
   * Cold boots the managed simulator while preserving installed applications,
   * including Expo Go.
   */
  resetForExpoGo(
    signal: AbortSignal,
  ): Promise<ManagedSimulatorSelection>;
  /**
   * Erases simulator contents and boots it for a new Expo Go installation.
   */
  eraseAndBoot(
    signal: AbortSignal,
  ): Promise<ManagedSimulatorSelection>;
  /**
   * Shuts down the managed simulator if it exists. It never creates a device.
   */
  cleanup(signal: AbortSignal): Promise<boolean>;
  /**
   * Deletes the managed simulator and clears its persisted authority.
   */
  delete(signal: AbortSignal): Promise<boolean>;
}

export interface ManagedSimulatorAuthorityOptions {
  readonly commandPort: NativeCommandPort;
  readonly simctlExecutable: string;
  readonly deviceSetPath: string;
  readonly cwd: string;
  readonly runtimeIdentifier: string;
  readonly deviceTypeIdentifier: string;
  readonly statePort: ManagedSimulatorStatePort;
  /**
   * Applies the caller-owned process policy and sandbox to a structured simctl
   * recipe before execution.
   */
  readonly authorizeRecipe: (recipe: ProcessRecipe) => ProcessRecipe;
}

export interface ManagedSimulatorProfile {
  readonly runtimeIdentifier: string;
  readonly deviceTypeIdentifier: string;
}

export interface ManagedSimulatorProfileDiscoveryOptions {
  readonly commandPort: NativeCommandPort;
  readonly simctlExecutable: string;
  readonly deviceSetPath: string;
  readonly cwd: string;
  readonly authorizeRecipe: (recipe: ProcessRecipe) => ProcessRecipe;
  readonly signal: AbortSignal;
}

interface ListedDevice {
  readonly deviceId: string;
  readonly name: string;
  readonly runtimeIdentifier: string;
  readonly state: "Booted" | "Shutdown";
}

interface LocatedManagedDevice {
  readonly device: ListedDevice;
  readonly persisted: ManagedSimulatorRecordV1 | null;
}

class ManagedSimulatorAbortError extends Error {
  override readonly name = "AbortError";

  constructor() {
    super("The managed simulator operation was cancelled.");
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ManagedSimulatorAbortError();
  }
}

function contained(root: string, candidate: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return (
    fromRoot === "" ||
    (
      fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot)
    )
  );
}

function validateSimctlAuthority(
  simctlExecutable: string,
  deviceSetPath: string,
  cwd: string,
): void {
  if (!isAbsolute(simctlExecutable)) {
    throw new Error("simctl executable must be an absolute path.");
  }
  if (basename(simctlExecutable) !== "simctl") {
    throw new Error("Managed simulator commands require direct simctl.");
  }
  if (!isAbsolute(deviceSetPath) || resolve(deviceSetPath) === "/") {
    throw new Error("Managed simulator device set must be absolute.");
  }
  if (!isAbsolute(cwd) || resolve(cwd) === "/") {
    throw new Error(
      "Managed working directory must be absolute and contained.",
    );
  }
}

function validateOptions(
  options: ManagedSimulatorAuthorityOptions,
): void {
  validateSimctlAuthority(
    options.simctlExecutable,
    options.deviceSetPath,
    options.cwd,
  );
  if (!RUNTIME_PATTERN.test(options.runtimeIdentifier)) {
    throw new Error("CoreSimulator runtime identifier is invalid.");
  }
  if (!DEVICE_TYPE_PATTERN.test(options.deviceTypeIdentifier)) {
    throw new Error("CoreSimulator device type identifier is invalid.");
  }
}

function numericVersion(value: string): readonly number[] {
  if (!/^\d+(?:\.\d+)*$/u.test(value)) {
    return Object.freeze([]);
  }
  return Object.freeze(value.split(".").map(Number));
}

function compareVersions(left: string, right: string): number {
  const leftParts = numericVersion(left);
  const rightParts = numericVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export async function discoverManagedSimulatorProfile(
  options: ManagedSimulatorProfileDiscoveryOptions,
): Promise<ManagedSimulatorProfile> {
  validateSimctlAuthority(
    options.simctlExecutable,
    options.deviceSetPath,
    options.cwd,
  );
  const execute = async (args: readonly string[]): Promise<unknown> => {
    throwIfAborted(options.signal);
    const result = await options.commandPort.execute(
      options.authorizeRecipe(Object.freeze({
        executable: options.simctlExecutable,
        args: Object.freeze([
          "--set",
          options.deviceSetPath,
          ...args,
        ]),
        cwd: resolve(options.cwd),
      })),
      options.signal,
    );
    throwIfAborted(options.signal);
    try {
      return JSON.parse(new TextDecoder().decode(result.stdout));
    } catch {
      throw new Error("CoreSimulator profile inventory is invalid JSON.");
    }
  };
  const [runtimeValue, deviceTypeValue] = await Promise.all([
    execute(["list", "runtimes", "available", "--json"]),
    execute(["list", "devicetypes", "--json"]),
  ]);
  const runtimeRecords =
    runtimeValue !== null &&
    typeof runtimeValue === "object" &&
    Array.isArray((runtimeValue as Record<string, unknown>).runtimes)
      ? (runtimeValue as { runtimes: readonly unknown[] }).runtimes
      : [];
  const runtimes = runtimeRecords.flatMap((value) => {
    if (value === null || typeof value !== "object") {
      return [];
    }
    const record = value as Record<string, unknown>;
    return record.isAvailable === true &&
      typeof record.identifier === "string" &&
      RUNTIME_PATTERN.test(record.identifier) &&
      typeof record.version === "string" &&
      numericVersion(record.version).length > 0
      ? [{
          identifier: record.identifier,
          version: record.version,
        }]
      : [];
  }).sort((left, right) =>
    compareVersions(left.version, right.version));
  const deviceTypeRecords =
    deviceTypeValue !== null &&
    typeof deviceTypeValue === "object" &&
    Array.isArray(
      (deviceTypeValue as Record<string, unknown>).devicetypes,
    )
      ? (deviceTypeValue as { devicetypes: readonly unknown[] }).devicetypes
      : [];
  const deviceTypes = deviceTypeRecords.flatMap((value) => {
    if (value === null || typeof value !== "object") {
      return [];
    }
    const record = value as Record<string, unknown>;
    return record.productFamily === "iPhone" &&
      typeof record.name === "string" &&
      /^iPhone \d+(?: .+)?$/u.test(record.name) &&
      typeof record.identifier === "string" &&
      DEVICE_TYPE_PATTERN.test(record.identifier)
      ? [{
          identifier: record.identifier,
          name: record.name,
          generation: Number(/\d+/u.exec(record.name)?.[0] ?? 0),
        }]
      : [];
  }).sort((left, right) =>
    right.generation - left.generation ||
    right.name.localeCompare(left.name));
  const runtime = runtimes[0];
  const deviceType = deviceTypes[0];
  if (runtime === undefined || deviceType === undefined) {
    throw new Error(
      "No supported available iOS runtime and iPhone device type were found.",
    );
  }
  return Object.freeze({
    runtimeIdentifier: runtime.identifier,
    deviceTypeIdentifier: deviceType.identifier,
  });
}

export function createManagedSimulatorFileStatePort(input: {
  readonly root: string;
  readonly path: string;
}): ManagedSimulatorStatePort {
  if (
    !isAbsolute(input.root) ||
    resolve(input.root) === "/" ||
    !isAbsolute(input.path) ||
    !contained(input.root, input.path)
  ) {
    throw new Error(
      "Managed simulator state path must be contained in app data.",
    );
  }
  const verifyParent = async (): Promise<void> => {
    const [canonicalRoot, canonicalParent] = await Promise.all([
      realpath(input.root),
      realpath(dirname(input.path)),
    ]);
    if (!contained(canonicalRoot, canonicalParent)) {
      throw new Error("Managed simulator state parent escapes app data.");
    }
  };
  return Object.freeze({
    async load() {
      await verifyParent();
      let handle;
      try {
        handle = await open(
          input.path,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return null;
        }
        throw error;
      }
      try {
        const metadata = await handle.stat();
        if (!metadata.isFile() || metadata.size > 4_096) {
          throw new Error("Managed simulator state is invalid.");
        }
        return JSON.parse(await handle.readFile("utf8")) as unknown;
      } finally {
        await handle.close();
      }
    },
    async save(record: ManagedSimulatorRecordV1) {
      await verifyParent();
      const temporaryPath = `${input.path}.${randomBytes(8).toString("hex")}.tmp`;
      const handle = await open(
        temporaryPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(JSON.stringify(record), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, input.path);
    },
    async clear() {
      await verifyParent();
      await rm(input.path, { force: true });
    },
  });
}

function isRecord(
  value: unknown,
  options: ManagedSimulatorAuthorityOptions,
): value is ManagedSimulatorRecordV1 {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.version === RECORD_VERSION &&
    typeof record.deviceId === "string" &&
    UUID_PATTERN.test(record.deviceId) &&
    record.deviceName === MEMI_CAPTURE_SIMULATOR_NAME &&
    record.runtimeIdentifier === options.runtimeIdentifier &&
    record.deviceTypeIdentifier === options.deviceTypeIdentifier
  );
}

function parseListedDevices(bytes: Uint8Array): readonly ListedDevice[] {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("CoreSimulator device inventory is not valid JSON.");
  }
  if (value === null || typeof value !== "object") {
    throw new Error("CoreSimulator device inventory is invalid.");
  }
  const devices = (value as Record<string, unknown>).devices;
  if (devices === null || typeof devices !== "object") {
    throw new Error("CoreSimulator device inventory omits devices.");
  }
  const parsed: ListedDevice[] = [];
  for (const [runtimeIdentifier, entries] of Object.entries(devices)) {
    if (!Array.isArray(entries)) {
      throw new Error("CoreSimulator runtime device list is invalid.");
    }
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object") {
        throw new Error("CoreSimulator device entry is invalid.");
      }
      const record = entry as Record<string, unknown>;
      if (record.isAvailable !== true) {
        continue;
      }
      if (
        typeof record.name !== "string" ||
        typeof record.udid !== "string" ||
        !UUID_PATTERN.test(record.udid) ||
        (record.state !== "Booted" && record.state !== "Shutdown")
      ) {
        throw new Error(
          "Available CoreSimulator device evidence is invalid.",
        );
      }
      parsed.push(Object.freeze({
        deviceId: record.udid,
        name: record.name,
        runtimeIdentifier,
        state: record.state,
      }));
    }
  }
  return Object.freeze(parsed);
}

function recordFor(
  deviceId: string,
  options: ManagedSimulatorAuthorityOptions,
): ManagedSimulatorRecordV1 {
  return Object.freeze({
    version: RECORD_VERSION,
    deviceId,
    deviceName: MEMI_CAPTURE_SIMULATOR_NAME,
    runtimeIdentifier: options.runtimeIdentifier,
    deviceTypeIdentifier: options.deviceTypeIdentifier,
  });
}

function selectionFor(
  deviceId: string,
  reused: boolean,
  options: ManagedSimulatorAuthorityOptions,
): ManagedSimulatorSelection {
  return Object.freeze({
    deviceId,
    deviceName: MEMI_CAPTURE_SIMULATOR_NAME,
    runtimeIdentifier: options.runtimeIdentifier,
    deviceTypeIdentifier: options.deviceTypeIdentifier,
    reused,
  });
}

export function createManagedSimulatorAuthority(
  options: ManagedSimulatorAuthorityOptions,
): ManagedSimulatorAuthority {
  validateOptions(options);
  const statePort = options.statePort;
  let tail: Promise<void> = Promise.resolve();

  const execute = async (
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<Uint8Array> => {
    throwIfAborted(signal);
    const recipe = options.authorizeRecipe(Object.freeze({
      executable: options.simctlExecutable,
      args: Object.freeze([
        "--set",
        options.deviceSetPath,
        ...args,
      ]),
      cwd: resolve(options.cwd),
    }));
    const response = await options.commandPort.execute(recipe, signal);
    throwIfAborted(signal);
    return response.stdout;
  };

  const inventory = async (
    signal: AbortSignal,
  ): Promise<readonly ListedDevice[]> =>
    parseListedDevices(await execute(
      ["list", "devices", "available", "--json"],
      signal,
    ));

  const locate = async (
    signal: AbortSignal,
  ): Promise<LocatedManagedDevice | null> => {
    const [listed, loaded] = await Promise.all([
      inventory(signal),
      statePort.load(),
    ]);
    throwIfAborted(signal);
    const persisted = isRecord(loaded, options) ? loaded : null;
    const matches = listed.filter((device) =>
      device.name === MEMI_CAPTURE_SIMULATOR_NAME &&
      device.runtimeIdentifier === options.runtimeIdentifier);
    if (matches.length > 1) {
      throw new Error(
        "Memi managed simulator authority is ambiguous.",
      );
    }
    const selected = matches[0];
    if (selected === undefined) {
      await statePort.clear();
      return null;
    }
    if (persisted === null) {
      if (loaded !== null) {
        await statePort.clear();
      }
      throw new Error(
        "Same-name simulator ownership collision has no valid authority.",
      );
    }
    if (persisted.deviceId !== selected.deviceId) {
      await statePort.clear();
      throw new Error(
        "Same-name simulator ownership collision contradicts its UDID.",
      );
    }
    return Object.freeze({ device: selected, persisted });
  };

  const waitUntilBooted = async (
    deviceId: string,
    signal: AbortSignal,
  ): Promise<void> => {
    await execute(
      ["bootstatus", deviceId, "-b"],
      signal,
    );
  };

  const boot = async (
    deviceId: string,
    signal: AbortSignal,
  ): Promise<void> => {
    await execute(["boot", deviceId], signal);
    await waitUntilBooted(deviceId, signal);
  };

  const acquire = async (
    signal: AbortSignal,
  ): Promise<ManagedSimulatorSelection> => {
    const located = await locate(signal);
    if (located !== null) {
      if (located.device.state === "Shutdown") {
        await boot(located.device.deviceId, signal);
      } else {
        await waitUntilBooted(located.device.deviceId, signal);
      }
      const record = recordFor(located.device.deviceId, options);
      await statePort.save(record);
      return selectionFor(located.device.deviceId, true, options);
    }
    const createdOutput = new TextDecoder()
      .decode(await execute([
        "create",
        MEMI_CAPTURE_SIMULATOR_NAME,
        options.deviceTypeIdentifier,
        options.runtimeIdentifier,
      ], signal))
      .trim();
    if (!UUID_PATTERN.test(createdOutput)) {
      throw new Error(
        "CoreSimulator create did not return a valid managed UDID.",
      );
    }
    await statePort.save(recordFor(createdOutput, options));
    await boot(createdOutput, signal);
    return selectionFor(createdOutput, false, options);
  };

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const preceding = tail;
    let release!: () => void;
    tail = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    return preceding.then(operation).finally(release);
  };

  return Object.freeze({
    acquire: (signal: AbortSignal) =>
      serialize(() => acquire(signal)),
    resetForExpoGo: (signal: AbortSignal) => serialize(async () => {
      const selected = await acquire(signal);
      await execute(["shutdown", selected.deviceId], signal);
      await boot(selected.deviceId, signal);
      return selected;
    }),
    eraseAndBoot: (signal: AbortSignal) => serialize(async () => {
      const selected = await acquire(signal);
      await execute(["shutdown", selected.deviceId], signal);
      await execute(["erase", selected.deviceId], signal);
      await boot(selected.deviceId, signal);
      return selected;
    }),
    cleanup: (signal: AbortSignal) => serialize(async () => {
      const located = await locate(signal);
      if (located === null) {
        return false;
      }
      if (located.device.state === "Booted") {
        await execute(
          ["shutdown", located.device.deviceId],
          signal,
        );
      }
      return true;
    }),
    delete: (signal: AbortSignal) => serialize(async () => {
      const located = await locate(signal);
      if (located === null) {
        return false;
      }
      if (located.device.state === "Booted") {
        await execute(
          ["shutdown", located.device.deviceId],
          signal,
        );
      }
      await execute(
        ["delete", located.device.deviceId],
        signal,
      );
      await statePort.clear();
      return true;
    }),
  });
}
