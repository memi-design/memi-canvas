import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

import {
  approveNativeDependencyPreparationPlan,
  ContentAddressedArtifactStore,
  createNativeDependencyPreparationPlan,
} from "@memi/capture-execution";
import type {
  ProcessExecutionPolicy,
  ProcessRecipe,
} from "@memi/capture-execution";
import { describe, expect, it, vi } from "vitest";

import {
  jobFixture,
  scenarioFixture,
} from "../../../../packages/capture-execution/src/test-fixtures.js";
import {
  createReactWebCaptureAdapter,
  createNativeCapturePorts,
  type NativeCaptureSpawn,
} from "./native-capture-ports.js";
import { waitForLoopback } from "./native-capture-react.js";
import { discoverExecutable } from "./native-capture-process.js";

const sourceAnchorFixture = Object.freeze({
  relativePath: "Sources/DashboardView.swift",
  symbol: "DashboardView.body",
  contentHash: `sha256:${"b".repeat(64)}` as const,
});

const anchoredScenarioFixture = Object.freeze({
  ...scenarioFixture,
  sourceAnchor: sourceAnchorFixture,
});

interface SpawnFixtureOptions {
  readonly stdout?: Uint8Array;
  readonly stdoutFor?: (
    executable: string,
    args: readonly string[],
  ) => Uint8Array;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly onSpawn?: (
    executable: string,
    args: readonly string[],
  ) => Promise<void> | void;
}

function spawnFixture(
  options: SpawnFixtureOptions = {},
): NativeCaptureSpawn {
  return vi.fn((executable, args) => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.pid = 4_242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setTimeout(() => {
      void (async () => {
        await options.onSpawn?.(executable, args);
        child.stdout.end(Buffer.from(
          options.stdoutFor?.(executable, args) ??
            options.stdout ??
            new Uint8Array(),
        ));
        child.stderr.end(options.stderr ?? "");
        child.emit("exit", options.exitCode ?? 0, null);
      })();
    }, 0);
    return child;
  });
}

async function executable(path: string): Promise<string> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

async function fixture(
  spawn: NativeCaptureSpawn = spawnFixture(),
  maximumCommandOutputBytes = 1_024,
) {
  const parent = await mkdtemp(join(tmpdir(), "memi-native-ports-"));
  const appDataRoot = join(parent, "app-data");
  const managedWorktreeRoot = join(parent, "worktree");
  await mkdir(appDataRoot);
  await mkdir(managedWorktreeRoot);
  const toolRoot = join(appDataRoot, "tools");
  const node = await executable(join(toolRoot, "node"));
  const xcrun = await executable(join(toolRoot, "xcrun"));
  const simctl = await executable(join(toolRoot, "simctl"));
  const xcodebuild = await executable(join(toolRoot, "xcodebuild"));
  const maestro = await executable(join(toolRoot, "maestro"));
  const npm = await executable(join(toolRoot, "npm"));
  const npx = await executable(join(toolRoot, "npx"));
  const pod = await executable(join(toolRoot, "pod"));
  const xcuiRunner = await executable(join(toolRoot, "memi-xcui-capture"));
  const kill = vi.fn();
  const artifactStore = new ContentAddressedArtifactStore(
    join(appDataRoot, "artifacts"),
  );
  const ports = await createNativeCapturePorts({
    appDataRoot,
    managedWorktreeRoot,
    artifactStore,
    toolExecutables: {
      maestro,
      node,
      npm,
      npx,
      pod,
      xcodebuild,
      xcrun,
      simctl,
      xcuiRunner,
    },
    maximumCommandOutputBytes,
    terminationGraceMs: 0,
    dependencies: {
      spawn,
      kill,
      setTimer: (callback) => {
        callback();
        return 1;
      },
      clearTimer: vi.fn(),
    },
  });
  return {
    appDataRoot,
    artifactStore,
    kill,
    managedWorktreeRoot,
    ports,
    spawn,
    tools: {
      maestro,
      node,
      npm,
      npx,
      pod,
      simctl,
      xcodebuild,
      xcrun,
      xcuiRunner,
    },
  };
}

function sandboxedRecipe(
  cwd: string,
  executable: string,
  args: readonly string[],
): ProcessRecipe {
  return {
    executable: "/usr/bin/sandbox-exec",
    args: ["-p", "(version 1)\n(deny default)", executable, ...args],
    cwd,
    environment: {
      HOME: join(cwd, ".home"),
      PATH: "",
      TMPDIR: join(cwd, ".tmp"),
    },
  };
}

function processPolicy(
  root: string,
  npm: string,
): ProcessExecutionPolicy {
  return {
    allowedCommands: [
      {
        executable: npm,
        arguments: [{ kind: "literal", value: "run" }],
      },
    ],
    allowedCwdRoots: [root],
    sandboxEnvironment: {
      home: join(root, ".home"),
      temporaryDirectory: join(root, ".tmp"),
      path: "",
    },
    sandbox: {
      executable: "/usr/bin/sandbox-exec",
      allowedReadRoots: [root, "/System", "/usr"],
      allowedWriteRoots: [root],
      network: "loopback",
    },
  };
}

