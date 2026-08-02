import type {
  NativeCommandPort,
  NativeCommandResult,
  ProcessRecipe,
} from "@memi/capture-execution";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createManagedSimulatorAuthority,
  createManagedSimulatorFileStatePort,
  discoverManagedSimulatorProfile,
  EXPO_GO_BUNDLE_ID,
  MEMI_CAPTURE_SIMULATOR_NAME,
  type ManagedSimulatorRecordV1,
  type ManagedSimulatorStatePort,
} from "./native-capture-simulator.js";

const encoder = new TextEncoder();
const SIMCTL =
  "/Applications/Xcode.app/Contents/Developer/usr/bin/simctl";
const DEVICE_SET = "/managed/memi-simulator-device-set";
const CWD = "/managed/memi-capture";
const RUNTIME =
  "com.apple.CoreSimulator.SimRuntime.iOS-18-5";
const DEVICE_TYPE =
  "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro";
const MANAGED_UDID = "11111111-2222-3333-4444-555555555555";
const USER_UDID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";

function simctl(...args: readonly string[]): readonly string[] {
  return ["--set", DEVICE_SET, ...args];
}

function simctlSubcommand(args: readonly string[]): string | undefined {
  expect(args.slice(0, 2)).toEqual(["--set", DEVICE_SET]);
  return args[2];
}

interface CommandFixture {
  readonly calls: ProcessRecipe[];
  readonly commandPort: NativeCommandPort;
}

function result(stdout = ""): NativeCommandResult {
  return Object.freeze({
    stdout: encoder.encode(stdout),
    stderr: "",
  });
}

function commandFixture(
  responder: (
    args: readonly string[],
    signal: AbortSignal,
  ) => NativeCommandResult | Promise<NativeCommandResult>,
): CommandFixture {
  const calls: ProcessRecipe[] = [];
  return {
    calls,
    commandPort: {
      async execute(recipe, signal) {
        calls.push(recipe);
        return await responder(recipe.args, signal);
      },
    },
  };
}

function listOutput(
  managed:
    | Readonly<{
        udid: string;
        state: "Booted" | "Shutdown";
      }>
    | null,
  includeUserSimulator = true,
): string {
  return JSON.stringify({
    devices: {
      [RUNTIME]: [
        ...(includeUserSimulator
          ? [{
              name: "iPhone 16 Pro",
              udid: USER_UDID,
              state: "Booted",
              isAvailable: true,
            }]
          : []),
        ...(managed === null
          ? []
          : [{
              name: MEMI_CAPTURE_SIMULATOR_NAME,
              udid: managed.udid,
              state: managed.state,
              isAvailable: true,
            }]),
      ],
    },
  });
}

function stateFixture(initial: unknown = null): {
  readonly clear: ReturnType<typeof vi.fn>;
  readonly load: ReturnType<typeof vi.fn>;
  readonly save: ReturnType<typeof vi.fn>;
  readonly port: ManagedSimulatorStatePort;
} {
  const load = vi.fn(async () => initial);
  const save = vi.fn(async () => undefined);
  const clear = vi.fn(async () => undefined);
  return {
    clear,
    load,
    save,
    port: Object.freeze({ clear, load, save }),
  };
}

function managedRecord(
  deviceId = MANAGED_UDID,
): ManagedSimulatorRecordV1 {
  return Object.freeze({
    version: 1,
    deviceId,
    deviceName: MEMI_CAPTURE_SIMULATOR_NAME,
    runtimeIdentifier: RUNTIME,
    deviceTypeIdentifier: DEVICE_TYPE,
  });
}

function createAuthority(
  commands: CommandFixture,
  statePort: ManagedSimulatorStatePort = stateFixture().port,
) {
  return createManagedSimulatorAuthority({
    commandPort: commands.commandPort,
    simctlExecutable: SIMCTL,
    deviceSetPath: DEVICE_SET,
    cwd: CWD,
    runtimeIdentifier: RUNTIME,
    deviceTypeIdentifier: DEVICE_TYPE,
    statePort,
    authorizeRecipe: (recipe) => recipe,
  });
}

