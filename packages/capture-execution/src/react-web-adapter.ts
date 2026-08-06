import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import type {
  CaptureAdapterMetadataV1,
  CaptureAdapterContextV1,
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

import {
  ContentAddressedArtifactStore,
  type StoredArtifact,
} from "./artifact-store.js";
import type {
  BrowserLauncher,
  BrowserLike,
  PortLease,
  ProcessRunnerLike,
} from "./browser-capture-types.js";
export type {
  BrowserLauncher,
  BrowserLike,
  BrowserPageLike,
  BrowserPageOptions,
  PortLease,
  ProcessStarter,
  RuntimePageEvidence,
} from "./browser-capture-types.js";
import { CaptureExecutionError } from "./executor.js";
import type {
  ProcessExecutionPolicy,
  ProcessRecipe,
  RunningProcessGroup,
} from "./process-policy.js";
import { verifyStableFrames } from "./stability.js";

export const HELIUM_EXECUTABLE =
  "/Applications/Helium.app/Contents/MacOS/Helium";

export interface ResolveHeliumExecutableOptions {
  readonly exists?: (path: string) => boolean;
  readonly platform?: NodeJS.Platform;
}

export function resolveHeliumExecutable(
  options: ResolveHeliumExecutableOptions = {},
): string {
  if ((options.platform ?? process.platform) !== "darwin") {
    throw new Error("Helium capture is available only on macOS.");
  }
  if (!(options.exists ?? existsSync)(HELIUM_EXECUTABLE)) {
    throw new Error("The approved Helium executable is unavailable.");
  }
  return HELIUM_EXECUTABLE;
}

export interface ReactWebCaptureAdapterOptions {
  readonly applications: readonly ImportApplicationV2[];
  readonly artifactStore: ContentAddressedArtifactStore;
  readonly processRunner: ProcessRunnerLike;
  readonly processPolicy: ProcessExecutionPolicy;
  readonly recipe: (
    application: ImportApplicationV2,
    port: number,
  ) => ProcessRecipe;
  readonly portLease: PortLease;
  readonly browserLauncher?: BrowserLauncher;
  readonly waitForLoopback: (url: string, signal: AbortSignal) => Promise<void>;
  readonly previewHost?: string;
  readonly captureTimeoutMs?: number;
  readonly stableFrameDelayMs?: number;
  readonly now?: () => Date;
}

interface LaunchState {
  readonly launch: CaptureLaunchV1;
  readonly application: ImportApplicationV2;
  readonly port: number;
  readonly baseUrl: string;
  readonly processGroup: RunningProcessGroup;
  readonly browser: BrowserLike;
}

interface RawCaptureState {
  readonly raw: RawCaptureV1;
  readonly launchId: string;
  readonly scenario: CaptureScenarioV2;
  readonly screenshot: StoredArtifact;
  readonly hierarchy: StoredArtifact;
  readonly geometry: StoredArtifact;
  readonly stableHash: `sha256:${string}`;
  readonly sourceRevision: string;
  readonly fixtureFingerprint: `sha256:${string}`;
}

const STOP_MOTION_CSS = `
*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  animation-iteration-count: 1 !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
  transition-duration: 0s !important;
}
`;

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicId(
  prefix: "preparation" | "launch" | "raw",
  seed: string,
) {
  return `${prefix}-${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`;
}

function artifactId(seed: string): `art_${string}` {
  return `art_${createHash("sha256")
    .update(seed)
    .digest("hex")
    .slice(0, 26)
    .toUpperCase()}`;
}

function assertLoopbackHost(host: string): void {
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("React web capture host must be loopback-only.");
  }
}

function normalizeAllowedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Browser capture origin must be a valid loopback URL.");
  }
  const hostname =
    url.hostname === "[::1]" ? "::1" : url.hostname.toLowerCase();
  assertLoopbackHost(hostname);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "Browser capture origin must be an uncredentialed HTTP(S) origin.",
    );
  }
  return url.origin;
}

