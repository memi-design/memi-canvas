import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { hashCanonicalValue } from "@memi/canonical-json";
import { ImportJobIdSchema } from "@memi/protocol";
import { afterEach, describe, expect, it } from "vitest";

import type { ImportRepositoryInspection } from "./import-coordinator.js";
import type { PlannedRecipeApproval } from "./import-coordinator.js";
import { SqliteImportPlanStore } from "./import-plan-store.js";

const jobId = ImportJobIdSchema.parse(
  "imp_01J00000000000000000000000",
);
const revision = "a".repeat(40);
const fingerprint = `sha256:${"b".repeat(64)}` as const;
const integrityKey = new Uint8Array(32).fill(7);
const sourceSentinel = "MEMI_PLAINTEXT_SOURCE_MUST_NOT_PERSIST";
const directories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "memi-plan-store-"));
  directories.push(directory);
  return join(directory, "runtime.sqlite");
}

function inspection(): ImportRepositoryInspection {
  return {
    authority: {
      rootPath: "/tmp/source",
      sourceRevision: revision,
      dirtyFingerprint: fingerprint,
      managedWorktreeId: null,
      managedRootPath: "/tmp/managed",
    },
    manifest: {
      schemaVersion: 1,
      repository: {
        revision,
        dirtyFileFingerprint: fingerprint,
      },
      budgets: {
        maxEntries: 8,
        maxFileBytes: 4_096,
        maxTotalBytes: 16_384,
        maxDepth: 8,
      },
      entries: [
        {
          path: "package.json",
          content: JSON.stringify({
            name: "site",
            scripts: { dev: "vite" },
            dependencies: { react: "19" },
          }),
        },
        {
          path: "src/pages/index.tsx",
          content: `export default function Home() { return "${sourceSentinel}"; }`,
        },
      ],
    },
    snapshotExclusions: {
      schemaVersion: 1,
      entries: [],
      fingerprint,
      policyFingerprint: fingerprint,
    },
  };
}

