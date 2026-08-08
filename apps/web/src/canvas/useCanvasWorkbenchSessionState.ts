import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CanvasPageIdSchema,
  createWorkspaceSessionDraft,
  type CanvasPageId,
} from "@memi/protocol";

import {
  createAgentPatch,
  createAgentPatchReview,
  type AgentPatchReview,
} from "./agent-patch.js";
import {
  nextTraceSequence,
  type CollaborationTraceItem,
} from "./collaboration.js";
import type {
  CanvasContextMenuState,
  CanvasWorkbenchProps,
  PointerGesture,
  SelectionMarquee,
} from "./CanvasWorkbench.types.js";
import { V3WorkbenchSessionController } from "./v3-workbench-session-controller.js";
import {
  createFrameStateScheduler,
  type FrameStateScheduler,
} from "./canvas-performance.js";
import {
  initialCamera,
  type CanvasCamera,
} from "./canvas-camera.js";
import {
  createPreviewSession,
  previewSessionReducer,
} from "../preview/preview-session.js";
import {
  createSelectionState,
  type WorkbenchNode,
} from "./model.js";
import type { AlignmentGuides } from "./alignment-guides.js";
import type {
  CanvasRuntimeRestorePreview,
  CanvasRuntimeSnapshot,
} from "./canvas-runtime-port.js";
import {
  SAFE_CANVAS_AGENT_DEFAULTS,
  type PermissionPolicy,
  type PromptMode,
  type ReasoningEffort,
} from "./harness-config.js";
import type { ProfessionalCanvasTool } from "./commands.js";
import type { WorkspaceDockTab } from "./workspace-dock.js";
import { buildProductMap } from "./product-map.js";

