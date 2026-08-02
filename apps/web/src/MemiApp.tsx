import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { ProjectHome } from "./home/ProjectHome.js";
import {
  createWorkspaceProfilePersistence,
  DEFAULT_WORKSPACE_PROFILE,
  type WorkspaceProfile,
  type WorkspaceProfileStorage,
} from "./home/workspace-profile.js";
import { LocalDesignConsumer } from "./projects/LocalDesignConsumer.js";
import {
  createProjectLibraryPersistence,
  createProjectLibraryState,
  projectLibraryActions,
  projectLibraryReducer,
  type ProjectLibraryPersistence,
  type ProjectLibraryStorage,
  type ProjectRecord,
  runtimeProjectIdForLocalProject,
} from "./projects/project-library.js";
import {
  purgeProjectStorage,
  runTruthfulImportReset,
} from "./projects/project-purge.js";
import { WhiteboardCanvas } from "./whiteboard/WhiteboardCanvas.js";
import {
  createStarterWhiteboard,
  type WhiteboardState,
} from "./whiteboard/whiteboard-model.js";
import {
  createWhiteboardPersistence,
  type WhiteboardStorage,
} from "./whiteboard/whiteboard-persistence.js";
import {
  FigmaImportDialog,
} from "./imports/figma/FigmaImportDialog.js";
import {
  createFigmaCanvasProject,
} from "./imports/figma/figma-workbench.js";
import { GlobalSettingsPanel } from "./settings/GlobalSettingsPanel.js";
import {
  DEFAULT_GLOBAL_AGENT_SETTINGS,
  createGlobalAgentSettingsPersistence,
  type AdapterRuntimeConnection,
  type GlobalAgentSettings,
  type GlobalAgentSettingsPersistence,
  type GlobalAgentSettingsStorage,
} from "./settings/global-settings.js";
import type { CanvasRuntimePortV1 } from "./canvas/canvas-runtime-port.js";
import {
  createCanvasAutosave,
  type CanvasStorage,
} from "./canvas/persistence.js";
import { createSceneState } from "./canvas/model.js";
import {
  RepositoryImportDialog,
} from "./imports/repository/RepositoryImportDialog.js";
import type { RepositoryImporter } from "./imports/repository/repository-import.js";
import {
  createCapturedRepositoryCanvasProject,
} from "./imports/repository/repository-capture-workbench.js";
import {
  repositoryProjectFromCommittedImport,
  repositoryRecordFromCommittedImport,
} from "./imports/repository/committed-import-hydration.js";
import {
  repositoryImportJobView,
  type RepositoryCaptureRuntime,
} from "./imports/repository/repository-capture-runtime.js";
import type { ImportJobSnapshotV2 } from "@memi/protocol";
import type { RuntimeClientV1 } from "./runtime/runtime-client.js";
import {
  createRepositoryProjectPersistence,
} from "./imports/repository/repository-project-persistence.js";
import type {
  RepositoryReconstructionArtifactLoader,
} from "./imports/repository/repository-reconstruction-rehydration.js";
import {
  persistCommittedImportCanvasDocumentV3,
} from "./imports/repository/committed-import-v3-hydration.js";
import {
  acceptsImportJobSnapshot,
  selectLatestImportJob,
} from "./imports/repository/import-job-revision.js";
import {
  LANDING_PAGE_DEMO_SOURCE_LABEL,
} from "./projects/landing-page-demo.js";
import { chooseRepositoryFolder } from "./platform/repository-folder.js";
import {
  canvasAgentDefaults,
  homeProject,
} from "./projects/app-view-model.js";
import { WorkspaceRecoveryBlocked } from "./projects/WorkspaceRecoveryBlocked.js";
import "./memi-app.css";

export interface MemiStorage
  extends ProjectLibraryStorage,
    CanvasStorage,
    GlobalAgentSettingsStorage,
    WorkspaceProfileStorage,
    WhiteboardStorage {}

export interface MemiAppProps {
  readonly idFactory?: () => string;
  readonly now?: () => string;
  readonly runtimePort?: CanvasRuntimePortV1;
  readonly runtimeConnections?: readonly AdapterRuntimeConnection[];
  readonly storage?: MemiStorage;
  readonly repositoryImporter?: RepositoryImporter;
  readonly repositoryCaptureRuntime?: RepositoryCaptureRuntime;
  readonly reconstructionArtifactLoader?:
    RepositoryReconstructionArtifactLoader;
  readonly runtimeClient?: Pick<RuntimeClientV1, "sessions" | "canvasDocuments"> &
    Partial<Pick<RuntimeClientV1, "imports">>;
  readonly truthfulImportResetReady?: boolean;
}

