import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ImportJobSnapshotSchemaV2,
  ImportPlanResultSchemaV1,
  WorkspaceSessionSnapshotSchemaV1,
} from "@memi/protocol";

import { MemiApp } from "./MemiApp.js";
import { whiteboardDocumentKey } from "./whiteboard/whiteboard-persistence.js";
import {
  createProjectLibraryPersistence,
  createProjectLibraryState,
} from "./projects/project-library.js";
import { TRUTHFUL_IMPORT_RESET_KEY } from "./projects/project-purge.js";
import type { RuntimeClientV1 } from "./runtime/runtime-client.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    get length() {
      return values.size;
    },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const figmaExport = JSON.stringify({
  name: "Checkout system",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [
      {
        id: "1:1",
        name: "Checkout",
        type: "CANVAS",
        children: [
          {
            id: "2:1",
            name: "Checkout / Mobile",
            type: "FRAME",
            absoluteBoundingBox: {
              x: 40,
              y: 60,
              width: 390,
              height: 844,
            },
          },
        ],
      },
    ],
  },
});

const importRevision = "a".repeat(40);
const importRecipeHash = `sha256:${"b".repeat(64)}` as const;

function importPlanFor(
  rootPath: string,
  applicationId: string,
  label: string,
  token: string,
) {
  return ImportPlanResultSchemaV1.parse({
    plan: {
      token,
      repository: {
        dirtyFingerprint: null,
        rootPath,
        sourceRevision: importRevision,
      },
      applications: [
        {
          id: applicationId,
          label,
          platform: "react-web",
          relativeRoot: ".",
        },
      ],
      scenarios: [],
      recipes: [
        {
          applicationId,
          applicationLabel: label,
          adapterId: "react-web",
          adapterVersion: "1",
          executable: "npm",
          resolvedExecutable: "/usr/local/bin/npm",
          args: ["run", "dev"],
          cwd: rootPath,
          purpose: "launch",
          hash: importRecipeHash,
          expiresAt: "2026-08-01T12:00:00.000Z",
        },
      ],
      inventory: {
        fileCount: 1,
        screenCount: 0,
        componentCount: 0,
        tokenCount: 0,
        screens: [],
        components: [],
        tokens: [],
        truncated: {
          screens: false,
          components: false,
          tokens: false,
        },
      },
      scenarioCount: 0,
      errors: [],
    },
  }).plan;
}

function importJobFor({
  applicationId,
  id,
  label,
  revision,
  rootPath,
  state,
}: {
  readonly applicationId: string;
  readonly id: string;
  readonly label: string;
  readonly revision: number;
  readonly rootPath: string;
  readonly state: "running" | "cancelled";
}) {
  return ImportJobSnapshotSchemaV2.parse({
    applications: [
      {
        id: applicationId,
        label,
        platform: "react-web",
        relativeRoot: ".",
      },
    ],
    artifacts: [],
    cancellationRequestedAt:
      state === "cancelled" ? "2026-07-31T12:00:01.000Z" : null,
    checkpoints: ["validate", "inventory", "plan"],
    createdAt: "2026-07-31T12:00:00.000Z",
    currentApplicationId: applicationId,
    currentScenarioId: null,
    failures: [],
    id,
    kind: "memi-import-job",
    logs: [],
    managedWorktreeId: null,
    progress: { captured: 0, failed: 0, remaining: 0, total: 0 },
    projectId: null,
    projectName: label,
    repository: {
      dirtyFingerprint: null,
      rootPath,
      sourceRevision: importRevision,
    },
    revision,
    scenarios: [],
    selectedHarness: null,
    stage: "build",
    state,
    updatedAt:
      state === "cancelled"
        ? "2026-07-31T12:00:01.000Z"
        : "2026-07-31T12:00:00.000Z",
  });
}

