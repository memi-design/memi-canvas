import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  CanvasTraceEffectBindingHashMaterialSchema,
  CanvasOperationSchema,
  ProjectIdSchema,
  TargetApplyOutcomeSchema,
  TargetFenceActivationResultSchema,
  type TargetEffectRequest,
} from "../../protocol/src/index.js";
import { hashCanonicalValue } from "@memi/canonical-json";
import { receiptFor } from "./canvas-effect-test-fixtures.js";
import {
  retainTraceConcurrencyEvidence,
  retainedTraceConcurrencyEvidencePath,
} from "./canvas-trace-concurrency-evidence.js";
import {
  DurableRuntime,
  bindCommandAction,
  type CanvasTargetAdapter,
  type CommitClaim,
  type EffectExecutor,
} from "./index.js";
import {
  RUN_ID,
  TASK_ID,
  MutableClock,
  alternateLeaseId,
  alternateOutboxId,
  approvalFor,
  contentHash,
  durableCommand,
  grantFor,
  sortableId,
} from "./test-fixtures.js";

const executeFile = promisify(execFile);
const temporaryDirectories: string[] = [];
const BASE_TIME = "2026-07-28T12:00:00.000Z";
const TAKEOVER_TIME = "2026-07-28T12:00:02.000Z";
const WORKER_TIMEOUT_MS = 20_000;
const BARRIER_TIMEOUT_MS = 10_000;

interface WorkerConfiguration {
  readonly databasePath: string;
  readonly commandId: string;
  readonly suffix: string;
  readonly claim?: CommitClaim;
  readonly initialClock: string;
  readonly afterBarrierClock?: string;
  readonly verificationCheckedAt: string;
  readonly resultPath: string;
  readonly launchReadyPath?: string;
  readonly launchStartPath?: string;
  readonly claimReadyPath?: string;
  readonly claimStartPath?: string;
  readonly targetReadyPath?: string;
  readonly targetStartPath?: string;
  readonly expectedErrorCodes?: readonly string[];
}

interface WorkerResult {
  readonly status: "committed" | "error";
  readonly receipt?: {
    readonly commandId: string;
    readonly eventId: string;
  };
  readonly error?: {
    readonly name: string;
    readonly code?: string;
    readonly message: string;
  };
}

interface WorkerReady {
  readonly pid: number;
  readonly requestDigest: string;
  readonly verificationAttemptId: string;
  readonly targetReceiptHash: string;
  readonly evidenceHash: string;
}

interface WorkerClaimReady {
  readonly pid: number;
  readonly claim: CommitClaim;
}

class ForbiddenExecutor implements EffectExecutor {
  async execute(): Promise<never> {
    throw new Error("Generic executor must not run.");
  }
}

class ApplyTarget implements CanvasTargetAdapter {
  activateFence(request: Parameters<CanvasTargetAdapter["activateFence"]>[0]) {
    return TargetFenceActivationResultSchema.parse({
      ...request,
      status: "activated",
      highestFence: request.fencingEpoch,
    });
  }

  compareAndApply(request: TargetEffectRequest) {
    return TargetApplyOutcomeSchema.parse({
      schemaVersion: 1,
      status: "applied",
      receipt: receiptFor(request),
    });
  }

  lookup(): never {
    throw new Error("Setup target cannot look up.");
  }

  verify(): never {
    throw new Error("Setup target cannot verify.");
  }
}

function operation(suffix: string) {
  return CanvasOperationSchema.parse({
    schemaVersion: 1,
    id: sortableId("opn", suffix),
    documentId: sortableId("doc", suffix),
    actorId: "runtime-agent",
    occurredAt: BASE_TIME,
    actionDigest: contentHash("d"),
    expectedBeforeHash: contentHash("a"),
    resultingHash: contentHash("b"),
    type: "node.delete",
    payload: {
      nodeId: sortableId("nod", suffix),
      deletedNodeHash: contentHash("c"),
    },
  });
}

