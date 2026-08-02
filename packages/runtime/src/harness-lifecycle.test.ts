import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DemoAlphaHarnessAdapter,
  DemoBetaHarnessAdapter,
} from "../../harnesses/src/index.js";
import { DurableRuntime } from "./index.js";
import {
  MutableClock,
  RecordingEffectExecutor,
} from "./test-fixtures.js";

const directories: string[] = [];

function pathForDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "memi-harness-lifecycle-"));
  directories.push(directory);
  return join(directory, "runtime.sqlite");
}

function runtime(
  databasePath: string,
  adapters = [
    new DemoAlphaHarnessAdapter(),
    new DemoBetaHarnessAdapter(),
  ],
) {
  return new DurableRuntime({
    databasePath,
    clock: new MutableClock().now,
    effectExecutor: new RecordingEffectExecutor(),
    lifecycleHarnesses: adapters,
  });
}

const task = {
  projectId: "project-harness",
  taskId: "task-harness",
  goal: "Document the imported product without applying changes.",
  permissionCeiling: ["canvas:read", "canvas:apply"],
  tokenBudget: 1_000,
  costBudgetUsdMicros: 25_000,
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("durable harness lifecycle", () => {
  it("owns and drains an exact locked adapter stream into a hash-linked log", async () => {
    const databasePath = pathForDatabase();
    const instance = runtime(databasePath);
    instance.createHarnessTask(task);

    const result = await instance.startHarnessRun({
      taskId: task.taskId,
      runId: "run-alpha",
      selection: {
        mode: "locked",
        harnessId: "demo-alpha",
        requiredCapabilities: ["text", "checkpoint"],
      },
    });

    expect(result).toMatchObject({
      runId: "run-alpha",
      taskId: task.taskId,
      harnessId: "demo-alpha",
      modelId: "demo-alpha-v1",
      dispatchEpoch: 1,
      state: "completed",
      remainingTokenBudget: 1_000,
      remainingCostBudgetUsdMicros: 25_000,
    });
    const events = instance.getHarnessRunEvents("run-alpha");
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(events[0]?.previousHash).toBeNull();
    expect(
      events.slice(1).every(
        (event, index) => event.previousHash === events[index]?.eventHash,
      ),
    ).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        signal: { kind: "usage.recorded", tokens: 0, costUsdMicros: 0 },
      }),
    );
    instance.close();
  });

  it("selects automatically deterministically and keeps attribution immutable", async () => {
    const databasePath = pathForDatabase();
    const instance = runtime(databasePath);
    instance.createHarnessTask(task);

    const run = await instance.startHarnessRun({
      taskId: task.taskId,
      runId: "run-auto",
      selection: {
        mode: "auto",
        requiredCapabilities: ["text", "checkpoint"],
      },
    });
    expect(run.harnessId).toBe("demo-alpha");
    instance.close();

    const database = new DatabaseSync(databasePath);
    expect(() =>
      database
        .prepare(
          "UPDATE harness_runs SET harness_id = 'demo-beta' WHERE run_id = ?",
        )
        .run("run-auto"),
    ).toThrow(/immutable/iu);
    expect(() =>
      database
        .prepare(
          "UPDATE harness_tasks SET goal = 'mutated' WHERE task_id = ?",
        )
        .run(task.taskId),
    ).toThrow(/immutable/iu);
    database.close();
  });

  it("persists a paused run across restart and never resumes it automatically", async () => {
    const databasePath = pathForDatabase();
    const adapter = new DemoAlphaHarnessAdapter({
      script: [
        { kind: "assistant.delta", text: "Started." },
        {
          kind: "approval.requested",
          approvalId: "approval-restart",
          scopes: ["canvas:apply"],
        },
      ],
    });
    const first = runtime(databasePath, [adapter]);
    first.createHarnessTask(task);
    const waiting = await first.startHarnessRun({
      taskId: task.taskId,
      runId: "run-restart",
      selection: {
        mode: "locked",
        harnessId: "demo-alpha",
        requiredCapabilities: ["text"],
      },
    });
    expect(waiting.state).toBe("awaiting-approval");
    expect(
      first.pauseHarnessRun({
        runId: "run-restart",
        dispatchEpoch: 1,
        reason: "restart-boundary",
      }).state,
    ).toBe("paused");
    first.close();

    const pausedAdapter = new DemoAlphaHarnessAdapter({
      script: [{ kind: "assistant.delta", text: "Must not auto-run." }],
    });
    const reopened = runtime(databasePath, [pausedAdapter]);
    expect(reopened.getHarnessRun("run-restart")?.state).toBe("paused");
    expect(pausedAdapter.streamInvocationCount).toBe(0);
    reopened.close();
  });

  it("makes pause and stop idempotent and rejects stale dispatch epochs", async () => {
    const databasePath = pathForDatabase();
    const instance = runtime(databasePath, [
      new DemoAlphaHarnessAdapter({
        script: [
          {
            kind: "approval.requested",
            approvalId: "approval-pause",
            scopes: ["canvas:apply"],
          },
          { kind: "run.completed" },
        ],
      }),
    ]);
    instance.createHarnessTask(task);
    const waiting = await instance.startHarnessRun({
      taskId: task.taskId,
      runId: "run-control",
      selection: {
        mode: "locked",
        harnessId: "demo-alpha",
        requiredCapabilities: ["approval"],
      },
    });
    expect(waiting.state).toBe("awaiting-approval");

    const paused = instance.pauseHarnessRun({
      runId: "run-control",
      dispatchEpoch: 1,
      reason: "human-review",
    });
    expect(
      instance.pauseHarnessRun({
        runId: "run-control",
        dispatchEpoch: 1,
        reason: "human-review",
      }),
    ).toEqual(paused);
    expect(() =>
      instance.stopHarnessRun({
        runId: "run-control",
        dispatchEpoch: 0,
        reason: "stale-session",
      }),
    ).toThrow(/stale dispatch epoch/iu);
    const stopped = instance.stopHarnessRun({
      runId: "run-control",
      dispatchEpoch: 1,
      reason: "human-stop",
    });
    expect(
      instance.stopHarnessRun({
        runId: "run-control",
        dispatchEpoch: 1,
        reason: "human-stop",
      }),
    ).toEqual(stopped);
    expect(() =>
      instance.resolveDemoHarnessApproval({
        runId: "run-control",
        dispatchEpoch: 1,
        approvalId: "approval-pause",
        decision: "approved",
        authority: {
          kind: "local-demo-human",
          actorId: "human-too-late",
        },
      }),
    ).toThrow(/not active/iu);
    expect(instance.getHarnessRun("run-control")?.state).toBe(
      "stopped",
    );
    instance.close();
  });

  it("does not allow resume or protected effects to bypass approval", async () => {
    const databasePath = pathForDatabase();
    const executor = new RecordingEffectExecutor();
    const instance = new DurableRuntime({
      databasePath,
      clock: new MutableClock().now,
      effectExecutor: executor,
      lifecycleHarnesses: [
        new DemoAlphaHarnessAdapter({
          script: [
            {
              kind: "approval.requested",
              approvalId: "approval-effect",
              scopes: ["canvas:apply"],
            },
            {
              kind: "effect.requested",
              effectKind: "canvas.operation",
              requiredPermission: "canvas:apply",
              payloadDigest:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            { kind: "run.completed" },
          ],
        }),
      ],
    });
    instance.createHarnessTask(task);
    const waiting = await instance.startHarnessRun({
      taskId: task.taskId,
      runId: "run-approval",
      selection: {
        mode: "locked",
        harnessId: "demo-alpha",
        requiredCapabilities: ["approval"],
      },
    });
    expect(waiting.state).toBe("awaiting-approval");
    await expect(
      instance.resumeHarnessRun({
        runId: "run-approval",
        dispatchEpoch: 1,
      }),
    ).rejects.toThrow(/approval/iu);

    instance.resolveDemoHarnessApproval({
      runId: "run-approval",
      dispatchEpoch: 1,
      approvalId: "approval-effect",
      decision: "approved",
      authority: {
        kind: "local-demo-human",
        actorId: "human-test",
      },
    });
    const afterEffect = await instance.resumeHarnessRun({
      runId: "run-approval",
      dispatchEpoch: 1,
    });
    expect(afterEffect.state).toBe("paused");
    expect(
      instance
        .getHarnessRunEvents("run-approval")
        .some((event) => event.signal.kind === "effect.requested"),
    ).toBe(true);
    expect(executor.calls).toHaveLength(0);
    await expect(
      instance.resumeHarnessRun({
        runId: "run-approval",
        dispatchEpoch: 2,
      }),
    ).rejects.toThrow(/pending effect/iu);
    expect(executor.calls).toHaveLength(0);
    instance.close();
  });

  it("normalizes adapter failure and never persists provider-private data", async () => {
    const databasePath = pathForDatabase();
    const instance = runtime(databasePath, [
      new DemoAlphaHarnessAdapter({
        failure: new Error(
          "providerSessionId=session-secret rawProviderEvent=private",
        ),
      }),
    ]);
    instance.createHarnessTask(task);

    const failed = await instance.startHarnessRun({
      taskId: task.taskId,
      runId: "run-failure",
      selection: {
        mode: "locked",
        harnessId: "demo-alpha",
        requiredCapabilities: ["text"],
      },
    });
    expect(failed.state).toBe("failed");
    expect(failed.failure).toEqual({
      code: "HARNESS_PROVIDER_FAILURE",
      message: "Harness execution failed.",
    });
    instance.close();

    const bytes = readFileSync(databasePath, "utf8");
    expect(bytes).not.toContain("session-secret");
    expect(bytes).not.toContain("rawProviderEvent");
  });

  it("builds cross-adapter child handoff state only from durable authority", async () => {
    const databasePath = pathForDatabase();
    const instance = runtime(databasePath, [
      new DemoAlphaHarnessAdapter({
        script: [
          {
            kind: "decision.accepted",
            decisionId: "decision-token",
            summary: "Use the existing token.",
          },
          { kind: "artifact.produced", artifactRef: "artifact-audit" },
          {
            kind: "usage.recorded",
            tokens: 0,
            costUsdMicros: 0,
          },
          { kind: "checkpoint.saved", checkpointId: "checkpoint-handoff" },
          { kind: "run.completed" },
        ],
      }),
      new DemoBetaHarnessAdapter(),
    ]);
    instance.createHarnessTask(task);
    await instance.startHarnessRun({
      taskId: task.taskId,
      runId: "run-parent",
      selection: {
        mode: "locked",
        harnessId: "demo-alpha",
        requiredCapabilities: ["checkpoint"],
      },
    });

    const handoff = instance.createHarnessHandoff({
      handoffId: "handoff-1",
      parentRunId: "run-parent",
      childRunId: "run-child",
      toHarnessId: "demo-beta",
    });
    expect(handoff).toMatchObject({
      parentRunId: "run-parent",
      childRunId: "run-child",
      fromHarnessId: "demo-alpha",
      toHarnessId: "demo-beta",
      checkpointId: "checkpoint-handoff",
      permissionCeiling: task.permissionCeiling,
      remainingTokenBudget: task.tokenBudget,
      remainingCostBudgetUsdMicros: task.costBudgetUsdMicros,
      artifactRefs: ["artifact-audit"],
      decisions: [
        {
          decisionId: "decision-token",
          summary: "Use the existing token.",
        },
      ],
    });
    expect(instance.getHarnessRun("run-child")).toMatchObject({
      harnessId: "demo-beta",
      parentRunId: "run-parent",
      remainingTokenBudget: task.tokenBudget,
      remainingCostBudgetUsdMicros: task.costBudgetUsdMicros,
    });
    expect(
      Object.keys(handoff).some((key) =>
        ["providerSessionId", "rawProviderEvent"].includes(key),
      ),
    ).toBe(false);
    instance.close();
  });

  it("rejects handoff from a stopped parent even when it has a checkpoint", async () => {
    const databasePath = pathForDatabase();
    const instance = runtime(databasePath, [
      new DemoAlphaHarnessAdapter({
        script: [
          { kind: "checkpoint.saved", checkpointId: "checkpoint-stopped" },
          {
            kind: "approval.requested",
            approvalId: "approval-stopped",
            scopes: ["canvas:apply"],
          },
        ],
      }),
      new DemoBetaHarnessAdapter(),
    ]);
    instance.createHarnessTask(task);
    await instance.startHarnessRun({
      taskId: task.taskId,
      runId: "run-stopped-parent",
      selection: {
        mode: "locked",
        harnessId: "demo-alpha",
        requiredCapabilities: ["checkpoint", "approval"],
      },
    });
    instance.stopHarnessRun({
      runId: "run-stopped-parent",
      dispatchEpoch: 1,
      reason: "human-stop",
    });

    expect(() =>
      instance.createHarnessHandoff({
        handoffId: "handoff-stopped",
        parentRunId: "run-stopped-parent",
        childRunId: "run-should-not-exist",
        toHarnessId: "demo-beta",
      }),
    ).toThrow(/must be completed/iu);
    expect(instance.getHarnessRun("run-should-not-exist")).toBeUndefined();
    instance.close();
  });

  it("detects lifecycle corruption before accepting work", async () => {
    const databasePath = pathForDatabase();
    const first = runtime(databasePath);
    first.createHarnessTask(task);
    await first.startHarnessRun({
      taskId: task.taskId,
      runId: "run-corrupt",
      selection: {
        mode: "locked",
        harnessId: "demo-alpha",
        requiredCapabilities: ["text"],
      },
    });
    first.close();

    const database = new DatabaseSync(databasePath);
    const triggerSql = String(
      (
        database
          .prepare(
            `SELECT sql FROM sqlite_schema
             WHERE type = 'trigger'
               AND name = 'harness_lifecycle_events_no_update'`,
          )
          .get() as { readonly sql: string }
      ).sql,
    );
    database.exec("DROP TRIGGER harness_lifecycle_events_no_update");
    database
      .prepare(
        "UPDATE harness_lifecycle_events SET event_json = ? WHERE run_id = ? AND sequence = 1",
      )
      .run('{"corrupt":true}', "run-corrupt");
    database.exec(triggerSql);
    database.close();

    expect(() => runtime(databasePath)).toThrow(/hash chain/iu);
  });

  it("rejects a v11 database whose harness authority trigger was removed", () => {
    const databasePath = pathForDatabase();
    const first = runtime(databasePath);
    first.close();
    const database = new DatabaseSync(databasePath);
    database.exec("DROP TRIGGER harness_runs_immutable_attribution");
    database.close();

    expect(() => runtime(databasePath)).toThrow(
      /harness authority schema/iu,
    );
  });

  it("requires authoritative trace lookup before adding a canonical trace ref", async () => {
    const databasePath = pathForDatabase();
    const instance = runtime(databasePath);
    instance.createHarnessTask(task);
    await instance.startHarnessRun({
      taskId: task.taskId,
      runId: "run-trace-ref",
      selection: {
        mode: "locked",
        harnessId: "demo-alpha",
        requiredCapabilities: ["text"],
      },
    });

    expect(() =>
      instance.attachHarnessCanonicalTraceRef({
        runId: "run-trace-ref",
        lifecycleSequence: 1,
        traceEventId: "missing-trace-event",
      }),
    ).toThrow(/authoritative canonical trace event/iu);
    instance.close();
  });

  it("serializes same-process duplicate stop races to one event", async () => {
    const databasePath = pathForDatabase();
    const instance = runtime(databasePath, [
      new DemoAlphaHarnessAdapter({
        script: [
          {
            kind: "approval.requested",
            approvalId: "approval-race",
            scopes: ["canvas:apply"],
          },
        ],
      }),
    ]);
    instance.createHarnessTask(task);
    await instance.startHarnessRun({
      taskId: task.taskId,
      runId: "run-race",
      selection: {
        mode: "locked",
        harnessId: "demo-alpha",
        requiredCapabilities: ["approval"],
      },
    });

    const results = await Promise.all([
      Promise.resolve().then(() =>
        instance.stopHarnessRun({
          runId: "run-race",
          dispatchEpoch: 1,
          reason: "human-stop",
        }),
      ),
      Promise.resolve().then(() =>
        instance.stopHarnessRun({
          runId: "run-race",
          dispatchEpoch: 1,
          reason: "human-stop",
        }),
      ),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(
      instance
        .getHarnessRunEvents("run-race")
        .filter((event) => event.signal.kind === "run.stopped"),
    ).toHaveLength(1);
    instance.close();
  });
});
