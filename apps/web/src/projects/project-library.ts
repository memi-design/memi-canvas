import { z } from "zod";
import {
  ProjectIdSchema,
  type ProjectId,
} from "@memi/protocol";

const PROJECT_LIBRARY_KEY = "memi.project-library.v1";
const MAX_LIBRARY_BYTES = 262_144;
const MAX_PROJECTS = 1_000;
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const safeId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);
const timestamp = z.iso.datetime({ offset: true });
const repositoryPlatform = z.enum([
  "mixed",
  "react-native-expo",
  "react-web",
  "swiftui",
  "unknown",
]);
const projectLifecycle = z.enum([
  "attention",
  "draft",
  "importing",
  "ready",
]);

const ProjectSourceSchema = z.strictObject({
  kind: z.enum(["local", "repository", "app-store"]),
  label: z.string().trim().min(1).max(128),
  version: z.string().trim().min(1).max(64).optional(),
  rootPath: z.string().min(1).max(4_096).startsWith("/").optional(),
  platform: repositoryPlatform.optional(),
  harnessId: z.string().trim().min(1).max(64).optional(),
  fileCount: z.number().int().min(0).max(100_000).optional(),
  screenCount: z.number().int().min(0).max(10_000).optional(),
  componentCount: z.number().int().min(0).max(100_000).optional(),
}).superRefine((source, context) => {
  const repositoryFields = [
    source.rootPath,
    source.platform,
    source.harnessId,
    source.fileCount,
    source.screenCount,
    source.componentCount,
  ];
  if (
    source.kind !== "repository" &&
    repositoryFields.some((value) => value !== undefined)
  ) {
    context.addIssue({
      code: "custom",
      message: "Repository metadata is valid only for repository sources.",
    });
  }
  if (
    source.kind === "repository" &&
    (source.rootPath === undefined ||
      source.platform === undefined ||
      source.harnessId === undefined)
  ) {
    context.addIssue({
      code: "custom",
      message: "Repository sources require a path, platform, and harness.",
    });
  }
});

const ProjectRecordSchema = z.strictObject({
  id: safeId,
  name: z.string().trim().min(1).max(256),
  kind: z.enum(["design", "whiteboard"]),
  documentRef: z
    .string()
    .min(1)
    .max(256)
    .regex(/^(canvas|whiteboard):[A-Za-z0-9][A-Za-z0-9_-]*$/u),
  source: ProjectSourceSchema,
  updatedAt: timestamp,
  lastOpenedAt: timestamp.optional(),
  archived: z.boolean(),
  lifecycle: projectLifecycle.optional(),
});

const ProjectLibrarySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    projects: z.array(ProjectRecordSchema).max(MAX_PROJECTS),
    activeProjectId: safeId.nullable(),
  })
  .superRefine((library, context) => {
    const ids = library.projects.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Project identities must be unique.",
        path: ["projects"],
      });
    }
    if (
      library.activeProjectId !== null &&
      !ids.includes(library.activeProjectId)
    ) {
      context.addIssue({
        code: "custom",
        message: "The active project must exist in the library.",
        path: ["activeProjectId"],
      });
    }
  });

export type ProjectKind = z.infer<typeof ProjectRecordSchema>["kind"];
export type ProjectSource = z.infer<typeof ProjectSourceSchema>;
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

export interface ProjectLibraryState {
  readonly schemaVersion: 1;
  readonly projects: readonly ProjectRecord[];
  readonly activeProjectId: string | null;
}

export interface CreateProjectInput {
  readonly activate?: boolean;
  readonly id: string;
  readonly name: string;
  readonly kind: ProjectKind;
  readonly documentRef: string;
  readonly timestamp: string;
  readonly source?: ProjectSource;
  readonly lifecycle?: z.infer<typeof projectLifecycle>;
}

function fnv1a64(value: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

export function runtimeProjectIdForLocalProject(
  projectId: string,
): ProjectId {
  const authenticatedProjectId = ProjectIdSchema.safeParse(projectId);
  if (authenticatedProjectId.success) {
    return authenticatedProjectId.data;
  }
  const left = fnv1a64(`memi:project:${projectId}`);
  const right = fnv1a64(`memi:runtime:${projectId}`);
  let value = (left << 64n) | right;
  let body = "";
  for (let index = 0; index < 26; index += 1) {
    body = CROCKFORD_BASE32[Number(value & 31n)]! + body;
    value >>= 5n;
  }
  return ProjectIdSchema.parse(`prj_${body}`);
}

export type ProjectLibraryAction =
  | { readonly type: "create-project"; readonly input: CreateProjectInput }
  | {
      readonly type: "open-project";
      readonly projectId: string;
      readonly timestamp: string;
    }
  | {
      readonly type: "rename-project";
      readonly projectId: string;
      readonly name: string;
      readonly timestamp: string;
    }
  | {
      readonly type: "archive-project";
      readonly projectId: string;
      readonly timestamp: string;
    }
  | {
      readonly type: "delete-project";
      readonly projectId: string;
    }
  | {
      readonly type: "set-project-lifecycle";
      readonly projectId: string;
      readonly lifecycle: z.infer<typeof projectLifecycle>;
      readonly timestamp: string;
    }
  | { readonly type: "close-project" };

export const projectLibraryActions = {
  createProject(input: CreateProjectInput): ProjectLibraryAction {
    return { type: "create-project", input };
  },
  openProject(
    projectId: string,
    openedAt: string,
  ): ProjectLibraryAction {
    return { type: "open-project", projectId, timestamp: openedAt };
  },
  renameProject(
    projectId: string,
    name: string,
    updatedAt: string,
  ): ProjectLibraryAction {
    return {
      type: "rename-project",
      projectId,
      name,
      timestamp: updatedAt,
    };
  },
  archiveProject(
    projectId: string,
    archivedAt: string,
  ): ProjectLibraryAction {
    return {
      type: "archive-project",
      projectId,
      timestamp: archivedAt,
    };
  },
  deleteProject(projectId: string): ProjectLibraryAction {
    return { type: "delete-project", projectId };
  },
  setProjectLifecycle(
    projectId: string,
    lifecycle: z.infer<typeof projectLifecycle>,
    timestamp: string,
  ): ProjectLibraryAction {
    return {
      type: "set-project-lifecycle",
      projectId,
      lifecycle,
      timestamp,
    };
  },
  closeProject(): ProjectLibraryAction {
    return { type: "close-project" };
  },
};

function copyProjects(
  projects: readonly ProjectRecord[],
): readonly ProjectRecord[] {
  return projects.map((project) => ({
    ...project,
    source: { ...project.source },
  }));
}

function validTimestamp(value: string): boolean {
  return timestamp.safeParse(value).success;
}

export function createProjectLibraryState(
  projects: readonly ProjectRecord[] = [],
): ProjectLibraryState {
  const candidate = {
    schemaVersion: 1 as const,
    projects: copyProjects(projects),
    activeProjectId: null,
  };
  return ProjectLibrarySchema.parse(candidate);
}

function updateProject(
  state: ProjectLibraryState,
  projectId: string,
  update: (project: ProjectRecord) => ProjectRecord,
): ProjectLibraryState {
  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === projectId
        ? update({ ...project, source: { ...project.source } })
        : { ...project, source: { ...project.source } },
    ),
  };
}

