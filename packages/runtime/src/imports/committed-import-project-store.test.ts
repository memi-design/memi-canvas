import {
  readFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtifactReference } from "@memi/capture-execution";
import {
  CaptureArtifactSchemaV2,
  ImportJobSnapshotSchemaV2,
  ProjectIdSchema,
} from "@memi/protocol";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCommittedImportedProjectRecord,
  SqliteCommittedImportedProjectStore,
} from "./committed-import-project-store.js";

const NOW = "2026-07-30T05:00:00.000Z";
const REVISION = "a".repeat(40);
const HASH = `sha256:${"b".repeat(64)}` as const;
const PROJECT_ID = ProjectIdSchema.parse(
  "prj_01J00000000000000000000000",
);
const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-committed-import-project-store-"),
  );
  directories.push(directory);
  return directory;
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
    id: "imp_01J00000000000000000000000",
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

const artifactReferences: readonly ArtifactReference[] = Object.freeze([
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
]);

describe("SqliteCommittedImportedProjectStore", () => {
  it("keeps committed project record helpers free of direct node:sqlite imports", () => {
    expect(
      readFileSync(
        new URL("./committed-import-project-store.ts", import.meta.url),
        "utf8",
      ),
    ).not.toContain("node:sqlite");
  });

  it("persists and restores the committed import recovery record", async () => {
    const databasePath = join(temporaryDirectory(), "runtime.sqlite");
    const store = new SqliteCommittedImportedProjectStore(databasePath);
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
      artifactReferences,
      harnessId: "deterministic-import",
      job: committedJob(),
      projectId: PROJECT_ID,
    });

    await store.save(record);
    expect(await store.get(PROJECT_ID)).toEqual(record);
    expect(await store.purgeAll()).toBe(1);
    await expect(store.get(PROJECT_ID)).resolves.toBeNull();
    store.close();
  });
});
