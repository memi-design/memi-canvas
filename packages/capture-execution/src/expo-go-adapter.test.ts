import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  RuntimeCaptureScreenV1Schema,
  type CaptureScenarioV2,
} from "@memi/protocol";

import { ContentAddressedArtifactStore } from "./artifact-store.js";
import {
  ExpoGoCaptureAdapter,
  type ExpoGoCaptureAdapterOptions,
} from "./expo-go-adapter.js";
import type { NativeCommandPort } from "./expo-maestro-adapter.js";
import type {
  ProcessExecutionPolicy,
  ProcessRecipe,
  RunningProcessGroup,
} from "./process-policy.js";
import type {
  PortLease,
  ProcessStarter,
} from "./react-web-adapter.js";
import {
  jobFixture,
  scenarioFixture,
} from "./test-fixtures.js";

const application = Object.freeze({
  id: "expo",
  label: "Expo Go",
  platform: "expo-ios" as const,
  relativeRoot: ".",
});

function runtimeEvidence(
  scenario: CaptureScenarioV2,
  overrides: Readonly<Record<string, unknown>> = {},
): Uint8Array {
  return new TextEncoder().encode(
    `MEMI_CAPTURE_EVIDENCE_V1:${JSON.stringify({
      version: 1,
      route: scenario.route,
      state: scenario.state,
      readinessSelector: scenario.readinessSelector,
      readinessMatched: true,
      blank: false,
      splash: false,
      errorBoundary: false,
      ...overrides,
    })}`,
  );
}

const ROOT_LAYOUT = [
  "import { Slot } from 'expo-router';",
  "const RootLayout = () => <Slot />;",
  "export default RootLayout;",
  "",
].join("\n");

const SCREEN = [
  "import { Text, View } from 'react-native';",
  "export default function Screen() { return <View><Text>Ready</Text></View>; }",
  "",
].join("\n");

