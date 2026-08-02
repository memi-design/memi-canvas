import { type CSSProperties, type MouseEvent } from "react";
import type { CanvasWorkbenchProps } from "./CanvasWorkbench.types.js";
import { createEditorCommands } from "./commands.js";
import { canvasGridMetrics, canvasPointFromViewport, pointFromEvent } from "./canvas-camera.js";
import { resolveComponentInstance, type WorkbenchNode } from "./model.js";
import { Inspector } from "./parts.js";
import { canvasSourceFingerprint } from "./canvas-source-fingerprint.js";
import { canReadCanvasSystemClipboard, hasCanvasSessionClipboard, isCanvasNodeDeletable } from "./canvas-clipboard.js";
import { projectVisibleItems } from "./canvas-performance.js";
import { useWorkbenchV3SessionBridge } from "./workbench-v3-session-bridge.js";
import { createWorkbenchDocumentActions } from "./workbench-document-actions.js";
import { createWorkbenchPointerActions } from "./workbench-pointer-actions.js";
import { createWorkbenchCameraActions } from "./workbench-camera-actions.js";
import { CanvasWorkbenchView } from "./CanvasWorkbenchView.js";
import { useCanvasWorkbenchSessionState } from "./useCanvasWorkbenchSessionState.js";
import type { WorkspaceDockTab } from "./workspace-dock.js";
import { createWorkbenchAgentPromptActions } from "./workbench-agent-prompt-actions.js";
import { createWorkbenchAgentReviewActions } from "./workbench-agent-review-actions.js";
import { useWorkbenchGlobalInput } from "./useWorkbenchGlobalInput.js";
import { EMPTY_RECONSTRUCTION_REVIEWS, useReconstructionReviewWorkspace } from "./reconstruction-review-workspace.js";
import { createWorkbenchInspectorV3Actions } from "./workbench-inspector-v3-actions.js";
import { projectLegacyComponentMasterIdV3 } from "./canvas-v3-workbench-projection.js";
import { canvasPageContextV3 } from "./canvas-page-navigation-v3.js";
import "./workbench.css";
import "./canvas-grid.css";
import "./workspace-shell.css";
import "./interactions.css";
export type { AgentSelectionContext, CanvasAgentDefaults, CanvasWorkbenchProps } from "./CanvasWorkbench.types.js";
function CanvasWorkbenchSession(props: CanvasWorkbenchProps) {
  const {
    agentDefaults,
    initialNavigatorMode = "layers",
    onExit,
    onHarnessChange,
    onNavigatorModeChange,
    onOpenInHelium,
    onOpenSourceInCode,
    onOpenSourceInCursor,
    onSendAgentContext,
    pageNavigation,
    project,
    reconstructionReviews = EMPTY_RECONSTRUCTION_REVIEWS,
    runtimePort,
    workspaceWarning,
  } = props;
  const {
    agentPatchReview,
    activePageId,
    alignmentGuides,
    camera,
    cameraScheduler,
    canonicalAuthority,
    canonicalSnapshot,
    commandPaletteOpen,
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
    setWorkspaceCollapsed, setWorkspaceSplitRatio, setWorkspaceTab,
    spacePressed,
    suppressCanvasClick,
    tool,
    trace,
    traceSequence,
    viewportElement,
    viewportPointer,
    viewportSize,
    v3SessionError,
    v3SessionStatus,
    workspaceCollapsed, workspacePanels, workspaceSplitRatio, workspaceTab,
  } = useCanvasWorkbenchSessionState(props);
  const v3Session = props.v3Session;
  if (v3Session === undefined) {
    return <div role="alert">Canvas V3 session is unavailable.</div>;
  }
  const pageContext = canvasPageContextV3({
    activePageId,
    legacyDocumentId: project.document.id,
    navigation: pageNavigation,
    onSelectPage: selectActivePage,
    reviews: reconstructionReviews,
    session: v3Session,
    ...(canonicalAuthority === null
      ? {}
      : { authoritativeDocument: canonicalAuthority.getSnapshot().document }),
  });
  const { commitIntentReceipt, history: v3History, redoScene: redoV3, undoScene: undoV3 } =
    useWorkbenchV3SessionBridge({
      authority: canonicalAuthority,
      session: pageContext.session,
      onFailure: (message) => setTrace((current) => [
        ...current,
        { id: `workbench-v3-error-${traceSequence.current++}`, action: message, targetNodeId: "canvas" },
      ]),
    });
  const unavailableMutation = (..._args: unknown[]): never => { throw new Error("Canvas V2 mutation is unavailable in the V3 workbench."); };
  const selectedNodeId = selectedNodeIds.at(-1) ?? null;
  const selectedNodes = selectedNodeIds.flatMap((nodeId) =>
    scene.nodes.filter(({ id }) => id === nodeId),
  );
  const selectedNode = selectedNodes.at(-1);
  const {
    inspectorReview,
    navigableNodes: navigableSceneNodes,
    navigation,
    projectedNodes: projectedSceneNodes,
    workspaceFiles,
  } = useReconstructionReviewWorkspace({
    nodes: scene.nodes,
    pageNavigation: pageContext.navigation,
    project,
    reviews: pageContext.reviews,
    selectedNodeId,
    selectedNodeIds,
  });
  const inspectorSelectedNodes = selectedNodeIds.flatMap((nodeId) =>
    canonicalSnapshot.nodes.filter(({ id }) => id === nodeId),
  );
  const inspectorSelectedNode = inspectorSelectedNodes.at(-1);
  const resolvedCanonicalSelectedNode =
    inspectorSelectedNode === undefined
      ? undefined
      : resolveComponentInstance(
          inspectorSelectedNode,
          canonicalSnapshot.nodes,
        );
  const resolvedSelectedNode =
    resolvedCanonicalSelectedNode === undefined
      ? undefined
      : projectLegacyComponentMasterIdV3(
          resolvedCanonicalSelectedNode,
          project.document.id,
          project.document.nodes,
        );
  const inspectorV3Actions = createWorkbenchInspectorV3Actions({
    commitIntentReceipt,
    projectNodes: canonicalSnapshot.nodes,
    setPreview: setPreviewNodes,
  });
  const selectedHarness =
    project.harness.options.find((option) => option.id === harnessId) ??
    project.harness.options[0];
  const {
    appendTrace,
    commitPreview,
    commitScene,
    createRootNode,
    redoScene,
    selectNode,
    selectNodeIds,
    undoScene,
  } = {
    appendTrace: (action: string, targetNodeId: string) => setTrace((current) => [...current, { id: `workbench-trace-${traceSequence.current++}`, action, targetNodeId }]),
    commitPreview: unavailableMutation,
    commitScene: unavailableMutation,
    createRootNode: unavailableMutation,
    redoScene: redoV3,
    selectNode: (nodeId: string, additive: boolean) => {
      suppressCanvasClick.current = false;
      v3History?.selectNode(nodeId, additive);
    },
    selectNodeIds: (ids: readonly string[]) => {
      v3History?.selectNodeIds(ids);
    },
    undoScene: undoV3,
  };
  const {
    applyApprovedAgentPatch,
    approveAgentPatch,
    confirmRuntimeCheckpointRestore,
    rejectPendingAgentPatch,
    requestAgentChanges,
    restoreRuntimeCheckpoint,
    rollbackAppliedAgentPatch,
    verifyAppliedAgentPatch,
  } = createWorkbenchAgentReviewActions({
    agentPatchBaseNodes: project.document.nodes,
    agentPatchLegacyDocumentId: project.document.id,
    agentPatchReview,
    appendTrace,
    canonicalDocumentRevision:
      canonicalSnapshot.document.revision,
    commitIntentReceipt,
    commitScene,
    documentNodes: scene.nodes,
    documentRevision: scene.revision,
    persistenceProjectId: persistenceProject.id,
    previewSession,
    restorePreview,
    runtimePort,
    runtimeSnapshot,
    selectedNodeId,
    selectedNodeIds,
    setAgentPatchReview,
    setRestorePreview,
    setRuntimeSnapshot,
    setWorkspaceCollapsed,
    setWorkspaceTab,
  });
  const {
    handleViewportClick,
    handleViewportKeyDown,
    handleViewportPointerCancel,
    handleViewportPointerMove,
    handleViewportPointerUp,
    startCreate,
    startMove,
    startResize,
  } = createWorkbenchPointerActions({
    alignmentGuides,
    appendTrace,
    camera,
    cameraScheduler,
    commitPreview,
    commitScene,
    commitIntentReceipt,
    createRootNode,
    gesture,
    nodes: scene.nodes,
    selectNode,
    selectNodeIds,
    selectedNodeIds,
    setAlignmentGuides,
    setCamera,
    setContextMenu,
    setPreviewNodes,
    setSelectionMarquee,
    setTool,
    spacePressed,
    suppressCanvasClick,
    tool,
    viewportElement,
    viewportPointer,
  });

  const {
    copySelection,
    createComponentFromSelection,
    cutSelection,
    deleteSelection,
    detachSelection,
    duplicateSelection,
    frameSelection,
    groupSelection,
    orderSelection,
    pasteImage,
    pasteSelection,
    toggleSelectionProperty,
    ungroupSelection,
  } = createWorkbenchDocumentActions({
    appendTrace,
    commitScene,
    commitIntentReceipt,
    documentId: project.document.id,
    getPastePoint: () =>
      viewportPointer.current === null
        ? null
        : canvasPointFromViewport(camera, viewportPointer.current),
    nodes: scene.nodes,
    selectedNode,
    selectedNodeId,
    selectedNodeIds,
  });

  const { sendAgentContext, switchHarness } =
    createWorkbenchAgentPromptActions({
      appendTrace,
      camera,
      documentNodes: scene.nodes,
      documentRevision: scene.revision,
      harnessId,
      modelId,
      onHarnessChange,
      onSendAgentContext,
      permissionPolicy,
      project,
      prompt,
      promptMode,
      reasoningEffort,
      runtimePort,
      runtimeUnsubscribe,
      selectedHarnessLabel: selectedHarness?.label ?? harnessId,
      selectedNode,
      selectedNodeIds,
      setHarnessId,
      setPrompt,
      setRuntimeSnapshot,
      setWorkspaceCollapsed,
      setWorkspaceTab,
      viewportSize,
    });
  const {
    fitAll,
    fitSelection,
    handleWheel,
    selectAndRevealNode,
    zoomBy,
  } = createWorkbenchCameraActions({
    cameraScheduler,
    gesture,
    nodes: scene.nodes,
    selectNodeIds,
    selectedNodeIds,
    viewportElement,
    viewportSize,
  });

  const openWorkspaceTab = (tab: WorkspaceDockTab) => {
    setWorkspaceCollapsed(false);
    setWorkspaceTab(tab);
  };

  const openNodeContextMenu = (
    node: WorkbenchNode,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedNodeIds.includes(node.id)) {
      selectNodeIds([node.id]);
    }
    setContextMenu({
      nodeId: node.id,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const canDeleteSelection = selectedNodeIds.some((id) => {
      const node = scene.nodes.find((candidate) => candidate.id === id);
      return node !== undefined && isCanvasNodeDeletable(node);
    });
  const activeNodeIds =
    gesture.current?.type === "move"
      ? gesture.current.nodeIds
      : gesture.current?.type === "resize"
        ? [gesture.current.nodeId]
        : [];
  const visibleNodes = projectVisibleItems(
    projectedSceneNodes,
    (node) => ({
      height: node.size.height,
      width: node.size.width,
      x: node.position.x,
      y: node.position.y,
    }),
    {
      height: viewportSize.height,
      translationX: camera.x,
      translationY: camera.y,
      width: viewportSize.width,
      zoom: camera.zoom,
    },
    {
      overscan: 128,
      pinnedIds: [
        ...selectedNodeIds,
        ...activeNodeIds,
        ...(selection.editingId === null ? [] : [selection.editingId]),
        ...(contextMenu === null ? [] : [contextMenu.nodeId]),
      ],
    },
  );
  const grid = canvasGridMetrics(camera);
  const viewportGridStyle = {
    "--canvas-grid-major": `${grid.majorPixels}px`,
    "--canvas-grid-major-x": `${grid.majorX}px`,
    "--canvas-grid-major-y": `${grid.majorY}px`,
    "--canvas-grid-minor": `${grid.minorPixels}px`,
    "--canvas-grid-minor-x": `${grid.minorX}px`,
    "--canvas-grid-minor-y": `${grid.minorY}px`,
  } as CSSProperties;
  const commands = createEditorCommands(
    {
      onCopySelection: copySelection,
      onCreateComponent: createComponentFromSelection,
      onCutSelection: cutSelection,
      onDeleteSelection: deleteSelection,
      onDuplicateSelection: duplicateSelection,
      onFitCanvas: fitAll,
      onFitSelection: fitSelection,
      onFrameSelection: frameSelection,
      onGroupSelection: groupSelection,
      onNewCanvas: navigation.onCreatePage,
      onOpenBrowser: () => openWorkspaceTab("browser"),
      onOpenPalette: () => setCommandPaletteOpen(true),
      onOpenRuns: () => openWorkspaceTab("runs"),
      onOpenSettings: () => openWorkspaceTab("settings"),
      onOrderSelection: orderSelection,
      onPasteSelection: pasteSelection,
      onRedo: redoScene,
      onResetZoom: () => {
        cameraScheduler.current?.schedule((current) => ({
          ...current,
          zoom: 1,
        }));
      },
      onSelectAll: () => {
        const selectableIds = scene.nodes
          .filter((node) => !node.hidden)
          .map((node) => node.id);
        selectNodeIds(selectableIds);
      },
      onSelectProfessionalTool: setTool,
      onSelectTool: (nextTool) => setTool(nextTool),
      onToggleLock: () => toggleSelectionProperty("locked"),
      onToggleVisibility: () => toggleSelectionProperty("hidden"),
      onUngroupSelection: ungroupSelection,
      onUndo: undoScene,
      onZoomIn: () => zoomBy(1.1),
      onZoomOut: () => zoomBy(1 / 1.1),
    },
    {
      canDeleteSelection,
      canDuplicateSelection: selectedNode !== undefined,
      canRedo: historyAvailability.canRedo,
      canUndo: historyAvailability.canUndo,
    },
  );

  useWorkbenchGlobalInput({
    cameraScheduler,
    commands,
    gesture,
    pasteImage,
    pasteSelection,
    selectNodeIds,
    setCamera,
    setContextMenu,
    setPreviewNodes,
    setSelectionMarquee,
    spacePressed,
  });
  const contextNode =
    contextMenu === null
      ? undefined
      : scene.nodes.find((node) => node.id === contextMenu.nodeId);
  const contextMenuProps =
    contextMenu === null || contextNode === undefined
      ? null
      : {
          canCut: canDeleteSelection,
          canDelete: isCanvasNodeDeletable(contextNode),
          canDetach:
            (contextNode.kind === "CodeFrame" ||
              contextNode.kind === "RoutePlaceholder") &&
            contextNode.source !== undefined,
          canGroup: selectedNodeIds.length > 1,
          canPaste:
            hasCanvasSessionClipboard() || canReadCanvasSystemClipboard(),
          canUngroup: selectedNodeIds.some(
            (id) =>
              scene.nodes.find((node) => node.id === id)?.kind ===
              ("Group" as never),
          ),
          node: contextNode,
          onClose: () => setContextMenu(null),
          onCopy: copySelection,
          onCut: cutSelection,
          onDelete: deleteSelection,
          onDetach: detachSelection,
          onDuplicate: duplicateSelection,
          onCreateComponent: createComponentFromSelection,
          onFrame: frameSelection,
          onGroup: groupSelection,
          onAskAgent: () => {
            setPrompt(`Review and improve ${contextNode.name}`);
          },
          ...(() => {
            const sourcePath =
              contextNode.component?.source?.sourceAnchor ??
              contextNode.source?.sourceAnchor;
            return sourcePath === undefined ||
              onOpenSourceInCode === undefined
              ? {}
              : {
                  onOpenSource: () => onOpenSourceInCode(sourcePath),
                };
          })(),
          onOrder: orderSelection,
          onPaste: pasteSelection,
          onToggleLock: () => toggleSelectionProperty("locked"),
          onToggleVisibility: () =>
            toggleSelectionProperty("hidden"),
          onUngroup: ungroupSelection,
          x: contextMenu.x,
          y: contextMenu.y,
        };

  if (v3SessionStatus !== "ready") {
    const message = v3SessionStatus === "error"
      ? `Canvas V3 session failed: ${v3SessionError ?? "Unknown error."}`
      : "Opening Canvas V3 session…";
    return <div role="alert">{message}</div>;
  }

  return (
    <CanvasWorkbenchView
      ariaLabel={`${project.title} canvas workbench`}
      commandPalette={{
        commands,
        installGlobalShortcuts: false,
        onOpenChange: setCommandPaletteOpen,
        open: commandPaletteOpen,
      }}
      contextMenu={contextMenuProps}
      layersWidth={workspacePanels.layersWidth}
      sidebar={{
        initialMode: initialNavigatorMode,
        navigation,
        nodes: navigableSceneNodes,
        ...(onNavigatorModeChange === undefined
          ? {}
          : { onModeChange: onNavigatorModeChange }),
        onSelectNode: selectAndRevealNode,
        productMap,
        selectedNodeId,
      }}
      topbar={{
        activeTool: tool,
        activityOpen:
          workspaceTab === "runs" && !workspaceCollapsed,
        canRedo: historyAvailability.canRedo,
        canUndo: historyAvailability.canUndo,
        onActivityToggle: () => openWorkspaceTab("runs"),
        onFitAll: fitAll,
        onMenuToggle:
          onExit ?? (() => setCommandPaletteOpen(true)),
        onRedo: redoScene,
        onSettingsToggle: () => openWorkspaceTab("settings"),
        onSourceToggle: () => openWorkspaceTab("files"),
        onToolSelect: setTool,
        onUndo: undoScene,
        settingsOpen:
          workspaceTab === "settings" && !workspaceCollapsed,
        title: project.title,
        ...(onExit === undefined ? {} : { showBackAction: true }),
      }}
      viewport={{
        alignmentGuides,
        camera,
        gridStyle: viewportGridStyle,
        nodes: projectedSceneNodes,
        nodeView: {
          onContextMenu: openNodeContextMenu,
          onPointerDown: startMove,
          onResizePointerDown: startResize,
          onSelect: selectNode,
        },
        onClick: handleViewportClick,
        onEmptyExit: onExit,
        onKeyDown: handleViewportKeyDown,
        onOpenBrowser: () => openWorkspaceTab("browser"),
        onPointerCancel: handleViewportPointerCancel,
        onPointerDown: (event) => {
          startCreate(event);
          if (
            tool === "pan" ||
            event.button === 1 ||
            spacePressed.current
          ) {
            setContextMenu(null);
            event.preventDefault();
            gesture.current = {
              type: "pan",
              pointerId: event.pointerId,
              origin: pointFromEvent(event),
              camera,
            };
            event.currentTarget.setPointerCapture?.(event.pointerId);
            return;
          }
          if (event.target !== event.currentTarget) {
            return;
          }
          setContextMenu(null);
          if (
            (tool === "select" || tool === "Scale") &&
            event.button === 0
          ) {
            const bounds =
              event.currentTarget.getBoundingClientRect();
            const origin = {
              x: event.clientX - bounds.left,
              y: event.clientY - bounds.top,
            };
            gesture.current = {
              type: "marquee",
              pointerId: event.pointerId,
              origin,
              current: origin,
              additive: event.shiftKey,
              initialSelectedIds: selectedNodeIds,
              camera,
            };
            setSelectionMarquee({
              active: true,
              height: 0,
              width: 0,
              x: origin.x,
              y: origin.y,
            });
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }
        },
        onPointerMove: handleViewportPointerMove,
        onPointerUp: handleViewportPointerUp,
        onSelectTool: setTool,
        onWheel: handleWheel,
        promptDock: {
          documentRevision: scene.revision,
          harnessId,
          harnessOptions: project.harness.options,
          modelId,
          ...(agentDefaults === undefined
            ? {}
            : { modelOptions: agentDefaults.modelOptions }),
          onHarnessChange: switchHarness,
          onModelChange: setModelId,
          onPromptChange: setPrompt,
          onPromptModeChange: setPromptMode,
          onSettingsToggle: () => openWorkspaceTab("settings"),
          onSubmit: sendAgentContext,
          prompt,
          promptMode,
          permissionPolicy,
          runtimeConnected: runtimePort !== undefined,
          selectedNode,
          settingsOpen:
            workspaceTab === "settings" && !workspaceCollapsed,
        },
        proposalTargetIds:
          runtimeSnapshot?.proposal?.targetIds ?? [],
        ref: viewportElement,
        selectedNodeIds,
        selectionMarquee,
        tool,
        visibleNodes,
      }}
      workspace={{
        activeTab: workspaceTab,
        agentPatchReview,
        browserAddress: previewSession.address,
        browserDocumentRevision: previewSession.documentRevision,
        browserLastGood: previewSession.lastGood,
        browserProjectId: previewSession.projectId,
        browserReason: previewSession.reason,
        browserRevision: previewSession.navigationRevision,
        browserSessionId: previewSession.sessionId,
        browserStatus: previewSession.status,
        browserUrl: previewSession.url,
        collapsed: workspaceCollapsed,
        connected:
          runtimePort !== undefined ||
          onSendAgentContext !== undefined,
        files: workspaceFiles,
        harnessId,
        harnessOptions: project.harness.options,
        history: displayHistory,
        inspectorWidth: workspacePanels.inspectorWidth,
        inspector: (
          <>
            <Inspector
              node={resolvedSelectedNode}
              onChange={unavailableMutation}
              onChangeSelection={unavailableMutation}
              onDelete={deleteSelection}
              onDetach={detachSelection}
              onDuplicate={duplicateSelection}
              onPreview={unavailableMutation}
              onPreviewSelection={unavailableMutation}
              selectedNodes={inspectorSelectedNodes}
              v3Actions={inspectorV3Actions}
              {...(onOpenSourceInCode === undefined
                ? {}
                : { onOpenSource: onOpenSourceInCode })}
              {...(onOpenSourceInCursor === undefined
                ? {}
                : { onOpenSourceInCursor })}
            />
            {inspectorReview}
          </>
        ),
        onActiveTabChange: setWorkspaceTab,
        onApplyAgentPatch: applyApprovedAgentPatch,
        onApproveAgentPatch: approveAgentPatch,
        onBrowserAddressChange: (address) => {
          dispatchPreview({ type: "edit-address", address });
        },
        onBrowserError: (reason, sessionId) => {
          dispatchPreview({ type: "error", reason, sessionId });
        },
        onBrowserNavigate: (url) => {
          dispatchPreview({
            type: "navigate",
            sessionId: `preview-session-${globalThis.crypto.randomUUID()}`,
            url,
          });
        },
        onBrowserReady: (evidence) => {
          dispatchPreview({ type: "ready", ...evidence });
        },
        onBrowserReload: () => {
          dispatchPreview({
            type: "reload",
            sessionId: `preview-session-${globalThis.crypto.randomUUID()}`,
          });
        },
        onBrowserStop: () => {
          dispatchPreview({ type: "stop" });
        },
        ...(onOpenInHelium === undefined ? {} : { onOpenInHelium }),
        ...(runtimePort === undefined || runtimeSnapshot === null
          ? {}
          : {
              onCancelRuntime: () => {
                void runtimePort.cancel(runtimeSnapshot.runId);
              },
            }),
        onRejectAgentPatch: rejectPendingAgentPatch,
        onRequestAgentChanges: requestAgentChanges,
        onRestoreCheckpoint: restoreRuntimeCheckpoint,
        onCancelRestore: () => setRestorePreview(null),
        onConfirmRestore: () => {
          void confirmRuntimeCheckpointRestore();
        },
        onRollbackAgentPatch: rollbackAppliedAgentPatch,
        onVerifyAgentPatch: verifyAppliedAgentPatch,
        onCollapsedChange: setWorkspaceCollapsed, onSplitRatioChange: setWorkspaceSplitRatio,
        modelId,
        ...(agentDefaults === undefined
          ? {}
          : { modelOptions: agentDefaults.modelOptions }),
        onHarnessChange: switchHarness,
        onModelChange: setModelId,
        onPermissionChange: setPermissionPolicy,
        onReasoningChange: setReasoningEffort,
        permission: permissionPolicy,
        reasoning: reasoningEffort,
        restorePreview,
        runtimeSnapshot,
        splitRatio: workspaceSplitRatio,
        trace: [...trace, ...commandTrace],
      }}
      {...(workspaceWarning === undefined ? {} : { workspaceWarning })}
    />
  );
}
// Keyed boundary prevents one document from persisting another's editing session.
export function CanvasWorkbench(props: CanvasWorkbenchProps) {
  if (props.v3Session === undefined) return <div role="alert">Canvas V3 session is unavailable.</div>;
  const authorityProject = props.authorityProject ?? props.project;
  const sessionKey = `${props.project.document.id}:${canvasSourceFingerprint(authorityProject)}`;
  return <CanvasWorkbenchSession key={sessionKey} {...props} />;
}
