import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ContentAddressedArtifactStore } from "@memi/capture-execution";
import { describe, expect, it, vi } from "vitest";

import { jobFixture } from "../../../../packages/capture-execution/src/test-fixtures.js";
import {
  createSimulatorScreenshotStagingRoot,
  createExpoGoCaptureAdapter,
  localDevelopmentMetroLaunch,
  readSettledEvidenceFile,
  simulatorPolicy,
} from "./native-capture-ios.js";
import {
  createExistingDevelopmentClientSimulatorPort,
  createNativeCapturePorts,
  directSimulatorSelectionPolicy,
  type NativeCaptureSpawn,
} from "./native-capture-ports.js";

async function executable(path: string): Promise<string> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

function spawnFixture(
  simulatorProfile: () => Readonly<{
    runtimeIdentifier: string;
    runtimeVersion: string;
  }>,
): NativeCaptureSpawn {
  return vi.fn((_executable, args) => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.pid = 9_001;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setTimeout(() => {
      const stdout = args.includes("runtimes")
        ? JSON.stringify({
            runtimes: [{
              identifier: simulatorProfile().runtimeIdentifier,
              version: simulatorProfile().runtimeVersion,
              isAvailable: true,
            }],
          })
        : args.includes("devicetypes")
          ? JSON.stringify({
              devicetypes: [{
                name: "iPhone 16 Pro",
                identifier:
                  "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro",
                productFamily: "iPhone",
              }],
            })
          : "";
      child.stdout.end(stdout);
      child.stderr.end();
      child.emit("exit", 0, null);
    }, 0);
    return child;
  });
}