function policy(
  root: string,
  metro: ExpoGoCaptureAdapterOptions["metro"] = {
    executable: "/opt/memi/npx",
    args: ["expo", "start", "--go", "--localhost"],
    appId: "host.exp.Exponent",
    routeAuthority: "expo-go-project-url",
  },
): ProcessExecutionPolicy {
  const literal = (value: string) => ({ kind: "literal" as const, value });
  return {
    allowedCommands: [
      {
        executable: "/opt/memi/npx",
        arguments: [
          ...metro.args.map(literal),
          literal("--port"),
          { kind: "integer", minimum: 1, maximum: 65_535 },
        ],
      },
      {
        executable: "/usr/bin/xcrun",
        arguments: [
          literal("simctl"),
          literal("openurl"),
          { kind: "safe-token" },
          metro.routeAuthority === "expo-go-project-url"
            ? { kind: "expo-project-url" as const }
            : {
                kind: "expo-development-client-url" as const,
                scheme: metro.scheme,
              },
        ],
      },
      ...(metro.routeAuthority === "expo-development-client-url"
        ? [{
            executable: "/usr/bin/xcrun",
            arguments: [
              literal("simctl"),
              literal("openurl"),
              { kind: "safe-token" as const },
              {
                kind: "expo-standalone-url" as const,
                scheme: metro.routeScheme,
              },
            ],
          }]
        : []),
      {
        executable: "/usr/bin/xcrun",
        arguments: [
          literal("simctl"),
          literal("io"),
          { kind: "safe-token" },
          literal("screenshot"),
          literal("--type=png"),
          literal("-"),
        ],
      },
      {
        executable: "/usr/bin/xcrun",
        arguments: [
          literal("simctl"),
          literal("terminate"),
          { kind: "safe-token" },
          literal(metro.appId),
        ],
      },
      {
        executable: "/opt/memi/maestro",
        arguments: [
          { kind: "safe-token" },
          literal("test"),
          { kind: "safe-token" },
        ],
      },
      {
        executable: "/opt/memi/maestro",
        arguments: [
          { kind: "safe-token" },
          literal("hierarchy"),
          literal("--compact"),
        ],
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
      allowedReadRoots: [root, "/usr", "/opt"],
      allowedWriteRoots: [root],
      network: "loopback",
    },
  };
}

async function fixture(
  overrides: Partial<ExpoGoCaptureAdapterOptions> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "memi-expo-go-"));
  const calls: Array<Readonly<{
    executable: string;
    args: readonly string[];
  }>> = [];
  const scenario = Object.freeze({
    ...scenarioFixture,
    applicationId: application.id,
    route: "/dashboard",
    parameters: [{ key: "tab", value: "following" }],
  });
  const commandPort: NativeCommandPort = {
    execute: vi.fn(async (recipe) => {
      calls.push({
        executable: recipe.executable,
        args: Object.freeze([...recipe.args]),
      });
      if (recipe.args.includes("screenshot")) {
        return {
          stdout: new Uint8Array([137, 80, 78, 71]),
          stderr: "",
        };
      }
      if (recipe.args.includes("hierarchy")) {
        return { stdout: runtimeEvidence(scenario), stderr: "" };
      }
      return { stdout: new Uint8Array(), stderr: "" };
    }),
  };
  const running: RunningProcessGroup = {
    child: {
      pid: 7_777,
      stdout: null,
      stderr: null,
      once: vi.fn(),
    },
    cancel: vi.fn(),
    cancelled: Promise.resolve(),
  };
  const processStarter: ProcessStarter = {
    start: vi.fn(() => running),
  };
  const portLease: PortLease = {
    acquire: vi.fn(async () => 19_000),
    release: vi.fn(async () => undefined),
  };
  const waitForMetro = vi.fn(async () => undefined);
  const waitForDevelopmentClientAttachment = vi.fn(async () => undefined);
  const waitForCaptureSettling = vi.fn(async () => undefined);
  const releaseDevice = vi.fn(async () => undefined);
  const basePolicy = policy(root, overrides.metro);
  const simulatorProcessPolicy = overrides.simctlExecutable === undefined
    ? undefined
    : {
        ...basePolicy,
        allowedCommands: basePolicy.allowedCommands.map((command) =>
          command.executable !== "/usr/bin/xcrun"
            ? command
            : {
                ...command,
                executable: overrides.simctlExecutable!,
                arguments: command.arguments.slice(1),
              },
        ),
      };
  const options: ExpoGoCaptureAdapterOptions = {
    applications: [application],
    managedWorktreeRoot: root,
    projectRoot: root,
    metro: {
      executable: "/opt/memi/npx",
      args: ["expo", "start", "--go", "--localhost"],
      appId: "host.exp.Exponent",
      routeAuthority: "expo-go-project-url",
    },
    deviceResolver: vi.fn(async () => ({ deviceId: "MEMI-SIMULATOR-1" })),
    ...(overrides.simctlExecutable === undefined
      ? { xcrunExecutable: "/usr/bin/xcrun" }
      : {}),
    maestroExecutable: "/opt/memi/maestro",
    artifactStore: new ContentAddressedArtifactStore(join(root, "artifacts")),
    commandPort,
    processStarter,
    processPolicy: basePolicy,
    ...(simulatorProcessPolicy === undefined
      ? {}
      : { simulatorProcessPolicy }),
    portLease,
    releaseDevice,
    waitForMetro,
    waitForDevelopmentClientAttachment,
    waitForCaptureSettling,
    flowByRoute: {
      "/dashboard": ".maestro/dashboard.yaml",
    },
    now: () => new Date("2026-07-30T10:00:00.000Z"),
    stableFrameDelayMs: 0,
    ...overrides,
  };
  const context = {
    job: {
      ...jobFixture,
      applications: [application],
      scenarios: [scenario],
      currentApplicationId: application.id,
    },
    signal: new AbortController().signal,
  };
  return {
    adapter: new ExpoGoCaptureAdapter(options),
    calls,
    commandPort,
    context,
    options,
    portLease,
    processStarter,
    root,
    releaseDevice,
    running,
    scenario,
    waitForMetro,
    waitForDevelopmentClientAttachment,
    waitForCaptureSettling,
  };
}

