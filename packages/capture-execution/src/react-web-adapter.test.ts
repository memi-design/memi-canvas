import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { describe, expect, it, vi } from "vitest";

import { ContentAddressedArtifactStore } from "./artifact-store.js";
import { executeCaptureScenario } from "./executor.js";
import {
  createPlaywrightBrowserLauncherForTest,
  HELIUM_EXECUTABLE,
  resolveHeliumExecutable,
  ReactWebCaptureAdapter,
  type BrowserLike,
  type BrowserPageLike,
} from "./react-web-adapter.js";
import {
  applicationFixture,
  jobFixture,
  scenarioFixture,
} from "./test-fixtures.js";

function hermeticBrowserLauncher() {
  const playwrightExecutable = chromium.executablePath();
  return createPlaywrightBrowserLauncherForTest(
    process.env.MEMI_TEST_BROWSER_EXECUTABLE ??
      (existsSync(playwrightExecutable)
        ? playwrightExecutable
        : HELIUM_EXECUTABLE),
  );
}

async function listen(
  server: Server,
): Promise<Readonly<{ origin: string; close(): Promise<void> }>> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolvePromise();
          }
        });
      }),
  };
}

function pageFixture(
  evidence: {
    readonly visibleTextLength: number;
    readonly elementCount: number;
    readonly errorBoundary: boolean;
    readonly splashScreen: boolean;
  } = {
    visibleTextLength: 12,
    elementCount: 8,
    errorBoundary: false,
    splashScreen: false,
  },
): BrowserPageLike {
  let screenshotIndex = 0;
  return {
    goto: vi.fn(async () => null),
    waitForSelector: vi.fn(async () => undefined),
    addStyleTag: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => {
      screenshotIndex += 1;
      return new Uint8Array([137, 80, 78, 71, screenshotIndex > 0 ? 1 : 0]);
    }),
    url: vi.fn(() => "http://127.0.0.1:4173/dashboard"),
    collectEvidence: vi.fn(async () => ({
      ...evidence,
      hierarchy: { role: "document", children: [] },
      geometry: [{ tag: "main", x: 0, y: 0, width: 1_440, height: 900 }],
    })),
    close: vi.fn(async () => undefined),
  };
}

