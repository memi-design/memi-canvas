import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ContentAddressedArtifactStore } from "./artifact-store.js";
import type { NativeCommandPort } from "./expo-maestro-adapter.js";
import type { ProcessExecutionPolicy } from "./process-policy.js";
import {
  SwiftUIXCUITestCaptureAdapter,
  type SwiftUIXCUITestPort,
} from "./swiftui-xcuitest-adapter.js";
import { jobFixture, scenarioFixture } from "./test-fixtures.js";

const swiftUIApplication = {
  id: "swiftui",
  label: "SwiftUI",
  platform: "swiftui" as const,
  relativeRoot: ".",
};

function pngFixture(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

const png = pngFixture(1_440, 900);

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
          { kind: "safe-token" },
          literal("-configuration"),
          literal("Debug"),
          literal("-sdk"),
          literal("iphonesimulator"),
          literal("-destination"),
          literal("generic/platform=iOS Simulator"),
          literal("-derivedDataPath"),
          { kind: "safe-token" },
          literal("ENABLE_USER_SCRIPT_SANDBOXING=YES"),
          literal("build"),
        ],
      },
      {
        executable: "/usr/bin/xcodebuild",
        arguments: [
          literal("-project"),
          { kind: "safe-token" },
          literal("-scheme"),
          { kind: "safe-token" },
          literal("-configuration"),
          literal("Debug"),
          literal("-sdk"),
          literal("iphonesimulator"),
          literal("-destination"),
          literal("generic/platform=iOS Simulator"),
          literal("-derivedDataPath"),
          { kind: "safe-token" },
          literal("ENABLE_USER_SCRIPT_SANDBOXING=YES"),
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
          { kind: "safe-token" },
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
      allowedReadRoots: [root, "/usr"],
      allowedWriteRoots: [root],
      network: "none",
    },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "memi-swiftui-"));
  const derivedDataPath = join(root, ".memi/DerivedData");
  const stagingRoot = join(root, ".memi/staged-apps");
  const targetBuildDirectory = join(
    derivedDataPath,
    "Build/Products/Debug-iphonesimulator",
  );
  const applicationBundle = join(targetBuildDirectory, "Fixture.app");
  await mkdir(applicationBundle, { recursive: true });
  await mkdir(stagingRoot, { recursive: true });
  await writeFile(
    join(applicationBundle, "Info.plist"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"',
      '  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      "<key>CFBundleIdentifier</key>",
      "<string>design.memi.fixture</string>",
      "</dict></plist>",
    ].join("\n"),
  );
  const calls: { executable: string; args: readonly string[] }[] = [];
  const commandPort: NativeCommandPort = {
    execute: vi.fn(async (recipe) => {
      calls.push({ executable: recipe.executable, args: recipe.args });
      if (recipe.args.includes("-showBuildSettings")) {
        return {
          stdout: new TextEncoder().encode(
            [
              "    PRODUCT_BUNDLE_IDENTIFIER = design.memi.fixture",
              `    TARGET_BUILD_DIR = ${targetBuildDirectory}`,
              "    FULL_PRODUCT_NAME = Fixture.app",
            ].join("\n"),
          ),
          stderr: "",
        };
      }
      return {
        stdout: recipe.args.includes("screenshot")
          ? png
          : new Uint8Array(),
        stderr: "",
      };
    }),
  };
  const xcuiTestPort: SwiftUIXCUITestPort = {
    runScenario: vi.fn(async ({ scenario }) => ({
      route: scenario.route,
      state: scenario.state,
      readinessMatched: true,
      blank: false,
      splash: false,
      errorBoundary: false,
      hierarchy: new TextEncoder().encode(
        JSON.stringify({
          role: "application",
          children: [{ role: "button", label: "Continue" }],
        }),
      ),
      geometry: new TextEncoder().encode(
        JSON.stringify({
          nodes: [{ path: "0/0", x: 20, y: 40, width: 120, height: 44 }],
        }),
      ),
      sourceAnchor: scenario.sourceAnchor,
    })),
  };
  const options = {
    applications: [swiftUIApplication],
    managedWorktreeRoot: root,
    stagingRoot,
    nativeBuild: {
      container: {
        kind: "project",
        path: join(root, "Fixture.xcodeproj"),
      },
      scheme: "Fixture",
      configuration: "Debug",
      derivedDataPath,
      expectedBundleId: "design.memi.fixture",
    },
    deviceResolver: vi.fn(async () => ({ deviceId: "SIMULATOR-1" })),
    xcodebuildExecutable: "/usr/bin/xcodebuild",
    xcrunExecutable: "/usr/bin/xcrun",
    artifactStore: new ContentAddressedArtifactStore(
      join(root, ".memi/artifacts"),
    ),
    commandPort,
    processPolicy: policy(root),
    xcuiTestPort,
    stableFrameDelayMs: 0,
    now: () => new Date("2026-07-30T10:00:00.000Z"),
  } satisfies ConstructorParameters<
    typeof SwiftUIXCUITestCaptureAdapter
  >[0];
  const adapter = new SwiftUIXCUITestCaptureAdapter(options);
  const scenario = {
    ...scenarioFixture,
    applicationId: swiftUIApplication.id,
    sourceAnchor: {
      relativePath: "Sources/DashboardView.swift",
      symbol: "DashboardView",
      contentHash: `sha256:${"b".repeat(64)}` as const,
    },
  };
  const context = {
    job: {
      ...jobFixture,
      applications: [swiftUIApplication],
      scenarios: [scenario],
      currentApplicationId: swiftUIApplication.id,
      currentScenarioId: scenario.id,
    },
    signal: new AbortController().signal,
  };
  return {
    adapter,
    applicationBundle,
    calls,
    commandPort,
    context,
    options,
    root,
    scenario,
    xcuiTestPort,
  };
}