describe("createManagedSimulatorAuthority", () => {
  it("discovers the newest available iOS runtime and iPhone profile", async () => {
    const commands = commandFixture((args) => {
      if (args.includes("runtimes")) {
        return result(JSON.stringify({
          runtimes: [
            {
              identifier:
                "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
              version: "17.5",
              isAvailable: true,
            },
            {
              identifier: RUNTIME,
              version: "18.5",
              isAvailable: true,
            },
            {
              identifier:
                "com.apple.CoreSimulator.SimRuntime.iOS-19-0",
              version: "19.0",
              isAvailable: false,
            },
          ],
        }));
      }
      return result(JSON.stringify({
        devicetypes: [
          {
            name: "iPhone 15",
            identifier:
              "com.apple.CoreSimulator.SimDeviceType.iPhone-15",
            productFamily: "iPhone",
          },
          {
            name: "iPhone 16 Pro",
            identifier: DEVICE_TYPE,
            productFamily: "iPhone",
          },
          {
            name: "iPad Pro",
            identifier:
              "com.apple.CoreSimulator.SimDeviceType.iPad-Pro",
            productFamily: "iPad",
          },
        ],
      }));
    });

    await expect(discoverManagedSimulatorProfile({
      commandPort: commands.commandPort,
      simctlExecutable: SIMCTL,
      deviceSetPath: DEVICE_SET,
      cwd: CWD,
      authorizeRecipe: (recipe) => recipe,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      runtimeIdentifier: RUNTIME,
      deviceTypeIdentifier: DEVICE_TYPE,
    });
  });

  it("persists managed simulator authority in a bounded file", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-simulator-state-"));
    const directory = join(root, "simulator");
    await mkdir(directory);
    const port = createManagedSimulatorFileStatePort({
      root,
      path: join(directory, "authority.json"),
    });

    await expect(port.load()).resolves.toBeNull();
    await port.save(managedRecord());
    await expect(port.load()).resolves.toEqual(managedRecord());
    await port.clear();
    await expect(port.load()).resolves.toBeNull();
    expect(() =>
      createManagedSimulatorFileStatePort({
        root,
        path: "/tmp/outside-authority.json",
      }),
    ).toThrow(/contained/i);
  });

  it("reuses only the exact Memi simulator and boots its exact UDID", async () => {
    const commands = commandFixture((args) => {
      if (simctlSubcommand(args) === "list") {
        return result(listOutput({
          udid: MANAGED_UDID,
          state: "Shutdown",
        }));
      }
      return result();
    });
    const state = stateFixture(managedRecord());
    const authority = createAuthority(commands, state.port);

    await expect(
      authority.acquire(new AbortController().signal),
    ).resolves.toEqual({
      deviceId: MANAGED_UDID,
      deviceName: MEMI_CAPTURE_SIMULATOR_NAME,
      runtimeIdentifier: RUNTIME,
      deviceTypeIdentifier: DEVICE_TYPE,
      reused: true,
    });

    expect(commands.calls.map((call) => call.args)).toEqual([
      simctl("list", "devices", "available", "--json"),
      simctl("boot", MANAGED_UDID),
      simctl("bootstatus", MANAGED_UDID, "-b"),
    ]);
    expect(commands.calls.every((call) =>
      call.executable === SIMCTL && call.cwd === CWD)).toBe(true);
    expect(
      commands.calls.some((call) => call.args.includes(USER_UDID)),
    ).toBe(false);
    expect(state.save).toHaveBeenCalledWith({
      version: 1,
      deviceId: MANAGED_UDID,
      deviceName: MEMI_CAPTURE_SIMULATOR_NAME,
      runtimeIdentifier: RUNTIME,
      deviceTypeIdentifier: DEVICE_TYPE,
    });
    expect(state.load).toHaveBeenCalledOnce();
  });

  it("creates the fixed Memi device when it does not exist", async () => {
    const commands = commandFixture((args) => {
      if (simctlSubcommand(args) === "list") {
        return result(listOutput(null));
      }
      if (simctlSubcommand(args) === "create") {
        return result(`${MANAGED_UDID}\n`);
      }
      return result();
    });
    const authority = createAuthority(commands);

    const selected = await authority.acquire(
      new AbortController().signal,
    );

    expect(selected.reused).toBe(false);
    expect(commands.calls.map((call) => call.args)).toEqual([
      simctl("list", "devices", "available", "--json"),
      [
        "--set",
        DEVICE_SET,
        "create",
        MEMI_CAPTURE_SIMULATOR_NAME,
        DEVICE_TYPE,
        RUNTIME,
      ],
      simctl("boot", MANAGED_UDID),
      simctl("bootstatus", MANAGED_UDID, "-b"),
    ]);
  });

  it("persists a newly created UDID before a boot failure", async () => {
    const state = stateFixture();
    const commands = commandFixture((args) => {
      if (simctlSubcommand(args) === "list") {
        return result(listOutput(null));
      }
      if (simctlSubcommand(args) === "create") {
        return result(`${MANAGED_UDID}\n`);
      }
      if (simctlSubcommand(args) === "boot") {
        throw new Error("simulator boot failed");
      }
      return result();
    });
    const authority = createAuthority(commands, state.port);

    await expect(authority.acquire(
      new AbortController().signal,
    )).rejects.toThrow(/boot failed/i);
    expect(state.save).toHaveBeenCalledWith(managedRecord());
  });

  it("rejects a same-name simulator when persisted authority is stale", async () => {
    const stale = managedRecord(
      "99999999-8888-7777-6666-555555555555",
    );
    const state = stateFixture(stale);
    const commands = commandFixture((args) =>
      simctlSubcommand(args) === "list"
        ? result(listOutput({
            udid: MANAGED_UDID,
            state: "Booted",
          }))
        : result());
    const authority = createAuthority(commands, state.port);

    await expect(authority.acquire(
      new AbortController().signal,
    )).rejects.toThrow(/ownership|collision/i);
    expect(state.clear).toHaveBeenCalledOnce();
    expect(state.save).not.toHaveBeenCalled();
    expect(commands.calls).toHaveLength(1);
  });

  it("fails closed when the fixed Memi name is ambiguous", async () => {
    const commands = commandFixture((args) => {
      if (simctlSubcommand(args) !== "list") {
        return result();
      }
      return result(JSON.stringify({
        devices: {
          [RUNTIME]: [
            {
              name: MEMI_CAPTURE_SIMULATOR_NAME,
              udid: MANAGED_UDID,
              state: "Booted",
              isAvailable: true,
            },
            {
              name: MEMI_CAPTURE_SIMULATOR_NAME,
              udid: "66666666-7777-8888-9999-000000000000",
              state: "Shutdown",
              isAvailable: true,
            },
          ],
        },
      }));
    });

    await expect(
      createAuthority(commands).acquire(
        new AbortController().signal,
      ),
    ).rejects.toThrow(/ambiguous/i);
    expect(commands.calls).toHaveLength(1);
  });

  it("cold-resets Expo Go without erasing its installation", async () => {
    let listCount = 0;
    const commands = commandFixture((args) => {
      if (simctlSubcommand(args) === "list") {
        listCount += 1;
        return result(listOutput({
          udid: MANAGED_UDID,
          state: listCount === 1 ? "Booted" : "Shutdown",
        }));
      }
      return result();
    });
    const authority = createAuthority(
      commands,
      stateFixture(managedRecord()).port,
    );

    await authority.resetForExpoGo(new AbortController().signal);

    expect(commands.calls.map((call) => call.args)).toEqual([
      simctl("list", "devices", "available", "--json"),
      simctl("bootstatus", MANAGED_UDID, "-b"),
      simctl("shutdown", MANAGED_UDID),
      simctl("boot", MANAGED_UDID),
      simctl("bootstatus", MANAGED_UDID, "-b"),
    ]);
    expect(
      commands.calls.some((call) =>
        call.args.includes(EXPO_GO_BUNDLE_ID)),
    ).toBe(false);
    expect(
      commands.calls.some((call) => call.args.includes("erase")),
    ).toBe(false);
  });

  it("supports an explicit erase-and-boot for a fresh Expo Go install", async () => {
    const commands = commandFixture((args) =>
      simctlSubcommand(args) === "list"
        ? result(listOutput({
            udid: MANAGED_UDID,
            state: "Booted",
          }))
        : result());
    const authority = createAuthority(
      commands,
      stateFixture(managedRecord()).port,
    );

    await authority.eraseAndBoot(new AbortController().signal);

    expect(commands.calls.map((call) => call.args)).toEqual([
      simctl("list", "devices", "available", "--json"),
      simctl("bootstatus", MANAGED_UDID, "-b"),
      simctl("shutdown", MANAGED_UDID),
      simctl("erase", MANAGED_UDID),
      simctl("boot", MANAGED_UDID),
      simctl("bootstatus", MANAGED_UDID, "-b"),
    ]);
  });

  it("shuts down and deletes only the exact managed UDID", async () => {
    const state = stateFixture(managedRecord());
    const commands = commandFixture((args) =>
      simctlSubcommand(args) === "list"
        ? result(listOutput({
            udid: MANAGED_UDID,
            state: "Booted",
          }))
        : result());
    const authority = createAuthority(commands, state.port);

    await expect(
      authority.cleanup(new AbortController().signal),
    ).resolves.toBe(true);
    await expect(
      authority.delete(new AbortController().signal),
    ).resolves.toBe(true);

    expect(commands.calls.map((call) => call.args)).toEqual([
      simctl("list", "devices", "available", "--json"),
      simctl("shutdown", MANAGED_UDID),
      simctl("list", "devices", "available", "--json"),
      simctl("shutdown", MANAGED_UDID),
      simctl("delete", MANAGED_UDID),
    ]);
    expect(
      commands.calls.some((call) => call.args.includes(USER_UDID)),
    ).toBe(false);
    expect(state.clear).toHaveBeenCalledOnce();
  });

  it("does not create a simulator during cleanup when none exists", async () => {
    const state = stateFixture();
    const commands = commandFixture((args) =>
      simctlSubcommand(args) === "list"
        ? result(listOutput(null))
        : result());
    const authority = createAuthority(commands, state.port);

    await expect(
      authority.cleanup(new AbortController().signal),
    ).resolves.toBe(false);
    expect(commands.calls.map((call) => call.args)).toEqual([
      simctl("list", "devices", "available", "--json"),
    ]);
    expect(state.clear).toHaveBeenCalledOnce();
  });

  it("never cleans up or deletes an unowned same-name simulator", async () => {
    const state = stateFixture();
    const commands = commandFixture((args) =>
      simctlSubcommand(args) === "list"
        ? result(listOutput({
            udid: MANAGED_UDID,
            state: "Booted",
          }))
        : result());
    const authority = createAuthority(commands, state.port);

    await expect(authority.cleanup(
      new AbortController().signal,
    )).rejects.toThrow(/ownership|collision/i);
    await expect(authority.delete(
      new AbortController().signal,
    )).rejects.toThrow(/ownership|collision/i);

    expect(commands.calls.map((call) => call.args)).toEqual([
      ["--set", DEVICE_SET, "list", "devices", "available", "--json"],
      ["--set", DEVICE_SET, "list", "devices", "available", "--json"],
    ]);
    expect(
      commands.calls.some((call) =>
        call.args.includes("shutdown") ||
        call.args.includes("delete")),
    ).toBe(false);
  });

  it("validates authority inputs and cancellation before execution", async () => {
    const commands = commandFixture(() => result());
    const state = stateFixture();
    const valid = {
      commandPort: commands.commandPort,
      simctlExecutable: SIMCTL,
      deviceSetPath: DEVICE_SET,
      cwd: CWD,
      runtimeIdentifier: RUNTIME,
      deviceTypeIdentifier: DEVICE_TYPE,
      statePort: state.port,
      authorizeRecipe: (recipe: ProcessRecipe) => recipe,
    };

    expect(() => createManagedSimulatorAuthority({
      ...valid,
      simctlExecutable: "simctl",
    })).toThrow(/absolute/i);
    expect(() => createManagedSimulatorAuthority({
      ...valid,
      simctlExecutable: "/bin/sh",
    })).toThrow(/simctl/i);
    expect(() => createManagedSimulatorAuthority({
      ...valid,
      cwd: "/",
    })).toThrow(/managed working directory/i);
    expect(() => createManagedSimulatorAuthority({
      ...valid,
      runtimeIdentifier: "iOS 18.5",
    })).toThrow(/runtime identifier/i);
    expect(() => createManagedSimulatorAuthority({
      ...valid,
      deviceTypeIdentifier: "iPhone 16 Pro",
    })).toThrow(/device type identifier/i);

    const controller = new AbortController();
    controller.abort();
    await expect(
      createManagedSimulatorAuthority(valid).acquire(controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(commands.calls).toHaveLength(0);
  });
});
