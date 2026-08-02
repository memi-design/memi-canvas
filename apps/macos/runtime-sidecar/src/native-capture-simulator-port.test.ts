import {
  access,
  mkdir,
  mkdtemp,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  NativeCommandPort,
  ProcessRecipe,
} from "@memi/capture-execution";
import { describe, expect, it, vi } from "vitest";

import { createManagedSimulatorPorts } from "./native-capture-simulator-port.js";

const managedId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const runtime =
  "com.apple.CoreSimulator.SimRuntime.iOS-18-5";

async function fixture(
  expoGoInstalled: boolean,
  initialState: "missing" | "Booted" | "Shutdown" = "missing",
) {
  const root = await mkdtemp(join(tmpdir(), "memi-simulator-port-"));
  const appDataRoot = join(root, "app-data");
  const managedWorktreeRoot = join(root, "managed");
  const simctlExecutable =
    "/Applications/Xcode.app/Contents/Developer/usr/bin/simctl";
  const deviceSetPath = join(
    appDataRoot,
    "sandbox",
    "home",
    "Library",
    "Developer",
    "CoreSimulator",
    "Devices",
  );
  const legacyDeviceSetPath = join(
    appDataRoot,
    "capture-simulator",
    "device-set",
  );
  await Promise.all([
    mkdir(join(appDataRoot, "sandbox", "home"), { recursive: true }),
    mkdir(join(appDataRoot, "sandbox", "tmp"), { recursive: true }),
    mkdir(join(appDataRoot, "capture-simulator"), { recursive: true }),
    mkdir(managedWorktreeRoot),
  ]);
  let state: "missing" | "Booted" | "Shutdown" = initialState;
  const calls: string[][] = [];
  const commandPort: NativeCommandPort = {
    execute: vi.fn(async (recipe: ProcessRecipe) => {
      const args = [...recipe.args];
      calls.push(args);
      if (args.includes("runtimes")) {
        return bytes({
          runtimes: [{
            identifier: runtime,
            version: "18.5",
            isAvailable: true,
          }],
        });
      }
      if (args.includes("devicetypes")) {
        return bytes({
          devicetypes: [{
            identifier:
              "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro",
            name: "iPhone 16 Pro",
            productFamily: "iPhone",
          }],
        });
      }
      if (args.includes("devices")) {
        return bytes({
          devices: {
            [runtime]: state === "missing"
              ? []
              : [{
                  name: "Memi Canvas Capture iPhone",
                  udid: managedId,
                  state,
                  isAvailable: true,
                }],
          },
        });
      }
      if (args.includes("create")) {
        state = "Shutdown";
        return output(managedId);
      }
      if (args.includes("bootstatus") || args.includes("boot")) {
        state = "Booted";
        return output("");
      }
      if (args.includes("shutdown")) {
        state = "Shutdown";
        return output("");
      }
      if (args.includes("delete")) {
        state = "missing";
        const setIndex = args.indexOf("--set");
        const selectedSet = args[setIndex + 1];
        if (selectedSet !== undefined) {
          await rm(join(selectedSet, managedId), {
            force: true,
            recursive: true,
          });
        }
        return output("");
      }
      if (args.includes("get_app_container")) {
        if (!expoGoInstalled) {
          throw new Error("application not installed");
        }
        return output(
          "/managed/CoreSimulator/Applications/Exponent.app",
        );
      }
      return output("");
    }),
  };
  const ports = createManagedSimulatorPorts({
    appDataRoot,
    managedWorktreeRoot,
    commandPort,
    simctlExecutable,
    roots: [appDataRoot, managedWorktreeRoot],
  });
  return {
    calls,
    deviceSetPath,
    legacyDeviceSetPath,
    appDataRoot,
    ports,
    simctlExecutable,
    state: () => state,
  };
}

function output(value: string) {
  return {
    stdout: new TextEncoder().encode(value),
    stderr: "",
  };
}

function bytes(value: unknown) {
  return output(JSON.stringify(value));
}

