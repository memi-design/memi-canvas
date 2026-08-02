import {
  HarnessSignalSchema,
  type HarnessSignal,
} from "../../protocol/src/index.js";
import {
  DurableHarnessRegistry,
  normalizeHarnessFailure,
  type DurableHarnessAdapter,
} from "../../harnesses/src/index.js";
import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";

import { RuntimeDatabase } from "./database.js";
import { auditHarnessLifecycle } from "./harness-lifecycle-audit.js";
import {
  assertHarnessBudget,
  assertHarnessIdentifier,
  harnessRowString,
  storedHarnessRunFromRow,
  storedHarnessTaskFromRow,
  type StoredHarnessRun,
  type StoredHarnessTask,
} from "./harness-lifecycle-values.js";
import type {
  DemoHarnessApprovalResolutionInput,
  HarnessHandoff,
  HarnessHandoffInput,
  HarnessLifecycleEvent,
  HarnessRunControlInput,
  HarnessRunResumeInput,
  HarnessRunSnapshot,
  HarnessRunStartInput,
  HarnessTaskInput,
  HarnessTraceReferenceInput,
} from "./types.js";

export class HarnessLifecycleStore {
  readonly #database: RuntimeDatabase;
  readonly #clock: () => string;
  readonly #registry: DurableHarnessRegistry;

