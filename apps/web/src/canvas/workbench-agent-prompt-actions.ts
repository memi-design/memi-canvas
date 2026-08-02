import type {
  Dispatch,
  SetStateAction,
} from "react";

import type { CanvasCamera } from "./canvas-camera.js";
import type {
  CanvasRuntimePortV1,
  CanvasRuntimeSnapshot,
} from "./canvas-runtime-port.js";
import type {
  AgentSelectionContext,
} from "./CanvasWorkbench.types.js";
import type {
  PermissionPolicy,
  PromptMode,
  ReasoningEffort,
} from "./harness-config.js";
import {
  createSelectionState,
  designDocumentFromWorkbench,
  type CanvasWorkbenchProject,
  type Size,
  type WorkbenchNode,
} from "./model.js";
import {
  createSelectionContextCapsuleFromLegacyDocument,
} from "./selection-context-capsule.js";
import type { WorkspaceDockTab } from "./workspace-dock.js";

type AppendTrace = (
  action: string,
  targetNodeId: string,
  eventHarnessId?: string,
) => void;

interface RuntimeSubscriptionRef {
  current: (() => void) | null;
}

export interface WorkbenchAgentPromptActionsContext {
  readonly appendTrace: AppendTrace;
  readonly camera: CanvasCamera;
  readonly documentNodes: readonly WorkbenchNode[];
  readonly documentRevision: number;
  readonly harnessId: string;
  readonly modelId: string;
  readonly onHarnessChange:
    | ((harnessId: string) => void)
    | undefined;
  readonly onSendAgentContext:
    | ((context: AgentSelectionContext) => void)
    | undefined;
  readonly permissionPolicy: PermissionPolicy;
  readonly project: CanvasWorkbenchProject;
  readonly prompt: string;
  readonly promptMode: PromptMode;
  readonly reasoningEffort: ReasoningEffort;
  readonly runtimePort: CanvasRuntimePortV1 | undefined;
  readonly runtimeUnsubscribe: RuntimeSubscriptionRef;
  readonly selectedHarnessLabel: string;
  readonly selectedNode: WorkbenchNode | undefined;
  readonly selectedNodeIds: readonly string[];
  readonly setHarnessId: Dispatch<SetStateAction<string>>;
  readonly setPrompt: Dispatch<SetStateAction<string>>;
  readonly setRuntimeSnapshot: Dispatch<
    SetStateAction<CanvasRuntimeSnapshot | null>
  >;
  readonly setWorkspaceCollapsed: Dispatch<SetStateAction<boolean>>;
  readonly setWorkspaceTab: Dispatch<SetStateAction<WorkspaceDockTab>>;
  readonly viewportSize: Size;
}

export interface WorkbenchAgentPromptActions {
  readonly sendAgentContext: () => Promise<void>;
  readonly switchHarness: (nextId: string) => void;
}

function runtimeViewport(
  camera: CanvasCamera,
  viewportSize: Size,
) {
  return {
    height: viewportSize.height,
    width: viewportSize.width,
    x: camera.x,
    y: camera.y,
    zoom: camera.zoom,
  };
}

async function selectionContext(
  context: WorkbenchAgentPromptActionsContext,
  prompt: string,
): Promise<AgentSelectionContext> {
  const selectedNode = context.selectedNode;
  if (selectedNode === undefined) {
    throw new Error("A selected node is required.");
  }
  const sourceRevision =
    selectedNode.component?.source.repositoryRevision ??
    selectedNode.source?.repositoryRevision ??
    selectedNode.provenance?.repositoryRevision ??
    `canvas-revision-${context.documentRevision}`;
  const capsule =
    await createSelectionContextCapsuleFromLegacyDocument({
      document: designDocumentFromWorkbench({
        ...context.project.document,
        nodes: context.documentNodes,
        revision: context.documentRevision,
      }),
      selection: createSelectionState(context.selectedNodeIds),
      sourceRevision,
      viewport: {
        pointerMode: "select",
        translation: {
          x: context.camera.x,
          y: context.camera.y,
        },
        viewportSize: context.viewportSize,
        zoom: context.camera.zoom,
      },
    });
  return {
    capsule,
    documentId: context.project.document.id,
    harnessId: context.harnessId,
    nodeIds: context.selectedNodeIds,
    revision: context.documentRevision,
    prompt,
    promptMode: context.promptMode,
    modelId: context.modelId,
    permissionPolicy: context.permissionPolicy,
    reasoningEffort: context.reasoningEffort,
  };
}

export function createWorkbenchAgentPromptActions(
  context: WorkbenchAgentPromptActionsContext,
): WorkbenchAgentPromptActions {
  const switchHarness = (nextId: string) => {
    const nextLabel =
      context.project.harness.options.find(
        (option) => option.id === nextId,
      )?.label ?? nextId;
    context.setHarnessId(nextId);
    context.onHarnessChange?.(nextId);
    if (context.selectedNode !== undefined) {
      context.appendTrace(
        `Switched harness from ${context.selectedHarnessLabel} to ${nextLabel} for ${context.selectedNode.name}`,
        context.selectedNode.id,
        nextId,
      );
    }
  };

  const sendAgentContext = async () => {
    const selectedNode = context.selectedNode;
    const normalizedPrompt = context.prompt.trim();
    if (selectedNode === undefined || normalizedPrompt.length === 0) {
      return;
    }
    let accepted = false;
    if (context.runtimePort !== undefined) {
      try {
        context.runtimeUnsubscribe.current?.();
        const submission = await context.runtimePort.submit({
          documentId: context.project.document.id,
          documentNodes: context.documentNodes,
          documentRevision: context.documentRevision,
          harnessId: context.harnessId,
          modelId: context.modelId,
          permissionPolicy: context.permissionPolicy,
          projectId: context.project.id,
          prompt: normalizedPrompt,
          promptMode: context.promptMode,
          reasoningEffort: context.reasoningEffort,
          selectedNodeIds: context.selectedNodeIds,
          viewport: runtimeViewport(
            context.camera,
            context.viewportSize,
          ),
        });
        context.runtimeUnsubscribe.current =
          context.runtimePort.subscribe(
            submission.runId,
            context.setRuntimeSnapshot,
          );
        context.appendTrace(
          `Submitted ${context.promptMode} to connected runtime`,
          selectedNode.id,
          context.harnessId,
        );
        accepted = true;
      } catch (error) {
        context.appendTrace(
          `Runtime submission failed: ${error instanceof Error ? error.message : String(error)}`,
          selectedNode.id,
          context.harnessId,
        );
      }
    } else if (context.onSendAgentContext === undefined) {
      context.appendTrace(
        `Prepared ${context.promptMode} prompt for ${selectedNode.name} with ${context.selectedHarnessLabel} · ${context.modelId} (local only; no harness adapter connected)`,
        selectedNode.id,
        context.harnessId,
      );
    } else {
      try {
        context.onSendAgentContext(
          await selectionContext(context, normalizedPrompt),
        );
        context.appendTrace(
          `Submitted ${context.promptMode} prompt for ${selectedNode.name} to ${context.selectedHarnessLabel} · ${context.modelId}`,
          selectedNode.id,
          context.harnessId,
        );
        accepted = true;
      } catch (error) {
        context.appendTrace(
          `Context preparation failed: ${error instanceof Error ? error.message : String(error)}`,
          selectedNode.id,
          context.harnessId,
        );
      }
    }
    if (accepted) {
      context.setPrompt("");
    }
    context.setWorkspaceCollapsed(false);
    context.setWorkspaceTab("runs");
  };

  return { sendAgentContext, switchHarness };
}
