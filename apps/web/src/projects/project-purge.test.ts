import { describe, expect, it } from "vitest";

import { canvasWorkspaceKey } from "../canvas/canvas-workspace-persistence.js";
import { canvasAutosaveKey } from "../canvas/persistence.js";
import { repositoryProjectKey } from "../imports/repository/repository-project-persistence.js";
import { whiteboardDocumentKey } from "../whiteboard/whiteboard-persistence.js";
import {
  createProjectLibraryState,
  type ProjectLibraryStorage,
  type ProjectRecord,
} from "./project-library.js";
import {
  purgeAllProjectStorage,
  purgeProjectStorage,
  runTruthfulImportReset,
  stagedCaptureKey,
  TRUTHFUL_IMPORT_RESET_KEY,
} from "./project-purge.js";

const repositoryProject: ProjectRecord = {
  id: "northstar-mobile",
  name: "Northstar Mobile",
  kind: "design",
  documentRef: "canvas:northstar-mobile",
  source: {
    kind: "repository",
    label: "northstar/mobile",
    version: "a1b2c3d",
    rootPath: "/Projects/northstar-mobile",
    platform: "react-native-expo",
    harnessId: "codex",
  },
  updatedAt: "2026-07-29T20:00:00.000Z",
  archived: false,
};

const whiteboardProject: ProjectRecord = {
  id: "research-board",
  name: "Research",
  kind: "whiteboard",
  documentRef: "whiteboard:research-board",
  source: { kind: "local", label: "Local file" },
  updatedAt: "2026-07-29T20:00:00.000Z",
  archived: false,
};

function memoryStorage(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial));
  const removed: string[] = [];
  const storage: ProjectLibraryStorage = {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      removed.push(key);
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  return { removed, storage, values };
}