function approval(): PlannedRecipeApproval {
  const unsigned = {
    schemaVersion: 2 as const,
    applicationId: "app_web",
    recipe: {
      executable: "npm" as const,
      args: ["run", "dev"],
      cwd: "/tmp/managed",
      purpose: "launch" as const,
    },
    repositoryFingerprint: fingerprint,
    snapshotExclusionFingerprint: fingerprint,
    snapshotPolicyFingerprint: fingerprint,
    sourceRevision: revision,
    dirtyFingerprint: fingerprint,
    applicationCacheKey: fingerprint,
    adapter: { id: "react-web", version: "1" },
    resolvedExecutable: "/usr/local/bin/npm",
    environmentFingerprint: fingerprint,
    nonce: "single-use-nonce",
    expiresAt: "2026-07-31T05:00:00.000Z",
  };
  return {
    ...unsigned,
    hash: hashCanonicalValue(unsigned) as `sha256:${string}`,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SqliteImportPlanStore", () => {
  it("requires integrity authority outside the SQLite database", () => {
    expect(
      () =>
        new SqliteImportPlanStore(
          databasePath(),
          new Uint8Array(31),
        ),
    ).toThrow(/at least 32 bytes/u);
  });

  it("rejects malformed repository authority before persistence", async () => {
    const store = new SqliteImportPlanStore(
      databasePath(),
      integrityKey,
    );
    await expect(
      store.save(
        jobId,
        {
          ...inspection(),
          authority: {
            ...inspection().authority,
            sourceRevision: "not-a-revision",
          },
        },
        [],
      ),
    ).rejects.toThrow(/source revision is invalid/u);
    store.close();
  });

  it.each(["relative/managed", "/"])(
    "rejects unsafe managed execution authority %s",
    async (managedRootPath) => {
      const store = new SqliteImportPlanStore(
        databasePath(),
        integrityKey,
      );
      await expect(
        store.save(
          jobId,
          {
            ...inspection(),
            authority: {
              ...inspection().authority,
              managedRootPath,
            },
          },
          [],
        ),
      ).rejects.toThrow(/managed repository.*absolute non-root/u);
      store.close();
    },
  );

  it("restores validated discovery input after restart", async () => {
    const path = databasePath();
    const first = new SqliteImportPlanStore(path, integrityKey);
    await first.save(jobId, inspection(), [approval()]);
    first.close();

    const reopened = new SqliteImportPlanStore(path, integrityKey);
    const restored = await reopened.get(jobId);
    expect(restored).toEqual({
      inspection: inspection(),
      approvals: [approval()],
      dependencyPreparations: [],
    });
    expect(Object.isFrozen(restored)).toBe(true);
    expect(
      Object.isFrozen(restored?.inspection.manifest.entries),
    ).toBe(true);
    reopened.close();
  });

  it("seals source and Maestro bodies before writing durable plan JSON", async () => {
    const path = databasePath();
    const store = new SqliteImportPlanStore(path, integrityKey);
    await store.save(jobId, inspection(), [approval()]);
    store.close();

    const database = new DatabaseSync(path);
    const row = database
      .prepare(
        "SELECT plan_json FROM import_execution_plans_v2 WHERE job_id = ?",
      )
      .get(jobId) as { readonly plan_json: string };
    database.close();

    expect(row.plan_json).not.toContain(sourceSentinel);
    expect(row.plan_json).not.toContain("src/pages/index.tsx");
    expect(JSON.parse(row.plan_json)).toMatchObject({
      schemaVersion: 3,
      algorithm: "aes-256-gcm",
    });
  });

  it("purges legacy plaintext execution plans during startup migration", async () => {
    const path = databasePath();
    const first = new SqliteImportPlanStore(path, integrityKey);
    await first.save(jobId, inspection(), []);
    first.close();

    const database = new DatabaseSync(path);
    database
      .prepare(
        "UPDATE import_execution_plans_v2 SET plan_json = ? WHERE job_id = ?",
      )
      .run(
        JSON.stringify({
          authority: inspection().authority,
          manifest: inspection().manifest,
          snapshotExclusions: inspection().snapshotExclusions,
          recipeCwds: null,
          approvals: [],
          dependencyPreparations: [],
        }),
        jobId,
      );
    database.close();

    const migrated = new SqliteImportPlanStore(path, integrityKey);
    expect(await migrated.get(jobId)).toBeNull();
    migrated.close();
  });

  it("rejects tampered plan JSON instead of executing it", async () => {
    const path = databasePath();
    const store = new SqliteImportPlanStore(path, integrityKey);
    await store.save(jobId, inspection(), []);
    store.close();
    const database = new DatabaseSync(path);
    database
      .prepare(
        "UPDATE import_execution_plans_v2 SET plan_json = ? WHERE job_id = ?",
      )
      .run(
        JSON.stringify({
          ...inspection(),
          manifest: {
            ...inspection().manifest,
            entries: [
              { path: "../../escape", content: "malicious" },
            ],
          },
        }),
        jobId,
      );
    database.close();

    const reopened = new SqliteImportPlanStore(path, integrityKey);
    await expect(reopened.get(jobId)).rejects.toThrow(
      /integrity is invalid/u,
    );
    reopened.close();
  });

  it("rejects a restart without the same external integrity authority", async () => {
    const path = databasePath();
    const first = new SqliteImportPlanStore(path, integrityKey);
    await first.save(jobId, inspection(), [approval()]);
    first.close();

    const differentKey = new Uint8Array(32).fill(8);
    const reopened = new SqliteImportPlanStore(path, differentKey);
    await expect(reopened.get(jobId)).rejects.toThrow(
      /integrity is invalid/u,
    );
    reopened.close();
  });

  it("deletes and purges only durable plan records", async () => {
    const store = new SqliteImportPlanStore(
      databasePath(),
      integrityKey,
    );
    await store.save(jobId, inspection(), []);
    await store.delete(jobId);
    expect(await store.get(jobId)).toBeNull();
    await store.save(jobId, inspection(), []);
    expect(await store.purgeAll()).toBe(1);
    expect(await store.purgeAll()).toBe(0);
    store.close();
  });
});
