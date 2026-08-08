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
  RuntimeCaptureScreenV1Schema,
  type CaptureArtifactV2,
  type CaptureScenarioV2,
  type ImportApplicationV2,
} from "@memi/protocol";

import {
  ContentAddressedArtifactStore,
  type StoredArtifact,
} from "./artifact-store.js";
import type {
  ExpoNativeDependencyPreparation,
  NativeCommandPort,
  NativeCommandResult,
} from "./expo-maestro-adapter.js";
import { assertNativeDependencyPreparationApproval } from "./native-dependency-preparation.js";
import { CaptureExecutionError } from "./executor.js";
import {
  verifyExpoRuntimeEvidence,
  type ExpoRuntimeEvidenceV1,
} from "./expo-runtime-evidence.js";
import {
  prepareManagedDependencyBridge,
  restoreManagedDependencyBridge,
  type PreparedManagedDependencyBridge,
} from "./managed-dependency-bridge.js";
import {
  prepareExpoRuntimeInstrumentation,
  restoreExpoRuntimeInstrumentation,
  type PreparedExpoRuntimeInstrumentation,
} from "./expo-runtime-instrumentation.js";
import { createExpoStandaloneDeepLink } from "./expo-route-navigation.js";
import {
  type ProcessExecutionPolicy,
  type ProcessRecipe,
  sandboxProcessRecipe,
} from "./process-policy.js";
import type { PortLease, ProcessStarter } from "./react-web-adapter.js";
import { verifyStableFrames } from "./stability.js";

export interface ExpoGoMetroAuthority {
  readonly executable: string;
  readonly args: readonly ["expo", "start", "--go", "--localhost"];
  readonly appId: "host.exp.Exponent";
  readonly routeAuthority: "expo-go-project-url";
}

/**
 * A declared development client is a different authority from Expo Go: its
 * JavaScript bundle comes from managed Metro, while its installed native shell
 * is selected by the caller and recorded by the surrounding capture runtime.
 */
export interface ExpoDevelopmentClientMetroAuthority {
  readonly executable: string;
  readonly args: readonly ["expo", "start", "--dev-client", "--localhost"];
  readonly appId: string;
  readonly routeAuthority: "expo-development-client-url";
  /** Generated Expo launcher scheme, for example `exp+buzzr`. */
  readonly scheme: string;
  /** Product deep-link scheme used to navigate the installed app. */
  readonly routeScheme: string;
}

export type ExpoMetroAuthority =
  | ExpoGoMetroAuthority
  | ExpoDevelopmentClientMetroAuthority;

/** A verified local Expo CLI avoids npm/npx resolver side effects at launch. */
export interface LocalDevelopmentMetroLaunch {
  readonly executable: string;
  readonly cliPath: string;
  /** Read-only package tree used to resolve the trusted local Expo CLI. */
  readonly dependencyRoot: string;
  /** Narrow resolver bridge for a managed source snapshot without node_modules. */
  readonly environment: Readonly<{ readonly NODE_PATH: string }>;
}