async function seed(
  path: string,
  commands: readonly {
    readonly suffix: string;
    readonly projectSuffix: string;
  }[],
) {
  const runtime = new DurableRuntime({
    databasePath: path,
    clock: new MutableClock(BASE_TIME).now,
    canvasTarget: new ApplyTarget(),
    effectExecutor: new ForbiddenExecutor(),
  });
  const ids: string[] = [];
  for (const input of commands) {
    const payload = operation(input.suffix);
    const projectId = ProjectIdSchema.parse(
      sortableId("prj", input.projectSuffix),
    );
    const command = bindCommandAction(
      durableCommand({
        id: sortableId("cmd", input.suffix),
        projectId,
        taskId: TASK_ID,
        runId: RUN_ID,
        idempotencyKey: sortableId("idem", input.suffix),
        target: {
          kind: "canvas-document",
          id: payload.documentId,
          expectedBeforeHash: payload.expectedBeforeHash,
          baseline: {
            kind: "canvas-revision",
            revision: 1,
            stateHash: payload.expectedBeforeHash,
          },
        },
        authority: {
          capabilityGrantId: sortableId("grt", input.suffix),
          approvalReceiptId: sortableId("apr", input.suffix),
          leaseId: alternateLeaseId(input.suffix),
          fencingEpoch: 1,
        },
      }),
      payload,
    );
    runtime.registerGrant(grantFor(command));
    runtime.registerApprovalReceipt(approvalFor(command));
    const lease = runtime.acquireLease({
      leaseId: command.authority.leaseId,
      projectId,
      targetId: command.target.id,
      holderId: command.issuerId,
      ttlMilliseconds: 60_000,
    });
    await runtime.activateCanvasLease({
      projectId,
      targetId: command.target.id,
      leaseId: lease.id,
      fencingEpoch: lease.fencingEpoch,
    });
    runtime.submitCommand({
      command,
      outboxId: alternateOutboxId(input.suffix),
      effectPayload: payload,
    });
    await runtime.applyNextEffect({
      workerId: `apply-${input.suffix}`,
      claimTtlMilliseconds: 5_000,
    });
    ids.push(command.id);
  }
  runtime.close();
  return ids;
}

