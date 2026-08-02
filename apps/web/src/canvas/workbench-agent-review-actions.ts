import type {
  Dispatch,
  SetStateAction,
} from "react";

import {
  rejectAgentPatch,
  type AgentPatchApplication,
  type AgentPatchReview,
} from "./agent-patch.js";
import type {
  CanvasRuntimePortV1,
  CanvasRuntimeRestorePreview,
  CanvasRuntimeSnapshot,
} from "./canvas-runtime-port.js";
import type { WorkbenchNode } from "./model.js";
import type {
  WorkbenchHistoryActions,
} from "./workbench-history-actions.js";
import type { WorkspaceDockTab } from "./workspace-dock.js";
import type { PreviewSession } from "../preview/preview-session.js";

type AppendTrace = (
  action: string,
  targetNodeId: string,
  eventHarnessId?: string,
) => void;

export interface WorkbenchAgentReviewActionsContext {
  readonly agentPatchReview: AgentPatchReview | null;
  readonly appendTrace: AppendTrace;
  readonly canonicalDocumentRevision: number;
  readonly commitScene: WorkbenchHistoryActions["commitScene"];
  readonly documentNodes: readonly WorkbenchNode[];
  readonly documentRevision: number;
  readonly persistenceProjectId: string;
  readonly previewSession: PreviewSession;
  readonly restorePreview: CanvasRuntimeRestorePreview | null;
  readonly runtimePort: CanvasRuntimePortV1 | undefined;
  readonly runtimeSnapshot: CanvasRuntimeSnapshot | null;
  readonly selectedNodeId: string | null;
  readonly selectedNodeIds: readonly string[];
  readonly setAgentPatchReview: Dispatch<
    SetStateAction<AgentPatchReview | null>
  >;
  readonly setRestorePreview: Dispatch<
    SetStateAction<CanvasRuntimeRestorePreview | null>
  >;
  readonly setRuntimeSnapshot: Dispatch<
    SetStateAction<CanvasRuntimeSnapshot | null>
  >;
  readonly setWorkspaceCollapsed: Dispatch<SetStateAction<boolean>>;
  readonly setWorkspaceTab: Dispatch<SetStateAction<WorkspaceDockTab>>;
}

export interface WorkbenchAgentReviewActions {
  readonly applyApprovedAgentPatch: () => Promise<void>;
  readonly applyReviewedAgentPatch:
    () => AgentPatchApplication | null;
  readonly approveAgentPatch: () => Promise<void>;
  readonly confirmRuntimeCheckpointRestore: () => Promise<void>;
  readonly rejectPendingAgentPatch: () => void;
  readonly requestAgentChanges: () => Promise<void>;
  readonly restoreRuntimeCheckpoint: () => Promise<void>;
  readonly rollbackAppliedAgentPatch: () => void;
  readonly verifyAppliedAgentPatch: () => Promise<void>;
}

