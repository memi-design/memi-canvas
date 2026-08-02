import { describe, expect, it, vi } from "vitest";

import type {
  RuntimePrivateTransport,
  RuntimeRpcRequest,
} from "@memi/protocol";
import {
  CorrelationIdSchema,
  ImportJobIdSchema,
  ImportPlanTokenSchema,
  ProcessRequestIdSchema,
  ProjectIdSchema,
} from "@memi/protocol";

import {
  RuntimeClientError,
  createRuntimeClientV1,
} from "./runtime-client.js";

const now = "2026-07-29T12:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}`;
const ids = {
  correlation: CorrelationIdSchema.parse(
    "cor_01J00000000000000000000000",
  ),
  job: ImportJobIdSchema.parse("imp_01J00000000000000000000000"),
  project: ProjectIdSchema.parse("prj_01J00000000000000000000000"),
  request: ProcessRequestIdSchema.parse(
    "prq_01J00000000000000000000000",
  ),
} as const;
const planToken = ImportPlanTokenSchema.parse(
  "ipl_01J00000000000000000000000",
);
const EMPTY_INVENTORY = {
  fileCount: 0,
  screenCount: 0,
  componentCount: 0,
  tokenCount: 0,
  screens: [],
  components: [],
  tokens: [],
  truncated: { screens: false, components: false, tokens: false },
} as const;

function job(
  method: RuntimeRpcRequest["method"],
  revision = 5,
) {
  const committed = method === "imports.commit";
  const discarded = method === "imports.discard";
  return {
    applications: [],
    artifacts: [],
    cancellationRequestedAt:
      method === "imports.cancel" || discarded ? now : null,
    checkpoints: [],
    createdAt: now,
    currentApplicationId: null,
    currentScenarioId: null,
    failures: [],
    id: ids.job,
    kind: "memi-import-job" as const,
    logs: [],
    managedWorktreeId: null,
    progress: { captured: 0, failed: 0, remaining: 0, total: 0 },
    projectId: committed ? ids.project : null,
    projectName: "Imported product",
    repository: {
      dirtyFingerprint: hash,
      rootPath: "/tmp/product",
      sourceRevision: "b".repeat(40),
    },
    revision,
    scenarios: [],
    selectedHarness: null,
    stage: committed ? ("save" as const) : ("validate" as const),
    state: committed
      ? ("committed" as const)
      : method === "imports.cancel"
        ? ("paused" as const)
        : discarded
          ? ("cancelled" as const)
        : method === "imports.start"
          ? ("queued" as const)
          : ("running" as const),
    updatedAt: now,
  };
}

function listItem(method: RuntimeRpcRequest["method"], revision = 5) {
  const fullJob = job(method, revision);
  return {
    id: fullJob.id,
    projectId: fullJob.projectId,
    projectName: fullJob.projectName,
    state: fullJob.state,
    stage: fullJob.stage,
    sourceRevision: fullJob.repository.sourceRevision,
    progress: fullJob.progress,
    currentApplicationId: fullJob.currentApplicationId,
    currentScenarioId: fullJob.currentScenarioId,
    failureCount: fullJob.failures.length,
    revision: fullJob.revision,
    updatedAt: fullJob.updatedAt,
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

function response(request: RuntimeRpcRequest, revision = 5) {
  return {
    correlationId: request.correlationId,
    method: request.method,
    ok: true,
    receivedAt: now,
    requestId: request.requestId,
    result:
      request.method === "imports.plan"
        ? {
            plan: {
              token: planToken,
              repository: job(request.method).repository,
              applications: [],
              scenarios: [],
              recipes: [],
              inventory: EMPTY_INVENTORY,
              scenarioCount: 0,
              errors: [],
            },
          }
        : request.method === "imports.list"
          ? { jobs: [listItem(request.method)] }
        : { job: job(request.method, revision) },
    schemaVersion: 1,
  };
}

describe("RuntimeClientV1 import surface", () => {
  it("exposes every import lifecycle operation over the private transport", async () => {
    const exchange = vi.fn(
      async (input: Parameters<RuntimePrivateTransport["exchange"]>[0]) =>
        response(input.envelope),
    );
    const runtime = client({ exchange });
    const expectedRevision = 4;

    await runtime.imports.plan({
      repositoryPath: "/tmp/product",
    });
    await runtime.imports.list();
    await runtime.imports.start({
      approvedRecipeHashes: [hash],
      planToken,
      projectName: "Imported product",
      repositoryPath: "/tmp/product",
      selectedHarness: null,
    });
    await runtime.imports.get({ jobId: ids.job });
    await runtime.imports.cancel({ expectedRevision, jobId: ids.job });
    await runtime.imports.discard({ expectedRevision, jobId: ids.job });
    await runtime.imports.resume({ expectedRevision, jobId: ids.job });
    await runtime.imports.retryFailed({
      expectedRevision,
      jobId: ids.job,
    });
    const committed = await runtime.imports.commit({
      expectedRevision,
      jobId: ids.job,
    });

    expect(exchange.mock.calls.map(([call]) => call.envelope.method)).toEqual(
      [
        "imports.plan",
        "imports.list",
        "imports.start",
        "imports.get",
        "imports.cancel",
        "imports.discard",
        "imports.resume",
        "imports.retryFailed",
        "imports.commit",
      ],
    );
    expect(committed.job.projectId).toBe(ids.project);
    expect(Object.isFrozen(committed)).toBe(true);
    expect(Object.isFrozen(committed.job.repository)).toBe(true);
  });

  it("rejects an import mutation response that violates its job revision fence", async () => {
    const runtime = client({
      exchange: async ({ envelope }) => response(envelope, 4),
    });

    await expect(
      runtime.imports.cancel({
        expectedRevision: 4,
        jobId: ids.job,
      }),
    ).rejects.toMatchObject({
      code: "PROTOCOL_VIOLATION",
    } satisfies Partial<RuntimeClientError>);
  });

  it("accepts the inspected canonical root returned for an alias plan path", async () => {
    const runtime = client({
      exchange: async ({ envelope }) => ({
        ...response(envelope),
        result: {
          plan: {
            ...(response(envelope).result as {
              readonly plan: Record<string, unknown>;
            }).plan,
            repository: {
              dirtyFingerprint: hash,
              rootPath: "/canonical/product",
              sourceRevision: "a".repeat(40),
            },
          },
        },
      }),
    });

    await expect(
      runtime.imports.plan({
        repositoryPath: "/alias/product",
      }),
    ).resolves.toMatchObject({
      plan: {
        repository: { rootPath: "/canonical/product" },
      },
    });
  });

  it("rejects get and commit responses that do not prove their outcome", async () => {
    const wrongJob = "imp_01J00000000000000000000001";
    const getRuntime = client({
      exchange: async ({ envelope }) => ({
        ...response(envelope),
        result: {
          job: { ...job(envelope.method), id: wrongJob },
        },
      }),
    });
    await expect(
      getRuntime.imports.get({ jobId: ids.job }),
    ).rejects.toMatchObject({
      code: "PROTOCOL_VIOLATION",
    } satisfies Partial<RuntimeClientError>);

    const commitRuntime = client({
      exchange: async ({ envelope }) => ({
        ...response(envelope),
        result: {
          job: {
            ...job("imports.get"),
            revision: 5,
          },
        },
      }),
    });
    await expect(
      commitRuntime.imports.commit({
        expectedRevision: 4,
        jobId: ids.job,
      }),
    ).rejects.toMatchObject({
      code: "PROTOCOL_VIOLATION",
    } satisfies Partial<RuntimeClientError>);
  });
});