describe("SwiftUIXCUITestCaptureAdapter", () => {
  it("builds and installs once, reuses the app, and collects verified native evidence", async () => {
    const {
      adapter,
      applicationBundle,
      calls,
      context,
      scenario,
      xcuiTestPort,
    } =
      await fixture();
    const firstPreparation = await adapter.prepare(
      context,
      swiftUIApplication,
      [scenario],
    );
    const secondPreparation = await adapter.prepare(
      context,
      swiftUIApplication,
      [scenario],
    );
    const firstLaunch = await adapter.launch(context, firstPreparation);
    const secondLaunch = await adapter.launch(context, secondPreparation);
    const raw = await adapter.capture(
      context,
      secondLaunch,
      scenario,
    );
    const artifact = await adapter.collect(
      context,
      secondLaunch,
      raw,
    );
    await adapter.cleanup(context, firstLaunch);
    await adapter.cleanup(context, secondLaunch);

    expect(
      calls.filter((call) => call.args.includes("build")),
    ).toHaveLength(1);
    expect(
      calls.filter((call) => call.args.includes("-showBuildSettings")),
    ).toHaveLength(1);
    expect(
      calls.filter((call) => call.args.includes("install")),
    ).toHaveLength(1);
    const install = calls.find((call) => call.args.includes("install"));
    expect(install?.args).not.toContain(applicationBundle);
    expect(install?.args).toContainEqual(
      expect.stringMatching(
        /\/staged-apps\/native-app-[^/]+\/Fixture\.app$/u,
      ),
    );
    expect(
      calls.filter((call) => call.args.includes("launch")),
    ).toHaveLength(2);
    expect(xcuiTestPort.runScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        bundleId: "design.memi.fixture",
        deviceId: "SIMULATOR-1",
        scenario,
      }),
      context.signal,
    );
    expect(artifact).toMatchObject({
      scenarioId: scenario.id,
      sourceRevision: context.job.repository.sourceRevision,
      dimensions: { width: 1_440, height: 900, scale: 1 },
      verification: {
        routeMatched: true,
        blankRejected: true,
        splashRejected: true,
        errorBoundaryRejected: true,
        verifiedAt: "2026-07-30T10:00:00.000Z",
      },
    });
    expect(artifact.screenshotHash).toBe(
      artifact.verification.stableFrameHash,
    );
    expect(artifact.hierarchyArtifactId).not.toBeNull();
    expect(artifact.geometryArtifactId).not.toBeNull();
  });

  it("rejects route, state, readiness, source, blank, splash, and error evidence mismatches", async () => {
    const { adapter, context, scenario, xcuiTestPort } = await fixture();
    const preparation = await adapter.prepare(
      context,
      swiftUIApplication,
      [scenario],
    );
    const launch = await adapter.launch(context, preparation);
    const invalidEvidence = [
      { route: "/wrong" },
      { state: "Wrong" },
      { readinessMatched: false },
      {
        sourceAnchor: {
          ...scenario.sourceAnchor!,
          symbol: "WrongView",
        },
      },
      { blank: true },
      { splash: true },
      { errorBoundary: true },
    ];
    const codes = [
      "ROUTE_MISMATCH",
      "STATE_MISMATCH",
      "READINESS_NOT_REACHED",
      "SOURCE_EVIDENCE_MISMATCH",
      "BLANK_SCREEN",
      "SPLASH_SCREEN",
      "ERROR_BOUNDARY",
    ];
    for (const [index, override] of invalidEvidence.entries()) {
      vi.mocked(xcuiTestPort.runScenario).mockResolvedValueOnce({
        route: scenario.route,
        state: scenario.state,
        readinessMatched: true,
        blank: false,
        splash: false,
        errorBoundary: false,
        hierarchy: new TextEncoder().encode('{"role":"application"}'),
        geometry: new TextEncoder().encode('{"nodes":[]}'),
        sourceAnchor: scenario.sourceAnchor,
        ...override,
      });
      await expect(
        adapter.capture(context, launch, scenario),
      ).rejects.toMatchObject({ code: codes[index] });
    }
  });

  it("rejects unstable frames, non-PNG output, and missing hierarchy or geometry", async () => {
    const unstable = await fixture();
    const preparation = await unstable.adapter.prepare(
      unstable.context,
      swiftUIApplication,
      [unstable.scenario],
    );
    const launch = await unstable.adapter.launch(
      unstable.context,
      preparation,
    );
    let screenshot = 0;
    vi.mocked(unstable.commandPort.execute).mockImplementation(
      async (recipe) => ({
        stdout: recipe.args.includes("screenshot")
          ? new Uint8Array([...png, screenshot++])
          : new Uint8Array(),
        stderr: "",
      }),
    );
    await expect(
      unstable.adapter.capture(
        unstable.context,
        launch,
        unstable.scenario,
      ),
    ).rejects.toMatchObject({ code: "UNSTABLE_FRAME" });

    const invalid = await fixture();
    const invalidPreparation = await invalid.adapter.prepare(
      invalid.context,
      swiftUIApplication,
      [invalid.scenario],
    );
    const invalidLaunch = await invalid.adapter.launch(
      invalid.context,
      invalidPreparation,
    );
    vi.mocked(invalid.commandPort.execute).mockImplementation(
      async (recipe) => ({
        stdout: recipe.args.includes("screenshot")
          ? new Uint8Array([1, 2, 3])
          : new Uint8Array(),
        stderr: "",
      }),
    );
    await expect(
      invalid.adapter.capture(
        invalid.context,
        invalidLaunch,
        invalid.scenario,
      ),
    ).rejects.toMatchObject({ code: "INVALID_PNG" });

    for (const field of ["hierarchy", "geometry"] as const) {
      const missing = await fixture();
      const missingPreparation = await missing.adapter.prepare(
        missing.context,
        swiftUIApplication,
        [missing.scenario],
      );
      const missingLaunch = await missing.adapter.launch(
        missing.context,
        missingPreparation,
      );
      vi.mocked(missing.xcuiTestPort.runScenario).mockResolvedValueOnce({
        route: missing.scenario.route,
        state: missing.scenario.state,
        readinessMatched: true,
        blank: false,
        splash: false,
        errorBoundary: false,
        hierarchy: new TextEncoder().encode('{"role":"application"}'),
        geometry: new TextEncoder().encode('{"nodes":[]}'),
        sourceAnchor: missing.scenario.sourceAnchor,
        [field]: new Uint8Array(),
      });
      await expect(
        missing.adapter.capture(
          missing.context,
          missingLaunch,
          missing.scenario,
        ),
      ).rejects.toMatchObject({
        code:
          field === "hierarchy"
            ? "HIERARCHY_EMPTY"
            : "GEOMETRY_EMPTY",
      });
    }
  });

  it("rejects screenshots whose physical pixels do not match the planned viewport", async () => {
    const wrongSize = await fixture();
    const preparation = await wrongSize.adapter.prepare(
      wrongSize.context,
      swiftUIApplication,
      [wrongSize.scenario],
    );
    const launch = await wrongSize.adapter.launch(
      wrongSize.context,
      preparation,
    );
    vi.mocked(wrongSize.commandPort.execute).mockImplementation(
      async (recipe) => ({
        stdout: recipe.args.includes("screenshot")
          ? pngFixture(390, 844)
          : new Uint8Array(),
        stderr: "",
      }),
    );

    await expect(
      wrongSize.adapter.capture(
        wrongSize.context,
        launch,
        wrongSize.scenario,
      ),
    ).rejects.toMatchObject({ code: "SCREENSHOT_DIMENSIONS_MISMATCH" });
  });

  it("propagates cancellation through build and XCUITest capture", async () => {
    const duringBuild = await fixture();
    const buildAbort = new AbortController();
    buildAbort.abort();
    await expect(
      duringBuild.adapter.prepare(
        { ...duringBuild.context, signal: buildAbort.signal },
        swiftUIApplication,
        [duringBuild.scenario],
      ),
    ).rejects.toThrow(/cancelled/i);

    const duringCapture = await fixture();
    const preparation = await duringCapture.adapter.prepare(
      duringCapture.context,
      swiftUIApplication,
      [duringCapture.scenario],
    );
    const launch = await duringCapture.adapter.launch(
      duringCapture.context,
      preparation,
    );
    vi.mocked(
      duringCapture.xcuiTestPort.runScenario,
    ).mockImplementationOnce(async (_input, signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("Capture was cancelled.")),
          { once: true },
        );
      });
      throw new Error("unreachable");
    });
    const captureAbort = new AbortController();
    const pending = duringCapture.adapter.capture(
      { ...duringCapture.context, signal: captureAbort.signal },
      launch,
      duringCapture.scenario,
    );
    captureAbort.abort();
    await expect(pending).rejects.toThrow(/cancelled/i);
  });

  it("rejects unmanaged paths, unknown applications, inactive launches, and missing captures", async () => {
    const { adapter, context, options, root, scenario } =
      await fixture();
    await expect(
      adapter.prepare(
        context,
        { ...swiftUIApplication, id: "unknown" },
        [scenario],
      ),
    ).rejects.toThrow(/not discovered/i);
    await expect(
      adapter.capture(
        context,
        { id: "missing", preparationId: "missing" },
        scenario,
      ),
    ).rejects.toThrow(/not active/i);
    await expect(
      adapter.collect(
        context,
        { id: "missing", preparationId: "missing" },
        { id: "missing", scenarioId: scenario.id },
      ),
    ).rejects.toThrow(/not found/i);
    await expect(adapter.cleanup(context, null)).resolves.toBeUndefined();

    expect(
      () =>
        new SwiftUIXCUITestCaptureAdapter({
          applications: [swiftUIApplication],
          managedWorktreeRoot: root,
          stagingRoot: join(root, ".memi/staged-apps"),
          nativeBuild: {
            container: {
              kind: "project",
              path: "/outside/Fixture.xcodeproj",
            },
            scheme: "Fixture",
            configuration: "Debug",
            derivedDataPath: join(root, ".memi/DerivedData"),
            expectedBundleId: "design.memi.fixture",
          },
          deviceResolver: vi.fn(),
          xcodebuildExecutable: "/usr/bin/xcodebuild",
          xcrunExecutable: "/usr/bin/xcrun",
          artifactStore: new ContentAddressedArtifactStore(
            join(root, ".memi/artifacts"),
          ),
          commandPort: { execute: vi.fn() },
          processPolicy: policy(root),
          xcuiTestPort: { runScenario: vi.fn() },
        }),
    ).toThrow(/managed worktree/i);
    expect(
      () =>
        new SwiftUIXCUITestCaptureAdapter({
          ...options,
          applications: [
            {
              ...swiftUIApplication,
              platform: "react-web",
            },
          ],
        }),
    ).toThrow(/only accepts/i);
    expect(
      () =>
        new SwiftUIXCUITestCaptureAdapter({
          ...options,
          nativeBuild: {
            ...options.nativeBuild,
            scheme: "../unsafe",
          },
        }),
    ).toThrow(/identifiers/i);
  });

  it("rejects missing, duplicate, contradictory, or escaping build settings", async () => {
    const cases = [
      {
        output: [
          "PRODUCT_BUNDLE_IDENTIFIER = design.memi.fixture",
          "FULL_PRODUCT_NAME = Fixture.app",
        ],
        code: "BUILD_SETTINGS_MISSING",
      },
      {
        output: [
          "PRODUCT_BUNDLE_IDENTIFIER = design.memi.fixture",
          "PRODUCT_BUNDLE_IDENTIFIER = design.memi.fixture",
          "TARGET_BUILD_DIR = TARGET",
          "FULL_PRODUCT_NAME = Fixture.app",
        ],
        code: "BUILD_SETTINGS_AMBIGUOUS",
      },
      {
        output: [
          "PRODUCT_BUNDLE_IDENTIFIER = design.other",
          "TARGET_BUILD_DIR = TARGET",
          "FULL_PRODUCT_NAME = Fixture.app",
        ],
        code: "BUNDLE_IDENTIFIER_MISMATCH",
      },
      {
        output: [
          "PRODUCT_BUNDLE_IDENTIFIER = design.memi.fixture",
          "TARGET_BUILD_DIR = /outside",
          "FULL_PRODUCT_NAME = Fixture.app",
        ],
        code: "APP_BUNDLE_PATH_ESCAPE",
      },
    ] as const;
    for (const item of cases) {
      const target = await fixture();
      vi.mocked(target.commandPort.execute).mockImplementation(
        async (recipe) => ({
          stdout: recipe.args.includes("-showBuildSettings")
            ? new TextEncoder().encode(
                item.output
                  .map((line) =>
                    line === "TARGET_BUILD_DIR = TARGET"
                      ? `TARGET_BUILD_DIR = ${target.root}`
                      : line,
                  )
                  .join("\n"),
              )
            : new Uint8Array(),
          stderr: "",
        }),
      );
      await expect(
        target.adapter.prepare(
          target.context,
          swiftUIApplication,
          [target.scenario],
        ),
      ).rejects.toMatchObject({ code: item.code });
    }
  });

  it("requires a source revision before storing runtime truth", async () => {
    const { adapter, context, scenario } = await fixture();
    const preparation = await adapter.prepare(
      context,
      swiftUIApplication,
      [scenario],
    );
    const launch = await adapter.launch(context, preparation);
    await expect(
      adapter.capture(
        {
          ...context,
          job: {
            ...context.job,
            repository: {
              ...context.job.repository,
              sourceRevision: null,
            },
          },
        },
        launch,
        scenario,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_REVISION_MISSING" });
  });

  it("bounds XCUITest hierarchy and geometry evidence before persistence", async () => {
    const bounded = await fixture();
    const adapter = new SwiftUIXCUITestCaptureAdapter({
      ...bounded.options,
      maximumEvidenceBytes: 8,
    });
    const preparation = await adapter.prepare(
      bounded.context,
      swiftUIApplication,
      [bounded.scenario],
    );
    const launch = await adapter.launch(
      bounded.context,
      preparation,
    );

    await expect(
      adapter.capture(
        bounded.context,
        launch,
        bounded.scenario,
      ),
    ).rejects.toMatchObject({ code: "HIERARCHY_TOO_LARGE" });
  });
});
