import { describe, expect, it, vi } from "vitest";

import type {
  RuntimePrivateTransport,
  RuntimeRpcRequest,
} from "@memi/protocol";
import {
  CheckpointIdSchema,
  CorrelationIdSchema,
  ProcessRequestIdSchema,
  ProjectIdSchema,
  RunIdSchema,
  WorktreeIdSchema,
} from "@memi/protocol";

import {
  RuntimeClientError,
  createRuntimeClientV1,
} from "./runtime-client.js";

const ids = {
  correlation: CorrelationIdSchema.parse(
    "cor_01J00000000000000000000000",
  ),
  project: ProjectIdSchema.parse("prj_01J00000000000000000000000"),
  request: ProcessRequestIdSchema.parse(
    "prq_01J00000000000000000000000",
  ),
  run: RunIdSchema.parse("run_01J00000000000000000000000"),
  worktree: WorktreeIdSchema.parse(
    "wrk_01J00000000000000000000000",
  ),
  checkpoint: CheckpointIdSchema.parse(
    "chk_01J00000000000000000000000",
  ),
} as const;
const revision = "a".repeat(40);
const hash = `sha256:${"b".repeat(64)}`;
const now = "2026-07-29T12:00:00.000Z";

function projectResponse(request: RuntimeRpcRequest) {
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    correlationId: request.correlationId,
    method: request.method,
    receivedAt: now,
    ok: true,
    result: {
      project: {
        documentRevision: 7,
        id: ids.project,
        managedWorktreeId: null,
        name: "Buzzr",
        sourceRevision: revision,
        status: "ready",
        updatedAt: now,
      },
    },
  };
}

function client(transport: RuntimePrivateTransport) {
  return createRuntimeClientV1({
    authToken: () => "private-session-token-with-at-least-32-bytes",
    correlationId: () => ids.correlation,
    now: () => now,
    requestId: () => ids.request,
    transport,
  });
}

