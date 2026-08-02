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
  DurableRuntime,
  bindCommandAction,
  type CanvasTargetAdapter,
  type CommitClaim,
  type EffectExecutor,
} from "./index.js";
import {
  MutableClock,
  RUN_ID,
  TASK_ID,
  alternateLeaseId,
  alternateOutboxId,
  approvalFor,
  contentHash,
  durableCommand,
  grantFor,
  sortableId,
} from "./test-fixtures.js";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

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
    occurredAt: "2026-07-28T12:00:00.000Z",
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
    clock: new MutableClock().now,
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

function worker(
  path: string,
  commandId: string,
  suffix: string,
  claim?: CommitClaim,
  resultPath?: string,
  readyPath?: string,
  startPath?: string,
) {
  return execFileAsync(
    process.execPath,
    [
      join(process.cwd(), "node_modules/vitest/vitest.mjs"),
      "run",
      join(
        process.cwd(),
        "packages/runtime/src/canvas-trace-process-worker.test.ts",
      ),
      "--maxWorkers=1",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMI_CANVAS_TRACE_PROCESS_WORKER: JSON.stringify({
          databasePath: path,
          commandId,
          suffix,
          claim,
          resultPath,
          readyPath,
          startPath,
        }),
      },
    },
  );
}

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "memi-process-race-"));
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("canonical trace OS process sequencing", () => {
  it("writes one authority and exact replay for a same-command race", async () => {
    const path = databasePath();
    const [commandId] = await seed(path, [
      { suffix: "P", projectSuffix: "1" },
    ]);
    const exactCommandId = commandId!;
    const claimant = new DurableRuntime({
      databasePath: path,
      clock: new MutableClock().now,
      canvasTarget: new ApplyTarget(),
      effectExecutor: new ForbiddenExecutor(),
    });
    const claim = claimant.claimEffectCommit({
      commandId: exactCommandId as CommitClaim["commandId"],
      workerId: "shared-process-claim",
      claimTtlMilliseconds: 30_000,
    });
    claimant.close();
    const resultA = join(path, "..", "same-a.json");
    const resultB = join(path, "..", "same-b.json");
    const readyA = join(path, "..", "ready-a");
    const readyB = join(path, "..", "ready-b");
    const start = join(path, "..", "start");

    const workers = [
      worker(path, exactCommandId, "A", claim, resultA, readyA, start),
      worker(path, exactCommandId, "B", claim, resultB, readyB, start),
    ];
    while (!existsSync(readyA) || !existsSync(readyB)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    writeFileSync(start, "go", "utf8");
    await Promise.all(workers);
    expect(readFileSync(resultA, "utf8")).toBe(
      readFileSync(resultB, "utf8"),
    );
    const database = new DatabaseSync(path);
    for (const table of [
      "trace_events",
      "trace_effect_bindings",
      "effect_receipts",
    ]) {
      expect(
        database
          .prepare(
            `SELECT count(*) AS count FROM ${table}
             WHERE command_id = ?`,
          )
          .get(exactCommandId),
      ).toEqual({ count: 1 });
    }
    expect(
      database
        .prepare(
          `SELECT count(*) AS count FROM trace_projection_outbox`,
        )
        .get(),
    ).toEqual({ count: 1 });
    database.close();
  });

  it("serializes same-project writers into one exact hash chain", async () => {
    const path = databasePath();
    const commands = await seed(path, [
      { suffix: "C", projectSuffix: "1" },
      { suffix: "D", projectSuffix: "1" },
    ]);
    await Promise.all([
      worker(path, commands[0]!, "C"),
      worker(path, commands[1]!, "D"),
    ]);
    const database = new DatabaseSync(path);
    const rows = database
      .prepare(
        `SELECT sequence, previous_event_hash, event_hash
         FROM trace_events ORDER BY sequence`,
      )
      .all() as {
      readonly sequence: number;
      readonly previous_event_hash: string | null;
      readonly event_hash: string;
    }[];
    expect(rows.map((row) => row.sequence)).toEqual([1, 2]);
    expect(rows[0]!.previous_event_hash).toBeNull();
    expect(rows[1]!.previous_event_hash).toBe(rows[0]!.event_hash);
    database.close();
  });

  it("keeps independent projects at independent sequence one", async () => {
    const path = databasePath();
    const commands = await seed(path, [
      { suffix: "E", projectSuffix: "1" },
      { suffix: "F", projectSuffix: "2" },
    ]);
    await Promise.all([
      worker(path, commands[0]!, "E"),
      worker(path, commands[1]!, "F"),
    ]);
    const database = new DatabaseSync(path);
    expect(
      database
        .prepare(
          `SELECT project_id, sequence FROM trace_events
           ORDER BY project_id`,
        )
        .all(),
    ).toEqual([
      { project_id: sortableId("prj", "1"), sequence: 1 },
      { project_id: sortableId("prj", "2"), sequence: 1 },
    ]);
    database.close();
  });
});
