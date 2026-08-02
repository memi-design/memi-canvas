import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
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
  RuntimeCaptureScreenV1Schema,
  type CaptureArtifactV2,
  type CaptureScenarioV2,
  type ImportApplicationV2,
} from "@memi/protocol";

import { ContentAddressedArtifactStore } from "./artifact-store.js";
import { CaptureExecutionError } from "./executor.js";
import {
  createExpoStandaloneDeepLink,
  materializeExpoRoute,
} from "./expo-route-navigation.js";
import {
  type ExpoRuntimeEvidenceV1,
  verifyExpoRuntimeEvidence,
} from "./expo-runtime-evidence.js";
import {
  type PreparedExpoRuntimeInstrumentation,
  prepareExpoRuntimeInstrumentation,
  restoreExpoRuntimeInstrumentation,
} from "./expo-runtime-instrumentation.js";
import {
  type ProcessExecutionPolicy,
  type ProcessRecipe,
  sandboxProcessRecipe,
} from "./process-policy.js";
import { verifyStableFrames } from "./stability.js";
import {
  type NativeBuildConfiguration,
  type ResolvedBuiltApplication,
  type ResolveBuiltApplication,
  resolveTrustedBuiltApplication,
} from "./native-app-bundle.js";
import {
  assertNativeDependencyPreparationApproval,
  type NativeDependencyPreparationApproval,
  type NativeDependencyPreparationPlan,
} from "./native-dependency-preparation.js";

export type {
  NativeBuildConfiguration,
  ResolvedBuiltApplication,
  ResolveBuiltApplication,
  ResolveBuiltApplicationInput,
} from "./native-app-bundle.js";
export {
  resolveBuiltApplication,
  resolveTrustedBuiltApplication,
} from "./native-app-bundle.js";

export interface NativeCommandResult {
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

export interface NativeCommandPort {
  execute(
    recipe: ProcessRecipe,
    signal: AbortSignal,
  ): Promise<NativeCommandResult>;
}

/**
 * An exact-recipe native build port. macOS Xcode's build service requires a
 * file-event connection that sandbox-exec denies even with the documented
 * FSEvents Mach services. Callers still validate the executable, arguments,
 * working directory, environment, output cap, and process group before using
 * this narrowly scoped escape hatch.
 */
export interface DirectNativeBuildCommandPort {
  execute(
    recipe: ProcessRecipe,
    policy: ProcessExecutionPolicy,
    signal: AbortSignal,
  ): Promise<NativeCommandResult>;
}

export interface NativeDeviceResolver {
  (signal: AbortSignal): Promise<Readonly<{ deviceId: string }>>;
}

export const EXPO_MAESTRO_CAPTURE_ADAPTER_VERSION = "1.0.0";

export interface ExpoNativeDependencyPreparation {
  readonly approval: NativeDependencyPreparationApproval;
  readonly currentPlan: () => Promise<NativeDependencyPreparationPlan>;
  readonly execute: (
    plan: NativeDependencyPreparationPlan,
    signal: AbortSignal,
  ) => Promise<void>;
}

/**
 * Prepares a verified native build input after Xcode has resolved its build
 * settings and before the actual build starts. The hook has no authority to
 * execute commands or mutate source outside the managed worktree.
 */
export interface ExpoNativeBuildPreparer {
  prepare(input: Readonly<{
    nativeBuild: NativeBuildConfiguration;
    buildSettingsOutput: Uint8Array;
    sourceRevision: string | null;
    nativeDependencyPreparationPlan: NativeDependencyPreparationPlan | null;
    signal: AbortSignal;
  }>): Promise<void>;
}

/** A discovered flow whose immutable source digest is verified immediately before use. */
export interface AttestedMaestroFlow {
  readonly relativePath: string;
  readonly contentHash: `sha256:${string}`;
}

export interface ExpoMaestroCaptureAdapterOptions {
  readonly applications: readonly ImportApplicationV2[];
  readonly managedWorktreeRoot: string;
  readonly stagingRoot: string;
  readonly runtime: "standalone" | "expo-go";
  readonly scheme: string | null;
  readonly nativeBuild: NativeBuildConfiguration | null;
  readonly deviceResolver: NativeDeviceResolver;
  readonly xcodebuildExecutable: string;
  /** @deprecated Legacy test mode. Production uses direct simctl. */
  readonly xcrunExecutable?: string;
  readonly simctlExecutable?: string;
  readonly simulatorDeviceSetPath?: string;
  readonly maestroExecutable: string;
  readonly artifactStore: ContentAddressedArtifactStore;
  readonly commandPort: NativeCommandPort;
  readonly directNativeBuildCommandPort?: DirectNativeBuildCommandPort;
  readonly processPolicy: ProcessExecutionPolicy;
  /**
   * Xcode's build service is the only direct-native command. Keep its host
   * session requirements separate from the sandboxed Maestro policy so a
   * capture flow never inherits broader filesystem authority.
   */
  readonly nativeBuildProcessPolicy?: ProcessExecutionPolicy;
  readonly nativeDependencyPreparation?: ExpoNativeDependencyPreparation;
  readonly nativeBuildPreparer?: ExpoNativeBuildPreparer;
  readonly simulatorProcessPolicy?: ProcessExecutionPolicy;
  readonly managedRuntimeInstrumentation?: boolean;
  readonly flowByRoute: Readonly<Record<string, AttestedMaestroFlow>>;
  readonly builtApplicationResolver?: ResolveBuiltApplication;
  readonly now?: () => Date;
  readonly stableFrameDelayMs?: number;
  /**
   * The direct Xcode service can deadlock independently of the import
   * coordinator. Bound that one process so a single stalled native build
   * becomes a retryable diagnostic instead of an unbounded import job.
   */
  readonly nativeBuildTimeoutMs?: number;
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
  readonly screenshotHash: `sha256:${string}`;
  readonly stableHash: `sha256:${string}`;
  readonly fixtureFingerprint: `sha256:${string}`;
  readonly sourceRevision: string;
  readonly evidence: ExpoRuntimeEvidenceV1;
}
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
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}
function artifactId(value: string): `art_${string}` {
  return `art_${createHash("sha256").update(value).digest("hex").slice(0, 26).toUpperCase()}`;
}

