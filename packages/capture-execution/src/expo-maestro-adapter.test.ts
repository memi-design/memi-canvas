import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RuntimeCaptureScreenV1Schema } from "@memi/protocol";
import { ContentAddressedArtifactStore } from "./artifact-store.js";
import {
  ExpoMaestroCaptureAdapter,
  type ExpoNativeBuildPreparer,
  type ExpoNativeDependencyPreparation,
  type NativeCommandPort,
  type ResolveBuiltApplication,
  resolveBuiltApplication,
} from "./expo-maestro-adapter.js";
import {
  approveNativeDependencyPreparationPlan,
  type NativeDependencyPreparationPlan,
} from "./native-dependency-preparation.js";
import type { ProcessExecutionPolicy } from "./process-policy.js";
import { jobFixture, scenarioFixture } from "./test-fixtures.js";
const expoApplication = {
  id: "expo",
  label: "Expo",
  platform: "expo-ios" as const,
  relativeRoot: ".",
};
function runtimeEvidence(
  scenario: typeof scenarioFixture,
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
function policy(root: string): ProcessExecutionPolicy {
  const literal = (value: string) => ({ kind: "literal" as const, value });
  return {
    allowedCommands: [
      {
        executable: "/usr/bin/xcodebuild",
        arguments: [
          literal("-project"),
          { kind: "safe-token" },
          literal("-scheme"),
          literal("Buzzr"),
          literal("-configuration"),
          literal("Release"),
          literal("-sdk"),
          literal("iphonesimulator"),
          literal("-jobs"),
          literal("1"),
          literal("-destination"),
          literal("generic/platform=iOS Simulator"),
          literal("-derivedDataPath"),
          { kind: "safe-token" },
          literal("ENABLE_USER_SCRIPT_SANDBOXING=NO"),
          literal("ARCHS=arm64"),
          literal("build"),
        ],
      },
      {
        executable: "/usr/bin/xcodebuild",
        arguments: [
          literal("-project"),
          { kind: "safe-token" },
          literal("-scheme"),
          literal("Buzzr"),
          literal("-configuration"),
          literal("Release"),
          literal("-sdk"),
          literal("iphonesimulator"),
          literal("-jobs"),
          literal("1"),
          literal("-destination"),
          literal("generic/platform=iOS Simulator"),
          literal("-derivedDataPath"),
          { kind: "safe-token" },
          literal("ENABLE_USER_SCRIPT_SANDBOXING=NO"),
          literal("ARCHS=arm64"),
          literal("-showBuildSettings"),
        ],
      },
      {
        executable: "/usr/bin/xcrun",
        arguments: [
          literal("simctl"),
          literal("install"),
          { kind: "safe-token" },
          { kind: "safe-token" },
        ],
      },
      {
        executable: "/usr/bin/xcrun",
        arguments: [
          literal("simctl"),
          literal("launch"),
          literal("--terminate-running-process"),
          { kind: "safe-token" },
          { kind: "safe-token" },
        ],
      },
      {
        executable: "/usr/bin/xcrun",
        arguments: [
          literal("simctl"),
          literal("terminate"),
          { kind: "safe-token" },
          { kind: "safe-token" },
        ],
      },
      {
        executable: "/usr/bin/xcrun",
        arguments: [
          literal("simctl"),
          literal("openurl"),
          { kind: "safe-token" },
          { kind: "expo-standalone-url", scheme: "buzzr" },
        ],
      },
      {
        executable: "/usr/bin/xcrun",
        arguments: [
          literal("simctl"),
          literal("pbpaste"),
          { kind: "safe-token" },
        ],
      },
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
        executable: "/opt/maestro/bin/maestro",
        arguments: [
          { kind: "safe-token" },
          literal("test"),
          { kind: "safe-token" },
        ],
      },
      {
        executable: "/opt/maestro/bin/maestro",
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
  builtApplicationResolver?: ResolveBuiltApplication,
  managedRuntimeInstrumentation = false,
  nativeDependencyPreparation?: ExpoNativeDependencyPreparation,
  directNativeBuildCommandPort?: Readonly<{
    execute(
      recipe: Parameters<NativeCommandPort["execute"]>[0],
      policy: ProcessExecutionPolicy,
      signal: AbortSignal,
    ): ReturnType<NativeCommandPort["execute"]>;
  }>,
  nativeBuildProcessPolicy?: ProcessExecutionPolicy,
  nativeBuildPreparer?: ExpoNativeBuildPreparer,
  nativeBuildTimeoutMs?: number,
) {
  const root = await mkdtemp(join(tmpdir(), "memi-expo-"));
  const derivedDataPath = join(root, ".memi/DerivedData");
  const stagingRoot = join(root, ".memi/staged-apps");
  const appBundlePath = join(
    derivedDataPath,
    "Build/Products/Release-iphonesimulator/Buzzr.app",
  );
  await mkdir(appBundlePath, { recursive: true });
  await mkdir(stagingRoot, { recursive: true });
  await mkdir(join(root, "app"), { recursive: true });
  await mkdir(join(root, ".maestro"), { recursive: true });
  const flowContent = [
    "appId: app.buzzr",
    "---",
    "- launchApp:",
    "    clearState: false",
    '- assertVisible: "Dashboard"',
  ].join("\n");
  await writeFile(join(root, ".maestro/dashboard.yaml"), flowContent);
  await writeFile(
    join(root, "app/_layout.tsx"),
    [
      "import { Slot } from 'expo-router';",
      "function RootLayout() { return <Slot />; }",
      "export default RootLayout;",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(root, "app/index.tsx"),
    [
      "import { Text, View } from 'react-native';",
      "export default function Dashboard() {",
      "  return <View><Text>Dashboard</Text></View>;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(appBundlePath, "Info.plist"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0"><dict>',
      "<key>CFBundleIdentifier</key><string>app.buzzr</string>",
      "</dict></plist>",
    ].join(""),
  );
  const calls: { executable: string; args: readonly string[] }[] = [];
  const commandPort: NativeCommandPort = {
    execute: vi.fn(async (recipe, _signal) => {
      calls.push({ executable: recipe.executable, args: recipe.args });
      if (recipe.args.includes("-showBuildSettings")) {
        return {
          stdout: new TextEncoder().encode(
            [
              "    PRODUCT_BUNDLE_IDENTIFIER = app.buzzr",
              `    TARGET_BUILD_DIR = ${join(derivedDataPath, "Build/Products/Release-iphonesimulator")}`,
              "    FULL_PRODUCT_NAME = Buzzr.app",
            ].join("\n"),
          ),
          stderr: "",
        };
      }
      if (recipe.args.includes("screenshot")) {
        return { stdout: new Uint8Array([137, 80, 78, 71]), stderr: "" };
      }
      if (recipe.args.includes("hierarchy")) {
        return {
          stdout: runtimeEvidence(scenarioFixture),
          stderr: "",
        };
      }
      return { stdout: new Uint8Array(), stderr: "" };
    }),
  };
  const artifactStore = new ContentAddressedArtifactStore(
    join(root, "artifacts"),
  );
  const adapter = new ExpoMaestroCaptureAdapter({
    applications: [expoApplication],
    managedWorktreeRoot: root,
    stagingRoot,
    runtime: "standalone",
    scheme: "buzzr",
    nativeBuild: {
      container: {
        kind: "project",
        path: join(root, "ios/Buzzr.xcodeproj"),
      },
      scheme: "Buzzr",
      configuration: "Release",
      derivedDataPath,
      expectedBundleId: "app.buzzr",
    },
    deviceResolver: vi.fn(async () => ({ deviceId: "SIMULATOR-1" })),
    xcodebuildExecutable: "/usr/bin/xcodebuild",
    xcrunExecutable: "/usr/bin/xcrun",
    maestroExecutable: "/opt/maestro/bin/maestro",
    artifactStore,
    commandPort,
    processPolicy: policy(root),
    managedRuntimeInstrumentation,
    ...(directNativeBuildCommandPort === undefined
      ? {}
      : {
          directNativeBuildCommandPort,
          ...(nativeBuildProcessPolicy === undefined
            ? {}
            : { nativeBuildProcessPolicy }),
        }),
    ...(nativeDependencyPreparation === undefined
      ? {}
      : { nativeDependencyPreparation }),
    ...(nativeBuildPreparer === undefined
      ? {}
      : { nativeBuildPreparer }),
    ...(nativeBuildTimeoutMs === undefined
      ? {}
      : { nativeBuildTimeoutMs }),
    flowByRoute: {
      [scenarioFixture.route]: {
        relativePath: ".maestro/dashboard.yaml",
        contentHash: `sha256:${createHash("sha256")
          .update(flowContent)
          .digest("hex")}`,
      },
    },
    now: () => new Date("2026-07-29T10:00:00.000Z"),
    stableFrameDelayMs: 0,
    ...(builtApplicationResolver === undefined
      ? {}
      : { builtApplicationResolver }),
  });
  const context = {
    job: {
      ...jobFixture,
      applications: [expoApplication],
      scenarios: [{ ...scenarioFixture, applicationId: expoApplication.id }],
      currentApplicationId: expoApplication.id,
    },
    signal: new AbortController().signal,
  };
  return {
    adapter,
    appBundlePath,
    artifactStore,
    commandPort,
    calls,
    context,
    derivedDataPath,
    root,
  };
}

describe("ExpoMaestroCaptureAdapter", () => {
  it("turns a stalled direct Xcode build into a bounded, retryable build failure", async () => {
    vi.useFakeTimers();
    try {
      let derivedDataPath = "";
      const directExecute = vi.fn(async (recipe, _policy, signal) => {
        if (recipe.args.includes("-showBuildSettings")) {
          return {
            stdout: new TextEncoder().encode([
              "    PRODUCT_BUNDLE_IDENTIFIER = app.buzzr",
              `    TARGET_BUILD_DIR = ${join(derivedDataPath, "Build/Products/Release-iphonesimulator")}`,
              "    FULL_PRODUCT_NAME = Buzzr.app",
            ].join("\n")),
            stderr: "",
          };
        }
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("Native command was cancelled."));
          }, { once: true });
        });
      });
      const target = await fixture(
        undefined,
        false,
        undefined,
        { execute: directExecute },
        policy("/direct-native-session"),
        undefined,
        25,
      );
      derivedDataPath = target.derivedDataPath;

      const preparation = target.adapter.prepare(target.context, expoApplication);
      let failure: unknown;
      void preparation.catch((error: unknown) => {
        failure = error;
      });

      await vi.advanceTimersByTimeAsync(25);
      await Promise.resolve();

      expect(failure).toMatchObject({
        stage: "build",
        code: "NATIVE_BUILD_STALLED",
        retryable: true,
      });
      await expect(preparation).rejects.toMatchObject({
        code: "NATIVE_BUILD_STALLED",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("prepares verified native artifacts after settings and before the build", async () => {
    const prepare = vi.fn(async () => undefined);
    const preparer: ExpoNativeBuildPreparer = {
      prepare,
    };
    const target = await fixture(
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      preparer,
    );

    await target.adapter.prepare(target.context, expoApplication);

    const execute = target.commandPort.execute as ReturnType<typeof vi.fn>;
    const settingsIndex = execute.mock.calls.findIndex(
      ([recipe]) => recipe.args.includes("-showBuildSettings"),
    );
    const buildIndex = execute.mock.calls.findIndex(
      ([recipe]) => recipe.args.includes("build"),
    );
    expect(settingsIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThan(settingsIndex);
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      nativeBuild: expect.objectContaining({ configuration: "Release" }),
      buildSettingsOutput: expect.any(Uint8Array),
      sourceRevision: "a".repeat(40),
      nativeDependencyPreparationPlan: null,
      signal: target.context.signal,
    }));
    expect(prepare.mock.invocationCallOrder[0]).toBeGreaterThan(
      execute.mock.invocationCallOrder[settingsIndex]!,
    );
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
      execute.mock.invocationCallOrder[buildIndex]!,
    );
  });

  it("uses the explicit direct port only for the approved Xcode build recipe", async () => {
    let derivedDataPath = "";
    const directExecute = vi.fn(async (recipe) => {
      if (recipe.args.includes("-showBuildSettings")) {
        return {
          stdout: new TextEncoder().encode([
            "    PRODUCT_BUNDLE_IDENTIFIER = app.buzzr",
            `    TARGET_BUILD_DIR = ${join(derivedDataPath, "Build/Products/Release-iphonesimulator")}`,
            "    FULL_PRODUCT_NAME = Buzzr.app",
          ].join("\n")),
          stderr: "",
        };
      }
      return { stdout: new Uint8Array(), stderr: "" };
    });
    const directBuildPolicy = policy("/direct-native-session");
    const target = await fixture(
      undefined,
      false,
      undefined,
      { execute: directExecute },
      directBuildPolicy,
    );
    derivedDataPath = target.derivedDataPath;

    await target.adapter.prepare(target.context, expoApplication);

    expect(directExecute).toHaveBeenCalledTimes(2);
    expect(directExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: "/usr/bin/xcodebuild",
        args: expect.arrayContaining(["build"]),
      }),
      directBuildPolicy,
      expect.any(AbortSignal),
    );
    expect(target.commandPort.execute).not.toHaveBeenCalled();
    const buildRecipe = directExecute.mock.calls
      .map(([recipe]) => recipe)
      .find((recipe) => recipe.args.includes("build"));
    expect(buildRecipe?.args).toEqual(expect.arrayContaining(["-jobs", "1"]));
    const settingsRecipe = directExecute.mock.calls
      .map(([recipe]) => recipe)
      .find((recipe) => recipe.args.includes("-showBuildSettings"));
    expect(settingsRecipe?.args).toEqual(
      expect.arrayContaining(["-jobs", "1"]),
    );
  });

  it("revalidates and executes approved locked dependencies before xcodebuild", async () => {
    const fingerprint = `sha256:${"a".repeat(64)}`;
    const plan = {
      contract: "memi.native-dependency-preparation-plan.v1",
      managedWorktreeRoot: "/tmp/managed",
      platformRoot: "/tmp/managed",
      repositoryRevision: "a".repeat(40),
      adapterVersion: "1",
      policy: {
        contract: "memi.native-dependency-preparation-policy.v1",
        network: "locked-dependency-downloads",
        npmLifecycleScripts: "disabled",
        cocoapodsHooks: "enabled",
        requireLockfiles: true,
        sandboxProfileFingerprint: fingerprint,
      },
      tools: [],
      manifests: [],
      lockfiles: [],
      commands: [],
      fingerprint,
      approval: {
        status: "pending",
        requiresExplicitApproval: true,
      },
    } as NativeDependencyPreparationPlan;
    const execute = vi.fn(async () => undefined);
    const currentPlan = vi.fn(async () => plan);
    const target = await fixture(undefined, false, {
      approval: approveNativeDependencyPreparationPlan(plan, {
        approvedFingerprint: fingerprint,
        approvedBy: "human:repository-import",
        approvedAt: "2026-07-30T05:00:00.000Z",
      }),
      currentPlan,
      execute,
    });

    await target.adapter.prepare(target.context, expoApplication);

    expect(currentPlan).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(plan, target.context.signal);
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(
      (target.commandPort.execute as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]!,
    );
  });

  it("rejects stale dependency approval before executing dependencies or xcodebuild", async () => {
    const approvedFingerprint = `sha256:${"a".repeat(64)}`;
    const staleFingerprint = `sha256:${"b".repeat(64)}`;
    const basePlan = {
      contract: "memi.native-dependency-preparation-plan.v1",
      managedWorktreeRoot: "/tmp/managed",
      platformRoot: "/tmp/managed",
      repositoryRevision: "a".repeat(40),
      adapterVersion: "1",
      policy: {
        contract: "memi.native-dependency-preparation-policy.v1",
        network: "locked-dependency-downloads",
        npmLifecycleScripts: "disabled",
        cocoapodsHooks: "enabled",
        requireLockfiles: true,
        sandboxProfileFingerprint: approvedFingerprint,
      },
      tools: [],
      manifests: [],
      lockfiles: [],
      commands: [],
      fingerprint: approvedFingerprint,
      approval: {
        status: "pending",
        requiresExplicitApproval: true,
      },
    } as NativeDependencyPreparationPlan;
    const execute = vi.fn(async () => undefined);
    const target = await fixture(undefined, false, {
      approval: approveNativeDependencyPreparationPlan(basePlan, {
        approvedFingerprint,
        approvedBy: "human:repository-import",
        approvedAt: "2026-07-30T05:00:00.000Z",
      }),
      currentPlan: vi.fn(async () => ({
        ...basePlan,
        fingerprint: staleFingerprint,
      })),
      execute,
    });

    await expect(
      target.adapter.prepare(target.context, expoApplication),
    ).rejects.toThrow(/stale/u);
    expect(execute).not.toHaveBeenCalled();
    expect(target.commandPort.execute).not.toHaveBeenCalled();
  });

  it("installs once, reuses the app, runs a flow, and captures native truth", async () => {
    const { adapter, appBundlePath, calls, context } = await fixture();
    const scenario = {
      ...scenarioFixture,
      applicationId: expoApplication.id,
    };
    const preparation = await adapter.prepare(context, expoApplication);
    const firstLaunch = await adapter.launch(context, preparation);
    const raw = await adapter.capture(context, firstLaunch, scenario);
    const artifact = await adapter.collect(context, firstLaunch, raw);
    await adapter.cleanup(context, firstLaunch);
    const secondLaunch = await adapter.launch(context, preparation);
    await adapter.cleanup(context, secondLaunch);

    expect(calls.filter((call) => call.args.includes("build"))).toHaveLength(1);
    expect(
      calls.filter((call) => call.args.includes("-showBuildSettings")),
    ).toHaveLength(1);
    expect(calls.filter((call) => call.args.includes("install"))).toHaveLength(
      1,
    );
    const install = calls.find((call) => call.args.includes("install"));
    expect(install?.args).not.toContain(appBundlePath);
    expect(install?.args).toContainEqual(
      expect.stringMatching(/\/staged-apps\/native-app-[^/]+\/Buzzr\.app$/u),
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executable: "/usr/bin/sandbox-exec",
          args: expect.arrayContaining([
            "/opt/maestro/bin/maestro",
            "test",
            ".maestro/dashboard.yaml",
          ]),
        }),
        expect.objectContaining({
          executable: "/usr/bin/sandbox-exec",
          args: expect.arrayContaining([
            "/opt/maestro/bin/maestro",
            "hierarchy",
            "--compact",
          ]),
        }),
      ]),
    );
    expect(artifact).toMatchObject({
      scenarioId: scenario.id,
      screenshotHash: artifact.verification.stableFrameHash,
      dimensions: { width: 1_440, height: 900, scale: 1 },
    });
    expect(artifact.hierarchyArtifactId).not.toBeNull();
    expect(artifact.reconstructionArtifactId).toBeNull();
  });

  it("persists semantic runtime evidence as a referenced reconstruction artifact", async () => {
    const target = await fixture(undefined, true);
    const sourceHash = `sha256:${"b".repeat(64)}` as const;
    const scenario = {
      ...scenarioFixture,
      applicationId: expoApplication.id,
      sourceAnchor: {
        contentHash: sourceHash,
        relativePath: "app/(protected)/index.tsx",
        symbol: "DashboardScreen",
      },
    };
    const preparation = await target.adapter.prepare(
      target.context,
      expoApplication,
    );
    const launch = await target.adapter.launch(target.context, preparation);
    let navigationUrl = "";
    vi.mocked(target.commandPort.execute).mockImplementation(async (recipe) => {
      if (recipe.args.includes("openurl"))
        navigationUrl = recipe.args.at(-1) ?? "";
      const nonce = new URL(navigationUrl || "buzzr:///").searchParams.get(
        "__memi_capture",
      );
      return {
        stdout: recipe.args.includes("pbpaste")
          ? runtimeEvidence(scenario, {
              nonce,
              sourceRevision: target.context.job.repository.sourceRevision,
              semanticCapture: {
                appVersion: "2.1",
                layers: [
                  {
                    content: { text: "Dashboard" },
                    geometry: {
                      height: 24,
                      rotation: 0,
                      width: 120,
                      x: 24,
                      y: 44,
                    },
                    kind: "text",
                    layerId: "dashboard-title",
                    name: "Dashboard title",
                    semanticKey: "dashboard.title",
                    source: {
                      astPath: ["DashboardScreen", "Text[0]"],
                      range: { end: 120, start: 100 },
                      sourceAnchor: "app/(protected)/index.tsx#DashboardScreen",
                      sourceContentHash: sourceHash,
                    },
                    style: { fontSize: 20, fontWeight: 500 },
                    zIndex: 1,
                  },
                ],
              },
            })
          : recipe.args.includes("hierarchy")
            ? new TextEncoder().encode("role=application; role=heading")
            : recipe.args.includes("screenshot")
              ? new Uint8Array([137, 80, 78, 71])
              : new Uint8Array(),
        stderr: "",
      };
    });
    const raw = await target.adapter.capture(target.context, launch, scenario);
    const artifact = await target.adapter.collect(target.context, launch, raw);
    expect(artifact.reconstructionArtifactId).toMatch(/^art_/u);
    const buckets = await readdir(join(target.root, "artifacts/sha256"));
    const files = (
      await Promise.all(
        buckets.map(async (bucket) =>
          (await readdir(join(target.root, "artifacts/sha256", bucket)))
            .filter((file) => file.endsWith(".json"))
            .map((file) => join(target.root, "artifacts/sha256", bucket, file)),
        ),
      )
    ).flat();
    expect(files).toHaveLength(1);
    const reconstruction = RuntimeCaptureScreenV1Schema.parse(
      JSON.parse(await readFile(files[0]!, "utf8")),
    );
    expect(reconstruction.layers[0]?.semanticKey).toBe("dashboard.title");
    expect(JSON.stringify(artifact)).not.toContain("dashboard.title");
  });

  it("fails explicitly when managed Expo capture has no semantic evidence", async () => {
    const target = await fixture(undefined, true);
    const scenario = {
      ...scenarioFixture,
      applicationId: expoApplication.id,
      sourceAnchor: {
        contentHash: `sha256:${"b".repeat(64)}` as const,
        relativePath: "app/(protected)/index.tsx",
        symbol: "DashboardScreen",
      },
    };
    const preparation = await target.adapter.prepare(
      target.context,
      expoApplication,
    );
    const launch = await target.adapter.launch(target.context, preparation);
    let navigationUrl = "";
    vi.mocked(target.commandPort.execute).mockImplementation(async (recipe) => {
      if (recipe.args.includes("openurl"))
        navigationUrl = recipe.args.at(-1) ?? "";
      const nonce = new URL(navigationUrl || "buzzr:///").searchParams.get(
        "__memi_capture",
      );
      return {
        stdout: recipe.args.includes("pbpaste")
          ? runtimeEvidence(scenario, {
              nonce,
              sourceRevision: target.context.job.repository.sourceRevision,
            })
          : recipe.args.includes("hierarchy")
            ? new TextEncoder().encode("role=application")
            : recipe.args.includes("screenshot")
              ? new Uint8Array([137, 80, 78, 71])
              : new Uint8Array(),
        stderr: "",
      };
    });
    const raw = await target.adapter.capture(target.context, launch, scenario);
    await expect(
      target.adapter.collect(target.context, launch, raw),
    ).rejects.toMatchObject({
      code: "SEMANTIC_RECONSTRUCTION_EVIDENCE_MISSING",
      stage: "extract-layers",
      retryable: true,
    });
  });

  it("navigates a non-root route through its concrete standalone deep link", async () => {
    const target = await fixture(undefined, true);
    const scenario = {
      ...scenarioFixture,
      id: "csc_01J00000000000000000000001" as typeof scenarioFixture.id,
      applicationId: expoApplication.id,
      route: "/profile",
    };
    const preparation = await target.adapter.prepare(
      target.context,
      expoApplication,
    );
    const launch = await target.adapter.launch(target.context, preparation);
    let navigationUrl = "";
    vi.mocked(target.commandPort.execute).mockImplementation(async (recipe) => {
      target.calls.push({ executable: recipe.executable, args: recipe.args });
      if (recipe.args.includes("openurl"))
        navigationUrl = recipe.args.at(-1) ?? "";
      const nonce = new URL(navigationUrl || "buzzr:///").searchParams.get(
        "__memi_capture",
      );
      const stdout = recipe.args.includes("pbpaste")
        ? runtimeEvidence(scenario, {
            nonce,
            sourceRevision: target.context.job.repository.sourceRevision,
          })
        : recipe.args.includes("hierarchy")
          ? new TextEncoder().encode("role=application; role=button")
          : recipe.args.includes("screenshot")
            ? new Uint8Array([137, 80, 78, 71])
            : new Uint8Array();
      return { stdout, stderr: "" };
    });
    await expect(
      target.adapter.capture(target.context, launch, scenario),
    ).resolves.toEqual(expect.objectContaining({ scenarioId: scenario.id }));
    expect(navigationUrl).toMatch(
      /^buzzr:\/\/\/profile\?__memi_capture=[0-9A-F]{26}&__memi_state=Default$/u,
    );
    expect(
      target.calls.filter(({ args }) => args.includes("pbpaste")),
    ).toHaveLength(2);
  });

  it("runs an attested managed-copy Maestro flow after route attestation", async () => {
    const target = await fixture(undefined, true);
    const scenario = {
      ...scenarioFixture,
      id: "csc_01J00000000000000000000003" as typeof scenarioFixture.id,
      applicationId: expoApplication.id,
    };
    const preparation = await target.adapter.prepare(
      target.context,
      expoApplication,
    );
    const launch = await target.adapter.launch(target.context, preparation);
    let navigationUrl = "";
    vi.mocked(target.commandPort.execute).mockImplementation(async (recipe) => {
      target.calls.push({ executable: recipe.executable, args: recipe.args });
      if (recipe.args.includes("openurl")) {
        navigationUrl = recipe.args.at(-1) ?? "";
      }
      const nonce = new URL(navigationUrl || "buzzr:///").searchParams.get(
        "__memi_capture",
      );
      return {
        stdout: recipe.args.includes("pbpaste")
          ? runtimeEvidence(scenario, {
              nonce,
              sourceRevision: target.context.job.repository.sourceRevision,
            })
          : recipe.args.includes("hierarchy")
            ? new TextEncoder().encode("role=application; role=button")
            : recipe.args.includes("screenshot")
              ? new Uint8Array([137, 80, 78, 71])
              : new Uint8Array(),
        stderr: "",
      };
    });

    await expect(
      target.adapter.capture(target.context, launch, scenario),
    ).resolves.toEqual(expect.objectContaining({ scenarioId: scenario.id }));
    expect(target.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executable: "/usr/bin/sandbox-exec",
          args: expect.arrayContaining([
            "/opt/maestro/bin/maestro",
            "test",
            ".maestro/dashboard.yaml",
          ]),
        }),
      ]),
    );
  });

  it("rejects a changed Maestro flow before executing it", async () => {
    const target = await fixture();
    const scenario = {
      ...scenarioFixture,
      applicationId: expoApplication.id,
    };
    const preparation = await target.adapter.prepare(
      target.context,
      expoApplication,
    );
    const launch = await target.adapter.launch(target.context, preparation);
    await writeFile(
      join(target.root, ".maestro/dashboard.yaml"),
      [
        "appId: app.buzzr",
        "---",
        "- launchApp:",
        "    clearState: false",
        '- assertVisible: "Changed after planning"',
      ].join("\n"),
    );

    await expect(
      target.adapter.capture(target.context, launch, scenario),
    ).rejects.toMatchObject({ code: "FLOW_ATTESTATION_MISMATCH" });
    expect(
      target.calls.some(
        ({ args }) =>
          args.includes("/opt/maestro/bin/maestro") && args.includes("test"),
      ),
    ).toBe(false);
  });

  it("requires explicit readiness evidence for a root launch", async () => {
    const ready = await fixture();
    const rootScenario = {
      ...scenarioFixture,
      id: "csc_01J00000000000000000000002" as typeof scenarioFixture.id,
      applicationId: expoApplication.id,
      route: "/",
      readinessSelector: "Home",
    };
    const preparation = await ready.adapter.prepare(
      ready.context,
      expoApplication,
    );
    const launch = await ready.adapter.launch(ready.context, preparation);
    vi.mocked(ready.commandPort.execute).mockImplementation(async (recipe) => ({
      stdout: recipe.args.includes("hierarchy")
        ? runtimeEvidence(
            {
              ...scenarioFixture,
              route: "/",
              readinessSelector: "Home",
            },
            { readinessMatched: false },
          )
        : recipe.args.includes("screenshot")
          ? new Uint8Array([137, 80, 78, 71])
          : new Uint8Array(),
      stderr: "",
    }));
    await expect(
      ready.adapter.capture(ready.context, launch, rootScenario),
    ).rejects.toMatchObject({ code: "READINESS_NOT_REACHED" });

    vi.mocked(ready.commandPort.execute).mockImplementation(async (recipe) => ({
      stdout: recipe.args.includes("hierarchy")
        ? runtimeEvidence({
            ...scenarioFixture,
            route: "/",
            readinessSelector: "Home",
          })
        : recipe.args.includes("screenshot")
          ? new Uint8Array([137, 80, 78, 71])
          : new Uint8Array(),
      stderr: "",
    }));
    await expect(
      ready.adapter.capture(ready.context, launch, rootScenario),
    ).resolves.toBeDefined();
  });

  it("propagates cancellation, rejects Expo Go, and rejects source-worktree escapes", async () => {
    const { adapter, context } = await fixture();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      adapter.prepare({ ...context, signal: aborted.signal }, expoApplication),
    ).rejects.toThrow(/cancelled/i);

    const root = await mkdtemp(join(tmpdir(), "memi-expo-"));
    expect(
      () =>
        new ExpoMaestroCaptureAdapter({
          applications: [expoApplication],
          managedWorktreeRoot: root,
          stagingRoot: join(root, ".memi/staged-apps"),
          runtime: "standalone",
          scheme: null,
          nativeBuild: {
            container: { kind: "project", path: "/outside/Buzzr.xcodeproj" },
            scheme: "Buzzr",
            configuration: "Release",
            derivedDataPath: join(root, ".memi/DerivedData"),
            expectedBundleId: "app.buzzr",
          },
          deviceResolver: vi.fn(),
          xcodebuildExecutable: "/usr/bin/xcodebuild",
          xcrunExecutable: "/usr/bin/xcrun",
          maestroExecutable: "/opt/maestro/bin/maestro",
          artifactStore: new ContentAddressedArtifactStore(
            join(root, "artifacts"),
          ),
          commandPort: { execute: vi.fn() },
          processPolicy: policy(root),
          flowByRoute: {},
        }),
    ).toThrow(/managed worktree/i);
    expect(
      () =>
        new ExpoMaestroCaptureAdapter({
          applications: [expoApplication],
          managedWorktreeRoot: root,
          stagingRoot: join(root, ".memi/staged-apps"),
          runtime: "expo-go",
          scheme: null,
          nativeBuild: null,
          deviceResolver: vi.fn(),
          xcodebuildExecutable: "/usr/bin/xcodebuild",
          xcrunExecutable: "/usr/bin/xcrun",
          maestroExecutable: "/opt/maestro/bin/maestro",
          artifactStore: new ContentAddressedArtifactStore(
            join(root, "artifacts"),
          ),
          commandPort: { execute: vi.fn() },
          processPolicy: policy(root),
          flowByRoute: {},
        }),
    ).toThrow(/Expo Go.*unsupported/i);
  });

  it("rejects duplicate or contradictory build settings", async () => {
    const duplicate = await fixture();
    vi.mocked(duplicate.commandPort.execute).mockImplementation(
      async (recipe) => ({
        stdout: recipe.args.includes("-showBuildSettings")
          ? new TextEncoder().encode(
              [
                "PRODUCT_BUNDLE_IDENTIFIER = app.buzzr",
                "PRODUCT_BUNDLE_IDENTIFIER = app.other",
                `TARGET_BUILD_DIR = ${duplicate.root}`,
                "FULL_PRODUCT_NAME = Buzzr.app",
              ].join("\n"),
            )
          : new Uint8Array(),
        stderr: "",
      }),
    );
    await expect(
      duplicate.adapter.prepare(duplicate.context, expoApplication, []),
    ).rejects.toMatchObject({ code: "BUILD_SETTINGS_AMBIGUOUS" });
  });

  it("rejects symlinked app bundles and mismatched Info.plist authority", async () => {
    const target = await fixture();
    const nativeBuild = {
      container: {
        kind: "project" as const,
        path: join(target.root, "ios/Buzzr.xcodeproj"),
      },
      scheme: "Buzzr",
      configuration: "Release" as const,
      derivedDataPath: join(target.root, ".memi/DerivedData"),
      expectedBundleId: "app.buzzr",
    };
    const outside = await mkdtemp(join(tmpdir(), "memi-app-outside-"));
    const linked = join(
      target.root,
      ".memi/DerivedData/Build/Products/Release-iphonesimulator/Linked.app",
    );
    await symlink(outside, linked);
    const buildSettings = (path: string, product: string) =>
      new TextEncoder().encode(
        [
          "PRODUCT_BUNDLE_IDENTIFIER = app.buzzr",
          `TARGET_BUILD_DIR = ${path}`,
          `FULL_PRODUCT_NAME = ${product}`,
        ].join("\n"),
      );

    await expect(
      resolveBuiltApplication({
        managedWorktreeRoot: target.root,
        stagingRoot: join(target.root, ".memi/staged-apps"),
        nativeBuild,
        buildSettingsOutput: buildSettings(dirname(linked), "Linked.app"),
      }),
    ).rejects.toMatchObject({ code: "APP_BUNDLE_PATH_UNTRUSTED" });

    await writeFile(
      join(target.appBundlePath, "Info.plist"),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<plist version="1.0"><dict>',
        "<key>CFBundleIdentifier</key><string>app.other</string>",
        "</dict></plist>",
      ].join(""),
    );
    await expect(
      resolveBuiltApplication({
        managedWorktreeRoot: target.root,
        stagingRoot: join(target.root, ".memi/staged-apps"),
        nativeBuild,
        buildSettingsOutput: buildSettings(
          dirname(target.appBundlePath),
          "Buzzr.app",
        ),
      }),
    ).rejects.toMatchObject({ code: "APP_BUNDLE_IDENTIFIER_MISMATCH" });
  });

  it("fails instead of claiming verification without exact runtime evidence", async () => {
    const cases = [
      [{ route: "/wrong" }, "ROUTE_MISMATCH"],
      [{ state: "Wrong" }, "STATE_MISMATCH"],
      [{ readinessMatched: false }, "READINESS_NOT_REACHED"],
      [{ blank: true }, "BLANK_SCREEN"],
      [{ splash: true }, "SPLASH_SCREEN"],
      [{ errorBoundary: true }, "ERROR_BOUNDARY"],
    ] as const;
    for (const [override, code] of cases) {
      const target = await fixture();
      const scenario = {
        ...scenarioFixture,
        applicationId: expoApplication.id,
      };
      const preparation = await target.adapter.prepare(
        target.context,
        expoApplication,
        [scenario],
      );
      const launch = await target.adapter.launch(target.context, preparation);
      vi.mocked(target.commandPort.execute).mockImplementation(
        async (recipe) => ({
          stdout: recipe.args.includes("hierarchy")
            ? runtimeEvidence(scenarioFixture, override)
            : recipe.args.includes("screenshot")
              ? new Uint8Array([137, 80, 78, 71])
              : new Uint8Array(),
          stderr: "",
        }),
      );
      await expect(
        target.adapter.capture(target.context, launch, scenario),
      ).rejects.toMatchObject({ code });
    }

    const missing = await fixture();
    const scenario = {
      ...scenarioFixture,
      applicationId: expoApplication.id,
    };
    const preparation = await missing.adapter.prepare(
      missing.context,
      expoApplication,
      [scenario],
    );
    const launch = await missing.adapter.launch(missing.context, preparation);
    vi.mocked(missing.commandPort.execute).mockImplementation(
      async (recipe) => ({
        stdout: recipe.args.includes("hierarchy")
          ? new TextEncoder().encode("role=application")
          : recipe.args.includes("screenshot")
            ? new Uint8Array([137, 80, 78, 71])
            : new Uint8Array(),
        stderr: "",
      }),
    );
    await expect(
      missing.adapter.capture(missing.context, launch, scenario),
    ).rejects.toMatchObject({ code: "RUNTIME_EVIDENCE_MISSING" });
  });

  it("rejects malformed, wrong-version, and ambiguous attestations", async () => {
    const cases = [
      ['MEMI_CAPTURE_EVIDENCE_V1:{"version":1,}', "RUNTIME_EVIDENCE_INVALID"],
      ['MEMI_CAPTURE_EVIDENCE_V1:{"version":2}', "RUNTIME_EVIDENCE_INVALID"],
      [
        `${new TextDecoder().decode(runtimeEvidence(scenarioFixture))}\n${new TextDecoder().decode(runtimeEvidence(scenarioFixture))}`,
        "RUNTIME_EVIDENCE_AMBIGUOUS",
      ],
    ] as const;
    for (const [hierarchy, code] of cases) {
      const target = await fixture();
      const scenario = {
        ...scenarioFixture,
        applicationId: expoApplication.id,
      };
      const preparation = await target.adapter.prepare(
        target.context,
        expoApplication,
        [scenario],
      );
      const launch = await target.adapter.launch(target.context, preparation);
      vi.mocked(target.commandPort.execute).mockImplementation(
        async (recipe) => ({
          stdout: recipe.args.includes("hierarchy")
            ? new TextEncoder().encode(hierarchy)
            : recipe.args.includes("screenshot")
              ? new Uint8Array([137, 80, 78, 71])
              : new Uint8Array(),
          stderr: "",
        }),
      );
      await expect(
        target.adapter.capture(target.context, launch, scenario),
      ).rejects.toMatchObject({ code });
    }
  });

  it("rejects an asynchronous resolver that contradicts build settings", async () => {
    const resolver: ResolveBuiltApplication = vi.fn(async () => ({
      appBundlePath: "/outside/Fake.app",
      bundleId: "app.fake",
    }));
    const contradictory = await fixture(resolver);
    await expect(
      contradictory.adapter.prepare(contradictory.context, expoApplication, []),
    ).rejects.toMatchObject({ code: "BUILD_RESOLVER_MISMATCH" });
    expect(resolver).toHaveBeenCalledOnce();
  });

  it("rejects unknown applications, inactive launches, and missing evidence", async () => {
    const { adapter, context } = await fixture();
    await expect(
      adapter.prepare(context, { ...expoApplication, id: "unknown" }),
    ).rejects.toThrow(/not discovered/i);
    await expect(
      adapter.capture(
        context,
        { id: "missing", preparationId: "missing" },
        { ...scenarioFixture, applicationId: expoApplication.id },
      ),
    ).rejects.toThrow(/not active/i);
    await expect(
      adapter.collect(
        context,
        { id: "missing", preparationId: "missing" },
        { id: "missing", scenarioId: scenarioFixture.id },
      ),
    ).rejects.toThrow(/not found/i);
    await expect(adapter.cleanup(context, null)).resolves.toBeUndefined();
  });

  it("rejects unstable screenshots and empty hierarchy evidence", async () => {
    const unstable = await fixture();
    let screenshot = 0;
    vi.mocked(unstable.commandPort.execute).mockImplementation(
      async (recipe) => {
        if (recipe.args.includes("-showBuildSettings")) {
          return {
            stdout: new TextEncoder().encode(
              [
                "PRODUCT_BUNDLE_IDENTIFIER = app.buzzr",
                `TARGET_BUILD_DIR = ${dirname(unstable.appBundlePath)}`,
                "FULL_PRODUCT_NAME = Buzzr.app",
              ].join("\n"),
            ),
            stderr: "",
          };
        }
        if (recipe.args.includes("screenshot")) {
          screenshot += 1;
          return {
            stdout: new Uint8Array([screenshot]),
            stderr: "",
          };
        }
        return {
          stdout: new TextEncoder().encode("hierarchy"),
          stderr: "",
        };
      },
    );
    const scenario = {
      ...scenarioFixture,
      applicationId: expoApplication.id,
    };
    const preparation = await unstable.adapter.prepare(
      unstable.context,
      expoApplication,
    );
    const launch = await unstable.adapter.launch(unstable.context, preparation);
    await expect(
      unstable.adapter.capture(unstable.context, launch, scenario),
    ).rejects.toMatchObject({ code: "UNSTABLE_FRAME" });

    const empty = await fixture();
    vi.mocked(empty.commandPort.execute).mockImplementation(async (recipe) => {
      if (recipe.args.includes("-showBuildSettings")) {
        return {
          stdout: new TextEncoder().encode(
            [
              "PRODUCT_BUNDLE_IDENTIFIER = app.buzzr",
              `TARGET_BUILD_DIR = ${dirname(empty.appBundlePath)}`,
              "FULL_PRODUCT_NAME = Buzzr.app",
            ].join("\n"),
          ),
          stderr: "",
        };
      }
      return {
        stdout: recipe.args.includes("hierarchy")
          ? new Uint8Array()
          : new Uint8Array([1]),
        stderr: "",
      };
    });
    const emptyPreparation = await empty.adapter.prepare(
      empty.context,
      expoApplication,
    );
    const emptyLaunch = await empty.adapter.launch(
      empty.context,
      emptyPreparation,
    );
    await expect(
      empty.adapter.capture(empty.context, emptyLaunch, scenario),
    ).rejects.toMatchObject({ code: "HIERARCHY_EMPTY" });
  });
});
