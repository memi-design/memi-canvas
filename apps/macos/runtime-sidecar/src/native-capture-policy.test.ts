import { describe, expect, it } from "vitest";

import {
  IOS_BUILD_MACH_SERVICES,
  IOS_CAPTURE_POLICY_AUTHORITY_V3,
  IOS_SIMULATOR_MACH_SERVICES,
} from "./native-capture-policy.js";
import { buildSandboxProfile } from "@memi/capture-execution";

describe("native iOS capture policy authority", () => {
  it("keeps simulator execution and build discovery capabilities separate", () => {
    expect(IOS_CAPTURE_POLICY_AUTHORITY_V3.version).toBe(3);
    expect(IOS_BUILD_MACH_SERVICES).toContain(
      "com.apple.CoreSimulator.CoreSimulatorService",
    );
    expect(IOS_BUILD_MACH_SERVICES).toContain(
      "com.apple.CoreSimulator.simdiskimaged",
    );
    expect(IOS_BUILD_MACH_SERVICES).toContain(
      "com.apple.CoreSimulator.SimDiskImageService",
    );
    expect(IOS_BUILD_MACH_SERVICES).not.toContain(
      "com.apple.CoreSimulator.SimLaunchHost-arm64",
    );
    expect(IOS_SIMULATOR_MACH_SERVICES).toContain(
      "com.apple.CoreSimulator.SimLaunchHost-arm64",
    );
    expect(IOS_CAPTURE_POLICY_AUTHORITY_V3.build).toMatchObject({
      metadataLiterals: ["/Applications"],
      readLiterals: [
        "/dev/null",
        "/private/etc/passwd",
        "/private/etc/group",
      ],
      writeLiterals: ["/dev/null"],
      simulatorMachLookup: "platform-discovery-only",
    });
    expect(IOS_CAPTURE_POLICY_AUTHORITY_V3.simulator).toMatchObject({
      commandAuthority: "direct-simctl",
      deviceSetAuthority: "sandbox-home-default",
    });
  });

  it("serializes every finite native build service into a valid profile", () => {
    const profile = buildSandboxProfile({
      allowedCommands: [],
      allowedCwdRoots: ["/managed"],
      sandboxEnvironment: {
        home: "/managed/home",
        temporaryDirectory: "/managed/tmp",
        path: "",
      },
      sandbox: {
        executable: "/usr/bin/sandbox-exec",
        allowedReadRoots: ["/managed"],
        allowedWriteRoots: ["/managed"],
        allowedMachLookupGlobals: IOS_BUILD_MACH_SERVICES,
        network: "none",
      },
    });

    for (const service of IOS_BUILD_MACH_SERVICES) {
      expect(profile).toContain(`(global-name "${service}")`);
    }
  });
});