function persistenceBoundary(
  storage: MemiStorage | undefined,
  truthfulImportResetReady: boolean,
): {
  readonly storage?: MemiStorage;
  readonly persistence?: ProjectLibraryPersistence;
  readonly profilePersistence?: ReturnType<
    typeof createWorkspaceProfilePersistence
  >;
  readonly settingsPersistence?: GlobalAgentSettingsPersistence;
  readonly truthfulImportResetReady: boolean;
} {
  try {
    const availableStorage = storage ?? globalThis.localStorage;
    return {
      storage: availableStorage,
      persistence: createProjectLibraryPersistence(availableStorage),
      profilePersistence: createWorkspaceProfilePersistence(availableStorage),
      settingsPersistence:
        createGlobalAgentSettingsPersistence(availableStorage),
      truthfulImportResetReady,
    };
  } catch {
    return { truthfulImportResetReady };
  }
}

function initialLibrary(boundary: {
  readonly storage?: MemiStorage;
  readonly persistence?: ProjectLibraryPersistence;
  readonly truthfulImportResetReady: boolean;
}) {
  if (!boundary.truthfulImportResetReady) {
    return { ready: false, state: createProjectLibraryState() };
  }
  const state =
    boundary.persistence?.load() ?? createProjectLibraryState();
  if (boundary.storage === undefined) {
    return { ready: true, state };
  }
  const reset = runTruthfulImportReset(boundary.storage, state);
  return {
    ready:
      reset.status === "already-complete" || reset.status === "purged",
    state: reset.state,
  };
}

const unavailableRepositoryImporter: RepositoryImporter = async () => {
  throw new Error(
    "The durable runtime capture service is unavailable. " +
      "Memi did not create a filename-scan project.",
  );
};

function WorkspaceHeader({
  name,
  onExit,
}: {
  readonly name: string;
  readonly onExit: () => void;
}) {
  return (
    <header className="memi-workspace-header">
      <button
        aria-label="Back to projects"
        onClick={onExit}
        title="Back to projects"
        type="button"
      >
        ←
      </button>
      <span>
        <strong>{name}</strong>
        <small>Whiteboard</small>
      </span>
    </header>
  );
}

