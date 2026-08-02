import {
  CANVAS_RUNTIME_PORT_KIND,
  CANVAS_RUNTIME_PORT_VERSION,
  type CanvasRuntimeApproval,
  type CanvasRuntimeCheckpoint,
  type CanvasRuntimeDurability,
  type CanvasRuntimeEvent,
  type CanvasRuntimePortV1,
  type CanvasRuntimeProposal,
  type CanvasRuntimeRestorePreview,
  type CanvasRuntimeSnapshot,
  type CanvasRuntimeState,
  type DemoCanvasRuntimeOptions,
} from "./canvas-runtime-port-contract.js";
import {
  changedNodeCount,
  createProposal,
  DEFAULT_MAX_STORAGE_BYTES,
  DEFAULT_MAX_STORED_CHECKPOINTS,
  DEFAULT_MAX_STORED_RUNS,
  deterministicCanvasDigest,
  freezeClone,
  isRecord,
  isRuntimeCheckpoint,
  isRuntimeSnapshot,
  type StoredCanvasRuntime,
} from "./canvas-runtime-port-demo-helpers.js";

// Deterministic test/dev fixture. Production applications must inject a
// separately authenticated CanvasRuntimePortV1 implementation.
export function createDemoCanvasRuntimePort(
  options: DemoCanvasRuntimeOptions = {},
): CanvasRuntimePortV1 {
  const idFactory =
    options.idFactory ?? (() => globalThis.crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  const schedule =
    options.schedule ??
    ((callback: () => void, delay: number) =>
      globalThis.setTimeout(callback, delay));
  const maxStorageBytes =
    options.maxStorageBytes ?? DEFAULT_MAX_STORAGE_BYTES;
  const maxStoredCheckpoints =
    options.maxStoredCheckpoints ?? DEFAULT_MAX_STORED_CHECKPOINTS;
  const maxStoredRuns =
    options.maxStoredRuns ?? DEFAULT_MAX_STORED_RUNS;
  let loadFailure: string | null = null;
  let stored: unknown = null;
  try {
    stored = options.storage?.load() ?? null;
  } catch (error) {
    loadFailure =
      error instanceof Error
        ? error.message
        : "Saved Demo recovery state could not be read.";
  }
  const hasStoredEnvelope =
    isRecord(stored) &&
    stored.version === 1 &&
    Array.isArray(stored.runs) &&
    Array.isArray(stored.checkpoints);
  const storedEnvelope = hasStoredEnvelope
    ? (stored as Record<string, unknown>)
    : null;
  const storedRuns: readonly unknown[] = hasStoredEnvelope
    ? (storedEnvelope!.runs as readonly unknown[])
    : [];
  const storedCheckpoints: readonly unknown[] = hasStoredEnvelope
    ? (storedEnvelope!.checkpoints as readonly unknown[])
    : [];
  const validStoredRuns = storedRuns.filter(isRuntimeSnapshot);
  const validStoredCheckpoints =
    storedCheckpoints.filter(isRuntimeCheckpoint);
  if (
    loadFailure === null &&
    hasStoredEnvelope &&
    (validStoredRuns.length !== storedRuns.length ||
      validStoredCheckpoints.length !== storedCheckpoints.length)
  ) {
    loadFailure =
      "Saved Demo recovery records failed validation; storage was not overwritten.";
  }
  let durability: CanvasRuntimeDurability =
    options.storage === undefined
      ? {
          reason: "Runtime storage is not configured.",
          status: "memory-only",
        }
      : loadFailure === null
        ? { reason: null, status: "durable" }
        : { reason: loadFailure, status: "volatile" };
  const runs = new Map<string, CanvasRuntimeSnapshot>(
    validStoredRuns.map((snapshot) => [
      snapshot.runId,
      freezeClone({ ...snapshot, durability }),
    ]),
  );
  const checkpoints = new Map<string, CanvasRuntimeCheckpoint>(
    validStoredCheckpoints.map((checkpoint) => [
      checkpoint.id,
      freezeClone(checkpoint),
    ]),
  );
  const restorePreviews = new Map<string, CanvasRuntimeRestorePreview>();
  const listeners = new Map<
    string,
    Set<(snapshot: CanvasRuntimeSnapshot) => void>
  >();

  function read(runId: string): CanvasRuntimeSnapshot {
    const snapshot = runs.get(runId);
    if (snapshot === undefined) {
      throw new Error("Canvas Demo run was not found.");
    }
    return snapshot;
  }

  function persist(): CanvasRuntimeDurability {
    if (options.storage === undefined) {
      return {
        reason: "Runtime storage is not configured.",
        status: "memory-only",
      };
    }
    if (loadFailure !== null) {
      return { reason: loadFailure, status: "volatile" };
    }
    const payload: StoredCanvasRuntime = {
      checkpoints: [...checkpoints.values()].slice(-maxStoredCheckpoints),
      runs: [...runs.values()].slice(-maxStoredRuns),
      version: 1,
    };
    const serialized = JSON.stringify(payload);
    const byteLength = new TextEncoder().encode(serialized).byteLength;
    if (byteLength > maxStorageBytes) {
      return {
        reason: `Recovery payload is ${byteLength} bytes; the ${maxStorageBytes}-byte limit was exceeded.`,
        status: "volatile",
      };
    }
    try {
      options.storage.save(payload);
      return { reason: null, status: "durable" };
    } catch (error) {
      return {
        reason:
          error instanceof Error
            ? error.message
            : "Demo recovery state could not be saved.",
        status: "volatile",
      };
    }
  }

  function publish(snapshot: CanvasRuntimeSnapshot): CanvasRuntimeSnapshot {
    const attemptedDurability: CanvasRuntimeDurability =
      options.storage === undefined
        ? {
            reason: "Runtime storage is not configured.",
            status: "memory-only",
          }
        : loadFailure === null
          ? { reason: null, status: "durable" }
          : { reason: loadFailure, status: "volatile" };
    const candidate = freezeClone({
      ...snapshot,
      durability: attemptedDurability,
    });
    runs.set(snapshot.runId, candidate);
    durability = persist();
    const frozen = freezeClone({ ...candidate, durability });
    runs.set(snapshot.runId, frozen);
    listeners.get(snapshot.runId)?.forEach((listener) => listener(frozen));
    return frozen;
  }

  function advanceRunState(
    runId: string,
    state: CanvasRuntimeState,
    message: string,
    proposal?: CanvasRuntimeProposal,
  ): CanvasRuntimeSnapshot {
    const current = read(runId);
    const event: CanvasRuntimeEvent = {
      at: now(),
      id: idFactory(),
      message,
      sequence: current.events.length + 1,
      state,
    };
    return publish({
      ...current,
      events: [...current.events, event],
      ...(proposal === undefined ? {} : { proposal }),
      state,
    });
  }

  function requireWaiting(runId: string): CanvasRuntimeSnapshot {
    const snapshot = read(runId);
    if (
      snapshot.state !== "Waiting for approval" ||
      snapshot.proposal === null
    ) {
      throw new Error("Canvas Demo run is not waiting for approval.");
    }
    return snapshot;
  }

  return {
    kind: CANVAS_RUNTIME_PORT_KIND,
    version: CANVAS_RUNTIME_PORT_VERSION,
    async approve(request) {
      const snapshot = requireWaiting(request.runId);
      const proposal = snapshot.proposal!;
      if (snapshot.envelope.permissionPolicy === "inspect-only") {
        throw new Error(
          "Inspect-only permission cannot approve a canvas effect.",
        );
      }
      if (request.proposalId !== proposal.id) {
        throw new Error("Proposal identity does not match.");
      }
      if (request.proposalDigest !== proposal.digest) {
        throw new Error("Proposal digest does not match.");
      }
      if (request.baseRevision !== proposal.baseRevision) {
        throw new Error("Proposal base revision does not match.");
      }
      const approval: CanvasRuntimeApproval = freezeClone({
        authority: "canvas-only",
        baseRevision: proposal.baseRevision,
        id: `approval-${idFactory()}`,
        proposalDigest: proposal.digest,
        proposalId: proposal.id,
        runId: request.runId,
        usesRemaining: 1,
      });
      publish({ ...snapshot, approval });
      return approval;
    },
    async apply(request) {
      const snapshot = requireWaiting(request.runId);
      const proposal = snapshot.proposal!;
      if (
        snapshot.approval === null ||
        request.approval.id !== snapshot.approval.id ||
        request.approval.proposalDigest !== proposal.digest ||
        request.currentRevision !== proposal.baseRevision
      ) {
        throw new Error(
          "Canvas Demo apply requires the current exact approval.",
        );
      }
      return advanceRunState(
        request.runId,
        "Applying",
        "Applying one canvas-only EditorCommand. Repository writes remain blocked.",
      );
    },
    async cancel(runId) {
      const snapshot = read(runId);
      if (
        snapshot.state === "Complete" ||
        snapshot.state === "Canceled"
      ) {
        return snapshot;
      }
      return advanceRunState(
        runId,
        "Canceled",
        "Run canceled without changing the canvas or repository.",
      );
    },
    async checkpoint(request) {
      const snapshot = read(request.runId);
      if (snapshot.state !== "Complete" || snapshot.verification === null) {
        throw new Error("Only a complete Demo run can be checkpointed.");
      }
      const documentDigest = deterministicCanvasDigest(request.documentNodes);
      if (
        request.documentRevision !==
          snapshot.verification.checkedRevision ||
        documentDigest !== snapshot.verification.documentDigest
      ) {
        throw new Error(
          "Checkpoint content does not match the exact verified canvas result.",
        );
      }
      const checkpoint: CanvasRuntimeCheckpoint = freezeClone({
        documentNodes: request.documentNodes,
        documentRevision: request.documentRevision,
        id: `checkpoint-${idFactory()}`,
        projectId: snapshot.envelope.projectId,
        runId: request.runId,
        selectedNodeIds: request.selectedNodeIds,
        traceSequence: snapshot.events.length,
      });
      checkpoints.set(checkpoint.id, checkpoint);
      publish({ ...snapshot, checkpoint });
      return checkpoint;
    },
    async getRun(runId) {
      return read(runId);
    },
    async getLatestRun(projectId) {
      const matching = [...runs.values()].filter(
        ({ envelope }) => envelope.projectId === projectId,
      );
      return matching.at(-1) ?? null;
    },
    async reject(runId) {
      requireWaiting(runId);
      const canceled = advanceRunState(
        runId,
        "Canceled",
        "Proposal rejected. No canvas or repository state changed.",
      );
      return publish({
        ...canceled,
        approval: null,
        proposal: null,
      });
    },
    async prepareRestore(request) {
      const checkpoint = checkpoints.get(request.checkpointId);
      if (checkpoint === undefined) {
        throw new Error("Canvas Demo checkpoint was not found.");
      }
      if (checkpoint.projectId !== request.projectId) {
        throw new Error("Checkpoint project identity does not match.");
      }
      if (
        !Number.isInteger(request.currentDocumentRevision) ||
        request.currentDocumentRevision < checkpoint.documentRevision
      ) {
        throw new Error(
          "Canvas Demo restore requires a current revision at or beyond the checkpoint.",
        );
      }
      const preview: CanvasRuntimeRestorePreview = freezeClone({
        changedNodeCount: changedNodeCount(
          request.currentDocumentNodes,
          checkpoint.documentNodes,
        ),
        checkpoint,
        checkpointNodeCount: checkpoint.documentNodes.length,
        currentDocumentRevision: request.currentDocumentRevision,
        currentNodeCount: request.currentDocumentNodes.length,
        effectsExcluded: true,
        expectedDocumentDigest: deterministicCanvasDigest(
          checkpoint.documentNodes,
        ),
        id: `restore-preview-${idFactory()}`,
        projectId: request.projectId,
      });
      restorePreviews.set(preview.id, preview);
      return preview;
    },
    async requestChanges(request) {
      const snapshot = requireWaiting(request.runId);
      const feedback = request.feedback.trim();
      if (feedback.length === 0) {
        throw new Error("A request for changes requires feedback.");
      }
      publish({
        ...snapshot,
        approval: null,
        proposal: null,
      });
      advanceRunState(
        request.runId,
        "Planning",
        `Revising the canvas-only proposal: ${feedback}`,
      );
      schedule(() => {
        if (read(request.runId).state !== "Planning") {
          return;
        }
        advanceRunState(
          request.runId,
          "Using tools",
          "Re-reading the same bounded Product Map evidence.",
        );
      }, 80);
      schedule(() => {
        if (read(request.runId).state !== "Using tools") {
          return;
        }
        advanceRunState(
          request.runId,
          "Waiting for approval",
          `Revised proposal is ready: ${feedback}`,
          createProposal(snapshot.envelope, request.runId, feedback),
        );
      }, 160);
      return read(request.runId);
    },
    async restore(request) {
      const preview = restorePreviews.get(request.previewId);
      if (preview === undefined) {
        throw new Error("Canvas Demo restore preview was not found.");
      }
      const checkpoint = preview.checkpoint;
      if (
        preview.projectId !== request.projectId ||
        checkpoint.projectId !== request.projectId
      ) {
        throw new Error("Checkpoint project identity does not match.");
      }
      if (
        request.currentDocumentRevision !==
        preview.currentDocumentRevision + 1
      ) {
        throw new Error("Canvas changed outside the reviewed restore.");
      }
      if (
        deterministicCanvasDigest(request.currentDocumentNodes) !==
        preview.expectedDocumentDigest
      ) {
        throw new Error(
          "Restored canvas digest does not match the reviewed checkpoint.",
        );
      }
      restorePreviews.delete(preview.id);
      const snapshot = advanceRunState(
        checkpoint.runId,
        "Complete",
        `Local canvas state restored and verified from ${checkpoint.id}. External actions were excluded.`,
      );
      return freezeClone({
        checkpoint,
        expectedCurrentRevision: preview.currentDocumentRevision,
        effectsReplayed: false,
        restored: true,
        snapshot,
      });
    },
    async submit(request) {
      if (request.prompt.trim().length === 0) {
        throw new Error("Canvas Demo prompt must not be empty.");
      }
      if (request.selectedNodeIds.length === 0) {
        throw new Error("Canvas Demo requires an explicit selection.");
      }
      const runId = `run-${idFactory()}`;
      const threadId = `thread-${request.projectId}`;
      const initial: CanvasRuntimeSnapshot = {
        approval: null,
        checkpoint: null,
        durability,
        envelope: freezeClone(request),
        events: [],
        proposal: null,
        runId,
        state: "Ready",
        threadId,
        verification: null,
      };
      runs.set(runId, freezeClone(initial));
      persist();
      advanceRunState(
        runId,
        "Queued",
        "Queued in Deterministic Demo · zero tokens · zero cost.",
      );
      schedule(() => {
        if (read(runId).state === "Queued") {
          advanceRunState(
            runId,
            "Planning",
            "Planning against the exact selection and document revision.",
          );
        }
      }, 80);
      schedule(() => {
        if (read(runId).state === "Planning") {
          advanceRunState(
            runId,
            "Using tools",
            "Reading bounded local Product Map evidence. No provider or shell is connected.",
          );
        }
      }, 160);
      schedule(() => {
        if (read(runId).state === "Using tools") {
          advanceRunState(
            runId,
            "Waiting for approval",
            "Canvas-only proposal is ready for exact human review.",
            createProposal(request, runId),
          );
        }
      }, 240);
      return { runId, threadId };
    },
    subscribe(runId, listener) {
      const runListeners =
        listeners.get(runId) ??
        new Set<(snapshot: CanvasRuntimeSnapshot) => void>();
      runListeners.add(listener);
      listeners.set(runId, runListeners);
      listener(read(runId));
      return () => {
        runListeners.delete(listener);
      };
    },
    async verify(request) {
      const snapshot = read(request.runId);
      if (snapshot.state !== "Applying") {
        throw new Error("Canvas Demo verification requires an applied draft.");
      }
      const proposal = snapshot.proposal;
      if (proposal === null) {
        throw new Error("Canvas Demo verification requires an exact proposal.");
      }
      const actualDigest = deterministicCanvasDigest(request.documentNodes);
      const expectedDigest = deterministicCanvasDigest(
        proposal.patch.proposedNodes,
      );
      if (
        request.documentRevision !== proposal.baseRevision + 1 ||
        actualDigest !== expectedDigest
      ) {
        throw new Error(
          "Canvas Demo verification does not match the exact applied proposal.",
        );
      }
      if (
        request.previewEvidence.projectId !== snapshot.envelope.projectId ||
        request.previewEvidence.documentRevision !==
          request.documentRevision ||
        request.previewEvidence.sessionId.trim().length === 0 ||
        request.previewEvidence.verifiedAt.trim().length === 0
      ) {
        throw new Error(
          "Canvas Demo verification requires a current matching preview receipt.",
        );
      }
      advanceRunState(
        request.runId,
        "Verifying",
        "Running deterministic canvas authority checks.",
      );
      advanceRunState(
        request.runId,
        "Complete",
        "Verified canvas-only result · 0 repository files changed.",
      );
      return publish({
        ...read(request.runId),
        verification: {
          checkedRevision: request.documentRevision,
          documentDigest: actualDigest,
          filesChanged: 0,
          previewSessionId: request.previewEvidence.sessionId,
          scope: "deterministic-demo",
          status: "passed",
          summary:
            "Exact canvas proposal digest and Demo preview receipt matched. Repository verification was not performed; 0 repository files changed.",
        },
      });
    },
  };
}
