import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  ImportJobDraftSchemaV2,
  ImportJobIdSchema,
  ProjectIdSchema,
  type ImportJobDraftV2,
} from "@memi/protocol";

import {
  ImportJobConflictError,
  SqliteImportJobStore,
} from "./import-job-store.js";

const directories: string[] = [];
const now = "2026-07-29T12:00:00.000Z";
const jobId = ImportJobIdSchema.parse(
  "imp_01J00000000000000000000000",
);
const hash = `sha256:${"a".repeat(64)}`;

function job(): ImportJobDraftV2 {
  return ImportJobDraftSchemaV2.parse({
    applications: [],
    artifacts: [],
    cancellationRequestedAt: null,
    checkpoints: [],
    createdAt: now,
    currentApplicationId: null,
    currentScenarioId: null,
    failures: [],
    id: jobId,
    kind: "memi-import-job",
    logs: [],
    managedWorktreeId: null,
    progress: { captured: 0, failed: 0, remaining: 0, total: 0 },
    projectId: null,
    projectName: "Imported product",
    repository: {
      dirtyFingerprint: null,
      rootPath: "/tmp/product",
      sourceRevision: null,
    },
    scenarios: [],
    selectedHarness: null,
    stage: "validate",
    state: "queued",
  });
}

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "memi-import-job-"));
  directories.push(directory);
  return join(directory, "runtime.sqlite");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLite import job store", () => {
  it("compare-and-saves deeply frozen snapshots and survives reopen", async () => {
    const path = databasePath();
    const first = new SqliteImportJobStore(path, { now: () => now });
    const created = await first.save({
      expectedRevision: null,
      job: job(),
    });

    expect(created.revision).toBe(1);
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.progress)).toBe(true);
    expect(first.inspect()).toMatchObject({
      foreignKeys: true,
      journalMode: "wal",
      synchronous: "full",
      trustedSchema: false,
    });
    first.close();

    const reopened = new SqliteImportJobStore(path, { now: () => now });
    const loaded = await reopened.get(jobId);
    expect(loaded).toEqual(created);
    expect(await reopened.listRecoverable()).toEqual([]);

    const updated = await reopened.save({
      expectedRevision: created.revision,
      job: {
        ...job(),
        repository: {
          ...job().repository,
          dirtyFingerprint: hash,
          sourceRevision: "b".repeat(40),
        },
        state: "running",
      },
    });
    expect(updated.revision).toBe(2);
    expect(await reopened.listRecoverable()).toEqual([updated]);
    expect(await reopened.listAll()).toEqual([updated]);
    reopened.close();
  });

  it("deletes only the exact revision selected for a discarded import", async () => {
    const store = new SqliteImportJobStore(databasePath(), {
      now: () => now,
    });
    const created = await store.save({ expectedRevision: null, job: job() });

    await expect(store.delete(jobId, created.revision + 1)).rejects.toBeInstanceOf(
      ImportJobConflictError,
    );
    await expect(store.get(jobId)).resolves.toEqual(created);
    await expect(store.delete(jobId, created.revision)).resolves.toBeUndefined();
    await expect(store.get(jobId)).resolves.toBeNull();
    await expect(store.listAll()).resolves.toEqual([]);
    store.close();
  });

  it("rejects stale writers, inserts over existing jobs, and oversized jobs", async () => {
    const store = new SqliteImportJobStore(databasePath(), {
      now: () => now,
    });
    await store.save({ expectedRevision: null, job: job() });

    await expect(
      store.save({ expectedRevision: null, job: job() }),
    ).rejects.toBeInstanceOf(ImportJobConflictError);
    await expect(
      store.save({ expectedRevision: 8, job: job() }),
    ).rejects.toBeInstanceOf(ImportJobConflictError);
    await expect(
      store.save({
        expectedRevision: 1,
        job: {
          ...job(),
          logs: Array.from({ length: 500 }, (_, index) => ({
            level: "info" as const,
            message: `${index}-${"x".repeat(2_000)}`,
            occurredAt: now,
          })),
        },
      }),
    ).rejects.toThrow("payload limit");
    store.close();
  });

  it("redacts hostile logs at the durable SQLite boundary", async () => {
    const path = databasePath();
    const store = new SqliteImportJobStore(path, { now: () => now });
    const secret =
      "token: sk-secret Authorization: Basic abc /Volumes/Private/user/file";
    const saved = await store.save({
      expectedRevision: null,
      job: {
        ...job(),
        logs: [{ level: "error", message: secret, occurredAt: now }],
      },
    });

    expect(saved.logs[0]?.message).not.toContain("sk-secret");
    expect(saved.logs[0]?.message).not.toContain("Basic abc");
    expect(saved.logs[0]?.message).not.toContain("/Volumes/Private");
    store.close();
    expect(readFileSync(path).toString()).not.toContain("sk-secret");
  });

  it("purges all Memi-owned import records without touching other databases", async () => {
    const path = databasePath();
    const store = new SqliteImportJobStore(path, { now: () => now });
    const marker = "Purge marker 019fa6c1";
    const historicalProjectId = ProjectIdSchema.parse(
      "prj_01J00000000000000000000000",
    );
    await store.save({
      expectedRevision: null,
      job: {
        ...job(),
        projectId: historicalProjectId,
        projectName: marker,
        stage: "save",
        state: "committed",
      },
    });

    expect(await store.listAll()).toEqual([
      expect.objectContaining({
        artifacts: [],
        projectId: historicalProjectId,
        state: "committed",
      }),
    ]);
    expect(await store.purgeAll()).toBe(1);
    expect(await store.get(jobId)).toBeNull();
    expect(await store.purgeAll()).toBe(0);
    store.close();
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(candidate)) {
        expect(readFileSync(candidate).includes(marker)).toBe(false);
      }
    }

    const database = new DatabaseSync(path);
    const tables = database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name = 'import_jobs_v2'`,
      )
      .all();
    expect(tables).toHaveLength(1);
    database.close();
  });

  it("rejects a pre-existing table that only imitates the store name", () => {
    const path = databasePath();
    const database = new DatabaseSync(path);
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE import_jobs_v2 (
        job_id TEXT PRIMARY KEY
      ) STRICT;
    `);
    database.close();

    expect(() => new SqliteImportJobStore(path)).toThrow(
      "schema is incompatible",
    );
  });
});
