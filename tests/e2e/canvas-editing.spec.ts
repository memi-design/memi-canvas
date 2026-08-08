import { expect, test, type Page } from "@playwright/test";

interface ImportCase {
  readonly componentCount: number;
  readonly harnessId: "claude-code" | "codex";
  readonly name: string;
  readonly path: string;
  readonly platform:
    | "mixed"
    | "react-native-expo"
    | "react-web"
    | "swiftui";
  readonly screenCount: number;
}

const IMPORT_CASES: readonly ImportCase[] = [
  {
    componentCount: 3,
    harnessId: "codex",
    name: "Memi Expo Fixture",
    path: "/fixtures/imports/memi-expo",
    platform: "react-native-expo",
    screenCount: 3,
  },
] as const;

async function installTruthfulRuntimeFixture(
  page: Page,
  importCases: readonly ImportCase[],
) {
  await page.addInitScript((cases) => {
    const entries = new Map(cases.map((entry) => [entry.path, entry]));
    const revision = "a".repeat(40);
    const contentHash = `sha256:${"b".repeat(64)}`;
    const idBody = (index: number) =>
      `01J${String(index).padStart(23, "0")}`;
    const runtimeStateKey = "memi-e2e-runtime-state-v1";
    type RuntimeState = {
      readonly canvasJournals: readonly [string, Record<string, unknown>][];
      readonly jobs: readonly [string, Record<string, unknown>][];
      readonly nextJob: number;
      readonly reconstructionArtifacts: readonly [string, unknown][];
    };
    const restoredState = (() => {
      try {
        const raw = sessionStorage.getItem(runtimeStateKey);
        return raw === null ? null : JSON.parse(raw) as RuntimeState;
      } catch {
        return null;
      }
    })();
    const jobs = new Map<string, Record<string, unknown>>(
      restoredState?.jobs ?? [],
    );
    const canvasJournals = new Map<string, Record<string, unknown>>(
      restoredState?.canvasJournals ?? [],
    );
    const reconstructionArtifacts = new Map<string, unknown>(
      restoredState?.reconstructionArtifacts ?? [],
    );
    let nextJob = restoredState?.nextJob ?? 1;

    function persistRuntimeState() {
      sessionStorage.setItem(
        runtimeStateKey,
        JSON.stringify({
          canvasJournals: [...canvasJournals],
          jobs: [...jobs],
          nextJob,
          reconstructionArtifacts: [...reconstructionArtifacts],
        } satisfies RuntimeState),
      );
    }

    function canvasJournalKey(identity: Record<string, unknown>) {
      return `${String(identity.projectId)}:${String(identity.documentId)}`;
    }

    function canvasJournal(snapshot: Record<string, unknown>) {
      return {
        schemaVersion: 1,
        kind: "canvas-document-v3-journal",
        identity: snapshot.identity,
        snapshot,
        operations: [],
        operationBytes: 0,
      };
    }

    function platform(entry: ImportCase) {
      if (entry.platform === "swiftui") return "swiftui";
      if (entry.platform === "react-native-expo") return "expo-ios";
      return "react-web";
    }

    function job(
      entry: ImportCase,
      state: "queued" | "ready-to-commit" | "committed",
      harness: { harnessId: string; modelId: string } | null,
      jobIndex: number,
    ) {
      const scenarios = Array.from(
        { length: entry.screenCount },
        (_, index) => ({
          id: `csc_${idBody(jobIndex * 100 + index)}`,
          applicationId: `app_${jobIndex}`,
          route: index === 0 ? "/" : `/screen-${index + 1}`,
          state: "default",
          viewport: {
            name: entry.platform === "react-web" ? "desktop" : "mobile",
            width: entry.platform === "react-web" ? 1280 : 390,
            height: entry.platform === "react-web" ? 800 : 844,
            scale: 1,
          },
          authContext: null,
          parameters: [],
          fixtureProfile: "deterministic-e2e",
          readinessSelector: "body",
          sourceAnchor: {
            relativePath:
              entry.platform === "swiftui"
                ? `App/Screen${index + 1}View.swift`
                : `src/app/screen-${index + 1}/page.tsx`,
            symbol: null,
            contentHash,
          },
        }),
      );
      const artifacts = scenarios.map((scenario, index) => {
        const artifactId = `art_${idBody(jobIndex * 200 + index)}`;
        const screenshotArtifactId =
          `art_${idBody(jobIndex * 300 + index)}`;
        const reconstructionArtifactId =
          `art_${idBody(jobIndex * 400 + index)}`;
        const hierarchyArtifactId =
          `art_${idBody(jobIndex * 500 + index)}`;
        const geometryArtifactId =
          `art_${idBody(jobIndex * 600 + index)}`;
        reconstructionArtifacts.set(reconstructionArtifactId, {
          app: {
            appVersion: "1.0.0",
            buildRevision: revision,
            environment: "simulator",
            productId: "memi-expo-fixture",
          },
          artifact: {
            alt: `${scenario.route} test fixture`,
            artifactId: screenshotArtifactId,
            hash: contentHash,
            height: scenario.viewport.height,
            kind: "image/png",
            src: `/imports/artifacts/${screenshotArtifactId}.png`,
            width: scenario.viewport.width,
          },
          authority: "local_capture",
          binding: {
            coverageCellId: `memi-expo-${index}`,
            normalizedPath: scenario.route,
            routeId: scenario.route,
            sourceAnchor: scenario.sourceAnchor.relativePath,
            sourceContentHash: contentHash,
            stateId: scenario.state,
            viewport: {
              height: scenario.viewport.height,
              name: "mobile",
              scale: 1,
              width: scenario.viewport.width,
            },
          },
          captureId: artifactId,
          capturedAt: "2026-07-29T12:00:00.000Z",
          evidence: {
            captureMethod: "ios-simulator-screenshot",
            label: "Local capture",
            truthLabel: "Local capture",
          },
          layers: [
            {
              content: { text: `Screen ${index + 1} title` },
              geometry: { height: 28, width: 260, x: 24, y: 48 },
              kind: "text",
              layerId: `screen-${index + 1}-title`,
              name: `Screen ${index + 1} title`,
              semanticKey: `screen-${index + 1}.title`,
              source: {
                astPath: ["Screen", "Title"],
                atomicLevel: "atom",
                range: { end: 80, start: 24 },
                sourceAnchor: `${scenario.sourceAnchor.relativePath}#ScreenTitle`,
                sourceContentHash: contentHash,
              },
              style: {
                fontSize: 22,
                fontWeight: 500,
                textColor: "oklch(0.98 0 0)",
              },
              zIndex: 1,
            },
          ],
          repository: {
            dirty: false,
            dirtyFileFingerprint: contentHash,
            revision,
            rootPath: entry.path,
            sourceFingerprint: contentHash,
          },
          schemaVersion: 1,
          screenId: `screen-${index + 1}`,
          screenName: `Screen ${index + 1}`,
        });
        return {
          id: artifactId,
          scenarioId: scenario.id,
          screenshotArtifactId,
          hierarchyArtifactId,
          geometryArtifactId,
          reconstructionArtifactId,
          screenshotHash: contentHash,
          sourceRevision: revision,
          fixtureFingerprint: contentHash,
          dimensions: {
            width: scenario.viewport.width,
            height: scenario.viewport.height,
            scale: 1,
          },
          verification: {
            stableFrameHash: contentHash,
            routeMatched: true,
            blankRejected: true,
            splashRejected: true,
            errorBoundaryRejected: true,
            verifiedAt: "2026-07-29T12:00:00.000Z",
          },
        };
      });
      return {
        kind: "memi-import-job",
        id: `imp_${idBody(jobIndex)}`,
        projectId:
          state === "committed"
            ? `prj_${idBody(jobIndex)}`
            : null,
        projectName: entry.name,
        state,
        stage: state === "queued" ? "validate" : "save",
        repository: {
          rootPath: entry.path,
          sourceRevision: revision,
          dirtyFingerprint: contentHash,
        },
        managedWorktreeId: null,
        selectedHarness: harness,
        applications: [
          {
            id: `app_${jobIndex}`,
            label: entry.name,
            platform: platform(entry),
            relativeRoot: ".",
          },
        ],
        scenarios,
        artifacts: state === "queued" ? [] : artifacts,
        failures: [],
        progress:
          state === "queued"
            ? {
                captured: 0,
                failed: 0,
                remaining: entry.screenCount,
                total: entry.screenCount,
              }
            : {
                captured: entry.screenCount,
                failed: 0,
                remaining: 0,
                total: entry.screenCount,
              },
        currentApplicationId: null,
        currentScenarioId: null,
        cancellationRequestedAt: null,
        checkpoints: state === "queued" ? [] : ["capture", "verify", "save"],
        logs: [],
        revision:
          state === "queued" ? 1 : state === "ready-to-commit" ? 2 : 3,
        createdAt: "2026-07-29T12:00:00.000Z",
        updatedAt: "2026-07-29T12:00:00.000Z",
      };
    }

    Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (
          command: string,
          args?: Record<string, unknown>,
        ) => {
          if (command === "runtime_session") {
            return {
              token: "e2e-private-runtime-token-with-at-least-32-bytes",
            };
          }
          if (command === "runtime_artifact") {
            const artifactId = String(args?.artifactId ?? "");
            const artifact = reconstructionArtifacts.get(artifactId);
            if (artifact === undefined) throw new Error("Unknown artifact");
            return {
              artifactId,
              mimeType: "application/json",
              bytes: Array.from(
                new TextEncoder().encode(JSON.stringify(artifact)),
              ),
            };
          }
          if (command !== "runtime_rpc") return null;
          const envelope = args?.envelope as {
            requestId: string;
            correlationId: string;
            method: string;
            payload: Record<string, unknown>;
          };
          let result: Record<string, unknown>;
          if (envelope.method.startsWith("canvasDocuments.")) {
            const payload = envelope.payload;
            if (envelope.method === "canvasDocuments.load") {
              const identity = payload.identity as Record<string, unknown>;
              result = {
                journal:
                  canvasJournals.get(canvasJournalKey(identity)) ?? null,
              };
            } else if (envelope.method === "canvasDocuments.open") {
              const snapshot = payload.snapshot as Record<string, unknown>;
              const key = canvasJournalKey(
                snapshot.identity as Record<string, unknown>,
              );
              const existing = canvasJournals.get(key);
              const journal = existing ?? canvasJournal(snapshot);
              canvasJournals.set(key, journal);
              persistRuntimeState();
              result = { initialized: existing === undefined, journal };
            } else if (envelope.method === "canvasDocuments.initialize") {
              const snapshot = payload.snapshot as Record<string, unknown>;
              const journal = canvasJournal(snapshot);
              canvasJournals.set(
                canvasJournalKey(snapshot.identity as Record<string, unknown>),
                journal,
              );
              persistRuntimeState();
              result = { journal };
            } else if (envelope.method === "canvasDocuments.append") {
              const append = payload.append as Record<string, unknown>;
              const identity = append.identity as Record<string, unknown>;
              const key = canvasJournalKey(identity);
              const current = canvasJournals.get(key);
              if (current === undefined) {
                throw new Error("Canvas V3 journal is not initialized.");
              }
              const operation = append.operation as Record<string, unknown>;
              const operations = [
                ...(current.operations as readonly unknown[]),
                operation,
              ];
              const next = {
                ...current,
                operations,
                operationBytes: operations.reduce(
                  (total, candidate) =>
                    total +
                    new TextEncoder().encode(JSON.stringify(candidate))
                      .byteLength,
                  0,
                ),
              };
              canvasJournals.set(key, next);
              persistRuntimeState();
              result = {
                receipt: {
                  schemaVersion: 1,
                  identity,
                  operationId: operation.id,
                  revision: Number(operation.expectedRevision) + 1,
                  stateHash: operation.resultingHash,
                },
              };
            } else if (envelope.method === "canvasDocuments.checkpoint") {
              const snapshot = payload.snapshot as Record<string, unknown>;
              const key = canvasJournalKey(
                snapshot.identity as Record<string, unknown>,
              );
              if (!canvasJournals.has(key)) {
                throw new Error("Canvas V3 journal is not initialized.");
              }
              const journal = canvasJournal(snapshot);
              canvasJournals.set(key, journal);
              persistRuntimeState();
              result = { journal };
            } else {
              throw new Error(`Unsupported CanvasDocumentV3 method: ${envelope.method}`);
            }
            return {
              schemaVersion: 1,
              requestId: envelope.requestId,
              correlationId: envelope.correlationId,
              method: envelope.method,
              receivedAt: "2026-07-29T12:00:00.000Z",
              ok: true,
              result,
            };
          }
          const entry = entries.get(
            String(envelope.payload.repositoryPath ?? ""),
          );
          if (envelope.method === "imports.purgeAll") {
            jobs.clear();
            reconstructionArtifacts.clear();
            canvasJournals.clear();
            nextJob = 1;
            persistRuntimeState();
            result = {
              complete: true,
              counts: {
                artifacts: 0,
                jobs: 0,
                managedWorktrees: 0,
                pendingPlans: 0,
                plans: 0,
                projectBindings: 0,
                simulatorAuthorities: 0,
              },
              failures: [],
            };
          } else if (envelope.method === "imports.plan") {
            if (entry === undefined) throw new Error("Unknown repository");
            result = {
              plan: {
                token: `ipl_${idBody(nextJob)}`,
                repository: {
                  rootPath: entry.path,
                  sourceRevision: revision,
                  dirtyFingerprint: contentHash,
                },
                applications: [
                  {
                    id: `app_${nextJob}`,
                    label: entry.name,
                    platform: platform(entry),
                    relativeRoot: ".",
                  },
                ],
                scenarios: Array.from(
                  { length: entry.screenCount },
                  (_, scenarioIndex) => ({
                    id: `csc_${idBody(nextJob * 100 + scenarioIndex)}`,
                    applicationId: `app_${nextJob}`,
                    route:
                      scenarioIndex === 0
                        ? "/"
                        : `/screen-${scenarioIndex + 1}`,
                    state: "default",
                    viewport: {
                      name:
                        entry.platform === "react-web"
                          ? "desktop"
                          : "mobile",
                      width: entry.platform === "react-web" ? 1280 : 390,
                      height: entry.platform === "react-web" ? 800 : 844,
                      scale: 1,
                    },
                    sourceAnchor: {
                      relativePath:
                        entry.platform === "swiftui"
                          ? `App/Screen${scenarioIndex + 1}View.swift`
                          : `src/app/screen-${scenarioIndex + 1}/page.tsx`,
                      symbol: null,
                      contentHash,
                    },
                  }),
                ),
                recipes: [
                  {
                    applicationId: `app_${nextJob}`,
                    applicationLabel: entry.name,
                    adapterId: `${platform(entry)}-e2e`,
                    adapterVersion: "1",
                    executable:
                      entry.platform === "swiftui" ? "xcodebuild" : "npm",
                    resolvedExecutable:
                      entry.platform === "swiftui"
                        ? "/usr/bin/xcodebuild"
                        : "/usr/local/bin/npm",
                    args:
                      entry.platform === "swiftui"
                        ? ["-scheme", entry.name, "build"]
                        : ["run", "dev"],
                    cwd: entry.path,
                    purpose:
                      entry.platform === "swiftui" ? "build" : "launch",
                    hash: contentHash,
                    // Keep the deterministic fixture valid independently of
                    // the wall-clock date on CI runners.
                    expiresAt: "2099-01-01T00:00:00.000Z",
                  },
                ],
                inventory: {
                  fileCount: entry.screenCount,
                  screenCount: entry.screenCount,
                  componentCount: 0,
                  tokenCount: 0,
                  screens: Array.from(
                    { length: entry.screenCount },
                    (_, screenIndex) => ({
                      id: `screen-${screenIndex + 1}`,
                      name: `Screen ${screenIndex + 1}`,
                      route:
                        screenIndex === 0
                          ? "/"
                          : `/screen-${screenIndex + 1}`,
                      sourcePath:
                        entry.platform === "swiftui"
                          ? `App/Screen${screenIndex + 1}View.swift`
                          : `src/app/screen-${screenIndex + 1}/page.tsx`,
                    }),
                  ),
                  components: [],
                  tokens: [],
                  truncated: {
                    screens: false,
                    components: false,
                    tokens: false,
                  },
                },
                scenarioCount: entry.screenCount,
                errors: [],
              },
            };
          } else if (envelope.method === "imports.start") {
            if (entry === undefined) throw new Error("Unknown repository");
            const index = nextJob++;
            const created = job(
              { ...entry, name: String(envelope.payload.projectName) },
              "queued",
              envelope.payload.selectedHarness as {
                harnessId: string;
                modelId: string;
              },
              index,
            );
            jobs.set(String(created.id), created);
            persistRuntimeState();
            result = { job: created };
          } else {
            const jobId = String(envelope.payload.jobId);
            const current = jobs.get(jobId);
            if (current === undefined) throw new Error("Unknown job");
            const entryForJob = cases.find(
              ({ path }) =>
                path ===
                (current.repository as { rootPath: string }).rootPath,
            )!;
            if (envelope.method === "imports.get") {
              const ready = job(
                { ...entryForJob, name: String(current.projectName) },
                "ready-to-commit",
                current.selectedHarness as {
                  harnessId: string;
                  modelId: string;
                },
                Number(jobId.slice(-1)),
              );
              jobs.set(jobId, ready);
              persistRuntimeState();
              result = { job: ready };
            } else if (envelope.method === "imports.commit") {
              const committed = {
                ...current,
                state: "committed",
                projectId: `prj_${jobId.slice(4)}`,
                revision: Number(current.revision) + 1,
              };
              jobs.set(jobId, committed);
              persistRuntimeState();
              result = { job: committed };
            } else {
              result = { job: current };
            }
          }
          return {
            schemaVersion: 1,
            requestId: envelope.requestId,
            correlationId: envelope.correlationId,
            method: envelope.method,
            receivedAt: "2026-07-29T12:00:00.000Z",
            ok: true,
            result,
          };
        },
      },
    });
  }, importCases);
  await page.route("**/imports/artifacts/*.png", async (route) => {
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+5i3L1AAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
  });
}

