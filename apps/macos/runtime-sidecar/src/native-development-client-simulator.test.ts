import {
  mkdir,
  mkdtemp,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findInstalledSimulatorApplication,
  type InstalledSimulatorApplicationCandidate,
} from "./native-development-client-simulator.js";

const TEST_BUNDLE_ID = "com.buzzr.app";
const BINARY_TEST_BUNDLE_ID = "com.buzzr.binary";
const BINARY_INFO_PLIST_BASE64 =
  "YnBsaXN0MDDRAQJfEBJDRkJ1bmRsZUlkZW50aWZpZXJfEBBjb20uYnV6enIuYmluYXJ5CAsgAAAAAAAAAQEAAAAAAAAAAwAAAAAAAAAAAAAAAAAAADM=";

function plist(bundleId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
</dict>
</plist>
`;
}

async function installApplication(
  root: string,
  deviceId: string,
  applicationId: string,
  appName: string,
  bundleId: string,
): Promise<string> {
  const appPath = join(
    root,
    "Devices",
    deviceId,
    "data",
    "Containers",
    "Bundle",
    "Application",
    applicationId,
    `${appName}.app`,
  );
  await mkdir(appPath, { recursive: true });
  await writeFile(join(appPath, "Info.plist"), plist(bundleId));
  return appPath;
}

async function installBinaryApplication(
  root: string,
  deviceId: string,
  applicationId: string,
  appName: string,
): Promise<string> {
  const appPath = join(
    root,
    "Devices",
    deviceId,
    "data",
    "Containers",
    "Bundle",
    "Application",
    applicationId,
    `${appName}.app`,
  );
  await mkdir(appPath, { recursive: true });
  await writeFile(
    join(appPath, "Info.plist"),
    Buffer.from(BINARY_INFO_PLIST_BASE64, "base64"),
  );
  return appPath;
}

describe("findInstalledSimulatorApplication", () => {
  it("returns the first simulator device containing the requested bundle id", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-simulator-device-set-"));
    await installApplication(
      root,
      "11111111-1111-1111-1111-111111111111",
      "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
      "Buzzr",
      "com.other.app",
    );
    const expectedPath = await installApplication(
      root,
      "22222222-2222-2222-2222-222222222222",
      "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
      "Buzzr",
      TEST_BUNDLE_ID,
    );
    const canonicalExpectedPath = await realpath(expectedPath);
    const expectedCandidate: InstalledSimulatorApplicationCandidate = {
      appBundleId: TEST_BUNDLE_ID,
      appContainerId: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
      appPath: canonicalExpectedPath,
      deviceId: "22222222-2222-2222-2222-222222222222",
    };

    await expect(
      findInstalledSimulatorApplication({
        bundleId: TEST_BUNDLE_ID,
        coreSimulatorRoot: root,
      }),
    ).resolves.toEqual(expectedCandidate);
  });

  it("returns null when no device contains the requested bundle id", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-simulator-device-set-"));
    await installApplication(
      root,
      "33333333-3333-3333-3333-333333333333",
      "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
      "Buzzr",
      "com.other.app",
    );

    await expect(
      findInstalledSimulatorApplication({
        bundleId: TEST_BUNDLE_ID,
        coreSimulatorRoot: root,
      }),
    ).resolves.toBeNull();
  });

  it("finds a matching bundle id in a binary Info.plist fixture", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-simulator-device-set-"));
    const expectedPath = await installBinaryApplication(
      root,
      "55555555-5555-5555-5555-555555555555",
      "EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE",
      "BuzzrBinary",
    );
    const canonicalExpectedPath = await realpath(expectedPath);
    const expectedCandidate: InstalledSimulatorApplicationCandidate = {
      appBundleId: BINARY_TEST_BUNDLE_ID,
      appContainerId: "EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE",
      appPath: canonicalExpectedPath,
      deviceId: "55555555-5555-5555-5555-555555555555",
    };

    await expect(
      findInstalledSimulatorApplication({
        bundleId: BINARY_TEST_BUNDLE_ID,
        coreSimulatorRoot: root,
      }),
    ).resolves.toEqual(expectedCandidate);
  });

  it("ignores invalid device and application identifiers instead of escaping the device set", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-simulator-device-set-"));
    const invalidDevicePath = join(root, "Devices", "..");
    await mkdir(invalidDevicePath, { recursive: true });
    await installApplication(
      root,
      "44444444-4444-4444-4444-444444444444",
      "DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD",
      "Buzzr",
      TEST_BUNDLE_ID,
    );

    await expect(
      findInstalledSimulatorApplication({
        bundleId: TEST_BUNDLE_ID,
        coreSimulatorRoot: root,
      }),
    ).resolves.toMatchObject({
      deviceId: "44444444-4444-4444-4444-444444444444",
    });
  });

  it("rejects a symbolic Devices directory that resolves outside the requested root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-simulator-device-set-"));
    const root = join(parent, "CoreSimulator");
    const external = join(parent, "external-devices");
    await mkdir(root, { recursive: true });
    await mkdir(external, { recursive: true });
    await symlink(external, join(root, "Devices"), "dir");

    await expect(
      findInstalledSimulatorApplication({
        bundleId: TEST_BUNDLE_ID,
        coreSimulatorRoot: root,
      }),
    ).rejects.toThrow(/contain|escape|outside/i);
  });

  it("enforces bounded device scanning", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-simulator-device-set-"));
    for (let index = 0; index < 3; index += 1) {
      const digit = `${index + 5}`;
      await installApplication(
        root,
        `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`,
        `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`,
        `Buzzr-${index}`,
        index === 2 ? TEST_BUNDLE_ID : `com.example.${index}`,
      );
    }

    await expect(
      findInstalledSimulatorApplication({
        bundleId: TEST_BUNDLE_ID,
        coreSimulatorRoot: root,
        maximumDevices: 2,
      }),
    ).resolves.toBeNull();
  });
});
