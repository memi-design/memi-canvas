import { describe, expect, it, vi } from "vitest";

import {
  CanvasDocumentSnapshotV3Schema,
} from "@memi/protocol";
import { createCanvasDocumentV3 } from "@memi/canvas-document";

import { createSidecarRpcHandler } from "./rpc.js";
import { CanvasDocumentJournalRpcProtocolError } from "./canvas-document-journal-service.js";

const token =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function request(method: string, payload: unknown) {
  return {
    schemaVersion: 1,
    requestId: "prq_01J00000000000000000000000",
    correlationId: "cor_01J00000000000000000000000",
    sentAt: "2026-07-30T12:00:00.000Z",
    method,
    payload,
  };
}

function canvasSnapshot() {
  const document = createCanvasDocumentV3({
    id: "doc_01J00000000000000000000000",
    projectId: "prj_01J00000000000000000000000",
    initialPage: {
      id: "pag_01J00000000000000000000000",
      kind: "design",
      name: "Page 1",
    },
  });
  return CanvasDocumentSnapshotV3Schema.parse({
    schemaVersion: 1,
    kind: "canvas-document-v3-snapshot",
    identity: {
      schemaVersion: 1,
      projectId: document.projectId,
      documentId: document.id,
    },
    document,
    persistedAt: "2026-08-01T12:00:00.000Z",
  });
}