  constructor(
    database: RuntimeDatabase,
    clock: () => string,
    adapters: readonly DurableHarnessAdapter[],
  ) {
    this.#database = database;
    this.#clock = clock;
    this.#registry = new DurableHarnessRegistry(adapters);
    auditHarnessLifecycle(this.#database);
  }

  createTask(input: HarnessTaskInput): StoredHarnessTask {
    assertHarnessIdentifier(input.projectId, "Project id");
    assertHarnessIdentifier(input.taskId, "Task id");
    if (input.goal.trim().length < 1 || input.goal.length > 8_192) {
      throw new Error("Harness task goal is invalid.");
    }
    assertHarnessBudget(input.tokenBudget, "Token budget");
    assertHarnessBudget(input.costBudgetUsdMicros, "Cost budget");
    const permissions = [...new Set(input.permissionCeiling)];
    if (
      permissions.length !== input.permissionCeiling.length ||
      permissions.some(
        (permission) =>
          permission.trim().length < 1 || permission.length > 160,
      )
    ) {
      throw new Error("Harness task permission ceiling is invalid.");
    }
    const task = {
      projectId: input.projectId,
      taskId: input.taskId,
      goal: input.goal,
      permissionCeiling: permissions,
      tokenBudget: input.tokenBudget,
      costBudgetUsdMicros: input.costBudgetUsdMicros,
    };
    const taskJson = canonicalJson(task);
    const taskHash = hashCanonicalValue(task);
    const existing = this.#database.one(
      "SELECT task_hash FROM harness_tasks WHERE task_id = ?",
      input.taskId,
    );
    if (existing !== undefined) {
      if (harnessRowString(existing, "task_hash") !== taskHash) {
        throw new Error(
          `Harness task "${input.taskId}" is immutable and already differs.`,
        );
      }
      return { ...task, taskHash };
    }
    this.#database.transaction(() => {
      this.#database.run(
        `INSERT INTO harness_tasks (
           task_id, project_id, goal, permission_ceiling_json,
           token_budget, cost_budget_usd_micros, task_json, task_hash,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.taskId,
        input.projectId,
        input.goal,
        canonicalJson(permissions),
        input.tokenBudget,
        input.costBudgetUsdMicros,
        taskJson,
        taskHash,
        this.#clock(),
      );
    });
    return { ...task, taskHash };
  }

  async start(input: HarnessRunStartInput): Promise<HarnessRunSnapshot> {
    assertHarnessIdentifier(input.runId, "Run id");
    const task = this.#requireTask(input.taskId);
    const selected = this.#registry.select(input.selection).adapter;
    const now = this.#clock();
    this.#database.transaction(() => {
      this.#database.run(
        `INSERT INTO harness_runs (
           run_id, task_id, parent_run_id, harness_id, model_id, state,
           dispatch_epoch, adapter_cursor, remaining_token_budget,
           remaining_cost_budget_usd_micros, checkpoint_id,
           last_event_sequence, last_event_hash, failure_json,
           created_at, updated_at
         ) VALUES (?, ?, NULL, ?, ?, 'running', 1, 0, ?, ?, NULL, 0,
                   NULL, NULL, ?, ?)`,
        input.runId,
        input.taskId,
        selected.descriptor.harnessId,
        selected.descriptor.modelId,
        task.tokenBudget,
        task.costBudgetUsdMicros,
        now,
        now,
      );
    });
    return this.#drain(input.runId, 1, selected);
  }

  async resume(
    input: HarnessRunResumeInput,
  ): Promise<HarnessRunSnapshot> {
    const run = this.#requireRun(input.runId);
    this.#assertEpoch(run, input.dispatchEpoch);
    if (run.state === "awaiting-approval") {
      throw new Error(
        `Run "${input.runId}" cannot resume while approval is unresolved.`,
      );
    }
    if (run.state !== "paused" && run.state !== "queued") {
      throw new Error(
        `Run "${input.runId}" cannot resume from state "${run.state}".`,
      );
    }
    if (this.#hasUnresolvedApproval(input.runId)) {
      throw new Error(
        `Run "${input.runId}" cannot bypass its unresolved approval.`,
      );
    }
    if (this.#hasPendingEffect(input.runId)) {
      throw new Error(
        `Run "${input.runId}" cannot resume past a pending effect request.`,
      );
    }
    const adapter = this.#registry.get(run.harnessId);
    if (adapter === undefined) {
      throw new Error(
        `The attributed harness "${run.harnessId}" is unavailable.`,
      );
    }
    const nextEpoch = run.dispatchEpoch + 1;
    this.#database.transaction(() => {
      const changed = this.#database.run(
        `UPDATE harness_runs
         SET state = 'running', dispatch_epoch = ?, updated_at = ?
         WHERE run_id = ? AND dispatch_epoch = ?
           AND state IN ('paused', 'queued')`,
        nextEpoch,
        this.#clock(),
        input.runId,
        input.dispatchEpoch,
      );
      if (changed !== 1) {
        throw new Error(
          `Run "${input.runId}" lost its dispatch epoch before resume.`,
        );
      }
    });
    return this.#drain(input.runId, nextEpoch, adapter);
  }

  pause(input: HarnessRunControlInput): HarnessRunSnapshot {
    return this.#control(input, "paused");
  }

  stop(input: HarnessRunControlInput): HarnessRunSnapshot {
    return this.#control(input, "stopped");
  }

  resolveApproval(
    input: DemoHarnessApprovalResolutionInput,
  ): HarnessRunSnapshot {
    const run = this.#requireRun(input.runId);
    this.#assertEpoch(run, input.dispatchEpoch);
    assertHarnessIdentifier(
      input.authority.actorId,
      "Demo human actor id",
    );
    if (
      run.state !== "awaiting-approval" ||
      !["demo-alpha", "demo-beta"].includes(run.harnessId)
    ) {
      throw new Error(
        `Approval "${input.approvalId}" is not active for this demo run.`,
      );
    }
    const requested = this.#latestApprovalRequest(input.runId);
    if (
      requested === undefined ||
      requested.approvalId !== input.approvalId ||
      !this.#hasUnresolvedApproval(input.runId)
    ) {
      throw new Error(
        `Approval "${input.approvalId}" is not pending for run "${input.runId}".`,
      );
    }
    this.#database.transaction(() => {
      const changed = this.#database.run(
        `UPDATE harness_runs
         SET state = ?, updated_at = ?
         WHERE run_id = ? AND dispatch_epoch = ?
           AND state = 'awaiting-approval'`,
        input.decision === "approved" ? "paused" : "stopped",
        this.#clock(),
        input.runId,
        input.dispatchEpoch,
      );
      if (changed !== 1) {
        throw new Error(
          `Approval "${input.approvalId}" lost its active demo boundary.`,
        );
      }
      this.#append(
        input.runId,
        input.dispatchEpoch,
        {
          kind: "approval.resolved",
          approvalId: input.approvalId,
          decision: input.decision,
          actorId: input.authority.actorId,
        },
        false,
      );
    });
    return this.#requireRun(input.runId);
  }

  getRun(runId: string): HarnessRunSnapshot | undefined {
    const row = this.#database.one(
      "SELECT * FROM harness_runs WHERE run_id = ?",
      runId,
    );
    return row === undefined
      ? undefined
      : storedHarnessRunFromRow(row);
  }

  getEvents(runId: string): readonly HarnessLifecycleEvent[] {
    return this.#database
      .all(
        `SELECT event_json FROM harness_lifecycle_events
         WHERE run_id = ? ORDER BY sequence`,
        runId,
      )
      .map(
        (row) =>
          JSON.parse(
            harnessRowString(row, "event_json"),
          ) as HarnessLifecycleEvent,
      );
  }

  createHandoff(input: HarnessHandoffInput): HarnessHandoff {
    assertHarnessIdentifier(input.handoffId, "Handoff id");
    assertHarnessIdentifier(input.childRunId, "Child run id");
    const parent = this.#requireRun(input.parentRunId);
    if (
      parent.state !== "completed" ||
      this.#hasUnresolvedApproval(input.parentRunId) ||
      this.#hasPendingEffect(input.parentRunId)
    ) {
      throw new Error(
        `Run "${input.parentRunId}" must be completed without pending approval before handoff.`,
      );
    }
    if (parent.checkpointId === undefined) {
      throw new Error(
        `Run "${input.parentRunId}" has no durable checkpoint for handoff.`,
      );
    }
    const checkpointId = parent.checkpointId;
    const target = this.#registry.get(input.toHarnessId);
    if (target === undefined) {
      throw new Error(
        `The handoff harness "${input.toHarnessId}" is unavailable.`,
      );
    }
    const task = this.#requireTask(parent.taskId);
    const signals = this.getEvents(input.parentRunId).map(
      (event) => event.signal,
    );
    const packet: HarnessHandoff = {
      handoffId: input.handoffId,
      taskId: parent.taskId,
      parentRunId: input.parentRunId,
      childRunId: input.childRunId,
      fromHarnessId: parent.harnessId,
      toHarnessId: target.descriptor.harnessId,
      checkpointId,
      permissionCeiling: [...task.permissionCeiling],
      remainingTokenBudget: parent.remainingTokenBudget,
      remainingCostBudgetUsdMicros:
        parent.remainingCostBudgetUsdMicros,
      artifactRefs: signals
        .filter(
          (
            signal,
          ): signal is Extract<
            HarnessSignal,
            { kind: "artifact.produced" }
          > => signal.kind === "artifact.produced",
        )
        .map((signal) => signal.artifactRef),
      decisions: signals
        .filter(
          (
            signal,
          ): signal is Extract<
            HarnessSignal,
            { kind: "decision.accepted" }
          > => signal.kind === "decision.accepted",
        )
        .map(({ decisionId, summary }) => ({ decisionId, summary })),
    };
    const now = this.#clock();
    this.#database.transaction(() => {
      const currentParent = this.#requireRun(input.parentRunId);
      if (
        currentParent.state !== "completed" ||
        currentParent.dispatchEpoch !== parent.dispatchEpoch ||
        currentParent.lastEventHash !== parent.lastEventHash ||
        currentParent.remainingTokenBudget !==
          parent.remainingTokenBudget ||
        currentParent.remainingCostBudgetUsdMicros !==
          parent.remainingCostBudgetUsdMicros ||
        currentParent.checkpointId !== checkpointId
      ) {
        throw new Error(
          `Run "${input.parentRunId}" changed before durable handoff.`,
        );
      }
      this.#database.run(
        `INSERT INTO harness_runs (
           run_id, task_id, parent_run_id, harness_id, model_id, state,
           dispatch_epoch, adapter_cursor, remaining_token_budget,
           remaining_cost_budget_usd_micros, checkpoint_id,
           last_event_sequence, last_event_hash, failure_json,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'queued', 1, 0, ?, ?, ?, 0, NULL,
                   NULL, ?, ?)`,
        input.childRunId,
        parent.taskId,
        input.parentRunId,
        target.descriptor.harnessId,
        target.descriptor.modelId,
        parent.remainingTokenBudget,
        parent.remainingCostBudgetUsdMicros,
        checkpointId,
        now,
        now,
      );
      this.#database.run(
        `INSERT INTO harness_handoffs (
           handoff_id, parent_run_id, child_run_id, packet_json, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
        input.handoffId,
        input.parentRunId,
        input.childRunId,
        canonicalJson(packet),
        now,
      );
    });
    return packet;
  }

  attachTraceReference(input: HarnessTraceReferenceInput): void {
    const run = this.#requireRun(input.runId);
    const task = this.#requireTask(run.taskId);
    const lifecycle = this.#database.one(
      `SELECT event_json FROM harness_lifecycle_events
       WHERE run_id = ? AND sequence = ?`,
      input.runId,
      input.lifecycleSequence,
    );
    if (lifecycle === undefined) {
      throw new Error("Harness lifecycle event was not found.");
    }
    const lifecycleEvent = JSON.parse(
      harnessRowString(lifecycle, "event_json"),
    ) as HarnessLifecycleEvent;
    if (lifecycleEvent.signal.kind !== "effect.requested") {
      throw new Error(
        "An authoritative canonical trace event requires the matching effect request.",
      );
    }
    const trace = this.#database.one(
      `SELECT id FROM trace_events
       WHERE id = ? AND project_id = ? AND task_id = ? AND run_id = ?
         AND command_action_digest = ?`,
      input.traceEventId,
      task.projectId,
      task.taskId,
      input.runId,
      lifecycleEvent.signal.payloadDigest,
    );
    if (trace === undefined) {
      throw new Error(
        "An authoritative canonical trace event is required before attachment.",
      );
    }
    this.#database.transaction(() => {
      this.#database.run(
        `INSERT INTO harness_trace_refs (
           run_id, lifecycle_sequence, trace_event_id, created_at
         ) VALUES (?, ?, ?, ?)`,
        input.runId,
        input.lifecycleSequence,
        input.traceEventId,
        this.#clock(),
      );
    });
  }

  async #drain(
    runId: string,
    epoch: number,
    adapter: DurableHarnessAdapter,
  ): Promise<HarnessRunSnapshot> {
    let run = this.#requireRun(runId);
    try {
      for await (const rawSignal of adapter.stream({
        taskId: run.taskId,
        runId,
        dispatchEpoch: epoch,
        afterSignalCount: run.adapterCursor,
      })) {
        const signal = HarnessSignalSchema.parse(rawSignal);
        run = this.#requireRun(runId);
        this.#assertEpoch(run, epoch);
        if (run.state !== "running") {
          throw new Error(
            `Run "${runId}" rejected a stale adapter session in state "${run.state}".`,
          );
        }
        const boundary = this.#acceptAdapterSignal(run, signal);
        if (boundary) return this.#requireRun(runId);
      }
    } catch {
      run = this.#requireRun(runId);
      if (run.state === "running" && run.dispatchEpoch === epoch) {
        this.#database.transaction(() => {
          this.#append(
            runId,
            epoch,
            normalizeHarnessFailure(),
            false,
          );
          this.#database.run(
            `UPDATE harness_runs
             SET state = 'failed', failure_json = ?, updated_at = ?
             WHERE run_id = ?`,
            canonicalJson({
              code: "HARNESS_PROVIDER_FAILURE",
              message: "Harness execution failed.",
            }),
            this.#clock(),
            runId,
          );
        });
      }
    }
    return this.#requireRun(runId);
  }

  #acceptAdapterSignal(
    run: HarnessRunSnapshot,
    signal: HarnessSignal,
  ): boolean {
    const task = this.#requireTask(run.taskId);
    let nextState = run.state;
    let boundary = false;
    let remainingTokens = run.remainingTokenBudget;
    let remainingCost = run.remainingCostBudgetUsdMicros;
    let failureJson: string | null = null;
    if (signal.kind === "approval.requested") {
      if (
        signal.scopes.some(
          (scope) => !task.permissionCeiling.includes(scope),
        )
      ) {
        throw new Error("Harness requested approval above the task ceiling.");
      }
      nextState = "awaiting-approval";
      boundary = true;
    } else if (signal.kind === "effect.requested") {
      if (!task.permissionCeiling.includes(signal.requiredPermission)) {
        throw new Error("Harness effect exceeds the task permission ceiling.");
      }
      if (
        !this.#hasApprovedPermission(
          run.runId,
          signal.requiredPermission,
        )
      ) {
        throw new Error("Harness effect requires durable human approval.");
      }
      nextState = "paused";
      boundary = true;
    } else if (signal.kind === "usage.recorded") {
      if (
        signal.tokens > remainingTokens ||
        signal.costUsdMicros > remainingCost
      ) {
        throw new Error("Harness usage exceeds its durable budget.");
      }
      remainingTokens -= signal.tokens;
      remainingCost -= signal.costUsdMicros;
    } else if (signal.kind === "run.completed") {
      nextState = "completed";
      boundary = true;
    } else if (signal.kind === "run.failed") {
      nextState = "failed";
      boundary = true;
      failureJson = canonicalJson({
        code: signal.code,
        message: signal.message,
      });
    }
    this.#database.transaction(() => {
      const event = this.#append(
        run.runId,
        run.dispatchEpoch,
        signal,
        true,
      );
      if (signal.kind === "checkpoint.saved") {
        this.#database.run(
          `INSERT INTO harness_checkpoints (
             checkpoint_id, run_id, sequence, checkpoint_json, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
          signal.checkpointId,
          run.runId,
          event.sequence,
          canonicalJson({
            checkpointId: signal.checkpointId,
            runId: run.runId,
            sequence: event.sequence,
          }),
          event.createdAt,
        );
      }
      this.#database.run(
        `UPDATE harness_runs
         SET state = ?, adapter_cursor = adapter_cursor + 1,
             remaining_token_budget = ?,
             remaining_cost_budget_usd_micros = ?,
             checkpoint_id = COALESCE(?, checkpoint_id),
             failure_json = ?, updated_at = ?
         WHERE run_id = ? AND dispatch_epoch = ? AND state = 'running'`,
        nextState,
        remainingTokens,
        remainingCost,
        signal.kind === "checkpoint.saved"
          ? signal.checkpointId
          : null,
        failureJson,
        this.#clock(),
        run.runId,
        run.dispatchEpoch,
      );
    });
    return boundary;
  }

  #control(
    input: HarnessRunControlInput,
    targetState: "paused" | "stopped",
  ): HarnessRunSnapshot {
    const run = this.#requireRun(input.runId);
    this.#assertEpoch(run, input.dispatchEpoch);
    if (run.state === targetState) return run;
    if (["completed", "failed", "stopped"].includes(run.state)) {
      if (targetState === "stopped" && run.state === "stopped") return run;
      throw new Error(
        `Run "${input.runId}" cannot transition from "${run.state}".`,
      );
    }
    this.#database.transaction(() => {
      const current = this.#requireRun(input.runId);
      this.#assertEpoch(current, input.dispatchEpoch);
      if (current.state === targetState) return;
      if (["completed", "failed", "stopped"].includes(current.state)) {
        throw new Error(
          `Run "${input.runId}" cannot transition from "${current.state}".`,
        );
      }
      this.#append(
        input.runId,
        input.dispatchEpoch,
        {
          kind: targetState === "paused" ? "run.paused" : "run.stopped",
          reason: input.reason,
        },
        false,
      );
      const changed = this.#database.run(
        `UPDATE harness_runs SET state = ?, updated_at = ?
         WHERE run_id = ? AND dispatch_epoch = ? AND state = ?`,
        targetState,
        this.#clock(),
        input.runId,
        input.dispatchEpoch,
        current.state,
      );
      if (changed !== 1) {
        throw new Error(
          `Run "${input.runId}" changed before ${targetState}.`,
        );
      }
    });
    return this.#requireRun(input.runId);
  }

  #append(
    runId: string,
    dispatchEpoch: number,
    rawSignal: HarnessSignal,
    _adapterOwned: boolean,
  ): HarnessLifecycleEvent {
    const signal = HarnessSignalSchema.parse(rawSignal);
    const run = this.#requireRun(runId);
    this.#assertEpoch(run, dispatchEpoch);
    const sequence = run.lastEventSequence + 1;
    const createdAt = this.#clock();
    const material = {
      runId,
      sequence,
      dispatchEpoch,
      previousHash: run.lastEventHash ?? null,
      createdAt,
      signal,
    };
    const eventHash = hashCanonicalValue(material);
    const event: HarnessLifecycleEvent = { ...material, eventHash };
    this.#database.run(
      `INSERT INTO harness_lifecycle_events (
         run_id, sequence, dispatch_epoch, event_type, previous_hash,
         event_hash, event_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      runId,
      sequence,
      dispatchEpoch,
      signal.kind,
      run.lastEventHash ?? null,
      eventHash,
      canonicalJson(event),
      createdAt,
    );
    this.#database.run(
      `UPDATE harness_runs
       SET last_event_sequence = ?, last_event_hash = ?, updated_at = ?
       WHERE run_id = ?`,
      sequence,
      eventHash,
      createdAt,
      runId,
    );
    return event;
  }

  #requireTask(taskId: string): StoredHarnessTask {
    const row = this.#database.one(
      "SELECT * FROM harness_tasks WHERE task_id = ?",
      taskId,
    );
    if (row === undefined) {
      throw new Error(`Harness task "${taskId}" was not found.`);
    }
    return storedHarnessTaskFromRow(row);
  }

  #requireRun(runId: string): StoredHarnessRun {
    const row = this.#database.one(
      "SELECT * FROM harness_runs WHERE run_id = ?",
      runId,
    );
    if (row === undefined) {
      throw new Error(`Harness run "${runId}" was not found.`);
    }
    return storedHarnessRunFromRow(row);
  }

  #assertEpoch(
    run: HarnessRunSnapshot,
    dispatchEpoch: number,
  ): void {
    if (run.dispatchEpoch !== dispatchEpoch) {
      throw new Error(
        `Harness run rejected stale dispatch epoch ${dispatchEpoch}; current epoch is ${run.dispatchEpoch}.`,
      );
    }
  }

  #latestApprovalRequest(
    runId: string,
  ):
    | Extract<HarnessSignal, { kind: "approval.requested" }>
    | undefined {
    const events = [...this.getEvents(runId)].reverse();
    return events
      .map((event) => event.signal)
      .find(
        (
          signal,
        ): signal is Extract<
          HarnessSignal,
          { kind: "approval.requested" }
        > => signal.kind === "approval.requested",
      );
  }

  #hasUnresolvedApproval(runId: string): boolean {
    const events = this.getEvents(runId);
    const requested = events
      .filter((event) => event.signal.kind === "approval.requested")
      .at(-1)?.signal;
    if (requested?.kind !== "approval.requested") return false;
    return !events.some(
      (event) =>
        event.signal.kind === "approval.resolved" &&
        event.signal.approvalId === requested.approvalId,
    );
  }

  #hasApprovedPermission(
    runId: string,
    permission: string,
  ): boolean {
    const events = this.getEvents(runId);
    const requests = new Map<string, readonly string[]>();
    const approved = new Set<string>();
    for (const event of events) {
      if (event.signal.kind === "approval.requested") {
        requests.set(event.signal.approvalId, event.signal.scopes);
      } else if (
        event.signal.kind === "approval.resolved" &&
        event.signal.decision === "approved"
      ) {
        approved.add(event.signal.approvalId);
      }
    }
    return [...approved].some((approvalId) =>
      requests.get(approvalId)?.includes(permission),
    );
  }

  #hasPendingEffect(runId: string): boolean {
    return this.getEvents(runId).some(
      (event) => event.signal.kind === "effect.requested",
    );
  }

}