async function importRepository(page: Page, entry: ImportCase) {
  await page.getByRole("button", { name: "Import project" }).click();
  const dialog = page.getByRole("dialog", { name: "Import repository" });
  await dialog.getByLabel("Repository folder").fill(entry.path);
  await dialog
    .getByRole("button", { name: "Import repository" })
    .click();
  await expect(
    dialog.getByText(`${entry.screenCount} runtime scenarios`),
  ).toBeVisible();
  await dialog.getByLabel("Project name").fill(entry.name);
  await dialog
    .getByLabel("Approve the reviewed recipes")
    .check();
  await dialog
    .getByRole("button", { name: "Start verified import" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: entry.name }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Infinite canvas" }),
  ).toBeVisible();
  await page.getByLabel("Agent harness").selectOption(entry.harnessId);
}

test("materializes an editable Expo reconstruction through one user flow", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Repository authoring is verified at the desktop editor breakpoint.",
  );
  await installTruthfulRuntimeFixture(page, IMPORT_CASES);
  await page.goto("/?runtime=demo");
  await expect(page.getByText("No projects yet")).toBeVisible();

  for (const entry of IMPORT_CASES) {
    await importRepository(page, entry);
    await expect(page.getByLabel("Agent harness")).toHaveValue(
      entry.harnessId,
    );
    await page.getByRole("button", { name: "Back to projects" }).click();
  }

  for (const entry of IMPORT_CASES) {
    await expect(
      page.getByRole("button", {
        name: new RegExp(`Open ${entry.name}`, "iu"),
      }),
    ).toBeVisible();
  }
  await page.reload();
  for (const entry of IMPORT_CASES) {
    const project = page.getByRole("button", {
      name: new RegExp(`Open ${entry.name}`, "iu"),
    });
    await expect(project).toBeVisible();
    await project.click();
    await expect(
      page.getByRole("heading", { level: 1, name: entry.name }),
    ).toBeVisible();
    await expect(
      page.getByRole("treeitem", { name: "Screen 1 title Text" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to projects" }).click();
  }
});

test("creates and groups shapes without any product fixture", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Direct manipulation is verified in the desktop editor.",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Create design project" }).click();
  const canvas = page.getByRole("region", { name: "Infinite canvas" });

  await page.getByRole("button", { name: "Rectangle tool" }).click();
  await canvas.click({ position: { x: 640, y: 300 } });
  await page.getByRole("button", { name: "Ellipse tool" }).click();
  await canvas.click({ position: { x: 820, y: 300 } });

  const rectangle = page.getByRole("button", {
    name: "Rectangle 1 on canvas",
  });
  const ellipse = page.getByRole("button", {
    name: "Ellipse 1 on canvas",
  });
  await expect(rectangle).toHaveText("");
  const rectangleTag = page.getByTestId(/^canvas-node-tag-/);
  await expect(rectangleTag).toHaveText("Ellipse 1");
  await expect(rectangleTag).toHaveAttribute("data-artwork", "false");
  await expect(rectangleTag).toHaveAttribute(
    "data-source-binding",
    "canvas-only",
  );
  await expect(canvas).toHaveCSS(
    "--canvas-grid-line-opacity",
    "2.5%",
  );

  await rectangle.click({ button: "right" });
  const copyMenu = page.getByRole("menu", { name: "Canvas selection actions" });
  await copyMenu.getByRole("menuitem", { name: /^Copy/u }).click();
  await rectangle.click({ button: "right" });
  const pasteMenu = page.getByRole("menu", { name: "Canvas selection actions" });
  await pasteMenu.getByRole("menuitem", { name: "Paste at cursor" }).click();
  const pastedRectangle = page.getByRole("button", {
    name: "Rectangle 1 copy on canvas",
  });
  await expect(pastedRectangle).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(pastedRectangle).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(pastedRectangle).toBeVisible();
  await pastedRectangle.click();
  await page.getByRole("button", { name: "Delete selection" }).click();
  await expect(pastedRectangle).toHaveCount(0);

  // The command route must share the same session-first V3 paste action as
  // the context menu; Helium may deny custom system clipboard reads.
  await rectangle.click();
  await page.keyboard.press("Meta+c");
  await page.keyboard.press("Meta+v");
  await expect(pastedRectangle).toBeVisible();
  await pastedRectangle.click();
  await page.getByRole("button", { name: "Delete selection" }).click();
  await expect(pastedRectangle).toHaveCount(0);

  await rectangle.click();
  await ellipse.click({ modifiers: ["Shift"] });
  await expect(canvas).toHaveAttribute("data-selection-count", "2");
  await page.keyboard.press("Meta+g");
  const group = page.getByRole("button", { name: "Group 1 on canvas" });
  await expect(group).toBeVisible();
  await group.click({ button: "right" });
  await page
    .getByRole("menu", { name: "Canvas selection actions" })
    .getByRole("menuitem", { name: "Ungroup" })
    .click();
  await expect(group).toHaveCount(0);
  await page.keyboard.press("Alt+Meta+k");
  const component = page.getByRole("button", { name: "Component 1 on canvas" });
  await expect(component).toBeVisible();

  const cameraBefore = await canvas.getAttribute("data-camera-y");
  await canvas.hover({ position: { x: 720, y: 500 } });
  await page.mouse.wheel(24, 48);
  await expect(canvas).not.toHaveAttribute(
    "data-camera-y",
    cameraBefore ?? "",
  );
});