export function useCanvasWorkbenchSessionState(
  props: CanvasWorkbenchProps,
) {
  const {
    agentDefaults,
    agentPatch,
    initialWorkspaceSession,
    onWorkspaceSessionChange,
    project,
    runtimePort,
    v3Session,
  } = props;
  if (v3Session === undefined) {
    throw new Error("CanvasWorkbench requires a durable V3 session.");
  }
  const persistenceProject = project;
  const [v3Controller] = useState(() => new V3WorkbenchSessionController({
    persistence: v3Session.persistence,
    ...(v3Session.persistencePolicy === undefined ? {} : { persistencePolicy: v3Session.persistencePolicy }),
    source: { kind: "seed", document: v3Session.document },
    workspace: initialWorkspaceSession ?? createWorkspaceSessionDraft({
      projectId: v3Session.document.projectId,
      documentId: v3Session.document.id,
      documentRevision: v3Session.document.revision,
      sourceRevision: null,
    }),
  }));
  const v3Snapshot = useSyncExternalStore(
    v3Controller.subscribe,
    v3Controller.getSnapshot,
    v3Controller.getSnapshot,
  );
  const [requestedPageId, setRequestedPageId] =
    useState<CanvasPageId | null>(null);
  const currentDocument =
    v3Snapshot.status === "ready"
      ? v3Snapshot.authority.getSnapshot().document
      : v3Session.document;
  const activePageId: CanvasPageId =
    requestedPageId !== null &&
    currentDocument.pagesById[requestedPageId] !== undefined
      ? requestedPageId
      : v3Snapshot.status === "ready" &&
          v3Snapshot.workspace.activePageId !== null &&
          v3Snapshot.workspace.activePageId !== undefined &&
          currentDocument.pagesById[v3Snapshot.workspace.activePageId] !==
            undefined
      ? v3Snapshot.workspace.activePageId as CanvasPageId
      : v3Session.activePageId;
  const selectActivePage = (pageId: string) => {
    const parsed = CanvasPageIdSchema.safeParse(pageId);
    if (parsed.success) {
      setRequestedPageId(parsed.data);
    }
  };
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (disposeTimer.current !== null) {
      clearTimeout(disposeTimer.current);
      disposeTimer.current = null;
    }
    void v3Controller.open().catch(() => undefined);
    return () => {
      // StrictMode re-runs effects; defer disposal so the second setup retains
      // this state-held controller while real unmount still releases it.
      disposeTimer.current = setTimeout(() => v3Controller.dispose(), 0);
    };
  }, [v3Controller]);
  const rendererSnapshot = v3Snapshot.status === "ready"
    ? v3Controller.getRendererSnapshot(activePageId)
    : { canRedo: false, canUndo: false, nodes: [], revision: v3Session.document.revision, selection: createSelectionState([]) };
  const historyAvailability = {
    canRedo: rendererSnapshot.canRedo,
    canUndo: rendererSnapshot.canUndo,
  };
  const canonicalAuthority = v3Snapshot.status === "ready" ? v3Snapshot.authority : null;
  const canonicalSnapshot = {
    document: { revision: rendererSnapshot.revision },
    nodes: rendererSnapshot.nodes,
    revision: rendererSnapshot.revision,
    selection: rendererSnapshot.selection,
  };
  const [previewNodes, setPreviewNodes] =
    useState<readonly WorkbenchNode[] | null>(null);
  const scene = {
    future: [], nextHistoryId: 1, nodes: previewNodes ?? rendererSnapshot.nodes,
    past: [], revision: rendererSnapshot.revision,
    selectedNodeId: rendererSnapshot.selection.anchorId,
  };
  const displayHistory: readonly never[] = [];
  const [tool, setTool] =
    useState<ProfessionalCanvasTool>("select");
  const selection = rendererSnapshot.selection;
  const selectedNodeIds = selection.selectedIds;
  const [camera, setCamera] = useState<CanvasCamera>(() =>
    initialWorkspaceSession === undefined
      ? initialCamera(project)
      : {
          x: initialWorkspaceSession.camera.x,
          y: initialWorkspaceSession.camera.y,
          zoom: initialWorkspaceSession.camera.zoom,
        },
  );
  const [viewportSize, setViewportSize] = useState({
    height:
      initialWorkspaceSession?.camera.viewportHeight ?? 700,
    width:
      initialWorkspaceSession?.camera.viewportWidth ?? 1000,
  });
  const cameraScheduler = useRef<FrameStateScheduler<CanvasCamera> | null>(
    null,
  );
  if (cameraScheduler.current === null) {
    cameraScheduler.current = createFrameStateScheduler(setCamera);
  }
  const [harnessId, setHarnessId] = useState(
    agentDefaults?.harnessId ?? project.harness.selectedId,
  );
  const [modelId, setModelId] = useState(
    agentDefaults?.modelId ?? SAFE_CANVAS_AGENT_DEFAULTS.modelId,
  );
  const [promptMode, setPromptMode] = useState<PromptMode>(
    SAFE_CANVAS_AGENT_DEFAULTS.promptMode,
  );
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>(
      agentDefaults?.reasoningEffort ??
        SAFE_CANVAS_AGENT_DEFAULTS.reasoningEffort,
    );
  const [permissionPolicy, setPermissionPolicy] =
    useState<PermissionPolicy>(
      agentDefaults?.permissionPolicy ??
        SAFE_CANVAS_AGENT_DEFAULTS.permissionPolicy,
    );
  const [prompt, setPrompt] = useState("");
  const [workspaceTab, setWorkspaceTab] =
    useState<WorkspaceDockTab>(() =>
      initialWorkspaceSession !== undefined &&
      (initialWorkspaceSession.activity.activeRunId !== null ||
        initialWorkspaceSession.activity.activeReviewId !== null)
        ? "runs"
        : "inspect",
    );
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(
    initialWorkspaceSession?.panels.inspectorCollapsed ?? false,
  );
  const [workspaceSplitRatio, setWorkspaceSplitRatio] = useState(
    initialWorkspaceSession?.panels.workspaceSplitRatio ?? 0.5,
  );
  const [agentPatchReview, setAgentPatchReview] =
    useState<AgentPatchReview | null>(() =>
      agentPatch === null || agentPatch === undefined
        ? null
        : createAgentPatchReview(
            createAgentPatch(agentPatch),
            canonicalSnapshot.document.revision,
          ),
    );
  const [runtimeSnapshot, setRuntimeSnapshot] =
    useState<CanvasRuntimeSnapshot | null>(null);
  const [restorePreview, setRestorePreview] =
    useState<CanvasRuntimeRestorePreview | null>(null);
  const runtimeUnsubscribe = useRef<(() => void) | null>(null);
  const [previewSession, dispatchPreview] = useReducer(
    previewSessionReducer,
    {
      address: "http://127.0.0.1:5173",
      documentRevision: project.document.revision,
      projectId: project.id,
    },
    ({ address, documentRevision, projectId }) =>
      createPreviewSession(address, { documentRevision, projectId }),
  );
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [contextMenu, setContextMenu] =
    useState<CanvasContextMenuState | null>(null);
  const [selectionMarquee, setSelectionMarquee] =
    useState<SelectionMarquee | null>(null);
  const [alignmentGuides, setAlignmentGuides] =
    useState<AlignmentGuides>({
      horizontal: [],
      vertical: [],
    });
  const [trace, setTrace] =
    useState<readonly CollaborationTraceItem[]>(
      () => structuredClone(project.trace),
    );
  const [commandTrace, setCommandTrace] =
    useState<readonly CollaborationTraceItem[]>([]);
  const productMap = useMemo(
    () =>
      buildProductMap({
        ...persistenceProject,
        document: {
          ...persistenceProject.document,
          nodes: scene.nodes,
        },
        trace: [...trace, ...commandTrace],
      }),
    [commandTrace, persistenceProject, scene.nodes, trace],
  );
  const commandSequence = useRef(1);
  const viewportPointer = useRef<{
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const gesture = useRef<PointerGesture | null>(null);
  const traceSequence = useRef(
    nextTraceSequence(project.trace),
  );
  const viewportElement = useRef<HTMLDivElement | null>(null);
  const spacePressed = useRef(false);
  const suppressCanvasClick = useRef(false);
  // LocalDesignConsumer intentionally supplies a lightweight persistence writer
  // from its render path. Persisting because that callback identity changes
  // would feed a workspace update straight back into the parent render tree.
  // Keep the current callback available without making it a document/session
  // change dependency.
  const workspaceSessionChangeRef = useRef(onWorkspaceSessionChange);

  useEffect(() => {
    workspaceSessionChangeRef.current = onWorkspaceSessionChange;
  }, [onWorkspaceSessionChange]);

  useEffect(
    () => () => {
      cameraScheduler.current?.cancel();
      runtimeUnsubscribe.current?.();
    },
    [],
  );

  useEffect(() => {
    let active = true;
    runtimeUnsubscribe.current?.();
    runtimeUnsubscribe.current = null;
    if (runtimePort === undefined) {
      setRuntimeSnapshot(null);
      return () => {
        active = false;
      };
    }
    const restoredRunId =
      initialWorkspaceSession?.activity.activeRunId ?? null;
    const loadRun = async () => {
      if (restoredRunId !== null) {
        try {
          return await runtimePort.getRun(restoredRunId);
        } catch {
          // The runtime may have pruned an old run independently.
        }
      }
      return runtimePort.getLatestRun(persistenceProject.id);
    };
    void loadRun().then((latest) => {
      if (!active || latest === null) {
        return;
      }
      setRuntimeSnapshot(latest);
      runtimeUnsubscribe.current = runtimePort.subscribe(
        latest.runId,
        setRuntimeSnapshot,
      );
    });
    return () => {
      active = false;
      runtimeUnsubscribe.current?.();
      runtimeUnsubscribe.current = null;
    };
  }, [
    initialWorkspaceSession?.activity.activeRunId,
    persistenceProject.id,
    runtimePort,
  ]);

  useEffect(() => {
    dispatchPreview({
      type: "document-revision",
      documentRevision: scene.revision,
    });
  }, [scene.revision]);

  useEffect(() => {
    const element = viewportElement.current;
    if (element === null) {
      return;
    }
    const updateSize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) {
        return;
      }
      setViewportSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      updateSize(bounds.width, bounds.height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
      };
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        updateSize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const notifyWorkspaceSessionChange = workspaceSessionChangeRef.current;
    if (notifyWorkspaceSessionChange === undefined) {
      return;
    }
    const restoredActivity =
      initialWorkspaceSession?.activity;
    const activeReview =
      agentPatchReview !== null &&
      (agentPatchReview.status === "pending" ||
        agentPatchReview.status === "applying" ||
        agentPatchReview.status === "conflict")
        ? agentPatchReview
        : null;
    const activeRunId =
      runtimeSnapshot?.runId ??
      restoredActivity?.activeRunId ??
      null;
    const activeReviewId =
      activeReview?.patch.id ??
      restoredActivity?.activeReviewId ??
      null;
    const activeApprovalId =
      runtimeSnapshot?.approval?.id ??
      restoredActivity?.activeApprovalId ??
      null;
    const conflictedOverlayIds =
      activeReview?.status === "conflict"
        ? [activeReview.patch.id]
        : (restoredActivity?.conflictedOverlayIds ?? []);
    notifyWorkspaceSessionChange({
      activePageId,
      activity: {
        activeRunId,
        activeReviewId,
        activeApprovalId:
          activeRunId === null ? null : activeApprovalId,
        conflictedOverlayIds,
        boundDocumentRevision:
          activeRunId !== null ||
          activeReviewId !== null ||
          conflictedOverlayIds.length > 0
            ? scene.revision
            : null,
        boundSourceRevision:
          activeRunId !== null ||
          activeReviewId !== null ||
          conflictedOverlayIds.length > 0
            ? (restoredActivity?.boundSourceRevision ?? null)
            : null,
      },
      camera,
      documentRevision: scene.revision,
      history:
        canonicalAuthority?.getHistoryState() ??
        initialWorkspaceSession?.history ??
        { undo: [], redo: [] },
      panels: {
        layersWidth:
          initialWorkspaceSession?.panels.layersWidth ?? 240,
        inspectorWidth:
          initialWorkspaceSession?.panels.inspectorWidth ?? 320,
        workspaceSplitRatio,
        layersCollapsed:
          initialWorkspaceSession?.panels.layersCollapsed ?? false,
        inspectorCollapsed: workspaceCollapsed,
      },
      selection,
      viewportSize,
    });
  }, [
    agentPatchReview,
    activePageId,
    camera,
    initialWorkspaceSession,
    runtimeSnapshot,
    scene.revision,
    selection,
    viewportSize,
    workspaceCollapsed,
    workspaceSplitRatio,
  ]);

  useEffect(() => {
    if (agentPatch === null || agentPatch === undefined) {
      setAgentPatchReview(null);
      return;
    }
    setAgentPatchReview(
      createAgentPatchReview(
        createAgentPatch(agentPatch),
        canonicalSnapshot.document.revision,
      ),
    );
    setWorkspaceTab("runs");
    setWorkspaceCollapsed(false);
  }, [agentPatch]);

  useEffect(() => {
    const proposal = runtimeSnapshot?.proposal;
    if (proposal === null || proposal === undefined) {
      return;
    }
    setAgentPatchReview((current) =>
      current?.patch.id === proposal.patch.id
        ? current
        : createAgentPatchReview(
            createAgentPatch(proposal.patch),
            canonicalSnapshot.document.revision,
          ),
    );
    setWorkspaceTab("runs");
    setWorkspaceCollapsed(false);
  }, [runtimeSnapshot?.proposal?.patch.id]);

  useEffect(() => {
    setAgentPatchReview((current) => {
      if (
        current === null ||
        current.status !== "pending" ||
        current.patch.baseRevision === scene.revision
      ) {
        return current;
      }
      return createAgentPatchReview(current.patch, scene.revision);
    });
  }, [scene.revision]);

  useEffect(() => {
    const knownIds = new Set(scene.nodes.map((node) => node.id));
    const currentAnchor = selectedNodeIds.at(-1) ?? null;
    if (
      selectedNodeIds.every((id) => knownIds.has(id)) &&
      currentAnchor === scene.selectedNodeId
    ) {
      return;
    }
    const validIds = selectedNodeIds.filter((id) => knownIds.has(id));
    canonicalAuthority?.setSelection(createSelectionState(validIds));
  }, [
    canonicalAuthority,
    scene.nodes,
    scene.selectedNodeId,
    selectedNodeIds,
  ]);

  return {
    agentPatchReview,
    activePageId,
    alignmentGuides,
    camera,
    cameraScheduler,
    canonicalAuthority,
    canonicalSnapshot,
    commandPaletteOpen,
    commandSequence,
    commandTrace,
    contextMenu,
    dispatchPreview,
    displayHistory,
    gesture,
    harnessId,
    historyAvailability,
    modelId,
    permissionPolicy,
    persistenceProject,
    previewSession,
    prompt,
    promptMode,
    productMap,
    reasoningEffort,
    restorePreview,
    runtimeSnapshot,
    runtimeUnsubscribe,
    scene,
    selection,
    selectionMarquee,
    selectActivePage,
    selectedNodeIds,
    setAgentPatchReview,
    setAlignmentGuides,
    setCamera,
    setCommandPaletteOpen,
    setCommandTrace,
    setContextMenu,
    setHarnessId,
    setModelId,
    setPermissionPolicy,
    setPreviewNodes,
    setPrompt,
    setPromptMode,
    setReasoningEffort,
    setRestorePreview,
    setRuntimeSnapshot,
    setSelectionMarquee,
    setTool,
    setTrace,
    setWorkspaceCollapsed,
    setWorkspaceSplitRatio,
    setWorkspaceTab,
    spacePressed,
    suppressCanvasClick,
    tool,
    trace,
    traceSequence,
    viewportElement,
    viewportPointer,
    viewportSize,
    v3SessionError: v3Snapshot.status === "error" ? v3Snapshot.error : null,
    v3SessionStatus: v3Snapshot.status,
    workspaceCollapsed,
    workspacePanels: {
      inspectorWidth:
        initialWorkspaceSession?.panels.inspectorWidth ?? 320,
      layersWidth:
        initialWorkspaceSession?.panels.layersWidth ?? 240,
    },
    workspaceSplitRatio,
    workspaceTab,
  };
}
