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
  ImportJobDraftSchemaV2,
  ImportJobIdSchema,
  type ImportJobDraftV2,
} from "@memi/protocol";

import {
  BunImportJobConflictError,
  BunSqliteImportJobStore,
} from "./bun-import-job-store.js";

const NOW = "2026-07-30T05:00:00.000Z";
const JOB_ID = ImportJobIdSchema.parse(
  "imp_01J00000000000000000000000",
);
const directories: string[] = [];

function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "memi-bun-jobs-"));
  directories.push(root);
  return join(root, "imports.sqlite");
}

function job(
  state: ImportJobDraftV2["state"] = "queued",
): ImportJobDraftV2 {
  return ImportJobDraftSchemaV2.parse({
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
      dirtyFingerprint: null,
      rootPath: "/tmp/product",
      sourceRevision: null,
    },
    scenarios: [],
    selectedHarness: null,
    stage: "validate",
    state,
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("BunSqliteImportJobStore", () => {
  it("uses WAL, revision fences, and restart-safe snapshots", async () => {
    const path = databasePath();
    const first = new BunSqliteImportJobStore(path, {
      now: () => NOW,
    });
    expect(first.inspect()).toMatchObject({
      foreignKeys: true,
      journalMode: "wal",
      secureDelete: true,
      synchronous: "full",
      trustedSchema: false,
    });
    const created = await first.save({
      expectedRevision: null,
      job: job(),
    });
    expect(created.revision).toBe(1);
    first.close();

    const reopened = new BunSqliteImportJobStore(path, {
      now: () => NOW,
    });
    expect(await reopened.get(JOB_ID)).toEqual(created);
    const running = await reopened.save({
      expectedRevision: created.revision,
      job: job("running"),
    });
    expect(await reopened.listRecoverable()).toEqual([running]);
    expect(await reopened.listAll()).toEqual([running]);
    await expect(
      reopened.save({
        expectedRevision: created.revision,
        job: job("running"),
      }),
    ).rejects.toBeInstanceOf(BunImportJobConflictError);
    reopened.close();
  });

  it("redacts durable logs and purges job rows", async () => {
    const path = databasePath();
    const store = new BunSqliteImportJobStore(path, {
      now: () => NOW,
    });
    const secret =
      "token=sk-secret Authorization: Basic abc /Volumes/Private/file";
    const saved = await store.save({
      expectedRevision: null,
      job: {
        ...job(),
        logs: [{
          level: "error",
          message: secret,
          occurredAt: NOW,
        }],
      },
    });
    expect(saved.logs[0]?.message).not.toContain("sk-secret");
    expect(saved.logs[0]?.message).not.toContain("/Volumes/Private");
    expect(readFileSync(path).toString()).not.toContain("sk-secret");
    expect(await store.purgeAll()).toBe(1);
    expect(await store.get(JOB_ID)).toBe(null);
    expect(await store.purgeAll()).toBe(0);
    store.close();
  });

  it("rejects invalid revisions and incompatible schemas", async () => {
    const path = databasePath();
    const store = new BunSqliteImportJobStore(path);
    await expect(
      store.save({
        expectedRevision: 0,
        job: job(),
      }),
    ).rejects.toBeInstanceOf(BunImportJobConflictError);
    store.close();

    const { Database } = await import("bun:sqlite");
    const malformedPath = databasePath();
    const malformed = new Database(malformedPath);
    malformed.exec(
      "CREATE TABLE import_jobs_v2 (job_id TEXT PRIMARY KEY) STRICT;",
    );
    malformed.close();
    expect(
      () => new BunSqliteImportJobStore(malformedPath),
    ).toThrow(/schema is incompatible/u);
  });
});
