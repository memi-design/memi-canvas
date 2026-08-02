import type { ReactNode } from "react";

import type { WorkspaceDockProps } from "./workspace-dock.js";
import { BrowserPanel } from "./workspace-dock-browser.js";
import { WorkspaceDockEmptyState } from "./workspace-dock-empty-state.js";
import { RunsPanel } from "./workspace-dock-runs.js";

// Atomic Design: molecule — read-only workspace node and page inventory.
function FilesPanel({ files }: Pick<WorkspaceDockProps, "files">) {
  if (files.length === 0) {
    return (
      <WorkspaceDockEmptyState>
        No files or canvas nodes yet.
      </WorkspaceDockEmptyState>
    );
  }

  return (
    <ul aria-label="Workspace files" className="workspace-dock__files">
      {files.map((item) => (
        <li key={item.id}>
          <span
            aria-hidden="true"
            className="workspace-dock__file-kind"
          >
            {item.kind === "page" ? "P" : "N"}
          </span>
          <span>
            <strong>{item.name}</strong>
            {item.detail ? <small>{item.detail}</small> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Atomic Design: molecule — safe, read-only harness configuration summary.
function SettingsPanel({
  settings,
  settingsContent,
}: Pick<WorkspaceDockProps, "settings" | "settingsContent">) {
  const rows = [
    ["Harness", settings.harness],
    ["Model", settings.model],
    ["Reasoning", settings.reasoning],
    ["Permission", settings.permission],
  ] as const;

  return (
    <div className="workspace-dock__settings">
      {settingsContent}
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p
        className={
          settings.connected === true
            ? "workspace-dock__connection workspace-dock__connection--connected"
            : "workspace-dock__connection"
        }
        role="status"
      >
        <span aria-hidden="true" />
        {settings.connected === true
          ? "Runtime ready"
          : "Disconnected · Local preview only"}
      </p>
    </div>
  );
}

export function workspaceDockPanelContent(
  props: WorkspaceDockProps,
): ReactNode {
  switch (props.activeTab) {
    case "inspect":
      return props.inspectContent ?? (
        <WorkspaceDockEmptyState>
          Select a layer to inspect it.
        </WorkspaceDockEmptyState>
      );
    case "browser":
      return (
        <BrowserPanel
          browserAddress={props.browserAddress}
          browserDocumentRevision={props.browserDocumentRevision}
          browserLastGood={props.browserLastGood}
          browserProjectId={props.browserProjectId}
          browserReason={props.browserReason}
          browserRevision={props.browserRevision}
          browserSessionId={props.browserSessionId}
          browserStatus={props.browserStatus}
          browserUnavailableReason={props.browserUnavailableReason}
          browserUrl={props.browserUrl}
          onBrowserAddressChange={props.onBrowserAddressChange}
          onBrowserError={props.onBrowserError}
          onBrowserNavigate={props.onBrowserNavigate}
          onBrowserReady={props.onBrowserReady}
          onBrowserReload={props.onBrowserReload}
          onBrowserStop={props.onBrowserStop}
          onOpenInHelium={props.onOpenInHelium}
        />
      );
    case "runs":
      return (
        <RunsPanel
          {...(props.agentPatchReview === undefined
            ? {}
            : { agentPatchReview: props.agentPatchReview })}
          history={props.history}
          {...(props.onCancelRuntime === undefined
            ? {}
            : { onCancelRuntime: props.onCancelRuntime })}
          {...(props.onCancelRestore === undefined
            ? {}
            : { onCancelRestore: props.onCancelRestore })}
          {...(props.onConfirmRestore === undefined
            ? {}
            : { onConfirmRestore: props.onConfirmRestore })}
          {...(props.onApproveAgentPatch === undefined
            ? {}
            : { onApproveAgentPatch: props.onApproveAgentPatch })}
          {...(props.onApplyAgentPatch === undefined
            ? {}
            : { onApplyAgentPatch: props.onApplyAgentPatch })}
          {...(props.onRejectAgentPatch === undefined
            ? {}
            : { onRejectAgentPatch: props.onRejectAgentPatch })}
          {...(props.onRequestAgentChanges === undefined
            ? {}
            : {
                onRequestAgentChanges: props.onRequestAgentChanges,
              })}
          {...(props.onRestoreCheckpoint === undefined
            ? {}
            : { onRestoreCheckpoint: props.onRestoreCheckpoint })}
          {...(props.onRollbackAgentPatch === undefined
            ? {}
            : { onRollbackAgentPatch: props.onRollbackAgentPatch })}
          {...(props.onVerifyAgentPatch === undefined
            ? {}
            : { onVerifyAgentPatch: props.onVerifyAgentPatch })}
          {...(props.runtimeSnapshot === undefined
            ? {}
            : { runtimeSnapshot: props.runtimeSnapshot })}
          {...(props.restorePreview === undefined
            ? {}
            : { restorePreview: props.restorePreview })}
          trace={props.trace}
        />
      );
    case "files":
      return <FilesPanel files={props.files} />;
    case "settings":
      return (
        <SettingsPanel
          settings={props.settings}
          settingsContent={props.settingsContent}
        />
      );
  }
}
