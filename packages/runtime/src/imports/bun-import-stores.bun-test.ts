import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  CaptureArtifactSchemaV2,
  ImportJobDraftSchemaV2,
  ImportJobIdSchema,
  ImportJobSnapshotSchemaV2,
  ProjectIdSchema,
} from "@memi/protocol";

import {
  BunSqliteCanvasDocumentV3PersistencePort,
  BunSqliteCommittedImportedProjectStore,
  BunSqliteImportJobStore,
  BunSqliteImportPlanStore,
} from "./bun-import-stores.js";
import {
  createCommittedImportedProjectRecord,
} from "./committed-import-project-store.js";

const NOW = "2026-07-30T05:00:00.000Z";
const REVISION = "a".repeat(40);
const HASH = `sha256:${"b".repeat(64)}` as const;
const JOB_ID = ImportJobIdSchema.parse(
  "imp_01J00000000000000000000000",
);
const PROJECT_ID = ProjectIdSchema.parse(
  "prj_01J00000000000000000000000",
);
const KEY = new Uint8Array(32).fill(7);
const directories: string[] = [];

function root(): string {
  const result = mkdtempSync(join(tmpdir(), "memi-bun-runtime-"));
  directories.push(result);
  return result;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function committedJob() {
  return ImportJobSnapshotSchemaV2.parse({
    applications: [{
      id: "app_01",
      label: "Product",
      platform: "react-web",
      relativeRoot: ".",
    }],
    artifacts: [
      CaptureArtifactSchemaV2.parse({
        id: "art_01J00000000000000000000000",
        scenarioId: "csc_01J00000000000000000000000",
        screenshotArtifactId: "art_01J00000000000000000000001",
        hierarchyArtifactId: "art_01J00000000000000000000002",
        geometryArtifactId: "art_01J00000000000000000000003",
        reconstructionArtifactId: null,
        screenshotHash: HASH,
        sourceRevision: REVISION,
        fixtureFingerprint: HASH,
        dimensions: {
          width: 1280,
          height: 800,
          scale: 1,
        },
        verification: {
          stableFrameHash: HASH,
          routeMatched: true,
          blankRejected: true,
          splashRejected: true,
          errorBoundaryRejected: true,
          verifiedAt: NOW,
        },
      }),
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
    ],
    createdAt: NOW,
    currentApplicationId: null,
    currentScenarioId: null,
    failures: [],
    id: JOB_ID,
    kind: "memi-import-job",
    logs: [],
    managedWorktreeId: null,
    progress: {
      captured: 1,
      failed: 0,
      remaining: 0,
      total: 1,
    },
    projectId: PROJECT_ID,
    projectName: "Product",
    repository: {
      dirtyFingerprint: HASH,
      rootPath: "/tmp/product",
      sourceRevision: REVISION,
    },
    scenarios: [{
      applicationId: "app_01",
      authContext: null,
      fixtureProfile: "deterministic-local",
      id: "csc_01J00000000000000000000000",
      parameters: [],
      readinessSelector: "body",
      route: "/",
      sourceAnchor: {
        contentHash: HASH,
        relativePath: "src/pages/index.tsx",
        symbol: "Home",
      },
      state: "default",
      viewport: {
        height: 800,
        name: "desktop",
        scale: 1,
        width: 1280,
      },
    }],
    selectedHarness: null,
    stage: "save",
    state: "committed",
    updatedAt: NOW,
    revision: 2,
    pilotScope: null,
  });
}

describe("Bun import storage integration", () => {
  it("opens every sidecar store against one WAL database", () => {
    const databasePath = join(root(), "imports.sqlite");
    const jobs = new BunSqliteImportJobStore(databasePath, {
      now: () => NOW,
    });
    const plans = new BunSqliteImportPlanStore(databasePath, KEY);
    const committed = new BunSqliteCommittedImportedProjectStore(databasePath);
    const canvas = new BunSqliteCanvasDocumentV3PersistencePort(databasePath);

    canvas.close();
    committed.close();
    plans.close();
    jobs.close();
  });

  it("shares one WAL database and restores both authorities", async () => {
    const databasePath = join(root(), "imports.sqlite");
    const jobs = new BunSqliteImportJobStore(databasePath, {
      now: () => NOW,
    });
    const plans = new BunSqliteImportPlanStore(databasePath, KEY);
    const job = ImportJobDraftSchemaV2.parse({
      applications: [],
      artifacts: [],
      cancellationRequestedAt: null,
      checkpoints: [],
      createdAt: NOW,
      currentApplicationId: null,
      currentScenarioId: null,
      failures: [],
      id: JOB_ID,
      kind: "memi-import-job",
      logs: [],
      managedWorktreeId: null,
      progress: {
        captured: 0,
        failed: 0,
        remaining: 0,
        total: 0,
      },
      projectId: null,
      projectName: "Product",
      repository: {
        dirtyFingerprint: HASH,
        rootPath: "/tmp/product",
        sourceRevision: REVISION,
      },
      scenarios: [],
      selectedHarness: null,
      stage: "validate",
      state: "queued",
    });
    const inspection = {
      authority: {
        rootPath: "/tmp/product",
        sourceRevision: REVISION,
        dirtyFingerprint: HASH,
        managedWorktreeId: null,
        managedRootPath: "/tmp/managed-product",
      },
      manifest: {
        schemaVersion: 1 as const,
        repository: {
          revision: REVISION,
          dirtyFileFingerprint: HASH,
        },
        budgets: {
          maxEntries: 8,
          maxFileBytes: 4_096,
          maxTotalBytes: 16_384,
          maxDepth: 8,
        },
        entries: [{
          path: "README.md",
          content: "# fixture",
        }],
      },
      snapshotExclusions: {
        schemaVersion: 1 as const,
        entries: [],
        fingerprint: HASH,
        policyFingerprint: HASH,
      },
    };

    const saved = await jobs.save({
      expectedRevision: null,
      job,
    });
    await plans.save(JOB_ID, inspection, []);
    jobs.close();
    plans.close();

    const reopenedJobs = new BunSqliteImportJobStore(databasePath, {
      now: () => NOW,
    });
    const reopenedPlans = new BunSqliteImportPlanStore(
      databasePath,
      KEY,
    );
    expect(await reopenedJobs.get(JOB_ID)).toEqual(saved);
    expect(await reopenedPlans.get(JOB_ID)).toEqual({
      inspection,
      approvals: [],
      dependencyPreparations: [],
    });
    reopenedJobs.close();
    reopenedPlans.close();
  });

  it("persists committed imported project records in the Bun runtime store", async () => {
    const databasePath = join(root(), "imports.sqlite");
    const store =
      new BunSqliteCommittedImportedProjectStore(databasePath);
    const record = createCommittedImportedProjectRecord({
      inventory: {
        fileCount: 2,
        screenCount: 1,
        componentCount: 1,
        tokenCount: 1,
        screens: [{
          id: "rte_home",
          name: "Home",
          route: "/",
          sourcePath: "src/pages/index.tsx",
        }],
        components: [{
          id: "cmp_button",
          name: "PrimaryButton",
          sourcePath: "src/components/PrimaryButton.tsx",
        }],
        tokens: [{
          id: "tok_color",
          name: "color.canvas",
          sourcePath: "src/styles/tokens.css",
        }],
        truncated: {
          screens: false,
          components: false,
          tokens: false,
        },
      },
      artifactReferences: [
        {
          id: "art_01J00000000000000000000001",
          hash: HASH,
          extension: "png",
        },
        {
          id: "art_01J00000000000000000000002",
          hash: HASH,
          extension: "json",
        },
        {
          id: "art_01J00000000000000000000003",
          hash: HASH,
          extension: "json",
        },
      ],
      harnessId: "deterministic-import",
      job: committedJob(),
      projectId: PROJECT_ID,
    });

    await store.save(record);
    expect(await store.get(PROJECT_ID)).toEqual(record);
    expect(await store.purgeAll()).toBe(1);
    expect(await store.get(PROJECT_ID)).toBe(null);
    store.close();
  });

  it("keeps the Bun runtime graph free of node:sqlite imports", () => {
    for (const file of [
      "bun-committed-import-project-store.ts",
      "bun-import-job-store.ts",
      "bun-import-plan-store.ts",
      "bun-import-stores.ts",
      "import-coordinator.ts",
    ]) {
      expect(
        readFileSync(
          new URL(file, import.meta.url),
          "utf8",
        ),
      ).not.toContain("node:sqlite");
    }
  });
});
