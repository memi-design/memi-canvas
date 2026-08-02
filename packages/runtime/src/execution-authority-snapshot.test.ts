import { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@memi/canonical-json";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectIdSchema } from "../../protocol/src/index.js";
import {
  MutableClock,
  PROJECT_ID,
  contentHash,
  sortableId,
} from "./test-fixtures.js";
import {
  activateLease,
  authorizeAndQueue,
  canvasCommandDraft,
  cleanupAuthorityFixtures,
  databasePath,
  reviewedContext,
  runtime,
} from "./trusted-command-authority-test-support.js";

afterEach(cleanupAuthorityFixtures);

function persistedExecutionSnapshot(path: string): string {
  const database = new DatabaseSync(path);
  const tables = (
    database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as unknown as readonly { readonly name: string }[]
  ).map((row) => row.name);
  const snapshot = tables.map((table) => ({
    table,
    rows: database
      .prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
      .all(),
  }));
  database.close();
  return canonicalJson(snapshot);
}

async function commit(
  instance: ReturnType<typeof runtime>,
  authorized: Awaited<ReturnType<typeof authorizeAndQueue>>,
) {
  const claim = await instance.claimCommandEffect({
    commandId: authorized.command.id,
    workerId: `apply:${authorized.command.id}`,
    claimTtlMilliseconds: 5_000,
  });
  await instance.applyClaimedEffect(claim);
  const commitClaim = instance.claimEffectCommit({
    commandId: authorized.command.id,
    workerId: `commit:${authorized.command.id}`,
    claimTtlMilliseconds: 5_000,
  });
  return instance.verifyAndCommit({ claim: commitClaim });
}

describe("execution authority evidence snapshot", () => {
  it("derives batch-bound exact rows and scoped observed work from persistence", async () => {
    const path = databasePath("memi-execution-evidence-");
    const clock = new MutableClock();
    const instance = runtime(path, clock);
    const runId = sortableId("run", "E");
    const expected = canvasCommandDraft("E", runId, "E");
    await activateLease(instance, expected.command);
    const expectedContext = reviewedContext(
      expected.command,
      expected.payload,
    );
    const expectedAuthorized = await authorizeAndQueue(
      instance,
      expected,
      expectedContext,
    );
    await commit(instance, expectedAuthorized);

    const outsideBatch = canvasCommandDraft("M", runId, "M");
    await activateLease(instance, outsideBatch.command);
    const outsideAuthorized = await authorizeAndQueue(
      instance,
      outsideBatch,
      reviewedContext(outsideBatch.command, outsideBatch.payload, {
        workspaceDigest:
          contentHash("x") as `sha256:${string}`,
        planDigest:
          contentHash("y") as `sha256:${string}`,
      }),
    );

    const foreignRun = canvasCommandDraft(
      "N",
      sortableId("run", "N"),
      "N",
    );
    await activateLease(instance, foreignRun.command);
    await authorizeAndQueue(instance, foreignRun);

    const foreignProject = canvasCommandDraft(
      "P",
      sortableId("run", "P"),
      "P",
      ProjectIdSchema.parse(
        "prj_0000000000000000000000000P",
      ),
    );
    await activateLease(instance, foreignProject.command);
    await authorizeAndQueue(instance, foreignProject);

    expect(
      instance.getExecutionAuthoritySnapshot({
        schemaVersion: 1,
        projectId: PROJECT_ID,
        runId,
        batchRootDigest: expectedContext.batchRootDigest,
      }),
    ).toEqual({
      schemaVersion: 1,
      kind: "execution-authority-snapshot",
      scope: {
        projectId: PROJECT_ID,
        runId,
        batchRootDigest: expectedContext.batchRootDigest,
      },
      signedReviewedContext: {
        workspaceDigest: expectedContext.workspaceDigest,
        planDigest: expectedContext.planDigest,
        batchRootDigest: expectedContext.batchRootDigest,
      },
      counts: {
        commands: 1,
        outboxes: 1,
        grants: 1,
        approvals: 1,
        grantUses: 1,
        approvalUses: 1,
        targetReceipts: 1,
        acceptedVerificationAttempts: 1,
        traceBindings: 1,
        traceEvents: 1,
        projectionIntents: 1,
        canonicalReceipts: 1,
        latches: 0,
      },
      rows: {
        commands: [
          expect.objectContaining({
            id: expectedAuthorized.command.id,
            kind: "canvas.operation",
            state: "committed",
          }),
        ],
        outboxes: [
          expect.objectContaining({
            commandId: expectedAuthorized.command.id,
            phase: "committed",
          }),
        ],
        grants: [
          expect.objectContaining({
            id: expectedAuthorized.reservation.grantId,
          }),
        ],
        approvals: [
          expect.objectContaining({
            id: expectedAuthorized.reservation.approvalId,
          }),
        ],
        grantUses: [
          expect.objectContaining({
            commandId: expectedAuthorized.command.id,
            useNumber: 1,
          }),
        ],
        approvalUses: [
          expect.objectContaining({
            commandId: expectedAuthorized.command.id,
            useNumber: 1,
          }),
        ],
        targetReceipts: [
          expect.objectContaining({
            commandId: expectedAuthorized.command.id,
          }),
        ],
        acceptedVerificationAttempts: [
          expect.objectContaining({
            commandId: expectedAuthorized.command.id,
          }),
        ],
        traceBindings: [
          expect.objectContaining({
            commandId: expectedAuthorized.command.id,
          }),
        ],
        traceEvents: [
          expect.objectContaining({
            operationId: expected.payload.id,
          }),
        ],
        projectionIntents: [
          expect.objectContaining({
            operationId: expected.payload.id,
          }),
        ],
        canonicalReceipts: [
          expect.objectContaining({
            commandId: expectedAuthorized.command.id,
          }),
        ],
        latches: [],
      },
      observedRuntimeWork: {
        allObservedCommandsBelongToBatch: false,
        commandKinds: ["canvas.operation"],
        targetKinds: ["canvas-document"],
        observedCommandIds: [
          expectedAuthorized.command.id,
          outsideAuthorized.command.id,
        ],
        outsideBatchCommandIds: [outsideAuthorized.command.id],
        observedBatchRootDigests: [
          expectedContext.batchRootDigest,
          outsideAuthorized.issued.reviewedContext.batchRootDigest,
        ],
      },
    });
    instance.close();
  });

  it("rejects malformed, empty, duplicate-lineage, foreign-run, and foreign-project scope", async () => {
    const path = databasePath("memi-execution-scope-");
    const clock = new MutableClock();
    const instance = runtime(path, clock);
    const draft = canvasCommandDraft("Q");
    await activateLease(instance, draft.command);
    const authorized = await authorizeAndQueue(instance, draft);
    await commit(instance, authorized);
    const request = {
      schemaVersion: 1 as const,
      projectId: draft.command.projectId,
      runId: draft.command.runId,
      batchRootDigest:
        authorized.issued.reviewedContext.batchRootDigest,
    };

    expect(
      instance.getExecutionAuthoritySnapshot(request),
    ).toMatchObject({
      observedRuntimeWork: {
        allObservedCommandsBelongToBatch: true,
        outsideBatchCommandIds: [],
      },
    });
    for (const invalid of [
      { ...request, batchRootDigest: contentHash("0") },
      { ...request, runId: sortableId("run", "R") },
      {
        ...request,
        projectId: ProjectIdSchema.parse(
          "prj_0000000000000000000000000R",
        ),
      },
      { ...request, batchRootDigest: "" },
      { ...request, commandIds: [draft.command.id] },
    ]) {
      expect(() =>
        instance.getExecutionAuthoritySnapshot(invalid as never),
      ).toThrow(/batch|foreign|lineage|project|run|scope|unknown/i);
    }
    instance.close();
  });

  it("rejects an actually persisted contradictory lineage for one scoped batch without mutation", async () => {
    const path = databasePath("memi-execution-lineage-conflict-");
    const clock = new MutableClock();
    const instance = runtime(path, clock);
    const runId = sortableId("run", "S");
    const first = canvasCommandDraft("S", runId, "S");
    const contradictory = canvasCommandDraft("T", runId, "T");
    await activateLease(instance, first.command);
    await activateLease(instance, contradictory.command);
    const firstContext = reviewedContext(first.command, first.payload);
    await authorizeAndQueue(instance, first, firstContext);
    await authorizeAndQueue(instance, contradictory, {
      workspaceDigest: contentHash("x"),
      planDigest: contentHash("y"),
      batchRootDigest: firstContext.batchRootDigest,
    });
    const before = persistedExecutionSnapshot(path);

    expect(() =>
      instance.getExecutionAuthoritySnapshot({
        schemaVersion: 1,
        projectId: first.command.projectId,
        runId,
        batchRootDigest: firstContext.batchRootDigest,
      }),
    ).toThrow(/contradict|duplicate|lineage|plan|workspace/i);
    expect(persistedExecutionSnapshot(path)).toBe(before);
    instance.close();
  });
});