describe("packaged runtime sidecar RPC", () => {
  it("authenticates CanvasDocumentV3 opens before dispatching the durable journal", async () => {
    const snapshot = canvasSnapshot();
    const canvasDocuments = {
      open: vi.fn(async () => ({
        initialized: true,
        journal: {
          schemaVersion: 1,
          kind: "canvas-document-v3-journal" as const,
          identity: snapshot.identity,
          snapshot,
          operations: [],
          operationBytes: 0,
        },
      })),
    };
    const handle = createSidecarRpcHandler({
      authToken: token,
      imports: {} as never,
      canvasDocuments: canvasDocuments as never,
      now: () => "2026-08-01T12:00:01.000Z",
    });
    const envelope = request("canvasDocuments.open", { snapshot });

    await expect(
      handle({ authorization: "Bearer wrong", envelope }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(canvasDocuments.open).not.toHaveBeenCalled();

    await expect(
      handle({ authorization: `Bearer ${token}`, envelope }),
    ).resolves.toMatchObject({
      ok: true,
      method: "canvasDocuments.open",
      result: {
        initialized: true,
        journal: { identity: snapshot.identity },
      },
    });
    expect(canvasDocuments.open).toHaveBeenCalledWith({ snapshot });
  });

  it("does not expose a forged CanvasDocumentV3 receipt over the authenticated boundary", async () => {
    const snapshot = canvasSnapshot();
    const handle = createSidecarRpcHandler({
      authToken: token,
      imports: {} as never,
      canvasDocuments: {
        async open() {
          throw new CanvasDocumentJournalRpcProtocolError(
            "CanvasDocumentV3 append receipt violates its operation or identity fence.",
          );
        },
      } as never,
      now: () => "2026-08-01T12:00:01.000Z",
    });

    await expect(
      handle({
        authorization: `Bearer ${token}`,
        envelope: request("canvasDocuments.open", { snapshot }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      method: "canvasDocuments.open",
      error: {
        code: "PROTOCOL_VIOLATION",
        message: "The canvas journal returned an invalid durable response.",
      },
    });
  });

  it("authenticates separately and dispatches strict import requests", async () => {
    const service = {
      plan: vi.fn(async () => ({
        plan: {
          token: "ipl_01J00000000000000000000000",
          repository: {
            rootPath: "/tmp/product",
            sourceRevision: "a".repeat(40),
            dirtyFingerprint: null,
          },
          applications: [],
          scenarios: [],
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
      })),
    };
    const handle = createSidecarRpcHandler({
      authToken: token,
      imports: service as never,
      now: () => "2026-07-30T12:00:01.000Z",
    });
    const envelope = request("imports.plan", {
      repositoryPath: "/tmp/product",
    });

    await expect(
      handle({
        authorization: `Bearer ${token}`,
        envelope,
      }),
    ).resolves.toMatchObject({
      ok: true,
      method: "imports.plan",
      requestId: envelope.requestId,
      correlationId: envelope.correlationId,
      result: { plan: { repository: { rootPath: "/tmp/product" } } },
    });
    expect(service.plan).toHaveBeenCalledWith({
      repositoryPath: "/tmp/product",
    });
  });

  it("lists durable import jobs only after authenticating the private request", async () => {
    const service = {
      list: vi.fn(async () => ({ jobs: [] })),
    };
    const handle = createSidecarRpcHandler({
      authToken: token,
      imports: service as never,
      now: () => "2026-07-30T12:00:01.000Z",
    });
    const envelope = request("imports.list", {});

    await expect(
      handle({ authorization: "Bearer wrong", envelope }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(service.list).not.toHaveBeenCalled();

    await expect(
      handle({ authorization: `Bearer ${token}`, envelope }),
    ).resolves.toMatchObject({
      ok: true,
      method: "imports.list",
      result: { jobs: [] },
    });
    expect(service.list).toHaveBeenCalledOnce();
  });

  it("fails closed before dispatch for a bad token or malformed envelope", async () => {
    const service = { get: vi.fn() };
    const handle = createSidecarRpcHandler({
      authToken: token,
      imports: service as never,
      now: () => "2026-07-30T12:00:01.000Z",
    });
    const envelope = request("imports.get", {
      jobId: "imp_01J00000000000000000000000",
    });

    await expect(
      handle({ authorization: "Bearer wrong", envelope }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    await expect(
      handle({
        authorization: `Bearer ${token}`,
        envelope: { ...envelope, unexpected: true },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    await expect(
      handle({
        authorization: `Bearer ${token}`,
        envelope,
        unexpected: true,
      } as never),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    expect(service.get).not.toHaveBeenCalled();
  });

  it("returns a bounded unavailable response for non-import methods", async () => {
    const handle = createSidecarRpcHandler({
      authToken: token,
      imports: {} as never,
      now: () => "2026-07-30T12:00:01.000Z",
    });
    await expect(
      handle({
        authorization: `Bearer ${token}`,
        envelope: request("projects.list", {}),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAVAILABLE", retryable: false },
    });
  });

  it("dispatches the authenticated truthful-import purge contract", async () => {
    const service = {
      purgeAll: vi.fn(async () => ({
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
      })),
    };
    const handle = createSidecarRpcHandler({
      authToken: token,
      imports: service as never,
      now: () => "2026-07-30T12:00:01.000Z",
    });

    await expect(
      handle({
        authorization: `Bearer ${token}`,
        envelope: request("imports.purgeAll", {}),
      }),
    ).resolves.toMatchObject({
      ok: true,
      method: "imports.purgeAll",
      result: {
        complete: true,
        counts: {
          artifacts: 2,
          jobs: 1,
          managedWorktrees: 1,
        },
        failures: [],
      },
    });
    expect(service.purgeAll).toHaveBeenCalledWith({});
  });

  it("maps import binding and in-progress purge failures to conflicts", async () => {
    const failures = [
      new Error(
        "Import plan token is unknown, expired, consumed, or bound to another repository.",
      ),
      new Error("Import purge is in progress."),
    ];
    const service = {
      purgeAll: vi.fn(async () => {
        throw failures.shift();
      }),
    };
    const handle = createSidecarRpcHandler({
      authToken: token,
      imports: service as never,
      now: () => "2026-07-30T12:00:01.000Z",
    });

    for (const requestId of [
      "prq_01J00000000000000000000001",
      "prq_01J00000000000000000000002",
    ]) {
      await expect(
        handle({
          authorization: `Bearer ${token}`,
          envelope: {
            ...request("imports.purgeAll", {}),
            requestId,
          },
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "CONFLICT", retryable: false },
      });
    }
  });

  it("returns a safe planning-stage diagnostic instead of a generic internal failure", async () => {
    const service = {
      plan: vi.fn(async () => {
        throw Object.assign(
          new Error("The managed capture snapshot could not be prepared."),
          {
            name: "ImportPlanningError",
            publicCode: "IMPORT_PLANNING_FAILED",
            publicMessage: "Memi could not validate this repository for runtime capture.",
            remediation: "Reveal the local import log, correct the reported setup issue, then retry.",
            stage: "validate",
          },
        );
      }),
    };
    const handle = createSidecarRpcHandler({
      authToken: token,
      imports: service as never,
      now: () => "2026-07-30T12:00:01.000Z",
    });

    await expect(
      handle({
        authorization: `Bearer ${token}`,
        envelope: request("imports.plan", { repositoryPath: "/tmp/product" }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "POLICY_DENIED",
        message: "Memi could not validate this repository for runtime capture.",
        retryable: true,
        details: [
          { key: "code", value: "IMPORT_PLANNING_FAILED" },
          { key: "stage", value: "validate" },
          {
            key: "remediation",
            value:
              "Reveal the local import log, correct the reported setup issue, then retry.",
          },
        ],
      },
    });
  });
});
