import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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
import { createCanonicalWorkbenchAuthority } from "./canonical-workbench-authority.js";
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

function projectedHistory(
  labels: readonly { readonly label: string }[],
  idBase: number,
  revisionBase: number,
) {
  return labels.map((entry, index) => ({
    after: [],
    afterRevision: revisionBase + index + 1,
    afterSelectedNodeId: null,
    before: [],
    beforeRevision: revisionBase + index,
    beforeSelectedNodeId: null,
    id: idBase + index,
    label: entry.label,
  }));
}

export function useCanvasWorkbenchSessionState(
  props: CanvasWorkbenchProps,
) {
  const {
    agentDefaults,
    agentPatch,
    authorityProject,
    initialWorkspaceSession,
    onSceneChange,
    onWorkspaceSessionChange,
    persistence,
    project,
    runtimePort,
  } = props;
  const persistenceProject = authorityProject ?? project;
  const [recovery] = useState(() =>
    persistence?.load(persistenceProject) ?? null,
  );
  const [canonicalAuthority] = useState(() => {
    const authority = createCanonicalWorkbenchAuthority({
      documentId: project.document.id,
      projectId: project.id,
      scene:
        recovery?.scene ?? {
          future: [],
          nextHistoryId: 1,
          nodes: structuredClone(project.document.nodes),
          past: [],
          revision: project.document.revision,
          selectedNodeId: project.selectedNodeId,
        },
    });
    if (initialWorkspaceSession !== undefined) {
      const knownIds = new Set(
        (recovery?.scene.nodes ?? project.document.nodes).map(
          ({ id }) => id,
        ),
      );
      const restoredIds =
        initialWorkspaceSession.selection.selectedIds.filter((id) =>
          knownIds.has(id),
        );
      const restoredId = (id: string | null) =>
        id !== null && restoredIds.includes(id) ? id : null;
      authority.setSelection(
        createSelectionState(restoredIds, {
          anchorId: restoredId(
            initialWorkspaceSession.selection.anchorId,
          ),
          editingId: restoredId(
            initialWorkspaceSession.selection.editingNodeId,
          ),
          focusedId: restoredId(
            initialWorkspaceSession.selection.focusedNodeId,
          ),
        }),
      );
    }
    return authority;
  });
  const canonicalSnapshot = useSyncExternalStore(
    canonicalAuthority.subscribe,
    canonicalAuthority.getSnapshot,
    canonicalAuthority.getSnapshot,
  );
  const [previewNodes, setPreviewNodes] =
    useState<readonly WorkbenchNode[] | null>(null);
  const scene = useMemo(() => {
    const historyIdBase = recovery?.scene.nextHistoryId ?? 1;
    const historyRevisionBase =
      recovery?.scene.revision ?? project.document.revision;
    const projectedPast = projectedHistory(
      canonicalSnapshot.history.past,
      historyIdBase,
      historyRevisionBase,
    );
    const projectedFuture = projectedHistory(
      canonicalSnapshot.history.future,
      historyIdBase + projectedPast.length,
      canonicalSnapshot.revision,
    );
    return {
      future: projectedFuture,
      nextHistoryId:
        historyIdBase + projectedPast.length + projectedFuture.length,
      nodes: previewNodes ?? canonicalSnapshot.nodes,
      // Archived full-array history initializes the canonical authority only.
      // Compatibility persistence receives semantic projected receipts.
      past: projectedPast,
      revision: canonicalSnapshot.revision,
      selectedNodeId: canonicalSnapshot.selection.anchorId,
    };
  }, [
    canonicalSnapshot,
    previewNodes,
    project.document.revision,
    recovery,
  ]);
  const displayHistory = useMemo(
    () => [
      ...(recovery?.scene.past ?? []).map((entry) => ({
        ...entry,
        after: [],
        before: [],
      })),
      ...scene.past,
    ],
    [recovery, scene.past],
  );
  const [tool, setTool] =
    useState<ProfessionalCanvasTool>("select");
  const selection = canonicalSnapshot.selection;
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
      () => recovery?.trace ?? structuredClone(project.trace),
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
    nextTraceSequence(recovery?.trace ?? project.trace),
  );
  const viewportElement = useRef<HTMLDivElement | null>(null);
  const spacePressed = useRef(false);
  const suppressCanvasClick = useRef(false);

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
    persistence?.save(persistenceProject, scene, [
      ...trace,
      ...commandTrace,
    ]);
  }, [
    persistence,
    persistenceProject,
    scene.revision,
    scene.selectedNodeId,
    trace,
    commandTrace,
  ]);

  useEffect(() => {
    onSceneChange?.(scene);
  }, [onSceneChange, scene]);

  useEffect(() => {
    if (onWorkspaceSessionChange === undefined) {
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
    onWorkspaceSessionChange({
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
    camera,
    initialWorkspaceSession,
    onWorkspaceSessionChange,
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
    canonicalAuthority.setSelection(createSelectionState(validIds));
  }, [
    canonicalAuthority,
    scene.nodes,
    scene.selectedNodeId,
    selectedNodeIds,
  ]);

  return {
    agentPatchReview,
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