function resultFor(method: RuntimeRpcRequest["method"]) {
  const binding = { documentRevision: 7, sourceRevision: revision };
  const project = {
    documentRevision: 7,
    id: ids.project,
    managedWorktreeId: ids.worktree,
    name: "Buzzr",
    sourceRevision: revision,
    status: "ready",
    updatedAt: now,
  };
  const session = {
    activity: {
      activeApprovalId: null,
      activeReviewId: "rvw_01J00000000000000000000000",
      activeRunId: ids.run,
      boundDocumentRevision: 7,
      boundSourceRevision: revision,
      conflictedOverlayIds: [],
    },
    camera: {
      viewportHeight: 800,
      viewportWidth: 1200,
      x: 0,
      y: 0,
      zoom: 1,
    },
    documentId: "buzzr-mobile",
    documentRevision: 7,
    kind: "memi-workspace-session" as const,
    panels: {
      inspectorCollapsed: false,
      inspectorWidth: 320,
      layersCollapsed: false,
      layersWidth: 240,
      workspaceSplitRatio: 0.5,
    },
    projectId: ids.project,
    schemaVersion: 1 as const,
    selection: {
      anchorId: "node-button",
      editingNodeId: null,
      focusedNodeId: "node-button",
      selectedIds: ["node-button"],
    },
    sessionRevision: 3,
    sourceRevision: revision,
    updatedAt: now,
  };
  const run = {
    base: binding,
    id: ids.run,
    projectId: ids.project,
    reviewId: "rvw_01J00000000000000000000000",
    revision: new Set([
      "runs.cancel",
      "runs.resume",
      "runs.retry",
      "runs.handoff",
      "runs.checkpoint",
    ]).has(method)
      ? 5
      : 4,
    startedAt: now,
    state: method === "runs.cancel" ? "cancelled" : "running",
    updatedAt: now,
    worktreeId: ids.worktree,
  };
  const review = {
    artifactIds: [],
    base: binding,
    changedPaths: [],
    id: "rvw_01J00000000000000000000000",
    projectId: ids.project,
    proposalDigest: hash,
    revision: 2,
    runId: ids.run,
    status: method === "reviews.resolve" ? "approved" : "pending",
    updatedAt: now,
  };
  const worktree = {
    baseSourceRevision: revision,
    headSourceRevision: revision,
    id: ids.worktree,
    projectId: ids.project,
    revision: 1,
    runId: ids.run,
    status: "ready",
    updatedAt: now,
  };
  const preview = {
    artifactIds: [],
    binding,
    id: "pvw_01J00000000000000000000000",
    localUrl: "http://localhost:4173/",
    projectId: ids.project,
    revision: 1,
    status: "ready",
    updatedAt: now,
    worktreeId: ids.worktree,
  };
  const promotion = {
    completedAt: now,
    completedRevision: revision,
    expectedDirtyFingerprint: hash,
    expectedOriginalRevision: revision,
    id: "prm_01J00000000000000000000000",
    projectId: ids.project,
    requestedAt: now,
    reviewId: "rvw_01J00000000000000000000000",
    status: "completed",
    worktreeId: ids.worktree,
  };
  const importJob = {
    applications: [],
    artifacts: [],
    cancellationRequestedAt:
      method === "imports.cancel" || method === "imports.discard"
        ? now
        : null,
    checkpoints: [],
    createdAt: now,
    currentApplicationId: null,
    currentScenarioId: null,
    failures: [],
    id: "imp_01J00000000000000000000000",
    kind: "memi-import-job",
    logs: [],
    managedWorktreeId: null,
    progress: { captured: 0, failed: 0, remaining: 0, total: 0 },
    projectId: method === "imports.commit" ? ids.project : null,
    projectName: "Buzzr",
    repository: {
      dirtyFingerprint: hash,
      rootPath: "/tmp/Buzzr",
      sourceRevision: revision,
    },
    revision: 5,
    scenarios: [],
    selectedHarness: null,
    stage: method === "imports.commit" ? "save" : "validate",
    state:
      method === "imports.commit"
        ? "committed"
        : method === "imports.cancel"
          ? "paused"
          : method === "imports.discard"
            ? "cancelled"
          : "running",
    updatedAt: now,
  };
  return {
    "canvasDocuments.open": { initialized: false, journal: null },
    "canvasDocuments.load": { journal: null },
    "canvasDocuments.initialize": { journal: null },
    "canvasDocuments.append": { receipt: null },
    "canvasDocuments.checkpoint": { journal: null },
    "projects.list": { projects: [project] },
    "projects.get": { project },
    "imports.plan": {
      plan: {
        token: "ipl_01J00000000000000000000000",
        repository: importJob.repository,
        applications: [],
        recipes: [],
        inventory: {
          fileCount: 0,
          screenCount: 0,
          componentCount: 0,
          tokenCount: 0,
          screens: [],
          components: [],
          tokens: [],
          truncated: {
            screens: false,
            components: false,
            tokens: false,
          },
        },
        scenarioCount: 0,
        errors: [],
      },
    },
    "imports.list": {
      jobs: [{
        id: importJob.id,
        projectId: importJob.projectId,
        projectName: importJob.projectName,
        state: importJob.state,
        stage: importJob.stage,
        sourceRevision: importJob.repository.sourceRevision,
        progress: importJob.progress,
        currentApplicationId: importJob.currentApplicationId,
        currentScenarioId: importJob.currentScenarioId,
        failureCount: importJob.failures.length,
        revision: importJob.revision,
        updatedAt: importJob.updatedAt,
      }],
    },
    "imports.start": { job: importJob },
    "imports.get": { job: importJob },
    "imports.cancel": { job: importJob },
    "imports.discard": { job: importJob },
    "imports.resume": { job: importJob },
    "imports.retryFailed": { job: importJob },
    "imports.commit": { job: importJob },
    "imports.purgeAll": {
      complete: true,
      counts: {
        artifacts: 2,
        jobs: 1,
        managedWorktrees: 1,
        pendingPlans: 1,
        plans: 1,
        projectBindings: 1,
        simulatorAuthorities: 1,
      },
      failures: [],
    },
    "sessions.restore": { session },
    "sessions.migrateLegacy": {
      session,
      status: "migrated",
    },
    "sessions.save": { session },
    "runs.start": { run },
    "runs.get": { run },
    "runs.cancel": { run },
    "runs.resume": { run },
    "runs.retry": { run },
    "runs.handoff": { run },
    "runs.checkpoint": {
      checkpoint: {
        binding,
        createdAt: now,
        eventSequence: 1,
        id: ids.checkpoint,
        runId: ids.run,
      },
      run,
    },
    "runs.events": {
      events: [
        {
          correlationId: ids.correlation,
          kind: "progress",
          message: "Reading selected source.",
          occurredAt: now,
          percent: 25,
          runId: ids.run,
          sequence: 1,
        },
      ],
      nextAfterSequence: 1,
      runRevision: 4,
    },
    "reviews.get": { review },
    "reviews.resolve": { review },
    "worktrees.create": { worktree },
    "worktrees.get": { worktree },
    "previews.start": { preview },
    "previews.get": { preview },
    "promotions.request": { promotion },
    "promotions.get": { promotion },
  }[method];
}