describe("createNativeCapturePorts", () => {
  it("executes only contained structured recipes with bounded output", async () => {
    const stdout = new Uint8Array([137, 80, 78, 71]);
    const state = await fixture(spawnFixture({ stdout, stderr: "note" }));
    const result = await state.ports.commandPort.execute(
      sandboxedRecipe(
        state.managedWorktreeRoot,
        state.tools.xcrun,
        ["simctl", "io", "SIMULATOR", "screenshot", "-"],
      ),
      new AbortController().signal,
    );

    expect(result).toEqual({ stdout, stderr: "note" });
    expect(state.spawn).toHaveBeenCalledWith(
      "/usr/bin/sandbox-exec",
      expect.any(Array),
      expect.objectContaining({
        cwd: expect.stringContaining("worktree"),
        detached: true,
        shell: false,
      }),
    );
    expect(state.kill).toHaveBeenCalledWith(-4_242, "SIGKILL");
    await expect(
      state.ports.commandPort.execute(
        sandboxedRecipe(
          state.managedWorktreeRoot,
          "/usr/bin/git",
          ["--version"],
        ),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ stdout, stderr: "note" });
    await expect(
      state.ports.commandPort.execute(
        sandboxedRecipe("/tmp/outside", state.tools.xcrun, []),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/contained|worktree|app data/i);
    await expect(
      state.ports.commandPort.execute(
        sandboxedRecipe(
          state.managedWorktreeRoot,
          "/bin/sh",
          ["-c", "touch /tmp/escaped"],
        ),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/allowlist|executable/i);
  });

  it("cancels process groups and rejects oversized native evidence", async () => {
    const oversized = new Uint8Array(9);
    const state = await fixture(spawnFixture({ stdout: oversized }), 8);

    await expect(
      state.ports.commandPort.execute(
        sandboxedRecipe(
          state.managedWorktreeRoot,
          state.tools.xcrun,
          ["simctl", "io", "SIMULATOR", "screenshot", "-"],
        ),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/output.*limit/i);
    expect(state.kill).toHaveBeenCalledWith(-4_242, "SIGTERM");
    expect(state.kill).toHaveBeenCalledWith(-4_242, "SIGKILL");
  });

  it("provides a contained cancellable React process starter", async () => {
    const state = await fixture();
    const controller = new AbortController();
    const running = state.ports.processStarter.start(
      {
        executable: state.tools.npm,
        args: ["run"],
        cwd: state.managedWorktreeRoot,
      },
      processPolicy(state.managedWorktreeRoot, state.tools.npm),
      controller.signal,
    );
    controller.abort();
    await running.cancelled;

    expect(state.spawn).toHaveBeenCalledWith(
      "/usr/bin/sandbox-exec",
      expect.any(Array),
      expect.objectContaining({ detached: true, shell: false }),
    );
    expect(state.kill).toHaveBeenCalledWith(-4_242, "SIGTERM");
  });

  it("limits the development-client fallback to its exact approved launcher", async () => {
    const state = await fixture();
    const controller = new AbortController();
    const port = await state.ports.portLease.acquire(controller.signal);
    const launchPolicy: ProcessExecutionPolicy = {
      ...processPolicy(state.managedWorktreeRoot, state.tools.npx),
      allowedCommands: [{
        executable: state.tools.npx,
        arguments: [
          { kind: "literal", value: "run" },
          { kind: "literal", value: "--port" },
          { kind: "integer", minimum: 1, maximum: 65_535 },
        ],
      }],
    };
    const running = state.ports.developmentClientProcessStarter.start(
      {
        executable: state.tools.npx,
        args: ["run", "--port", String(port)],
        cwd: state.managedWorktreeRoot,
      },
      launchPolicy,
      controller.signal,
    );
    await running.cancelled;

    const canonicalNpx = await realpath(state.tools.npx);
    const canonicalWorktree = await realpath(state.managedWorktreeRoot);
    expect(state.spawn).toHaveBeenCalledWith(
      canonicalNpx,
      ["run", "--port", String(port)],
      expect.objectContaining({
        cwd: canonicalWorktree,
        detached: true,
        shell: false,
      }),
    );
    expect(state.spawn).not.toHaveBeenCalledWith(
      "/usr/bin/sandbox-exec",
      expect.any(Array),
      expect.anything(),
    );
    const metroPort = createServer();
    await new Promise<void>((resolvePromise, reject) => {
      metroPort.once("error", reject);
      metroPort.listen(port, "127.0.0.1", resolvePromise);
    });
    await new Promise<void>((resolvePromise, reject) => {
      metroPort.close((error) => {
        if (error === undefined) resolvePromise();
        else reject(error);
      });
    });
    await expect(state.ports.portLease.release(port)).resolves.toBeUndefined();
    expect(() =>
      state.ports.developmentClientProcessStarter.start(
        {
          executable: "/bin/sh",
          args: ["-c", "echo unsafe"],
          cwd: state.managedWorktreeRoot,
        },
        processPolicy(state.managedWorktreeRoot, state.tools.npx),
        new AbortController().signal,
      ),
    ).toThrow(/allowlist|exact/i);
  });

  it("constructs a production React adapter from explicit worktree authority", async () => {
    const state = await fixture();
    const closeBrowser = vi.fn(async () => undefined);
    const waitForLoopback = vi.fn(async () => undefined);
    const application = {
      id: "app_react",
      label: "React fixture",
      platform: "react-web" as const,
      relativeRoot: ".",
    };
    const unit = {
      applicationId: "app_react",
      platform: "react-web",
      root: ".",
      displayName: "React fixture",
      status: "supported",
      pipelineStages: [],
      manifestPaths: ["package.json"],
      buildRecipe: {
        executable: "npm",
        args: [
          "run",
          "dev",
          "--",
          "--host",
          "127.0.0.1",
          "--port",
          "{leasedPort}",
        ],
        cwd: ".",
        purpose: "launch",
      },
      routes: [],
      scenarios: [],
      cacheKey: `sha256:${"a".repeat(64)}`,
      errors: [],
    } as const;
    const adapter = createReactWebCaptureAdapter({
      application,
      unit,
      managedRootPath: await realpath(state.managedWorktreeRoot),
      applicationRoot: await realpath(state.managedWorktreeRoot),
      executable: state.ports.executables.npm!,
      appDataRoot: await realpath(state.appDataRoot),
      artifactStore: state.artifactStore,
      processStarter: state.ports.processStarter,
      portLease: state.ports.portLease,
      browserLauncher: {
        launch: async () => ({
          newPage: vi.fn(),
          close: closeBrowser,
        }) as never,
      },
      waitForLoopback,
    });

    expect(adapter.metadata).toMatchObject({
      id: "playwright-react-web",
      platform: "react-web",
    });
    await expect(adapter.discover({} as never)).resolves.toEqual([
      application,
    ]);
    const context = {
      job: {
        id: "import-react",
        repository: { sourceRevision: "revision-1" },
      },
      signal: new AbortController().signal,
    } as never;
    const preparation = await adapter.prepare(context, application, []);
    const launch = await adapter.launch(context, preparation);
    expect(waitForLoopback).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/u),
      expect.any(AbortSignal),
    );
    expect(state.spawn).toHaveBeenCalledWith(
      "/usr/bin/sandbox-exec",
      expect.arrayContaining([
        state.ports.executables.npm,
        "run",
        "dev",
        "--host",
        "127.0.0.1",
      ]),
      expect.objectContaining({ shell: false }),
    );
    await adapter.cleanup(context, launch);
    expect(closeBrowser).toHaveBeenCalledOnce();
    expect(
      state.ports.adapterFor(application, unit, {
        managedRootPath: await realpath(state.managedWorktreeRoot),
        applicationRootPath: await realpath(
          state.managedWorktreeRoot,
        ),
      }),
    ).not.toBeNull();
    expect(
      state.ports.adapterFor(
        { ...application, platform: "expo-ios" },
        { ...unit, platform: "expo-ios" },
        {
          managedRootPath: await realpath(
            state.managedWorktreeRoot,
          ),
          applicationRootPath: await realpath(
            state.managedWorktreeRoot,
          ),
        },
      ),
    ).toBeNull();
  });

  it("leases distinct loopback ports and releases them explicitly", async () => {
    const state = await fixture();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = await state.ports.portLease.acquire(
      firstController.signal,
    );
    const second = await state.ports.portLease.acquire(
      secondController.signal,
    );

    expect(first).not.toBe(second);
    expect(first).toBeGreaterThan(0);
    const competingServer = createServer();
    await expect(
      new Promise<void>((resolvePromise, reject) => {
        competingServer.once("error", reject);
        competingServer.listen(first, "127.0.0.1", resolvePromise);
      }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
    await expect(state.ports.portLease.release(first)).resolves.toBeUndefined();
    await expect(state.ports.portLease.release(first)).rejects.toThrow(
      /lease/i,
    );
    secondController.abort();
    await expect(state.ports.portLease.release(second)).rejects.toThrow(
      /lease/i,
    );
    const releasedServer = createServer();
    await new Promise<void>((resolvePromise, reject) => {
      releasedServer.once("error", reject);
      releasedServer.listen(first, "127.0.0.1", resolvePromise);
    });
    await new Promise<void>((resolvePromise, reject) => {
      releasedServer.close((error) => {
        if (error === undefined) {
          resolvePromise();
        } else {
          reject(error);
        }
      });
    });
  });

  it("creates a dedicated managed simulator instead of selecting a user device", async () => {
    const encoder = new TextEncoder();
    const managedId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const state = await fixture(spawnFixture({
      stdoutFor: (_executable, args) => {
        if (args.includes("runtimes")) {
          return encoder.encode(JSON.stringify({
            runtimes: [{
              identifier:
                "com.apple.CoreSimulator.SimRuntime.iOS-18-5",
              version: "18.5",
              isAvailable: true,
            }],
          }));
        }
        if (args.includes("devicetypes")) {
          return encoder.encode(JSON.stringify({
            devicetypes: [{
              identifier:
                "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro",
              name: "iPhone 16 Pro",
              productFamily: "iPhone",
            }],
          }));
        }
        if (args.includes("devices")) {
          return encoder.encode(JSON.stringify({
            devices: {
              "com.apple.CoreSimulator.SimRuntime.iOS-18-5": [{
                name: "User iPhone",
                udid: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
                state: "Booted",
                isAvailable: true,
              }],
            },
          }));
        }
        return args.includes("create")
          ? encoder.encode(managedId)
          : new Uint8Array();
      },
    }));

    await expect(
      state.ports.simulatorPort.selectBootedIphone(
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      deviceId: managedId,
      name: "Memi Canvas Capture iPhone",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-5",
    });
  });

  it("runs the trusted XCUITest helper and bounds contained evidence reads", async () => {
    let appDataRoot = "";
    const spawn = spawnFixture({
      async onSpawn(_executable, args) {
        const outputFlag = args.indexOf("--output");
        const outputPath = args[outputFlag + 1]!;
        const evidenceRoot = join(appDataRoot, "capture-evidence");
        const hierarchyPath = join(evidenceRoot, "hierarchy.json");
        const geometryPath = join(evidenceRoot, "geometry.json");
        await mkdir(evidenceRoot, { recursive: true });
        await writeFile(hierarchyPath, '{"role":"application"}');
        await writeFile(geometryPath, '{"nodes":[]}');
        await writeFile(
          outputPath,
          JSON.stringify({
            route: anchoredScenarioFixture.route,
            state: anchoredScenarioFixture.state,
            readinessMatched: true,
            blank: false,
            splash: false,
            errorBoundary: false,
            sourceAnchor: sourceAnchorFixture,
            hierarchyPath,
            geometryPath,
          }),
        );
      },
    });
    const state = await fixture(spawn);
    appDataRoot = state.appDataRoot;
    const xcui = state.ports.createXcuiTestPort({
      maximumEvidenceBytes: 1_024,
    });
    const evidence = await xcui.runScenario(
      {
        deviceId: "BOOTED-IPHONE",
        bundleId: "design.memi.fixture",
        launchId: "launch-123",
        scenario: anchoredScenarioFixture,
      },
      new AbortController().signal,
    );

    expect(new TextDecoder().decode(evidence.hierarchy)).toContain(
      "application",
    );
    expect(evidence.sourceAnchor).toEqual(sourceAnchorFixture);
    expect(
      vi.mocked(spawn).mock.calls[0]?.[2],
    ).toMatchObject({ shell: false, detached: true });
  });

  it("rejects missing or mismatched XCUITest source evidence", async () => {
    const runWithSourceAnchor = async (
      sourceAnchor: unknown,
      launchId: string,
    ) => {
      let appDataRoot = "";
      const state = await fixture(spawnFixture({
        async onSpawn(_executable, args) {
          const outputPath = args[args.indexOf("--output") + 1]!;
          const evidenceRoot = join(appDataRoot, "capture-evidence");
          const hierarchyPath = join(evidenceRoot, "hierarchy.json");
          const geometryPath = join(evidenceRoot, "geometry.json");
          await mkdir(evidenceRoot, { recursive: true });
          await writeFile(hierarchyPath, "{}");
          await writeFile(geometryPath, "{}");
          await writeFile(outputPath, JSON.stringify({
            route: anchoredScenarioFixture.route,
            state: anchoredScenarioFixture.state,
            readinessMatched: true,
            blank: false,
            splash: false,
            errorBoundary: false,
            sourceAnchor,
            hierarchyPath,
            geometryPath,
          }));
        },
      }));
      appDataRoot = state.appDataRoot;
      return state.ports.createXcuiTestPort().runScenario(
        {
          deviceId: "BOOTED-IPHONE",
          bundleId: "design.memi.fixture",
          launchId,
          scenario: anchoredScenarioFixture,
        },
        new AbortController().signal,
      );
    };

    await expect(
      runWithSourceAnchor(undefined, "missing-source"),
    ).rejects.toThrow(/evidence envelope is invalid/i);
    await expect(
      runWithSourceAnchor(
        {
          ...sourceAnchorFixture,
          contentHash: `sha256:${"d".repeat(64)}`,
        },
        "mismatched-source",
      ),
    ).rejects.toThrow(/source evidence does not match/i);
  });

  it("describes canonical recipe authority and rejects symlinked roots", async () => {
    const state = await fixture();
    const application = {
      id: "app_react",
      label: "React",
      platform: "react-web" as const,
      relativeRoot: ".",
    };
    const unit = {
      applicationId: "app_react",
      platform: "react-web",
      root: ".",
      displayName: "React",
      status: "supported",
      pipelineStages: [],
      manifestPaths: ["package.json"],
      buildRecipe: {
        executable: "npm",
        args: ["run", "dev", "--port", "{leasedPort}"],
        cwd: ".",
        purpose: "launch",
      },
      routes: [],
      scenarios: [],
      cacheKey: `sha256:${"c".repeat(64)}`,
      errors: [],
    } as const;
    const managedRootPath = await realpath(state.managedWorktreeRoot);
    const adapter = state.ports.adapterFor(application, unit, {
      managedRootPath,
      applicationRootPath: managedRootPath,
    });
    expect(adapter).not.toBeNull();
    const describe = (cwd: string) =>
      state.ports.approvalAuthority.describe({
        application,
        unit,
        adapter: adapter!,
        recipe: { ...unit.buildRecipe, cwd },
      });
    const authority = await describe(".");
    expect(authority.resolvedExecutable).toBe(
      state.ports.executables.npm,
    );
    expect(authority.environmentFingerprint).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(state.ports.approvalAuthority.createNonce()).toMatch(
      /^[a-f0-9]{32}$/u,
    );
    expect(
      state.ports.approvalAuthority.expiresAt(
        new Date("2026-07-30T00:00:00.000Z"),
      ),
    ).toBe("2026-07-30T00:10:00.000Z");
    await expect(describe(managedRootPath)).resolves.toMatchObject({
      resolvedExecutable: state.ports.executables.npm,
    });
    await expect(describe("/")).rejects.toThrow(/cwd|managed application/i);
    const outsideCwd = await mkdtemp(join(tmpdir(), "memi-cwd-outside-"));
    await expect(describe(outsideCwd)).rejects.toThrow(
      /managed application/i,
    );

    const parent = await mkdtemp(join(tmpdir(), "memi-native-link-"));
    const outside = await mkdtemp(join(tmpdir(), "memi-native-outside-"));
    const linked = join(parent, "linked");
    await symlink(outside, linked);
    await expect(
      createNativeCapturePorts({
        appDataRoot: linked,
        managedWorktreeRoot: state.managedWorktreeRoot,
        artifactStore: state.artifactStore,
      }),
    ).rejects.toThrow(/symbolic link|real directory/i);
  });

  it("recreates only the missing target of the exact owned simulator diagnostic link", async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "memi-native-broken-simulator-link-"),
    );
    const appDataRoot = join(parent, "app-data");
    const managedWorktreeRoot = join(parent, "worktree");
    const simulatorDeviceSetPath = join(
      appDataRoot,
      "sandbox",
      "home",
      "Library",
      "Developer",
      "CoreSimulator",
      "Devices",
    );
    const ownedDeviceSetPath = join(
      appDataRoot,
      "capture-simulator",
      "device-set",
    );
    await Promise.all([
      mkdir(join(simulatorDeviceSetPath, ".."), {
        recursive: true,
      }),
      mkdir(managedWorktreeRoot),
    ]);
    await symlink(
      "../../../../../capture-simulator/device-set",
      simulatorDeviceSetPath,
      "dir",
    );

    await expect(
      createNativeCapturePorts({
        appDataRoot,
        managedWorktreeRoot,
        artifactStore: new ContentAddressedArtifactStore(
          join(appDataRoot, "artifacts"),
        ),
      }),
    ).resolves.toMatchObject({});

    expect(
      (await lstat(simulatorDeviceSetPath)).isSymbolicLink(),
    ).toBe(true);
    await expect(readlink(simulatorDeviceSetPath)).resolves.toBe(
      "../../../../../capture-simulator/device-set",
    );
    expect((await lstat(ownedDeviceSetPath)).isDirectory()).toBe(true);
    expect((await lstat(ownedDeviceSetPath)).mode & 0o777).toBe(0o700);
  });

  it("accepts the existing exact owned simulator diagnostic link target without recreating the symlink path", async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "memi-native-existing-simulator-link-"),
    );
    const appDataRoot = join(parent, "app-data");
    const managedWorktreeRoot = join(parent, "worktree");
    const simulatorDeviceSetPath = join(
      appDataRoot,
      "sandbox",
      "home",
      "Library",
      "Developer",
      "CoreSimulator",
      "Devices",
    );
    const ownedDeviceSetPath = join(
      appDataRoot,
      "capture-simulator",
      "device-set",
    );
    await Promise.all([
      mkdir(join(simulatorDeviceSetPath, ".."), {
        recursive: true,
      }),
      mkdir(ownedDeviceSetPath, {
        recursive: true,
      }),
      mkdir(managedWorktreeRoot),
    ]);
    await symlink(
      "../../../../../capture-simulator/device-set",
      simulatorDeviceSetPath,
      "dir",
    );

    await expect(
      createNativeCapturePorts({
        appDataRoot,
        managedWorktreeRoot,
        artifactStore: new ContentAddressedArtifactStore(
          join(appDataRoot, "artifacts"),
        ),
      }),
    ).resolves.toMatchObject({});

    expect(
      (await lstat(simulatorDeviceSetPath)).isSymbolicLink(),
    ).toBe(true);
    await expect(readlink(simulatorDeviceSetPath)).resolves.toBe(
      "../../../../../capture-simulator/device-set",
    );
    expect((await lstat(ownedDeviceSetPath)).isDirectory()).toBe(true);
    expect((await lstat(ownedDeviceSetPath)).mode & 0o777).toBe(0o700);
  });

  it("rejects any non-owned simulator diagnostic link without touching its target", async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "memi-native-unsafe-simulator-link-"),
    );
    const appDataRoot = join(parent, "app-data");
    const managedWorktreeRoot = join(parent, "worktree");
    const externalTarget = join(parent, "external-device-set");
    const sentinel = join(externalTarget, "sentinel");
    const simulatorDeviceSetPath = join(
      appDataRoot,
      "sandbox",
      "home",
      "Library",
      "Developer",
      "CoreSimulator",
      "Devices",
    );
    await Promise.all([
      mkdir(join(simulatorDeviceSetPath, ".."), {
        recursive: true,
      }),
      mkdir(managedWorktreeRoot),
      mkdir(externalTarget),
    ]);
    await writeFile(sentinel, "preserve");
    await symlink(externalTarget, simulatorDeviceSetPath, "dir");

    await expect(
      createNativeCapturePorts({
        appDataRoot,
        managedWorktreeRoot,
        artifactStore: new ContentAddressedArtifactStore(
          join(appDataRoot, "artifacts"),
        ),
      }),
    ).rejects.toThrow(/diagnostic|symbolic|owned/u);
    await expect(readlink(simulatorDeviceSetPath)).resolves.toBe(
      externalTarget,
    );
    await expect(lstat(sentinel)).resolves.toMatchObject({});
  });

  it("rejects symbolic simulator ancestors before creating an owned target", async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "memi-native-unsafe-simulator-parent-"),
    );
    const appDataRoot = join(parent, "app-data");
    const managedWorktreeRoot = join(parent, "worktree");
    const externalTarget = join(parent, "external-simulator-state");
    const sentinel = join(externalTarget, "sentinel");
    await Promise.all([
      mkdir(appDataRoot),
      mkdir(managedWorktreeRoot),
      mkdir(externalTarget),
    ]);
    await writeFile(sentinel, "preserve");
    await symlink(
      externalTarget,
      join(appDataRoot, "capture-simulator"),
      "dir",
    );

    await expect(
      createNativeCapturePorts({
        appDataRoot,
        managedWorktreeRoot,
        artifactStore: new ContentAddressedArtifactStore(
          join(appDataRoot, "artifacts"),
        ),
      }),
    ).rejects.toThrow(/canonical|symbolic|app data/u);
    await expect(lstat(sentinel)).resolves.toMatchObject({});
    await expect(
      lstat(join(externalTarget, "device-set")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed for cancelled and malformed native execution", async () => {
    const state = await fixture();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      state.ports.commandPort.execute(
        sandboxedRecipe(
          state.managedWorktreeRoot,
          state.tools.xcrun,
          [],
        ),
        cancelled.signal,
      ),
    ).rejects.toThrow(/cancelled/i);
    await expect(
      state.ports.commandPort.execute(
        sandboxedRecipe(
          state.managedWorktreeRoot,
          state.tools.xcrun,
          ["bad\nargument"],
        ),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/argument/i);
    await expect(
      state.ports.commandPort.execute(
        {
          ...sandboxedRecipe(
            state.managedWorktreeRoot,
            state.tools.xcrun,
            [],
          ),
          environment: { unsafe: "value" },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/environment/i);
  });

  it("rejects missing simulator support and invalid XCUITest authority", async () => {
    const state = await fixture(
      spawnFixture({
        stdout: new TextEncoder().encode('{"devices":{}}'),
      }),
    );
    await expect(
      state.ports.simulatorPort.selectBootedIphone(
        new AbortController().signal,
      ),
    ).rejects.toThrow(/supported available iOS runtime/i);
    await expect(
      state.ports.createXcuiTestPort().runScenario(
        {
          deviceId: "../escape",
          bundleId: "design.memi.fixture",
          launchId: "launch",
          scenario: scenarioFixture,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/identifiers/i);
    expect(
      state.ports.adapterFor(
        {
          id: "react",
          label: "React",
          platform: "react-web",
          relativeRoot: ".",
        },
        {
          platform: "react-web",
          status: "supported",
          buildRecipe: {
            executable: "npm",
          },
        } as never,
        {
          managedRootPath: "/tmp/outside",
          applicationRootPath: "/tmp/outside",
        },
      ),
    ).toBeNull();
  });

  it("waits only for a loopback HTTP endpoint and honors cancellation", async () => {
    const server = createServer((socket) => {
      socket.end("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
    });
    await new Promise<void>((resolvePromise) => {
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Test loopback server did not bind.");
    }
    await expect(
      waitForLoopback(
        `http://127.0.0.1:${address.port}/`,
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    server.close();
    server.unref();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      waitForLoopback("http://127.0.0.1:1/", cancelled.signal),
    ).rejects.toThrow(/cancelled/i);
    for (const unsafe of [
      "https://127.0.0.1:4173/",
      "http://example.com:4173/",
      "http://user:secret@127.0.0.1:4173/",
      "http://127.0.0.1/",
    ]) {
      await expect(
        waitForLoopback(unsafe, new AbortController().signal),
      ).rejects.toThrow(/loopback HTTP/i);
    }
  });

  it("rejects every ambiguous React and native authority branch", async () => {
    const state = await fixture();
    const application = {
      id: "react",
      label: "React",
      platform: "react-web" as const,
      relativeRoot: ".",
    };
    const baseUnit = {
      platform: "react-web",
      status: "supported",
      root: ".",
      buildRecipe: { executable: "npm" },
    };
    const context = {
      managedRootPath: await realpath(state.managedWorktreeRoot),
      applicationRootPath: await realpath(state.managedWorktreeRoot),
    };
    for (const unit of [
      { ...baseUnit, platform: "expo-ios" },
      { ...baseUnit, status: "unsupported" },
      { ...baseUnit, buildRecipe: { executable: "npx" } },
    ]) {
      expect(
        state.ports.adapterFor(application, unit as never, context),
      ).toBeNull();
    }
    const outside = await mkdtemp(join(tmpdir(), "memi-outside-root-"));
    expect(
      state.ports.adapterFor(application, baseUnit as never, {
        managedRootPath: outside,
        applicationRootPath: outside,
      }),
    ).toBeNull();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      state.ports.portLease.acquire(aborted.signal),
    ).rejects.toThrow(/cancelled/i);
    await expect(
      state.ports.approvalAuthority.describe({
        application,
        unit: baseUnit as never,
        adapter: {
          metadata: { id: "react", version: "1" },
        } as never,
        recipe: {
          executable: "npm",
          args: [],
          cwd: "../escape",
          purpose: "launch",
        },
      }),
    ).rejects.toThrow(/cwd/i);
    for (const input of [
      {
        deviceId: "device",
        bundleId: "../bundle",
        launchId: "launch",
      },
      {
        deviceId: "device",
        bundleId: "design.memi",
        launchId: "../launch",
      },
    ]) {
      await expect(
        state.ports.createXcuiTestPort().runScenario(
          { ...input, scenario: scenarioFixture },
          new AbortController().signal,
        ),
      ).rejects.toThrow(/identifiers/i);
    }
  });

  it("constructs standalone Expo only from explicit native authority", async () => {
    const state = await fixture();
    const application = {
      id: "expo",
      label: "Expo",
      platform: "expo-ios" as const,
      relativeRoot: ".",
    };
    const adapter = state.ports.adapterFor(
      application,
      {
        platform: "expo-ios",
        status: "supported",
        root: ".",
        captureConfiguration: {
          kind: "expo-ios",
          runtime: "standalone",
          bundleId: "app.buzzr",
          nativeBuild: {
            container: {
              kind: "project",
              relativePath: "ios/Buzzr.xcodeproj",
            },
            scheme: "Buzzr",
            configuration: "Release",
            derivedDataRelativePath: ".memi/DerivedData",
          },
          maestroFlows: [
            {
              mapping: "route",
              routePath: "/dashboard",
              relativePath: ".maestro/dashboard.yaml",
            },
          ],
        },
      } as never,
      {
        managedRootPath: await realpath(state.managedWorktreeRoot),
        applicationRootPath: await realpath(
          state.managedWorktreeRoot,
        ),
      },
    );
    expect(adapter?.metadata).toMatchObject({
      id: "maestro-expo-ios",
      platform: "expo-ios",
    });
    const swiftAdapter = state.ports.adapterFor(
      {
        id: "swift",
        label: "Swift",
        platform: "swiftui",
        relativeRoot: ".",
      },
      {
        platform: "swiftui",
        status: "supported",
        root: ".",
        captureConfiguration: {
          kind: "swiftui",
          container: {
            kind: "project",
            relativePath: "Fixture.xcodeproj",
          },
          scheme: "Fixture",
          derivedDataRelativePath: ".memi/DerivedData",
        },
      } as never,
      {
        managedRootPath: await realpath(state.managedWorktreeRoot),
        applicationRootPath: await realpath(
          state.managedWorktreeRoot,
        ),
      },
    );
    expect(swiftAdapter?.metadata).toMatchObject({
      id: "xcuitest-swiftui",
      platform: "swiftui",
    });
  });

  it("wires the approved dependency plan into standalone Expo and rejects drift before xcodebuild", async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "memi-native-dependency-wiring-"),
    );
    const appDataRoot = join(parent, "app-data");
    const managedWorktreeRoot = join(parent, "worktree");
    const iosRoot = join(managedWorktreeRoot, "ios");
    const toolRoot = join(parent, "tools");
    await Promise.all([
      mkdir(appDataRoot, { recursive: true }),
      mkdir(iosRoot, { recursive: true }),
      mkdir(
        join(toolRoot, "lib", "node_modules", "npm", "bin"),
        { recursive: true },
      ),
      mkdir(
        join(toolRoot, "lib", "node_modules", "npm", "lib"),
        { recursive: true },
      ),
      mkdir(join(toolRoot, "bin"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(managedWorktreeRoot, "package.json"),
        JSON.stringify({
          name: "expo-app",
          private: true,
          packageManager: "npm@10.9.2",
        }),
      ),
      writeFile(
        join(managedWorktreeRoot, "package-lock.json"),
        JSON.stringify({
          name: "expo-app",
          lockfileVersion: 3,
          packages: {},
        }),
      ),
      writeFile(join(iosRoot, "Podfile"), "platform :ios, '17.0'\n"),
      writeFile(join(iosRoot, "Podfile.lock"), "PODS:\n  - Expo\n"),
    ]);
    const npmCli = await executable(
      join(
        toolRoot,
        "lib",
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      ),
    );
    await writeFile(
      join(toolRoot, "lib", "node_modules", "npm", "lib", "cli.js"),
      "module.exports = () => undefined\n",
    );
    const npm = join(toolRoot, "bin", "npm");
    await symlink(npmCli, npm);
    const spawn = spawnFixture();
    const ports = await createNativeCapturePorts({
      appDataRoot,
      managedWorktreeRoot,
      artifactStore: new ContentAddressedArtifactStore(
        join(appDataRoot, "artifacts"),
      ),
      toolExecutables: {
        node: await executable(join(toolRoot, "bin", "node")),
        npm,
        pod: await executable(join(toolRoot, "bin", "pod")),
        npx: await executable(join(toolRoot, "bin", "npx")),
        maestro: await executable(join(toolRoot, "bin", "maestro")),
        simctl: await executable(join(toolRoot, "bin", "simctl")),
        xcodebuild: await executable(
          join(toolRoot, "bin", "xcodebuild"),
        ),
      },
      dependencies: {
        spawn,
        kill: vi.fn(),
        setTimer: () => 1,
        clearTimer: vi.fn(),
      },
    });
    const application = {
      id: "expo",
      label: "Expo",
      platform: "expo-ios" as const,
      relativeRoot: ".",
    };
    const unit = {
      applicationId: "expo",
      platform: "expo-ios",
      status: "supported",
      root: ".",
      captureConfiguration: {
        kind: "expo-ios",
        runtime: "standalone",
        bundleId: "design.memi.fixture",
        scheme: "MemiFixture",
        nativeBuild: {
          container: {
            kind: "project",
            relativePath: "ios/MemiFixture.xcodeproj",
          },
          scheme: "MemiFixture",
          configuration: "Release",
          derivedDataRelativePath: ".memi/DerivedData",
        },
        maestroFlows: [],
      },
    } as never;
    const canonicalRoot = await realpath(managedWorktreeRoot);
    const planningContext = {
      managedRootPath: canonicalRoot,
      applicationRootPath: canonicalRoot,
      repositoryRevision: "a".repeat(40),
    };
    const planningAdapter = ports.adapterFor(
      application,
      unit,
      planningContext,
    );
    expect(planningAdapter).not.toBeNull();
    const dependencyInput =
      await ports.nativeDependencyPreparationFor({
        application,
        unit,
        context: planningContext,
        adapter: planningAdapter!,
      });
    expect(dependencyInput).not.toBeNull();
    const plan = await createNativeDependencyPreparationPlan(
      dependencyInput!,
    );
    const approval = approveNativeDependencyPreparationPlan(plan, {
      approvedFingerprint: plan.fingerprint,
      approvedBy: "human:repository-import",
      approvedAt: "2026-07-30T12:00:00.000Z",
    });
    await writeFile(
      join(managedWorktreeRoot, "package-lock.json"),
      JSON.stringify({
        name: "expo-app",
        lockfileVersion: 3,
        packages: {
          "node_modules/react": { version: "19.2.8" },
        },
      }),
    );
    const adapter = ports.adapterFor(application, unit, {
      ...planningContext,
      dependencyPreparation: { plan, approval },
    });
    expect(adapter).not.toBeNull();

    await expect(
      adapter!.prepare(
        {
          job: {
            ...jobFixture,
            applications: [application],
          },
          signal: new AbortController().signal,
        } as never,
        application,
        [],
      ),
    ).rejects.toThrow(/stale/u);
    expect(spawn).not.toHaveBeenCalled();
    expect(
      ports.adapterFor(application, unit, {
        ...planningContext,
        dependencyPreparation: null,
      }),
    ).toBeNull();
  });

  it("does not construct or execute SwiftUI capture when the packaged helper is absent", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-native-no-xcui-"));
    const appDataRoot = join(parent, "app-data");
    const managedWorktreeRoot = join(parent, "worktree");
    await mkdir(appDataRoot);
    await mkdir(managedWorktreeRoot);
    const toolRoot = join(appDataRoot, "tools");
    const spawn = spawnFixture();
    const ports = await createNativeCapturePorts({
      appDataRoot,
      managedWorktreeRoot,
      artifactStore: new ContentAddressedArtifactStore(
        join(appDataRoot, "artifacts"),
      ),
      toolExecutables: {
        maestro: await executable(join(toolRoot, "maestro")),
        npm: await executable(join(toolRoot, "npm")),
        npx: await executable(join(toolRoot, "npx")),
        xcodebuild: await executable(join(toolRoot, "xcodebuild")),
        xcrun: await executable(join(toolRoot, "xcrun")),
      },
      dependencies: {
        spawn,
        kill: vi.fn(),
        setTimer: (callback) => {
          callback();
          return 1;
        },
        clearTimer: vi.fn(),
      },
    });
    const application = {
      id: "swift",
      label: "Swift",
      platform: "swiftui" as const,
      relativeRoot: ".",
    };
    const adapter = ports.adapterFor(
      application,
      {
        platform: "swiftui",
        status: "supported",
        root: ".",
        captureConfiguration: {
          kind: "swiftui",
          container: {
            kind: "project",
            relativePath: "Fixture.xcodeproj",
          },
          scheme: "Fixture",
          derivedDataRelativePath: ".memi/DerivedData",
        },
      } as never,
      {
        managedRootPath: await realpath(managedWorktreeRoot),
        applicationRootPath: await realpath(managedWorktreeRoot),
      },
    );

    expect(ports.executables.xcuiRunner).toBeNull();
    expect(adapter).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("discovers the packaged XCUITest helper beside the runtime executable", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-native-packaged-xcui-"));
    const appDataRoot = join(parent, "app-data");
    const managedWorktreeRoot = join(parent, "worktree");
    const bundleRoot = join(parent, "Memi Canvas.app/Contents/MacOS");
    await mkdir(appDataRoot, { recursive: true });
    await mkdir(managedWorktreeRoot);
    const runtimeExecutablePath = await executable(
      join(bundleRoot, "memi-canvas-runtime"),
    );
    const helperPath = await executable(
      join(bundleRoot, "memi-xcui-capture"),
    );
    const ports = await createNativeCapturePorts({
      appDataRoot,
      managedWorktreeRoot,
      runtimeExecutablePath,
      artifactStore: new ContentAddressedArtifactStore(
        join(appDataRoot, "artifacts"),
      ),
    });

    await expect(realpath(helperPath)).resolves.toBe(
      ports.executables.xcuiRunner,
    );
  });

  it("enforces bounded configuration and unsuccessful command exits", async () => {
    const state = await fixture(spawnFixture({
      exitCode: 2,
      stderr:
        "xcode-select: unable to read /Users/example/private/repository",
    }));
    await expect(
      state.ports.commandPort.execute(
        sandboxedRecipe(
          state.managedWorktreeRoot,
          state.tools.xcrun,
          ["simctl", "list", "runtimes", "available", "--json"],
        ),
        new AbortController().signal,
      ),
    ).rejects.toThrow(
      /xcrun simctl list runtimes available --json exited unsuccessfully \(2\).*unable to read \[PATH_REDACTED\]/i,
    );
    await expect(
      createNativeCapturePorts({
        appDataRoot: state.appDataRoot,
        managedWorktreeRoot: state.managedWorktreeRoot,
        artifactStore: state.artifactStore,
        maximumCommandOutputBytes: 0,
      }),
    ).rejects.toThrow(/safe range/i);
    await expect(
      createNativeCapturePorts({
        appDataRoot: state.appDataRoot,
        managedWorktreeRoot: state.managedWorktreeRoot,
        artifactStore: state.artifactStore,
        terminationGraceMs: -1,
      }),
    ).rejects.toThrow(/safe range/i);
  });

  it("resolves trusted executable links and ignores poisoned PATH roots", async () => {
    const state = await fixture();
    const link = join(state.appDataRoot, "tools", "npm-link");
    await symlink(state.tools.npm, link);
    const linkedPorts = await createNativeCapturePorts({
      appDataRoot: state.appDataRoot,
      managedWorktreeRoot: state.managedWorktreeRoot,
      artifactStore: state.artifactStore,
      toolExecutables: {
        ...state.tools,
        npm: link,
      },
    });
    expect(linkedPorts.executables.npm).toBe(
      await realpath(state.tools.npm),
    );
    const poisoned = await mkdtemp(join(tmpdir(), "memi-path-poison-"));
    await chmod(poisoned, 0o777);
    await executable(join(poisoned, "npm"));
    await chmod(poisoned, 0o777);
    await expect(
      discoverExecutable("npm", poisoned, []),
    ).resolves.toBeNull();
  });

  it("uses the canonical target of a writable package-manager shim only when that target is trusted", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-tool-shim-"));
    const trustedRoot = join(parent, "trusted");
    const shimRoot = join(parent, "shim");
    await mkdir(trustedRoot);
    await mkdir(shimRoot);
    const trustedPod = await executable(join(trustedRoot, "pod"));
    await chmod(trustedRoot, 0o755);
    await symlink(trustedPod, join(shimRoot, "pod"));
    await chmod(shimRoot, 0o775);

    await expect(
      discoverExecutable("pod", shimRoot, []),
    ).resolves.toBe(await realpath(trustedPod));
  });
});