const DEMO_HARNESS = "deterministic-demo";

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorkbenchAgentReviewActions(
  context: WorkbenchAgentReviewActionsContext,
): WorkbenchAgentReviewActions {
  const targetId = () => context.selectedNodeId ?? "canvas";

  const applyReviewedAgentPatch = () => {
    const review = context.agentPatchReview;
    if (
      review === null ||
      review.status !== "pending" ||
      review.patch.baseRevision !== context.documentRevision
    ) {
      return null;
    }
    const applyingReview: AgentPatchReview = Object.freeze({
      ...review,
      message: `Applying against revision ${review.currentRevision}.`,
      status: "applying",
    });
    context.setAgentPatchReview(applyingReview);
    try {
      const mutation = context.commitScene(
        `Apply agent patch ${review.patch.id}`,
        review.patch.proposedNodes,
        {
          actor: "agent",
          targetIds: review.patch.targetIds,
        },
      );
      const nextReview: AgentPatchReview = Object.freeze({
        ...review,
        currentRevision: mutation.revision,
        message: `Applied at revision ${mutation.revision}.`,
        status: "applied",
      });
      context.setAgentPatchReview(nextReview);
      return { review: nextReview, trace: null };
    } catch (error) {
      const failedReview: AgentPatchReview = Object.freeze({
        ...review,
        message: `Failed without changing the document: ${failureMessage(error)}`,
        status: "failed",
      });
      context.setAgentPatchReview(failedReview);
      return { review: failedReview, trace: null };
    }
  };

  const approveAgentPatch = async () => {
    const review = context.agentPatchReview;
    if (review === null) {
      return;
    }
    const runtimeProposal = context.runtimeSnapshot?.proposal;
    if (context.runtimePort === undefined) {
      applyReviewedAgentPatch();
      return;
    }
    if (
      context.runtimeSnapshot === null ||
      runtimeProposal?.patch.id !== review.patch.id
    ) {
      context.appendTrace(
        "Demo approval blocked because the runtime proposal no longer matches the visible review.",
        targetId(),
        DEMO_HARNESS,
      );
      return;
    }
    try {
      await context.runtimePort.approve({
        baseRevision: runtimeProposal.baseRevision,
        proposalDigest: runtimeProposal.digest,
        proposalId: runtimeProposal.id,
        runId: context.runtimeSnapshot.runId,
      });
      context.appendTrace(
        `Approved exact proposal ${runtimeProposal.digest}; no change applied yet.`,
        targetId(),
        DEMO_HARNESS,
      );
    } catch (error) {
      context.appendTrace(
        `Demo approval blocked: ${failureMessage(error)}`,
        targetId(),
        DEMO_HARNESS,
      );
    }
  };

  const applyApprovedAgentPatch = async () => {
    const snapshot = context.runtimeSnapshot;
    if (
      context.runtimePort === undefined ||
      snapshot === null ||
      snapshot.approval === null
    ) {
      return;
    }
    try {
      await context.runtimePort.apply({
        approval: snapshot.approval,
        currentRevision: context.canonicalDocumentRevision,
        runId: snapshot.runId,
      });
      applyReviewedAgentPatch();
    } catch (error) {
      context.appendTrace(
        `Demo apply blocked: ${failureMessage(error)}`,
        targetId(),
        DEMO_HARNESS,
      );
    }
  };

  const verifyAppliedAgentPatch = async () => {
    const snapshot = context.runtimeSnapshot;
    if (
      context.runtimePort === undefined ||
      snapshot === null ||
      context.agentPatchReview?.status !== "applied"
    ) {
      return;
    }
    try {
      const evidence = context.previewSession.lastGood;
      if (
        context.previewSession.status !== "ready" ||
        evidence === null ||
        evidence.documentRevision !== context.documentRevision
      ) {
        context.setWorkspaceCollapsed(false);
        context.setWorkspaceTab("browser");
        context.appendTrace(
          "Demo verification needs a Ready preview receipt for the current canvas revision.",
          targetId(),
          DEMO_HARNESS,
        );
        return;
      }
      const completed = await context.runtimePort.verify({
        documentNodes: context.documentNodes,
        documentRevision: context.canonicalDocumentRevision,
        previewEvidence: {
          documentRevision: evidence.documentRevision,
          projectId: context.previewSession.projectId,
          sessionId: evidence.sessionId,
          verifiedAt: evidence.verifiedAt,
        },
        runId: snapshot.runId,
      });
      await context.runtimePort.checkpoint({
        documentNodes: context.documentNodes,
        documentRevision: context.canonicalDocumentRevision,
        runId: snapshot.runId,
        selectedNodeIds: context.selectedNodeIds,
      });
      context.appendTrace(
        completed.verification?.summary ??
          "Verified deterministic canvas-only proposal.",
        targetId(),
        DEMO_HARNESS,
      );
    } catch (error) {
      context.appendTrace(
        `Demo verification failed: ${failureMessage(error)}`,
        targetId(),
        DEMO_HARNESS,
      );
    }
  };

  const requestAgentChanges = async () => {
    const snapshot = context.runtimeSnapshot;
    if (context.runtimePort === undefined || snapshot === null) {
      return;
    }
    try {
      await context.runtimePort.requestChanges({
        feedback:
          "Keep the selected hierarchy and produce a quieter, more precise canvas draft.",
        runId: snapshot.runId,
      });
      context.appendTrace(
        "Requested a revised canvas-only proposal; no change applied.",
        targetId(),
        DEMO_HARNESS,
      );
    } catch (error) {
      context.appendTrace(
        `Request changes failed: ${failureMessage(error)}`,
        targetId(),
        DEMO_HARNESS,
      );
    }
  };

  const restoreRuntimeCheckpoint = async () => {
    const checkpoint = context.runtimeSnapshot?.checkpoint;
    if (
      context.runtimePort === undefined ||
      checkpoint === null ||
      checkpoint === undefined
    ) {
      return;
    }
    try {
      const preview = await context.runtimePort.prepareRestore({
        checkpointId: checkpoint.id,
        currentDocumentNodes: context.documentNodes,
        currentDocumentRevision: context.canonicalDocumentRevision,
        projectId: context.persistenceProjectId,
      });
      if (
        context.canonicalDocumentRevision !==
        preview.currentDocumentRevision
      ) {
        throw new Error(
          "The canvas changed while restore was being prepared.",
        );
      }
      context.setRestorePreview(preview);
      context.appendTrace(
        `Prepared restore preview for ${checkpoint.id}; no state changed.`,
        checkpoint.selectedNodeIds.at(-1) ?? "canvas",
        DEMO_HARNESS,
      );
    } catch (error) {
      context.appendTrace(
        `Checkpoint restore failed: ${failureMessage(error)}`,
        targetId(),
        DEMO_HARNESS,
      );
    }
  };

  const confirmRuntimeCheckpointRestore = async () => {
    const preview = context.restorePreview;
    if (context.runtimePort === undefined || preview === null) {
      return;
    }
    const checkpoint = preview.checkpoint;
    try {
      if (
        context.canonicalDocumentRevision !==
        preview.currentDocumentRevision
      ) {
        throw new Error(
          "The canvas changed after the restore preview was reviewed.",
        );
      }
      const restoredDocument = context.commitScene(
        `Restore checkpoint ${checkpoint.id}`,
        checkpoint.documentNodes,
        {
          actor: "system",
          selectedIds: checkpoint.selectedNodeIds,
          targetIds: checkpoint.selectedNodeIds,
        },
      );
      const result = await context.runtimePort.restore({
        currentDocumentNodes: restoredDocument.nodes,
        currentDocumentRevision: restoredDocument.revision,
        previewId: preview.id,
        projectId: context.persistenceProjectId,
      });
      context.appendTrace(
        `Restored and verified ${checkpoint.id} without replaying effects.`,
        checkpoint.selectedNodeIds.at(-1) ?? "canvas",
        DEMO_HARNESS,
      );
      context.setRestorePreview(null);
      context.setRuntimeSnapshot(result.snapshot);
    } catch (error) {
      context.appendTrace(
        `Checkpoint restore failed: ${failureMessage(error)}`,
        targetId(),
        DEMO_HARNESS,
      );
    }
  };

  const rollbackAppliedAgentPatch = () => {
    const review = context.agentPatchReview;
    const snapshot = context.runtimeSnapshot;
    if (review?.status !== "applied" || snapshot === null) {
      return;
    }
    context.commitScene(
      `Roll back agent patch ${review.patch.id}`,
      snapshot.envelope.documentNodes,
      {
        actor: "human",
        selectedIds: snapshot.envelope.selectedNodeIds,
        targetIds: review.patch.targetIds,
      },
    );
    context.appendTrace(
      `Rolled back applied canvas draft ${review.patch.id}; runtime evidence remains available.`,
      targetId(),
      DEMO_HARNESS,
    );
  };

  const rejectPendingAgentPatch = () => {
    void (async () => {
      if (
        context.runtimePort !== undefined &&
        context.runtimeSnapshot !== null
      ) {
        await context.runtimePort.reject(
          context.runtimeSnapshot.runId,
        );
      }
      context.setAgentPatchReview((current) =>
        current === null ? null : rejectAgentPatch(current),
      );
    })();
  };

  return {
    applyApprovedAgentPatch,
    applyReviewedAgentPatch,
    approveAgentPatch,
    confirmRuntimeCheckpointRestore,
    rejectPendingAgentPatch,
    requestAgentChanges,
    restoreRuntimeCheckpoint,
    rollbackAppliedAgentPatch,
    verifyAppliedAgentPatch,
  };
}