function isAllowedBrowserRequest(
  value: string,
  allowedOrigin: string,
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "data:") {
    return true;
  }
  if (url.protocol === "blob:") {
    return url.origin === allowedOrigin || url.origin === "null";
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    return url.origin === allowedOrigin;
  }
  return url.protocol === "about:" && url.toString() === "about:blank";
}

function createScenarioUrl(
  baseUrl: string,
  scenario: CaptureScenarioV2,
): string {
  const url = new URL(scenario.route, baseUrl);
  for (const parameter of scenario.parameters) {
    url.searchParams.set(parameter.key, parameter.value);
  }
  return url.toString();
}

function normalizedPathname(value: string): string {
  const pathname = new URL(value).pathname.replace(/\/+$/u, "");
  return pathname === "" ? "/" : pathname;
}

function normalizedSearchParameters(
  url: URL,
): readonly (readonly [string, string])[] {
  return Object.freeze(
    Array.from(url.searchParams.entries())
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        const keyOrder = leftKey.localeCompare(rightKey);
        return keyOrder === 0 ? leftValue.localeCompare(rightValue) : keyOrder;
      })
      .map((entry) => Object.freeze(entry)),
  );
}

function scenarioUrlMatches(
  expectedValue: string,
  actualValue: string,
): boolean {
  const expected = new URL(expectedValue);
  const actual = new URL(actualValue);
  const expectedParameters = normalizedSearchParameters(expected);
  const actualParameters = normalizedSearchParameters(actual);
  return (
    actual.origin === expected.origin &&
    normalizedPathname(actual.toString()) ===
      normalizedPathname(expected.toString()) &&
    actualParameters.length === expectedParameters.length &&
    expectedParameters.every(
      ([key, value], index) =>
        actualParameters[index]?.[0] === key &&
        actualParameters[index]?.[1] === value,
    )
  );
}

function stableJson(value: unknown): Uint8Array {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(sort);
    }
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, sort(child)]),
      );
    }
    return input;
  };
  return new TextEncoder().encode(JSON.stringify(sort(value)));
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }
  await new Promise<void>((resolvePromise, reject) => {
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

async function abortable<Value>(
  operation: Promise<Value>,
  signal: AbortSignal,
): Promise<Value> {
  if (signal.aborted) {
    throw new CaptureExecutionError(
      "capture",
      "CAPTURE_CANCELLED",
      true,
      "Capture was cancelled.",
    );
  }
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () =>
          reject(
            new CaptureExecutionError(
              "capture",
              "CAPTURE_CANCELLED",
              true,
              "Capture was cancelled.",
            ),
          ),
        { once: true },
      );
    }),
  ]);
}

