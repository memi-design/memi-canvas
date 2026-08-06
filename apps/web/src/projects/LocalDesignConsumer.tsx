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
  canvasSourceFingerprint,
  type CanvasStorage,
} from "../canvas/persistence.js";
import {
  WorkspaceSessionController,
  createCanvasWorkspaceSessionDraft,
  createRuntimeClientWorkspaceSessionPort,
  workspaceSessionFromCanvasDocumentV3,
  type WorkspaceSessionControllerSnapshot,
  type WorkspaceRuntimeProjectId,
} from "../canvas/workspace-session-controller.js";
import { migrateLegacyWorkspaceSession } from "../canvas/workspace-session-migration.js";
import type { RuntimeClientV1 } from "../runtime/runtime-client.js";
import {
  createEphemeralCanvasDocumentPersistence,
  createRuntimeClientCanvasDocumentPersistence,
} from "../runtime/runtime-client-canvas-document-persistence.js";
import type {
  CanvasDocumentV3PersistencePort,
  WorkspaceSessionDraftV1,
} from "@memi/protocol";
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
import { createLocalDesignCanvasDocumentV3 } from "./local-design-canvas-v3.js";

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

const subscribeToNoSession = (): (() => void) => () => {};
const readNoSession =
  (): WorkspaceSessionControllerSnapshot | null => null;

// Atomic Design: page — one independently durable local design file.
export function LocalDesignConsumer({
  agentDefaults,
  canvasDocumentPersistence,
  onExit,
  project,
  runtimeClient,
  runtimePort,
  runtimeProjectId,
  reconstructionArtifactLoader,
  storage,
}: {
  readonly agentDefaults?: CanvasAgentDefaults;
  readonly canvasDocumentPersistence?: CanvasDocumentV3PersistencePort;
  readonly onExit: () => void;
  readonly project: ProjectRecord;
  readonly runtimeClient?: Pick<RuntimeClientV1, "sessions" | "canvasDocuments">;
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
  const [ephemeralPersistence] = useState(() =>
    createEphemeralCanvasDocumentPersistence(),
  );
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
  const v3Session = useMemo(() => {
    const document = createLocalDesignCanvasDocumentV3(
      canvasProject,
      runtimeProjectId,
      project.source.kind === "repository" ? "imported" : "design",
    );
    const activePageId = document.pageIds[0];
    if (activePageId === undefined) {
      throw new Error("Canvas V3 migration produced no active page.");
    }
    return Object.freeze({
      activePageId,
      document,
      persistence:
        runtimeClient === undefined
          ? (canvasDocumentPersistence ?? ephemeralPersistence)
          : createRuntimeClientCanvasDocumentPersistence(runtimeClient),
    });
  }, [
    canvasProject,
    canvasDocumentPersistence,
    ephemeralPersistence,
    project.source.kind,
    runtimeClient,
    runtimeProjectId,
  ]);
  const sessionController = useMemo(
    () => {
      if (workspaceRuntime === undefined) return undefined;
      const draft = createCanvasWorkspaceSessionDraft(
        canvasProject,
        runtimeProjectId,
      );
      const identityAlignedDraft = Object.freeze({
        ...draft,
        documentId: v3Session.document.id,
        documentRevision: v3Session.document.revision,
        projectId: v3Session.document.projectId,
        selection: {
          selectedIds: [],
          anchorId: null,
          focusedNodeId: null,
          editingNodeId: null,
        },
      });
      return new WorkspaceSessionController(
        workspaceSessionFromCanvasDocumentV3(
          identityAlignedDraft,
          v3Session.document,
          {
            selectedIds: [],
            anchorId: null,
            focusedId: null,
            editingId: null,
          },
        ),
        workspaceRuntime,
      );
    },
    [
      canvasProject,
      runtimeProjectId,
      v3Session.document,
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
    (runtimeClient === undefined
      ? "Native persistence unavailable · changes are temporary in this browser session"
      : undefined);

  return (
    <CanvasWorkbench
      {...(canvasAgentDefaults === undefined
        ? {}
        : { agentDefaults: canvasAgentDefaults })}
      {...(initialWorkspaceSession === null
        ? {}
        : { initialWorkspaceSession })}
      v3Session={v3Session}
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
