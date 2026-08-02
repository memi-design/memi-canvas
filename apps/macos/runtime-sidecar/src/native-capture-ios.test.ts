import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  CaptureExecutionError,
  ContentAddressedArtifactStore,
} from "@memi/capture-execution";
import { describe, expect, it, vi } from "vitest";

import {
  createExpoStandaloneCaptureAdapter,
  resolvedNativeBuildSetting,
} from "./native-capture-ios.js";

const sourceRevision = "a6ce2458e0cd1b252663057f2e4060f0929c0687";

describe("standalone Expo native capture policy", () => {
  it("accepts identical build settings emitted for multiple Xcode targets", () => {
    const output = new TextEncoder().encode([
      "PODS_XCFRAMEWORKS_BUILD_DIR = /tmp/memi/DerivedData/Build/Products/Release-iphonesimulator/XCFrameworkIntermediates",
      "PODS_XCFRAMEWORKS_BUILD_DIR = /tmp/memi/DerivedData/Build/Products/Release-iphonesimulator/XCFrameworkIntermediates",
    ].join("\n"));

    expect(resolvedNativeBuildSetting(
      output,
      "PODS_XCFRAMEWORKS_BUILD_DIR",
    )).toBe(
      "/tmp/memi/DerivedData/Build/Products/Release-iphonesimulator/XCFrameworkIntermediates",
    );
  });

  it("rejects conflicting build settings emitted for distinct Xcode targets", () => {
    const output = new TextEncoder().encode([
      "PODS_XCFRAMEWORKS_BUILD_DIR = /tmp/memi/one",
      "PODS_XCFRAMEWORKS_BUILD_DIR = /tmp/memi/two",
    ].join("\n"));

    expect(() => resolvedNativeBuildSetting(
      output,
      "PODS_XCFRAMEWORKS_BUILD_DIR",
    )).toThrow("Expected exactly one distinct PODS_XCFRAMEWORKS_BUILD_DIR setting from Xcode.");
  });

  it("grants Xcode only the verified Node runtime and an explicit system path", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-native-ios-policy-"));
    const appDataRoot = join(root, "app-data");
    const derivedDataPath = join(root, ".memi", "DerivedData");
    const appBundlePath = join(
      derivedDataPath,
      "Build/Products/Release-iphonesimulator/Buzzr.app",
    );
    const nodeExecutable = join(root, "tools", "node", "bin", "node");
    const xcodebuildExecutable = join(root, "tools", "xcode", "bin", "xcodebuild");
    const simctlExecutable = join(root, "tools", "xcode", "bin", "simctl");
    const maestroExecutable = join(root, "tools", "maestro", "bin", "maestro");
    const application = {
      id: "app_buzzr",
      label: "Buzzr",
      platform: "expo-ios" as const,
      relativeRoot: ".",
    };
    await Promise.all([
      mkdir(join(root, "app"), { recursive: true }),
      mkdir(join(root, "ios"), { recursive: true }),
      mkdir(appDataRoot, { recursive: true }),
      mkdir(join(appDataRoot, "native-app-staging"), { recursive: true }),
      mkdir(dirname(nodeExecutable), { recursive: true }),
      mkdir(dirname(xcodebuildExecutable), { recursive: true }),
      mkdir(dirname(maestroExecutable), { recursive: true }),
      mkdir(appBundlePath, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(root, "app", "_layout.tsx"),
        [
          'import { View } from "react-native";',
          'function RootLayout() { return <View testID="root" />; }',
          "export default RootLayout;",
          "",
        ].join("\n"),
      ),
      writeFile(
        join(appBundlePath, "Info.plist"),
        "<plist><dict><key>CFBundleIdentifier</key><string>app.buzzr</string></dict></plist>",
      ),
      writeFile(nodeExecutable, "#!/bin/sh\nexit 0\n"),
      writeFile(xcodebuildExecutable, "#!/bin/sh\nexit 0\n"),
      writeFile(simctlExecutable, "#!/bin/sh\nexit 0\n"),
      writeFile(maestroExecutable, "#!/bin/sh\nexit 0\n"),
    ]);

    const seenRecipes: Array<{
      readonly args: readonly string[];
      readonly environment?: Readonly<Record<string, string>>;
    }> = [];
    const adapter = createExpoStandaloneCaptureAdapter({
      application,
      unit: {} as never,
      configuration: {
        kind: "expo-ios",
        runtime: "standalone",
        bundleId: "app.buzzr",
        scheme: "buzzr",
        nativeBuild: {
          container: { kind: "project", relativePath: "ios/Buzzr.xcodeproj" },
          scheme: "Buzzr",
          schemePath: "ios/Buzzr.xcodeproj/xcshareddata/xcschemes/Buzzr.xcscheme",
          configuration: "Release",
          derivedDataRelativePath: ".memi/DerivedData",
          requiresResolvedBuildSettings: true,
          buildSettingsResolution: {
            executable: "xcodebuild",
            args: ["-showBuildSettings"],
            requiredKeys: [
              "PRODUCT_BUNDLE_IDENTIFIER",
              "TARGET_BUILD_DIR",
              "FULL_PRODUCT_NAME",
            ],
          },
        },
        maestroFlows: [],
      } as never,
      applicationRoot: root,
      appDataRoot,
      nodeExecutable,
      xcodebuildExecutable,
      simctlExecutable,
      simulatorDeviceSetPath: join(appDataRoot, "device-set"),
      maestroExecutable,
      artifactStore: new ContentAddressedArtifactStore(join(appDataRoot, "artifacts")),
      commandPort: {
        execute: vi.fn(async (recipe) => {
          seenRecipes.push(recipe);
          if (recipe.args.includes("-showBuildSettings")) {
            return {
              stdout: new TextEncoder().encode([
                "PRODUCT_BUNDLE_IDENTIFIER = app.buzzr",
                `TARGET_BUILD_DIR = ${dirname(appBundlePath)}`,
                "FULL_PRODUCT_NAME = Buzzr.app",
              ].join("\n")),
              stderr: "",
            };
          }
          return { stdout: new Uint8Array(), stderr: "" };
        }),
      },
      simulatorPort: {
        selectBootedIphone: vi.fn(async () => ({
          deviceId: "SIMULATOR-1",
          name: "iPhone 16",
          runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
        })),
      } as never,
    });
    if (adapter === null) {
      throw new Error("Expected a standalone Expo capture adapter.");
    }

    const context = {
      job: {
        id: "imp_01J00000000000000000000001",
        repository: {
          kind: "local-directory",
          absolutePath: root,
          sourceRevision,
        },
      } as never,
      signal: new AbortController().signal,
    };
    const preparation = await adapter.prepare(context, application, []);
    const repeatedPreparation = await adapter.prepare(
      context,
      application,
      [],
    );

    expect(repeatedPreparation.id).toBe(preparation.id);
    expect(
      seenRecipes.filter((recipe) => recipe.args.includes("build")),
    ).toHaveLength(1);
    expect(
      seenRecipes.filter((recipe) =>
        recipe.args.includes("-showBuildSettings"),
      ),
    ).toHaveLength(1);
    expect(
      seenRecipes
        .find((recipe) => recipe.args.includes("-showBuildSettings"))
        ?.args,
    ).toEqual(expect.arrayContaining(["-jobs", "1"]));

    await adapter.launch(context, preparation);
    await adapter.launch(context, repeatedPreparation);
    expect(
      seenRecipes.filter((recipe) => recipe.args.includes("install")),
    ).toHaveLength(1);

    const build = seenRecipes.find((recipe) => recipe.args.includes("build"));
    const profile = build?.args[1] ?? "";
    expect(profile).toContain(`(subpath "${dirname(dirname(nodeExecutable))}")`);
    expect(build?.environment?.PATH).toBe(`${dirname(nodeExecutable)}:/usr/bin:/bin`);
    expect(profile).not.toContain(
      `(subpath "${dirname(dirname(dirname(nodeExecutable))) }")`,
    );
    expect(profile).toContain(
      `(literal "${join(
        homedir(),
        "Library",
        "Developer",
        "Xcode",
        "SDKToSimulatorIndexMapping.plist",
      )}")`,
    );
    expect(profile).toContain(
      '(allow mach-lookup (global-name "com.apple.fsevents.matching"))',
    );
    expect(profile).toContain(
      '(allow mach-lookup (global-name "com.apple.fseventsd"))',
    );

    await adapter.cleanup({
      job: {} as never,
      signal: new AbortController().signal,
    }, null);
  });

  it("classifies simulator selection failures before starting xcodebuild", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-native-ios-simulator-"));
    const appDataRoot = join(root, "app-data");
    const tools = join(root, "tools");
    await Promise.all([
      mkdir(join(root, "app"), { recursive: true }),
      mkdir(join(root, "ios"), { recursive: true }),
      mkdir(appDataRoot, { recursive: true }),
      mkdir(tools, { recursive: true }),
    ]);
    await writeFile(
      join(root, "app", "_layout.tsx"),
      [
        'import { View } from "react-native";',
        'function RootLayout() { return <View testID="root" />; }',
        "export default RootLayout;",
        "",
      ].join("\n"),
    );
    const execute = vi.fn(async () => ({
      stdout: new Uint8Array(),
      stderr: "",
    }));
    const selectBootedIphone = vi.fn(async () => {
      throw new Error("No supported iOS simulator runtime is available.");
    });
    const adapter = createExpoStandaloneCaptureAdapter({
      application: {
        id: "app_buzzr",
        label: "Buzzr",
        platform: "expo-ios",
        relativeRoot: ".",
      },
      unit: {} as never,
      configuration: {
        kind: "expo-ios",
        runtime: "standalone",
        bundleId: "app.buzzr",
        scheme: "buzzr",
        nativeBuild: {
          container: { kind: "project", relativePath: "ios/Buzzr.xcodeproj" },
          scheme: "Buzzr",
          configuration: "Release",
          derivedDataRelativePath: ".memi/DerivedData",
        },
        maestroFlows: [],
      } as never,
      applicationRoot: root,
      appDataRoot,
      nodeExecutable: join(tools, "node"),
      xcodebuildExecutable: join(tools, "xcodebuild"),
      simctlExecutable: join(tools, "simctl"),
      simulatorDeviceSetPath: join(appDataRoot, "device-set"),
      maestroExecutable: join(tools, "maestro"),
      artifactStore: new ContentAddressedArtifactStore(
        join(appDataRoot, "artifacts"),
      ),
      commandPort: { execute },
      simulatorPort: {
        selectBootedIphone,
      } as never,
    });
    if (adapter === null) {
      throw new Error("Expected a standalone Expo capture adapter.");
    }

    const failure = await adapter.prepare({
      job: {
        id: "imp_01J00000000000000000000001",
        repository: { kind: "local-directory", absolutePath: root, sourceRevision },
      } as never,
      signal: new AbortController().signal,
    }, {
      id: "app_buzzr",
      label: "Buzzr",
      platform: "expo-ios",
      relativeRoot: ".",
    }, []).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(CaptureExecutionError);
    expect(failure).toMatchObject({
      stage: "launch",
      code: "SIMULATOR_UNAVAILABLE",
      retryable: true,
    });
    expect(selectBootedIphone).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });
});
