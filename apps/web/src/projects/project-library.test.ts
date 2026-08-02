import { describe, expect, it } from "vitest";

import {
  createProjectLibraryPersistence,
  createProjectLibraryState,
  projectLibraryActions,
  projectLibraryReducer,
  runtimeProjectIdForLocalProject,
  type ProjectLibraryStorage,
} from "./project-library.js";
import { ProjectIdSchema } from "@memi/protocol";

const repositoryProject = {
  id: "northstar-mobile",
  name: "Northstar Mobile",
  kind: "design" as const,
  documentRef: "canvas:northstar-mobile",
  source: {
    kind: "repository" as const,
    label: "northstar/mobile",
    version: "a1b2c3d",
    rootPath: "/Projects/northstar-mobile",
    platform: "react-native-expo" as const,
    harnessId: "codex",
    fileCount: 92,
    screenCount: 14,
    componentCount: 28,
  },
  updatedAt: "2026-07-15T21:49:42.000Z",
  lastOpenedAt: "2026-07-28T20:00:00.000Z",
  archived: false,
};

describe("project library state", () => {
  it("derives a stable protocol-valid runtime identity for local files", () => {
    const first = runtimeProjectIdForLocalProject("local-design-1");
    const repeated = runtimeProjectIdForLocalProject("local-design-1");
    const other = runtimeProjectIdForLocalProject("local-design-2");

    expect(ProjectIdSchema.parse(first)).toBe(first);
    expect(repeated).toBe(first);
    expect(other).not.toBe(first);
  });

  it("preserves an authenticated runtime project identity", () => {
    const runtimeId = "prj_01J00000000000000000000000";
    expect(runtimeProjectIdForLocalProject(runtimeId)).toBe(runtimeId);
  });

  it("creates an immutable library without embedding scene payloads", () => {
    const state = createProjectLibraryState([repositoryProject]);

    expect(state).toEqual({
      schemaVersion: 1,
      projects: [repositoryProject],
      activeProjectId: null,
    });
    expect(JSON.stringify(state)).not.toContain('"nodes"');
    expect(state.projects).not.toBe(
      projectLibraryReducer(
        state,
        projectLibraryActions.openProject(
          repositoryProject.id,
          "2026-07-28T21:00:00.000Z",
        ),
      ).projects,
    );
  });

  it("creates, opens, renames, archives, and deletes independent file records", () => {
    const initial = createProjectLibraryState([repositoryProject]);
    const created = projectLibraryReducer(
      initial,
      projectLibraryActions.createProject({
        id: "local-design-1",
        name: "Checkout explorations",
        kind: "design",
        documentRef: "canvas:local-design-1",
        timestamp: "2026-07-28T21:01:00.000Z",
      }),
    );
    const opened = projectLibraryReducer(
      created,
      projectLibraryActions.openProject(
        "local-design-1",
        "2026-07-28T21:02:00.000Z",
      ),
    );
    const renamed = projectLibraryReducer(
      opened,
      projectLibraryActions.renameProject(
        "local-design-1",
        "Checkout flow",
        "2026-07-28T21:03:00.000Z",
      ),
    );
    const archived = projectLibraryReducer(
      renamed,
      projectLibraryActions.archiveProject(
        "local-design-1",
        "2026-07-28T21:04:00.000Z",
      ),
    );

    expect(initial.projects).toHaveLength(1);
    expect(created.projects).toHaveLength(2);
    expect(opened.activeProjectId).toBe("local-design-1");
    expect(
      renamed.projects.find(({ id }) => id === "local-design-1"),
    ).toMatchObject({
      name: "Checkout flow",
      lastOpenedAt: "2026-07-28T21:02:00.000Z",
      updatedAt: "2026-07-28T21:03:00.000Z",
    });
    expect(
      archived.projects.find(({ id }) => id === "local-design-1"),
    ).toMatchObject({
      archived: true,
      updatedAt: "2026-07-28T21:04:00.000Z",
    });
    expect(archived.activeProjectId).toBeNull();

    const deleted = projectLibraryReducer(
      renamed,
      projectLibraryActions.deleteProject("local-design-1"),
    );

    expect(deleted.projects).toEqual([repositoryProject]);
    expect(deleted.activeProjectId).toBeNull();
    expect(renamed.projects).toHaveLength(2);
  });

  it("supports whiteboards and ignores invalid or colliding actions", () => {
    const initial = createProjectLibraryState([repositoryProject]);
    const whiteboard = projectLibraryReducer(
      initial,
      projectLibraryActions.createProject({
        id: "research-board",
        name: "Research synthesis",
        kind: "whiteboard",
        documentRef: "whiteboard:research-board",
        timestamp: "2026-07-28T21:05:00.000Z",
      }),
    );
    const collision = projectLibraryReducer(
      whiteboard,
      projectLibraryActions.createProject({
        id: "research-board",
        name: "Duplicate",
        kind: "design",
        documentRef: "canvas:duplicate",
        timestamp: "2026-07-28T21:06:00.000Z",
      }),
    );
    const emptyRename = projectLibraryReducer(
      collision,
      projectLibraryActions.renameProject(
        "research-board",
        "   ",
        "2026-07-28T21:07:00.000Z",
      ),
    );

    expect(whiteboard.projects.at(-1)).toMatchObject({
      kind: "whiteboard",
      source: { kind: "local", label: "Local file" },
    });
    expect(collision).toEqual(whiteboard);
    expect(emptyRename).toEqual(collision);
  });

  it("creates an imported repository record without converting it to a local file", () => {
    const imported = projectLibraryReducer(
      createProjectLibraryState(),
      projectLibraryActions.createProject({
        id: "source-product",
        name: "Source product",
        kind: "design",
        documentRef: "canvas:source-product",
        timestamp: "2026-07-29T22:00:00.000Z",
        source: {
          kind: "repository",
          label: "team/source-product",
          version: "d34db33",
          rootPath: "/Projects/source-product",
          platform: "react-web",
          harnessId: "claude",
          fileCount: 47,
          screenCount: 9,
          componentCount: 16,
        },
      }),
    );

    expect(imported.projects).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({
          kind: "repository",
          rootPath: "/Projects/source-product",
          harnessId: "claude",
          screenCount: 9,
        }),
      }),
    ]);
  });

  it("registers an importing project without forcing it open and promotes its lifecycle immutably", () => {
    const registered = projectLibraryReducer(
      createProjectLibraryState(),
      projectLibraryActions.createProject({
        activate: false,
        id: "streaming-import",
        lifecycle: "importing",
        name: "Streaming import",
        kind: "design",
        documentRef: "canvas:streaming-import",
        timestamp: "2026-07-31T12:00:00.000Z",
        source: {
          kind: "repository",
          label: "team/streaming-import",
          rootPath: "/Projects/streaming-import",
          platform: "react-web",
          harnessId: "deterministic-import",
          fileCount: 12,
          screenCount: 4,
          componentCount: 8,
        },
      }),
    );

    expect(registered.activeProjectId).toBeNull();
    expect(registered.projects[0]).toMatchObject({
      lifecycle: "importing",
    });

    const ready = projectLibraryReducer(
      registered,
      projectLibraryActions.setProjectLifecycle(
        "streaming-import",
        "ready",
        "2026-07-31T12:01:00.000Z",
      ),
    );
    expect(ready.projects[0]).toMatchObject({
      lifecycle: "ready",
      updatedAt: "2026-07-31T12:01:00.000Z",
    });
    expect(registered.projects[0]).toMatchObject({ lifecycle: "importing" });
  });

  it("preserves the protocol project identity allocated by the import runtime", () => {
    const runtimeProjectId = "prj_01J00000000000000000000000";
    const registered = projectLibraryReducer(
      createProjectLibraryState(),
      projectLibraryActions.createProject({
        activate: false,
        id: runtimeProjectId,
        lifecycle: "importing",
        name: "Runtime import",
        kind: "design",
        documentRef: `canvas:${runtimeProjectId}`,
        timestamp: "2026-07-31T12:00:00.000Z",
        source: {
          kind: "repository",
          label: "team/runtime-import",
          rootPath: "/Projects/runtime-import",
          platform: "react-web",
          harnessId: "deterministic-import",
          fileCount: 1,
          screenCount: 1,
          componentCount: 1,
        },
      }),
    );

    expect(registered.projects[0]?.id).toBe(runtimeProjectId);
    expect(registered.activeProjectId).toBeNull();
  });
});

describe("project library persistence", () => {
  it("round-trips a strictly bounded manifest", () => {
    const values = new Map<string, string>();
    const storage: ProjectLibraryStorage = {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => {
        values.delete(key);
      },
      setItem: (key, value) => values.set(key, value),
    };
    const persistence = createProjectLibraryPersistence(storage);
    const state = createProjectLibraryState([repositoryProject]);

    expect(persistence.save(state)).toBe(true);
    expect(persistence.load()).toEqual(state);
  });

  it("fails closed for malformed, oversized, and unavailable storage", () => {
    const malformed = createProjectLibraryPersistence({
      getItem: () => '{"schemaVersion":1,"projects":[{"id":"../../bad"}]}',
      removeItem: () => undefined,
      setItem: () => undefined,
    });
    const oversized = createProjectLibraryPersistence({
      getItem: () => "x".repeat(262_145),
      removeItem: () => undefined,
      setItem: () => undefined,
    });
    const unavailable = createProjectLibraryPersistence({
      getItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });

    expect(malformed.load()).toBeNull();
    expect(oversized.load()).toBeNull();
    expect(unavailable.load()).toBeNull();
    expect(
      unavailable.save(createProjectLibraryState([repositoryProject])),
    ).toBe(false);
  });
});