describe("project-owned persistence purge", () => {
  it("deletes one library record and only that project's owned records", () => {
    const documentId = "document-local-northstar-mobile";
    const stageKey = stagedCaptureKey(
      repositoryProject.id,
      "capture-home",
    );
    const otherStageKey = stagedCaptureKey(
      "other-project",
      "capture-home",
    );
    const sourcePath = repositoryProject.source.rootPath!;
    const memory = memoryStorage({
      [canvasAutosaveKey(documentId)]: "autosave",
      [canvasWorkspaceKey(documentId)]: "workspace",
      [canvasWorkspaceKey(repositoryProject.id)]: "legacy workspace",
      [repositoryProjectKey(repositoryProject.id)]: "manifest",
      [stageKey]: "staged capture",
      [otherStageKey]: "other capture",
      [sourcePath]: "must remain untouched",
      "unrelated.preference": "keep",
    });
    const initial = createProjectLibraryState([
      repositoryProject,
      whiteboardProject,
    ]);

    const result = purgeProjectStorage(
      memory.storage,
      initial,
      repositoryProject.id,
    );

    expect(result.status).toBe("purged");
    expect(result.state.projects).toEqual([whiteboardProject]);
    expect(memory.values.has(canvasAutosaveKey(documentId))).toBe(false);
    expect(memory.values.has(canvasWorkspaceKey(documentId))).toBe(false);
    expect(memory.values.has(canvasWorkspaceKey(repositoryProject.id)))
      .toBe(false);
    expect(memory.values.has(repositoryProjectKey(repositoryProject.id)))
      .toBe(false);
    expect(memory.values.has(stageKey)).toBe(false);
    expect(memory.values.get(otherStageKey)).toBe("other capture");
    expect(memory.values.get(sourcePath)).toBe("must remain untouched");
    expect(memory.values.get("unrelated.preference")).toBe("keep");
  });

  it("purges every project without clearing unrelated storage", () => {
    const memory = memoryStorage({
      [canvasAutosaveKey("document-local-northstar-mobile")]: "autosave",
      [whiteboardDocumentKey(whiteboardProject.documentRef)]: "board",
      [stagedCaptureKey(whiteboardProject.id, "capture-board")]:
        "capture",
      "memi.global-agent-settings.v1": "settings",
      "third-party.session": "session",
    });

    const result = purgeAllProjectStorage(
      memory.storage,
      createProjectLibraryState([
        repositoryProject,
        whiteboardProject,
      ]),
    );

    expect(result.status).toBe("purged");
    expect(result.state.projects).toEqual([]);
    expect(result.state.activeProjectId).toBeNull();
    expect(memory.values.get("memi.global-agent-settings.v1"))
      .toBe("settings");
    expect(memory.values.get("third-party.session")).toBe("session");
    expect(memory.storage.getItem("memi.project-library.v1")).toContain(
      '"projects":[]',
    );
  });

  it("fails closed when the reduced library cannot be persisted", () => {
    const memory = memoryStorage({
      [canvasAutosaveKey("document-local-northstar-mobile")]: "autosave",
    });
    const blocked: ProjectLibraryStorage = {
      ...memory.storage,
      setItem: () => {
        throw new Error("storage blocked");
      },
    };
    const initial = createProjectLibraryState([repositoryProject]);

    const result = purgeProjectStorage(
      blocked,
      initial,
      repositoryProject.id,
    );

    expect(result.status).toBe("library-save-failed");
    expect(result.state).toEqual(initial);
    expect(memory.removed).toEqual([]);
  });

  it("reports cleanup failures after the record is durably deleted", () => {
    const autosaveKey = canvasAutosaveKey(
      "document-local-northstar-mobile",
    );
    const memory = memoryStorage({ [autosaveKey]: "autosave" });
    const blocked: ProjectLibraryStorage = {
      ...memory.storage,
      removeItem: (key) => {
        if (key === autosaveKey) throw new Error("locked");
        memory.storage.removeItem(key);
      },
    };

    const result = purgeProjectStorage(
      blocked,
      createProjectLibraryState([repositoryProject]),
      repositoryProject.id,
    );

    expect(result.status).toBe("partial");
    expect(result.state.projects).toEqual([]);
    expect(result.failedKeys).toEqual([autosaveKey]);
    expect(memory.values.get(autosaveKey)).toBe("autosave");
  });

  it("performs the truthful-import reset once, including orphaned owned keys", () => {
    const orphanedAutosave = canvasAutosaveKey("orphaned-document");
    const sourcePath = "/Projects/northstar-mobile";
    const memory = memoryStorage({
      [orphanedAutosave]: "old autosave",
      [canvasWorkspaceKey("orphaned-workspace")]: "old workspace",
      [repositoryProjectKey("orphaned-project")]: "old repository record",
      [stagedCaptureKey("orphaned-project", "capture-home")]:
        "old capture",
      [sourcePath]: "repository remains untouched",
      "memi.global-agent-settings.v1": "settings remain",
    });

    const first = runTruthfulImportReset(
      memory.storage,
      createProjectLibraryState([repositoryProject]),
    );

    expect(first.status).toBe("purged");
    expect(first.state.projects).toEqual([]);
    expect(memory.values.get(TRUTHFUL_IMPORT_RESET_KEY)).toBe("complete");
    expect(memory.values.has(orphanedAutosave)).toBe(false);
    expect(memory.values.get(sourcePath)).toBe(
      "repository remains untouched",
    );
    expect(memory.values.get("memi.global-agent-settings.v1"))
      .toBe("settings remain");

    const newProject = {
      ...repositoryProject,
      id: "created-after-reset",
      documentRef: "canvas:created-after-reset",
    };
    const newAutosave = canvasAutosaveKey(
      "document-local-created-after-reset",
    );
    memory.storage.setItem(newAutosave, "new autosave");
    const secondState = createProjectLibraryState([newProject]);

    const second = runTruthfulImportReset(memory.storage, secondState);

    expect(second.status).toBe("already-complete");
    expect(second.state).toEqual(secondState);
    expect(memory.values.get(newAutosave)).toBe("new autosave");
  });

  it("reruns the expanded reset when only the legacy v1 marker exists", () => {
    const orphanedAutosave = canvasAutosaveKey("legacy-document");
    const memory = memoryStorage({
      "memi.truthful-import-reset.v1": "complete",
      [orphanedAutosave]: "legacy autosave",
    });

    const result = runTruthfulImportReset(
      memory.storage,
      createProjectLibraryState([repositoryProject]),
    );

    expect(result.status).toBe("purged");
    expect(result.state.projects).toEqual([]);
    expect(memory.values.has(orphanedAutosave)).toBe(false);
    expect(memory.values.get(TRUTHFUL_IMPORT_RESET_KEY)).toBe("complete");
  });

  it("does not mark a partial startup reset complete so cleanup can retry", () => {
    const autosaveKey = canvasAutosaveKey("orphaned-document");
    const memory = memoryStorage({ [autosaveKey]: "old autosave" });
    const blocked: ProjectLibraryStorage = {
      ...memory.storage,
      removeItem: (key) => {
        if (key === autosaveKey) throw new Error("locked");
        memory.storage.removeItem(key);
      },
    };

    const result = runTruthfulImportReset(
      blocked,
      createProjectLibraryState(),
    );

    expect(result.status).toBe("partial");
    expect(memory.values.has(TRUTHFUL_IMPORT_RESET_KEY)).toBe(false);
    expect(memory.values.get(autosaveKey)).toBe("old autosave");
  });
});