function createPlaywrightBrowserLauncherForExecutable(
  executablePath: string,
): BrowserLauncher {
  return {
    async launch(): Promise<BrowserLike> {
      // Web capture is optional for the native-first runtime. Keeping the
      // Playwright import inside the web-launch path prevents an otherwise
      // unused browser bundle from delaying or blocking sidecar startup.
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({
        executablePath,
        headless: true,
        args: [
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-domain-reliability",
          "--disable-features=MediaRouter,OptimizationHints",
          "--disable-sync",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ],
      });
      return {
        async newPage(options) {
          const allowedOrigin = normalizeAllowedOrigin(options.allowedOrigin);
          const context = await browser.newContext({
            viewport: options.viewport,
            deviceScaleFactor: options.deviceScaleFactor,
            serviceWorkers: "block",
          });
          await context.route("**/*", async (route) => {
            const requestUrl = route.request().url();
            if (!isAllowedBrowserRequest(requestUrl, allowedOrigin)) {
              await route.abort("blockedbyclient");
              return;
            }
            const response = await route.fetch({ maxRedirects: 0 });
            const location = response.headers()["location"];
            if (
              location !== undefined &&
              !isAllowedBrowserRequest(
                new URL(location, requestUrl).toString(),
                allowedOrigin,
              )
            ) {
              await response.dispose();
              await route.abort("blockedbyclient");
              return;
            }
            await route.fulfill({ response });
          });
          await context.routeWebSocket("**/*", async (webSocket) => {
            await webSocket.close({
              code: 1_008,
              reason: "Memi capture blocks WebSocket traffic.",
            });
          });
          const page = await context.newPage();
          return {
            goto: (url, gotoOptions) => page.goto(url, gotoOptions),
            waitForSelector: (selector, waitOptions) =>
              page.waitForSelector(selector, waitOptions),
            addStyleTag: (style) => page.addStyleTag(style),
            async screenshot() {
              return page.screenshot({
                animations: "disabled",
                fullPage: false,
                type: "png",
              });
            },
            url: () => page.url(),
            async collectEvidence() {
              return page.evaluate(() => {
                const all = Array.from(document.querySelectorAll("*"));
                const visible = all.filter((element) => {
                  const bounds = element.getBoundingClientRect();
                  const style = window.getComputedStyle(element);
                  return (
                    bounds.width > 0 &&
                    bounds.height > 0 &&
                    style.display !== "none" &&
                    style.visibility !== "hidden"
                  );
                });
                const textLength = (document.body?.innerText ?? "").trim()
                  .length;
                const bodyText = (document.body?.innerText ?? "").toLowerCase();
                return {
                  visibleTextLength: textLength,
                  elementCount: visible.length,
                  errorBoundary:
                    bodyText.includes("application error") ||
                    bodyText.includes("unexpected error") ||
                    Boolean(document.querySelector("[data-error-boundary]")),
                  splashScreen:
                    Boolean(document.querySelector("[data-splash-screen]")) ||
                    (document.body?.children.length === 1 &&
                      Boolean(
                        document.querySelector("body > [aria-busy='true']"),
                      )),
                  hierarchy: visible.slice(0, 10_000).map((element) => ({
                    tag: element.tagName.toLowerCase(),
                    role: element.getAttribute("role"),
                    source: element.getAttribute("data-memi-source"),
                  })),
                  geometry: visible.slice(0, 10_000).map((element) => {
                    const bounds = element.getBoundingClientRect();
                    return {
                      tag: element.tagName.toLowerCase(),
                      x: bounds.x,
                      y: bounds.y,
                      width: bounds.width,
                      height: bounds.height,
                      source: element.getAttribute("data-memi-source"),
                    };
                  }),
                };
              });
            },
            close: () => context.close(),
          };
        },
        close: () => browser.close(),
      };
    },
  };
}

/** Production capture is always hard-pinned to the approved Helium binary. */
export function createPlaywrightBrowserLauncher(): BrowserLauncher {
  return createPlaywrightBrowserLauncherForExecutable(resolveHeliumExecutable());
}

/**
 * Test-only seam for CI's Playwright-managed browser. The runtime rejects this
 * path outside Vitest, so production cannot substitute an arbitrary browser.
 */
export function createPlaywrightBrowserLauncherForTest(
  executablePath: string,
): BrowserLauncher {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Test browser launcher is unavailable outside test execution.");
  }
  return createPlaywrightBrowserLauncherForExecutable(executablePath);
}

export class ReactWebCaptureAdapter implements CaptureAdapterV1 {
  readonly metadata: CaptureAdapterMetadataV1 = parseCaptureAdapterMetadataV1({
    id: "playwright-react-web",
    platform: "react-web",
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

  readonly #options: ReactWebCaptureAdapterOptions;
  #launches: Readonly<Record<string, LaunchState>> = Object.freeze({});
  #captures: Readonly<Record<string, RawCaptureState>> = Object.freeze({});

  constructor(options: ReactWebCaptureAdapterOptions) {
    const host = options.previewHost ?? "127.0.0.1";
    assertLoopbackHost(host);
    if (
      options.applications.some(
        (application) => application.platform !== "react-web",
      )
    ) {
      throw new Error("React adapter only accepts react-web applications.");
    }
    this.#options = Object.freeze({
      ...options,
      applications: Object.freeze([...options.applications]),
      browserLauncher:
        options.browserLauncher ?? createPlaywrightBrowserLauncher(),
      previewHost: host,
    });
  }