describe("native Expo Go capture integration", () => {
  it("stages simulator screenshots in private internal temporary storage", async () => {
    const stagingRoot = await createSimulatorScreenshotStagingRoot();

    try {
      expect(stagingRoot).toMatch(
        /^\/private\/tmp\/design\.memi\.canvas-capture-[^/]+$/u,
      );
      expect(await realpath(stagingRoot)).toBe(stagingRoot);
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  });

  it("waits for a completed simulator screenshot file without sampling a new frame", async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockResolvedValueOnce(new Uint8Array([2]))
      .mockResolvedValueOnce(new Uint8Array([2]));
    const wait = vi.fn(async () => undefined);

    await expect(readSettledEvidenceFile({
      read,
      signal: new AbortController().signal,
      attempts: 3,
      settleDelayMs: 1,
      wait,
    })).resolves.toEqual(new Uint8Array([2]));

    expect(read).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("rejects a simulator screenshot file that keeps changing after capture", async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockResolvedValueOnce(new Uint8Array([2]))
      .mockResolvedValueOnce(new Uint8Array([3]));

    await expect(readSettledEvidenceFile({
      read,
      signal: new AbortController().signal,
      attempts: 3,
      wait: async () => undefined,
    })).rejects.toThrow(/did not settle/i);
  });

  it("accepts a managed Expo CLI symlink only when its resolved target stays local", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-local-expo-cli-"));
    const cliDirectory = join(root, "node_modules", ".tools");
    const cliTarget = join(cliDirectory, "expo-cli.js");
    const cliLink = join(root, "node_modules", "expo", "bin", "cli");
    await mkdir(dirname(cliLink), { recursive: true });
    await mkdir(cliDirectory, { recursive: true });
    await writeFile(cliTarget, "process.exit(0);\n");
    await symlink(cliTarget, cliLink);

    const canonicalDependencyRoot = await realpath(join(root, "node_modules"));
    expect(localDevelopmentMetroLaunch("/opt/memi/node", root)).toEqual({
      executable: "/opt/memi/node",
      cliPath: await realpath(cliTarget),
      dependencyRoot: canonicalDependencyRoot,
      environment: { NODE_PATH: canonicalDependencyRoot },
    });
  });

  it("uses the real CoreSimulator authority for a direct development client", () => {
    const appDataRoot = "/private/tmp/memi-app-data";
    const policy = simulatorPolicy({
      application: {
        id: "app_development_client",
        label: "Development client",
        platform: "expo-ios",
        relativeRoot: ".",
      },
      unit: {} as never,
      configuration: {} as never,
      applicationRoot: "/private/tmp/memi-worktree",
      appDataRoot,
      nodeExecutable: "/opt/memi/node",
      npxExecutable: "/opt/memi/npx",
      simctlExecutable:
        "/Applications/Xcode.app/Contents/Developer/usr/bin/simctl",
      maestroExecutable: "/opt/memi/maestro",
      artifactStore: {} as never,
      commandPort: {} as never,
      processStarter: {} as never,
      portLease: {} as never,
      simulatorPort: {} as never,
      directSimulator: true,
    }, []);

    const coreSimulatorRoot = join(
      homedir(),
      "Library",
      "Developer",
      "CoreSimulator",
    );
    expect(policy.sandboxEnvironment.home).toBe(homedir());
    expect(policy.sandbox.allowedReadRoots).toContain(coreSimulatorRoot);
    expect(policy.sandbox.allowedWriteRoots).toContain(coreSimulatorRoot);
    expect(policy.sandbox.allowHostHome).toBe(true);
  });

  it("selects an installed development client from the real simulator device set", () => {
    const appDataRoot = "/private/tmp/memi-app-data";
    const policy = directSimulatorSelectionPolicy(
      "/Applications/Xcode.app/Contents/Developer/usr/bin/simctl",
      ["list", "devices", "available", "--json"],
      ["/private/tmp/memi-worktree", appDataRoot],
      appDataRoot,
    );
    const coreSimulatorRoot = join(
      homedir(),
      "Library",
      "Developer",
      "CoreSimulator",
    );

    expect(policy.sandboxEnvironment.home).toBe(homedir());
    expect(policy.sandbox.allowedReadRoots).toContain(coreSimulatorRoot);
    expect(policy.sandbox.allowedWriteRoots).toContain(coreSimulatorRoot);
    expect(policy.sandbox.allowHostHome).toBe(true);
  });

  it("uses the simulator that contains the requested development client, not another booted iPhone", async () => {
    const candidate = {
      appBundleId: "com.buzzr.app",
      appContainerId: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
      appPath: "/private/core-simulator/Devices/22222222-2222-2222-2222-222222222222/Buzzr.app",
      deviceId: "22222222-2222-2222-2222-222222222222",
    };
    const devices = new TextEncoder().encode(JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-18-5": [
          {
            name: "Unrelated iPhone",
            udid: "11111111-1111-1111-1111-111111111111",
            state: "Booted",
            isAvailable: true,
            deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-16",
          },
          {
            name: "Buzzr iPhone",
            udid: candidate.deviceId,
            state: "Shutdown",
            isAvailable: true,
            deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17",
          },
        ],
      },
    }));
    const execute = vi.fn(
      async (_args: readonly string[], _signal: AbortSignal) => ({
        stdout: devices,
        stderr: "",
      }),
    );
    const port = createExistingDevelopmentClientSimulatorPort({
      bundleId: candidate.appBundleId,
      coreSimulatorRoot: "/private/core-simulator",
      discoverInstalledApplication: async () => candidate,
      execute,
    });

    await expect(
      port.selectBootedIphone(new AbortController().signal),
    ).resolves.toEqual({
      deviceId: candidate.deviceId,
      name: "Buzzr iPhone",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-5",
    });
    expect(execute.mock.calls.map(([args]) => args)).toEqual([
      ["list", "devices", "available", "--json"],
      ["boot", candidate.deviceId],
      ["bootstatus", candidate.deviceId, "-b"],
    ]);
  });

  it("fails before launching Metro when the requested development client is not installed", async () => {
    const execute = vi.fn();
    const port = createExistingDevelopmentClientSimulatorPort({
      bundleId: "com.buzzr.app",
      coreSimulatorRoot: "/private/core-simulator",
      discoverInstalledApplication: async () => null,
      execute,
    });

    await expect(
      port.selectBootedIphone(new AbortController().signal),
    ).rejects.toThrow(/development client.*not installed/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it("constructs a direct development-client adapter without native build authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-development-client-native-"));
    const appDataRoot = join(root, "app-data");
    const managedRoot = join(root, "managed");
    const toolsRoot = join(appDataRoot, "tools");
    await mkdir(appDataRoot);
    await mkdir(managedRoot);
    const tools = {
      xcrun: await executable(join(toolsRoot, "xcrun")),
      simctl: await executable(join(toolsRoot, "simctl")),
      xcodebuild: await executable(join(toolsRoot, "xcodebuild")),
      maestro: await executable(join(toolsRoot, "maestro")),
      npm: await executable(join(toolsRoot, "npm")),
      npx: await executable(join(toolsRoot, "npx")),
      xcuiRunner: await executable(join(toolsRoot, "memi-xcui-capture")),
    };
    const ports = await createNativeCapturePorts({
      appDataRoot,
      managedWorktreeRoot: managedRoot,
      artifactStore: new ContentAddressedArtifactStore(join(appDataRoot, "artifacts")),
      toolExecutables: tools,
      terminationGraceMs: 0,
      dependencies: {
        spawn: spawnFixture(() => ({
          runtimeIdentifier: "com.apple.CoreSimulator.SimRuntime.iOS-18-5",
          runtimeVersion: "18.5",
        })),
        kill: vi.fn(),
        setTimer: (callback) => {
          callback();
          return 1;
        },
        clearTimer: vi.fn(),
      },
    });
    const application = {
      id: "app_development_client" as const,
      label: "Development client",
      platform: "expo-ios" as const,
      relativeRoot: ".",
    };
    const unit = {
      applicationId: application.id,
      platform: "expo-ios",
      root: ".",
      displayName: "Development client",
      status: "supported",
      pipelineStages: [],
      manifestPaths: ["package.json", "app.json"],
      buildRecipe: {
        executable: "npx",
        args: ["expo", "start", "--dev-client", "--localhost"],
        cwd: ".",
        purpose: "launch",
      },
      captureConfiguration: {
        kind: "expo-ios",
        runtime: "development-client",
        bundleId: "com.example.client",
        appConfigPath: "app.json",
        entryPoint: "expo-router/entry",
        scheme: "example",
        nativeBuild: null,
        metro: {
          executable: "npx",
          args: ["expo", "start", "--dev-client", "--localhost"],
          appId: "com.example.client",
          routeAuthority: "expo-development-client-url",
          scheme: "example",
        },
        maestroFlowPaths: [],
        maestroFlows: [],
      },
      routes: [],
      scenarios: [],
      cacheKey: `sha256:${"d".repeat(64)}`,
      errors: [],
    } as const;
    const canonicalManaged = await realpath(managedRoot);
    const adapter = ports.adapterFor(application, unit, {
      managedRootPath: canonicalManaged,
      applicationRootPath: canonicalManaged,
    });

    expect(adapter?.metadata).toMatchObject({
      id: "expo-development-client-ios",
      platform: "expo-ios",
    });
    await expect(
      ports.nativeDependencyPreparationFor({
        application,
        unit,
        context: {
          managedRootPath: canonicalManaged,
          applicationRootPath: canonicalManaged,
          repositoryRevision: "a".repeat(40),
        },
        adapter: adapter!,
      }),
    ).resolves.toBeNull();
  });

  it("constructs and approves Expo Go from managed capture authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-expo-go-native-"));
    let simulatorProfile: Readonly<{
      runtimeIdentifier: string;
      runtimeVersion: string;
    }> = Object.freeze({
      runtimeIdentifier:
        "com.apple.CoreSimulator.SimRuntime.iOS-18-5",
      runtimeVersion: "18.5",
    });
    const appDataRoot = join(root, "app-data");
    const managedRoot = join(root, "managed");
    const toolsRoot = join(appDataRoot, "tools");
    await mkdir(appDataRoot);
    await mkdir(managedRoot);
    const tools = {
      xcrun: await executable(join(toolsRoot, "xcrun")),
      simctl: await executable(join(toolsRoot, "simctl")),
      xcodebuild: await executable(join(toolsRoot, "xcodebuild")),
      maestro: await executable(join(toolsRoot, "maestro")),
      npm: await executable(join(toolsRoot, "npm")),
      npx: await executable(join(toolsRoot, "npx")),
      xcuiRunner: await executable(join(toolsRoot, "memi-xcui-capture")),
    };
    const ports = await createNativeCapturePorts({
      appDataRoot,
      managedWorktreeRoot: managedRoot,
      artifactStore: new ContentAddressedArtifactStore(
        join(appDataRoot, "artifacts"),
      ),
      toolExecutables: tools,
      terminationGraceMs: 0,
      dependencies: {
        spawn: spawnFixture(() => simulatorProfile),
        kill: vi.fn(),
        setTimer: (callback) => {
          callback();
          return 1;
        },
        clearTimer: vi.fn(),
      },
    });
    const application = {
      id: "app_expo_go",
      label: "Expo Go",
      platform: "expo-ios" as const,
      relativeRoot: ".",
    };
    const unit = {
      applicationId: "app_expo_go",
      platform: "expo-ios",
      root: ".",
      displayName: "Expo Go",
      status: "supported",
      pipelineStages: [],
      manifestPaths: ["package.json", "app.json"],
      buildRecipe: {
        executable: "npx",
        args: ["expo", "start", "--go", "--localhost"],
        cwd: ".",
        purpose: "launch",
      },
      captureConfiguration: {
        kind: "expo-ios",
        runtime: "expo-go",
        bundleId: null,
        appConfigPath: "app.json",
        entryPoint: "expo-router/entry",
        scheme: null,
        nativeBuild: null,
        metro: {
          executable: "npx",
          args: ["expo", "start", "--go", "--localhost"],
          appId: "host.exp.Exponent",
          routeAuthority: "expo-go-project-url",
        },
        maestroFlowPaths: [],
        maestroFlows: [],
      },
      routes: [],
      scenarios: [],
      cacheKey: `sha256:${"e".repeat(64)}`,
      errors: [],
    } as const;
    const canonicalManaged = await realpath(managedRoot);
    const adapter = ports.adapterFor(application, unit, {
      managedRootPath: canonicalManaged,
      applicationRootPath: canonicalManaged,
    });

    expect(adapter?.metadata).toMatchObject({
      id: "expo-go-ios",
      platform: "expo-ios",
    });
    const firstApproval = await ports.approvalAuthority.describe({
      application,
      unit,
      adapter: adapter!,
      recipe: unit.buildRecipe,
    });
    expect(firstApproval).toMatchObject({
      resolvedExecutable: await realpath(tools.npx),
      environmentFingerprint: expect.stringMatching(
        /^sha256:[a-f0-9]{64}$/u,
      ),
    });
    simulatorProfile = Object.freeze({
      runtimeIdentifier:
        "com.apple.CoreSimulator.SimRuntime.iOS-18-6",
      runtimeVersion: "18.6",
    });
    const changedRuntimeApproval =
      await ports.approvalAuthority.describe({
        application,
        unit,
        adapter: adapter!,
        recipe: unit.buildRecipe,
      });
    expect(changedRuntimeApproval.environmentFingerprint).not.toBe(
      firstApproval.environmentFingerprint,
    );
  });

  it("preserves the nested Expo application sandbox authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-expo-go-policy-"));
    const appDataRoot = join(root, "app-data");
    const managedRoot = join(root, "managed");
    const applicationRoot = join(managedRoot, "apps", "mobile");
    await mkdir(appDataRoot, { recursive: true });
    await mkdir(applicationRoot, { recursive: true });
    const capturedPolicies: Array<{
      readonly sandboxEnvironment: {
        readonly path: string;
      };
      readonly sandbox: {
        readonly allowedReadRoots: readonly string[];
        readonly allowedReadMetadataRoots?: readonly string[];
        readonly allowedReadLiterals?: readonly string[];
        readonly allowedWriteRoots: readonly string[];
      };
    }> = [];
    const adapter = createExpoGoCaptureAdapter({
      application: {
        id: "app_expo_go_nested",
        label: "Expo Go nested",
        platform: "expo-ios",
        relativeRoot: "apps/mobile",
      },
      unit: {
        applicationId: "app_expo_go_nested",
        platform: "expo-ios",
        root: "apps/mobile",
        displayName: "Expo Go nested",
        status: "supported",
        pipelineStages: [],
        manifestPaths: ["apps/mobile/package.json", "apps/mobile/app.json"],
        buildRecipe: {
          executable: "npx",
          args: ["expo", "start", "--go", "--localhost"],
          cwd: ".",
          purpose: "launch",
        },
        captureConfiguration: {
          kind: "expo-ios",
          runtime: "expo-go",
          bundleId: null,
          appConfigPath: "apps/mobile/app.json",
          entryPoint: "expo-router/entry",
          scheme: null,
          nativeBuild: null,
          metro: {
            executable: "npx",
            args: ["expo", "start", "--go", "--localhost"],
            appId: "host.exp.Exponent",
            routeAuthority: "expo-go-project-url",
          },
          maestroFlowPaths: [],
          maestroFlows: [],
        },
        routes: [],
        scenarios: [],
        cacheKey: `sha256:${"f".repeat(64)}`,
        errors: [],
      },
      configuration: {
        kind: "expo-ios",
        runtime: "expo-go",
        bundleId: null,
        appConfigPath: "apps/mobile/app.json",
        entryPoint: "expo-router/entry",
        scheme: null,
        nativeBuild: null,
        metro: {
          executable: "npx",
          args: ["expo", "start", "--go", "--localhost"],
          appId: "host.exp.Exponent",
          routeAuthority: "expo-go-project-url",
        },
        maestroFlowPaths: [],
        maestroFlows: [],
      },
      applicationRoot,
      appDataRoot,
      nodeExecutable: "/opt/memi/node",
      npxExecutable: "/opt/memi/npx",
      simctlExecutable:
        "/Applications/Xcode.app/Contents/Developer/usr/bin/simctl",
      simulatorDeviceSetPath: join(
        appDataRoot,
        "sandbox",
        "home",
        "Library",
        "Developer",
        "CoreSimulator",
        "Devices",
      ),
      maestroExecutable: "/opt/memi/maestro",
      artifactStore: new ContentAddressedArtifactStore(
        join(appDataRoot, "artifacts"),
      ),
      commandPort: {
        execute: vi.fn(async () => ({
          stdout: new Uint8Array(),
          stderr: "",
        })),
      },
      processStarter: {
        start: vi.fn((_recipe, policy) => {
          capturedPolicies.push(policy);
          return {
            child: {
              pid: 42,
              stdout: null,
              stderr: null,
              once: vi.fn(),
            },
            cancel: vi.fn(),
            cancelled: Promise.resolve(),
          };
        }),
      },
      portLease: {
        acquire: vi.fn(async () => 19_000),
        release: vi.fn(async () => undefined),
      },
      simulatorPort: {
        selectBootedIphone: vi.fn(async () => ({
          deviceId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          name: "Memi Canvas Capture iPhone",
          runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-5",
        })),
      },
      waitForMetro: vi.fn(async () => undefined),
    });
    if (adapter === null) {
      throw new Error("Expo Go adapter factory unexpectedly returned null.");
    }
    const job = {
      ...jobFixture,
      repository: {
        rootPath: managedRoot,
        sourceRevision: "1".repeat(40),
        dirtyFingerprint: `sha256:${"2".repeat(64)}` as const,
      },
      applications: [],
      scenarios: [],
      stage: "prepare-fixtures" as const,
      progress: {
        total: 0,
        captured: 0,
        failed: 0,
        remaining: 0,
      },
      currentApplicationId: null,
      currentScenarioId: null,
    };
    const preparation = await adapter.prepare(
      {
        job,
        signal: new AbortController().signal,
      },
      {
        id: "app_expo_go_nested",
        label: "Expo Go nested",
        platform: "expo-ios",
        relativeRoot: "apps/mobile",
      },
      [],
    );
    await adapter.launch(
      {
        job: {
          ...job,
          stage: "launch",
        },
        signal: new AbortController().signal,
      },
      preparation,
    );

    expect(capturedPolicies).toHaveLength(1);
    expect(capturedPolicies[0]?.sandbox.allowedReadRoots).toContain(
      applicationRoot,
    );
    expect(capturedPolicies[0]?.sandbox.allowedWriteRoots).toContain(
      applicationRoot,
    );
    expect(capturedPolicies[0]?.sandboxEnvironment.path).toBe(
      "/opt/memi:/usr/bin:/bin",
    );
    expect(capturedPolicies[0]?.sandbox.allowedReadMetadataRoots).toContain(
      dirname(homedir()),
    );
    expect(capturedPolicies[0]?.sandbox.allowedReadMetadataRoots).toContain(
      dirname(dirname(applicationRoot)),
    );
    expect(capturedPolicies[0]?.sandbox.allowedReadLiterals).toContain(
      "/private/var/select/sh",
    );
  });

  it("routes development-client simulator commands through the direct port", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-direct-simctl-adapter-"));
    const appDataRoot = join(root, "app-data");
    const managedRoot = join(root, "managed");
    await Promise.all([
      mkdir(appDataRoot, { recursive: true }),
      mkdir(managedRoot, { recursive: true }),
      mkdir(join(managedRoot, "app"), { recursive: true }),
    ]);
    await writeFile(
      join(managedRoot, "app", "_layout.tsx"),
      [
        'import { Stack } from "expo-router";',
        'import { View } from "react-native";',
        "const RootLayout = () => <View><Stack /></View>;",
        "export default RootLayout;",
        "",
      ].join("\n"),
    );
    const directExecute = vi.fn(async (recipe: {
      readonly args: readonly string[];
    }) => {
      const argumentsKey = recipe.args.join("\0");
      if (recipe.args[0] === "pbpaste") {
        const metadata = JSON.parse(
          await readFile(
            join(
              managedRoot,
              ".memi/capture/runtime-attestation/metadata.json",
            ),
            "utf8",
          ),
        ) as Readonly<{ readonly readinessToken: string }>;
        return {
          stdout: new TextEncoder().encode(
            `MEMI_CAPTURE_READY_V1:${metadata.readinessToken}`,
          ),
          stderr: "",
        };
      }
      return {
        stdout: argumentsKey.includes(
          "defaults\0read\0com.apple.Accessibility\0ReduceMotionEnabled",
        )
          ? new TextEncoder().encode("0")
          : new Uint8Array(),
        stderr: "",
      };
    });
    const sandboxedExecute = vi.fn(async () => {
      throw new Error("development-client simctl must not use sandbox-exec");
    });
    const application = {
      id: "app_direct_client",
      label: "Direct client",
      platform: "expo-ios" as const,
      relativeRoot: ".",
    };
    const configuration = {
      kind: "expo-ios",
      runtime: "development-client",
      bundleId: "com.example.client",
      appConfigPath: "app.json",
      entryPoint: "expo-router/entry",
      scheme: "example",
      nativeBuild: null,
      metro: {
        executable: "npx",
        args: ["expo", "start", "--dev-client", "--localhost"],
        appId: "com.example.client",
        routeAuthority: "expo-development-client-url" as const,
        scheme: "example",
      },
      maestroFlowPaths: [],
      maestroFlows: [],
    };
    const adapter = createExpoGoCaptureAdapter({
      application,
      unit: { captureConfiguration: configuration } as never,
      configuration,
      applicationRoot: managedRoot,
      appDataRoot,
      nodeExecutable: "/opt/memi/node",
      npxExecutable: "/opt/memi/npx",
      simctlExecutable: "/opt/memi/simctl",
      maestroExecutable: "/opt/memi/maestro",
      artifactStore: new ContentAddressedArtifactStore(join(appDataRoot, "artifacts")),
      commandPort: { execute: sandboxedExecute },
      directSimulator: true,
      // The factory must carry this separate, already allowlisted port into
      // the adapter; cast keeps this red before the authority is extended.
      directSimulatorCommandPort: { execute: directExecute },
      processStarter: {
        start: vi.fn(() => ({
          child: { pid: 11, stdout: null, stderr: null, once: vi.fn() },
          cancel: vi.fn(),
          cancelled: Promise.resolve(),
        })),
      },
      processPolicy: {} as never,
      portLease: {
        acquire: vi.fn(async () => 19_001),
        release: vi.fn(async () => undefined),
      },
      simulatorPort: {
        selectBootedIphone: vi.fn(async () => ({
          deviceId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          name: "iPhone",
          runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-5",
        })),
      },
      waitForMetro: vi.fn(async () => undefined),
    } as never);
    if (adapter === null) throw new Error("Expected direct client adapter.");
    const context = {
      job: {
        ...jobFixture,
        repository: {
          rootPath: managedRoot,
          sourceRevision: "a6ce2458e0cd1b252663057f2e4060f0929c0687",
          dirtyFingerprint: `sha256:${"1".repeat(64)}` as const,
        },
      },
      signal: new AbortController().signal,
    } as never;
    const preparation = await adapter.prepare(context, application, []);
    const launch = await adapter.launch(context, preparation);
    await adapter.cleanup(context, launch);

    expect(directExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: "/opt/memi/simctl",
        args: [
          "openurl",
          "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          expect.stringMatching(/^example:\/\/expo-development-client/),
        ],
      }),
      expect.anything(),
      expect.any(AbortSignal),
    );
    expect(directExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "spawn",
          "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          "defaults",
          "write",
          "com.apple.Accessibility",
          "ReduceMotionEnabled",
          "-bool",
          "NO",
        ],
      }),
      expect.anything(),
      expect.any(AbortSignal),
    );
    expect(directExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "spawn",
          "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          "defaults",
          "write",
          "com.apple.Accessibility",
          "ReduceMotionEnabled",
          "-bool",
          "YES",
        ],
      }),
      expect.anything(),
      expect.any(AbortSignal),
    );
    expect(sandboxedExecute).not.toHaveBeenCalled();
  });
});
