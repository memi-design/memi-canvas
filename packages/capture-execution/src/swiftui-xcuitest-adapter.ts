import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
  CaptureAdapterContextV1,
  CaptureAdapterMetadataV1,
  CaptureAdapterV1,
  CaptureLaunchV1,
  CapturePreparationV1,
  RawCaptureV1,
} from "@memi/capture-import";
import { parseCaptureAdapterMetadataV1 } from "@memi/capture-import";
import {
  CaptureArtifactSchemaV2,
  type CaptureArtifactV2,
  type CaptureScenarioV2,
  type ImportApplicationV2,
} from "@memi/protocol";

import { ContentAddressedArtifactStore } from "./artifact-store.js";
import {
  type NativeCommandPort,
  type NativeCommandResult,
  type NativeBuildConfiguration,
  type NativeDeviceResolver,
  type ResolvedBuiltApplication,
  type ResolveBuiltApplication,
  resolveTrustedBuiltApplication,
} from "./expo-maestro-adapter.js";
import { CaptureExecutionError } from "./executor.js";
import {
  type ProcessExecutionPolicy,
  type ProcessRecipe,
  sandboxProcessRecipe,
} from "./process-policy.js";
import { verifyStableFrames } from "./stability.js";

export interface SwiftUIXCUITestEvidence {
  readonly route: string;
  readonly state: string;
  readonly readinessMatched: boolean;
  readonly blank: boolean;
  readonly splash: boolean;
  readonly errorBoundary: boolean;
  readonly hierarchy: Uint8Array;
  readonly geometry: Uint8Array;
  readonly sourceAnchor: CaptureScenarioV2["sourceAnchor"];
}

export interface SwiftUIXCUITestInput {
  readonly deviceId: string;
  readonly bundleId: string;
  readonly launchId: string;
  readonly scenario: CaptureScenarioV2;
}

export interface SwiftUIXCUITestPort {
  runScenario(
    input: SwiftUIXCUITestInput,
    signal: AbortSignal,
  ): Promise<SwiftUIXCUITestEvidence>;
}

export interface SwiftUIXCUITestCaptureAdapterOptions {
  readonly applications: readonly ImportApplicationV2[];
  readonly managedWorktreeRoot: string;
  readonly stagingRoot: string;
  readonly nativeBuild: NativeBuildConfiguration;
  readonly deviceResolver: NativeDeviceResolver;
  readonly builtApplicationResolver?: ResolveBuiltApplication;
  readonly xcodebuildExecutable: string;
  /** @deprecated Legacy test mode. Production uses direct simctl. */
  readonly xcrunExecutable?: string;
  readonly simctlExecutable?: string;
  readonly simulatorDeviceSetPath?: string;
  readonly artifactStore: ContentAddressedArtifactStore;
  readonly commandPort: NativeCommandPort;
  readonly processPolicy: ProcessExecutionPolicy;
  readonly simulatorProcessPolicy?: ProcessExecutionPolicy;
  readonly xcuiTestPort: SwiftUIXCUITestPort;
  readonly now?: () => Date;
  readonly stableFrameDelayMs?: number;
  readonly maximumEvidenceBytes?: number;
}

interface NativeLaunchState {
  readonly launch: CaptureLaunchV1;
  readonly applicationId: string;
  readonly deviceId: string;
  readonly builtApplication: ResolvedBuiltApplication;
}

interface NativePreparationState {
  readonly deviceId: string;
  readonly builtApplication: ResolvedBuiltApplication;
}

interface NativeCaptureState {
  readonly scenario: CaptureScenarioV2;
  readonly screenshotArtifactId: `art_${string}`;
  readonly hierarchyArtifactId: `art_${string}`;
  readonly geometryArtifactId: `art_${string}`;
  readonly screenshotHash: `sha256:${string}`;
  readonly stableHash: `sha256:${string}`;
  readonly fixtureFingerprint: `sha256:${string}`;
  readonly sourceRevision: string;
}

const PNG_SIGNATURE = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
]);