function WhiteboardProjectConsumer({
  onExit,
  project,
  storage,
}: {
  readonly onExit: () => void;
  readonly project: ProjectRecord;
  readonly storage: WhiteboardStorage;
}) {
  const [persistence] = useState(() =>
    createWhiteboardPersistence(storage),
  );
  const [documentRead] = useState(() =>
    persistence.read(project.documentRef),
  );
  const [saveFailed, setSaveFailed] = useState(false);
  const [initialState] = useState<WhiteboardState>(() => {
    const recovered =
      documentRead.status === "ready"
        ? documentRead.document
        : undefined;
    return (
      recovered ?? {
        ...createStarterWhiteboard(project.name),
        id: project.id,
      }
    );
  });
  const saveState = useCallback(
    (state: WhiteboardState) => {
      setSaveFailed(
        !persistence.save(project.documentRef, state),
      );
    },
    [persistence, project.documentRef],
  );

  if (documentRead.status === "invalid") {
    return (
      <main className="memi-board-workspace">
        <WorkspaceHeader name={project.name} onExit={onExit} />
        <div className="memi-storage-blocked" role="alert">
          This whiteboard could not be opened safely. Its stored data was
          preserved and has not been replaced.
          <button onClick={onExit} type="button">
            Back to projects
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="memi-board-workspace">
      <WorkspaceHeader name={project.name} onExit={onExit} />
      {saveFailed ? (
        <div className="memi-storage-blocked" role="alert">
          Changes are not saved. Keep this window open and free local
          storage before continuing.
        </div>
      ) : null}
      <WhiteboardCanvas
        initialState={initialState}
        onStateChange={saveState}
      />
    </main>
  );
}

// Atomic Design: page — project home and typed file routing boundary.
export function MemiApp({
  idFactory = () => globalThis.crypto.randomUUID(),
  now = () => new Date().toISOString(),
  runtimePort,
  runtimeConnections = [],
  storage,
  repositoryImporter = unavailableRepositoryImporter,
  repositoryCaptureRuntime,
  reconstructionArtifactLoader,
  runtimeClient,
  truthfulImportResetReady = true,
}: MemiAppProps) {
  const [boundary] = useState(() =>
    persistenceBoundary(storage, truthfulImportResetReady));
  const [libraryStartup] = useState(() => initialLibrary(boundary));
  const [figmaImportOpen, setFigmaImportOpen] = useState(false);
  const [repositoryImportOpen, setRepositoryImportOpen] = useState(false);
  const [repositoryImportJob, setRepositoryImportJob] =
    useState<ImportJobSnapshotV2>();
  const repositoryImportJobRef =
    useRef<ImportJobSnapshotV2 | undefined>(undefined);
  const hydratedImportKeysRef = useRef(new Set<string>());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentSettings, setAgentSettings] = useState<GlobalAgentSettings>(
    () =>
      boundary.settingsPersistence?.load() ??
      DEFAULT_GLOBAL_AGENT_SETTINGS,
  );
  const [workspaceProfile, setWorkspaceProfile] = useState<WorkspaceProfile>(
    () => boundary.profilePersistence?.load() ?? DEFAULT_WORKSPACE_PROFILE,
  );
  const [library, dispatch] = useReducer(
    projectLibraryReducer,
    libraryStartup.state,
  );
  const activeProject = library.projects.find(
    ({ id }) => id === library.activeProjectId,
  );

  useEffect(() => {
    if (libraryStartup.ready) {
      boundary.persistence?.save(library);
    }
  }, [
    boundary.persistence,
    libraryStartup.ready,
    library,
  ]);

  const closeProject = () => {
    dispatch(projectLibraryActions.closeProject());
  };
  const publishRepositoryImportJob = useCallback(
    (next: ImportJobSnapshotV2) => {
      const accepted = acceptsImportJobSnapshot(
        repositoryImportJobRef.current,
        next,
      );
      if (!accepted) return false;
      const selected = selectLatestImportJob(
        repositoryImportJobRef.current,
        next,
      );
      if (selected === repositoryImportJobRef.current) return true;
      repositoryImportJobRef.current = selected;
      setRepositoryImportJob(selected);
      return true;
    },
    [],
  );
  const clearRepositoryImportJob = useCallback(() => {
    repositoryImportJobRef.current = undefined;
    setRepositoryImportJob(undefined);
  }, []);

  useEffect(() => {
    if (
      !libraryStartup.ready ||
      boundary.storage === undefined ||
      runtimeClient?.imports === undefined
    ) {
      return;
    }
    const durableStorage = boundary.storage;
    const imports = runtimeClient.imports;
    let cancelled = false;
    void imports.list().then(async ({ jobs }) => {
      if (cancelled) return;
      for (const listedJob of jobs) {
        if (
          listedJob.state !== "committed" ||
          listedJob.projectId === null ||
          listedJob.progress.remaining !== 0
        ) {
          continue;
        }
        const hydrationKey = `${listedJob.id}:${listedJob.revision}`;
        if (hydratedImportKeysRef.current.has(hydrationKey)) continue;
        try {
          const { job } = await imports.get({
            jobId: listedJob.id,
          });
          if (
            cancelled ||
            job.state !== "committed" ||
            job.projectId === null ||
            job.progress.remaining !== 0 ||
            job.revision !== listedJob.revision
          ) {
            continue;
          }
          const project = repositoryProjectFromCommittedImport(job);
          const repositoryRecord = repositoryRecordFromCommittedImport(job);
          const canvasProject = createCapturedRepositoryCanvasProject({
            artifactReference: (artifact) => {
              const reference =
                repositoryRecord.capture?.artifactReferences[artifact.id];
              if (reference === undefined) {
                throw new Error(
                  `Committed capture artifact ${artifact.id} is unavailable.`,
                );
              }
              return reference;
            },
            harnessId: repositoryRecord.harnessId,
            job,
            manifest: repositoryRecord.manifest,
            projectId: project.id,
          });
          await persistCommittedImportCanvasDocumentV3({
            canvasProject,
            job,
            ...(reconstructionArtifactLoader === undefined
              ? {}
              : { loader: reconstructionArtifactLoader }),
            record: repositoryRecord,
            runtimeClient,
          });
          const repositoryPersistence =
            createRepositoryProjectPersistence(durableStorage);
          if (!repositoryPersistence.save(project.id, repositoryRecord)) {
            continue;
          }
          hydratedImportKeysRef.current.add(hydrationKey);
          dispatch(
            projectLibraryActions.createProject({
              activate: false,
              id: project.id,
              name: project.name,
              kind: "design",
              documentRef: project.documentRef,
              lifecycle: project.lifecycle ?? "ready",
              source: project.source,
              timestamp: project.updatedAt,
            }),
          );
        } catch {
          // A malformed durable record stays visible in runtime diagnostics,
          // but never becomes a partially reconstructed local project.
        }
      }
    }).catch(() => {
      // Native runtime recovery remains non-blocking for local-only files.
    });
    return () => {
      cancelled = true;
    };
  }, [
    boundary.storage,
    libraryStartup.ready,
    reconstructionArtifactLoader,
    runtimeClient,
  ]);

  if (!libraryStartup.ready) {
    return <WorkspaceRecoveryBlocked />;
  }

  if (settingsOpen && activeProject === undefined) {
    return (
      <GlobalSettingsPanel
        initialSettings={agentSettings}
        onClose={() => setSettingsOpen(false)}
        onSave={(nextSettings) => {
          if (boundary.settingsPersistence === undefined) {
            setAgentSettings(nextSettings);
            return true;
          }
          const saved =
            boundary.settingsPersistence.save(nextSettings);
          if (saved) {
            setAgentSettings(nextSettings);
          }
          return saved;
        }}
        runtimeConnections={runtimeConnections}
        storageAvailable={boundary.settingsPersistence !== undefined}
      />
    );
  }

  if (activeProject?.kind === "design") {
    if (boundary.storage === undefined) {
      return (
        <div className="memi-storage-blocked" role="alert">
          This design file needs local storage before it can open safely.
          <button onClick={closeProject} type="button">
            Back to projects
          </button>
        </div>
      );
    }
    return (
      <LocalDesignConsumer
        agentDefaults={canvasAgentDefaults(
          agentSettings,
          activeProject.source.kind === "repository"
            ? activeProject.source.harnessId
            : undefined,
        )}
        onExit={closeProject}
        project={activeProject}
        {...(runtimeClient === undefined
          ? {}
          : {
              runtimeClient,
              runtimeProjectId:
                runtimeProjectIdForLocalProject(activeProject.id),
            })}
        {...(runtimePort === undefined ? {} : { runtimePort })}
        {...(reconstructionArtifactLoader === undefined
          ? {}
          : { reconstructionArtifactLoader })}
        storage={boundary.storage}
      />
    );
  }

  if (activeProject?.kind === "whiteboard") {
    if (boundary.storage === undefined) {
      return (
        <div className="memi-storage-blocked" role="alert">
          This whiteboard needs local storage before it can open safely.
          <button onClick={closeProject} type="button">
            Back to projects
          </button>
        </div>
      );
    }
    if (
      activeProject.documentRef !==
      `whiteboard:${activeProject.id}`
    ) {
      return (
        <div className="memi-storage-blocked" role="alert">
          This whiteboard has an invalid document reference and cannot be
          opened.
          <button onClick={closeProject} type="button">
            Back to projects
          </button>
        </div>
      );
    }
    return (
      <WhiteboardProjectConsumer
        key={activeProject.documentRef}
        onExit={closeProject}
        project={activeProject}
        storage={boundary.storage}
      />
    );
  }

  const activeProjects = library.projects.filter(
    ({ archived }) => !archived,
  );
  const homeStorage = boundary.storage;
  return (
    <>
      <ProjectHome
      enabledProjectActions={["archive", "delete"]}
      onCreateProject={(kind) => {
        const projectId = idFactory();
        const count =
          activeProjects.filter(
            (project) =>
              project.kind === kind &&
              project.source.kind === "local",
          ).length + 1;
        dispatch(
          projectLibraryActions.createProject({
            id: projectId,
            name:
              kind === "design"
                ? `Untitled design ${count}`
                : `Untitled whiteboard ${count}`,
            kind,
            documentRef: `${kind === "design" ? "canvas" : "whiteboard"}:${projectId}`,
            timestamp: now(),
          }),
        );
      }}
      onCreateLandingPageDemo={() => {
        const projectId = idFactory();
        dispatch(
          projectLibraryActions.createProject({
            id: projectId,
            name: "Landing page starter",
            kind: "design",
            documentRef: `canvas:${projectId}`,
            source: {
              kind: "local",
              label: LANDING_PAGE_DEMO_SOURCE_LABEL,
            },
            timestamp: now(),
          }),
        );
      }}
      {...(homeStorage === undefined
        ? {}
        : {
            onImportFigma: () => setFigmaImportOpen(true),
            onImportProject: () => setRepositoryImportOpen(true),
          })}
      onOpenProject={(projectId) => {
        dispatch(projectLibraryActions.openProject(projectId, now()));
      }}
      onOpenSettings={() => setSettingsOpen(true)}
      onProfileChange={(nextProfile) => {
        const candidate: WorkspaceProfile = {
          kind: "memi-workspace-profile",
          schemaVersion: 1,
          userName: nextProfile.userName,
          workspaceName: nextProfile.workspaceName,
        };
        if (boundary.profilePersistence?.save(candidate) ?? true) {
          setWorkspaceProfile(candidate);
        }
      }}
      onProjectAction={(projectId, action) => {
        if (action === "archive") {
          dispatch(projectLibraryActions.archiveProject(projectId, now()));
          return;
        }
        if (action === "delete") {
          if (homeStorage === undefined) {
            dispatch(projectLibraryActions.deleteProject(projectId));
            return;
          }
          const purge = purgeProjectStorage(
            homeStorage,
            library,
            projectId,
          );
          if (
            purge.status === "purged" ||
            purge.status === "partial"
          ) {
            dispatch(projectLibraryActions.deleteProject(projectId));
          }
        }
      }}
      projects={activeProjects.map(homeProject)}
      userName={workspaceProfile.userName}
      workspaceName={workspaceProfile.workspaceName}
      />
      {figmaImportOpen && homeStorage !== undefined ? (
        <FigmaImportDialog
          onClose={() => setFigmaImportOpen(false)}
          onImport={(result) => {
            const projectId = idFactory();
            const project = createFigmaCanvasProject(result, projectId);
            const saved = createCanvasAutosave(homeStorage).save(
              project,
              createSceneState(project),
              project.trace,
            );
            if (!saved) {
              return;
            }
            dispatch(
              projectLibraryActions.createProject({
                id: projectId,
                name: result.projectName,
                kind: "design",
                documentRef: `canvas:${projectId}`,
                timestamp: now(),
              }),
            );
            setFigmaImportOpen(false);
          }}
        />
      ) : null}
      {repositoryImportOpen && homeStorage !== undefined ? (
        <RepositoryImportDialog
          folderPicker={chooseRepositoryFolder}
          importer={repositoryImporter}
          {...(repositoryCaptureRuntime === undefined
            ? {}
            : {
                capturePlanner: (rootPath, options) =>
                  repositoryCaptureRuntime.plan(rootPath, options),
              })}
          {...(repositoryImportJob === undefined
            ? {}
            : {
                importJob: repositoryImportJobView(
                  repositoryImportJob,
                  Date.parse(now()),
                ),
              })}
          onCancelImport={() => {
            if (
              repositoryCaptureRuntime === undefined ||
              repositoryImportJob === undefined
            ) {
              return;
            }
            void repositoryCaptureRuntime
              .cancel(repositoryImportJob)
              .then(publishRepositoryImportJob)
              .catch(() => undefined);
          }}
          onClose={() => {
            clearRepositoryImportJob();
            setRepositoryImportOpen(false);
          }}
          onImport={async (manifest, approval) => {
            if (repositoryCaptureRuntime === undefined) {
              throw new Error(
                "The durable runtime capture service is unavailable. " +
                  "No placeholder project was created.",
              );
            }
            if (runtimeClient === undefined) {
              throw new Error(
                "Verified imports require the authenticated Canvas V3 runtime.",
              );
            }
            let projectId: string | undefined;
            let projectRegistered = false;
            const registerProject = (runtimeProjectId: string) => {
              if (projectId !== undefined && projectId !== runtimeProjectId) {
                throw new Error(
                  "The import runtime changed project authority during capture.",
                );
              }
              projectId = runtimeProjectId;
              if (projectRegistered) return;
              projectRegistered = true;
              dispatch(
                projectLibraryActions.createProject({
                  activate: false,
                  id: runtimeProjectId,
                  name: manifest.projectName,
                  kind: "design",
                  documentRef: `canvas:${runtimeProjectId}`,
                  lifecycle: "importing",
                  timestamp: now(),
                  source: {
                    kind: "repository",
                    label: manifest.projectName,
                    version: manifest.revision,
                    rootPath: manifest.rootPath,
                    platform: manifest.platform,
                    harnessId: "deterministic-import",
                    fileCount:
                      manifest.inventory?.fileCount ??
                      manifest.files.length,
                    screenCount:
                      manifest.inventory?.screenCount ??
                      manifest.screens.length,
                    componentCount:
                      manifest.inventory?.componentCount ??
                      manifest.components.length,
                  },
                }),
              );
            };
            try {
              const result = await repositoryCaptureRuntime.start({
                approvedRecipeHashes:
                  approval.approvedRecipeHashes,
                ...(approval.pilotScenarioIds === undefined
                  ? {}
                  : { pilotScenarioIds: approval.pilotScenarioIds }),
                manifest,
                onUpdate: (job) => {
                  if (job.state !== "committed") {
                    publishRepositoryImportJob(job);
                  }
                },
                onMaterialize: (update) => {
                  if (!publishRepositoryImportJob(update.job)) return;
                  registerProject(update.projectId);
                  dispatch(
                    projectLibraryActions.setProjectLifecycle(
                      update.projectId,
                      update.state === "ready"
                        ? "ready"
                        : update.state === "importing"
                          ? "importing"
                          : "attention",
                      now(),
                    ),
                  );
                },
                planToken: approval.planToken,
                projectName: manifest.projectName,
              });
              registerProject(result.projectId);
              if (projectId === undefined) {
                throw new Error(
                  "The import runtime did not allocate a project identity.",
                );
              }
              const canvasProject = createCapturedRepositoryCanvasProject({
                artifactReference: result.artifactReference,
                harnessId: "deterministic-import",
                job: result.job,
                manifest,
                projectId: result.projectId,
              });
              const committedArtifactReferences = Object.fromEntries(
                result.job.artifacts.map((artifact) => [
                  artifact.id,
                  result.artifactReference(artifact),
                ]),
              );
              const repositoryPersistence =
                createRepositoryProjectPersistence(homeStorage);
              const repositoryRecord = {
                capture: {
                  artifactReferences: committedArtifactReferences,
                  job: result.job,
                },
                harnessId: "deterministic-import" as const,
                manifest,
              };
              await persistCommittedImportCanvasDocumentV3({
                canvasProject,
                job: result.job,
                ...(reconstructionArtifactLoader === undefined
                  ? {}
                  : { loader: reconstructionArtifactLoader }),
                record: repositoryRecord,
                runtimeClient,
              });
              if (!repositoryPersistence.save(projectId, repositoryRecord)) {
                throw new Error(
                  "The verified import could not be saved safely.",
                );
              }
              dispatch(
                projectLibraryActions.setProjectLifecycle(
                  projectId,
                  result.job.failures.length === 0
                    ? "ready"
                    : "attention",
                  now(),
                ),
              );
              dispatch(
                projectLibraryActions.openProject(projectId, now()),
              );
              clearRepositoryImportJob();
              setRepositoryImportOpen(false);
            } catch (error) {
              if (projectId !== undefined) {
                dispatch(
                  projectLibraryActions.setProjectLifecycle(
                    projectId,
                    "attention",
                    now(),
                  ),
                );
              }
              const latestJob = repositoryImportJobRef.current;
              if (
                latestJob !== undefined &&
                latestJob.state !== "cancelled" &&
                latestJob.state !== "committed" &&
                latestJob.state !== "failed"
              ) {
                void repositoryCaptureRuntime
                  .cancel(latestJob)
                  .then(publishRepositoryImportJob)
                  .catch(() => undefined);
              }
              throw error;
            }
          }}
          onResumeImport={() => {
            if (
              repositoryCaptureRuntime === undefined ||
              repositoryImportJob === undefined
            ) {
              return;
            }
            void repositoryCaptureRuntime
              .resume(repositoryImportJob)
              .then(publishRepositoryImportJob)
              .catch(() => undefined);
          }}
          onRetryFailedImports={() => {
            if (
              repositoryCaptureRuntime === undefined ||
              repositoryImportJob === undefined
            ) {
              return;
            }
            void repositoryCaptureRuntime
              .retryFailed(repositoryImportJob)
              .then(publishRepositoryImportJob)
              .catch(() => undefined);
          }}
          onRevealImportLogs={() => {
            if (
              repositoryCaptureRuntime === undefined ||
              repositoryImportJob === undefined
            ) {
              return;
            }
            void repositoryCaptureRuntime.revealLogs(
              repositoryImportJob,
            );
          }}
        />
      ) : null}
    </>
  );
}