test("authors a rectangle appearance through the inspector", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Professional property authoring is verified at the desktop editor breakpoint.",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Create design project" }).click();
  const canvas = page.getByRole("region", { name: "Infinite canvas" });
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  await canvas.click({ position: { x: 640, y: 300 } });

  await page.getByLabel("Rotation").fill("12");
  await page.getByLabel("Opacity").fill("72");
  await page.getByLabel("Corner radius").fill("16");
  await page.getByLabel("Fill color").fill("#ff5470");
  await page.getByLabel("Stroke color").fill("#111111");
  await page.getByLabel("Stroke weight").fill("3");

  const rectangle = page.getByRole("button", {
    name: "Rectangle 1 on canvas",
  });
  const node = rectangle.locator("xpath=..");
  await expect(node).toHaveCSS("transform", /matrix/);
  await expect(node).toHaveCSS("opacity", "0.72");
  await expect(rectangle).toHaveCSS("background-color", "rgb(255, 84, 112)");
  await expect(rectangle).toHaveCSS("border-radius", "16px");
  await expect(rectangle).toHaveCSS("border-color", "rgb(17, 17, 17)");
  await expect(rectangle).toHaveCSS("border-width", "3px");

});

test("sends imported selection context through the chosen harness", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The agent collaboration loop is a desktop authoring surface.",
  );
  const fixture = IMPORT_CASES[0]!;
  await installTruthfulRuntimeFixture(page, [fixture]);
  await page.goto("/?runtime=demo");
  await importRepository(page, fixture);

  // The prompt must carry a real editable reconstruction node, not an
  // immutable screenshot/reference frame. This is the user-visible proof
  // that imported semantic layers can participate in the agent workflow.
  await page
    .getByRole("treeitem", { name: "Screen 1 title Text" })
    .click();
  await expect(page.getByText("Screen 1 title").first()).toBeVisible();

  const toolbar = page.getByRole("toolbar", {
    name: "Agent configuration",
  });
  const prompt = page.getByRole("textbox", { name: "Prompt" });
  await expect(toolbar).toBeVisible();
  expect(
    await toolbar.evaluate(
      (element, promptElement) =>
        Boolean(
          element.compareDocumentPosition(promptElement) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      await prompt.elementHandle(),
    ),
  ).toBe(true);
  await page.getByRole("textbox", { name: "Prompt" }).fill(
    "Read this imported screen and propose the smallest layout improvement",
  );
  await page.getByRole("button", { name: "Submit prompt" }).click();
  const thread = page.getByRole("region", {
    name: "Collaboration thread",
  });
  await expect(thread).toContainText("Waiting for approval", {
    timeout: 5_000,
  });
  await expect(page.getByRole("log", { name: "Trace" })).toContainText(
    "Submitted plan to connected runtime",
  );
  await page.reload();
  await expect(page.getByLabel("Agent harness")).toHaveValue(
    fixture.harnessId,
  );
});
