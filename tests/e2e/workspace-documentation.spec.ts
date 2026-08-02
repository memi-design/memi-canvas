import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  expect,
  test,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "@playwright/test";

import { WorkspaceDocumentationPage } from "./pages/WorkspaceDocumentationPage";

const EVIDENCE_DIRECTORY = "dist/test-evidence/web-e2e";
const EXPECTED_ORIGIN = "http://127.0.0.1:4173";
const MAX_DOCUMENTATION_BYTES = 1_048_576;

interface ViewportEvidence {
  readonly project: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
  readonly screenCells: number;
  readonly committedCells: number;
  readonly inferredCaptures: number;
  readonly verifiedScreenshots: number;
  readonly declaredFlows: number;
  readonly declaredTokens: number;
  readonly traceEvents: number;
  readonly unexpectedExternalRequests: readonly string[];
  readonly rootOverflowPixels: number;
  readonly workspaceUiScreensView: string;
  readonly workspaceUiEvidenceView: string;
}

interface EvidenceSummary {
  readonly schemaVersion: 1;
  readonly kind: "memi-web-browser-e2e";
  readonly generatedFrom:
    "product-import -> import-runtime -> workspace-documentation";
  readonly results: readonly ViewportEvidence[];
}

interface ArtifactInterception {
  readonly cdp: CDPSession;
  readonly fulfilled: Promise<void>;
}

interface ServedDocumentation {
  readonly screens: readonly {
    readonly capture: { readonly status: string };
    readonly materialization: { readonly status: string };
  }[];
  readonly flows: readonly unknown[];
  readonly designSystem: { readonly tokens: readonly unknown[] };
  readonly trace: { readonly refs: readonly unknown[] };
  readonly coverage: {
    readonly captures: { readonly observed: number };
  };
}

async function interceptArtifactWithCdp(
  context: BrowserContext,
  page: Page,
  body: string,
  declaredLength?: number,
): Promise<ArtifactInterception> {
  const cdp = await context.newCDPSession(page);
  const fulfilled = new Promise<void>((resolve, reject) => {
    cdp.on("Fetch.requestPaused", (input) => {
      const event = input as { readonly requestId: string };
      void cdp
        .send("Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
            ...(declaredLength === undefined
              ? []
              : [
                  {
                    name: "Content-Length",
                    value: String(declaredLength),
                  },
                ]),
          ],
          body: Buffer.from(body).toString("base64"),
        })
        .then(() => resolve(), reject);
    });
  });
  await cdp.send("Fetch.enable", {
    patterns: [
      {
        urlPattern: "*workspace-documentation.json",
        requestStage: "Request",
      },
    ],
  });
  return { cdp, fulfilled };
}

function metricsFrom(
  documentation: ServedDocumentation,
): Pick<
  ViewportEvidence,
  | "screenCells"
  | "committedCells"
  | "inferredCaptures"
  | "verifiedScreenshots"
  | "declaredFlows"
  | "declaredTokens"
  | "traceEvents"
> {
  return {
    screenCells: documentation.screens.length,
    committedCells: documentation.screens.filter(
      (screen) => screen.materialization.status === "committed",
    ).length,
    inferredCaptures: documentation.screens.filter(
      (screen) => screen.capture.status === "inferred",
    ).length,
    verifiedScreenshots: documentation.coverage.captures.observed,
    declaredFlows: documentation.flows.length,
    declaredTokens: documentation.designSystem.tokens.length,
    traceEvents: documentation.trace.refs.length,
  };
}