const SAFE_MAESTRO_FLOW_COMMANDS = new Set([
  "assertNotVisible",
  "assertVisible",
  "back",
  "clearState",
  "eraseText",
  "extendedWaitUntil",
  "hideKeyboard",
  "inputText",
  "launchApp",
  "openLink",
  "pressKey",
  "scroll",
  "scrollUntilVisible",
  "swipe",
  "tapOn",
  "waitForAnimationToEnd",
]);

function safeMaestroFlow(content: string): boolean {
  const commands = content
    .split(/^---\s*$/mu)
    .slice(1)
    .flatMap((document) =>
      [
        ...document.matchAll(/^\s*-\s+([A-Za-z][A-Za-z0-9]*)(?:\s*:|\s*$)/gmu),
      ].map((match) => match[1]!),
    );
  return (
    commands.length > 0 &&
    commands.every((command) => SAFE_MAESTRO_FLOW_COMMANDS.has(command))
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

const DEFAULT_NATIVE_BUILD_TIMEOUT_MS = 5 * 60 * 1_000;

function validNativeBuildTimeout(milliseconds: number): boolean {
  return (
    Number.isSafeInteger(milliseconds) &&
    milliseconds > 0 &&
    milliseconds <= 30 * 60 * 1_000
  );
}

export class ExpoMaestroCaptureAdapter implements CaptureAdapterV1 {
  readonly metadata: CaptureAdapterMetadataV1 = parseCaptureAdapterMetadataV1({
    id: "maestro-expo-ios",
    platform: "expo-ios",
    version: EXPO_MAESTRO_CAPTURE_ADAPTER_VERSION,
    capabilities: [
      "discover",
      "prepare",
      "launch",
      "capture",
      "collect",
      "cleanup",
    ],
  });

  readonly #options: ExpoMaestroCaptureAdapterOptions;
  #installedApplications: Readonly<Record<string, string>> = Object.freeze({});
  #preparations: Readonly<Record<string, NativePreparationState>> =
    Object.freeze({});
  #launches: Readonly<Record<string, NativeLaunchState>> = Object.freeze({});
  #captures: Readonly<Record<string, NativeCaptureState>> = Object.freeze({});
  #runtimeInstrumentation: PreparedExpoRuntimeInstrumentation | null = null;

  constructor(options: ExpoMaestroCaptureAdapterOptions) {
    if (options.runtime === "expo-go") {
      throw new CaptureExecutionError(
        "validate",
        "EXPO_GO_UNSUPPORTED",
        false,
        "Expo Go capture is unsupported until a managed Metro lease and project-URL readiness authority are provided.",
      );
    }
    if (options.nativeBuild === null) {
      throw new Error(
        "Standalone Expo capture requires native build configuration.",
      );
    }
    if (
      !isAbsolute(options.managedWorktreeRoot) ||
      !isAbsolute(options.nativeBuild.container.path) ||
      !contained(
        options.managedWorktreeRoot,
        options.nativeBuild.container.path,
      ) ||
      !isAbsolute(options.nativeBuild.derivedDataPath) ||
      !contained(
        options.managedWorktreeRoot,
        options.nativeBuild.derivedDataPath,
      )
    ) {
      throw new Error(
        "Expo capture app bundle must be inside the managed worktree.",
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
      options.applications.some(
        (application) => application.platform !== "expo-ios",
      )
    ) {
      throw new Error("Expo adapter only accepts expo-ios applications.");
    }
    if (
      (options.simctlExecutable === undefined) ===
        (options.xcrunExecutable === undefined) ||
      (options.simctlExecutable !== undefined &&
        (options.simulatorDeviceSetPath === undefined ||
          !isAbsolute(options.simulatorDeviceSetPath)))
    ) {
      throw new Error(
        "Expo capture requires one simulator executable and a device set for direct simctl.",
      );
    }
    const nativeBuildTimeoutMs =
      options.nativeBuildTimeoutMs ?? DEFAULT_NATIVE_BUILD_TIMEOUT_MS;
    if (!validNativeBuildTimeout(nativeBuildTimeoutMs)) {
      throw new Error("Native build timeout must be a bounded positive integer.");
    }
    this.#options = Object.freeze({
      ...options,
      nativeBuildTimeoutMs,
      applications: Object.freeze([...options.applications]),
      nativeBuild: Object.freeze({
        ...options.nativeBuild,
        container: Object.freeze({ ...options.nativeBuild.container }),
      }),
      flowByRoute: Object.freeze(
        Object.fromEntries(
          Object.entries(options.flowByRoute).map(([route, flow]) => [
            route,
            Object.freeze({ ...flow }),
          ]),
        ),
      ),
    });
  }

  async #executeAttestedFlow(input: {
    readonly flow: AttestedMaestroFlow;
    readonly deviceId: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const flowPath = resolve(
      this.#options.managedWorktreeRoot,
      input.flow.relativePath,
    );
    if (!contained(this.#options.managedWorktreeRoot, flowPath)) {
      throw new CaptureExecutionError(
        "capture",
        "FLOW_PATH_ESCAPE",
        false,
        "Maestro flow is outside the managed worktree.",
      );
    }
    let metadata;
    try {
      metadata = await lstat(flowPath);
    } catch (error) {
      throw new CaptureExecutionError(
        "capture",
        "FLOW_ATTESTATION_MISSING",
        false,
        error instanceof Error ? error.message : "Maestro flow is missing.",
      );
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new CaptureExecutionError(
        "capture",
        "FLOW_PATH_UNTRUSTED",
        false,
        "Maestro flow must be a regular managed-worktree file.",
      );
    }
    const content = await readFile(flowPath);
    if (hash(content) !== input.flow.contentHash) {
      throw new CaptureExecutionError(
        "capture",
        "FLOW_ATTESTATION_MISMATCH",
        false,
        "Maestro flow changed after import planning and was not executed.",
      );
    }
    if (!safeMaestroFlow(content.toString("utf8"))) {
      throw new CaptureExecutionError(
        "capture",
        "FLOW_COMMAND_UNSAFE",
        false,
        "Maestro flow contains a command outside Memi's managed capture allowlist.",
      );
    }
    await this.#execute(
      {
        executable: this.#options.maestroExecutable,
        args: [`--udid=${input.deviceId}`, "test", input.flow.relativePath],
        cwd: this.#options.managedWorktreeRoot,
      },
      input.signal,
    );
  }

  #nativeBuild(): NativeBuildConfiguration {
    const nativeBuild = this.#options.nativeBuild;
    if (nativeBuild === null) {
      throw new Error("Standalone Expo capture has no native build.");
    }
    return nativeBuild;
  }

  #xcodebuildArgs(
    nativeBuild: NativeBuildConfiguration,
    action: "build" | "settings",
  ): readonly string[] {
    const common = [
      nativeBuild.container.kind === "project" ? "-project" : "-workspace",
      nativeBuild.container.path,
      "-scheme",
      nativeBuild.scheme,
      "-configuration",
      nativeBuild.configuration,
      "-sdk",
      "iphonesimulator",
      // Native capture prioritizes a reproducible, bounded build over
      // compile throughput. Applying the limit to the settings resolution
      // too keeps its approved recipe identical to the real build path.
      "-jobs",
      "1",
    ];
    return Object.freeze(
      action === "build"
        ? [
            ...common,
            "-destination",
            "generic/platform=iOS Simulator",
            "-derivedDataPath",
            nativeBuild.derivedDataPath,
            "ENABLE_USER_SCRIPT_SANDBOXING=NO",
            `ARCHS=${nativeBuild.simulatorArchitecture ?? "arm64"}`,
            "build",
          ]
        : [
            ...common,
            "-destination",
            "generic/platform=iOS Simulator",
            "-derivedDataPath",
            nativeBuild.derivedDataPath,
            "ENABLE_USER_SCRIPT_SANDBOXING=NO",
            `ARCHS=${nativeBuild.simulatorArchitecture ?? "arm64"}`,
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
    const isNativeBuild = recipe.executable === this.#options.xcodebuildExecutable;
    const policy = recipe.executable === this.#options.simctlExecutable
      ? this.#options.simulatorProcessPolicy!
      : isNativeBuild && this.#options.directNativeBuildCommandPort !== undefined
        ? (this.#options.nativeBuildProcessPolicy ?? this.#options.processPolicy)
        : this.#options.processPolicy;
    if (
      isNativeBuild &&
      this.#options.directNativeBuildCommandPort !== undefined
    ) {
      return this.#options.directNativeBuildCommandPort.execute(
        recipe,
        policy,
        signal,
      );
    }
    const sandboxed = sandboxProcessRecipe(recipe, policy);
    return this.#options.commandPort.execute(sandboxed, signal);
  }

  async #executeNativeBuild(
    recipe: ProcessRecipe,
    signal: AbortSignal,
  ): Promise<NativeCommandResult> {
    const timeoutMs =
      this.#options.nativeBuildTimeoutMs ?? DEFAULT_NATIVE_BUILD_TIMEOUT_MS;
    const controller = new AbortController();
    const abortForCaller = (): void => controller.abort();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    signal.addEventListener("abort", abortForCaller, { once: true });
    if (signal.aborted) {
      abortForCaller();
    }
    try {
      return await this.#execute(recipe, controller.signal);
    } catch (error) {
      if (timedOut) {
        const seconds = Math.ceil(timeoutMs / 1_000);
        throw new CaptureExecutionError(
          "build",
          "NATIVE_BUILD_STALLED",
          true,
          `Xcode did not complete the managed build within ${seconds}s. Quit Xcode and Simulator, wait for the build service to clear, then retry this import.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortForCaller);
    }
  }

  #simctlRecipe(args: readonly string[]): ProcessRecipe {
    if (this.#options.simctlExecutable !== undefined) {
      return {
        executable: this.#options.simctlExecutable,
        args: ["--set", this.#options.simulatorDeviceSetPath!, ...args],
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
    _scenarios: readonly CaptureScenarioV2[] = [],
  ): Promise<CapturePreparationV1> {
    if (context.signal.aborted) {
      throw new Error("Capture was cancelled.");
    }
    if (
      !this.#options.applications.some(
        (candidate) => candidate.id === application.id,
      )
    ) {
      throw new Error("Expo application was not discovered.");
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
      let nativeDependencyPreparationPlan: NativeDependencyPreparationPlan | null = null;
      if (this.#options.nativeDependencyPreparation !== undefined) {
        const currentPlan =
          await this.#options.nativeDependencyPreparation.currentPlan();
        assertNativeDependencyPreparationApproval(
          currentPlan,
          this.#options.nativeDependencyPreparation.approval,
        );
        await this.#options.nativeDependencyPreparation.execute(
          currentPlan,
          context.signal,
        );
        nativeDependencyPreparationPlan = currentPlan;
      }
      const sourceRevision = context.job.repository.sourceRevision;
      if (
        this.#options.managedRuntimeInstrumentation === true &&
        sourceRevision === null
      ) {
        throw new CaptureExecutionError(
          "validate",
          "SOURCE_REVISION_MISSING",
          false,
          "Managed Expo instrumentation requires a verified source revision.",
        );
      }
      if (
        this.#options.managedRuntimeInstrumentation === true &&
        this.#runtimeInstrumentation === null
      ) {
        this.#runtimeInstrumentation = await prepareExpoRuntimeInstrumentation({
          managedWorktreeRoot: this.#options.managedWorktreeRoot,
          sourceRevision: sourceRevision!,
        });
      }
      const nativeBuild = this.#nativeBuild();
      const { deviceId } = await this.#options.deviceResolver(context.signal);
      const settings = await this.#execute(
        {
          executable: this.#options.xcodebuildExecutable,
          args: this.#xcodebuildArgs(nativeBuild, "settings"),
          cwd: this.#options.managedWorktreeRoot,
        },
        context.signal,
      );
      if (this.#options.nativeBuildPreparer !== undefined) {
        await this.#options.nativeBuildPreparer.prepare(Object.freeze({
          nativeBuild,
          buildSettingsOutput: settings.stdout,
          sourceRevision: context.job.repository.sourceRevision,
          nativeDependencyPreparationPlan,
          signal: context.signal,
        }));
      }
      await this.#executeNativeBuild(
        {
          executable: this.#options.xcodebuildExecutable,
          args: this.#xcodebuildArgs(nativeBuild, "build"),
          cwd: this.#options.managedWorktreeRoot,
        },
        context.signal,
      );
      const builtApplication = await resolveTrustedBuiltApplication(
        {
          managedWorktreeRoot: this.#options.managedWorktreeRoot,
          stagingRoot: this.#options.stagingRoot,
          nativeBuild,
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
      throw new Error("Expo application has not been built.");
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
    const launch = Object.freeze({
      id: id("launch", `${preparation.id}:${prepared.deviceId}`),
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

  async #waitForRuntimeEvidence(input: {
    readonly context: CaptureAdapterContextV1;
    readonly deviceId: string;
    readonly scenario: CaptureScenarioV2;
    readonly expectedRoute: string;
    readonly expectedNonce: string;
    readonly sourceRevision: string;
  }): Promise<ExpoRuntimeEvidenceV1> {
    let lastFailure: CaptureExecutionError | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const result = await this.#execute(
        this.#simctlRecipe(["pbpaste", input.deviceId]),
        input.context.signal,
      );
      try {
        return verifyExpoRuntimeEvidence({
          scenario: input.scenario,
          bytes: result.stdout,
          expectedRoute: input.expectedRoute,
          expectedNonce: input.expectedNonce,
          expectedSourceRevision: input.sourceRevision,
        });
      } catch (error) {
        if (!(error instanceof CaptureExecutionError)) {
          throw error;
        }
        lastFailure = error;
      }
      await wait(100, input.context.signal);
    }
    throw (
      lastFailure ??
      new CaptureExecutionError(
        "verify",
        "RUNTIME_EVIDENCE_MISSING",
        true,
        "Expo runtime did not provide route-state attestation in time.",
      )
    );
  }

  async capture(
    context: CaptureAdapterContextV1,
    launch: CaptureLaunchV1,
    scenario: CaptureScenarioV2,
  ): Promise<RawCaptureV1> {
    const launchState = this.#launches[launch.id];
    if (!launchState) {
      throw new Error("Expo capture launch is not active.");
    }
    if (launchState.applicationId !== scenario.applicationId) {
      throw new CaptureExecutionError(
        "validate",
        "SCENARIO_APPLICATION_MISMATCH",
        false,
        "Expo scenario does not belong to the launched application.",
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
    const managedAttestation =
      this.#options.managedRuntimeInstrumentation === true;
    const attestationNonce = managedAttestation
      ? createHash("sha256")
          .update(`${context.job.id}\0${scenario.id}`)
          .digest("hex")
          .slice(0, 26)
          .toUpperCase()
      : undefined;
    const flow = this.#options.flowByRoute[scenario.route];
    let expectedRoute = scenario.route;
    if (flow !== undefined && !managedAttestation) {
      await this.#executeAttestedFlow({
        flow,
        deviceId: launchState.deviceId,
        signal: context.signal,
      });
      try {
        expectedRoute = materializeExpoRoute(
          scenario.route,
          scenario.parameters,
        );
      } catch (error) {
        throw new CaptureExecutionError(
          "capture",
          "DEEP_LINK_INVALID",
          false,
          error instanceof Error
            ? error.message
            : "Expo route evidence could not be materialized.",
        );
      }
    } else if (scenario.route !== "/" || managedAttestation) {
      if (this.#options.scheme === null) {
        throw new CaptureExecutionError(
          "capture",
          "EXPO_SCHEME_REQUIRED",
          false,
          "Non-root Expo routes require a validated custom URL scheme.",
        );
      }
      let navigation;
      try {
        navigation = createExpoStandaloneDeepLink({
          scheme: this.#options.scheme,
          route: scenario.route,
          parameters: scenario.parameters,
          ...(attestationNonce === undefined
            ? {}
            : {
                attestation: {
                  nonce: attestationNonce,
                  state: scenario.state,
                },
              }),
        });
      } catch (error) {
        throw new CaptureExecutionError(
          "capture",
          "DEEP_LINK_INVALID",
          false,
          error instanceof Error
            ? error.message
            : "Expo route evidence could not be materialized.",
        );
      }
      expectedRoute = navigation.concreteRoute;
      await this.#execute(
        this.#simctlRecipe(["openurl", launchState.deviceId, navigation.url]),
        context.signal,
      );
      if (attestationNonce !== undefined) {
        await this.#waitForRuntimeEvidence({
          context,
          deviceId: launchState.deviceId,
          scenario,
          expectedRoute,
          expectedNonce: attestationNonce,
          sourceRevision,
        });
      }
    } else {
      await this.#execute(
        this.#simctlRecipe([
          "launch",
          "--terminate-running-process",
          launchState.deviceId,
          launchState.builtApplication.bundleId,
        ]),
        context.signal,
      );
    }
    if (flow !== undefined && managedAttestation) {
      await this.#executeAttestedFlow({
        flow,
        deviceId: launchState.deviceId,
        signal: context.signal,
      });
      await this.#waitForRuntimeEvidence({
        context,
        deviceId: launchState.deviceId,
        scenario,
        expectedRoute,
        expectedNonce: attestationNonce!,
        sourceRevision,
      });
    }
    const screenshotRecipe = this.#simctlRecipe([
      "io",
      launchState.deviceId,
      "screenshot",
      "--type=png",
      "-",
    ]);
    const first = await this.#execute(screenshotRecipe, context.signal);
    await wait(this.#options.stableFrameDelayMs ?? 250, context.signal);
    const second = await this.#execute(screenshotRecipe, context.signal);
    const stability = verifyStableFrames(first.stdout, second.stdout);
    if (!stability.ok) {
      throw new CaptureExecutionError(
        "verify",
        stability.code,
        true,
        stability.message,
      );
    }
    const hierarchy = await this.#execute(
      {
        executable: this.#options.maestroExecutable,
        args: [`--udid=${launchState.deviceId}`, "hierarchy", "--compact"],
        cwd: this.#options.managedWorktreeRoot,
      },
      context.signal,
    );
    if (hierarchy.stdout.byteLength === 0) {
      throw new CaptureExecutionError(
        "extract-layers",
        "HIERARCHY_EMPTY",
        true,
        "Maestro returned an empty native hierarchy.",
      );
    }
    const evidence =
      attestationNonce === undefined
        ? verifyExpoRuntimeEvidence({
            scenario,
            bytes: hierarchy.stdout,
            expectedRoute,
          })
        : await this.#waitForRuntimeEvidence({
            context,
            deviceId: launchState.deviceId,
            scenario,
            expectedRoute,
            expectedNonce: attestationNonce,
            sourceRevision,
          });
    const [screenshotArtifact, hierarchyArtifact] = await Promise.all([
      this.#options.artifactStore.put(first.stdout, "png"),
      this.#options.artifactStore.put(hierarchy.stdout, "csv"),
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
        screenshotHash: screenshotArtifact.hash,
        stableHash: stability.hash,
        fixtureFingerprint: hash(
          JSON.stringify({
            fixtureProfile: scenario.fixtureProfile,
            authContext: scenario.authContext,
            parameters: scenario.parameters,
            flow: flow?.relativePath ?? null,
          }),
        ),
        sourceRevision,
        evidence,
      }),
    });
    return raw;
  }

  async collect(
    context: CaptureAdapterContextV1,
    _launch: CaptureLaunchV1,
    capture: RawCaptureV1,
  ): Promise<CaptureArtifactV2> {
    const state = this.#captures[capture.id];
    if (!state) {
      throw new Error("Native capture evidence was not found.");
    }
    let reconstructionArtifactId: `art_${string}` | null = null;
    if (state.evidence.semanticCapture !== undefined) {
      const sourceAnchor = state.scenario.sourceAnchor;
      if (sourceAnchor === null) {
        throw new CaptureExecutionError(
          "extract-layers",
          "SEMANTIC_RECONSTRUCTION_SOURCE_ANCHOR_MISSING",
          true,
          "Semantic reconstruction requires a verified scenario source anchor.",
        );
      }
      const application = this.#options.applications.find(
        ({ id: applicationId }) =>
          applicationId === state.scenario.applicationId,
      );
      if (application === undefined) {
        throw new Error("Captured application authority was not found.");
      }
      const sourceAnchorText = `${sourceAnchor.relativePath}${
        sourceAnchor.symbol === null ? "" : `#${sourceAnchor.symbol}`
      }`;
      const captureId = id(
        "capture",
        `${state.scenario.id}:${state.screenshotHash}`,
      );
      const manifest = RuntimeCaptureScreenV1Schema.parse({
        app: {
          appVersion: state.evidence.semanticCapture.appVersion,
          buildRevision: state.sourceRevision,
          environment: "simulator",
          productId: application.id,
        },
        artifact: {
          alt: `${application.label} ${state.scenario.state}`,
          artifactId: state.screenshotArtifactId,
          hash: state.screenshotHash,
          height:
            state.scenario.viewport.height * state.scenario.viewport.scale,
          kind: "image/png",
          src: `memi-artifact://localhost/${state.screenshotArtifactId}`,
          sourceUrl: `memi-source://repository/${sourceAnchor.relativePath}`,
          width: state.scenario.viewport.width * state.scenario.viewport.scale,
        },
        authority: "local_capture",
        binding: {
          coverageCellId: state.scenario.id,
          normalizedPath: state.scenario.route,
          routeId: `${application.id}:${state.scenario.route}`,
          sourceAnchor: sourceAnchorText,
          sourceContentHash: sourceAnchor.contentHash,
          stateId: state.scenario.state,
          viewport: {
            height: state.scenario.viewport.height,
            name: "mobile",
            scale: state.scenario.viewport.scale,
            width: state.scenario.viewport.width,
          },
        },
        captureId,
        capturedAt: (this.#options.now ?? (() => new Date()))().toISOString(),
        evidence: {
          accessibilitySnapshotRef: `memi-artifact://localhost/${state.hierarchyArtifactId}`,
          captureMethod: "ios-simulator-screenshot",
          componentIds: state.evidence.semanticCapture.layers
            .map(({ source }) => source.componentId)
            .filter(
              (componentId): componentId is string => componentId != null,
            ),
          label: "Local capture",
          sourceAnchors: state.evidence.semanticCapture.layers.map(
            ({ source }) => source.sourceAnchor,
          ),
          truthLabel: "Local capture",
          verifier: "automated",
        },
        layers: state.evidence.semanticCapture.layers,
        repository: {
          dirty: false,
          dirtyFileFingerprint: context.job.repository.dirtyFingerprint,
          revision: state.sourceRevision,
          rootPath: context.job.repository.rootPath,
          sourceFingerprint: hash(state.sourceRevision),
        },
        schemaVersion: 1,
        screenId: `${application.id}:${state.scenario.route}:${state.scenario.state}`,
        screenName: `${application.label} · ${state.scenario.state}`,
      });
      const reconstruction = await this.#options.artifactStore.put(
        new TextEncoder().encode(JSON.stringify(manifest)),
        "json",
      );
      reconstructionArtifactId = reconstruction.id;
    } else if (this.#options.managedRuntimeInstrumentation === true) {
      throw new CaptureExecutionError(
        "extract-layers",
        "SEMANTIC_RECONSTRUCTION_EVIDENCE_MISSING",
        true,
        "Expo runtime capture succeeded, but semantic layer instrumentation produced no evidence.",
      );
    }
    return CaptureArtifactSchemaV2.parse({
      id: artifactId(`${capture.id}:native`),
      scenarioId: state.scenario.id,
      screenshotArtifactId: state.screenshotArtifactId,
      hierarchyArtifactId: state.hierarchyArtifactId,
      geometryArtifactId: null,
      reconstructionArtifactId,
      screenshotHash: state.screenshotHash,
      sourceRevision: state.sourceRevision,
      fixtureFingerprint: state.fixtureFingerprint,
      dimensions: {
        width: state.scenario.viewport.width * state.scenario.viewport.scale,
        height: state.scenario.viewport.height * state.scenario.viewport.scale,
        scale: state.scenario.viewport.scale,
      },
      verification: {
        stableFrameHash: state.stableHash,
        routeMatched: true,
        blankRejected: state.evidence.blank === false,
        splashRejected: state.evidence.splash === false,
        errorBoundaryRejected: state.evidence.errorBoundary === false,
        verifiedAt: (this.#options.now ?? (() => new Date()))().toISOString(),
      },
    });
  }

  async cleanup(
    _context: CaptureAdapterContextV1,
    launch: CaptureLaunchV1 | null,
  ): Promise<void> {
    const launchState = launch === null ? undefined : this.#launches[launch.id];
    if (launchState !== undefined) {
      await this.#execute(
        this.#simctlRecipe([
          "terminate",
          launchState.deviceId,
          launchState.builtApplication.bundleId,
        ]),
        new AbortController().signal,
      );
    }
    this.#launches = Object.freeze(
      Object.fromEntries(
        Object.entries(this.#launches).filter(
          ([launchId]) => launchId !== launch?.id,
        ),
      ),
    );
    if (this.#runtimeInstrumentation !== null) {
      await restoreExpoRuntimeInstrumentation(this.#runtimeInstrumentation);
      this.#runtimeInstrumentation = null;
    }
  }
}
