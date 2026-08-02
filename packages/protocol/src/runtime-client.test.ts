import { describe, expect, it } from "vitest";

import {
  MAX_RUNTIME_RPC_BYTES,
  RuntimeRpcRequestSchema,
  RuntimeRpcResponseSchema,
  runtimeRpcByteLength,
} from "./runtime-client.js";

const ids = {
  correlation: "cor_01J00000000000000000000000",
  project: "prj_01J00000000000000000000000",
  request: "prq_01J00000000000000000000000",
  run: "run_01J00000000000000000000000",
  worktree: "wrk_01J00000000000000000000000",
  review: "rvw_01J00000000000000000000000",
  preview: "pvw_01J00000000000000000000000",
  promotion: "prm_01J00000000000000000000000",
} as const;

const revision = "a".repeat(40);
const hash = `sha256:${"b".repeat(64)}`;
const now = "2026-07-29T12:00:00.000Z";

function request(method: string, payload: unknown) {
  return {
    schemaVersion: 1,
    requestId: ids.request,
    correlationId: ids.correlation,
    method,
    sentAt: now,
    payload,
  };
}

describe("RuntimeClientV1 protocol", () => {
  it("accepts strict project and session requests", () => {
    expect(
      RuntimeRpcRequestSchema.parse(
        request("projects.get", { projectId: ids.project }),
      ),
    ).toMatchObject({ method: "projects.get" });

    expect(
      RuntimeRpcRequestSchema.parse(
        request("sessions.save", {
          documentId: "buzzr-mobile",
          expected: {
            documentRevision: 7,
            sessionRevision: null,
            sourceRevision: revision,
          },
          projectId: ids.project,
          session: {
            activity: {
              activeApprovalId: null,
              activeReviewId: null,
              activeRunId: null,
              boundDocumentRevision: null,
              boundSourceRevision: null,
              conflictedOverlayIds: [],
            },
            camera: {
              viewportHeight: 800,
              viewportWidth: 1200,
              x: 10,
              y: 20,
              zoom: 1.25,
            },
            documentId: "buzzr-mobile",
            documentRevision: 7,
            kind: "memi-workspace-session",
            panels: {
              inspectorCollapsed: false,
              inspectorWidth: 320,
              layersCollapsed: false,
              layersWidth: 240,
              workspaceSplitRatio: 0.5,
            },
            projectId: ids.project,
            schemaVersion: 1,
            selection: {
              anchorId: "node-button",
              editingNodeId: null,
              focusedNodeId: "node-button",
              selectedIds: ["node-button"],
            },
            sourceRevision: revision,
          },
        }),
      ),
    ).toMatchObject({ method: "sessions.save" });

    expect(
      RuntimeRpcRequestSchema.parse(
        request("sessions.migrateLegacy", {
          documentId: "buzzr-mobile",
          legacyRecordHash: "fnv1a64:0123456789abcdef",
          migrationKey: "local-storage:memi-canvas:buzzr-mobile",
          projectId: ids.project,
          session: {
            activity: {
              activeApprovalId: null,
              activeReviewId: null,
              activeRunId: null,
              boundDocumentRevision: null,
              boundSourceRevision: null,
              conflictedOverlayIds: [],
            },
            camera: {
              viewportHeight: 800,
              viewportWidth: 1200,
              x: 10,
              y: 20,
              zoom: 1.25,
            },
            documentId: "buzzr-mobile",
            documentRevision: 7,
            kind: "memi-workspace-session",
            panels: {
              inspectorCollapsed: false,
              inspectorWidth: 320,
              layersCollapsed: false,
              layersWidth: 240,
              workspaceSplitRatio: 0.5,
            },
            projectId: ids.project,
            schemaVersion: 1,
            selection: {
              anchorId: "node-button",
              editingNodeId: null,
              focusedNodeId: "node-button",
              selectedIds: ["node-button"],
            },
            sourceRevision: revision,
          },
        }),
      ),
    ).toMatchObject({ method: "sessions.migrateLegacy" });

    const localSession = {
      activity: {
        activeApprovalId: null,
        activeReviewId: null,
        activeRunId: null,
        boundDocumentRevision: null,
        boundSourceRevision: null,
        conflictedOverlayIds: [],
      },
      camera: {
        viewportHeight: 800,
        viewportWidth: 1200,
        x: 0,
        y: 0,
        zoom: 1,
      },
      documentId: "local-canvas",
      documentRevision: 1,
      kind: "memi-workspace-session",
      panels: {
        inspectorCollapsed: false,
        inspectorWidth: 320,
        layersCollapsed: false,
        layersWidth: 240,
        workspaceSplitRatio: 0.5,
      },
      projectId: ids.project,
      schemaVersion: 1,
      selection: {
        anchorId: null,
        editingNodeId: null,
        focusedNodeId: null,
        selectedIds: [],
      },
      sourceRevision: null,
    };
    expect(
      RuntimeRpcRequestSchema.safeParse(
        request("sessions.save", {
          documentId: "local-canvas",
          expected: {
            documentRevision: 1,
            sessionRevision: null,
            sourceRevision: null,
          },
          projectId: ids.project,
          session: localSession,
        }),
      ).success,
    ).toBe(true);
    expect(
      RuntimeRpcRequestSchema.safeParse(
        request("sessions.save", {
          documentId: "local-canvas",
          expected: {
            documentRevision: 1,
            sessionRevision: null,
            sourceRevision: "not-a-revision",
          },
          projectId: ids.project,
          session: localSession,
        }),
      ).success,
    ).toBe(false);
  });

  it("requires exact revision bindings for every mutating surface", () => {
    const cases = [
      request("runs.start", {
        projectId: ids.project,
        prompt: "Make this button more compact.",
        contextHash: hash,
        harnessId: "codex",
        modelId: "gpt-5.5",
      }),
      request("runs.cancel", {
        projectId: ids.project,
        runId: ids.run,
      }),
      request("runs.resume", {
        projectId: ids.project,
        runId: ids.run,
      }),
      request("runs.retry", {
        projectId: ids.project,
        runId: ids.run,
      }),
      request("runs.handoff", {
        projectId: ids.project,
        runId: ids.run,
        targetHarnessId: "claude-code",
      }),
      request("runs.checkpoint", {
        projectId: ids.project,
        runId: ids.run,
      }),
      request("reviews.resolve", {
        projectId: ids.project,
        reviewId: "rvw_01J00000000000000000000000",
        decision: "approve",
        proposalDigest: hash,
      }),
      request("worktrees.create", {
        projectId: ids.project,
        runId: ids.run,
      }),
      request("previews.start", {
        projectId: ids.project,
        worktreeId: "wrk_01J00000000000000000000000",
      }),
      request("promotions.request", {
        projectId: ids.project,
        reviewId: "rvw_01J00000000000000000000000",
      }),
    ];

    for (const candidate of cases) {
      expect(RuntimeRpcRequestSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("defines strict request and response shapes for every runtime surface", () => {
    const binding = {
      documentRevision: 7,
      sourceRevision: revision,
    };
    const session = {
      activity: {
        activeApprovalId: null,
        activeReviewId: ids.review,
        activeRunId: ids.run,
        boundDocumentRevision: 7,
        boundSourceRevision: revision,
        conflictedOverlayIds: [],
      },
      camera: {
        viewportHeight: 800,
        viewportWidth: 1200,
        x: 10,
        y: 20,
        zoom: 1.25,
      },
      documentId: "buzzr-mobile",
      documentRevision: 7,
      kind: "memi-workspace-session",
      panels: {
        inspectorCollapsed: false,
        inspectorWidth: 320,
        layersCollapsed: false,
        layersWidth: 240,
        workspaceSplitRatio: 0.5,
      },
      projectId: ids.project,
      schemaVersion: 1,
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
      reviewId: ids.review,
      revision: 4,
      startedAt: now,
      state: "waiting-for-approval",
      updatedAt: now,
      worktreeId: ids.worktree,
    };
    const review = {
      artifactIds: [],
      base: binding,
      changedPaths: ["components/ui/Button.tsx"],
      id: ids.review,
      projectId: ids.project,
      proposalDigest: hash,
      revision: 2,
      runId: ids.run,
      status: "pending",
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
      id: ids.preview,
      localUrl: "http://127.0.0.1:4173/",
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
      id: ids.promotion,
      projectId: ids.project,
      requestedAt: now,
      reviewId: ids.review,
      status: "completed",
      worktreeId: ids.worktree,
    };
    const {
      sessionRevision: savedSessionRevision,
      updatedAt: savedSessionUpdatedAt,
      ...sessionDraft
    } = session;
    expect(savedSessionRevision).toBe(3);
    expect(savedSessionUpdatedAt).toBe(now);
    const requestCases = [
      request("projects.list", {}),
      request("projects.get", { projectId: ids.project }),
      request("sessions.restore", {
        documentId: "buzzr-mobile",
        projectId: ids.project,
      }),
      request("sessions.migrateLegacy", {
        documentId: "buzzr-mobile",
        legacyRecordHash: "fnv1a64:0123456789abcdef",
        migrationKey: "local-storage:memi-canvas:buzzr-mobile",
        projectId: ids.project,
        session: sessionDraft,
      }),
      request("sessions.save", {
        documentId: "buzzr-mobile",
        expected: { ...binding, sessionRevision: 2 },
        projectId: ids.project,
        session: sessionDraft,
      }),
      request("runs.start", {
        contextHash: hash,
        expected: binding,
        harnessId: "codex",
        modelId: "gpt-5.5",
        permissionPolicy: "approval",
        projectId: ids.project,
        prompt: "Change the selected button.",
      }),
      request("runs.get", { projectId: ids.project, runId: ids.run }),
      request("runs.cancel", {
        expected: { ...binding, runRevision: 4 },
        projectId: ids.project,
        runId: ids.run,
      }),
      request("runs.resume", {
        checkpointId: "chk_01J00000000000000000000000",
        expected: { ...binding, runRevision: 4 },
        projectId: ids.project,
        runId: ids.run,
      }),
      request("runs.retry", {
        expected: { ...binding, runRevision: 4 },
        projectId: ids.project,
        runId: ids.run,
      }),
      request("runs.handoff", {
        expected: { ...binding, runRevision: 4 },
        projectId: ids.project,
        runId: ids.run,
        targetHarnessId: "claude-code",
        targetModelId: "claude-sonnet",
      }),
      request("runs.checkpoint", {
        expected: { ...binding, runRevision: 4 },
        label: "Before verification",
        projectId: ids.project,
        runId: ids.run,
      }),
      request("runs.events", {
        afterSequence: 10,
        expected: { ...binding, runRevision: 4 },
        limit: 100,
        projectId: ids.project,
        runId: ids.run,
      }),
      request("reviews.get", {
        projectId: ids.project,
        reviewId: ids.review,
      }),
      request("reviews.resolve", {
        decision: "approve",
        expected: { ...binding, reviewRevision: 2 },
        projectId: ids.project,
        proposalDigest: hash,
        reviewId: ids.review,
      }),
      request("worktrees.create", {
        expected: binding,
        projectId: ids.project,
        runId: ids.run,
      }),
      request("worktrees.get", {
        projectId: ids.project,
        worktreeId: ids.worktree,
      }),
      request("previews.start", {
        expected: binding,
        projectId: ids.project,
        worktreeId: ids.worktree,
      }),
      request("previews.get", {
        previewId: ids.preview,
        projectId: ids.project,
      }),
      request("promotions.request", {
        expected: {
          ...binding,
          dirtyFingerprint: hash,
          originalRevision: revision,
          reviewRevision: 2,
          worktreeRevision: 1,
        },
        projectId: ids.project,
        proposalDigest: hash,
        reviewId: ids.review,
        worktreeId: ids.worktree,
      }),
      request("promotions.get", {
        projectId: ids.project,
        promotionId: ids.promotion,
      }),
    ];
    for (const candidate of requestCases) {
      expect(RuntimeRpcRequestSchema.safeParse(candidate).success).toBe(true);
    }

    const project = {
      documentRevision: 7,
      id: ids.project,
      managedWorktreeId: ids.worktree,
      name: "Buzzr",
      sourceRevision: revision,
      status: "ready",
      updatedAt: now,
    };
    const results = {
      "projects.list": { projects: [project] },
      "projects.get": { project },
      "sessions.restore": { session },
      "sessions.migrateLegacy": {
        session,
        status: "migrated",
      },
      "sessions.save": { session },
      "runs.start": { run },
      "runs.get": { run },
      "runs.cancel": { run: { ...run, state: "cancelled" } },
      "runs.resume": { run },
      "runs.retry": { run },
      "runs.handoff": { run },
      "runs.checkpoint": {
        checkpoint: {
          binding,
          createdAt: now,
          eventSequence: 11,
          id: "chk_01J00000000000000000000000",
          runId: ids.run,
        },
        run,
      },
      "runs.events": {
        events: [
          {
            correlationId: ids.correlation,
            kind: "progress",
            message: "Verifying the selected component.",
            occurredAt: now,
            percent: 70,
            runId: ids.run,
            sequence: 11,
          },
          {
            cacheReadTokens: 120,
            correlationId: ids.correlation,
            costUsdMicros: 50,
            inputTokens: 300,
            kind: "usage",
            occurredAt: now,
            outputTokens: 40,
            runId: ids.run,
            sequence: 12,
          },
        ],
        nextAfterSequence: 12,
        runRevision: 4,
      },
      "reviews.get": { review },
      "reviews.resolve": { review: { ...review, status: "approved" } },
      "worktrees.create": { worktree },
      "worktrees.get": { worktree },
      "previews.start": { preview },
      "previews.get": { preview },
      "promotions.request": { promotion },
      "promotions.get": { promotion },
    } as const;
    for (const [method, result] of Object.entries(results)) {
      expect(
        RuntimeRpcResponseSchema.safeParse({
          correlationId: ids.correlation,
          method,
          ok: true,
          receivedAt: now,
          requestId: ids.request,
          result,
          schemaVersion: 1,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects a session save that lies about its bound revision", () => {
    expect(
      RuntimeRpcRequestSchema.safeParse(
        request("sessions.save", {
          documentId: "buzzr-mobile",
          expected: {
            documentRevision: 6,
            sessionRevision: 2,
            sourceRevision: revision,
          },
          projectId: ids.project,
          session: {
            activity: {
              activeApprovalId: null,
              activeReviewId: null,
              activeRunId: null,
              boundDocumentRevision: null,
              boundSourceRevision: null,
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
            kind: "memi-workspace-session",
            panels: {
              inspectorCollapsed: false,
              inspectorWidth: 320,
              layersCollapsed: false,
              layersWidth: 240,
              workspaceSplitRatio: 0.5,
            },
            projectId: ids.project,
            schemaVersion: 1,
            selection: {
              anchorId: null,
              editingNodeId: null,
              focusedNodeId: null,
              selectedIds: [],
            },
            sourceRevision: revision,
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("requires feedback when a review requests changes", () => {
    expect(
      RuntimeRpcRequestSchema.safeParse(
        request("reviews.resolve", {
          decision: "request-changes",
          expected: {
            documentRevision: 7,
            reviewRevision: 2,
            sourceRevision: revision,
          },
          projectId: ids.project,
          proposalDigest: hash,
          reviewId: ids.review,
        }),
      ).success,
    ).toBe(false);
  });

  it("accepts only bounded public normalized run events", () => {
    const baseEvent = {
      correlationId: ids.correlation,
      occurredAt: now,
      runId: ids.run,
      sequence: 1,
    };
    const response = {
      correlationId: ids.correlation,
      method: "runs.events",
      ok: true,
      receivedAt: now,
      requestId: ids.request,
      result: {
        events: [
          {
            ...baseEvent,
            kind: "plan",
            steps: [
              {
                label: "Inspect source anchor",
                status: "completed",
              },
            ],
            summary: "Apply the smallest verified source change.",
          },
          {
            ...baseEvent,
            kind: "tool",
            sequence: 2,
            artifactIds: [],
            publicSummary: "Read the selected component source.",
            status: "completed",
            toolName: "source.read",
          },
          {
            ...baseEvent,
            kind: "verification",
            sequence: 3,
            checks: [
              { label: "Typecheck", status: "passed" },
            ],
            status: "passed",
          },
        ],
        nextAfterSequence: 3,
        runRevision: 4,
      },
      schemaVersion: 1,
    };
    expect(RuntimeRpcResponseSchema.safeParse(response).success).toBe(true);

    expect(
      RuntimeRpcResponseSchema.safeParse({
        ...response,
        result: {
          ...response.result,
          events: [
            {
              ...baseEvent,
              kind: "assistant.delta",
              privateReasoning: "hidden chain of thought",
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      RuntimeRpcResponseSchema.safeParse({
        ...response,
        result: {
          ...response.result,
          events: Array.from({ length: 201 }, (_, index) => ({
            ...baseEvent,
            kind: "progress",
            message: "Working.",
            percent: null,
            sequence: index + 1,
          })),
        },
      }).success,
    ).toBe(false);
  });

  it("requires safe explicit loopback preview URLs", () => {
    const project = {
      binding: { documentRevision: 7, sourceRevision: revision },
      id: ids.preview,
      projectId: ids.project,
      revision: 1,
      status: "ready",
      updatedAt: now,
      worktreeId: ids.worktree,
      artifactIds: [],
    };
    for (const localUrl of [
      "not a url",
      "http://localhost/",
      "ws://localhost:4173/",
      "https://user:secret@localhost:4173/",
      "https://example.com:4173/",
    ]) {
      expect(
        RuntimeRpcResponseSchema.safeParse({
          correlationId: ids.correlation,
          method: "previews.get",
          ok: true,
          receivedAt: now,
          requestId: ids.request,
          result: { preview: { ...project, localUrl } },
          schemaVersion: 1,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unknown fields and unbounded inline context", () => {
    expect(
      RuntimeRpcRequestSchema.safeParse({
        ...request("projects.get", { projectId: ids.project }),
        authToken: "must-never-enter-the-envelope",
      }).success,
    ).toBe(false);

    const oversized = request("runs.start", {
      projectId: ids.project,
      prompt: "x".repeat(MAX_RUNTIME_RPC_BYTES),
      contextHash: hash,
      harnessId: "codex",
      modelId: "gpt-5.5",
      expected: {
        documentRevision: 7,
        sourceRevision: revision,
      },
    });
    expect(runtimeRpcByteLength(oversized)).toBeGreaterThan(
      MAX_RUNTIME_RPC_BYTES,
    );
    expect(RuntimeRpcRequestSchema.safeParse(oversized).success).toBe(false);
  });

  it("accepts correlated successes and the explicit error taxonomy", () => {
    expect(
      RuntimeRpcResponseSchema.parse({
        schemaVersion: 1,
        requestId: ids.request,
        correlationId: ids.correlation,
        method: "projects.get",
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
      }),
    ).toMatchObject({ ok: true, method: "projects.get" });

    expect(
      RuntimeRpcResponseSchema.parse({
        schemaVersion: 1,
        requestId: ids.request,
        correlationId: ids.correlation,
        method: "runs.cancel",
        receivedAt: now,
        ok: false,
        error: {
          code: "STALE_REVISION",
          details: [{ key: "runRevision", value: "4" }],
          message: "The run changed before cancellation.",
          retryable: false,
        },
      }),
    ).toMatchObject({
      error: { code: "STALE_REVISION" },
      ok: false,
    });
  });

  it("rejects method/result mismatches and unsafe promotion receipts", () => {
    expect(
      RuntimeRpcResponseSchema.safeParse({
        schemaVersion: 1,
        requestId: ids.request,
        correlationId: ids.correlation,
        method: "projects.list",
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
      }).success,
    ).toBe(false);

    expect(
      RuntimeRpcResponseSchema.safeParse({
        schemaVersion: 1,
        requestId: ids.request,
        correlationId: ids.correlation,
        method: "promotions.request",
        receivedAt: now,
        ok: true,
        result: {
          promotion: {
            completedAt: now,
            expectedDirtyFingerprint: hash,
            expectedOriginalRevision: revision,
            id: "prm_01J00000000000000000000000",
            projectId: ids.project,
            requestedAt: now,
            reviewId: "rvw_01J00000000000000000000000",
            status: "completed",
            worktreeId: "wrk_01J00000000000000000000000",
          },
        },
      }).success,
    ).toBe(false);
  });
});
