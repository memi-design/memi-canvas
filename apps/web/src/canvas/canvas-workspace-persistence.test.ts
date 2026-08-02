import { describe, expect, it } from "vitest";

import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";

import { createSceneState } from "./model.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import {
  canvasWorkspaceKey,
  createCanvasWorkspacePersistence,
  readLegacyCanvasWorkspaceV3Migration,
} from "./canvas-workspace-persistence.js";

function legacyWorkspaceManifest(): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "memi-canvas-workspace",
    workspaceId: "northstar-product-canvas",
    activePageId: "local-canvas-1",
    nextLocalPageNumber: 2,
    localPages: [{ id: "local-canvas-1", name: "Untitled canvas 1" }],
  });
}

describe("canvas workspace manifest", () => {
  it("exposes legacy local storage as a migration reader, never a write authority", () => {
    const storage = new Map<string, string>();
    const persistence = createCanvasWorkspacePersistence({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    });

    expect(persistence).not.toHaveProperty("save");
    storage.set(
      canvasWorkspaceKey("northstar-product-canvas"),
      legacyWorkspaceManifest(),
    );
    expect(
      persistence.load(
        "northstar-product-canvas",
        createSceneState(canvasWorkbenchFixture),
      ),
    ).toMatchObject({
      activePageId: "local-canvas-1",
      nextLocalPageNumber: 2,
      pages: [
        { id: "source-import", kind: "imported", name: "Imported source" },
        {
          id: "local-canvas-1",
          kind: "local",
          name: "Untitled canvas 1",
          scene: { nodes: [] },
        },
      ],
    });

    const serialized = legacyWorkspaceManifest();
    expect(serialized).not.toContain("document-dashboard");
    expect(serialized).not.toContain('"nodes"');
  });

  it("converts the validated local-storage manifest into V3 page intents once", () => {
    const storage = new Map<string, string>();
    storage.set(
      canvasWorkspaceKey("northstar-product-canvas"),
      legacyWorkspaceManifest(),
    );
    const document = createCanvasDocumentV3({
      id: "doc_01J00000000000000000000000",
      projectId: "prj_01J00000000000000000000000",
      initialPage: {
        id: "pag_01J00000000000000000000000",
        kind: "imported",
        name: "Imported source",
      },
    });

    const migration = readLegacyCanvasWorkspaceV3Migration(
      {
        getItem: (key) => storage.get(key) ?? null,
      },
      "northstar-product-canvas",
      document,
    );

    expect(migration).not.toBeNull();
    expect(migration?.migrationKey).toBe(
      `local-storage:${canvasWorkspaceKey("northstar-product-canvas")}`,
    );
    expect(migration?.legacyRecordHash).toMatch(/^fnv1a64:[a-f0-9]{16}$/u);
    expect(migration?.activePageId).toMatch(/^pag_/u);
    expect(migration?.actions).toEqual([
      {
        type: "page.define",
        payload: {
          pageId: migration?.activePageId,
          next: {
            id: migration?.activePageId,
            kind: "design",
            name: "Untitled canvas 1",
            rootIds: [],
          },
        },
      },
    ]);
    expect(JSON.stringify(migration)).not.toContain("scene");

    const operation = prepareCanvasOperationV3(document, {
      id: "opn_01J00000000000000000000000",
      actor: "system",
      actorId: "legacy-workspace-migration",
      occurredAt: "2026-07-31T21:10:00.000Z",
      label: "Migrate workspace pages",
      action: { type: "atomic.batch", payload: { actions: migration!.actions } },
    });
    const migrated = applyCanvasOperationV3(document, operation);
    expect(migrated.pagesById[migration!.activePageId]?.name).toBe(
      "Untitled canvas 1",
    );
  });

  it("fails closed for malformed, cross-workspace, and duplicate manifests", () => {
    const key = canvasWorkspaceKey("northstar-product-canvas");
    const invalid = [
      "{bad-json",
      JSON.stringify({ schemaVersion: 2 }),
      JSON.stringify({
        schemaVersion: 1,
        kind: "memi-canvas-workspace",
        workspaceId: "another-workspace",
        activePageId: "source-import",
        nextLocalPageNumber: 1,
        localPages: [],
      }),
      JSON.stringify({
        schemaVersion: 1,
        kind: "memi-canvas-workspace",
        workspaceId: "northstar-product-canvas",
        activePageId: "local-canvas-1",
        nextLocalPageNumber: 2,
        localPages: [
          { id: "local-canvas-1", name: "One" },
          { id: "local-canvas-1", name: "Duplicate" },
        ],
      }),
      JSON.stringify({
        schemaVersion: 1,
        kind: "memi-canvas-workspace",
        workspaceId: "northstar-product-canvas",
        activePageId: "source-import",
        nextLocalPageNumber: 2,
        localPages: [{ id: "source-import", name: "Forged collision" }],
      }),
    ];

    for (const record of invalid) {
      const persistence = createCanvasWorkspacePersistence({
        getItem: () => record,
        setItem: () => undefined,
      });
      expect(
        persistence.load(
          "northstar-product-canvas",
          createSceneState(canvasWorkbenchFixture),
        ),
      ).toBeNull();
    }
    expect(key).toContain("memi.canvas.workspace.v1:");
  });

  it("fails closed when storage is unavailable", () => {
    const persistence = createCanvasWorkspacePersistence({
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("unavailable");
      },
    });

    expect(
      persistence.load(
        "northstar-product-canvas",
        createSceneState(canvasWorkbenchFixture),
      ),
    ).toBeNull();
  });
});