export interface ExpoGoCaptureAdapterOptions {
  readonly applications: readonly ImportApplicationV2[];
  readonly managedWorktreeRoot: string;
  readonly projectRoot: string;
  readonly metro: ExpoMetroAuthority;
  /** Available only for a declared development client in a managed worktree. */
  readonly localDevelopmentMetroLaunch?: LocalDevelopmentMetroLaunch;
  readonly deviceResolver: (
    signal: AbortSignal,
  ) => Promise<Readonly<{ deviceId: string }>>;
  readonly releaseDevice?: (signal: AbortSignal) => Promise<void>;
  /** @deprecated Legacy test mode. Production uses direct simctl. */
  readonly xcrunExecutable?: string;
  readonly simctlExecutable?: string;
  readonly simulatorDeviceSetPath?: string;
  /** A declared development client lives on an already booted simulator. */
  readonly directSimulator?: true;
  readonly maestroExecutable: string;
  readonly artifactStore: ContentAddressedArtifactStore;
  readonly commandPort: NativeCommandPort;
  readonly processStarter: ProcessStarter;
  readonly processPolicy: ProcessExecutionPolicy;
  readonly simulatorProcessPolicy?: ProcessExecutionPolicy;
  /**
   * `simctl io screenshot` writes a file on current Xcode releases; it does
   * not reliably stream PNG bytes to stdout. The native adapter supplies this
   * bounded, Memi-owned evidence reader for real simulator capture.
   */
  readonly captureSimulatorScreenshot?: (
    input: Readonly<{ readonly deviceId: string }>,
    signal: AbortSignal,
  ) => Promise<Uint8Array>;
  /**
   * Retrieves the signed runtime attestation written by managed Expo
   * instrumentation. Hierarchy remains a separate accessibility artifact.
   */
  readonly readSimulatorRuntimeEvidence?: (
    input: Readonly<{ readonly deviceId: string }>,
    signal: AbortSignal,
  ) => Promise<Uint8Array>;
  /**
   * Freezes supported simulator accessibility motion for this managed capture
   * session and returns the exact restoration action. It never touches source.
   */
  readonly freezeSimulatorAnimations?: (
    input: Readonly<{ readonly deviceId: string }>,
    signal: AbortSignal,
  ) => Promise<(signal: AbortSignal) => Promise<void>>;
  /**
   * CoreSimulator's host service rejects sandbox-exec clients. This port is
   * limited to separately validated device recipes for an already installed
   * development client: simctl and Maestro hierarchy extraction. All other
   * capture processes stay sandboxed.
   */
  readonly directSimulatorCommandPort?: Readonly<{
    execute(
      recipe: ProcessRecipe,
      policy: ProcessExecutionPolicy,
      signal: AbortSignal,
    ): Promise<NativeCommandResult>;
  }>;
  readonly portLease: PortLease;
  readonly waitForMetro: (
    statusUrl: string,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly flowByRoute?: Readonly<Record<string, string>>;
  readonly nativeDependencyPreparation?: ExpoNativeDependencyPreparation;
  /** Applies only to a managed worktree and is restored during cleanup. */
  readonly managedRuntimeInstrumentation?: true;
  readonly now?: () => Date;
  /** Waits for the route transition to settle before evidence collection. */
  readonly waitForCaptureSettling?: (
    milliseconds: number,
    signal: AbortSignal,
  ) => Promise<void>;
  /** Defaults to 800ms: enough for a native deep link to complete before capture. */
  readonly scenarioSettleDelayMs?: number;
  /** Poll interval for the signed runtime evidence after a route transition. */
  readonly runtimeEvidencePollDelayMs?: number;
  /** Bounded retries prevent a stale capture session from hanging an import. */
  readonly maximumRuntimeEvidenceAttempts?: number;
  /** Lets native layout and route animation settle after evidence becomes fresh. */
  readonly postEvidenceSettleDelayMs?: number;
  /** Number of exact screenshot pairs sampled before declaring runtime motion. */
  readonly maximumScreenshotStabilityAttempts?: number;
  readonly stableFrameDelayMs?: number;
}

interface PreparationState {
  readonly deviceId: string;
  readonly restoreSimulatorAnimations?: (signal: AbortSignal) => Promise<void>;
}

interface LaunchState {
  readonly applicationId: string;
  readonly deviceId: string;
  readonly port: number;
  readonly projectUrl: string;
  readonly processGroup: ReturnType<ProcessStarter["start"]>;
}

interface CaptureState {
  readonly scenario: CaptureScenarioV2;
  readonly screenshot: StoredArtifact;
  readonly hierarchy: StoredArtifact;
  readonly stableHash: `sha256:${string}`;
  readonly fixtureFingerprint: `sha256:${string}`;
  readonly sourceRevision: string;
  readonly evidence: ExpoRuntimeEvidenceV1;
}

function contained(root: string, candidate: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return (
    fromRoot === "" ||
    (
      fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot)
    )
  );
}

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function id(prefix: "preparation" | "launch" | "raw", value: string): string {
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

function metroHttpUrl(
  port: number,
  scenario?: CaptureScenarioV2,
  attestation?: Readonly<{ nonce: string; state: string }>,
): string {
  if (scenario === undefined || (scenario.route === "/" && scenario.parameters.length === 0)) {
    return `http://127.0.0.1:${port}`;
  }
  if (scenario.route.includes("?") || scenario.route.includes("#")) {
    throw new CaptureExecutionError(
      "validate",
      "EXPO_ROUTE_INVALID",
      false,
      "Expo routes must separate parameters from the route path.",
    );
  }
  const query = new URLSearchParams();
  for (const parameter of scenario.parameters) {
    query.set(parameter.key, parameter.value);
  }
  if (attestation !== undefined) {
    query.set("__memi_capture", attestation.nonce);
    query.set("__memi_state", attestation.state);
  }
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return `http://127.0.0.1:${port}/--${scenario.route}${suffix}`;
}

function metroProjectUrl(
  metro: ExpoMetroAuthority,
  port: number,
  scenario?: CaptureScenarioV2,
  attestation?: Readonly<{ nonce: string; state: string }>,
): string {
  const httpUrl = metroHttpUrl(port, scenario, attestation);
  if (metro.routeAuthority === "expo-go-project-url") {
    return httpUrl.replace(/^http:/u, "exp:");
  }
  return `${metro.scheme}://expo-development-client/?url=${encodeURIComponent(httpUrl)}`;
}

function scenarioUrl(
  metro: ExpoMetroAuthority,
  port: number,
  scenario: CaptureScenarioV2,
  attestation?: Readonly<{ nonce: string; state: string }>,
): string {
  if (
    metro.routeAuthority === "expo-development-client-url" &&
    attestation !== undefined
  ) {
    return createExpoStandaloneDeepLink({
      scheme: metro.routeScheme,
      route: scenario.route,
      parameters: scenario.parameters,
      attestation,
    }).url;
  }
  return metroProjectUrl(metro, port, scenario, attestation);
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

export class ExpoGoCaptureAdapter implements CaptureAdapterV1 {
  readonly metadata: CaptureAdapterMetadataV1;

  readonly #options: ExpoGoCaptureAdapterOptions;
  #preparations: Readonly<Record<string, PreparationState>> =
    Object.freeze({});
  #launches: Readonly<Record<string, LaunchState>> = Object.freeze({});
  #captures: Readonly<Record<string, CaptureState>> = Object.freeze({});
  #runtimeInstrumentation: PreparedExpoRuntimeInstrumentation | null = null;
  #managedDependencyBridge: PreparedManagedDependencyBridge | null = null;

  constructor(options: ExpoGoCaptureAdapterOptions) {
    const expoGo = options.metro.routeAuthority === "expo-go-project-url";
    const expectedArgs = expoGo
      ? ["expo", "start", "--go", "--localhost"]
      : ["expo", "start", "--dev-client", "--localhost"];
    if (
      options.metro.args.join("\0") !== expectedArgs.join("\0") ||
      (expoGo && options.metro.appId !== "host.exp.Exponent") ||
      (!expoGo &&
        (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(options.metro.appId) ||
          !/^[A-Za-z][A-Za-z0-9+.-]*$/u.test(options.metro.scheme) ||
          !/^[A-Za-z][A-Za-z0-9+.-]*$/u.test(options.metro.routeScheme)))
    ) {
      throw new Error("Expo Metro and project URL authority is invalid.");
    }
    this.metadata = parseCaptureAdapterMetadataV1({
      id:
        options.metro.routeAuthority === "expo-go-project-url"
          ? "expo-go-ios"
          : "expo-development-client-ios",
      platform: "expo-ios",
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
    if (
      options.simctlExecutable !== undefined &&
      options.simulatorProcessPolicy === undefined
    ) {
      throw new Error(
        "Direct simctl requires a separate simulator process policy.",
      );
    }
    if (
      !isAbsolute(options.managedWorktreeRoot) ||
      !isAbsolute(options.projectRoot) ||
      !contained(options.managedWorktreeRoot, options.projectRoot)
    ) {
      throw new Error("Expo Go project must remain in the managed worktree.");
    }
    if (
      (options.simctlExecutable === undefined) ===
        (options.xcrunExecutable === undefined) ||
      (options.simctlExecutable !== undefined &&
        (options.directSimulator === true
          ? options.simulatorDeviceSetPath !== undefined
          : options.simulatorDeviceSetPath === undefined ||
            !isAbsolute(options.simulatorDeviceSetPath)))
    ) {
      throw new Error(
        "Expo Go requires one simulator executable and a device set for direct simctl.",
      );
    }
    if (
      options.applications.some(
        (candidate) => candidate.platform !== "expo-ios",
      )
    ) {
      throw new Error("Expo Go adapter only accepts expo-ios applications.");
    }
    this.#options = Object.freeze({
      ...options,
      applications: Object.freeze([...options.applications]),
      metro: Object.freeze({ ...options.metro }),
      flowByRoute: Object.freeze({ ...options.flowByRoute }),
    });
  }

  async #execute(
    recipe: ProcessRecipe,
    signal: AbortSignal,
  ) {
    if (signal.aborted) {
      throw new Error("Capture was cancelled.");
    }
    const isSimulatorRecipe =
      recipe.executable === this.#options.simctlExecutable;
    const policy = isSimulatorRecipe
      ? this.#options.simulatorProcessPolicy!
      : this.#options.processPolicy;
    const isMaestroHierarchyRecipe =
      recipe.executable === this.#options.maestroExecutable &&
      recipe.args.length === 3 &&
      recipe.args[1] === "hierarchy" &&
      recipe.args[2] === "--compact";
    if (
      (isSimulatorRecipe || isMaestroHierarchyRecipe) &&
      this.#options.directSimulator === true &&
      this.#options.directSimulatorCommandPort !== undefined
    ) {
      return this.#options.directSimulatorCommandPort.execute(
        recipe,
        policy,
        signal,
      );
    }
    return this.#options.commandPort.execute(
      sandboxProcessRecipe(recipe, policy),
      signal,
    );
  }

  #simctlRecipe(args: readonly string[]): ProcessRecipe {
    if (this.#options.simctlExecutable !== undefined) {
      return {
        executable: this.#options.simctlExecutable,
        args:
          this.#options.directSimulator === true
            ? [...args]
            : [
                "--set",
                this.#options.simulatorDeviceSetPath!,
                ...args,
              ],
        cwd: this.#options.projectRoot,
      };
    }
    return {
      executable: this.#options.xcrunExecutable!,
      args: ["simctl", ...args],
      cwd: this.#options.projectRoot,
    };
  }

  async #restorePreparationAnimations(signal: AbortSignal): Promise<void> {
    const preparations = Object.values(this.#preparations);
    this.#preparations = Object.freeze({});
    const results = await Promise.allSettled(
      preparations.map((preparation) =>
        preparation.restoreSimulatorAnimations?.(signal) ?? Promise.resolve()),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
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
      throw new Error("Expo Go application was not discovered.");
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
      if (this.#options.nativeDependencyPreparation !== undefined) {
        const plan = await this.#options.nativeDependencyPreparation.currentPlan();
        assertNativeDependencyPreparationApproval(
          plan,
          this.#options.nativeDependencyPreparation.approval,
        );
        await this.#options.nativeDependencyPreparation.execute(
          plan,
          context.signal,
        );
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
      if (
        this.#options.localDevelopmentMetroLaunch !== undefined &&
        this.#managedDependencyBridge === null
      ) {
        this.#managedDependencyBridge = await prepareManagedDependencyBridge({
          projectRoot: this.#options.projectRoot,
          dependencyRoot:
            this.#options.localDevelopmentMetroLaunch.dependencyRoot,
        });
      }
      const device = await this.#options.deviceResolver(context.signal);
      const restoreSimulatorAnimations =
        await this.#options.freezeSimulatorAnimations?.(
          { deviceId: device.deviceId },
          context.signal,
        );
      this.#preparations = Object.freeze({
        ...this.#preparations,
        [preparation.id]: Object.freeze({
          deviceId: device.deviceId,
          ...(restoreSimulatorAnimations === undefined
            ? {}
            : { restoreSimulatorAnimations }),
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
      throw new Error("Expo Go application has not been prepared.");
    }
    const port = await this.#options.portLease.acquire(context.signal);
    let processGroup: LaunchState["processGroup"] | null = null;
    try {
      const launchRecipe = this.#options.localDevelopmentMetroLaunch === undefined
        ? {
            executable: this.#options.metro.executable,
            args: [
              ...this.#options.metro.args,
              "--port",
              String(port),
            ],
            cwd: this.#options.projectRoot,
          }
        : {
            executable: this.#options.localDevelopmentMetroLaunch.executable,
            args: [
              this.#options.localDevelopmentMetroLaunch.cliPath,
              "start",
              "--dev-client",
              "--localhost",
              "--port",
              String(port),
            ],
            cwd: this.#options.projectRoot,
            environment: this.#options.localDevelopmentMetroLaunch.environment,
          };
      processGroup = this.#options.processStarter.start(
        launchRecipe,
        this.#options.processPolicy,
        context.signal,
      );
      const statusUrl = `http://127.0.0.1:${port}/status`;
      await this.#options.waitForMetro(statusUrl, context.signal);
      const trustedProjectUrl = metroProjectUrl(this.#options.metro, port);
      await this.#execute(
        this.#simctlRecipe([
            "openurl",
            prepared.deviceId,
            trustedProjectUrl,
          ]),
        context.signal,
      );
      const launch = Object.freeze({
        id: id("launch", `${preparation.id}:${prepared.deviceId}:${port}`),
        preparationId: preparation.id,
      });
      this.#launches = Object.freeze({
        ...this.#launches,
        [launch.id]: Object.freeze({
          applicationId: preparation.application.id,
          deviceId: prepared.deviceId,
          port,
          processGroup,
          projectUrl: trustedProjectUrl,
        }),
      });
      return launch;
    } catch (error) {
      if (processGroup !== null) {
        processGroup.cancel();
      }
      await Promise.allSettled([
        processGroup?.cancelled ?? Promise.resolve(),
        this.#options.portLease.release(port),
        this.#options.releaseDevice?.(
          new AbortController().signal,
        ) ?? Promise.resolve(),
      ]);
      throw error;
    }
  }

  async capture(
    context: CaptureAdapterContextV1,
    launch: CaptureLaunchV1,
    scenario: CaptureScenarioV2,
  ): Promise<RawCaptureV1> {
    const state = this.#launches[launch.id];
    if (state === undefined) {
      throw new Error("Expo Go capture launch is not active.");
    }
    if (state.applicationId !== scenario.applicationId) {
      throw new CaptureExecutionError(
        "validate",
        "SCENARIO_APPLICATION_MISMATCH",
        false,
        "Expo Go scenario does not belong to the launched application.",
      );
    }
    const sourceRevision = context.job.repository.sourceRevision;
    if (sourceRevision === null) {
      throw new CaptureExecutionError(
        "validate",
        "SOURCE_REVISION_MISSING",
        false,
        "Expo Go capture requires a verified source revision.",
      );
    }
    const attestation = this.#options.managedRuntimeInstrumentation === true
      ? Object.freeze({
          nonce: createHash("sha256")
            .update(`${context.job.id}\0${scenario.id}`)
            .digest("hex")
            .slice(0, 26)
            .toUpperCase(),
          state: scenario.state,
        })
      : undefined;
    if (attestation !== undefined && this.#options.metro.routeAuthority !== "expo-development-client-url") {
      throw new CaptureExecutionError(
        "validate",
        "RUNTIME_ATTESTATION_ROUTE_UNSUPPORTED",
        false,
        "Managed runtime attestation requires the declared Expo development client.",
      );
    }
    await this.#execute(
      this.#simctlRecipe([
          "openurl",
          state.deviceId,
          scenarioUrl(this.#options.metro, state.port, scenario, attestation),
        ]),
      context.signal,
    );
    const flow = this.#options.flowByRoute?.[scenario.route];
    if (flow !== undefined) {
      const flowPath = resolve(this.#options.projectRoot, flow);
      if (!contained(this.#options.projectRoot, flowPath)) {
        throw new CaptureExecutionError(
          "capture",
          "FLOW_PATH_ESCAPE",
          false,
          "Expo Go Maestro flow is outside the project root.",
        );
      }
      await this.#execute(
        {
          executable: this.#options.maestroExecutable,
          args: [`--udid=${state.deviceId}`, "test", flow],
          cwd: this.#options.projectRoot,
        },
        context.signal,
      );
    }
    const waitForCaptureSettling = this.#options.waitForCaptureSettling ?? wait;
    await waitForCaptureSettling(
      this.#options.scenarioSettleDelayMs ?? 800,
      context.signal,
    );
    const verifyRuntimeEvidence = (bytes: Uint8Array) =>
      verifyExpoRuntimeEvidence({
        scenario,
        bytes,
        ...(attestation === undefined ? {} : { expectedNonce: attestation.nonce }),
        ...(attestation === undefined ? {} : { expectedSourceRevision: sourceRevision }),
      });
    let runtimeEvidence: ExpoRuntimeEvidenceV1 | undefined;
    if (this.#options.readSimulatorRuntimeEvidence !== undefined) {
      const maximumAttempts = this.#options.maximumRuntimeEvidenceAttempts ?? 40;
      let lastFailure: CaptureExecutionError | undefined;
      for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        const bytes = await this.#options.readSimulatorRuntimeEvidence(
          { deviceId: state.deviceId },
          context.signal,
        );
        try {
          runtimeEvidence = verifyRuntimeEvidence(bytes);
          break;
        } catch (error) {
          if (!(error instanceof CaptureExecutionError)) throw error;
          lastFailure = error;
          if (attempt + 1 < maximumAttempts) {
            await waitForCaptureSettling(
              this.#options.runtimeEvidencePollDelayMs ?? 200,
              context.signal,
            );
          }
        }
      }
      if (runtimeEvidence === undefined) {
        throw new CaptureExecutionError(
          "verify",
          lastFailure?.code ?? "RUNTIME_EVIDENCE_TIMEOUT",
          true,
          lastFailure?.message ??
            "Expo runtime did not produce verified capture evidence.",
        );
      }
      // A fresh attestation arrives before React Navigation's presentation
      // animation has necessarily completed. Give the native frame a bounded
      // settling window, then retain the strict byte-for-byte verifier below.
      await waitForCaptureSettling(
        this.#options.postEvidenceSettleDelayMs ?? 1_250,
        context.signal,
      );
    }
    const captureScreenshot = async (): Promise<Uint8Array> => {
      if (this.#options.captureSimulatorScreenshot !== undefined) {
        return this.#options.captureSimulatorScreenshot(
          { deviceId: state.deviceId },
          context.signal,
        );
      }
      const result = await this.#execute(
        this.#simctlRecipe([
          "io",
          state.deviceId,
          "screenshot",
          "--type=png",
          "-",
        ]),
        context.signal,
      );
      return result.stdout;
    };
    // Native route transitions can include a short launch/gesture animation.
    // Twelve 500ms-spaced samples bound the wait at twelve seconds while
    // never accepting a changing frame as evidence.
    const maximumScreenshotAttempts =
      this.#options.maximumScreenshotStabilityAttempts ?? 12;
    let stableScreenshot: Uint8Array | undefined;
    let stableHash: `sha256:${string}` | undefined;
    let lastStabilityFailure: Exclude<
      ReturnType<typeof verifyStableFrames>,
      Readonly<{ ok: true; hash: `sha256:${string}` }>
    > | undefined;
    for (let attempt = 0; attempt < maximumScreenshotAttempts; attempt += 1) {
      const first = await captureScreenshot();
      await waitForCaptureSettling(
        this.#options.stableFrameDelayMs ?? 500,
        context.signal,
      );
      const second = await captureScreenshot();
      const stability = verifyStableFrames(first, second);
      if (stability.ok) {
        stableScreenshot = first;
        stableHash = stability.hash;
        break;
      }
      lastStabilityFailure = stability;
      if (attempt + 1 < maximumScreenshotAttempts) {
        await waitForCaptureSettling(
          this.#options.stableFrameDelayMs ?? 500,
          context.signal,
        );
      }
    }
    if (stableScreenshot === undefined || stableHash === undefined) {
      throw new CaptureExecutionError(
        "verify",
        lastStabilityFailure?.code ?? "UNSTABLE_FRAME",
        true,
        lastStabilityFailure?.message ??
          "Runtime capture did not produce a stable frame pair.",
      );
    }
    const hierarchyResult = await this.#execute(
      {
        executable: this.#options.maestroExecutable,
        args: [
          `--udid=${state.deviceId}`,
          "hierarchy",
          "--compact",
        ],
        cwd: this.#options.projectRoot,
      },
      context.signal,
    );
    if (hierarchyResult.stdout.byteLength === 0) {
      throw new CaptureExecutionError(
        "extract-layers",
        "HIERARCHY_EMPTY",
        true,
        "Maestro returned an empty Expo Go hierarchy.",
      );
    }
    const evidence = runtimeEvidence ?? verifyRuntimeEvidence(hierarchyResult.stdout);
    const [screenshotArtifact, hierarchy] = await Promise.all([
      this.#options.artifactStore.put(stableScreenshot, "png"),
      this.#options.artifactStore.put(hierarchyResult.stdout, "csv"),
    ]);
    const raw = Object.freeze({
      id: id("raw", `${scenario.id}:${stableHash}`),
      scenarioId: scenario.id,
    });
    this.#captures = Object.freeze({
      ...this.#captures,
      [raw.id]: Object.freeze({
        scenario,
        screenshot: screenshotArtifact,
        hierarchy,
        stableHash,
        fixtureFingerprint: hash(JSON.stringify({
          fixtureProfile: scenario.fixtureProfile,
          authContext: scenario.authContext,
          parameters: scenario.parameters,
          projectUrl: state.projectUrl,
          flow: flow ?? null,
        })),
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
    if (state === undefined) {
      throw new Error("Expo Go capture evidence was not found.");
    }
    const capturedArtifactId = artifactId(`${capture.id}:expo-go`);
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
        ({ id: applicationId }) => applicationId === state.scenario.applicationId,
      );
      if (application === undefined) {
        throw new Error("Captured application authority was not found.");
      }
      const sourceAnchorText = `${sourceAnchor.relativePath}${
        sourceAnchor.symbol === null ? "" : `#${sourceAnchor.symbol}`
      }`;
      const manifest = RuntimeCaptureScreenV1Schema.parse({
        app: {
          appVersion: state.evidence.semanticCapture.appVersion,
          buildRevision: state.sourceRevision,
          environment: "simulator",
          productId: application.id,
        },
        artifact: {
          alt: `${application.label} ${state.scenario.state}`,
          artifactId: state.screenshot.id,
          hash: state.screenshot.hash,
          height:
            state.scenario.viewport.height * state.scenario.viewport.scale,
          kind: "image/png",
          src: `memi-artifact://localhost/${state.screenshot.id}`,
          sourceUrl: `memi-source://repository/${sourceAnchor.relativePath}`,
          width: state.scenario.viewport.width * state.scenario.viewport.scale,
        },
        authority: "local_capture",
        binding: {
          coverageCellId: state.scenario.id,
          normalizedPath: state.scenario.route,
          routeId: state.scenario.route,
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
        captureId: capturedArtifactId,
        capturedAt: (this.#options.now ?? (() => new Date()))().toISOString(),
        evidence: {
          accessibilitySnapshotRef: `memi-artifact://localhost/${state.hierarchy.id}`,
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
      id: capturedArtifactId,
      scenarioId: state.scenario.id,
      screenshotArtifactId: state.screenshot.id,
      hierarchyArtifactId: state.hierarchy.id,
      geometryArtifactId: null,
      reconstructionArtifactId,
      screenshotHash: state.screenshot.hash,
      sourceRevision: state.sourceRevision,
      fixtureFingerprint: state.fixtureFingerprint,
      dimensions: {
        width: state.scenario.viewport.width * state.scenario.viewport.scale,
        height:
          state.scenario.viewport.height * state.scenario.viewport.scale,
        scale: state.scenario.viewport.scale,
      },
      verification: {
        stableFrameHash: state.stableHash,
        routeMatched: state.evidence.route === state.scenario.route,
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
    const restoreInstrumentation = async (): Promise<void> => {
      const prepared = this.#runtimeInstrumentation;
      this.#runtimeInstrumentation = null;
      if (prepared !== null) {
        await restoreExpoRuntimeInstrumentation(prepared);
      }
    };
    const restoreDependencyBridge = async (): Promise<void> => {
      const prepared = this.#managedDependencyBridge;
      this.#managedDependencyBridge = null;
      if (prepared !== null) {
        await restoreManagedDependencyBridge(prepared);
      }
    };
    if (launch === null) {
      await Promise.all([
        this.#restorePreparationAnimations(new AbortController().signal),
        restoreInstrumentation(),
        restoreDependencyBridge(),
      ]);
      return;
    }
    const state = this.#launches[launch.id];
    if (state === undefined) {
      await Promise.all([
        restoreInstrumentation(),
        restoreDependencyBridge(),
      ]);
      return;
    }
    const cleanupSignal = new AbortController().signal;
    state.processGroup.cancel();
    const preparation = this.#preparations[launch.preparationId];
    const results = await Promise.allSettled([
      state.processGroup.cancelled,
      this.#options.portLease.release(state.port),
      this.#execute(
        this.#simctlRecipe([
            "terminate",
            state.deviceId,
            this.#options.metro.appId,
          ]),
        cleanupSignal,
      ),
      preparation?.restoreSimulatorAnimations?.(cleanupSignal) ?? Promise.resolve(),
      restoreInstrumentation(),
      restoreDependencyBridge(),
    ]);
    const releaseResults = await Promise.allSettled([
      this.#options.releaseDevice?.(cleanupSignal) ?? Promise.resolve(),
    ]);
    this.#launches = Object.freeze(
      Object.fromEntries(
        Object.entries(this.#launches).filter(
          ([launchId]) => launchId !== launch.id,
        ),
      ),
    );
    this.#preparations = Object.freeze(
      Object.fromEntries(
        Object.entries(this.#preparations).filter(
          ([preparationId]) => preparationId !== launch.preparationId,
        ),
      ),
    );
    const failure = [...results, ...releaseResults].find(
      (result) => result.status === "rejected",
    );
    if (failure?.status === "rejected") {
      throw failure.reason;
    }
  }
}