describe("ExpoGoCaptureAdapter", () => {
  it("bridges external dependencies only for the managed capture lifecycle", async () => {
    const dependencyParent = await mkdtemp(join(tmpdir(), "memi-expo-deps-"));
    const dependencyRoot = join(dependencyParent, "node_modules");
    await mkdir(join(dependencyRoot, "expo", "bin"), { recursive: true });
    await writeFile(
      join(await realpath(dependencyParent), "managed-package-sentinel"),
      "source remains read-only\n",
    );
    const target = await fixture({
      metro: {
        executable: "/opt/memi/npx",
        args: ["expo", "start", "--dev-client", "--localhost"],
        appId: "com.memi.capture",
        routeAuthority: "expo-development-client-url",
        scheme: "memi",
        routeScheme: "memi",
      },
      localDevelopmentMetroLaunch: {
        executable: "/opt/memi/node",
        cliPath: join(dependencyRoot, "expo", "bin", "cli"),
        dependencyRoot,
        environment: { NODE_PATH: dependencyRoot },
      },
      managedMetroEntryPoint: "expo-router/entry",
    });
    const originalPackage = '{"main":"expo-router/entry"}\n';
    await writeFile(join(target.root, "package.json"), originalPackage);
    await writeFile(join(target.root, "metro.config.js"), "module.exports = {};\n");

    await target.adapter.prepare(target.context, application, [target.scenario]);

    const bridgePath = join(target.root, "node_modules");
    expect((await lstat(bridgePath)).isSymbolicLink()).toBe(true);
    await expect(realpath(bridgePath)).resolves.toBe(await realpath(dependencyRoot));
    await expect(readFile(join(target.root, "package.json"), "utf8"))
      .resolves.toContain("MemiCaptureEntry.js");

    await target.adapter.cleanup(target.context, null);

    await expect(lstat(bridgePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(target.root, "package.json"), "utf8"))
      .resolves.toBe(originalPackage);
    await expect(lstat(dependencyRoot)).resolves.toMatchObject({});
  });

  it("launches a declared development client through its verified local Expo CLI", async () => {
    const dependencyParent = await mkdtemp(join(tmpdir(), "memi-expo-cli-"));
    const dependencyRoot = join(dependencyParent, "node_modules");
    const cliPath = join(dependencyRoot, "expo", "bin", "cli");
    await mkdir(join(dependencyRoot, "expo", "bin"), { recursive: true });
    await writeFile(cliPath, "process.exit(0);\n");
    const target = await fixture({
      metro: {
        executable: "/opt/memi/npx",
        args: ["expo", "start", "--dev-client", "--localhost"],
        appId: "com.memi.capture",
        routeAuthority: "expo-development-client-url",
        scheme: "memi",
        routeScheme: "memi",
      },
      localDevelopmentMetroLaunch: {
        executable: "/opt/memi/node",
        cliPath,
        dependencyRoot,
        environment: { NODE_PATH: dependencyRoot },
      },
      managedMetroEntryPoint: "expo-router/entry",
    });
    await writeFile(
      join(target.root, "package.json"),
      '{"main":"expo-router/entry"}\n',
    );
    await writeFile(join(target.root, "metro.config.js"), "module.exports = {};\n");
    const preparation = await target.adapter.prepare(
      target.context,
      application,
      [target.scenario],
    );

    await target.adapter.launch(target.context, preparation);

    expect(target.processStarter.start).toHaveBeenCalledWith(
      {
        executable: "/opt/memi/node",
        args: [
          cliPath,
          "start",
          "--dev-client",
          "--localhost",
          "--port",
          "19000",
        ],
        cwd: target.root,
        environment: { NODE_PATH: dependencyRoot },
      },
      target.options.processPolicy,
      target.context.signal,
    );
  });

  it("instruments and restores a managed development-client worktree around an attested capture", async () => {
    const target = await fixture({
      managedRuntimeInstrumentation: true,
      metro: {
        executable: "/opt/memi/npx",
        args: ["expo", "start", "--dev-client", "--localhost"],
        appId: "com.example.client",
        routeAuthority: "expo-development-client-url",
        scheme: "exp+example",
        routeScheme: "example",
      },
    });
    await mkdir(join(target.root, "app"), { recursive: true });
    await writeFile(join(target.root, "app/_layout.tsx"), ROOT_LAYOUT);
    await writeFile(join(target.root, "app/index.tsx"), SCREEN);
    const scenario = Object.freeze({
      ...target.scenario,
      route: "/dashboard/:tab",
    });
    const context = {
      ...target.context,
      job: {
        ...target.context.job,
        scenarios: [scenario],
      },
    };

    const preparation = await target.adapter.prepare(
      context,
      application,
      [scenario],
    );

    await expect(readFile(join(target.root, "app/_layout.tsx"), "utf8"))
      .resolves.toContain("MemiCaptureRuntimeAttestation");

    const launch = await target.adapter.launch(context, preparation);
    const nonce = createHash("sha256")
      .update(`${context.job.id}\0${scenario.id}`)
      .digest("hex")
      .slice(0, 26)
      .toUpperCase();
    vi.mocked(target.commandPort.execute).mockImplementation(async (recipe) => {
      target.calls.push({
        executable: recipe.executable,
        args: Object.freeze([...recipe.args]),
      });
      return {
        stdout: recipe.args.includes("hierarchy")
          ? runtimeEvidence(scenario, {
              nonce,
              sourceRevision: context.job.repository.sourceRevision,
            })
          : recipe.args.includes("screenshot")
            ? new Uint8Array([137, 80, 78, 71])
            : new Uint8Array(),
        stderr: "",
      };
    });

    await target.adapter.capture(context, launch, scenario);
    expect(target.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        args: expect.arrayContaining([
          "openurl",
          "MEMI-SIMULATOR-1",
          `example:///dashboard/following?__memi_capture=${nonce}` +
            "&__memi_state=Default",
        ]),
      }),
    ]));
    await target.adapter.cleanup(context, launch);

    await expect(readFile(join(target.root, "app/_layout.tsx"), "utf8"))
      .resolves.toBe(ROOT_LAYOUT);
  });

  it("launches a managed development client through its declared scheme", async () => {
    const target = await fixture({
      metro: {
        executable: "/opt/memi/npx",
        args: ["expo", "start", "--dev-client", "--localhost"],
        appId: "com.example.client",
        routeAuthority: "expo-development-client-url",
        scheme: "exp+example",
        routeScheme: "example",
      },
    });
    expect(target.adapter.metadata.id).toBe("expo-development-client-ios");
    const preparation = await target.adapter.prepare(
      target.context,
      application,
      [target.scenario],
    );
    const launch = await target.adapter.launch(target.context, preparation);

    expect(target.waitForDevelopmentClientAttachment).toHaveBeenCalledWith(
      5_000,
      target.context.signal,
    );
    await target.adapter.capture(target.context, launch, target.scenario);

    expect(target.processStarter.start).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "expo",
          "start",
          "--dev-client",
          "--localhost",
          "--port",
          "19000",
        ],
      }),
      expect.anything(),
      expect.any(AbortSignal),
    );
    expect(target.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: expect.arrayContaining([
            "openurl",
            "MEMI-SIMULATOR-1",
            "exp+example://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A19000",
          ]),
        }),
        expect.objectContaining({
          args: expect.arrayContaining([
            "openurl",
            "MEMI-SIMULATOR-1",
            "exp+example://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A19000%2F--%2Fdashboard%3Ftab%3Dfollowing",
          ]),
        }),
      ]),
    );
  });

  it("launches managed Metro, opens exact Expo URLs, and captures real evidence", async () => {
    const target = await fixture();
    const preparation = await target.adapter.prepare(
      target.context,
      application,
      [target.scenario],
    );
    const launch = await target.adapter.launch(
      target.context,
      preparation,
    );
    const raw = await target.adapter.capture(
      target.context,
      launch,
      target.scenario,
    );
    const artifact = await target.adapter.collect(
      target.context,
      launch,
      raw,
    );
    await target.adapter.cleanup(target.context, launch);

    expect(target.processStarter.start).toHaveBeenCalledWith(
      {
        executable: "/opt/memi/npx",
        args: [
          "expo",
          "start",
          "--go",
          "--localhost",
          "--port",
          "19000",
        ],
        cwd: target.root,
      },
      expect.objectContaining({
        sandbox: expect.objectContaining({ network: "loopback" }),
      }),
      expect.any(AbortSignal),
    );
    expect(target.waitForMetro).toHaveBeenCalledWith(
      "http://127.0.0.1:19000/status",
      expect.any(AbortSignal),
    );
    expect(target.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: expect.arrayContaining([
            "openurl",
            "MEMI-SIMULATOR-1",
            "exp://127.0.0.1:19000",
          ]),
        }),
        expect.objectContaining({
          args: expect.arrayContaining([
            "openurl",
            "MEMI-SIMULATOR-1",
            "exp://127.0.0.1:19000/--/dashboard?tab=following",
          ]),
        }),
        expect.objectContaining({
          args: expect.arrayContaining([
            "--udid=MEMI-SIMULATOR-1",
            "test",
            ".maestro/dashboard.yaml",
          ]),
        }),
      ]),
    );
    expect(artifact).toMatchObject({
      scenarioId: target.scenario.id,
      screenshotHash: artifact.verification.stableFrameHash,
      verification: {
        routeMatched: true,
        blankRejected: true,
        splashRejected: true,
        errorBoundaryRejected: true,
      },
    });
    expect(target.running.cancel).toHaveBeenCalledOnce();
    expect(target.portLease.release).toHaveBeenCalledWith(19_000);
    expect(target.releaseDevice).toHaveBeenCalledOnce();
  });

  it("persists signed semantic evidence as an editable reconstruction artifact", async () => {
    const sourceHash = `sha256:${"b".repeat(64)}` as const;
    let navigationUrl = "";
    let scenario: CaptureScenarioV2 | undefined;
    const readSimulatorRuntimeEvidence = vi.fn(async () => {
      if (scenario === undefined) throw new Error("Scenario was not prepared.");
      const destination = new URL(navigationUrl || "capture://localhost");
      const nested = destination.searchParams.get("url");
      const nonce = new URL(nested ?? destination.toString()).searchParams.get(
        "__memi_capture",
      );
      return runtimeEvidence(scenario, {
        nonce,
        sourceRevision: "a".repeat(40),
        semanticCapture: {
          appVersion: "2.1",
          layers: [
            {
              content: { text: "Sign in" },
              geometry: {
                height: 24,
                rotation: 0,
                width: 120,
                x: 24,
                y: 44,
              },
              kind: "text",
              layerId: "sign-in-title",
              name: "Sign in title",
              semanticKey: "sign-in.title",
              source: {
                astPath: ["SignInScreen", "Text[0]"],
                range: { end: 120, start: 100 },
                sourceAnchor: "app/(auth)/sign-in.tsx#SignInScreen",
                sourceContentHash: sourceHash,
              },
              style: { fontSize: 20, fontWeight: 500 },
              zIndex: 1,
            },
          ],
        },
      });
    });
    const target = await fixture({
      managedRuntimeInstrumentation: true,
      metro: {
        executable: "/opt/memi/npx",
        args: ["expo", "start", "--dev-client", "--localhost"],
        appId: "com.example.capture",
        routeAuthority: "expo-development-client-url",
        scheme: "capture",
        routeScheme: "capture",
      },
      readSimulatorRuntimeEvidence,
    });
    await mkdir(`${target.root}/app`, { recursive: true });
    await writeFile(`${target.root}/app/_layout.tsx`, ROOT_LAYOUT);
    await writeFile(`${target.root}/app/index.tsx`, SCREEN);
    scenario = Object.freeze({
      ...target.scenario,
      route: "/dashboard/:tab",
      sourceAnchor: {
        contentHash: sourceHash,
        relativePath: "app/(auth)/sign-in.tsx",
        symbol: "SignInScreen",
      },
    });
    const context = {
      ...target.context,
      job: {
        ...target.context.job,
        scenarios: [scenario],
      },
    };
    const preparation = await target.adapter.prepare(
      context,
      application,
      [scenario],
    );
    const launch = await target.adapter.launch(context, preparation);
    vi.mocked(target.commandPort.execute).mockImplementation(async (recipe) => {
      if (recipe.args.includes("openurl")) {
        navigationUrl = recipe.args.at(-1) ?? "";
      }
      return {
        stdout: recipe.args.includes("hierarchy")
          ? new TextEncoder().encode("role=application")
          : recipe.args.includes("screenshot")
            ? new Uint8Array([137, 80, 78, 71])
            : new Uint8Array(),
        stderr: "",
      };
    });
    const raw = await target.adapter.capture(context, launch, scenario);
    const artifact = await target.adapter.collect(context, launch, raw);

    expect(artifact.reconstructionArtifactId).toMatch(/^art_/u);
    const artifactRoot = `${target.root}/artifacts/sha256`;
    const files = (
      await Promise.all(
        (await readdir(artifactRoot)).map(async (bucket) =>
          (await readdir(`${artifactRoot}/${bucket}`))
            .filter((file) => file.endsWith(".json"))
            .map((file) => `${artifactRoot}/${bucket}/${file}`),
        ),
      )
    ).flat();
    expect(files).toHaveLength(1);
    const reconstruction = RuntimeCaptureScreenV1Schema.parse(
      JSON.parse(await readFile(files[0]!, "utf8")),
    );
    expect(reconstruction.layers[0]?.semanticKey).toBe("sign-in.title");
    expect(reconstruction.captureId).toBe(artifact.id);
  });

  it("waits for the destination route before collecting stable runtime evidence", async () => {
    const target = await fixture({
      scenarioSettleDelayMs: 800,
      stableFrameDelayMs: 250,
    });
    const preparation = await target.adapter.prepare(
      target.context,
      application,
      [target.scenario],
    );
    const launch = await target.adapter.launch(target.context, preparation);

    await target.adapter.capture(target.context, launch, target.scenario);

    expect(target.waitForCaptureSettling).toHaveBeenNthCalledWith(
      1,
      800,
      target.context.signal,
    );
    expect(target.waitForCaptureSettling).toHaveBeenNthCalledWith(
      2,
      250,
      target.context.signal,
    );
  });

  it("reads simulator screenshots from the supplied evidence port instead of stdout", async () => {
    const captureSimulatorScreenshot = vi.fn(async () =>
      new Uint8Array([137, 80, 78, 71]),
    );
    const target = await fixture({
      captureSimulatorScreenshot,
    } as never);
    const preparation = await target.adapter.prepare(
      target.context,
      application,
      [target.scenario],
    );
    const launch = await target.adapter.launch(target.context, preparation);

    await target.adapter.capture(target.context, launch, target.scenario);

    expect(captureSimulatorScreenshot).toHaveBeenCalledTimes(2);
    expect(captureSimulatorScreenshot).toHaveBeenNthCalledWith(
      1,
      { deviceId: "MEMI-SIMULATOR-1" },
      expect.any(AbortSignal),
    );
    expect(
      target.calls.some(({ args }) => args.includes("screenshot")),
    ).toBe(false);
  });

  it("retries a transitioning screenshot pair until exact runtime pixels stabilize", async () => {
    const captureSimulatorScreenshot = vi.fn()
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockResolvedValueOnce(new Uint8Array([2]))
      .mockResolvedValueOnce(new Uint8Array([3]))
      .mockResolvedValueOnce(new Uint8Array([3]));
    const target = await fixture({
      captureSimulatorScreenshot,
      maximumScreenshotStabilityAttempts: 2,
    });
    const preparation = await target.adapter.prepare(
      target.context,
      application,
      [target.scenario],
    );
    const launch = await target.adapter.launch(target.context, preparation);

    await expect(
      target.adapter.capture(target.context, launch, target.scenario),
    ).resolves.toEqual(expect.objectContaining({ scenarioId: target.scenario.id }));
    expect(captureSimulatorScreenshot).toHaveBeenCalledTimes(4);
  });

  it("reads runtime attestation from the supplied simulator evidence channel, not hierarchy text", async () => {
    const target = await fixture({
      readSimulatorRuntimeEvidence: vi.fn(async () =>
        runtimeEvidence({
          ...scenarioFixture,
          route: "/dashboard",
          parameters: [{ key: "tab", value: "following" }],
        }),
      ),
    });
    const preparation = await target.adapter.prepare(
      target.context,
      application,
      [target.scenario],
    );
    const launch = await target.adapter.launch(target.context, preparation);
    vi.mocked(target.commandPort.execute).mockImplementation(async (recipe) => {
      if (recipe.args.includes("hierarchy")) {
        return {
          stdout: new TextEncoder().encode("element_num,depth,attributes\n"),
          stderr: "",
        };
      }
      if (recipe.args.includes("screenshot")) {
        return { stdout: new Uint8Array([137, 80, 78, 71]), stderr: "" };
      }
      return { stdout: new Uint8Array(), stderr: "" };
    });

    await expect(
      target.adapter.capture(target.context, launch, target.scenario),
    ).resolves.toEqual(expect.objectContaining({ scenarioId: target.scenario.id }));
    expect(target.options.readSimulatorRuntimeEvidence).toHaveBeenCalledWith(
      { deviceId: "MEMI-SIMULATOR-1" },
      target.context.signal,
    );
  });

  it("waits for fresh route-matched runtime evidence instead of accepting a stale attestation", async () => {
    const readSimulatorRuntimeEvidence = vi.fn()
      .mockResolvedValueOnce(runtimeEvidence({
        ...scenarioFixture,
        route: "/stale-route",
      }))
      .mockResolvedValueOnce(runtimeEvidence({
        ...scenarioFixture,
        route: "/dashboard",
        parameters: [{ key: "tab", value: "following" }],
      }));
    const target = await fixture({
      readSimulatorRuntimeEvidence,
      runtimeEvidencePollDelayMs: 200,
      maximumRuntimeEvidenceAttempts: 2,
    });
    const preparation = await target.adapter.prepare(
      target.context,
      application,
      [target.scenario],
    );
    const launch = await target.adapter.launch(target.context, preparation);

    await expect(
      target.adapter.capture(target.context, launch, target.scenario),
    ).resolves.toEqual(expect.objectContaining({ scenarioId: target.scenario.id }));
    expect(readSimulatorRuntimeEvidence).toHaveBeenCalledTimes(2);
    expect(target.waitForCaptureSettling).toHaveBeenCalledWith(
      200,
      target.context.signal,
    );
    expect(target.waitForCaptureSettling).toHaveBeenNthCalledWith(
      3,
      1_250,
      target.context.signal,
    );
  });

  it("keeps the final attestation failure code actionable after polling", async () => {
    const target = await fixture({
      readSimulatorRuntimeEvidence: vi.fn(async () =>
        runtimeEvidence({ ...scenarioFixture, route: "/wrong-route" }),
      ),
      maximumRuntimeEvidenceAttempts: 2,
      runtimeEvidencePollDelayMs: 0,
    });
    const preparation = await target.adapter.prepare(
      target.context,
      application,
      [target.scenario],
    );
    const launch = await target.adapter.launch(target.context, preparation);

    await expect(
      target.adapter.capture(target.context, launch, target.scenario),
    ).rejects.toMatchObject({ code: "ROUTE_MISMATCH", stage: "verify" });
  });

  it("uses the direct device authority for development-client hierarchy extraction", async () => {
    const directExecute = vi.fn(async (recipe: ProcessRecipe) => ({
      stdout: recipe.args[1] === "hierarchy"
        ? runtimeEvidence({
            ...scenarioFixture,
            route: "/dashboard",
            parameters: [{ key: "tab", value: "following" }],
          })
        : new Uint8Array(),
      stderr: "",
    }));
    const target = await fixture({
      metro: {
        executable: "/opt/memi/npx",
        args: ["expo", "start", "--dev-client", "--localhost"],
        appId: "com.example.client",
        routeAuthority: "expo-development-client-url",
        scheme: "example",
        routeScheme: "example",
      },
      directSimulator: true,
      simctlExecutable: "/usr/bin/simctl",
      directSimulatorCommandPort: { execute: directExecute },
      captureSimulatorScreenshot: vi.fn(async () =>
        new Uint8Array([137, 80, 78, 71]),
      ),
    });
    const preparation = await target.adapter.prepare(
      target.context,
      application,
      [target.scenario],
    );
    const launch = await target.adapter.launch(target.context, preparation);

    await target.adapter.capture(target.context, launch, target.scenario);

    expect(directExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: "/opt/memi/maestro",
        args: ["--udid=MEMI-SIMULATOR-1", "hierarchy", "--compact"],
      }),
      expect.anything(),
      target.context.signal,
    );
    expect(target.calls.some((call) => call.args.includes("hierarchy"))).toBe(false);
  });

  it("fails closed for forged Metro authority and worktree escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-expo-go-bounds-"));
    const base = (await fixture()).options;
    for (const metro of [
      { ...base.metro, appId: "app.fake" as "host.exp.Exponent" },
      {
        ...base.metro,
        routeAuthority: "untrusted" as "expo-go-project-url",
      },
      {
        ...base.metro,
        args: ["expo", "start", "--tunnel"] as unknown as
          typeof base.metro.args,
      },
    ]) {
      expect(
        () => new ExpoGoCaptureAdapter({
          ...base,
          metro: metro as ExpoGoCaptureAdapterOptions["metro"],
        }),
      ).toThrow(/Expo Go.*authority|Metro/i);
    }
    expect(
      () =>
        new ExpoGoCaptureAdapter({
          ...base,
          managedWorktreeRoot: root,
          projectRoot: "/tmp/outside",
        }),
    ).toThrow(/managed worktree/i);
    expect(
      () =>
        new ExpoGoCaptureAdapter({
          ...base,
          applications: [{ ...application, platform: "react-web" }],
        }),
    ).toThrow(/expo-ios/i);
  });

  it("cancels Metro and releases the lease after launch failure", async () => {
    const waitForMetro = vi.fn(async () => {
      throw new Error("Metro unavailable.");
    });
    const target = await fixture({ waitForMetro });
    const preparation = await target.adapter.prepare(
      target.context,
      application,
      [target.scenario],
    );

    await expect(
      target.adapter.launch(target.context, preparation),
    ).rejects.toThrow(/Metro unavailable/i);
    expect(target.running.cancel).toHaveBeenCalledOnce();
    expect(target.portLease.release).toHaveBeenCalledWith(19_000);
    expect(target.releaseDevice).toHaveBeenCalledOnce();
  });

  it("rejects contradictory runtime evidence and missing source revision", async () => {
    const mismatch = await fixture();
    const preparation = await mismatch.adapter.prepare(
      mismatch.context,
      application,
      [mismatch.scenario],
    );
    const launch = await mismatch.adapter.launch(
      mismatch.context,
      preparation,
    );
    vi.mocked(mismatch.commandPort.execute).mockImplementation(
      async (recipe) => ({
        stdout: recipe.args.includes("hierarchy")
          ? runtimeEvidence(mismatch.scenario, { route: "/wrong" })
          : recipe.args.includes("screenshot")
            ? new Uint8Array([137, 80, 78, 71])
            : new Uint8Array(),
        stderr: "",
      }),
    );
    await expect(
      mismatch.adapter.capture(
        mismatch.context,
        launch,
        mismatch.scenario,
      ),
    ).rejects.toMatchObject({ code: "ROUTE_MISMATCH" });

    const missing = await fixture();
    const missingPreparation = await missing.adapter.prepare(
      {
        ...missing.context,
        job: {
          ...missing.context.job,
          repository: {
            ...missing.context.job.repository,
            sourceRevision: null,
          },
        },
      },
      application,
      [missing.scenario],
    );
    const missingLaunch = await missing.adapter.launch(
      missing.context,
      missingPreparation,
    );
    await expect(
      missing.adapter.capture(
        {
          ...missing.context,
          job: {
            ...missing.context.job,
            repository: {
              ...missing.context.job.repository,
              sourceRevision: null,
            },
          },
        },
        missingLaunch,
        missing.scenario,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_REVISION_MISSING" });
  });

  it("honors cancellation before preparing or launching", async () => {
    const target = await fixture();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      target.adapter.prepare(
        { ...target.context, signal: cancelled.signal },
        application,
        [target.scenario],
      ),
    ).rejects.toThrow(/cancelled/i);
  });
});