export function projectLibraryReducer(
  state: ProjectLibraryState,
  action: ProjectLibraryAction,
): ProjectLibraryState {
  if (action.type === "close-project") {
    return {
      ...state,
      projects: copyProjects(state.projects),
      activeProjectId: null,
    };
  }

  if (action.type === "create-project") {
    const { input } = action;
    const candidate = ProjectRecordSchema.safeParse({
      id: input.id,
      name: input.name,
      kind: input.kind,
      documentRef: input.documentRef,
      source: input.source ?? { kind: "local", label: "Local file" },
      updatedAt: input.timestamp,
      lastOpenedAt: input.timestamp,
      archived: false,
      ...(input.lifecycle === undefined
        ? {}
        : { lifecycle: input.lifecycle }),
    });
    if (
      !candidate.success ||
      state.projects.some(({ id }) => id === candidate.data.id) ||
      state.projects.length >= MAX_PROJECTS
    ) {
      return { ...state, projects: copyProjects(state.projects) };
    }
    return {
      ...state,
      projects: [...copyProjects(state.projects), candidate.data],
      activeProjectId:
        input.activate === false
          ? state.activeProjectId
          : candidate.data.id,
    };
  }

  if (action.type === "delete-project") {
    if (!state.projects.some(({ id }) => id === action.projectId)) {
      return { ...state, projects: copyProjects(state.projects) };
    }
    return {
      ...state,
      projects: copyProjects(
        state.projects.filter(({ id }) => id !== action.projectId),
      ),
      activeProjectId:
        state.activeProjectId === action.projectId
          ? null
          : state.activeProjectId,
    };
  }

  const project = state.projects.find(
    ({ id }) => id === action.projectId,
  );
  if (project === undefined || !validTimestamp(action.timestamp)) {
    return { ...state, projects: copyProjects(state.projects) };
  }

  if (action.type === "open-project") {
    if (project.archived) {
      return { ...state, projects: copyProjects(state.projects) };
    }
    return {
      ...updateProject(state, project.id, (current) => ({
        ...current,
        lastOpenedAt: action.timestamp,
      })),
      activeProjectId: project.id,
    };
  }

  if (action.type === "rename-project") {
    const name = action.name.trim();
    if (name.length === 0 || name.length > 256) {
      return { ...state, projects: copyProjects(state.projects) };
    }
    return updateProject(state, project.id, (current) => ({
      ...current,
      name,
      updatedAt: action.timestamp,
    }));
  }

  if (action.type === "set-project-lifecycle") {
    return updateProject(state, project.id, (current) => ({
      ...current,
      lifecycle: action.lifecycle,
      updatedAt: action.timestamp,
    }));
  }

  return {
    ...updateProject(state, project.id, (current) => ({
      ...current,
      archived: true,
      updatedAt: action.timestamp,
    })),
    activeProjectId:
      state.activeProjectId === project.id
        ? null
        : state.activeProjectId,
  };
}

export interface ProjectLibraryStorage {
  readonly length?: number;
  getItem(key: string): string | null;
  key?(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface ProjectLibraryPersistence {
  load(): ProjectLibraryState | null;
  save(state: ProjectLibraryState): boolean;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function createProjectLibraryPersistence(
  storage: ProjectLibraryStorage,
): ProjectLibraryPersistence {
  return {
    load() {
      try {
        const serialized = storage.getItem(PROJECT_LIBRARY_KEY);
        if (
          serialized === null ||
          byteLength(serialized) > MAX_LIBRARY_BYTES
        ) {
          return null;
        }
        const parsed = ProjectLibrarySchema.safeParse(
          JSON.parse(serialized),
        );
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        const parsed = ProjectLibrarySchema.safeParse(state);
        if (!parsed.success) {
          return false;
        }
        const serialized = JSON.stringify(parsed.data);
        if (byteLength(serialized) > MAX_LIBRARY_BYTES) {
          return false;
        }
        storage.setItem(PROJECT_LIBRARY_KEY, serialized);
        return true;
      } catch {
        return false;
      }
    },
  };
}