describe("managed native capture simulator ports", () => {
  it("routes every command through direct simctl and the Memi-owned device set", async () => {
    const target = await fixture(true);

    await target.ports.simulatorPort.selectBootedIphone(
      new AbortController().signal,
    );

    expect(target.calls.length).toBeGreaterThan(0);
    for (const args of target.calls) {
      expect(args).toContain(target.simctlExecutable);
      expect(args).not.toContain("simctl");
      expect(args).toEqual(expect.arrayContaining([
        "--set",
        target.deviceSetPath,
      ]));
    }
  });

  it("preflights Expo Go and fails before Metro when it is absent", async () => {
    const target = await fixture(false);

    await expect(
      target.ports.expoGoSimulatorPort.selectBootedIphone(
        new AbortController().signal,
      ),
    ).rejects.toThrow(/EXPO_GO_NOT_INSTALLED/i);

    expect(target.state()).toBe("Shutdown");
    expect(target.calls.some((args) =>
      args.includes("get_app_container") &&
      args.includes("host.exp.Exponent"))).toBe(true);
  });

  it("returns only the managed device and shuts it down on release", async () => {
    const target = await fixture(true);

    await expect(
      target.ports.expoGoSimulatorPort.selectBootedIphone(
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      deviceId: managedId,
      name: "Memi Canvas Capture iPhone",
      runtime,
    });
    expect(target.state()).toBe("Booted");

    await target.ports.releaseManagedSimulator(
      new AbortController().signal,
    );
    expect(target.state()).toBe("Shutdown");
  });

  it("permanently deletes only the persisted managed simulator authority", async () => {
    const target = await fixture(true);
    await target.ports.simulatorPort.selectBootedIphone(
      new AbortController().signal,
    );

    await expect(
      target.ports.purgeManagedSimulator(
        new AbortController().signal,
      ),
    ).resolves.toBe(true);
    expect(target.state()).toBe("missing");
    expect(target.calls.some((args) => args.includes("delete"))).toBe(
      true,
    );

    await target.ports.simulatorPort.selectBootedIphone(
      new AbortController().signal,
    );
    expect(target.state()).toBe("Booted");
    expect(
      target.calls.filter((args) => args.includes("runtimes")),
    ).toHaveLength(2);
  });

  it("purges the sole exact legacy Memi device without authority state", async () => {
    const target = await fixture(true, "Booted");
    await mkdir(
      join(target.legacyDeviceSetPath, managedId),
      { recursive: true },
    );

    await expect(
      target.ports.purgeManagedSimulator(
        new AbortController().signal,
      ),
    ).resolves.toBe(true);

    expect(target.state()).toBe("missing");
    expect(target.calls).toContainEqual(expect.arrayContaining([
      "--set",
      target.legacyDeviceSetPath,
      "shutdown",
      managedId,
    ]));
    expect(target.calls).toContainEqual(expect.arrayContaining([
      "--set",
      target.legacyDeviceSetPath,
      "delete",
      managedId,
    ]));
    await expect(access(target.legacyDeviceSetPath)).rejects.toThrow();
    await expect(access(join(
      target.appDataRoot,
      "capture-simulator",
    ))).rejects.toThrow();

    expect(
      target.calls.some((args) => args.includes("runtimes")),
    ).toBe(false);
  });

  it("rejects a symlinked legacy simulator set without deleting its target", async () => {
    const target = await fixture(true, "Booted");
    const external = join(
      target.appDataRoot,
      "..",
      "external-device-set",
    );
    await mkdir(join(external, managedId), { recursive: true });
    await symlink(external, target.legacyDeviceSetPath, "dir");

    await expect(
      target.ports.purgeManagedSimulator(
        new AbortController().signal,
      ),
    ).rejects.toThrow(/symbolic|canonical|contained/i);

    await expect(access(join(external, managedId))).resolves.toBeUndefined();
    expect(
      target.calls.some((args) =>
        args.includes("delete") || args.includes("shutdown")),
    ).toBe(false);
  });
});