async function saveEvidence(
  project: string,
  page: Page,
  evidence: Omit<
    ViewportEvidence,
    "workspaceUiScreensView" | "workspaceUiEvidenceView"
  >,
  workspaceUiScreensView: string,
): Promise<void> {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const workspaceUiEvidenceView = `${project}-evidence.png`;
  await page.screenshot({
    fullPage: true,
    path: join(EVIDENCE_DIRECTORY, workspaceUiEvidenceView),
  });

  const summaryPath = join(EVIDENCE_DIRECTORY, "summary.json");
  let previous: EvidenceSummary | undefined;
  try {
    previous = JSON.parse(await readFile(summaryPath, "utf8")) as EvidenceSummary;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const nextResult = {
    ...evidence,
    workspaceUiScreensView,
    workspaceUiEvidenceView,
  };
  const retained = (previous?.results ?? []).filter(
    (result) => result.project !== project,
  );
  const next: EvidenceSummary = {
    schemaVersion: 1,
    kind: "memi-web-browser-e2e",
    generatedFrom:
      "product-import -> import-runtime -> workspace-documentation",
    results: [...retained, nextResult].sort((left, right) =>
      left.project.localeCompare(right.project),
    ),
  };
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  expect(Buffer.byteLength(serialized)).toBeLessThan(16 * 1_024);
  const temporaryPath = `${summaryPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, serialized, { flag: "wx" });
  await rename(temporaryPath, summaryPath);
  const persisted = JSON.parse(
    await readFile(summaryPath, "utf8"),
  ) as EvidenceSummary;
  expect(persisted).toEqual(next);
}

test("documents the executed 18-screen product truth without fabricating visual proof", async ({
  page,
}, testInfo) => {
  const externalRequests = new Set<string>();
  const observeUrl = (input: string) => {
    const url = new URL(input);
    const expected = new URL(EXPECTED_ORIGIN);
    if (
      ["http:", "https:", "ws:", "wss:"].includes(url.protocol) &&
      (url.hostname !== expected.hostname || url.port !== expected.port)
    ) {
      externalRequests.add(url.href);
    }
  };
  page.on("request", (request) => {
    observeUrl(request.url());
  });
  page.on("websocket", (websocket) => {
    observeUrl(websocket.url());
  });

  const documentation = new WorkspaceDocumentationPage(page);
  await documentation.goto();
  const rootOverflowByView: number[] = [];
  const served = await page.evaluate(async () => {
    const response = await fetch("/workspace-documentation.json");
    if (!response.ok) {
      throw new Error(`Artifact request failed with HTTP ${response.status}.`);
    }
    return response.json() as Promise<ServedDocumentation>;
  });
  const metrics = metricsFrom(served);
  expect(metrics).toEqual({
    screenCells: 18,
    committedCells: 18,
    inferredCaptures: 18,
    verifiedScreenshots: 0,
    declaredFlows: 1,
    declaredTokens: 6,
    traceEvents: 18,
  });

  await expect(documentation.summary).toContainText("0 verified screenshots");
  await expect(documentation.summary).toContainText(
    "18 committed canvas cells",
  );
  await expect(documentation.summary).toContainText("18 inferred captures");
  await expect(documentation.cells).toHaveCount(18);
  await expect(documentation.matrix.getByRole("row")).toHaveCount(7);
  await expect(page.locator("img")).toHaveCount(0);
  for (const rowName of [
    /Home default \//u,
    /Home loading \//u,
    /Projects default \/projects/u,
    /Projects empty \/projects/u,
    /Projects error \/projects/u,
    /Settings default \/settings/u,
  ]) {
    await expect(
      documentation.matrix.getByRole("row", { name: rowName }),
    ).toBeVisible();
  }
  rootOverflowByView.push(await documentation.rootOverflowPixels());
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const workspaceUiScreensView =
    `${testInfo.project.name}-screens.png`;
  await page.screenshot({
    fullPage: true,
    path: join(EVIDENCE_DIRECTORY, workspaceUiScreensView),
  });

  const firstCell = documentation.cells.nth(0);
  const secondCell = documentation.cells.nth(1);
  const thirdCell = documentation.cells.nth(2);
  await firstCell.focus();
  await expect(firstCell).toBeFocused();
  await firstCell.press("ArrowRight");
  await expect(secondCell).toBeFocused();
  await secondCell.press("Enter");
  await expect(secondCell).toHaveAttribute("aria-pressed", "true");
  await secondCell.press("End");
  await expect(thirdCell).toBeFocused();
  await thirdCell.press("Home");
  await expect(firstCell).toBeFocused();

  await documentation.openView("Flows");
  const flows = page.getByRole("region", { name: "Flows" });
  await expect(flows.locator("article")).toHaveCount(1);
  await expect(
    flows.getByRole("heading", { name: "Primary navigation" }),
  ).toBeVisible();
  await expect(flows.getByText("Declared", { exact: true })).toBeVisible();
  await expect(flows.getByText("Not observed", { exact: true })).toBeVisible();
  const flowSteps = flows.getByRole("listitem");
  await expect(flowSteps).toHaveCount(3);
  for (const [index, step] of [
    "flow-starthome-screen-visible",
    "open-projectsprojects-screen-visible",
    "open-settingssettings-screen-visible",
  ].entries()) {
    await expect(flowSteps.nth(index)).toContainText(step);
  }
  rootOverflowByView.push(await documentation.rootOverflowPixels());

  await documentation.openView("Design system");
  const designSystem = page.getByRole("region", { name: "Design system" });
  await expect(designSystem.locator(".token-list li")).toHaveCount(6);
  const tokens = designSystem.getByRole("listitem");
  for (const [index, token] of [
    "color.canvas--color-canvas",
    "color.surface--color-surface",
    "color.foreground--color-foreground",
    "font.body--font-body",
    "space.panel--space-panel",
    "radius.control--radius-control",
  ].entries()) {
    await expect(tokens.nth(index)).toContainText(token);
  }
  await expect(
    designSystem.getByRole("heading", { name: "Components unavailable" }),
  ).toBeVisible();
  await expect(designSystem.getByText("0 available components")).toBeVisible();
  rootOverflowByView.push(await documentation.rootOverflowPixels());

  await documentation.openView("Evidence");
  const trace = page.getByRole("list", { name: "Canonical trace" });
  const traceButtons = trace.getByRole("button");
  await expect(traceButtons).toHaveCount(18);
  const secondEventId = (await traceButtons.nth(1).locator("span").innerText())
    .trim();
  await traceButtons.nth(1).click();
  await expect(documentation.selectedEvidence).toContainText(secondEventId);
  await expect(documentation.selectedEvidence).toContainText(
    "Verified screenshotUnavailable",
  );
  rootOverflowByView.push(await documentation.rootOverflowPixels());

  const rootOverflowPixels = Math.max(...rootOverflowByView);
  expect(rootOverflowPixels).toBeLessThanOrEqual(1);
  const unexpectedExternalRequests = [...externalRequests].sort();
  expect(unexpectedExternalRequests).toEqual([]);

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await saveEvidence(testInfo.project.name, page, {
    project: testInfo.project.name,
    viewport: viewport!,
    ...metrics,
    unexpectedExternalRequests,
    rootOverflowPixels,
  }, workspaceUiScreensView);
});

test("fails closed when the workspace artifact is malformed", async ({
  page,
}) => {
  await page.route("**/workspace-documentation.json", (route) =>
    route.fulfill({
      body: "{not-json",
      contentType: "application/json",
      status: 200,
    }),
  );

  await page.goto("/?view=documentation");

  await expect(
    page.getByRole("heading", { name: "Documentation unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Workspace documentation contains invalid JSON.",
  );
  await expect(
    page.getByRole("heading", { name: "Workspace documentation" }),
  ).toHaveCount(0);
});

test("fails closed when JSON is valid but violates the artifact schema", async ({
  page,
}) => {
  await page.route("**/workspace-documentation.json", (route) =>
    route.fulfill({
      body: "{}",
      contentType: "application/json",
      status: 200,
    }),
  );

  await page.goto("/?view=documentation");

  await expect(
    page.getByRole("heading", { name: "Documentation unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Workspace documentation" }),
  ).toHaveCount(0);
});

test("fails closed on a declared artifact larger than one MiB", async ({
  page,
}) => {
  const oversized = "x".repeat(MAX_DOCUMENTATION_BYTES + 1);
  await page.route("**/workspace-documentation.json", (route) =>
    route.fulfill({
      body: oversized,
      contentType: "application/json",
      headers: {
        "content-length": String(Buffer.byteLength(oversized)),
      },
      status: 200,
    }),
  );

  await page.goto("/?view=documentation");

  await expect(
    page.getByRole("heading", { name: "Documentation unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    `Workspace documentation exceeds ${MAX_DOCUMENTATION_BYTES} bytes.`,
  );
  await expect(
    page.getByRole("heading", { name: "Workspace documentation" }),
  ).toHaveCount(0);
});

test("fails closed through the streaming cap without Content-Length", async ({
  context,
  page,
}) => {
  const oversized = "x".repeat(MAX_DOCUMENTATION_BYTES + 1);
  const { cdp, fulfilled } = await interceptArtifactWithCdp(
    context,
    page,
    oversized,
  );
  const artifactResponse = page.waitForResponse((response) =>
    response.url().endsWith("/workspace-documentation.json"),
  );

  await page.goto("/?view=documentation");
  await fulfilled;

  expect(
    await (await artifactResponse).headerValue("content-length"),
  ).toBeNull();
  await expect(
    page.getByRole("heading", { name: "Documentation unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    `Workspace documentation exceeds ${MAX_DOCUMENTATION_BYTES} bytes.`,
  );
  await expect(
    page.getByRole("heading", { name: "Workspace documentation" }),
  ).toHaveCount(0);
  await cdp.send("Fetch.disable");
});

test("fails closed when Content-Length underreports an oversized body", async ({
  context,
  page,
}) => {
  const oversized = "x".repeat(MAX_DOCUMENTATION_BYTES + 1);
  const { cdp, fulfilled } = await interceptArtifactWithCdp(
    context,
    page,
    oversized,
    MAX_DOCUMENTATION_BYTES,
  );
  const artifactResponse = page.waitForResponse((response) =>
    response.url().endsWith("/workspace-documentation.json"),
  );

  await page.goto("/?view=documentation");
  await fulfilled;

  expect(
    await (await artifactResponse).headerValue("content-length"),
  ).toBe(String(MAX_DOCUMENTATION_BYTES));
  await expect(
    page.getByRole("heading", { name: "Documentation unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    `Workspace documentation exceeds ${MAX_DOCUMENTATION_BYTES} bytes.`,
  );
  await expect(
    page.getByRole("heading", { name: "Workspace documentation" }),
  ).toHaveCount(0);
  await cdp.send("Fetch.disable");
});
