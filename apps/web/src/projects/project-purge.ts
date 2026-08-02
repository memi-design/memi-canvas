import { canvasWorkspaceKey } from "../canvas/canvas-workspace-persistence.js";
import { canvasAutosaveKey } from "../canvas/persistence.js";
import { repositoryProjectKey } from "../imports/repository/repository-project-persistence.js";
import { whiteboardDocumentKey } from "../whiteboard/whiteboard-persistence.js";
import {
  createProjectLibraryPersistence,
  createProjectLibraryState,
  projectLibraryActions,
  projectLibraryReducer,
  type ProjectLibraryState,
  type ProjectLibraryStorage,
  type ProjectRecord,
} from "./project-library.js";

const STAGED_CAPTURE_PREFIX = "memi.capture-stage.v1:";
export const TRUTHFUL_IMPORT_RESET_KEY =
  "memi.truthful-import-reset.v2";
const OWNED_PROJECT_PREFIXES = Object.freeze([
  canvasAutosaveKey(""),
  canvasWorkspaceKey(""),
  repositoryProjectKey(""),
  whiteboardDocumentKey(""),
  STAGED_CAPTURE_PREFIX,
]);

export type ProjectPurgeStatus =
  | "missing"
  | "already-complete"
  | "library-save-failed"
  | "marker-save-failed"
  | "purged"
  | "partial";

export interface ProjectPurgeResult {
  readonly status: ProjectPurgeStatus;
  readonly state: ProjectLibraryState;
  readonly removedKeys: readonly string[];
  readonly failedKeys: readonly string[];
}

function documentId(project: ProjectRecord): string | null {
  if (!project.documentRef.startsWith("canvas:")) {
    return null;
  }
  return project.documentRef.replace("canvas:", "document-local-");
}

function stagedCapturePrefix(projectId: string): string {
  return `${STAGED_CAPTURE_PREFIX}${encodeURIComponent(projectId)}:`;
}

export function stagedCaptureKey(
  projectId: string,
  captureId: string,
): string {
  return `${stagedCapturePrefix(projectId)}${encodeURIComponent(captureId)}`;
}

function enumerableStorageKeys(
  storage: ProjectLibraryStorage,
): readonly string[] {
  if (storage.key === undefined || storage.length === undefined) {
    return [];
  }
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

function ownedStorageKeys(
  storage: ProjectLibraryStorage,
  project: ProjectRecord,
): readonly string[] {
  const keys = new Set<string>();
  const canvasDocumentId = documentId(project);
  if (canvasDocumentId !== null) {
    keys.add(canvasAutosaveKey(canvasDocumentId));
    keys.add(canvasAutosaveKey(project.id));
    keys.add(canvasWorkspaceKey(canvasDocumentId));
    keys.add(canvasWorkspaceKey(project.id));
    keys.add(repositoryProjectKey(project.id));
  } else {
    keys.add(whiteboardDocumentKey(project.documentRef));
  }
  const capturePrefix = stagedCapturePrefix(project.id);
  for (const key of enumerableStorageKeys(storage)) {
    if (key.startsWith(capturePrefix)) keys.add(key);
  }
  return [...keys];
}

function removeOwnedStorage(
  storage: ProjectLibraryStorage,
  keys: readonly string[],
): Pick<ProjectPurgeResult, "removedKeys" | "failedKeys"> {
  const removedKeys: string[] = [];
  const failedKeys: string[] = [];
  for (const key of keys) {
    try {
      storage.removeItem(key);
      removedKeys.push(key);
    } catch {
      failedKeys.push(key);
    }
  }
  return { removedKeys, failedKeys };
}

function saveThenRemove(
  storage: ProjectLibraryStorage,
  previous: ProjectLibraryState,
  next: ProjectLibraryState,
  projects: readonly ProjectRecord[],
): ProjectPurgeResult {
  if (!createProjectLibraryPersistence(storage).save(next)) {
    return {
      status: "library-save-failed",
      state: previous,
      removedKeys: [],
      failedKeys: [],
    };
  }
  const keys = projects.flatMap((project) =>
    ownedStorageKeys(storage, project),
  );
  const cleanup = removeOwnedStorage(storage, [...new Set(keys)]);
  return {
    status: cleanup.failedKeys.length === 0 ? "purged" : "partial",
    state: next,
    ...cleanup,
  };
}

export function purgeProjectStorage(
  storage: ProjectLibraryStorage,
  state: ProjectLibraryState,
  projectId: string,
): ProjectPurgeResult {
  const project = state.projects.find(({ id }) => id === projectId);
  if (project === undefined) {
    return {
      status: "missing",
      state,
      removedKeys: [],
      failedKeys: [],
    };
  }
  const next = projectLibraryReducer(
    state,
    projectLibraryActions.deleteProject(projectId),
  );
  return saveThenRemove(storage, state, next, [project]);
}

export function purgeAllProjectStorage(
  storage: ProjectLibraryStorage,
  state: ProjectLibraryState,
): ProjectPurgeResult {
  if (state.projects.length === 0) {
    return {
      status: "purged",
      state: createProjectLibraryState(),
      removedKeys: [],
      failedKeys: [],
    };
  }
  return saveThenRemove(
    storage,
    state,
    createProjectLibraryState(),
    state.projects,
  );
}

export function runTruthfulImportReset(
  storage: ProjectLibraryStorage,
  state: ProjectLibraryState,
): ProjectPurgeResult {
  try {
    if (storage.getItem(TRUTHFUL_IMPORT_RESET_KEY) === "complete") {
      return {
        status: "already-complete",
        state,
        removedKeys: [],
        failedKeys: [],
      };
    }
  } catch {
    return {
      status: "library-save-failed",
      state,
      removedKeys: [],
      failedKeys: [],
    };
  }
  const empty = createProjectLibraryState();
  if (!createProjectLibraryPersistence(storage).save(empty)) {
    return {
      status: "library-save-failed",
      state,
      removedKeys: [],
      failedKeys: [],
    };
  }
  const projectKeys = state.projects.flatMap((project) =>
    ownedStorageKeys(storage, project),
  );
  const orphanedKeys = enumerableStorageKeys(storage).filter((key) =>
    OWNED_PROJECT_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
  const cleanup = removeOwnedStorage(
    storage,
    [...new Set([...projectKeys, ...orphanedKeys])],
  );
  if (cleanup.failedKeys.length > 0) {
    return {
      status: "partial",
      state: empty,
      ...cleanup,
    };
  }
  try {
    storage.setItem(TRUTHFUL_IMPORT_RESET_KEY, "complete");
  } catch {
    return {
      status: "marker-save-failed",
      state: empty,
      ...cleanup,
    };
  }
  return {
    status: "purged",
    state: empty,
    ...cleanup,
  };
}
