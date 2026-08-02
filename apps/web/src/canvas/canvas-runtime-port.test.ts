import { describe, expect, it, vi } from "vitest";

import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import {
  createDemoCanvasRuntimePort,
  type CanvasRuntimeSubmitRequest,
} from "./canvas-runtime-port.js";

function request(
  overrides: Partial<CanvasRuntimeSubmitRequest> = {},
): CanvasRuntimeSubmitRequest {
  return {
    documentId: canvasWorkbenchFixture.document.id,
    documentNodes: canvasWorkbenchFixture.document.nodes,
    documentRevision: canvasWorkbenchFixture.document.revision,
    harnessId: "codex",
    modelId: "gpt-5.5",
    permissionPolicy: "approval",
    projectId: canvasWorkbenchFixture.id,
    prompt: "Create a clearer canvas-only variant.",
    promptMode: "propose",
    reasoningEffort: "xhigh",
    selectedNodeIds: ["node-campaign-card"],
    viewport: {
      height: 700,
      width: 1000,
      x: 120,
      y: 80,
      zoom: 1,
    },
    ...overrides,
  };
}

function previewEvidence(documentRevision: number) {
  return {
    documentRevision,
    projectId: canvasWorkbenchFixture.id,
    sessionId: "preview-session-test",
    verifiedAt: "2026-07-29T06:31:00.000Z",
  };
}

