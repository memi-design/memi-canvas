import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createWorkspaceSessionDraft } from "@memi/protocol";

import {
  SqliteWorkspaceSessionPort,
  WorkspaceSessionConflictError,
} from "./workspace-session-store.js";

const directories: string[] = [];
const SOURCE_REVISION = "a".repeat(40);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "memi-session-"));
  directories.push(directory);
  return new SqliteWorkspaceSessionPort(join(directory, "session.sqlite"), {
    now: () => "2026-07-29T12:00:00.000Z",
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLite workspace session port", () => {
  it("compare-and-saves immutable snapshots and survives restart", async () => {
    const port = fixture();
    const initial = createWorkspaceSessionDraft({
      projectId: "project-buzzr",
      documentId: "buzzr-mobile",
      documentRevision: 4,
      sourceRevision: SOURCE_REVISION,
    });

    const saved = await port.save({
      expectedSessionRevision: null,
      session: initial,
    });
    expect(saved.sessionRevision).toBe(1);
    expect(Object.isFrozen(saved)).toBe(true);
    expect(Object.isFrozen(saved.selection.selectedIds)).toBe(true);

    const changed = await port.save({
      expectedSessionRevision: 1,
      session: {
        ...initial,
        camera: { ...initial.camera, x: 75, zoom: 2 },
        selection: {
          selectedIds: ["button-primary"],
          anchorId: "button-primary",
          focusedNodeId: "button-primary",
          editingNodeId: null,
        },
      },
    });
    expect(changed).toMatchObject({
      sessionRevision: 2,
      camera: { x: 75, zoom: 2 },
    });
    expect(initial.camera.x).toBe(0);

    const path = port.databasePath;
    port.close();
    const reopened = new SqliteWorkspaceSessionPort(path);
    await expect(
      reopened.load("project-buzzr", "buzzr-mobile"),
    ).resolves.toEqual(changed);
    reopened.close();
  });

  it("rejects stale writers and document revision regression", async () => {
    const port = fixture();
    const initial = createWorkspaceSessionDraft({
      projectId: "project-buzzr",
      documentId: "buzzr-mobile",
      documentRevision: 10,
      sourceRevision: SOURCE_REVISION,
    });
    await port.save({
      expectedSessionRevision: null,
      session: initial,
    });

    await expect(
      port.save({
        expectedSessionRevision: null,
        session: initial,
      }),
    ).rejects.toBeInstanceOf(WorkspaceSessionConflictError);
    await expect(
      port.save({
        expectedSessionRevision: 1,
        session: { ...initial, documentRevision: 9 },
      }),
    ).rejects.toThrow(/revision.*regress/iu);
    port.close();
  });

  it("migrates once without replacing a newer session or trusting a changed record", async () => {
    const port = fixture();
    const session = createWorkspaceSessionDraft({
      projectId: "project-buzzr",
      documentId: "buzzr-mobile",
      documentRevision: 8,
      sourceRevision: SOURCE_REVISION,
    });
    const request = {
      migrationKey: "local-storage:memi.canvas.autosave.v1:buzzr-mobile",
      legacyRecordHash: "fnv1a64:0123456789abcdef",
      session,
    } as const;

    const first = await port.migrateLegacy(request);
    expect(first.status).toBe("migrated");
    expect(first.session?.sessionRevision).toBe(1);
    const replay = await port.migrateLegacy(request);
    expect(replay).toEqual({
      status: "already-migrated",
      session: first.session,
    });
    await expect(
      port.migrateLegacy({
        ...request,
        legacyRecordHash: "fnv1a64:fedcba9876543210",
      }),
    ).rejects.toThrow(/migration.*changed/iu);
    port.close();
  });

  it("records but never overwrites a session that already exists", async () => {
    const port = fixture();
    const current = createWorkspaceSessionDraft({
      projectId: "project-buzzr",
      documentId: "buzzr-mobile",
      documentRevision: 12,
      sourceRevision: SOURCE_REVISION,
    });
    const stored = await port.save({
      expectedSessionRevision: null,
      session: current,
    });
    const stale = { ...current, documentRevision: 3 };

    const result = await port.migrateLegacy({
      migrationKey: "legacy-session",
      legacyRecordHash: "fnv1a64:0123456789abcdef",
      session: stale,
    });
    expect(result).toEqual({ status: "session-exists", session: stored });
    await expect(
      port.load("project-buzzr", "buzzr-mobile"),
    ).resolves.toEqual(stored);
    port.close();
  });

  it("rejects an existing permissive schema instead of trusting table names", () => {
    const directory = mkdtempSync(join(tmpdir(), "memi-session-"));
    directories.push(directory);
    const path = join(directory, "session.sqlite");
    const forged = new DatabaseSync(path);
    forged.exec(`
      CREATE TABLE workspace_sessions (
        project_id TEXT
      ) STRICT;
    `);
    forged.close();

    expect(() => new SqliteWorkspaceSessionPort(path)).toThrow(
      /schema.*incompatible/iu,
    );
  });

  it("keeps migration evidence immutable in SQLite", async () => {
    const port = fixture();
    const session = createWorkspaceSessionDraft({
      projectId: "project-buzzr",
      documentId: "buzzr-mobile",
      documentRevision: 1,
      sourceRevision: null,
    });
    await port.migrateLegacy({
      migrationKey: "legacy-session",
      legacyRecordHash: "fnv1a64:0123456789abcdef",
      session,
    });
    const path = port.databasePath;
    port.close();

    const database = new DatabaseSync(path);
    expect(() =>
      database.exec(
        `UPDATE workspace_session_migrations
         SET legacy_record_hash = 'fnv1a64:fedcba9876543210'`,
      ),
    ).toThrow(/immutable/iu);
    expect(() =>
      database.exec("DELETE FROM workspace_session_migrations"),
    ).toThrow(/immutable/iu);
    database.close();
  });
});
