import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import {
  afterEach,
  describe,
  expect,
  it,
} from "bun:test";
import { hashCanonicalValue } from "@memi/canonical-json";
import { ImportJobIdSchema } from "@memi/protocol";

import type {
  ImportRepositoryInspection,
  PlannedRecipeApproval,
} from "./import-coordinator.types.js";
import {
  BunSqliteImportPlanStore,
} from "./bun-import-plan-store.js";

const JOB_ID = ImportJobIdSchema.parse(
  "imp_01J00000000000000000000000",
);
const REVISION = "a".repeat(40);
const HASH = `sha256:${"b".repeat(64)}` as const;
const KEY = new Uint8Array(32).fill(7);
const SOURCE_SENTINEL = "MEMI_BUN_PLAINTEXT_SOURCE_MUST_NOT_PERSIST";
const directories: string[] = [];

function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "memi-bun-plans-"));
  directories.push(root);
  return join(root, "imports.sqlite");
}

function inspection(): ImportRepositoryInspection {
  return {
    authority: {
      rootPath: "/tmp/source",
      sourceRevision: REVISION,
      dirtyFingerprint: HASH,
      managedWorktreeId: null,
      managedRootPath: "/tmp/managed",
    },
    manifest: {
      schemaVersion: 1,
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
          content: `export default function Home() { return "${SOURCE_SENTINEL}"; }`,
        },
      ],
    },
    snapshotExclusions: {
      schemaVersion: 1,
      entries: [],
      fingerprint: HASH,
      policyFingerprint: HASH,
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
    repositoryFingerprint: HASH,
    snapshotExclusionFingerprint: HASH,
    snapshotPolicyFingerprint: HASH,
    sourceRevision: REVISION,
    dirtyFingerprint: HASH,
    applicationCacheKey: HASH,
    adapter: { id: "react-web", version: "1" },
    resolvedExecutable: "/usr/local/bin/npm",
    environmentFingerprint: HASH,
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

describe("BunSqliteImportPlanStore", () => {
  it("restores HMAC-bound approvals with the external key", async () => {
    const path = databasePath();
    const first = new BunSqliteImportPlanStore(path, KEY);
    await first.save(JOB_ID, inspection(), [approval()]);
    first.close();

    const reopened = new BunSqliteImportPlanStore(path, KEY);
    const restored = await reopened.get(JOB_ID);
    expect(restored).toEqual({
      inspection: inspection(),
      approvals: [approval()],
      dependencyPreparations: [],
    });
    expect(Object.isFrozen(restored)).toBe(true);
    reopened.close();
  });

  it("seals source bodies and purges legacy plaintext rows", async () => {
    const path = databasePath();
    const first = new BunSqliteImportPlanStore(path, KEY);
    await first.save(JOB_ID, inspection(), [approval()]);
    first.close();

    const database = new Database(path);
    const sealed = database
      .query<{ readonly plan_json: string }>(
        "SELECT plan_json FROM import_execution_plans_v2 WHERE job_id = ?",
      )
      .get(JOB_ID);
    expect(sealed).not.toBe(null);
    expect(sealed?.plan_json).not.toContain(SOURCE_SENTINEL);
    expect(sealed?.plan_json).not.toContain("src/pages/index.tsx");
    expect(JSON.parse(sealed?.plan_json ?? "{}")).toMatchObject({
      schemaVersion: 3,
      algorithm: "aes-256-gcm",
    });
    database
      .query(
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
        JOB_ID,
      );
    database.close();

    const migrated = new BunSqliteImportPlanStore(path, KEY);
    expect(await migrated.get(JOB_ID)).toBe(null);
    migrated.close();
  });

  it("rejects database tampering and the wrong restart key", async () => {
    const path = databasePath();
    const first = new BunSqliteImportPlanStore(path, KEY);
    await first.save(JOB_ID, inspection(), [approval()]);
    first.close();

    const database = new Database(path);
    database
      .query(
        `UPDATE import_execution_plans_v2
         SET plan_json = ?
         WHERE job_id = ?`,
      )
      .run(JSON.stringify({ malicious: true }), JOB_ID);
    database.close();

    const tampered = new BunSqliteImportPlanStore(path, KEY);
    await expect(tampered.get(JOB_ID)).rejects.toThrow(
      /integrity is invalid/u,
    );
    tampered.close();

    const secondPath = databasePath();
    const second = new BunSqliteImportPlanStore(secondPath, KEY);
    await second.save(JOB_ID, inspection(), [approval()]);
    second.close();
    const wrongKey = new BunSqliteImportPlanStore(
      secondPath,
      new Uint8Array(32).fill(8),
    );
    await expect(wrongKey.get(JOB_ID)).rejects.toThrow(
      /integrity is invalid/u,
    );
    wrongKey.close();
  });

  it("deletes, purges, and rejects invalid authority", async () => {
    const store = new BunSqliteImportPlanStore(databasePath(), KEY);
    await expect(
      store.save(
        JOB_ID,
        {
          ...inspection(),
          authority: {
            ...inspection().authority,
            sourceRevision: "invalid",
          },
        },
        [],
      ),
    ).rejects.toThrow(/source revision is invalid/u);
    await expect(
      store.save(
        JOB_ID,
        {
          ...inspection(),
          authority: {
            ...inspection().authority,
            managedRootPath: "/",
          },
        },
        [],
      ),
    ).rejects.toThrow(/managed repository.*absolute non-root/u);
    await store.save(JOB_ID, inspection(), []);
    await store.delete(JOB_ID);
    expect(await store.get(JOB_ID)).toBe(null);
    await store.save(JOB_ID, inspection(), []);
    expect(await store.purgeAll()).toBe(1);
    expect(await store.purgeAll()).toBe(0);
    store.close();
  });

  it("requires a strong external key and an exact schema", () => {
    expect(
      () =>
        new BunSqliteImportPlanStore(
          databasePath(),
          new Uint8Array(31),
        ),
    ).toThrow(/at least 32 bytes/u);

    const path = databasePath();
    const database = new Database(path);
    database.exec(`
      CREATE TABLE import_execution_plans_v2 (
        job_id TEXT PRIMARY KEY
      ) STRICT;
    `);
    database.close();
    expect(
      () => new BunSqliteImportPlanStore(path, KEY),
    ).toThrow(/schema is incompatible/u);
  });
});
