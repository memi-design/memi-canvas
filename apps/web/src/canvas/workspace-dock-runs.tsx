import { useEffect, useRef } from "react";

import type { WorkspaceDockProps } from "./workspace-dock.js";
import { WorkspaceDockEmptyState } from "./workspace-dock-empty-state.js";

// Atomic Design: molecule — supplied agent trace and semantic history.
export function RunsPanel({
  agentPatchReview,
  history,
  onCancelRuntime,
  onCancelRestore,
  onConfirmRestore,
  onApplyAgentPatch,
  onApproveAgentPatch,
  onRejectAgentPatch,
  onRequestAgentChanges,
  onRestoreCheckpoint,
  onRollbackAgentPatch,
  onVerifyAgentPatch,
  restorePreview,
  runtimeSnapshot,
  trace,
}: Pick<
  WorkspaceDockProps,
  | "agentPatchReview"
  | "history"
  | "onCancelRuntime"
  | "onCancelRestore"
  | "onConfirmRestore"
  | "onApplyAgentPatch"
  | "onApproveAgentPatch"
  | "onRejectAgentPatch"
  | "onRequestAgentChanges"
  | "onRestoreCheckpoint"
  | "onRollbackAgentPatch"
  | "onVerifyAgentPatch"
  | "restorePreview"
  | "runtimeSnapshot"
  | "trace"
>) {
  const restoreButton = useRef<HTMLButtonElement | null>(null);
  const restoreDialog = useRef<HTMLElement | null>(null);
  const restoreWasOpen = useRef(false);
  useEffect(() => {
    if (restorePreview !== null && restorePreview !== undefined) {
      restoreWasOpen.current = true;
      restoreDialog.current?.focus();
      return;
    }
    if (restoreWasOpen.current) {
      restoreWasOpen.current = false;
      restoreButton.current?.focus();
    }
  }, [restorePreview]);

  if (
    agentPatchReview === null ||
    agentPatchReview === undefined
  ) {
    if (trace.length === 0 && history.length === 0) {
      return <WorkspaceDockEmptyState>No runs yet.</WorkspaceDockEmptyState>;
    }
  }

  const approveDisabled =
    agentPatchReview?.status !== "pending" ||
    (runtimeSnapshot !== undefined &&
      runtimeSnapshot !== null &&
      runtimeSnapshot.approval !== null) ||
    onApproveAgentPatch === undefined;
  const rejectDisabled =
    agentPatchReview === undefined ||
    agentPatchReview === null ||
    agentPatchReview.status === "applied" ||
    agentPatchReview.status === "rejected" ||
    onRejectAgentPatch === undefined;
  const canApply =
    runtimeSnapshot?.state === "Waiting for approval" &&
    runtimeSnapshot.approval !== null &&
    agentPatchReview?.status === "pending" &&
    onApplyAgentPatch !== undefined;
  const canRequestChanges =
    runtimeSnapshot?.state === "Waiting for approval" &&
    runtimeSnapshot.approval === null &&
    agentPatchReview?.status === "pending" &&
    onRequestAgentChanges !== undefined;
  const canVerify =
    runtimeSnapshot?.state === "Applying" &&
    agentPatchReview?.status === "applied" &&
    onVerifyAgentPatch !== undefined;

  return (
    <div className="workspace-dock__runs">
      {runtimeSnapshot ? (
        <section
          aria-label="Collaboration thread"
          className="workspace-dock__thread"
        >
          <header>
            <span>
              <strong>Connected runtime</strong>
              <small>Review and approval required</small>
            </span>
            <span
              className="workspace-dock__run-state"
              data-run-state={runtimeSnapshot.state}
            >
              {runtimeSnapshot.state}
            </span>
          </header>
          <div className="workspace-dock__context-summary">
            <span>{runtimeSnapshot.envelope.selectedNodeIds.length} node</span>
            <span>Revision {runtimeSnapshot.envelope.documentRevision}</span>
            <span>{runtimeSnapshot.envelope.permissionPolicy}</span>
            <span>{runtimeSnapshot.envelope.promptMode}</span>
          </div>
          <section className="workspace-dock__task">
            <h3>Task</h3>
            <p>{runtimeSnapshot.envelope.prompt}</p>
          </section>
          {runtimeSnapshot.durability.status === "volatile" ? (
            <div
              className="workspace-dock__durability-warning"
              role="alert"
            >
              <strong>Recovery unavailable</strong>
              <span>{runtimeSnapshot.durability.reason}</span>
              <small>
                This thread remains in memory only. Do not rely on restart
                recovery.
              </small>
            </div>
          ) : null}
          <details>
            <summary>Exact task envelope</summary>
            <dl>
              <div>
                <dt>Nodes</dt>
                <dd>
                  {runtimeSnapshot.envelope.selectedNodeIds.join(", ")}
                </dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>{runtimeSnapshot.envelope.projectId}</dd>
              </div>
              <div>
                <dt>Document</dt>
                <dd>
                  {runtimeSnapshot.envelope.documentId} ·{" "}
                  {runtimeSnapshot.envelope.documentNodes.length} nodes
                </dd>
              </div>
              <div>
                <dt>Harness</dt>
                <dd>
                  {runtimeSnapshot.envelope.harnessId} ·{" "}
                  {runtimeSnapshot.envelope.modelId}
                </dd>
              </div>
              <div>
                <dt>Execution</dt>
                <dd>
                  {runtimeSnapshot.envelope.promptMode} ·{" "}
                  {runtimeSnapshot.envelope.permissionPolicy} ·{" "}
                  {runtimeSnapshot.envelope.reasoningEffort} reasoning
                </dd>
              </div>
              <div>
                <dt>Viewport</dt>
                <dd>
                  {Math.round(
                    runtimeSnapshot.envelope.viewport.zoom * 100,
                  )}
                  % · {runtimeSnapshot.envelope.viewport.width}×
                  {runtimeSnapshot.envelope.viewport.height}
                </dd>
              </div>
            </dl>
          </details>
          <section className="workspace-dock__activity">
            <h3>Activity</h3>
            <p>
              Status, tool use, evidence, and results are shown here. Private
              model reasoning is never displayed.
            </p>
            <ol aria-label="Agent activity" role="log">
              {runtimeSnapshot.events.map((event) => (
                <li key={event.id}>
                  <span data-run-state={event.state}>{event.state}</span>
                  <p>{event.message}</p>
                </li>
              ))}
            </ol>
          </section>
          {![
            "Complete",
            "Canceled",
            "Failed",
          ].includes(runtimeSnapshot.state) &&
          onCancelRuntime !== undefined ? (
            <button onClick={onCancelRuntime} type="button">
              Cancel run
            </button>
          ) : null}
          {runtimeSnapshot.verification ? (
            <div
              className="workspace-dock__verification"
              role="status"
            >
              <strong>Verification passed · Demo canvas + preview</strong>
              <span>{runtimeSnapshot.verification.summary}</span>
              <small>
                {runtimeSnapshot.verification.filesChanged} repository files
                changed
              </small>
            </div>
          ) : null}
          {runtimeSnapshot.checkpoint ? (
            <div className="workspace-dock__checkpoint">
              <strong>Checkpoint ready</strong>
              <span>{runtimeSnapshot.checkpoint.id}</span>
              <button
                disabled={onRestoreCheckpoint === undefined}
                onClick={onRestoreCheckpoint}
                ref={restoreButton}
                type="button"
              >
                Restore checkpoint
              </button>
              {runtimeSnapshot.state === "Complete" &&
              agentPatchReview?.status === "applied" &&
              onRollbackAgentPatch !== undefined ? (
                <button
                  onClick={onRollbackAgentPatch}
                  type="button"
                >
                  Roll back applied draft
                </button>
              ) : null}
            </div>
          ) : null}
          {restorePreview ? (
            <section
              aria-label="Review checkpoint restore"
              aria-modal="true"
              className="workspace-dock__restore-review"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRestore?.();
                }
              }}
              ref={restoreDialog}
              role="dialog"
              tabIndex={-1}
            >
              <header>
                <strong>Review restore</strong>
                <span>{restorePreview.checkpoint.id}</span>
              </header>
              <dl>
                <div>
                  <dt>Canvas revision</dt>
                  <dd>
                    {restorePreview.currentDocumentRevision} → checkpoint{" "}
                    {restorePreview.checkpoint.documentRevision}
                  </dd>
                </div>
                <div>
                  <dt>Canvas objects</dt>
                  <dd>
                    {restorePreview.changedNodeCount} canvas nodes change ·{" "}
                    {restorePreview.currentNodeCount} →{" "}
                    {restorePreview.checkpointNodeCount}
                  </dd>
                </div>
                <div>
                  <dt>Effects</dt>
                  <dd>External actions are excluded</dd>
                </div>
              </dl>
              <p>
                Restore changes accepted local canvas state. It does not undo
                commits, pushes, deployments, messages, payments, or other
                completed external actions.
              </p>
              <div>
                <button onClick={onCancelRestore} type="button">
                  Cancel restore
                </button>
                <button
                  disabled={onConfirmRestore === undefined}
                  onClick={onConfirmRestore}
                  type="button"
                >
                  Confirm restore
                </button>
              </div>
            </section>
          ) : null}
        </section>
      ) : null}
      {agentPatchReview ? (
        <section
          aria-label="Agent patch review"
          className="workspace-dock__agent-patch"
          role="region"
        >
          <h3>Agent patch</h3>
          <strong>{agentPatchReview.patch.id}</strong>
          <span>
            {agentPatchReview.patch.actor.harnessId} ·{" "}
            {agentPatchReview.patch.actor.modelId}
          </span>
          <small>
            Revision {agentPatchReview.patch.baseRevision} ·{" "}
            {agentPatchReview.patch.targetIds.length} target
            {agentPatchReview.patch.targetIds.length === 1 ? "" : "s"}
          </small>
          {runtimeSnapshot?.proposal ? (
            <>
              <div className="workspace-dock__proposal-scope">
                <span>Canvas-only proposal</span>
                <span>Low risk</span>
                <span>0 repository files</span>
              </div>
              <ol aria-label="Proposal operations">
                {runtimeSnapshot.proposal.operations.map(
                  (operation, index) => (
                    <li key={`${operation.summary}-${index}`}>
                      {operation.summary}
                    </li>
                  ),
                )}
              </ol>
              {runtimeSnapshot.proposal.informationalSourcePaths.length >
              0 ? (
                <details>
                  <summary>Informational source impact</summary>
                  <p>
                    {
                      runtimeSnapshot.proposal.informationalSourcePaths.join(
                        ", ",
                      )
                    }
                  </p>
                  <small>
                    Demo only · these repository files will not be changed.
                  </small>
                </details>
              ) : null}
            </>
          ) : null}
          <p role="status">{agentPatchReview.message}</p>
          <div className="workspace-dock__agent-patch-actions">
            <button
              aria-label={`Approve agent patch ${agentPatchReview.patch.id}`}
              disabled={approveDisabled}
              onClick={onApproveAgentPatch}
              type="button"
            >
              Approve
            </button>
            {canApply ? (
              <button
                aria-label={`Apply agent patch ${agentPatchReview.patch.id}`}
                onClick={onApplyAgentPatch}
                type="button"
              >
                Apply canvas draft
              </button>
            ) : null}
            {canVerify ? (
              <button
                aria-label={`Verify agent patch ${agentPatchReview.patch.id}`}
                onClick={onVerifyAgentPatch}
                type="button"
              >
                Verify
              </button>
            ) : null}
            {canRequestChanges ? (
              <button
                aria-label={`Request changes for agent patch ${agentPatchReview.patch.id}`}
                onClick={onRequestAgentChanges}
                type="button"
              >
                Request changes
              </button>
            ) : null}
            <button
              aria-label={`Reject agent patch ${agentPatchReview.patch.id}`}
              disabled={rejectDisabled}
              onClick={onRejectAgentPatch}
              type="button"
            >
              Reject
            </button>
          </div>
        </section>
      ) : null}
      <section>
        <h3>Trace</h3>
        <ol aria-label="Trace" role="log">
          {trace.map((item) => (
            <li key={item.id}>
              <strong>{item.action}</strong>
              {item.targetNodeId ? <span>{item.targetNodeId}</span> : null}
              {item.harnessId ? <small>{item.harnessId}</small> : null}
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h3>History</h3>
        <ol aria-label="Semantic history">
          {history.map((entry) => (
            <li key={entry.id}>{entry.label}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
