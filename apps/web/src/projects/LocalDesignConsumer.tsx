import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  CanvasWorkbench,
  type CanvasAgentDefaults,
} from "../canvas/CanvasWorkbench.js";
import type { CanvasRuntimePortV1 } from "../canvas/canvas-runtime-port.js";
import { CANVAS_HARNESSES } from "../canvas/harness-config.js";
import type { CanvasWorkbenchProject } from "../canvas/model.js";
import type { CanvasReconstructionReview } from "../canvas/reconstruction-review.js";
import {
  createCanvasAutosave,
  canvasSourceFingerprint,
  type CanvasAutosave,
  type CanvasStorage,
} from "../canvas/persistence.js";
import {
  WorkspaceSessionController,
  createCanvasWorkspaceSessionDraft,
  createRuntimeClientWorkspaceSessionPort,
  type WorkspaceSessionControllerSnapshot,
  type WorkspaceRuntimeProjectId,
} from "../canvas/workspace-session-controller.js";
import { migrateLegacyWorkspaceSession } from "../canvas/workspace-session-migration.js";
import type { RuntimeClientV1 } from "../runtime/runtime-client.js";
import type { WorkspaceSessionDraftV1 } from "@memi/protocol";
import { openLocalPreviewInHelium } from "../platform/helium.js";
import type { ProjectRecord } from "./project-library.js";
import {
  WorkspaceSessionLiveWriter,
} from "../canvas/workspace-session-live-state.js";
import { openSourceInVSCode } from "../platform/vscode.js";
import { openSourceInCursor } from "../platform/cursor.js";
import {
  createRepositoryProjectPersistence,
  type RepositoryProjectRecord,
} from "../imports/repository/repository-project-persistence.js";
import {
  createCapturedRepositoryCanvasProject,
  type StreamingRepositoryCanvasProject,
} from "../imports/repository/repository-capture-workbench.js";
import {
  rehydrateRepositoryProjectRecord,
  type RepositoryReconstructionArtifactLoader,
} from "../imports/repository/repository-reconstruction-rehydration.js";
import {
  createLandingPageDemoProject,
  isLandingPageDemo,
} from "./landing-page-demo.js";

const AGENT_PREFERENCE_KEY_PREFIX = "memi.canvas.agent-preference.v1:";

function agentPreferenceKey(documentId: string): string {
  return `${AGENT_PREFERENCE_KEY_PREFIX}${documentId}`;
}

function readHarnessPreference(
  storage: CanvasStorage,
  documentId: string,
): string | undefined {
  try {
    const serialized = storage.getItem(agentPreferenceKey(documentId));
    if (serialized === null || serialized.length > 512) return undefined;
    const parsed: unknown = JSON.parse(serialized);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const candidate = parsed as { readonly harnessId?: unknown };
    if (
      typeof candidate.harnessId !== "string" ||
      !CANVAS_HARNESSES.some(({ id }) => id === candidate.harnessId)
    ) {
      return undefined;
    }
    return candidate.harnessId;
  } catch {
    return undefined;
  }
}

function saveHarnessPreference(
  storage: CanvasStorage,
  documentId: string,
  harnessId: string,
): boolean {
  if (!CANVAS_HARNESSES.some(({ id }) => id === harnessId)) return false;
  try {
    storage.setItem(
      agentPreferenceKey(documentId),
      JSON.stringify({ harnessId }),
    );
    return true;
  } catch {
    return false;
  }
}

type LocalCanvasProject =
  | CanvasWorkbenchProject
  | StreamingRepositoryCanvasProject;

const EMPTY_RECONSTRUCTION_REVIEWS:
  readonly CanvasReconstructionReview[] = Object.freeze([]);

function reconstructionReviews(
  project: LocalCanvasProject,
): readonly CanvasReconstructionReview[] {
  return "reconstructions" in project
    ? project.reconstructions
    : EMPTY_RECONSTRUCTION_REVIEWS;
}