describe("RuntimeClientV1 renderer client", () => {
  it("keeps authentication out of the bounded serialized envelope", async () => {
    const exchange = vi.fn(
      async (input: Parameters<RuntimePrivateTransport["exchange"]>[0]) =>
        projectResponse(input.envelope as RuntimeRpcRequest),
    );
    const runtime = client({ exchange });

    const result = await runtime.projects.get({ projectId: ids.project });

    expect(result.project.name).toBe("Buzzr");
    expect(exchange).toHaveBeenCalledOnce();
    const call = exchange.mock.calls[0]![0];
    expect(call.authorization).toBe(
      "Bearer private-session-token-with-at-least-32-bytes",
    );
    expect(JSON.stringify(call.envelope)).not.toContain("private-session");
    expect(Object.isFrozen(call.envelope)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.project)).toBe(true);
  });

  it("exposes every bounded runtime surface through the same transport", async () => {
    const exchange = vi.fn(
      async (input: Parameters<RuntimePrivateTransport["exchange"]>[0]) => {
        const request = input.envelope;
        return {
          correlationId: request.correlationId,
          method: request.method,
          ok: true,
          receivedAt: now,
          requestId: request.requestId,
          result: resultFor(request.method),
          schemaVersion: 1,
        };
      },
    );
    const runtime = client({ exchange });
    const expected = { documentRevision: 7, sourceRevision: revision };
    const savedSession = resultFor("sessions.save");
    if (savedSession === undefined || !("session" in savedSession)) {
      throw new Error("Missing session fixture.");
    }
    const {
      sessionRevision: savedSessionRevision,
      updatedAt: savedSessionUpdatedAt,
      ...sessionDraft
    } = savedSession.session;
    expect(savedSessionRevision).toBe(3);
    expect(savedSessionUpdatedAt).toBe(now);

    await runtime.projects.list();
    await runtime.projects.get({ projectId: ids.project });
    await expect(runtime.imports.purgeAll()).resolves.toMatchObject({
      complete: true,
      counts: {
        jobs: 1,
        projectBindings: 1,
      },
      failures: [],
    });
    await runtime.sessions.restore({
      documentId: "buzzr-mobile",
      projectId: ids.project,
    });
    await runtime.sessions.migrateLegacy({
      documentId: "buzzr-mobile",
      legacyRecordHash: "fnv1a64:0123456789abcdef",
      migrationKey: "local-storage:memi-canvas:buzzr-mobile",
      projectId: ids.project,
      session: sessionDraft,
    });
    await runtime.sessions.save({
      documentId: "buzzr-mobile",
      expected: { ...expected, sessionRevision: 2 },
      projectId: ids.project,
      session: sessionDraft,
    });
    await runtime.runs.start({
      contextHash: hash,
      expected,
      harnessId: "codex",
      modelId: "gpt-5.5",
      permissionPolicy: "approval",
      projectId: ids.project,
      prompt: "Change the selected button.",
    });
    await runtime.runs.get({ projectId: ids.project, runId: ids.run });
    await runtime.runs.cancel({
      expected: { ...expected, runRevision: 4 },
      projectId: ids.project,
      runId: ids.run,
    });
    await runtime.runs.resume({
      checkpointId: ids.checkpoint,
      expected: { ...expected, runRevision: 4 },
      projectId: ids.project,
      runId: ids.run,
    });
    await runtime.runs.retry({
      expected: { ...expected, runRevision: 4 },
      projectId: ids.project,
      runId: ids.run,
    });
    await runtime.runs.handoff({
      expected: { ...expected, runRevision: 4 },
      projectId: ids.project,
      runId: ids.run,
      targetHarnessId: "claude-code",
      targetModelId: "claude-sonnet",
    });
    await runtime.runs.checkpoint({
      expected: { ...expected, runRevision: 4 },
      label: "Before verification",
      projectId: ids.project,
      runId: ids.run,
    });
    await runtime.runs.events({
      afterSequence: 0,
      expected: { ...expected, runRevision: 4 },
      limit: 100,
      projectId: ids.project,
      runId: ids.run,
    });
    await runtime.reviews.get({
      projectId: ids.project,
      reviewId: "rvw_01J00000000000000000000000",
    });
    await runtime.reviews.resolve({
      decision: "approve",
      expected: { ...expected, reviewRevision: 2 },
      projectId: ids.project,
      proposalDigest: hash,
      reviewId: "rvw_01J00000000000000000000000",
    });
    await runtime.worktrees.create({
      expected,
      projectId: ids.project,
      runId: ids.run,
    });
    await runtime.worktrees.get({
      projectId: ids.project,
      worktreeId: ids.worktree,
    });
    await runtime.previews.start({
      expected,
      projectId: ids.project,
      worktreeId: ids.worktree,
    });
    await runtime.previews.get({
      previewId: "pvw_01J00000000000000000000000",
      projectId: ids.project,
    });
    await runtime.promotions.request({
      expected: {
        ...expected,
        dirtyFingerprint: hash,
        originalRevision: revision,
        reviewRevision: 2,
        worktreeRevision: 1,
      },
      projectId: ids.project,
      proposalDigest: hash,
      reviewId: "rvw_01J00000000000000000000000",
      worktreeId: ids.worktree,
    });
    await runtime.promotions.get({
      projectId: ids.project,
      promotionId: "prm_01J00000000000000000000000",
    });

    expect(exchange).toHaveBeenCalledTimes(22);
  });

  it("fails closed before transport on missing credentials or invalid input", async () => {
    const exchange = vi.fn();
    const missing = createRuntimeClientV1({
      authToken: () => "",
      correlationId: () => ids.correlation,
      now: () => now,
      requestId: () => ids.request,
      transport: { exchange },
    });

    await expect(
      missing.projects.get({ projectId: ids.project }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      client({ exchange }).projects.get({
        // Exercise the runtime schema against an untrusted boundary value.
        projectId: "not-a-project-id" as typeof ids.project,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(exchange).not.toHaveBeenCalled();
  });

  it("fails closed on unsafe credentials and transport failures", async () => {
    const exchange = vi.fn(async () => {
      throw new Error("private socket detail");
    });
    const unsafe = createRuntimeClientV1({
      authToken: () => `${"x".repeat(32)}\n`,
      correlationId: () => ids.correlation,
      now: () => now,
      requestId: () => ids.request,
      transport: { exchange },
    });
    await expect(
      unsafe.projects.get({ projectId: ids.project }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(exchange).not.toHaveBeenCalled();

    const rejectedCredential = createRuntimeClientV1({
      authToken: async () => {
        throw new Error("keychain detail");
      },
      correlationId: () => ids.correlation,
      now: () => now,
      requestId: () => ids.request,
      transport: { exchange },
    });
    await expect(
      rejectedCredential.projects.get({ projectId: ids.project }),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: "The private runtime session could not be loaded.",
    });

    await expect(
      client({ exchange }).projects.get({ projectId: ids.project }),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "The private runtime transport is unavailable.",
      retryable: true,
    });
  });

  it("rejects an invalid configured payload limit", () => {
    expect(() =>
      createRuntimeClientV1({
        authToken: () => "private-session-token-with-at-least-32-bytes",
        correlationId: () => ids.correlation,
        maxPayloadBytes: Number.NaN,
        now: () => now,
        requestId: () => ids.request,
        transport: { exchange: vi.fn() },
      }),
    ).toThrow(RuntimeClientError);
  });

  it("rejects uncorrelated, method-mismatched, and malformed responses", async () => {
    const baseTransport: RuntimePrivateTransport = {
      exchange: async ({ envelope }) => {
        const request = envelope as RuntimeRpcRequest;
        return {
          ...projectResponse(request),
          correlationId: "cor_01J00000000000000000000001",
        };
      },
    };
    await expect(
      client(baseTransport).projects.get({ projectId: ids.project }),
    ).rejects.toMatchObject({ code: "PROTOCOL_VIOLATION" });

    const mismatch: RuntimePrivateTransport = {
      exchange: async ({ envelope }) => ({
        ...projectResponse(envelope as RuntimeRpcRequest),
        method: "projects.list",
        result: { projects: [] },
      }),
    };
    await expect(
      client(mismatch).projects.get({ projectId: ids.project }),
    ).rejects.toMatchObject({ code: "PROTOCOL_VIOLATION" });
  });

  it("rejects event pages outside the requested run and cursor binding", async () => {
    const runtime = client({
      exchange: async ({ envelope }) => ({
        correlationId: envelope.correlationId,
        method: "runs.events",
        ok: true,
        receivedAt: now,
        requestId: envelope.requestId,
        result: {
          events: [
            {
              correlationId: ids.correlation,
              kind: "progress",
              message: "Wrong run.",
              occurredAt: now,
              percent: null,
              runId: "run_01J00000000000000000000001",
              sequence: 6,
            },
          ],
          nextAfterSequence: 6,
          runRevision: 4,
        },
        schemaVersion: 1,
      }),
    });
    await expect(
      runtime.runs.events({
        afterSequence: 5,
        expected: {
          documentRevision: 7,
          runRevision: 4,
          sourceRevision: revision,
        },
        limit: 10,
        projectId: ids.project,
        runId: ids.run,
      }),
    ).rejects.toMatchObject({ code: "PROTOCOL_VIOLATION" });
  });

  it("rejects lifecycle results that do not advance the bound run", async () => {
    const runtime = client({
      exchange: async ({ envelope }) => ({
        correlationId: envelope.correlationId,
        method: "runs.resume",
        ok: true,
        receivedAt: now,
        requestId: envelope.requestId,
        result: {
          run: {
            base: { documentRevision: 7, sourceRevision: revision },
            id: ids.run,
            projectId: ids.project,
            reviewId: null,
            revision: 4,
            startedAt: now,
            state: "running",
            updatedAt: now,
            worktreeId: ids.worktree,
          },
        },
        schemaVersion: 1,
      }),
    });
    await expect(
      runtime.runs.resume({
        checkpointId: ids.checkpoint,
        expected: {
          documentRevision: 7,
          runRevision: 4,
          sourceRevision: revision,
        },
        projectId: ids.project,
        runId: ids.run,
      }),
    ).rejects.toMatchObject({ code: "PROTOCOL_VIOLATION" });
  });

  it("preserves the sidecar error taxonomy without exposing raw responses", async () => {
    const runtime = client({
      exchange: async ({ envelope }) => {
        const request = envelope as RuntimeRpcRequest;
        return {
          schemaVersion: 1,
          requestId: request.requestId,
          correlationId: request.correlationId,
          method: request.method,
          receivedAt: now,
          ok: false,
          error: {
            code: "STALE_REVISION",
            details: [{ key: "documentRevision", value: "8" }],
            message: "Document revision is stale.",
            retryable: false,
          },
        };
      },
    });

    const failure = await runtime.runs
      .start({
        contextHash: `sha256:${"b".repeat(64)}`,
        expected: {
          documentRevision: 7,
          sourceRevision: revision,
        },
        harnessId: "codex",
        modelId: "gpt-5.5",
        permissionPolicy: "approval",
        projectId: ids.project,
        prompt: "Change the selected button.",
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RuntimeClientError);
    expect(failure).toMatchObject({
      code: "STALE_REVISION",
      correlationId: ids.correlation,
      retryable: false,
    });
    expect(failure).not.toHaveProperty("response");
  });

  it("cancels before exchange and propagates an active AbortSignal", async () => {
    const exchange = vi.fn(
      async (input: Parameters<RuntimePrivateTransport["exchange"]>[0]) =>
        projectResponse(input.envelope as RuntimeRpcRequest),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      client({ exchange }).projects.get(
        { projectId: ids.project },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(exchange).not.toHaveBeenCalled();

    const active = new AbortController();
    await client({ exchange }).projects.get(
      { projectId: ids.project },
      { signal: active.signal },
    );
    expect(exchange.mock.calls[0]![0].signal).toBe(active.signal);
  });

  it("rejects oversized responses and post-exchange cancellation", async () => {
    const controller = new AbortController();
    const runtime = client({
      exchange: async ({ envelope }) => {
        controller.abort();
        return {
          ...projectResponse(envelope as RuntimeRpcRequest),
          ignored: "x".repeat(300_000),
        };
      },
    });
    await expect(
      runtime.projects.get(
        { projectId: ids.project },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });

    const oversized = client({
      exchange: async ({ envelope }) => ({
        ...projectResponse(envelope as RuntimeRpcRequest),
        ignored: "x".repeat(300_000),
      }),
    });
    await expect(
      oversized.projects.get({ projectId: ids.project }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});