function browserFixture(page: BrowserPageLike): BrowserLike {
  return {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
}

async function adapterFixture(page = pageFixture()) {
  const root = await mkdtemp(join(tmpdir(), "memi-web-capture-"));
  const processGroup = {
    child: { pid: 42, stdout: null, stderr: null, once: vi.fn() },
    cancelled: Promise.resolve(),
    cancel: vi.fn(),
  };
  const portLease = {
    acquire: vi.fn(async () => 4_173),
    release: vi.fn(async () => undefined),
  };
  const browser = browserFixture(page);
  const adapter = new ReactWebCaptureAdapter({
    applications: [applicationFixture],
    artifactStore: new ContentAddressedArtifactStore(root),
    processRunner: {
      start: vi.fn(() => processGroup),
    },
    processPolicy: {
      allowedCommands: [
        {
          executable: "/usr/local/bin/npm",
          arguments: [
            { kind: "literal", value: "run" },
            { kind: "literal", value: "dev" },
            { kind: "literal", value: "--" },
            { kind: "literal", value: "--port" },
            { kind: "integer", minimum: 1_024, maximum: 65_535 },
          ],
        },
      ],
      allowedCwdRoots: ["/tmp"],
      sandboxEnvironment: {
        home: "/tmp/.memi-home",
        temporaryDirectory: "/tmp/.memi-tmp",
        path: "",
      },
      sandbox: {
        executable: "/usr/bin/sandbox-exec",
        allowedReadRoots: ["/tmp", "/usr"],
        allowedWriteRoots: ["/tmp"],
        network: "loopback",
      },
    },
    recipe: () => ({
      executable: "/usr/local/bin/npm",
      args: ["run", "dev", "--", "--port", "4173"],
      cwd: "/tmp/source",
    }),
    portLease,
    browserLauncher: {
      launch: vi.fn(async () => browser),
    },
    waitForLoopback: vi.fn(async () => undefined),
    now: () => new Date("2026-07-29T10:00:00.000Z"),
    stableFrameDelayMs: 0,
  });
  return { adapter, processGroup, portLease, browser, page };
}

describe("ReactWebCaptureAdapter", () => {
  it("resolves only the installed bounded Helium executable", () => {
    expect(
      resolveHeliumExecutable({
        exists: (path) =>
          path === "/Applications/Helium.app/Contents/MacOS/Helium",
        platform: "darwin",
      }),
    ).toBe("/Applications/Helium.app/Contents/MacOS/Helium");
    expect(() =>
      resolveHeliumExecutable({
        exists: () => false,
        platform: "darwin",
      }),
    ).toThrow(/Helium.*unavailable/i);
    expect(() =>
      resolveHeliumExecutable({
        exists: () => true,
        platform: "linux",
      }),
    ).toThrow(/macOS/i);
  });

  it("uses real Playwright pixels and DOM geometry", async () => {
    const browser = await hermeticBrowserLauncher().launch();
    const page = await browser.newPage({
      viewport: { width: 320, height: 240 },
      deviceScaleFactor: 1,
      allowedOrigin: "http://127.0.0.1:4173",
    });
    try {
      await page.goto(
        "data:text/html,<main data-memi-source='src/App.tsx'><h1>Ready</h1></main>",
        { waitUntil: "domcontentloaded", timeout: 5_000 },
      );
      await page.waitForSelector("main", {
        state: "visible",
        timeout: 5_000,
      });
      await page.addStyleTag({ content: "* { transition: none !important }" });
      const evidence = await page.collectEvidence();
      const first = await page.screenshot();
      const second = await page.screenshot();

      expect(first.byteLength).toBeGreaterThan(100);
      expect(second).toEqual(first);
      expect(evidence.visibleTextLength).toBeGreaterThan(0);
      expect(evidence.elementCount).toBeGreaterThan(0);
      expect(evidence.hierarchy).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: "src/App.tsx" }),
        ]),
      );
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it("contains hostile browser traffic to the exact capture origin", async () => {
    const externalRequests: string[] = [];
    const externalServer = createServer((request, response) => {
      externalRequests.push(request.url ?? "/");
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("external");
    });
    let externalUpgrades = 0;
    externalServer.on("upgrade", (_request, socket) => {
      externalUpgrades += 1;
      socket.destroy();
    });
    const external = await listen(externalServer);

    const captureRequests: string[] = [];
    let captureUpgrades = 0;
    const captureServer = createServer((request, response) => {
      const requestUrl = request.url ?? "/";
      captureRequests.push(requestUrl);
      if (requestUrl === "/sw.js") {
        response.writeHead(200, {
          "content-type": "application/javascript",
          "service-worker-allowed": "/",
        });
        response.end("self.addEventListener('fetch', () => undefined)");
        return;
      }
      if (requestUrl === "/redirect") {
        response.writeHead(302, {
          location: `${external.origin}/redirect-target`,
        });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <main>
          <h1>Capture origin</h1>
          <img src="${external.origin}/pixel.png">
          <link rel="stylesheet" href="${external.origin}/styles.css">
          <script>
            fetch("${external.origin}/fetch").catch(() => undefined);
            navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
            const socket = new WebSocket(
              location.origin.replace("http", "ws") + "/socket"
            );
            socket.onerror = () => undefined;
            const workerSource =
              "postMessage('blob-ok')";
            const worker = new Worker(URL.createObjectURL(
              new Blob([workerSource], { type: "application/javascript" })
            ));
            worker.onmessage = () => {
              const marker = document.createElement("p");
              marker.id = "blob-ok";
              marker.textContent = "blob and data ready";
              document.body.append(marker);
            };
            fetch("data:text/plain,data-ok").then(() => {
              const marker = document.createElement("p");
              marker.id = "data-ok";
              marker.textContent = "data ready";
              document.body.append(marker);
            }).catch(() => undefined);
          </script>
        </main>
      `);
    });
    captureServer.on("upgrade", (_request, socket) => {
      captureUpgrades += 1;
      socket.destroy();
    });
    const capture = await listen(captureServer);

    const browser = await hermeticBrowserLauncher().launch();
    const page = await browser.newPage({
      viewport: { width: 320, height: 240 },
      deviceScaleFactor: 1,
      allowedOrigin: capture.origin,
    });
    try {
      await page.goto(`${capture.origin}/capture`, {
        waitUntil: "domcontentloaded",
        timeout: 5_000,
      });
      await page.waitForSelector("#blob-ok", {
        state: "visible",
        timeout: 5_000,
      });
      await page.waitForSelector("#data-ok", {
        state: "visible",
        timeout: 5_000,
      });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));

      expect(externalRequests).toEqual([]);
      expect(externalUpgrades).toBe(0);
      expect(captureUpgrades).toBe(0);
      expect(captureRequests).not.toContain("/sw.js");
      await page
        .goto(`${capture.origin}/redirect`, {
          waitUntil: "domcontentloaded",
          timeout: 5_000,
        })
        .catch(() => undefined);
      expect(externalRequests).toEqual([]);
      await expect(
        page.goto(`${external.origin}/redirect-target`, {
          waitUntil: "domcontentloaded",
          timeout: 5_000,
        }),
      ).rejects.toThrow();
      await expect(
        page.goto("https://example.com/", {
          waitUntil: "domcontentloaded",
          timeout: 5_000,
        }),
      ).rejects.toThrow();
    } finally {
      await page.close();
      await browser.close();
      await capture.close();
      await external.close();
    }
  });

  it.each([
    "https://example.com",
    "http://user:secret@127.0.0.1:4173",
    "http://127.0.0.1:4173/not-an-origin",
  ])(
    "rejects an unsafe browser capture authority %s",
    async (allowedOrigin) => {
      const browser = await hermeticBrowserLauncher().launch();
      try {
        await expect(
          browser.newPage({
            viewport: { width: 320, height: 240 },
            deviceScaleFactor: 1,
            allowedOrigin,
          }),
        ).rejects.toThrow(/capture origin|loopback/i);
      } finally {
        await browser.close();
      }
    },
  );

  it("captures stable real pixels and persists DOM evidence", async () => {
    const fixture = await adapterFixture();
    vi.mocked(fixture.page.url).mockReturnValue(
      "http://127.0.0.1:4173/dashboard?fixture=stable",
    );
    const scenarioWithParameters = {
      ...scenarioFixture,
      parameters: [{ key: "fixture", value: "stable" }],
    };
    const result = await executeCaptureScenario({
      adapter: fixture.adapter,
      application: applicationFixture,
      scenario: scenarioWithParameters,
      job: jobFixture,
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });
    expect(result).toMatchObject({
      kind: "captured",
      artifact: {
        scenarioId: scenarioFixture.id,
        dimensions: { width: 1_440, height: 900, scale: 1 },
        verification: {
          routeMatched: true,
          blankRejected: true,
          splashRejected: true,
          errorBoundaryRejected: true,
        },
      },
    });
    if (result.kind === "captured") {
      expect(result.artifact.hierarchyArtifactId).not.toBeNull();
      expect(result.artifact.geometryArtifactId).not.toBeNull();
    }
    expect(fixture.page.goto).toHaveBeenCalledWith(
      "http://127.0.0.1:4173/dashboard?fixture=stable",
      expect.objectContaining({ waitUntil: "domcontentloaded" }),
    );
    expect(fixture.processGroup.cancel).toHaveBeenCalled();
    expect(fixture.portLease.release).toHaveBeenCalledWith(4_173);
  });

  it("rejects blank runtime screens instead of inventing UI", async () => {
    const fixture = await adapterFixture(
      pageFixture({
        visibleTextLength: 0,
        elementCount: 0,
        errorBoundary: false,
        splashScreen: false,
      }),
    );
    const result = await executeCaptureScenario({
      adapter: fixture.adapter,
      application: applicationFixture,
      scenario: scenarioFixture,
      job: jobFixture,
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: {
        code: "BLANK_SCREEN",
        stage: "capture",
        retryable: true,
      },
    });
    if (result.kind === "failed") {
      expect(result.failure.message).toMatch(/blank/i);
    }
  });

  it.each([
    [
      "error boundary",
      {
        visibleTextLength: 12,
        elementCount: 8,
        errorBoundary: true,
        splashScreen: false,
      },
      "ERROR_BOUNDARY",
    ],
    [
      "splash screen",
      {
        visibleTextLength: 12,
        elementCount: 8,
        errorBoundary: false,
        splashScreen: true,
      },
      "SPLASH_SCREEN",
    ],
  ])("rejects a runtime %s", async (_label, evidence, code) => {
    const fixture = await adapterFixture(pageFixture(evidence));
    const result = await executeCaptureScenario({
      adapter: fixture.adapter,
      application: applicationFixture,
      scenario: scenarioFixture,
      job: jobFixture,
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: { code },
    });
  });

  it("rejects route redirects and unverified source revisions", async () => {
    const redirected = pageFixture();
    vi.mocked(redirected.url).mockReturnValue("http://127.0.0.1:4173/login");
    const redirectFixture = await adapterFixture(redirected);
    const redirectResult = await executeCaptureScenario({
      adapter: redirectFixture.adapter,
      application: applicationFixture,
      scenario: scenarioFixture,
      job: jobFixture,
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });
    expect(redirectResult).toMatchObject({
      kind: "failed",
      failure: { code: "ROUTE_MISMATCH" },
    });

    const revisionFixture = await adapterFixture();
    const revisionResult = await executeCaptureScenario({
      adapter: revisionFixture.adapter,
      application: applicationFixture,
      scenario: scenarioFixture,
      job: {
        ...jobFixture,
        repository: {
          ...jobFixture.repository,
          sourceRevision: null,
        },
      },
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });
    expect(revisionResult).toMatchObject({
      kind: "failed",
      failure: { code: "SOURCE_REVISION_MISSING", retryable: false },
    });
  });

  it.each([
    "http://evil.example/dashboard?fixture=stable",
    "http://127.0.0.1:4173/dashboard",
    "http://127.0.0.1:4173/dashboard?fixture=stable&mode=admin",
  ])("rejects same-path state mismatch at %s", async (actualUrl) => {
    const page = pageFixture();
    vi.mocked(page.url).mockReturnValue(actualUrl);
    const fixture = await adapterFixture(page);
    const result = await executeCaptureScenario({
      adapter: fixture.adapter,
      application: applicationFixture,
      scenario: {
        ...scenarioFixture,
        parameters: [{ key: "fixture", value: "stable" }],
      },
      job: jobFixture,
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });
    expect(result).toMatchObject({
      kind: "failed",
      failure: { code: "ROUTE_MISMATCH" },
    });
  });

  it("cancels in-flight Playwright navigation", async () => {
    const page = pageFixture();
    vi.mocked(page.goto).mockImplementation(() => new Promise(() => undefined));
    const fixture = await adapterFixture(page);
    const controller = new AbortController();
    const resultPromise = executeCaptureScenario({
      adapter: fixture.adapter,
      application: applicationFixture,
      scenario: scenarioFixture,
      job: jobFixture,
      signal: controller.signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });
    await vi.waitFor(() => expect(page.goto).toHaveBeenCalled());
    controller.abort();
    await expect(resultPromise).resolves.toMatchObject({
      kind: "failed",
      failure: { code: "CAPTURE_CANCELLED" },
    });
  });

  it("rejects unstable pixels", async () => {
    const page = pageFixture();
    let index = 0;
    vi.mocked(page.screenshot).mockImplementation(async () => {
      index += 1;
      return new Uint8Array([index]);
    });
    const fixture = await adapterFixture(page);
    const result = await executeCaptureScenario({
      adapter: fixture.adapter,
      application: applicationFixture,
      scenario: scenarioFixture,
      job: jobFixture,
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });
    expect(result).toMatchObject({
      kind: "failed",
      failure: { code: "UNSTABLE_FRAME", stage: "verify" },
    });
  });

  it("normalizes root routes", async () => {
    const page = pageFixture();
    vi.mocked(page.url).mockReturnValue("http://127.0.0.1:4173/");
    const fixture = await adapterFixture(page);
    const result = await executeCaptureScenario({
      adapter: fixture.adapter,
      application: applicationFixture,
      scenario: { ...scenarioFixture, route: "/" },
      job: jobFixture,
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });
    expect(result.kind).toBe("captured");
  });

  it("rejects non-loopback preview hosts", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-web-capture-"));
    expect(
      () =>
        new ReactWebCaptureAdapter({
          applications: [applicationFixture],
          artifactStore: new ContentAddressedArtifactStore(root),
          processRunner: { start: vi.fn() },
          processPolicy: {
            allowedCommands: [],
            allowedCwdRoots: [],
            sandboxEnvironment: {
              home: "/tmp/home",
              temporaryDirectory: "/tmp/temp",
              path: "",
            },
            sandbox: {
              executable: "/usr/bin/sandbox-exec",
              allowedReadRoots: ["/tmp"],
              allowedWriteRoots: ["/tmp"],
              network: "loopback",
            },
          },
          recipe: vi.fn(),
          portLease: {
            acquire: vi.fn(),
            release: vi.fn(),
          },
          browserLauncher: { launch: vi.fn() },
          waitForLoopback: vi.fn(),
          previewHost: "0.0.0.0",
        }),
    ).toThrow(/loopback/i);
  });

  it("rejects non-web and undiscovered applications", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-web-capture-"));
    const common = {
      artifactStore: new ContentAddressedArtifactStore(root),
      processRunner: { start: vi.fn() },
      processPolicy: {
        allowedCommands: [],
        allowedCwdRoots: [] as string[],
        sandboxEnvironment: {
          home: "/tmp/home",
          temporaryDirectory: "/tmp/temp",
          path: "",
        },
        sandbox: {
          executable: "/usr/bin/sandbox-exec",
          allowedReadRoots: ["/tmp"],
          allowedWriteRoots: ["/tmp"],
          network: "loopback" as const,
        },
      },
      recipe: vi.fn(),
      portLease: {
        acquire: vi.fn(),
        release: vi.fn(),
      },
      browserLauncher: { launch: vi.fn() },
      waitForLoopback: vi.fn(),
    };
    expect(
      () =>
        new ReactWebCaptureAdapter({
          ...common,
          applications: [{ ...applicationFixture, platform: "swiftui" }],
        }),
    ).toThrow(/react-web/i);

    const fixture = await adapterFixture();
    await expect(
      fixture.adapter.prepare(
        { job: jobFixture, signal: new AbortController().signal },
        { ...applicationFixture, id: "unknown" },
      ),
    ).rejects.toThrow(/not discovered/i);
  });
});