function localDesignProject(
  project: ProjectRecord,
  storage: CanvasStorage,
  repositoryRecord?: RepositoryProjectRecord,
): LocalCanvasProject {
  if (isLandingPageDemo(project)) {
    return createLandingPageDemoProject(project);
  }
  if (project.source.kind === "repository") {
    const imported =
      repositoryRecord ??
      createRepositoryProjectPersistence(storage).load(project.id);
    if (imported?.capture !== undefined) {
      return createCapturedRepositoryCanvasProject({
        artifactReference: (artifact) => {
          const reference =
            imported.capture?.artifactReferences[artifact.id];
          if (reference === undefined) {
            throw new Error(
              `Capture artifact ${artifact.id} is unavailable.`,
            );
          }
          const {
            reconstruction,
            reconstructionReview,
            ...runtimeReference
          } = reference;
          return {
            ...runtimeReference,
            ...(reconstruction === undefined ? {} : { reconstruction }),
            ...(reconstructionReview === undefined
              ? {}
              : { reconstructionReview }),
          };
        },
        harnessId: imported.harnessId,
        job: imported.capture.job,
        manifest: imported.manifest,
        projectId: project.id,
      });
    }
  }
  return {
    id: project.id,
    title: project.name,
    selectedNodeId: null,
    document: {
      id: project.documentRef.replace("canvas:", "document-local-"),
      revision: 1,
      nodes: [],
    },
    harness: {
      selectedId: "codex",
      options: CANVAS_HARNESSES,
    },
    trace: [],
  };
}

function autosaveBoundary(
  storage: CanvasStorage,
): CanvasAutosave | undefined {
  try {
    return createCanvasAutosave(storage);
  } catch {
    return undefined;
  }
}

const subscribeToNoSession = (): (() => void) => () => {};
const readNoSession =
  (): WorkspaceSessionControllerSnapshot | null => null;

