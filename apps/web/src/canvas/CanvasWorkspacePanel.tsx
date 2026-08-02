import type { ReactNode } from "react";

import type { AgentPatchReview } from "./agent-patch.js";
import type { CollaborationTraceItem } from "./collaboration.js";
import {
  CANVAS_MODELS,
  type PermissionPolicy,
  type ReasoningEffort,
} from "./harness-config.js";
import type { HistoryEntry } from "./model.js";
import type {
  CanvasRuntimeRestorePreview,
  CanvasRuntimeSnapshot,
} from "./canvas-runtime-port.js";
import type {
  PreviewReadyEvidence,
  PreviewStatus,
} from "../preview/preview-session.js";
import {
  WorkspaceDock,
  type WorkspaceDockFileItem,
  type WorkspaceDockTab,
} from "./workspace-dock.js";

interface HarnessOption {
  readonly disabled?: boolean;
  readonly id: string;
  readonly label: string;
}

interface CanvasWorkspacePanelProps {
  readonly activeTab: WorkspaceDockTab;
  readonly agentPatchReview?: AgentPatchReview | null;
  readonly browserAddress: string;
  readonly browserDocumentRevision: number;
  readonly browserLastGood: PreviewReadyEvidence | null;
  readonly browserProjectId: string;
  readonly browserReason: string | null;
  readonly browserRevision: number;
  readonly browserSessionId: string | null;
  readonly browserStatus: PreviewStatus;
  readonly browserUrl: string;
  readonly collapsed: boolean;
  readonly connected: boolean;
  readonly files: readonly WorkspaceDockFileItem[];
  readonly harnessId: string;
  readonly harnessOptions: readonly HarnessOption[];
  readonly history: readonly HistoryEntry[];
  readonly inspectorWidth: number;
  readonly inspector: ReactNode;
  readonly modelId: string;
  readonly modelOptions?: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly onActiveTabChange: (tab: WorkspaceDockTab) => void;
  readonly onApplyAgentPatch?: () => void;
  readonly onApproveAgentPatch?: () => void;
  readonly onBrowserAddressChange: (address: string) => void;
  readonly onBrowserNavigate: (url: string) => void;
  readonly onBrowserReady: (evidence: {
    readonly documentRevision: number;
    readonly projectId: string;
    readonly sessionId: string;
    readonly verifiedAt: string;
  }) => void;
  readonly onBrowserError: (reason: string, sessionId: string) => void;
  readonly onBrowserReload: () => void;
  readonly onBrowserStop: () => void;
  readonly onCancelRestore?: () => void;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly onConfirmRestore?: () => void;
  readonly onHarnessChange: (harnessId: string) => void;
  readonly onModelChange: (modelId: string) => void;
  readonly onOpenInHelium?: (url: string) => void;
  readonly onRejectAgentPatch?: () => void;
  readonly onRequestAgentChanges?: () => void;
  readonly onRestoreCheckpoint?: () => void;
  readonly onRollbackAgentPatch?: () => void;
  readonly onVerifyAgentPatch?: () => void;
  readonly onCancelRuntime?: () => void;
  readonly onPermissionChange: (permission: PermissionPolicy) => void;
  readonly onReasoningChange: (effort: ReasoningEffort) => void;
  readonly onSplitRatioChange: (ratio: number) => void;
  readonly permission: PermissionPolicy;
  readonly reasoning: ReasoningEffort;
  readonly restorePreview?: CanvasRuntimeRestorePreview | null;
  readonly runtimeSnapshot?: CanvasRuntimeSnapshot | null;
  readonly splitRatio: number;
  readonly trace: readonly CollaborationTraceItem[];
}