function databasePath(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-trace-concurrency-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

function artifactPath(path: string, name: string): string {
  return join(path, "..", name);
}

async function waitForFiles(
  paths: readonly string[],
  timeoutMilliseconds = BARRIER_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (paths.some((path) => !existsSync(path))) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for process barriers: ${paths.join(", ")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function startWorker(configuration: WorkerConfiguration) {
  return executeFile(
    process.execPath,
    [
      join(process.cwd(), "node_modules/vitest/vitest.mjs"),
      "run",
      join(
        process.cwd(),
        "packages/runtime/src/canvas-trace-concurrency-worker.test.ts",
      ),
      "--maxWorkers=1",
    ],
    {
      cwd: process.cwd(),
      timeout: WORKER_TIMEOUT_MS,
      killSignal: "SIGKILL",
      env: {
        MEMI_CANVAS_TRACE_CONCURRENCY_WORKER:
          JSON.stringify(configuration),
      },
    },
  );
}

function readWorkerResult(path: string): WorkerResult {
  return JSON.parse(readFileSync(path, "utf8")) as WorkerResult;
}

function readWorkerReady(path: string): WorkerReady {
  return JSON.parse(readFileSync(path, "utf8")) as WorkerReady;
}

function readWorkerClaimReady(path: string): WorkerClaimReady {
  return JSON.parse(
    readFileSync(path, "utf8"),
  ) as WorkerClaimReady;
}

function createBarrier(path: string, value: string): void {
  writeFileSync(path, value, { encoding: "utf8", flag: "wx" });
}

function assertTranscript(path: string, entries: readonly unknown[]): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(entries), {
    encoding: "utf8",
    flag: "wx",
  });
  renameSync(temporaryPath, path);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(entries);
}

function claimAt(
  path: string,
  commandId: string,
  workerId: string,
  clock: string,
  ttlMilliseconds: number,
): CommitClaim {
  const runtime = new DurableRuntime({
    databasePath: path,
    clock: new MutableClock(clock).now,
    canvasTarget: new ApplyTarget(),
    effectExecutor: new ForbiddenExecutor(),
  });
  const claim = runtime.claimEffectCommit({
    commandId: commandId as CommitClaim["commandId"],
    workerId,
    claimTtlMilliseconds: ttlMilliseconds,
  });
  runtime.close();
  return claim;
}

function exactDatabaseSnapshot(path: string): string {
  const database = new DatabaseSync(path, { readOnly: true });
  database.exec("BEGIN");
  try {
    const schemaObjects = database
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_schema
         WHERE name NOT LIKE 'sqlite_%'
         ORDER BY type, name`,
      )
      .all();
    const schemas = schemaObjects.filter(
      (row) => row.type === "table",
    ) as unknown as readonly {
      readonly name: string;
      readonly sql: string;
    }[];
    const tables = schemas.map((schema) => {
      const columns = database
        .prepare(`PRAGMA table_info("${schema.name}")`)
        .all() as unknown as readonly {
        readonly name: string;
        readonly pk: number;
      }[];
      const projection = [
        `typeof(rowid) AS "$rowid$type"`,
        `hex(CAST(rowid AS BLOB)) AS "$rowid$hex"`,
        ...columns
        .flatMap((column) => [
          `typeof("${column.name}") AS "${column.name}$type"`,
          `hex(CAST("${column.name}" AS BLOB)) AS "${column.name}$hex"`,
        ]),
      ].join(", ");
      const primaryKey = columns
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => `"${column.name}"`);
      const order = primaryKey.length > 0 ? primaryKey : ["rowid"];
      return {
        name: schema.name,
        sql: schema.sql,
        rows: database
          .prepare(
            `SELECT ${projection} FROM "${schema.name}"
             ORDER BY ${order.join(", ")}`,
          )
          .all(),
      };
    });
    const snapshot = JSON.stringify({
      integrity: database.prepare("PRAGMA integrity_check").all(),
      foreignKeys: database.prepare("PRAGMA foreign_key_check").all(),
      userVersion: database.prepare("PRAGMA user_version").get(),
      applicationId: database.prepare("PRAGMA application_id").get(),
      schemaVersion: database.prepare("PRAGMA schema_version").get(),
      schemaObjects,
      tables,
    });
    database.exec("COMMIT");
    database.close();
    return snapshot;
  } catch (error) {
    database.exec("ROLLBACK");
    database.close();
    throw error;
  }
}

function assertHealthySnapshot(snapshot: string): void {
  const parsedSnapshot = JSON.parse(snapshot) as {
    readonly integrity: unknown[];
    readonly foreignKeys: unknown[];
  };
  expect(parsedSnapshot.integrity).toEqual([{ integrity_check: "ok" }]);
  expect(parsedSnapshot.foreignKeys).toEqual([]);
}

function authorityCounts(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  const count = (table: string) =>
    Number(
      (
        database
          .prepare(`SELECT count(*) AS count FROM "${table}"`)
          .get() as { readonly count: number }
      ).count,
    );
  const attemptStates = database
    .prepare(
      `SELECT state FROM target_verification_attempts
       ORDER BY state`,
    )
    .all()
    .map((row) => String(row.state));
  const result = {
    events: count("trace_events"),
    heads: count("trace_heads"),
    bindings: count("trace_effect_bindings"),
    receipts: count("effect_receipts"),
    projections: count("trace_projection_outbox"),
    committedCommands: Number(
      (
        database
          .prepare(
            "SELECT count(*) AS count FROM commands WHERE state = 'committed'",
          )
          .get() as { readonly count: number }
      ).count,
    ),
    committedOutboxes: Number(
      (
        database
          .prepare(
            "SELECT count(*) AS count FROM outbox WHERE phase = 'committed'",
          )
          .get() as { readonly count: number }
      ).count,
    ),
    latches: count("target_schedule_latches"),
    attemptStates,
  };
  database.close();
  return result;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ADR 0011 deterministic OS-process concurrency gates", () => {
  it("trace-concurrency-004 rejects an expired worker after process takeover", async () => {
    const retainedPath = retainedTraceConcurrencyEvidencePath(
      "trace-concurrency-004",
    );
    rmSync(retainedPath, { force: true });
    const path = databasePath();
    const [commandId] = await seed(path, [
      { suffix: "M", projectSuffix: "6" },
    ]);
    const exactCommandId = commandId!;
    const oldClaim = claimAt(
      path,
      exactCommandId,
      "old-process",
      BASE_TIME,
      1_000,
    );
    const oldReady = artifactPath(path, "old-target.ready");
    const releaseOld = artifactPath(path, "old-target.start");
    const oldResult = artifactPath(path, "old-result.json");
    const oldWorker = startWorker({
      databasePath: path,
      commandId: exactCommandId,
      suffix: "M",
      claim: oldClaim,
      initialClock: BASE_TIME,
      afterBarrierClock: TAKEOVER_TIME,
      verificationCheckedAt: TAKEOVER_TIME,
      resultPath: oldResult,
      targetReadyPath: oldReady,
      targetStartPath: releaseOld,
      expectedErrorCodes: ["STALE_WORKER_CLAIM"],
    });
    await waitForFiles([oldReady]);

    const takeoverReady = artifactPath(path, "takeover-claim.ready");
    const releaseTakeover = artifactPath(path, "takeover-claim.start");
    const winnerResult = artifactPath(path, "takeover-result.json");
    const takeoverWorker = startWorker({
      databasePath: path,
      commandId: exactCommandId,
      suffix: "N",
      initialClock: TAKEOVER_TIME,
      verificationCheckedAt: TAKEOVER_TIME,
      resultPath: winnerResult,
      claimReadyPath: takeoverReady,
      claimStartPath: releaseTakeover,
    });
    await waitForFiles([takeoverReady]);
    const takeover = readWorkerClaimReady(takeoverReady);
    expect(readWorkerReady(oldReady).pid).not.toBe(takeover.pid);
    expect(takeover.claim).toMatchObject({
      commandId: exactCommandId,
      workerId: "process-N",
      fencingEpoch: oldClaim.fencingEpoch + 1,
      expiresAt: "2026-07-28T12:00:32.000Z",
    });
    expect(oldClaim.expiresAt).toBe("2026-07-28T12:00:01.000Z");
    const beforeOldResume = exactDatabaseSnapshot(path);
    assertHealthySnapshot(beforeOldResume);
    expect(authorityCounts(path)).toMatchObject({
      events: 0,
      heads: 0,
      bindings: 0,
      receipts: 0,
      projections: 0,
      attemptStates: ["issued"],
    });
    createBarrier(releaseOld, "resume");
    await oldWorker;
    const afterOldResume = exactDatabaseSnapshot(path);
    assertHealthySnapshot(afterOldResume);

    expect(readWorkerResult(oldResult)).toMatchObject({
      status: "error",
      error: { code: "STALE_WORKER_CLAIM" },
    });
    expect(afterOldResume).toBe(beforeOldResume);
    createBarrier(releaseTakeover, "commit");
    await takeoverWorker;
    expect(readWorkerResult(winnerResult)).toMatchObject({
      status: "committed",
      receipt: { commandId: exactCommandId },
    });
    expect(authorityCounts(path)).toEqual({
      events: 1,
      heads: 1,
      bindings: 1,
      receipts: 1,
      projections: 1,
      committedCommands: 1,
      committedOutboxes: 1,
      latches: 0,
      attemptStates: ["accepted", "rejected"],
    });
    const database = new DatabaseSync(path, { readOnly: true });
    expect(
      database
        .prepare(
          `SELECT outbox.worker_id, outbox.claim_epoch,
                  outbox.claim_expires_at, commands.state,
                  trace_events.id AS event_id,
                  trace_effect_bindings.verification_attempt_id
           FROM outbox
           JOIN commands ON commands.id = outbox.command_id
           JOIN trace_events ON trace_events.command_id = commands.id
           JOIN trace_effect_bindings
             ON trace_effect_bindings.command_id = commands.id`,
        )
        .get(),
    ).toEqual({
      worker_id: null,
      claim_epoch: takeover.claim.fencingEpoch,
      claim_expires_at: null,
      state: "committed",
      event_id: sortableId("evt", "N"),
      verification_attempt_id: sortableId("rcv", "N"),
    });
    expect(
      database
        .prepare(
          `SELECT id, state, claim_worker_id, claim_epoch
           FROM target_verification_attempts ORDER BY state`,
        )
        .all(),
    ).toEqual([
      {
        id: sortableId("rcv", "N"),
        state: "accepted",
        claim_worker_id: "process-N",
        claim_epoch: takeover.claim.fencingEpoch,
      },
      {
        id: sortableId("rcv", "M"),
        state: "rejected",
        claim_worker_id: oldClaim.workerId,
        claim_epoch: oldClaim.fencingEpoch,
      },
    ]);
    database.close();
    assertTranscript(artifactPath(path, "takeover.transcript"), [
      { phase: "old-target-ready", pid: readWorkerReady(oldReady).pid, claim: oldClaim },
      { phase: "takeover-claimed", pid: takeover.pid, claim: takeover.claim },
      { phase: "old-rejected", code: "STALE_WORKER_CLAIM" },
      { phase: "takeover-committed", eventId: sortableId("evt", "N") },
    ]);
    assertHealthySnapshot(exactDatabaseSnapshot(path));
    retainTraceConcurrencyEvidence({
      caseId: "trace-concurrency-004",
      databasePath: path,
      workers: [
        { role: "old-worker", pid: readWorkerReady(oldReady).pid,
          claimEpoch: oldClaim.fencingEpoch },
        { role: "takeover-worker", pid: takeover.pid,
          claimEpoch: takeover.claim.fencingEpoch },
      ],
      phases: ["old-target-ready", "takeover-claimed",
        "old-rejected", "takeover-committed"],
      results: [
        { role: "old-worker", status: "error",
          errorCode: "STALE_WORKER_CLAIM" },
        { role: "takeover-worker", status: "committed",
          eventId: sortableId("evt", "N") },
      ],
      comparison: {
        beforeHash: hashCanonicalValue(JSON.parse(beforeOldResume)),
        afterHash: hashCanonicalValue(JSON.parse(afterOldResume)),
        unchanged: beforeOldResume === afterOldResume,
      },
    });
    expect(existsSync(retainedPath)).toBe(true);
  }, 30_000);

  it("trace-concurrency-005 conflicts changed valid verification without rewriting winner bytes", async () => {
    const retainedPath = retainedTraceConcurrencyEvidencePath(
      "trace-concurrency-005",
    );
    rmSync(retainedPath, { force: true });
    const path = databasePath();
    const [commandId] = await seed(path, [
      { suffix: "P", projectSuffix: "7" },
    ]);
    const exactCommandId = commandId!;
    const sharedClaim = claimAt(
      path,
      exactCommandId,
      "shared-process",
      BASE_TIME,
      30_000,
    );
    const winnerReady = artifactPath(path, "binding-winner.ready");
    const releaseWinner = artifactPath(path, "binding-winner.start");
    const winnerResult = artifactPath(path, "binding-winner.json");
    const winnerWorker = startWorker({
      databasePath: path,
      commandId: exactCommandId,
      suffix: "P",
      claim: sharedClaim,
      initialClock: BASE_TIME,
      afterBarrierClock: "2026-07-28T12:00:00.002Z",
      verificationCheckedAt: "2026-07-28T12:00:00.001Z",
      resultPath: winnerResult,
      targetReadyPath: winnerReady,
      targetStartPath: releaseWinner,
    });

    const changedReady = artifactPath(path, "changed-target.ready");
    const releaseChanged = artifactPath(path, "changed-target.start");
    const changedResult = artifactPath(path, "changed-result.json");
    const changedWorker = startWorker({
      databasePath: path,
      commandId: exactCommandId,
      suffix: "Q",
      claim: sharedClaim,
      initialClock: BASE_TIME,
      afterBarrierClock: "2026-07-28T12:00:00.002Z",
      verificationCheckedAt: "2026-07-28T12:00:00.002Z",
      resultPath: changedResult,
      targetReadyPath: changedReady,
      targetStartPath: releaseChanged,
      expectedErrorCodes: ["COMMIT_TRACE_CONFLICT"],
    });
    await waitForFiles([winnerReady, changedReady]);
    const winnerPrepared = readWorkerReady(winnerReady);
    const changedPrepared = readWorkerReady(changedReady);
    expect(winnerPrepared.pid).not.toBe(changedPrepared.pid);
    expect({
      requestDigest: changedPrepared.requestDigest,
      verificationAttemptId: changedPrepared.verificationAttemptId,
      targetReceiptHash: changedPrepared.targetReceiptHash,
    }).toEqual({
      requestDigest: winnerPrepared.requestDigest,
      verificationAttemptId: winnerPrepared.verificationAttemptId,
      targetReceiptHash: winnerPrepared.targetReceiptHash,
    });
    expect(changedPrepared.evidenceHash).not.toBe(
      winnerPrepared.evidenceHash,
    );

    createBarrier(releaseWinner, "commit");
    await winnerWorker;
    const database = new DatabaseSync(path, { readOnly: true });
    const bindingRow = database
      .prepare(
        `SELECT trace_events.event_json,
                trace_effect_bindings.binding_digest
         FROM trace_events
         JOIN trace_effect_bindings
           ON trace_effect_bindings.event_id = trace_events.id`,
      )
      .get() as {
      readonly event_json: string;
      readonly binding_digest: string;
    };
    database.close();
    const event = JSON.parse(bindingRow.event_json) as {
      readonly schemaVersion: 1;
      readonly projectId: string;
      readonly commandId: string;
      readonly outboxId: string;
      readonly id: string;
      readonly eventHash: string;
      readonly target: { readonly kind: string; readonly id: string };
      readonly resultingHash: string;
    };
    const digestFor = (prepared: WorkerReady) =>
      hashCanonicalValue(
        CanvasTraceEffectBindingHashMaterialSchema.parse({
          schemaVersion: 1,
          projectId: event.projectId,
          commandId: event.commandId,
          outboxId: event.outboxId,
          eventId: event.id,
          eventHash: event.eventHash,
          target: event.target,
          targetReceiptHash: prepared.targetReceiptHash,
          verificationAttemptId: prepared.verificationAttemptId,
          verificationRequestDigest: prepared.requestDigest,
          verificationEvidenceHash: prepared.evidenceHash,
          resultingHash: event.resultingHash,
        }),
      );
    const winnerDigest = digestFor(winnerPrepared);
    const changedDigest = digestFor(changedPrepared);
    expect(changedDigest).not.toBe(winnerDigest);
    expect(bindingRow.binding_digest).toBe(winnerDigest);
    const beforeLoserResume = exactDatabaseSnapshot(path);
    assertHealthySnapshot(beforeLoserResume);
    createBarrier(releaseChanged, "resume");
    await changedWorker;
    const afterLoserResume = exactDatabaseSnapshot(path);
    assertHealthySnapshot(afterLoserResume);

    expect(readWorkerResult(winnerResult)).toMatchObject({
      status: "committed",
      receipt: { commandId: exactCommandId },
    });
    expect(readWorkerResult(changedResult)).toMatchObject({
      status: "error",
      error: { code: "COMMIT_TRACE_CONFLICT" },
    });
    expect(afterLoserResume).toBe(beforeLoserResume);
    expect(authorityCounts(path)).toEqual({
      events: 1, heads: 1, bindings: 1, receipts: 1,
      projections: 1, committedCommands: 1, committedOutboxes: 1,
      latches: 0, attemptStates: ["accepted"],
    });
    assertTranscript(artifactPath(path, "binding-conflict.transcript"), [
      { phase: "both-target-ready", pids: [winnerPrepared.pid, changedPrepared.pid] },
      { phase: "winner-committed", bindingDigest: winnerDigest },
      { phase: "loser-conflict", bindingDigest: changedDigest },
    ]);
    retainTraceConcurrencyEvidence({
      caseId: "trace-concurrency-005",
      databasePath: path,
      workers: [
        { role: "winner", pid: winnerPrepared.pid },
        { role: "changed-loser", pid: changedPrepared.pid },
      ],
      phases: ["both-target-ready", "winner-committed",
        "loser-conflict"],
      results: [
        { role: "winner", status: "committed", eventId: event.id },
        { role: "changed-loser", status: "error",
          errorCode: "COMMIT_TRACE_CONFLICT" },
      ],
      comparison: {
        beforeHash: hashCanonicalValue(JSON.parse(beforeLoserResume)),
        afterHash: hashCanonicalValue(JSON.parse(afterLoserResume)),
        unchanged: beforeLoserResume === afterLoserResume,
      },
      bindingDigests: { committed: winnerDigest,
        rejected: changedDigest },
    });
    expect(existsSync(retainedPath)).toBe(true);
  }, 30_000);
});