// Atomic Design: page — one independently durable local design file.
export function LocalDesignConsumer({
  agentDefaults,
  onExit,
  project,
  runtimeClient,
  runtimePort,
  runtimeProjectId,
  reconstructionArtifactLoader,
  storage,
}: {
  readonly agentDefaults?: CanvasAgentDefaults;
  readonly onExit: () => void;
  readonly project: ProjectRecord;
  readonly runtimeClient?: Pick<RuntimeClientV1, "sessions">;
  readonly runtimePort?: CanvasRuntimePortV1;
  readonly runtimeProjectId?: WorkspaceRuntimeProjectId;
  readonly reconstructionArtifactLoader?:
    RepositoryReconstructionArtifactLoader;
  readonly storage: CanvasStorage;
}) {
  const [canvasProject, setCanvasProject] = useState<LocalCanvasProject>(() =>
    localDesignProject(project, storage),
  );
  const [harnessPreference, setHarnessPreference] = useState(() =>
    readHarnessPreference(storage, canvasProject.document.id),
  );
  const [persistence] = useState(() => autosaveBoundary(storage));
  const [sessionWarning, setSessionWarning] =
    useState<string | undefined>();
  const [reconstructionWarning, setReconstructionWarning] =
    useState<string | undefined>();

  useEffect(() => {
    if (
      project.source.kind !== "repository" ||
      reconstructionArtifactLoader === undefined
    ) {
      return;
    }
    const record =
      createRepositoryProjectPersistence(storage).load(project.id);
    if (
      record?.capture === undefined ||
      !record.capture.job.artifacts.some(
        ({ reconstructionArtifactId }) =>
          reconstructionArtifactId !== null,
      )
    ) {
      return;
    }
    let cancelled = false;
    void rehydrateRepositoryProjectRecord(
      record,
      reconstructionArtifactLoader,
    )
      .then((rehydrated) => {
        if (cancelled) return;
        setCanvasProject(localDesignProject(project, storage, rehydrated));
        setReconstructionWarning(undefined);
      })
      .catch(() => {
        if (cancelled) return;
        setReconstructionWarning(
          "Runtime comparison unavailable · editable capture remains open",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [project, reconstructionArtifactLoader, storage]);
  const workspaceRuntime = useMemo(
    () =>
      runtimeClient === undefined || runtimeProjectId === undefined
        ? undefined
        : createRuntimeClientWorkspaceSessionPort(runtimeClient),
    [runtimeClient, runtimeProjectId],
  );
  const sessionController = useMemo(
    () =>
      workspaceRuntime === undefined
        ? undefined
        : new WorkspaceSessionController(
            createCanvasWorkspaceSessionDraft(
              canvasProject,
              runtimeProjectId,
            ),
            workspaceRuntime,
          ),
    [
      canvasProject,
      runtimeProjectId,
      workspaceRuntime,
    ],
  );
  const sessionSnapshot = useSyncExternalStore(
    sessionController?.subscribe ?? subscribeToNoSession,
    sessionController?.getSnapshot ?? readNoSession,
    sessionController?.getSnapshot ?? readNoSession,
  );
  const sessionWriter = useMemo(
    () =>
      sessionController === undefined
        ? undefined
        : new WorkspaceSessionLiveWriter(
            sessionController,
            () => {
              setSessionWarning(
                "Workspace session unavailable · document edits continue with local recovery",
              );
            },
          ),
    [sessionController],
  );
  const [restoredSessionDocumentId, setRestoredSessionDocumentId] =
    useState<string | null>(
      runtimeClient === undefined
        ? canvasProject.document.id
        : null,
    );
  const [restoredWorkspaceSession, setRestoredWorkspaceSession] =
    useState<WorkspaceSessionDraftV1 | null>(null);

  useEffect(() => {
    if (
      sessionController === undefined ||
      workspaceRuntime === undefined
    ) {
      setRestoredSessionDocumentId(canvasProject.document.id);
      return;
    }
    let cancelled = false;
    const restore = async () => {
      await migrateLegacyWorkspaceSession({
        projectId:
          sessionController.getSnapshot().session.projectId,
        documentId: canvasProject.document.id,
        sourceRevision: null,
        expectedLegacySourceFingerprint:
          canvasSourceFingerprint(canvasProject),
        storage,
        runtime: workspaceRuntime,
      });
      await sessionController.restore();
      if (!cancelled) {
        setRestoredWorkspaceSession(
          sessionController.getSnapshot().session,
        );
        setSessionWarning(undefined);
        setRestoredSessionDocumentId(canvasProject.document.id);
      }
    };
    void restore().catch(() => {
      if (!cancelled) {
        setRestoredWorkspaceSession(
          sessionController.getSnapshot().session,
        );
        setSessionWarning(
          "Workspace session unavailable · document edits continue with local recovery",
        );
        setRestoredSessionDocumentId(canvasProject.document.id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    canvasProject,
    sessionController,
    storage,
    workspaceRuntime,
  ]);

  useEffect(
    () => () => {
      void sessionWriter?.flush().catch(() => undefined);
    },
    [sessionWriter],
  );

  if (
    workspaceRuntime !== undefined &&
    restoredSessionDocumentId !== canvasProject.document.id
  ) {
    return (
      <main
        aria-label="Restoring workspace session"
        role="status"
      >
        Restoring workspace session…
      </main>
    );
  }

  const selectedNodeId =
    sessionSnapshot?.session.selection.anchorId ?? null;
  const restoredProject =
    selectedNodeId !== null &&
    canvasProject.document.nodes.some(({ id }) => id === selectedNodeId)
      ? { ...canvasProject, selectedNodeId }
      : canvasProject;
  const initialWorkspaceSession =
    restoredWorkspaceSession ?? sessionSnapshot?.session ?? null;
  const canvasProjectWithPreferences =
    harnessPreference === undefined
      ? restoredProject
      : {
          ...restoredProject,
          harness: {
            ...restoredProject.harness,
            selectedId: harnessPreference,
          },
        };
  const canvasAgentDefaults =
    harnessPreference === undefined || agentDefaults === undefined
      ? agentDefaults
      : { ...agentDefaults, harnessId: harnessPreference };
  const workspaceWarning =
    reconstructionWarning ??
    sessionWarning ??
    (persistence === undefined
      ? "File storage unavailable · edits remain in this session only"
      : undefined);

  return (
    <CanvasWorkbench
      {...(canvasAgentDefaults === undefined
        ? {}
        : { agentDefaults: canvasAgentDefaults })}
      {...(initialWorkspaceSession === null
        ? {}
        : { initialWorkspaceSession })}
      onExit={onExit}
      onOpenInHelium={(url) => {
        void openLocalPreviewInHelium(url);
      }}
      {...(project.source.kind === "repository" &&
      project.source.rootPath !== undefined
        ? {
            onOpenSourceInCode: (sourcePath: string) => {
              void openSourceInVSCode(
                sourcePath,
                project.source.rootPath!,
              );
            },
            onOpenSourceInCursor: (sourcePath: string) => {
              void openSourceInCursor(
                sourcePath,
                project.source.rootPath!,
              );
            },
          }
        : {})}
      {...(sessionWriter === undefined
        ? {}
        : {
            onWorkspaceSessionChange: (state) => {
              sessionWriter.write(state);
            },
          })}
      {...(persistence === undefined ? {} : { persistence })}
      onHarnessChange={(harnessId) => {
        if (
          saveHarnessPreference(
            storage,
            canvasProject.document.id,
            harnessId,
          )
        ) {
          setHarnessPreference(harnessId);
        }
      }}
      project={canvasProjectWithPreferences}
      reconstructionReviews={reconstructionReviews(canvasProject)}
      {...(runtimePort === undefined ? {} : { runtimePort })}
      {...(workspaceWarning === undefined ? {} : { workspaceWarning })}
    />
  );
}