// Atomic Design: organism — inspector, preview, run trace, files, and harness.
export function CanvasWorkspacePanel({
  activeTab,
  agentPatchReview,
  browserAddress,
  browserDocumentRevision,
  browserLastGood,
  browserProjectId,
  browserReason,
  browserRevision,
  browserSessionId,
  browserStatus,
  browserUrl,
  collapsed,
  connected,
  files,
  harnessId,
  harnessOptions,
  history,
  inspectorWidth,
  inspector,
  modelId,
  modelOptions = CANVAS_MODELS,
  onActiveTabChange,
  onApplyAgentPatch,
  onApproveAgentPatch,
  onBrowserAddressChange,
  onBrowserError,
  onBrowserNavigate,
  onBrowserReady,
  onBrowserReload,
  onBrowserStop,
  onCancelRestore,
  onCollapsedChange,
  onConfirmRestore,
  onHarnessChange,
  onModelChange,
  onOpenInHelium,
  onRejectAgentPatch,
  onRequestAgentChanges,
  onRestoreCheckpoint,
  onRollbackAgentPatch,
  onVerifyAgentPatch,
  onCancelRuntime,
  onPermissionChange,
  onReasoningChange,
  onSplitRatioChange,
  permission,
  reasoning,
  restorePreview,
  runtimeSnapshot,
  splitRatio,
  trace,
}: CanvasWorkspacePanelProps) {
  const selectedHarness =
    harnessOptions.find(({ id }) => id === harnessId)?.label ?? harnessId;
  return (
    <WorkspaceDock
      activeTab={activeTab}
      {...(agentPatchReview === undefined
        ? {}
        : { agentPatchReview })}
      browserAddress={browserAddress}
      browserDocumentRevision={browserDocumentRevision}
      browserLastGood={browserLastGood}
      browserProjectId={browserProjectId}
      browserReason={browserReason}
      browserRevision={browserRevision}
      browserSessionId={browserSessionId}
      browserStatus={browserStatus}
      browserUrl={browserUrl}
      collapsed={collapsed}
      files={files}
      history={history}
      inspectorWidth={inspectorWidth}
      inspectContent={inspector}
      onActiveTabChange={onActiveTabChange}
      {...(onApproveAgentPatch === undefined
        ? {}
        : { onApproveAgentPatch })}
      {...(onApplyAgentPatch === undefined
        ? {}
        : { onApplyAgentPatch })}
      onBrowserAddressChange={onBrowserAddressChange}
      onBrowserError={onBrowserError}
      onBrowserNavigate={onBrowserNavigate}
      onBrowserReady={onBrowserReady}
      onBrowserReload={onBrowserReload}
      onBrowserStop={onBrowserStop}
      onCollapsedChange={onCollapsedChange}
      onSplitRatioChange={onSplitRatioChange}
      {...(onCancelRestore === undefined
        ? {}
        : { onCancelRestore })}
      {...(onConfirmRestore === undefined
        ? {}
        : { onConfirmRestore })}
      {...(onOpenInHelium === undefined ? {} : { onOpenInHelium })}
      {...(onRejectAgentPatch === undefined
        ? {}
        : { onRejectAgentPatch })}
      {...(onRequestAgentChanges === undefined
        ? {}
        : { onRequestAgentChanges })}
      {...(onRestoreCheckpoint === undefined
        ? {}
        : { onRestoreCheckpoint })}
      {...(onRollbackAgentPatch === undefined
        ? {}
        : { onRollbackAgentPatch })}
      {...(onVerifyAgentPatch === undefined
        ? {}
        : { onVerifyAgentPatch })}
      {...(onCancelRuntime === undefined
        ? {}
        : { onCancelRuntime })}
      settings={{
        harness: selectedHarness,
        model: modelId,
        reasoning,
        permission,
        connected,
      }}
      splitRatio={splitRatio}
      settingsContent={
        <div className="canvas-runtime-settings">
          <label>
            <span>Harness</span>
            <select
              aria-label="Workspace harness"
              onChange={(event) => onHarnessChange(event.currentTarget.value)}
              value={harnessId}
            >
              {harnessOptions.map((option) => (
                <option
                  disabled={option.disabled}
                  key={option.id}
                  value={option.id}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Model</span>
            <select
              aria-label="Workspace model"
              onChange={(event) => onModelChange(event.currentTarget.value)}
              value={modelId}
            >
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Reasoning</span>
            <select
              aria-label="Workspace reasoning"
              onChange={(event) =>
                onReasoningChange(
                  event.currentTarget.value as ReasoningEffort,
                )
              }
              value={reasoning}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">XHigh</option>
            </select>
          </label>
          <label>
            <span>Permission</span>
            <select
              aria-label="Workspace permission"
              onChange={(event) =>
                onPermissionChange(
                  event.currentTarget.value as PermissionPolicy,
                )
              }
              value={permission}
            >
              <option value="inspect-only">Inspect only</option>
              <option value="approval">Ask before changes</option>
              <option value="full-access">Propose full access</option>
            </select>
          </label>
        </div>
      }
      trace={trace}
      {...(runtimeSnapshot === undefined
        ? {}
        : { runtimeSnapshot })}
      {...(restorePreview === undefined
        ? {}
        : { restorePreview })}
    />
  );
}