describe("deterministic Canvas runtime port", () => {
  it("streams normalized lifecycle states into a durable project thread", async () => {
    vi.useFakeTimers();
    const port = createDemoCanvasRuntimePort({
      idFactory: (() => {
        let sequence = 0;
        return () => `demo-${++sequence}`;
      })(),
      now: () => "2026-07-29T06:30:00.000Z",
    });

    const submission = await port.submit(request());
    const states: string[] = [];
    const unsubscribe = port.subscribe(submission.runId, (snapshot) => {
      states.push(snapshot.state);
    });
    await vi.runAllTimersAsync();
    unsubscribe();

    expect(submission.threadId).toBe(
      `thread-${canvasWorkbenchFixture.id}`,
    );
    expect(states).toEqual([
      "Queued",
      "Planning",
      "Using tools",
      "Waiting for approval",
    ]);
    const waiting = await port.getRun(submission.runId);
    expect(waiting.proposal).toMatchObject({
      authority: "canvas-only",
      baseRevision: 7,
      targetIds: ["node-campaign-card"],
    });
    expect(waiting.events.map(({ state }) => state)).toEqual(states);
    vi.useRealTimers();
  });

  it("binds approval to the exact proposal digest and base revision", async () => {
    vi.useFakeTimers();
    const port = createDemoCanvasRuntimePort();
    const submission = await port.submit(request());
    await vi.runAllTimersAsync();
    const waiting = await port.getRun(submission.runId);
    const proposal = waiting.proposal!;

    await expect(
      port.approve({
        baseRevision: proposal.baseRevision + 1,
        proposalDigest: proposal.digest,
        proposalId: proposal.id,
        runId: submission.runId,
      }),
    ).rejects.toThrow(/revision/i);
    await expect(
      port.approve({
        baseRevision: proposal.baseRevision,
        proposalDigest: "changed-proposal",
        proposalId: proposal.id,
        runId: submission.runId,
      }),
    ).rejects.toThrow(/digest/i);

    const approval = await port.approve({
      baseRevision: proposal.baseRevision,
      proposalDigest: proposal.digest,
      proposalId: proposal.id,
      runId: submission.runId,
    });
    expect(approval).toMatchObject({
      authority: "canvas-only",
      baseRevision: 7,
      proposalDigest: proposal.digest,
      usesRemaining: 1,
    });
    expect((await port.getRun(submission.runId)).state).toBe(
      "Waiting for approval",
    );
    vi.useRealTimers();
  });

  it("records a request for changes and issues a new exact proposal", async () => {
    vi.useFakeTimers();
    const port = createDemoCanvasRuntimePort({
      idFactory: (() => {
        let sequence = 0;
        return () => `demo-${++sequence}`;
      })(),
    });
    const submission = await port.submit(request());
    await vi.runAllTimersAsync();
    const first = (await port.getRun(submission.runId)).proposal!;

    const planning = await port.requestChanges({
      feedback: "Keep the hierarchy but reduce visual density.",
      runId: submission.runId,
    });
    expect(planning.state).toBe("Planning");
    expect(planning.proposal).toBeNull();

    await vi.runAllTimersAsync();
    const revised = await port.getRun(submission.runId);
    expect(revised.state).toBe("Waiting for approval");
    expect(revised.proposal?.id).not.toBe(first.id);
    expect(revised.proposal?.digest).not.toBe(first.digest);
    expect(revised.events.at(-1)?.message).toMatch(/reduce visual density/i);
    vi.useRealTimers();
  });

  it("blocks apply in inspect-only mode and never claims source effects", async () => {
    vi.useFakeTimers();
    const port = createDemoCanvasRuntimePort();
    const submission = await port.submit(
      request({ permissionPolicy: "inspect-only" }),
    );
    await vi.runAllTimersAsync();
    const proposal = (await port.getRun(submission.runId)).proposal!;

    await expect(
      port.approve({
        baseRevision: proposal.baseRevision,
        proposalDigest: proposal.digest,
        proposalId: proposal.id,
        runId: submission.runId,
      }),
    ).rejects.toThrow(/inspect-only/i);
    expect(proposal.operations.every(({ scope }) => scope === "canvas")).toBe(
      true,
    );
    expect(JSON.stringify(proposal)).not.toMatch(
      /sandbox\.process|git\.effect|external\.publish/i,
    );
    vi.useRealTimers();
  });

  it("applies, verifies, checkpoints, and restores without replaying effects", async () => {
    vi.useFakeTimers();
    const port = createDemoCanvasRuntimePort();
    const submission = await port.submit(request());
    await vi.runAllTimersAsync();
    const proposal = (await port.getRun(submission.runId)).proposal!;
    const approval = await port.approve({
      baseRevision: proposal.baseRevision,
      proposalDigest: proposal.digest,
      proposalId: proposal.id,
      runId: submission.runId,
    });

    const applying = await port.apply({
      approval,
      currentRevision: proposal.baseRevision,
      runId: submission.runId,
    });
    expect(applying.state).toBe("Applying");

    await expect(
      port.verify({
        documentNodes: request().documentNodes,
        documentRevision: proposal.baseRevision + 1,
        previewEvidence: previewEvidence(proposal.baseRevision + 1),
        runId: submission.runId,
      }),
    ).rejects.toThrow(/exact applied proposal/i);
    await expect(
      port.verify({
        documentNodes: proposal.patch.proposedNodes,
        documentRevision: proposal.baseRevision + 1,
        previewEvidence: {
          ...previewEvidence(proposal.baseRevision + 1),
          projectId: "another-project",
        },
        runId: submission.runId,
      }),
    ).rejects.toThrow(/preview receipt/i);

    const completed = await port.verify({
      documentNodes: proposal.patch.proposedNodes,
      documentRevision: proposal.baseRevision + 1,
      previewEvidence: previewEvidence(proposal.baseRevision + 1),
      runId: submission.runId,
    });
    expect(completed.state).toBe("Complete");
    expect(completed.verification).toMatchObject({
      status: "passed",
      scope: "deterministic-demo",
    });

    await expect(
      port.checkpoint({
        documentNodes: request().documentNodes,
        documentRevision: proposal.baseRevision + 1,
        runId: submission.runId,
        selectedNodeIds: ["node-campaign-card"],
      }),
    ).rejects.toThrow(/exact verified canvas result/i);

    const checkpoint = await port.checkpoint({
      documentNodes: completed.proposal!.patch.proposedNodes,
      documentRevision: proposal.baseRevision + 1,
      runId: submission.runId,
      selectedNodeIds: ["node-campaign-card"],
    });
    await expect(
      port.prepareRestore({
        checkpointId: checkpoint.id,
        currentDocumentNodes: proposal.patch.proposedNodes,
        currentDocumentRevision: proposal.baseRevision,
        projectId: canvasWorkbenchFixture.id,
      }),
    ).rejects.toThrow(/current revision/i);
    const preview = await port.prepareRestore({
      checkpointId: checkpoint.id,
      currentDocumentNodes: request().documentNodes,
      currentDocumentRevision: proposal.baseRevision + 2,
      projectId: canvasWorkbenchFixture.id,
    });
    expect(preview).toMatchObject({
      checkpointNodeCount: proposal.patch.proposedNodes.length,
      currentDocumentRevision: proposal.baseRevision + 2,
      effectsExcluded: true,
    });
    await expect(
      port.restore({
        currentDocumentNodes: request().documentNodes,
        currentDocumentRevision: proposal.baseRevision + 3,
        previewId: preview.id,
        projectId: canvasWorkbenchFixture.id,
      }),
    ).rejects.toThrow(/restored canvas digest/i);
    const restored = await port.restore({
      currentDocumentNodes: proposal.patch.proposedNodes,
      currentDocumentRevision: proposal.baseRevision + 3,
      previewId: preview.id,
      projectId: canvasWorkbenchFixture.id,
    });
    expect(restored.restored).toBe(true);
    expect(restored.effectsReplayed).toBe(false);
    expect(restored.snapshot.events.at(-1)?.message).toMatch(
      /restored and verified/i,
    );
    vi.useRealTimers();
  });

  it("recovers the latest project thread and unfinished review from bounded storage", async () => {
    vi.useFakeTimers();
    let stored: unknown = null;
    const storage = {
      load: () => stored,
      save: (value: unknown) => {
        stored = structuredClone(value);
      },
    };
    const first = createDemoCanvasRuntimePort({ storage });
    const submission = await first.submit(request());
    await vi.runAllTimersAsync();
    const waiting = await first.getRun(submission.runId);

    const recovered = createDemoCanvasRuntimePort({ storage });
    const latest = await recovered.getLatestRun(
      canvasWorkbenchFixture.id,
    );

    expect(latest).toMatchObject({
      runId: submission.runId,
      state: "Waiting for approval",
      threadId: `thread-${canvasWorkbenchFixture.id}`,
    });
    expect(latest?.proposal?.digest).toBe(waiting.proposal?.digest);
    vi.useRealTimers();
  });

  it("fails closed when persisted runtime records have corrupt nested data", async () => {
    const port = createDemoCanvasRuntimePort({
      storage: {
        load: () => ({
          checkpoints: [
            {
              documentNodes: "not-nodes",
              documentRevision: 8,
              id: "checkpoint-corrupt",
              projectId: canvasWorkbenchFixture.id,
              runId: "run-corrupt",
              selectedNodeIds: [],
              traceSequence: 1,
            },
          ],
          runs: [
            {
              approval: null,
              checkpoint: null,
              envelope: {
                projectId: canvasWorkbenchFixture.id,
                selectedNodeIds: "not-an-array",
              },
              events: [{ state: "Root access granted" }],
              proposal: { patch: { proposedNodes: "not-nodes" } },
              runId: "run-corrupt",
              state: "Waiting for approval",
              threadId: "thread-corrupt",
              verification: null,
            },
          ],
          version: 1,
        }),
        save: vi.fn(),
      },
    });

    await expect(
      port.getLatestRun(canvasWorkbenchFixture.id),
    ).resolves.toBeNull();
    await expect(port.getRun("run-corrupt")).rejects.toThrow(/not found/i);
    await expect(
      port.prepareRestore({
        checkpointId: "checkpoint-corrupt",
        currentDocumentNodes: [],
        currentDocumentRevision: 8,
        projectId: canvasWorkbenchFixture.id,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("surfaces storage failures instead of claiming durable recovery", async () => {
    const save = vi.fn(() => {
      throw new Error("Quota exceeded");
    });
    const port = createDemoCanvasRuntimePort({
      storage: {
        load: () => null,
        save,
      },
    });

    const submission = await port.submit(request());
    const snapshot = await port.getRun(submission.runId);

    expect(save).toHaveBeenCalled();
    expect(snapshot.durability).toMatchObject({
      status: "volatile",
    });
    expect(snapshot.durability.reason).toMatch(/quota exceeded/i);
  });

  it("does not overwrite corrupt saved recovery state", async () => {
    const save = vi.fn();
    const port = createDemoCanvasRuntimePort({
      storage: {
        load: () => {
          throw new Error("Corrupt saved runtime JSON");
        },
        save,
      },
    });

    const submission = await port.submit(request());
    const snapshot = await port.getRun(submission.runId);

    expect(save).not.toHaveBeenCalled();
    expect(snapshot.durability).toMatchObject({
      status: "volatile",
    });
    expect(snapshot.durability.reason).toMatch(/corrupt saved runtime json/i);
  });

  it("bounds retained runs and fails visibly when one payload is too large", async () => {
    let stored: unknown = null;
    const port = createDemoCanvasRuntimePort({
      maxStorageBytes: 500_000,
      maxStoredRuns: 2,
      storage: {
        load: () => stored,
        save: (value) => {
          stored = structuredClone(value);
        },
      },
    });

    await port.submit(request({ prompt: "First" }));
    await port.submit(request({ prompt: "Second" }));
    const third = await port.submit(request({ prompt: "Third" }));
    expect(
      (stored as { readonly runs: readonly unknown[] }).runs,
    ).toHaveLength(2);
    expect((await port.getRun(third.runId)).durability.status).toBe(
      "durable",
    );

    const oversized = createDemoCanvasRuntimePort({
      maxStorageBytes: 64,
      storage: {
        load: () => null,
        save: vi.fn(),
      },
    });
    const oversizedRun = await oversized.submit(request());
    expect((await oversized.getRun(oversizedRun.runId)).durability).toMatchObject(
      {
        status: "volatile",
      },
    );
  });
});
