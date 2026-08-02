import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  CanvasOperationSchema,
  ProjectIdSchema,
  TargetApplyOutcomeSchema,
  TargetFenceActivationResultSchema,
  type TargetEffectRequest,
} from "../../protocol/src/index.js";
import { receiptFor } from "./canvas-effect-test-fixtures.js";
import {
  retainTraceConcurrencyEvidence,
  retainedTraceConcurrencyEvidencePath,
} from "./canvas-trace-concurrency-evidence.js";
import {
  DurableRuntime,
  bindCommandAction,
  type CanvasTargetAdapter,
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
const directories: string[] = [];
const BASE_TIME = "2026-07-28T12:00:00.000Z";

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
  inputs: readonly {
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
  for (const input of inputs) {
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

function newDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "memi-project-race-"));
  directories.push(directory);
  return join(directory, "runtime.sqlite");
}

async function waitFor(paths: readonly string[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (paths.some((path) => !existsSync(path))) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${paths.join(", ")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function startWorker(configuration: object) {
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
      timeout: 20_000,
      killSignal: "SIGKILL",
      env: {
        MEMI_CANVAS_TRACE_CONCURRENCY_WORKER:
          JSON.stringify(configuration),
      },
    },
  );
}

function terminalCounts(database: DatabaseSync) {
  const count = (table: string) =>
    (
      database
        .prepare(`SELECT count(*) AS count FROM "${table}"`)
        .get() as { readonly count: number }
    ).count;
  return {
    events: count("trace_events"),
    heads: count("trace_heads"),
    bindings: count("trace_effect_bindings"),
    receipts: count("effect_receipts"),
    projections: count("trace_projection_outbox"),
    committedCommands: (
      database
        .prepare(
          "SELECT count(*) AS count FROM commands WHERE state = 'committed'",
        )
        .get() as { readonly count: number }
    ).count,
    latches: count("target_schedule_latches"),
  };
}

async function race(
  path: string,
  commands: readonly string[],
  suffixes: readonly string[],
  label: string,
) {
  const release = join(path, "..", `${label}.release`);
  const ready = suffixes.map((suffix) =>
    join(path, "..", `${label}-${suffix}.ready`),
  );
  const results = suffixes.map((suffix) =>
    join(path, "..", `${label}-${suffix}.result.json`),
  );
  const workers = commands.map((commandId, index) =>
    startWorker({
      databasePath: path,
      commandId,
      suffix: suffixes[index],
      initialClock: BASE_TIME,
      verificationCheckedAt: BASE_TIME,
      resultPath: results[index],
      targetReadyPath: ready[index],
      targetStartPath: release,
    }),
  );
  await waitFor(ready);
  const processIds = ready.map(
    (file) =>
      (JSON.parse(readFileSync(file, "utf8")) as { readonly pid: number })
        .pid,
  );
  expect(new Set(processIds).size).toBe(2);
  writeFileSync(release, "commit", { encoding: "utf8", flag: "wx" });
  await Promise.all(workers);
  const transcript = [
    { phase: "both-target-ready", processIds },
    { phase: "released" },
    { phase: "both-committed" },
  ];
  const transcriptPath = join(path, "..", `${label}.transcript.json`);
  writeFileSync(transcriptPath, JSON.stringify(transcript), {
    encoding: "utf8",
    flag: "wx",
  });
  expect(JSON.parse(readFileSync(transcriptPath, "utf8"))).toEqual(
    transcript,
  );
  return {
    processIds,
    results: results.map((file, index) => {
      const result = JSON.parse(readFileSync(file, "utf8")) as {
        readonly status: "committed";
        readonly receipt: { readonly eventId: string };
      };
      return {
        role: suffixes[index]!,
        status: result.status,
        eventId: result.receipt.eventId,
      } as const;
    }),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ADR 0011 project trace races", () => {
  it("trace-concurrency-002 overlaps same-project target verification before commit", async () => {
    const retainedPath = retainedTraceConcurrencyEvidencePath(
      "trace-concurrency-002",
    );
    rmSync(retainedPath, { force: true });
    const path = newDatabasePath();
    const commands = await seed(path, [
      { suffix: "G", projectSuffix: "3" },
      { suffix: "H", projectSuffix: "3" },
    ]);
    const schedule = await race(
      path,
      commands,
      ["G", "H"],
      "same-project",
    );
    const database = new DatabaseSync(path, { readOnly: true });
    const rows = database
      .prepare(
        `SELECT id, sequence, previous_event_hash, event_hash
         FROM trace_events ORDER BY sequence`,
      )
      .all() as {
      readonly id: string;
      readonly sequence: number;
      readonly previous_event_hash: string | null;
      readonly event_hash: string;
    }[];
    expect(rows.map((row) => row.sequence)).toEqual([1, 2]);
    expect(rows[0]!.previous_event_hash).toBeNull();
    expect(rows[1]!.previous_event_hash).toBe(rows[0]!.event_hash);
    expect(
      database
        .prepare(
          `SELECT last_sequence, last_event_id, last_event_hash
           FROM trace_heads`,
        )
        .get(),
    ).toEqual({
      last_sequence: 2,
      last_event_id: rows[1]!.id,
      last_event_hash: rows[1]!.event_hash,
    });
    expect(terminalCounts(database)).toEqual({
      events: 2, heads: 1, bindings: 2, receipts: 2,
      projections: 2, committedCommands: 2, latches: 0,
    });
    expect(database.prepare("PRAGMA integrity_check").all()).toEqual([
      { integrity_check: "ok" },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    database.close();
    retainTraceConcurrencyEvidence({
      caseId: "trace-concurrency-002",
      databasePath: path,
      workers: schedule.processIds.map((pid, index) => ({
        role: ["G", "H"][index]!,
        pid,
      })),
      phases: [
        "both-target-ready",
        "released",
        "both-committed",
      ],
      results: schedule.results,
    });
    expect(existsSync(retainedPath)).toBe(true);
  }, 30_000);

  it("trace-concurrency-003 overlaps independent project commits", async () => {
    const retainedPath = retainedTraceConcurrencyEvidencePath(
      "trace-concurrency-003",
    );
    rmSync(retainedPath, { force: true });
    const path = newDatabasePath();
    const commands = await seed(path, [
      { suffix: "J", projectSuffix: "4" },
      { suffix: "K", projectSuffix: "5" },
    ]);
    const schedule = await race(
      path,
      commands,
      ["J", "K"],
      "different-project",
    );
    const database = new DatabaseSync(path, { readOnly: true });
    expect(
      database
        .prepare(
          `SELECT trace_heads.project_id, trace_heads.last_sequence,
                  trace_events.sequence, trace_events.previous_event_hash
           FROM trace_heads JOIN trace_events
             ON trace_events.id = trace_heads.last_event_id
           ORDER BY trace_heads.project_id`,
        )
        .all(),
    ).toEqual([
      {
        project_id: sortableId("prj", "4"),
        last_sequence: 1,
        sequence: 1,
        previous_event_hash: null,
      },
      {
        project_id: sortableId("prj", "5"),
        last_sequence: 1,
        sequence: 1,
        previous_event_hash: null,
      },
    ]);
    expect(terminalCounts(database)).toEqual({
      events: 2, heads: 2, bindings: 2, receipts: 2,
      projections: 2, committedCommands: 2, latches: 0,
    });
    expect(database.prepare("PRAGMA integrity_check").all()).toEqual([
      { integrity_check: "ok" },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    database.close();
    retainTraceConcurrencyEvidence({
      caseId: "trace-concurrency-003",
      databasePath: path,
      workers: schedule.processIds.map((pid, index) => ({
        role: ["J", "K"][index]!,
        pid,
      })),
      phases: [
        "both-target-ready",
        "released",
        "both-committed",
      ],
      results: schedule.results,
    });
    expect(existsSync(retainedPath)).toBe(true);
  }, 30_000);
});