describe("Memi application journey", () => {
  it("binds local design sessions to the authenticated runtime client", async () => {
    const restore = vi.fn(async () => ({ session: null }));
    const migrateLegacy = vi.fn(async () => ({
      status: "already-migrated" as const,
      session: null,
    }));
    const save = vi.fn(async (payload) => ({
      session: WorkspaceSessionSnapshotSchemaV1.parse({
        ...payload.session,
        sessionRevision: 1,
        updatedAt: "2026-07-31T12:00:01.000Z",
      }),
    }));
    const runtimeClient = {
      canvasDocuments: {} as RuntimeClientV1["canvasDocuments"],
      sessions: { migrateLegacy, restore, save },
    } as Pick<RuntimeClientV1, "sessions" | "canvasDocuments">;

    render(
      <MemiApp
        idFactory={() => "runtime-local-design"}
        now={() => "2026-07-31T12:00:00.000Z"}
        runtimeClient={runtimeClient}
        storage={memoryStorage()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Create design project" }),
    );
    expect(
      screen.getByRole("status", { name: "Restoring workspace session" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith({
        projectId: expect.stringMatching(/^prj_[0-9A-HJKMNP-TV-Z]{26}$/u),
        documentId: "document-local-runtime-local-design",
      });
    });
  });

  it("shows a durable repository draft as syncing while capture is in progress", () => {
    const storage = memoryStorage();
    storage.setItem(TRUTHFUL_IMPORT_RESET_KEY, "complete");
    createProjectLibraryPersistence(storage).save(
      createProjectLibraryState([
        {
          id: "active-import",
          name: "Active import",
          kind: "design",
          documentRef: "canvas:active-import",
          source: {
            kind: "repository",
            label: "team/active-import",
            rootPath: "/Projects/active-import",
            platform: "react-web",
            harnessId: "deterministic-import",
            fileCount: 10,
            screenCount: 3,
            componentCount: 4,
          },
          lifecycle: "importing",
          updatedAt: "2026-07-31T12:00:00.000Z",
          archived: false,
        },
      ]),
    );

    render(<MemiApp storage={storage} />);

    expect(screen.getByText("Syncing")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /Open Active import, design, Syncing/u,
      }),
    ).toBeTruthy();
  });

  it("hydrates a committed native import from the authenticated runtime on restart", async () => {
    const storage = memoryStorage();
    storage.setItem(TRUTHFUL_IMPORT_RESET_KEY, "complete");
    const committed = ImportJobSnapshotSchemaV2.parse({
      kind: "memi-import-job",
      id: "imp_01J00000000000000000000000",
      projectId: "prj_01J00000000000000000000000",
      projectName: "Buzzr pilot",
      state: "committed",
      stage: "save",
      repository: {
        rootPath: "/Projects/Buzzr",
        sourceRevision: importRevision,
        dirtyFingerprint: null,
      },
      managedWorktreeId: null,
      selectedHarness: null,
      applications: [{
        id: "app_01J00000000000000000000000",
        label: "buzzr",
        platform: "expo-ios",
        relativeRoot: ".",
      }],
      scenarios: [],
      artifacts: [],
      failures: [],
      progress: { total: 0, captured: 0, failed: 0, remaining: 0 },
      currentApplicationId: null,
      currentScenarioId: null,
      checkpoints: ["validate", "inventory", "plan", "prepare-fixtures", "build", "launch", "capture", "extract-layers", "verify", "save"],
      logs: [],
      cancellationRequestedAt: null,
      createdAt: "2026-08-01T15:31:35.148Z",
      revision: 14,
      updatedAt: "2026-08-01T15:56:56.684Z",
    });
    const listedCommitted = {
      id: committed.id,
      projectId: committed.projectId,
      projectName: committed.projectName,
      state: committed.state,
      stage: committed.stage,
      sourceRevision: committed.repository.sourceRevision,
      progress: committed.progress,
      currentApplicationId: committed.currentApplicationId,
      currentScenarioId: committed.currentScenarioId,
      failureCount: committed.failures.length,
      revision: committed.revision,
      updatedAt: committed.updatedAt,
    };
    const list = vi.fn(async () => ({ jobs: [listedCommitted] }));
    const get = vi.fn(async () => ({ job: committed }));
    const runtimeClient = {
      canvasDocuments: {} as RuntimeClientV1["canvasDocuments"],
      imports: { get, list },
      sessions: {},
    } as unknown as Pick<RuntimeClientV1, "sessions" | "canvasDocuments"> &
      Partial<Pick<RuntimeClientV1, "imports">>;

    render(
      <MemiApp runtimeClient={runtimeClient} storage={storage} />,
    );

    expect(
      await screen.findByRole("button", { name: /Open Buzzr pilot/u }),
    ).toBeTruthy();
    expect(list).toHaveBeenCalledWith();
    expect(get).toHaveBeenCalledWith({ jobId: committed.id });
    expect(
      storage.values.has(
        "memi.repository-project.v1:prj_01J00000000000000000000000",
      ),
    ).toBe(true);
  });


  it("starts as a generic empty design workspace without a product fixture", () => {
    render(
      <MemiApp
        idFactory={() => "unused"}
        now={() => "2026-07-28T22:00:00.000Z"}
        storage={memoryStorage()}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Recent work" }),
    ).toBeTruthy();
    expect(screen.getByText("No projects yet")).toBeTruthy();
    expect(screen.queryByText(/Buzzr/iu)).toBeNull();
  });

  it("runs the reset once and preserves projects created afterward", () => {
    const storage = memoryStorage();
    createProjectLibraryPersistence(storage).save(
      createProjectLibraryState([
        {
          id: "legacy-project",
          name: "Legacy project",
          kind: "design",
          documentRef: "canvas:legacy-project",
          source: { kind: "local", label: "Local file" },
          updatedAt: "2026-07-28T21:00:00.000Z",
          archived: false,
        },
      ]),
    );
    storage.setItem(
      "memi.canvas.autosave.v1:orphaned-document",
      "orphaned autosave",
    );

    const first = render(
      <MemiApp
        idFactory={() => "created-after-reset"}
        now={() => "2026-07-28T22:00:00.000Z"}
        storage={storage}
      />,
    );

    expect(screen.getByText("No projects yet")).toBeTruthy();
    expect(storage.values.get(TRUTHFUL_IMPORT_RESET_KEY)).toBe("complete");
    expect(
      storage.values.has("memi.canvas.autosave.v1:orphaned-document"),
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Create design project" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Back to projects" }),
    );
    first.unmount();

    render(
      <MemiApp
        idFactory={() => "unused"}
        now={() => "2026-07-28T22:01:00.000Z"}
        storage={storage}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Open Untitled design 1/ }),
    ).toBeTruthy();
    expect(screen.queryByText("Legacy project")).toBeNull();
  });

  it("blocks the workspace and preserves legacy state until native cleanup is complete", () => {
    const storage = memoryStorage();
    createProjectLibraryPersistence(storage).save(
      createProjectLibraryState([
        {
          id: "legacy-project",
          name: "Legacy project",
          kind: "design",
          documentRef: "canvas:legacy-project",
          source: { kind: "local", label: "Local file" },
          updatedAt: "2026-07-28T21:00:00.000Z",
          archived: false,
        },
      ]),
    );
    const before = storage.getItem("memi.project-library.v1");

    render(
      <MemiApp
        storage={storage}
        truthfulImportResetReady={false}
      />,
    );

    expect(
      screen.getByRole("alert", { name: "Workspace recovery required" }),
    ).toBeTruthy();
    expect(screen.getByText("Workspace unavailable")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Create design project" }),
    ).toBeNull();
    expect(screen.queryByText("Legacy project")).toBeNull();
    expect(storage.values.has(TRUTHFUL_IMPORT_RESET_KEY)).toBe(false);
    expect(storage.getItem("memi.project-library.v1")).toBe(before);
  });

  it("fails closed when the local reset completion marker cannot be persisted", () => {
    const storage = memoryStorage();
    const setItem = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === TRUTHFUL_IMPORT_RESET_KEY) {
        throw new Error("quota unavailable");
      }
      setItem(key, value);
    };

    render(<MemiApp storage={storage} />);

    expect(
      screen.getByRole("alert", { name: "Workspace recovery required" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Create design project" }),
    ).toBeNull();
  });

  it("creates separate editable design and whiteboard files", () => {
    const projectIds = ["local-design-one", "local-board-one"];
    const storage = memoryStorage();
    render(
      <MemiApp
        idFactory={() => projectIds.shift() ?? "fallback"}
        now={() => "2026-07-28T22:05:00.000Z"}
        storage={storage}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Create design project" }),
    );
    expect(
      screen.getByRole("heading", { name: "Untitled design 1" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Infinite canvas" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Back to projects" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create whiteboard project" }),
    );
    expect(
      screen.getByRole("region", { name: "Memi whiteboard" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Back to projects" }),
    ).toBeTruthy();
  });

  it("permanently deletes a project and its owned canvas recovery", () => {
    const storage = memoryStorage();
    render(
      <MemiApp
        idFactory={() => "delete-me"}
        now={() => "2026-07-28T22:05:00.000Z"}
        storage={storage}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Create design project" }),
    );
    storage.setItem(
      "memi.canvas.autosave.v1:document-local-delete-me",
      "owned autosave",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Back to projects" }),
    );
    fireEvent.contextMenu(
      screen.getByRole("button", { name: /Open Untitled design 1/ }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Delete permanently" }),
    );

    expect(screen.getByText("No projects yet")).toBeTruthy();
    expect(
      storage.values.has(
        "memi.canvas.autosave.v1:document-local-delete-me",
      ),
    ).toBe(false);
    expect(storage.values.get("memi.project-library.v1")).toContain(
      '"projects":[]',
    );
  });

  it("imports a bounded local Figma export into an editable durable canvas", () => {
    const storage = memoryStorage();
    render(
      <MemiApp
        idFactory={() => "figma-checkout"}
        now={() => "2026-07-28T22:04:00.000Z"}
        storage={storage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Import from Figma" }));
    fireEvent.click(
      screen.getByRole("tab", { name: "Local JSON export" }),
    );
    fireEvent.change(screen.getByLabelText("Figma JSON export"), {
      target: { value: figmaExport },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Import local Figma JSON" }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Checkout system" }),
    ).toBeTruthy();
    expect(screen.getByText(/changes are temporary/u)).toBeTruthy();
    expect(storage.values.has("memi.project-library.v1")).toBe(true);
    expect(
      [...storage.values.keys()].some((key) =>
        key.startsWith("memi.canvas.autosave.v1:"),
      ),
    ).toBe(true);
  });

  it("streams an importing project before opening its editable runtime reconstruction", async () => {
    const storage = memoryStorage();
    const revision = "a".repeat(40);
    const hash = `sha256:${"b".repeat(64)}`;
    const importer = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      projectName: "Northstar",
      rootPath: "/Projects/northstar",
      revision,
      remote: "https://example.com/team/northstar.git",
      platform: "react-web",
      dirty: false,
      files: [],
      screens: [
        {
          id: "home",
          name: "Home",
          sourcePath: "src/pages/Home.tsx",
          route: "/",
        },
      ],
      components: [],
      tokens: [],
    });
    const terminalJob = ImportJobSnapshotSchemaV2.parse({
      applications: [
        {
          id: "northstar-web",
          label: "Northstar web",
          platform: "react-web" as const,
          relativeRoot: "." as const,
        },
      ],
      artifacts: [
        {
          dimensions: { height: 800, scale: 1, width: 1280 },
          fixtureFingerprint: hash,
          geometryArtifactId: null,
          hierarchyArtifactId: null,
          id: "art_01J00000000000000000000000",
          scenarioId: "csc_01J00000000000000000000000",
          screenshotArtifactId: "art_01J00000000000000000000000",
          screenshotHash: hash,
          sourceRevision: revision,
          verification: {
            blankRejected: true as const,
            errorBoundaryRejected: true as const,
            routeMatched: true as const,
            splashRejected: true as const,
            stableFrameHash: hash,
            verifiedAt: "2026-07-29T22:04:00.000Z",
          },
        },
      ],
      cancellationRequestedAt: null,
      checkpoints: [
        "validate",
        "inventory",
        "plan",
        "prepare-fixtures",
        "build",
        "launch",
        "capture",
        "extract-layers",
        "verify",
        "save",
      ] as const,
      createdAt: "2026-07-29T22:03:00.000Z",
      currentApplicationId: null,
      currentScenarioId: null,
      failures: [],
      id: "imp_01J00000000000000000000000",
      kind: "memi-import-job" as const,
      logs: [],
      managedWorktreeId: null,
      progress: { captured: 1, failed: 0, remaining: 0, total: 1 },
      projectId: "prj_01J00000000000000000000000",
      projectName: "Northstar",
      repository: {
        dirtyFingerprint: null,
        rootPath: "/Projects/northstar",
        sourceRevision: revision,
      },
      revision: 4,
      scenarios: [
        {
          applicationId: "northstar-web",
          authContext: null,
          fixtureProfile: "deterministic-local",
          id: "csc_01J00000000000000000000000",
          parameters: [],
          readinessSelector: "[data-ready]",
          route: "/",
          sourceAnchor: {
            contentHash: hash,
            relativePath: "src/pages/Home.tsx",
            symbol: "Home",
          },
          state: "default",
          viewport: {
            height: 800,
            name: "desktop",
            scale: 1,
            width: 1280,
          },
        },
      ],
      selectedHarness: null,
      stage: "save" as const,
      state: "committed" as const,
      updatedAt: "2026-07-29T22:04:00.000Z",
    });
    const repositoryCaptureRuntime = {
      cancel: vi.fn(),
      plan: vi.fn(async () =>
        ImportPlanResultSchemaV1.parse({
          plan: {
            token: "ipl_01J00000000000000000000000",
            repository: {
              dirtyFingerprint: null,
              rootPath: "/Projects/northstar",
              sourceRevision: "a".repeat(40),
            },
            applications: [
              {
                id: "northstar-web",
                label: "Northstar",
                platform: "react-web",
                relativeRoot: ".",
              },
            ],
            scenarios: [
              {
                id: "csc_01J00000000000000000000001",
                applicationId: "northstar-web",
                route: "/sign-in",
                state: "default",
                viewport: { name: "mobile", width: 390, height: 844, scale: 3 },
                sourceAnchor: null,
              },
              {
                id: "csc_01J00000000000000000000002",
                applicationId: "northstar-web",
                route: "/sign-up",
                state: "default",
                viewport: { name: "mobile", width: 390, height: 844, scale: 3 },
                sourceAnchor: null,
              },
              {
                id: "csc_01J00000000000000000000003",
                applicationId: "northstar-web",
                route: "/forgot-password",
                state: "default",
                viewport: { name: "mobile", width: 390, height: 844, scale: 3 },
                sourceAnchor: null,
              },
            ],
            recipes: [
              {
                applicationId: "northstar-web",
                applicationLabel: "Northstar web",
                adapterId: "react-web",
                adapterVersion: "1",
                executable: "npm",
                resolvedExecutable: "/usr/local/bin/npm",
                args: ["run", "dev"],
                cwd: "/Projects/northstar",
                purpose: "launch",
                hash: `sha256:${"b".repeat(64)}`,
                expiresAt: "2026-07-30T12:00:00.000Z",
              },
            ],
            inventory: {
              fileCount: 14,
              screenCount: 1,
              componentCount: 2,
              tokenCount: 1,
              screens: [
                {
                  id: "northstar-home",
                  name: "Home",
                  route: "/",
                  sourcePath: "src/pages/Home.tsx",
                },
              ],
              components: [
                {
                  id: "northstar-button",
                  name: "Button",
                  sourcePath: "src/components/Button.tsx",
                },
                {
                  id: "northstar-card",
                  name: "Card",
                  sourcePath: "src/components/Card.tsx",
                },
              ],
              tokens: [
                {
                  id: "northstar-tokens",
                  name: "Tokens",
                  sourcePath: "src/styles/tokens.css",
                },
              ],
              truncated: {
                screens: false,
                components: false,
                tokens: false,
              },
            },
            scenarioCount: 3,
            errors: [],
          },
        }).plan,
      ),
      resume: vi.fn(),
      retryFailed: vi.fn(),
      revealLogs: vi.fn(),
      start: vi.fn(async ({ onMaterialize, onUpdate }) => {
        const projectId = terminalJob.projectId!;
        const artifactReference = {
          alt: "Northstar Home runtime capture",
          capturedAt: "2026-07-29T22:04:00.000Z",
          sourceUrl: "http://127.0.0.1:4173/",
          src: "/imports/artifacts/art_01J00000000000000000000000.png",
        };
        onMaterialize?.({
          addedArtifacts: [
            {
              artifact: terminalJob.artifacts[0]!,
              reference: artifactReference,
            },
          ],
          job: terminalJob,
          projectId,
          sequence: terminalJob.revision - 1,
          state: "importing",
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        onUpdate(terminalJob);
        return {
          artifactReference: () => artifactReference,
          job: terminalJob,
          projectId,
        };
      }),
    };
    render(
      <MemiApp
        idFactory={() => "northstar-import"}
        now={() => "2026-07-29T22:04:00.000Z"}
        repositoryCaptureRuntime={repositoryCaptureRuntime}
        repositoryImporter={importer}
        storage={storage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Import project" }));
    fireEvent.change(screen.getByLabelText("Repository folder"), {
      target: { value: "/Projects/northstar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import repository" }));
    expect(await screen.findByText("Northstar")).toBeTruthy();
    fireEvent.click(
      screen.getByLabelText(
        "Approve the reviewed recipes",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start verified import" }),
    );
    expect(screen.getByText("Syncing")).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Northstar" }) ??
          screen.queryByRole("alert"),
      ).toBeTruthy();
    });
    expect(screen.queryByRole("alert")).toBeNull();

    expect(
      await screen.findByRole("heading", { name: "Northstar" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Home on canvas" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("img", {
        name: "Northstar Home runtime capture",
      }),
    ).toBeNull();
    expect(repositoryCaptureRuntime.start).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: "Northstar",
        pilotScenarioIds: [
          "csc_01J00000000000000000000001",
          "csc_01J00000000000000000000002",
          "csc_01J00000000000000000000003",
        ],
      }),
    );
    expect(
      storage.values.has(
        "memi.repository-project.v1:prj_01J00000000000000000000000",
      ),
    ).toBe(true);
  });

  it("accepts a new repository job after a cancelled import is closed", async () => {
    const firstRoot = "/Projects/first";
    const secondRoot = "/Projects/second";
    const firstRunning = importJobFor({
      applicationId: "first-web",
      id: "imp_01J00000000000000000000000",
      label: "First runtime",
      revision: 1,
      rootPath: firstRoot,
      state: "running",
    });
    const firstCancelled = importJobFor({
      applicationId: "first-web",
      id: "imp_01J00000000000000000000000",
      label: "First runtime",
      revision: 2,
      rootPath: firstRoot,
      state: "cancelled",
    });
    const secondRunning = importJobFor({
      applicationId: "second-web",
      id: "imp_01J00000000000000000000001",
      label: "Second runtime",
      revision: 1,
      rootPath: secondRoot,
      state: "running",
    });
    const plans = new Map([
      [
        firstRoot,
        importPlanFor(
          firstRoot,
          "first-web",
          "First product",
          "ipl_01J00000000000000000000000",
        ),
      ],
      [
        secondRoot,
        importPlanFor(
          secondRoot,
          "second-web",
          "Second product",
          "ipl_01J00000000000000000000001",
        ),
      ],
    ]);
    const pendingRejectors: Array<(reason: Error) => void> = [];
    const start = vi.fn(({ onUpdate }) => {
      const nextJob = start.mock.calls.length === 1
        ? firstRunning
        : secondRunning;
      onUpdate(nextJob);
      return new Promise<never>((_resolve, reject) => {
        pendingRejectors.push(reject);
      });
    });
    const repositoryCaptureRuntime = {
      cancel: vi.fn(async () => {
        pendingRejectors.shift()?.(new Error("Import cancelled."));
        return firstCancelled;
      }),
      plan: vi.fn(async (rootPath: string) => {
        const plan = plans.get(rootPath);
        if (plan === undefined) throw new Error("Unknown test repository.");
        return plan;
      }),
      resume: vi.fn(),
      retryFailed: vi.fn(),
      revealLogs: vi.fn(),
      start,
    };

    render(
      <MemiApp
        now={() => "2026-07-31T12:00:00.000Z"}
        repositoryCaptureRuntime={repositoryCaptureRuntime}
        repositoryImporter={vi.fn()}
        storage={memoryStorage()}
      />,
    );

    const beginImport = async (rootPath: string, label: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Import project" }));
      fireEvent.change(screen.getByLabelText("Repository folder"), {
        target: { value: rootPath },
      });
      fireEvent.click(screen.getByRole("button", { name: "Import repository" }));
      expect(await screen.findByText(label)).toBeTruthy();
      fireEvent.click(screen.getByLabelText("Approve the reviewed recipes"));
      fireEvent.click(
        screen.getByRole("button", { name: "Start verified import" }),
      );
    };

    await beginImport(firstRoot, "First product");
    expect(await screen.findByText("First runtime")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    expect(
      await screen.findByRole("button", { name: "Close repository import" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Close repository import" }),
    );

    await beginImport(secondRoot, "Second product");
    expect(await screen.findByText("Second runtime")).toBeTruthy();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("recovers the project library across application remounts", () => {
    const storage = memoryStorage();
    const first = render(
      <MemiApp
        idFactory={() => "persistent-board"}
        now={() => "2026-07-28T22:10:00.000Z"}
        storage={storage}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Create whiteboard project" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Back to projects" }),
    );
    first.unmount();

    render(
      <MemiApp
        idFactory={() => "unused"}
        now={() => "2026-07-28T22:11:00.000Z"}
        storage={storage}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Open Untitled whiteboard 1/ }),
    ).toBeTruthy();
  });

  it("deletes a project from the active library through the card menu", () => {
    const storage = memoryStorage();
    render(
      <MemiApp
        idFactory={() => "temporary-design"}
        now={() => "2026-07-29T22:12:00.000Z"}
        storage={storage}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Create design project" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Back to projects" }),
    );
    fireEvent.contextMenu(
      screen.getByRole("button", {
        name: /Open Untitled design 1/,
      }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Delete permanently" }),
    );

    expect(screen.getByText("No projects yet")).toBeTruthy();
  });

  it("recovers authored sticky, text, and section items after reload", () => {
    const storage = memoryStorage();
    const first = render(
      <MemiApp
        idFactory={() => "durable-board"}
        now={() => "2026-07-28T22:15:00.000Z"}
        storage={storage}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create whiteboard project" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add sticky note" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add text note" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add section" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Back to projects" }),
    );
    first.unmount();

    render(
      <MemiApp
        idFactory={() => "unused"}
        now={() => "2026-07-28T22:16:00.000Z"}
        storage={storage}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /Open Untitled whiteboard 1/,
      }),
    );

    expect(
      screen.getByRole("option", { name: "Sticky note: New idea" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Text note: Start typing" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Section: New section" }),
    ).toBeTruthy();
  });

  it("blocks invalid whiteboards without overwriting their stored payload", () => {
    const storage = memoryStorage();
    const first = render(
      <MemiApp
        idFactory={() => "future-board"}
        now={() => "2026-07-28T22:16:30.000Z"}
        storage={storage}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create whiteboard project" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Back to projects" }),
    );
    first.unmount();
    const key = whiteboardDocumentKey("whiteboard:future-board");
    const futurePayload =
      '{"schemaVersion":2,"kind":"memi-whiteboard-document"}';
    storage.values.set(key, futurePayload);

    render(
      <MemiApp
        idFactory={() => "unused"}
        now={() => "2026-07-28T22:16:40.000Z"}
        storage={storage}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /Open Untitled whiteboard 1/,
      }),
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "could not be opened safely",
    );
    expect(storage.values.get(key)).toBe(futurePayload);
  });

  it("surfaces failed whiteboard saves instead of claiming durability", () => {
    const base = memoryStorage();
    const storage = {
      getItem: base.getItem,
      removeItem: base.removeItem,
      setItem: (key: string, value: string) => {
        if (key.startsWith("memi.whiteboard.document.")) {
          throw new Error("quota exceeded");
        }
        base.setItem(key, value);
      },
    };
    render(
      <MemiApp
        idFactory={() => "unsaved-board"}
        now={() => "2026-07-28T22:16:50.000Z"}
        storage={storage}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create whiteboard project" }),
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Changes are not saved",
    );
  });

  it("opens truthful global settings from Home and persists safe changes", () => {
    const storage = memoryStorage();
    const first = render(
      <MemiApp
        idFactory={() => "unused"}
        now={() => "2026-07-28T22:17:00.000Z"}
        storage={storage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Agent and browser" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Reasoning" }), {
      target: { value: "medium" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Recent work" }),
    ).toBeTruthy();
    first.unmount();

    render(
      <MemiApp
        idFactory={() => "unused"}
        now={() => "2026-07-28T22:18:00.000Z"}
        storage={storage}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(
      (screen.getByRole("combobox", {
        name: "Reasoning",
      }) as HTMLSelectElement).value,
    ).toBe("medium");
  });

  it("applies saved global defaults to a newly opened authoring workspace", () => {
    const storage = memoryStorage();
    render(
      <MemiApp
        idFactory={() => "unused"}
        now={() => "2026-07-28T22:19:00.000Z"}
        storage={storage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Harness" }), {
      target: { value: "claude-code" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Reasoning" }), {
      target: { value: "medium" },
    });
    fireEvent.click(
      screen.getByRole("radio", { name: /Inspect only/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Create design project" }),
    );

    expect(
      (screen.getByRole("combobox", {
        name: "Agent harness",
      }) as HTMLSelectElement).value,
    ).toBe("claude-code");
    expect(
      (screen.getByRole("combobox", {
        name: "Model",
      }) as HTMLSelectElement).value,
    ).toBe("claude-adapter-default");
    fireEvent.click(
      screen.getByRole("button", { name: "Harness settings" }),
    );
    expect(
      (screen.getByRole("combobox", {
        name: "Workspace reasoning",
      }) as HTMLSelectElement).value,
    ).toBe("medium");
    expect(
      (screen.getByRole("combobox", {
        name: "Workspace permission",
      }) as HTMLSelectElement).value,
    ).toBe("inspect-only");
  });

  it("propagates only an explicit runtime connection into Settings", () => {
    render(
      <MemiApp
        idFactory={() => "unused"}
        now={() => "2026-07-28T22:20:00.000Z"}
        runtimeConnections={[
          {
            harnessId: "codex",
            runtimeLabel: "Codex desktop bridge",
            state: "connected",
          },
        ]}
        storage={memoryStorage()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(screen.getByText("Connected runtime")).toBeTruthy();
    expect(
      screen.getByText(/Codex desktop bridge reported a connection/i),
    ).toBeTruthy();
  });

  it("does not close Settings when persistence fails unexpectedly", () => {
    const baseStorage = memoryStorage();
    const storage = {
      getItem: baseStorage.getItem,
      removeItem: baseStorage.removeItem,
      setItem: (key: string, value: string) => {
        if (key === "memi.global-agent-settings.v1") {
          throw new Error("quota denied");
        }
        baseStorage.setItem(key, value);
      },
    };
    render(
      <MemiApp
        idFactory={() => "unused"}
        now={() => "2026-07-28T22:21:00.000Z"}
        storage={storage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(
      screen.getByRole("heading", { level: 1, name: "Agent and browser" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Settings were not saved",
    );
  });
});