  async discover(): Promise<readonly ImportApplicationV2[]> {
    return Object.freeze([...this.#options.applications]);
  }

  async prepare(
    context: CaptureAdapterContextV1,
    application: ImportApplicationV2,
  ): Promise<CapturePreparationV1> {
    if (context.signal.aborted) {
      throw new Error("Capture was cancelled.");
    }
    if (
      !this.#options.applications.some(
        (candidate) => candidate.id === application.id,
      )
    ) {
      throw new Error("Application was not discovered by this adapter.");
    }
    return Object.freeze({
      id: deterministicId(
        "preparation",
        `${context.job.id}:${application.id}:${context.job.repository.sourceRevision ?? "dirty"}`,
      ),
      application,
      repository: context.job.repository,
    });
  }

  async launch(
    context: CaptureAdapterContextV1,
    preparation: CapturePreparationV1,
  ): Promise<CaptureLaunchV1> {
    const port = await this.#options.portLease.acquire(context.signal);
    let processGroup: RunningProcessGroup | null = null;
    try {
      processGroup = this.#options.processRunner.start(
        this.#options.recipe(preparation.application, port),
        this.#options.processPolicy,
        context.signal,
      );
      const baseUrl = `http://${this.#options.previewHost}:${port}/`;
      await this.#options.waitForLoopback(baseUrl, context.signal);
      const browser = await this.#options.browserLauncher!.launch();
      const launch = Object.freeze({
        id: deterministicId("launch", `${preparation.id}:${port}`),
        preparationId: preparation.id,
      });
      this.#launches = Object.freeze({
        ...this.#launches,
        [launch.id]: Object.freeze({
          launch,
          application: preparation.application,
          port,
          baseUrl,
          processGroup,
          browser,
        }),
      });
      return launch;
    } catch (error) {
      if (processGroup !== null) {
        processGroup.cancel();
        await processGroup.cancelled;
      }
      await this.#options.portLease.release(port);
      throw error;
    }
  }

  async capture(
    context: CaptureAdapterContextV1,
    launch: CaptureLaunchV1,
    scenario: CaptureScenarioV2,
  ): Promise<RawCaptureV1> {
    const state = this.#launches[launch.id];
    if (!state) {
      throw new Error("Capture launch is not active.");
    }
    const sourceRevision = context.job.repository.sourceRevision;
    if (sourceRevision === null) {
      throw new CaptureExecutionError(
        "validate",
        "SOURCE_REVISION_MISSING",
        false,
        "A runtime capture requires a verified source revision.",
      );
    }
    const page = await state.browser.newPage({
      viewport: {
        width: scenario.viewport.width,
        height: scenario.viewport.height,
      },
      deviceScaleFactor: scenario.viewport.scale,
      allowedOrigin: new URL(state.baseUrl).origin,
    });
    try {
      const url = createScenarioUrl(state.baseUrl, scenario);
      const timeout = this.#options.captureTimeoutMs ?? 30_000;
      await abortable(
        page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout,
        }),
        context.signal,
      );
      await abortable(
        page.waitForSelector(scenario.readinessSelector ?? "body", {
          state: "visible",
          timeout,
        }),
        context.signal,
      );
      await abortable(
        page.addStyleTag({ content: STOP_MOTION_CSS }),
        context.signal,
      );
      const evidence = await abortable(page.collectEvidence(), context.signal);
      if (!scenarioUrlMatches(url, page.url())) {
        throw new CaptureExecutionError(
          "capture",
          "ROUTE_MISMATCH",
          true,
          `Expected ${scenario.route} but captured ${new URL(page.url()).pathname}.`,
        );
      }
      if (evidence.errorBoundary) {
        throw new CaptureExecutionError(
          "capture",
          "ERROR_BOUNDARY",
          true,
          "The runtime rendered an error boundary.",
        );
      }
      if (evidence.splashScreen) {
        throw new CaptureExecutionError(
          "capture",
          "SPLASH_SCREEN",
          true,
          "The runtime remained on a splash screen.",
        );
      }
      if (
        evidence.elementCount === 0 ||
        (evidence.visibleTextLength === 0 && evidence.elementCount < 2)
      ) {
        throw new CaptureExecutionError(
          "capture",
          "BLANK_SCREEN",
          true,
          "The runtime rendered a blank screen.",
        );
      }
      const first = await abortable(page.screenshot(), context.signal);
      await delay(this.#options.stableFrameDelayMs ?? 250, context.signal);
      const second = await abortable(page.screenshot(), context.signal);
      const stability = verifyStableFrames(first, second);
      if (!stability.ok) {
        throw new CaptureExecutionError(
          "verify",
          stability.code,
          true,
          stability.message,
        );
      }
      const [screenshot, hierarchy, geometry] = await Promise.all([
        this.#options.artifactStore.put(first, "png"),
        this.#options.artifactStore.put(stableJson(evidence.hierarchy), "json"),
        this.#options.artifactStore.put(stableJson(evidence.geometry), "json"),
      ]);
      const raw = Object.freeze({
        id: deterministicId("raw", `${scenario.id}:${stability.hash}`),
        scenarioId: scenario.id,
      });
      this.#captures = Object.freeze({
        ...this.#captures,
        [raw.id]: Object.freeze({
          raw,
          launchId: launch.id,
          scenario,
          screenshot,
          hierarchy,
          geometry,
          stableHash: stability.hash,
          sourceRevision,
          fixtureFingerprint: sha256(
            JSON.stringify({
              fixtureProfile: scenario.fixtureProfile,
              authContext: scenario.authContext,
              parameters: scenario.parameters,
            }),
          ),
        }),
      });
      return raw;
    } finally {
      await page.close();
    }
  }

  async collect(
    _context: CaptureAdapterContextV1,
    _launch: CaptureLaunchV1,
    capture: RawCaptureV1,
  ): Promise<CaptureArtifactV2> {
    const state = this.#captures[capture.id];
    if (!state) {
      throw new Error("Raw capture evidence was not found.");
    }
    const artifact = CaptureArtifactSchemaV2.parse({
      id: artifactId(`${state.scenario.id}:${state.screenshot.hash}:capture`),
      scenarioId: state.scenario.id,
      screenshotArtifactId: state.screenshot.id,
      hierarchyArtifactId: state.hierarchy.id,
      geometryArtifactId: state.geometry.id,
      screenshotHash: state.screenshot.hash,
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
        blankRejected: true,
        splashRejected: true,
        errorBoundaryRejected: true,
        verifiedAt: (this.#options.now ?? (() => new Date()))().toISOString(),
      },
    });
    return Object.freeze(artifact);
  }

  async cleanup(
    _context: CaptureAdapterContextV1,
    launch: CaptureLaunchV1 | null,
  ): Promise<void> {
    if (launch === null) {
      return;
    }
    const state = this.#launches[launch.id];
    if (!state) {
      return;
    }
    state.processGroup.cancel();
    const cleanupResults = await Promise.allSettled([
      state.processGroup.cancelled,
      state.browser.close(),
      this.#options.portLease.release(state.port),
    ]);
    const failures = cleanupResults.filter(
      (result) => result.status === "rejected",
    );
    this.#launches = Object.freeze(
      Object.fromEntries(
        Object.entries(this.#launches).filter(([id]) => id !== launch.id),
      ),
    );
    this.#captures = Object.freeze(
      Object.fromEntries(
        Object.entries(this.#captures).filter(
          ([, capture]) => capture.launchId !== launch.id,
        ),
      ),
    );
    if (failures.length > 0) {
      throw new Error("React capture cleanup did not complete.");
    }
  }
}