function contained(root: string, candidate: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

function hash(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function id(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 20)}`;
}

function artifactId(value: string): `art_${string}` {
  return `art_${createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 26)
    .toUpperCase()}`;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 24 &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) &&
    bytes[12] === 73 &&
    bytes[13] === 72 &&
    bytes[14] === 68 &&
    bytes[15] === 82
  );
}

function pngDimensions(
  bytes: Uint8Array,
): Readonly<{ width: number; height: number }> | null {
  if (!isPng(bytes)) {
    return null;
  }
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0
    ? Object.freeze({ width, height })
    : null;
}

function sameSourceAnchor(
  expected: CaptureScenarioV2["sourceAnchor"],
  actual: CaptureScenarioV2["sourceAnchor"],
): boolean {
  if (expected === null) {
    return actual === null;
  }
  return (
    actual !== null &&
    actual.relativePath === expected.relativePath &&
    actual.symbol === expected.symbol &&
    actual.contentHash === expected.contentHash
  );
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Capture was cancelled."));
      },
      { once: true },
    );
  });
}

function validateRuntimeEvidence(
  scenario: CaptureScenarioV2,
  evidence: SwiftUIXCUITestEvidence,
  maximumEvidenceBytes: number,
): void {
  const failures: readonly Readonly<{
    invalid: boolean;
    code: string;
    stage: "capture" | "verify" | "extract-layers";
    message: string;
  }>[] = [
    {
      invalid: evidence.route !== scenario.route,
      code: "ROUTE_MISMATCH",
      stage: "verify",
      message: "XCUITest reached a different route than the capture scenario.",
    },
    {
      invalid: evidence.state !== scenario.state,
      code: "STATE_MISMATCH",
      stage: "verify",
      message: "XCUITest reached a different UI state than the capture scenario.",
    },
    {
      invalid: !evidence.readinessMatched,
      code: "READINESS_NOT_REACHED",
      stage: "capture",
      message: "The route-specific readiness condition was not reached.",
    },
    {
      invalid: !sameSourceAnchor(
        scenario.sourceAnchor,
        evidence.sourceAnchor,
      ),
      code: "SOURCE_EVIDENCE_MISMATCH",
      stage: "verify",
      message: "Runtime source evidence does not match the planned Swift view.",
    },
    {
      invalid: evidence.blank,
      code: "BLANK_SCREEN",
      stage: "verify",
      message: "The captured SwiftUI screen was blank.",
    },
    {
      invalid: evidence.splash,
      code: "SPLASH_SCREEN",
      stage: "verify",
      message: "The captured SwiftUI screen was still showing a splash screen.",
    },
    {
      invalid: evidence.errorBoundary,
      code: "ERROR_BOUNDARY",
      stage: "verify",
      message: "The captured SwiftUI screen contained a runtime error state.",
    },
    {
      invalid: evidence.hierarchy.byteLength === 0,
      code: "HIERARCHY_EMPTY",
      stage: "extract-layers",
      message: "XCUITest returned an empty accessibility hierarchy.",
    },
    {
      invalid: evidence.hierarchy.byteLength > maximumEvidenceBytes,
      code: "HIERARCHY_TOO_LARGE",
      stage: "extract-layers",
      message: "XCUITest accessibility hierarchy exceeded its size limit.",
    },
    {
      invalid: evidence.geometry.byteLength === 0,
      code: "GEOMETRY_EMPTY",
      stage: "extract-layers",
      message: "XCUITest returned no runtime geometry.",
    },
    {
      invalid: evidence.geometry.byteLength > maximumEvidenceBytes,
      code: "GEOMETRY_TOO_LARGE",
      stage: "extract-layers",
      message: "XCUITest runtime geometry exceeded its size limit.",
    },
  ];
  const failure = failures.find((candidate) => candidate.invalid);
  if (failure !== undefined) {
    throw new CaptureExecutionError(
      failure.stage,
      failure.code,
      true,
      failure.message,
    );
  }
}

export class SwiftUIXCUITestCaptureAdapter
  implements CaptureAdapterV1
{
  readonly metadata: CaptureAdapterMetadataV1 =
    parseCaptureAdapterMetadataV1({
      id: "xcuitest-swiftui",
      platform: "swiftui",
      version: "1.0.0",
      capabilities: [
        "discover",
        "prepare",
        "launch",
        "capture",
        "collect",
        "cleanup",
      ],
    });

  readonly #options: SwiftUIXCUITestCaptureAdapterOptions;
  #preparations: Readonly<Record<string, NativePreparationState>> =
    Object.freeze({});
  #installedApplications: Readonly<Record<string, string>> =
    Object.freeze({});
  #launches: Readonly<Record<string, NativeLaunchState>> =
    Object.freeze({});
  #captures: Readonly<Record<string, NativeCaptureState>> =
    Object.freeze({});

  constructor(options: SwiftUIXCUITestCaptureAdapterOptions) {
    const managedPaths = [
      options.nativeBuild.container.path,
      options.nativeBuild.derivedDataPath,
    ];
    if (
      !isAbsolute(options.managedWorktreeRoot) ||
      managedPaths.some(
        (path) =>
          !isAbsolute(path) ||
          !contained(options.managedWorktreeRoot, path),
      )
    ) {
      throw new Error(
        "SwiftUI capture paths must be inside the managed worktree.",
      );
    }
    if (
      options.simctlExecutable !== undefined &&
      options.simulatorProcessPolicy === undefined
    ) {
      throw new Error(
        "Direct simctl requires a separate simulator process policy.",
      );
    }
    if (
      options.applications.length === 0 ||
      options.applications.some(
        (application) => application.platform !== "swiftui",
      )
    ) {
      throw new Error(
        "SwiftUI adapter only accepts discovered swiftui applications.",
      );
    }
    if (
      !/^[A-Za-z0-9._-]{1,160}$/u.test(options.nativeBuild.scheme) ||
      (options.maximumEvidenceBytes !== undefined &&
        (!Number.isSafeInteger(options.maximumEvidenceBytes) ||
          options.maximumEvidenceBytes < 1 ||
          options.maximumEvidenceBytes > 64 * 1_024 * 1_024))
    ) {
      throw new Error("SwiftUI capture identifiers are invalid.");
    }
    if (
      (options.simctlExecutable === undefined) ===
        (options.xcrunExecutable === undefined) ||
      (options.simctlExecutable !== undefined &&
        (options.simulatorDeviceSetPath === undefined ||
          !isAbsolute(options.simulatorDeviceSetPath)))
    ) {
      throw new Error(
        "SwiftUI capture requires one simulator executable and a device set for direct simctl.",
      );
    }
    this.#options = Object.freeze({
      ...options,
      applications: Object.freeze([...options.applications]),
      nativeBuild: Object.freeze({
        ...options.nativeBuild,
        container: Object.freeze({
          ...options.nativeBuild.container,
        }),
      }),
    });
  }

  #xcodebuildArgs(
    action: "build" | "settings",
  ): readonly string[] {
    const nativeBuild = this.#options.nativeBuild;
    const common = [
      nativeBuild.container.kind === "project"
        ? "-project"
        : "-workspace",
      nativeBuild.container.path,
      "-scheme",
      nativeBuild.scheme,
      "-configuration",
      nativeBuild.configuration,
      "-sdk",
      "iphonesimulator",
    ];
    return Object.freeze(
      action === "build"
        ? [
            ...common,
            "-destination",
            "generic/platform=iOS Simulator",
            "-derivedDataPath",
            nativeBuild.derivedDataPath,
            "ENABLE_USER_SCRIPT_SANDBOXING=YES",
            "build",
          ]
        : [
            ...common,
            "-destination",
            "generic/platform=iOS Simulator",
            "-derivedDataPath",
            nativeBuild.derivedDataPath,
            "ENABLE_USER_SCRIPT_SANDBOXING=YES",
            "-showBuildSettings",
          ],
    );
  }

  async #execute(
    recipe: ProcessRecipe,
    signal: AbortSignal,
  ): Promise<NativeCommandResult> {
    if (signal.aborted) {
      throw new Error("Capture was cancelled.");
    }
    return this.#options.commandPort.execute(
      sandboxProcessRecipe(
        recipe,
        recipe.executable === this.#options.simctlExecutable
          ? this.#options.simulatorProcessPolicy!
          : this.#options.processPolicy,
      ),
      signal,
    );
  }

  #simctlRecipe(args: readonly string[]): ProcessRecipe {
    if (this.#options.simctlExecutable !== undefined) {
      return {
        executable: this.#options.simctlExecutable,
        args: [
          "--set",
          this.#options.simulatorDeviceSetPath!,
          ...args,
        ],
        cwd: this.#options.managedWorktreeRoot,
      };
    }
    return {
      executable: this.#options.xcrunExecutable!,
      args: ["simctl", ...args],
      cwd: this.#options.managedWorktreeRoot,
    };
  }

  async discover(): Promise<readonly ImportApplicationV2[]> {
    return Object.freeze([...this.#options.applications]);
  }

  async prepare(
    context: CaptureAdapterContextV1,
    application: ImportApplicationV2,
    scenarios: readonly CaptureScenarioV2[],
  ): Promise<CapturePreparationV1> {
    if (context.signal.aborted) {
      throw new Error("Capture was cancelled.");
    }
    if (
      !this.#options.applications.some(
        (candidate) => candidate.id === application.id,
      )
    ) {
      throw new Error("SwiftUI application was not discovered.");
    }
    if (
      scenarios.some(
        (scenario) => scenario.applicationId !== application.id,
      )
    ) {
      throw new Error(
        "SwiftUI scenarios must belong to the prepared application.",
      );
    }
    const preparation = Object.freeze({
      id: id(
        "preparation",
        `${context.job.id}:${application.id}:${context.job.repository.sourceRevision ?? "dirty"}`,
      ),
      application,
      repository: context.job.repository,
    });
    if (this.#preparations[preparation.id] === undefined) {
      const { deviceId } = await this.#options.deviceResolver(
        context.signal,
      );
      await this.#execute(
        {
          executable: this.#options.xcodebuildExecutable,
          args: this.#xcodebuildArgs("build"),
          cwd: this.#options.managedWorktreeRoot,
        },
        context.signal,
      );
      const settings = await this.#execute(
        {
          executable: this.#options.xcodebuildExecutable,
          args: this.#xcodebuildArgs("settings"),
          cwd: this.#options.managedWorktreeRoot,
        },
        context.signal,
      );
      const builtApplication = await resolveTrustedBuiltApplication(
        {
          managedWorktreeRoot: this.#options.managedWorktreeRoot,
          stagingRoot: this.#options.stagingRoot,
          nativeBuild: this.#options.nativeBuild,
          buildSettingsOutput: settings.stdout,
        },
        this.#options.builtApplicationResolver,
      );
      this.#preparations = Object.freeze({
        ...this.#preparations,
        [preparation.id]: Object.freeze({
          deviceId,
          builtApplication,
        }),
      });
    }
    return preparation;
  }

  async launch(
    context: CaptureAdapterContextV1,
    preparation: CapturePreparationV1,
  ): Promise<CaptureLaunchV1> {
    const prepared = this.#preparations[preparation.id];
    if (prepared === undefined) {
      throw new Error("SwiftUI application has not been built.");
    }
    const installationFingerprint = [
      prepared.builtApplication.appBundlePath,
      prepared.builtApplication.bundleId,
    ].join("\0");
    if (
      this.#installedApplications[preparation.application.id] !==
      installationFingerprint
    ) {
      await this.#execute(
        this.#simctlRecipe([
            "install",
            prepared.deviceId,
            prepared.builtApplication.appBundlePath,
          ]),
        context.signal,
      );
      this.#installedApplications = Object.freeze({
        ...this.#installedApplications,
        [preparation.application.id]: installationFingerprint,
      });
    }
    await this.#execute(
      this.#simctlRecipe([
          "launch",
          "--terminate-running-process",
          prepared.deviceId,
          prepared.builtApplication.bundleId,
        ]),
      context.signal,
    );
    const launch = Object.freeze({
      id: id(
        "launch",
        `${preparation.id}:${prepared.deviceId}:${crypto.randomUUID()}`,
      ),
      preparationId: preparation.id,
    });
    this.#launches = Object.freeze({
      ...this.#launches,
      [launch.id]: Object.freeze({
        launch,
        applicationId: preparation.application.id,
        deviceId: prepared.deviceId,
        builtApplication: prepared.builtApplication,
      }),
    });
    return launch;
  }

  async capture(
    context: CaptureAdapterContextV1,
    launch: CaptureLaunchV1,
    scenario: CaptureScenarioV2,
  ): Promise<RawCaptureV1> {
    const launchState = this.#launches[launch.id];
    if (launchState === undefined) {
      throw new Error("SwiftUI capture launch is not active.");
    }
    if (launchState.applicationId !== scenario.applicationId) {
      throw new CaptureExecutionError(
        "validate",
        "SCENARIO_APPLICATION_MISMATCH",
        false,
        "SwiftUI scenario does not belong to the launched application.",
      );
    }
    const sourceRevision = context.job.repository.sourceRevision;
    if (sourceRevision === null) {
      throw new CaptureExecutionError(
        "validate",
        "SOURCE_REVISION_MISSING",
        false,
        "Native capture requires a verified source revision.",
      );
    }
    const evidence = await this.#options.xcuiTestPort.runScenario(
      Object.freeze({
        deviceId: launchState.deviceId,
        bundleId: launchState.builtApplication.bundleId,
        launchId: launch.id,
        scenario,
      }),
      context.signal,
    );
    validateRuntimeEvidence(
      scenario,
      evidence,
      this.#options.maximumEvidenceBytes ?? 16 * 1_024 * 1_024,
    );

    const screenshotRecipe = this.#simctlRecipe([
        "io",
        launchState.deviceId,
        "screenshot",
        "--type=png",
        "-",
      ]);
    const first = await this.#execute(
      screenshotRecipe,
      context.signal,
    );
    const firstDimensions = pngDimensions(first.stdout);
    if (firstDimensions === null) {
      throw new CaptureExecutionError(
        "verify",
        "INVALID_PNG",
        true,
        "Simulator capture did not return a PNG screenshot.",
      );
    }
    const expectedWidth =
      scenario.viewport.width * scenario.viewport.scale;
    const expectedHeight =
      scenario.viewport.height * scenario.viewport.scale;
    if (
      firstDimensions.width !== expectedWidth ||
      firstDimensions.height !== expectedHeight
    ) {
      throw new CaptureExecutionError(
        "verify",
        "SCREENSHOT_DIMENSIONS_MISMATCH",
        true,
        "Simulator screenshot pixels do not match the planned viewport.",
      );
    }
    await wait(
      this.#options.stableFrameDelayMs ?? 250,
      context.signal,
    );
    const second = await this.#execute(
      screenshotRecipe,
      context.signal,
    );
    if (pngDimensions(second.stdout) === null) {
      throw new CaptureExecutionError(
        "verify",
        "INVALID_PNG",
        true,
        "Simulator capture did not return a PNG screenshot.",
      );
    }
    const stability = verifyStableFrames(first.stdout, second.stdout, {
      minimumBytes: PNG_SIGNATURE.byteLength,
    });
    if (!stability.ok) {
      throw new CaptureExecutionError(
        "verify",
        stability.code,
        true,
        stability.message,
      );
    }
    const [screenshotArtifact, hierarchyArtifact, geometryArtifact] =
      await Promise.all([
        this.#options.artifactStore.put(first.stdout, "png"),
        this.#options.artifactStore.put(evidence.hierarchy, "json"),
        this.#options.artifactStore.put(evidence.geometry, "json"),
      ]);
    const raw = Object.freeze({
      id: id("raw", `${scenario.id}:${stability.hash}`),
      scenarioId: scenario.id,
    });
    this.#captures = Object.freeze({
      ...this.#captures,
      [raw.id]: Object.freeze({
        scenario,
        screenshotArtifactId: screenshotArtifact.id,
        hierarchyArtifactId: hierarchyArtifact.id,
        geometryArtifactId: geometryArtifact.id,
        screenshotHash: screenshotArtifact.hash,
        stableHash: stability.hash,
        fixtureFingerprint: hash(
          JSON.stringify({
            fixtureProfile: scenario.fixtureProfile,
            authContext: scenario.authContext,
            parameters: scenario.parameters,
            route: evidence.route,
            state: evidence.state,
            sourceAnchor: evidence.sourceAnchor,
          }),
        ),
        sourceRevision,
      }),
    });
    return raw;
  }

  async collect(
    _context: CaptureAdapterContextV1,
    _launch: CaptureLaunchV1,
    capture: RawCaptureV1,
  ): Promise<CaptureArtifactV2> {
    const state = this.#captures[capture.id];
    if (state === undefined) {
      throw new Error("SwiftUI capture evidence was not found.");
    }
    return CaptureArtifactSchemaV2.parse({
      id: artifactId(`${capture.id}:swiftui`),
      scenarioId: state.scenario.id,
      screenshotArtifactId: state.screenshotArtifactId,
      hierarchyArtifactId: state.hierarchyArtifactId,
      geometryArtifactId: state.geometryArtifactId,
      screenshotHash: state.screenshotHash,
      sourceRevision: state.sourceRevision,
      fixtureFingerprint: state.fixtureFingerprint,
      dimensions: {
        width:
          state.scenario.viewport.width *
          state.scenario.viewport.scale,
        height:
          state.scenario.viewport.height *
          state.scenario.viewport.scale,
        scale: state.scenario.viewport.scale,
      },
      verification: {
        stableFrameHash: state.stableHash,
        routeMatched: true,
        blankRejected: true,
        splashRejected: true,
        errorBoundaryRejected: true,
        verifiedAt: (this.#options.now ?? (() => new Date()))().toISOString(),
      },
    });
  }

  async cleanup(
    _context: CaptureAdapterContextV1,
    launch: CaptureLaunchV1 | null,
  ): Promise<void> {
    if (launch === null) {
      return;
    }
    if (this.#launches[launch.id] !== undefined) {
      const launchState = this.#launches[launch.id]!;
      const cleanupSignal = new AbortController().signal;
      await this.#execute(
        this.#simctlRecipe([
            "terminate",
            launchState.deviceId,
            launchState.builtApplication.bundleId,
          ]),
        cleanupSignal,
      );
    }
    this.#launches = Object.freeze(
      Object.fromEntries(
        Object.entries(this.#launches).filter(
          ([launchId]) => launchId !== launch.id,
        ),
      ),
    );
  }
}
