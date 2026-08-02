import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  CanvasOperationSchema,
  TargetApplyOutcomeSchema,
  TargetFenceActivationResultSchema,
  TargetReceiptSchema,
  type CanvasOperation,
  type TargetApplyOutcome,
  type TargetEffectRequest,
  type TargetFenceActivationRequest,
  type TargetLookupRequest,
  type TargetLookupResult,
  type TargetReceipt,
  type TargetVerificationRequest,
  type TargetVerificationResult,
} from "../../protocol/src/index.js";
import {
  DurableRuntime,
  bindCommandAction,
  type CanvasTargetAdapter,
  type EffectExecutor,
} from "./index.js";
import {
  lookupResultFor,
  receiptFor,
} from "./canvas-effect-test-fixtures.js";
import {
  MutableClock,
  PROJECT_ID,
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

function paths(): {
  readonly runtime: string;
} {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-canvas-effect-"),
  );
  temporaryDirectories.push(directory);
  return { runtime: join(directory, "runtime.sqlite") };
}

function operation(suffix: string): CanvasOperation {
  return CanvasOperationSchema.parse({
    schemaVersion: 1,
    id: sortableId("opn", suffix),
    documentId: sortableId("doc", suffix),
    actorId: "runtime-agent",
    occurredAt: "2026-07-28T12:00:00.000Z",
    actionDigest: contentHash("d"),
    expectedBeforeHash: contentHash("a"),
    resultingHash: contentHash("b"),
    type: "node.create",
    payload: {
      node: {
        id: sortableId("nod", suffix),
        kind: "draft-frame",
        authority: "canvas-document",
        evidenceLevel: "proposed",
        coverageHealth: "partial",
        parentId: null,
        position: { x: 0, y: 0 },
        size: { width: 320, height: 640 },
        viewport: {
          name: "mobile",
          width: 320,
          height: 640,
        },
      },
    },
  });
}

function commandFor(
  payload: CanvasOperation,
  suffix: string,
) {
  return bindCommandAction(
    durableCommand({
      id: sortableId("cmd", suffix),
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      runId: RUN_ID,
      idempotencyKey: sortableId("idem", suffix),
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
        capabilityGrantId: sortableId("grt", suffix),
        approvalReceiptId: sortableId("apr", suffix),
        leaseId: alternateLeaseId(suffix),
        fencingEpoch: 1,
      },
    }),
    payload,
  );
}

class RecordingCanvasTarget implements CanvasTargetAdapter {
  readonly applyCalls: TargetEffectRequest[] = [];
  readonly lookupCalls: TargetLookupRequest[] = [];
  applyStatus:
    | "applied"
    | "replayed"
    | "not-applied"
    | "outcome-unknown" = "applied";
  lookupResult?: Record<string, unknown>;
  lastReceipt?: TargetReceipt;
  forgeReceipt = false;
  beforeApplyResponse?: () => void;

  activateFence(request: TargetFenceActivationRequest) {
    return TargetFenceActivationResultSchema.parse({
      ...request,
      status: "activated",
      highestFence: request.fencingEpoch,
    });
  }

  compareAndApply(
    request: TargetEffectRequest,
  ): TargetApplyOutcome {
    this.applyCalls.push(request);
    const receipt = receiptFor(request);
    const returnedReceipt = this.forgeReceipt
      ? TargetReceiptSchema.parse({
          ...receipt,
          commandId: sortableId("cmd", "Z"),
        })
      : receipt;
    this.lastReceipt = returnedReceipt;
    this.beforeApplyResponse?.();
    if (
      this.applyStatus === "applied" ||
      this.applyStatus === "replayed"
    ) {
      return TargetApplyOutcomeSchema.parse({
        schemaVersion: 1,
        status: this.applyStatus,
        receipt: returnedReceipt,
      });
    }
    if (this.applyStatus === "not-applied") {
      return TargetApplyOutcomeSchema.parse({
        schemaVersion: 1,
        status: "not-applied",
        evidence: {
          code: "APPLY_REJECTED",
          message: "Target rejected before applying.",
          currentTargetHash: request.target.expectedBeforeHash,
          evidenceHash: contentHash("c"),
        },
      });
    }
    return TargetApplyOutcomeSchema.parse({
      schemaVersion: 1,
      status: "outcome-unknown",
      error: {
        code: "ACKNOWLEDGEMENT_LOST",
        message: "Target commit acknowledgement was lost.",
      },
    });
  }

  lookup(request: TargetLookupRequest): TargetLookupResult {
    this.lookupCalls.push(request);
    const configured = this.lookupResult ?? {
      status: "unavailable",
      code: "TARGET_UNAVAILABLE",
      message: "No lookup fixture was configured.",
    };
    return lookupResultFor(request, configured);
  }

  verify(
    _request: TargetVerificationRequest,
  ): Promise<TargetVerificationResult> {
    throw new Error("Verification is outside this slice.");
  }
}

class ForbiddenGenericExecutor implements EffectExecutor {
  calls = 0;

  async execute(): Promise<
    Awaited<ReturnType<EffectExecutor["execute"]>>
  > {
    this.calls += 1;
    throw new Error("Generic executor must not receive canvas effects.");
  }
}

async function authorizedRuntime(
  databasePath: string,
  target: RecordingCanvasTarget,
  suffix: string,
) {
  const clock = new MutableClock();
  const executor = new ForbiddenGenericExecutor();
  const runtime = new DurableRuntime({
    databasePath,
    clock: clock.now,
    canvasTarget: target,
    effectExecutor: executor,
  });
  const payload = operation(suffix);
  const command = commandFor(payload, suffix);
  runtime.registerGrant(grantFor(command));
  runtime.registerApprovalReceipt(approvalFor(command));
  const lease = runtime.acquireLease({
    leaseId: command.authority.leaseId,
    projectId: command.projectId,
    targetId: command.target.id,
    holderId: command.issuerId,
    ttlMilliseconds: 60_000,
  });
  await runtime.activateCanvasLease({
    projectId: lease.projectId,
    targetId: lease.targetId,
    leaseId: lease.id,
    fencingEpoch: lease.fencingEpoch,
  });
  runtime.submitCommand({
    command,
    outboxId: alternateOutboxId(suffix),
    effectPayload: payload,
  });
  return { clock, command, executor, payload, runtime };
}

function targetRows(path: string, commandId: string) {
  const database = new DatabaseSync(path);
  const receipt = database
    .prepare(
      `SELECT command_id, outbox_id, project_id, target_kind,
              target_id, receipt_hash, receipt_json
       FROM target_receipts WHERE command_id = ?`,
    )
    .get(commandId);
  const latch = database
    .prepare(
      `SELECT rowid AS latch_rowid, command_id, outbox_id, state,
              worker_claim_id, claim_epoch, recovery_json
       FROM target_schedule_latches WHERE command_id = ?`,
    )
    .get(commandId);
  database.close();
  return { latch, receipt };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("runtime canvas target application", () => {
  for (const status of ["applied", "replayed"] as const) {
    it(`constructs a closed request and durably records ${status} through effect-applied`, async () => {
      const fixture = paths();
      const target = new RecordingCanvasTarget();
      target.applyStatus = status;
      const { command, executor, payload, runtime } =
        await authorizedRuntime(fixture.runtime, target, "A");

      const applied = await runtime.applyNextEffect({
        workerId: "canvas-worker",
        claimTtlMilliseconds: 5_000,
      });

      expect(applied).toMatchObject({
        commandId: command.id,
        phase: "effect-applied",
        resultingHash: payload.resultingHash,
      });
      expect(executor.calls).toBe(0);
      expect(target.applyCalls).toHaveLength(1);
      expect(target.applyCalls[0]).toMatchObject({
        schemaVersion: 1,
        effectKind: "canvas.operation",
        projectId: command.projectId,
        taskId: command.taskId,
        runId: command.runId,
        issuerId: command.issuerId,
        commandId: command.id,
        target: command.target,
        idempotencyKey: command.idempotencyKey,
        commandActionDigest: command.actionDigest,
        operationActionDigest: payload.actionDigest,
        payloadHash: command.payloadHash,
        payload,
        capabilityGrantId: command.authority.capabilityGrantId,
        approvalReceiptId: command.authority.approvalReceiptId,
        lease: {
          id: command.authority.leaseId,
          holderId: command.issuerId,
          fencingEpoch: command.authority.fencingEpoch,
        },
        workerClaim: {
          id: `${alternateOutboxId("A")}:1`,
          fencingEpoch: 1,
        },
      });
      expect(runtime.getTargetReceipt(command.id)).toEqual(
        target.lastReceipt,
      );
      const rows = targetRows(fixture.runtime, command.id);
      expect(rows.receipt).toMatchObject({
        command_id: command.id,
        outbox_id: alternateOutboxId("A"),
        project_id: command.projectId,
        target_kind: command.target.kind,
        target_id: command.target.id,
        receipt_hash: target.lastReceipt?.receiptHash,
      });
      expect(rows.latch).toMatchObject({
        command_id: command.id,
        outbox_id: alternateOutboxId("A"),
        state: "pending-commit",
        worker_claim_id: `${alternateOutboxId("A")}:1`,
        claim_epoch: 1,
      });
      runtime.close();
    });
  }

  it("fails closed when canvas dispatch has no platform target adapter", async () => {
    const fixture = paths();
    const executor = new ForbiddenGenericExecutor();
    const runtime = new DurableRuntime({
      databasePath: fixture.runtime,
      clock: new MutableClock().now,
      effectExecutor: executor,
    });
    const payload = operation("B");
    const command = commandFor(payload, "B");
    runtime.registerGrant(grantFor(command));
    runtime.registerApprovalReceipt(approvalFor(command));
    runtime.submitCommand({
      command,
      outboxId: alternateOutboxId("B"),
      effectPayload: payload,
    });
    const claim = runtime.claimNextEffect({
      workerId: "no-adapter-worker",
      claimTtlMilliseconds: 5_000,
    });
    expect(claim).toBeNull();
    expect(executor.calls).toBe(0);
    expect(targetRows(fixture.runtime, command.id).latch).toBeUndefined();
    runtime.close();
  });

  it("releases a definitely-not-applied latch without recording a receipt", async () => {
    const fixture = paths();
    const target = new RecordingCanvasTarget();
    target.applyStatus = "not-applied";
    const { command, runtime } = await authorizedRuntime(
      fixture.runtime,
      target,
      "C",
    );

    await expect(
      runtime.applyNextEffect({
        workerId: "negative-worker",
        claimTtlMilliseconds: 5_000,
      }),
    ).rejects.toThrow("Target rejected before applying.");
    expect(runtime.getOutboxForCommand(command.id)).toMatchObject({
      phase: "failed",
      error: { code: "EFFECT_NOT_APPLIED" },
    });
    expect(runtime.getTargetReceipt(command.id)).toBeUndefined();
    expect(targetRows(fixture.runtime, command.id)).toEqual({
      latch: undefined,
      receipt: undefined,
    });
    runtime.close();
  });

  it("reconciles a lost acknowledgement through lookup without reapplying", async () => {
    const fixture = paths();
    const firstTarget = new RecordingCanvasTarget();
    firstTarget.applyStatus = "outcome-unknown";
    const first = await authorizedRuntime(
      fixture.runtime,
      firstTarget,
      "D",
    );
    await expect(
      first.runtime.applyNextEffect({
        workerId: "lost-ack-worker",
        claimTtlMilliseconds: 1_000,
      }),
    ).rejects.toThrow("Target commit acknowledgement was lost.");
    const committedReceipt = firstTarget.lastReceipt!;
    expect(targetRows(fixture.runtime, first.command.id).latch).toMatchObject({
      state: "blocked-unknown",
    });
    first.runtime.close();

    const recoveredTarget = new RecordingCanvasTarget();
    recoveredTarget.lookupResult = {
      schemaVersion: 1,
      status: "found",
      receipt: committedReceipt,
      currentTargetHash: committedReceipt.resultingHash,
    };
    const recovered = new DurableRuntime({
      databasePath: fixture.runtime,
      clock: first.clock.now,
      canvasTarget: recoveredTarget,
      effectExecutor: new ForbiddenGenericExecutor(),
    });
    const result = await recovered.applyNextEffect({
      workerId: "recovery-worker",
      claimTtlMilliseconds: 1_000,
    });

    expect(result).toMatchObject({
      commandId: first.command.id,
      phase: "effect-applied",
      resultingHash: committedReceipt.resultingHash,
    });
    expect(recoveredTarget.lookupCalls).toHaveLength(1);
    expect(recoveredTarget.applyCalls).toHaveLength(0);
    expect(recovered.getTargetReceipt(first.command.id)).toEqual(
      committedReceipt,
    );
    expect(targetRows(fixture.runtime, first.command.id).latch).toMatchObject({
      state: "pending-commit",
    });
    recovered.close();
  });

  it("reconciles an expired pre-dispatch claim through lookup before applying", async () => {
    const fixture = paths();
    const firstTarget = new RecordingCanvasTarget();
    const first = await authorizedRuntime(
      fixture.runtime,
      firstTarget,
      "K",
    );
    expect(
      first.runtime.claimNextEffect({
        workerId: "interrupted-before-dispatch",
        claimTtlMilliseconds: 1_000,
      }),
    ).toMatchObject({
      commandId: first.command.id,
      fencingEpoch: 1,
    });
    first.runtime.close();
    first.clock.advance(1_001);

    const recoveredTarget = new RecordingCanvasTarget();
    recoveredTarget.lookupResult = {
      schemaVersion: 1,
      status: "not-found",
      currentTargetHash: first.command.target.expectedBeforeHash,
    };
    const recovered = new DurableRuntime({
      databasePath: fixture.runtime,
      clock: first.clock.now,
      canvasTarget: recoveredTarget,
      effectExecutor: new ForbiddenGenericExecutor(),
    });
    const result = await recovered.applyNextEffect({
      workerId: "post-lookup-worker",
      claimTtlMilliseconds: 1_000,
    });

    expect(recoveredTarget.lookupCalls).toHaveLength(1);
    expect(recoveredTarget.applyCalls).toHaveLength(1);
    expect(
      recoveredTarget.applyCalls[0]?.workerClaim.fencingEpoch,
    ).toBe(2);
    expect(result?.phase).toBe("effect-applied");
    recovered.close();
  });

  it("reclaims the same outbox at a fresh epoch only after trusted not-found evidence", async () => {
    const fixture = paths();
    const firstTarget = new RecordingCanvasTarget();
    firstTarget.applyStatus = "outcome-unknown";
    const first = await authorizedRuntime(
      fixture.runtime,
      firstTarget,
      "E",
    );
    await expect(
      first.runtime.applyNextEffect({
        workerId: "uncertain-worker",
        claimTtlMilliseconds: 1_000,
      }),
    ).rejects.toThrow();
    const originalLatchRowId = (
      targetRows(fixture.runtime, first.command.id).latch as {
        readonly latch_rowid: number;
      }
    ).latch_rowid;
    first.runtime.close();

    const recoveredTarget = new RecordingCanvasTarget();
    recoveredTarget.lookupResult = {
      schemaVersion: 1,
      status: "not-found",
      currentTargetHash: first.command.target.expectedBeforeHash,
    };
    const recovered = new DurableRuntime({
      databasePath: fixture.runtime,
      clock: first.clock.now,
      canvasTarget: recoveredTarget,
      effectExecutor: new ForbiddenGenericExecutor(),
    });
    const result = await recovered.applyNextEffect({
      workerId: "fresh-worker",
      claimTtlMilliseconds: 1_000,
    });

    expect(result).toMatchObject({
      commandId: first.command.id,
      phase: "effect-applied",
    });
    expect(recoveredTarget.lookupCalls).toHaveLength(1);
    expect(recoveredTarget.applyCalls).toHaveLength(1);
    expect(recoveredTarget.applyCalls[0]?.outboxId).toBe(
      alternateOutboxId("E"),
    );
    expect(
      recoveredTarget.applyCalls[0]?.workerClaim.fencingEpoch,
    ).toBe(2);
    expect(
      (
        targetRows(fixture.runtime, first.command.id).latch as {
          readonly latch_rowid: number;
        }
      ).latch_rowid,
    ).toBe(originalLatchRowId);
    recovered.close();
  });

  it("bounds blocked recovery while an unrelated target continues", async () => {
    const fixture = paths();
    const target = new RecordingCanvasTarget();
    target.applyStatus = "outcome-unknown";
    const first = await authorizedRuntime(
      fixture.runtime,
      target,
      "Q",
    );
    await expect(
      first.runtime.applyNextEffect({
        workerId: "blocked-target-worker",
        claimTtlMilliseconds: 1_000,
      }),
    ).rejects.toThrow("acknowledgement was lost");

    const otherPayload = operation("R");
    const otherCommand = commandFor(otherPayload, "R");
    first.runtime.registerGrant(grantFor(otherCommand));
    first.runtime.registerApprovalReceipt(approvalFor(otherCommand));
    const otherLease = first.runtime.acquireLease({
      leaseId: otherCommand.authority.leaseId,
      projectId: otherCommand.projectId,
      targetId: otherCommand.target.id,
      holderId: otherCommand.issuerId,
      ttlMilliseconds: 60_000,
    });
    await first.runtime.activateCanvasLease({
      projectId: otherLease.projectId,
      targetId: otherLease.targetId,
      leaseId: otherLease.id,
      fencingEpoch: otherLease.fencingEpoch,
    });
    first.runtime.submitCommand({
      command: otherCommand,
      outboxId: alternateOutboxId("R"),
      effectPayload: otherPayload,
    });
    target.applyStatus = "applied";
    target.lookupResult = {
      schemaVersion: 1,
      status: "mismatch",
      code: "TARGET_HASH_MISMATCH",
      message: "Target evidence does not match.",
    };

    await expect(
      first.runtime.applyNextEffect({
        workerId: "unrelated-target-worker",
        claimTtlMilliseconds: 1_000,
      }),
    ).resolves.toMatchObject({
      commandId: otherCommand.id,
      phase: "effect-applied",
    });
    expect(target.lookupCalls).toHaveLength(1);
    expect(target.applyCalls).toHaveLength(2);
    const firstBlockedLatch = targetRows(
      fixture.runtime,
      first.command.id,
    ).latch as { readonly recovery_json: string };
    expect(firstBlockedLatch).toMatchObject({
      state: "blocked-unknown",
      recovery_json: expect.stringContaining(
        '"status":"mismatch"',
      ),
    });
    target.lookupResult = {
      schemaVersion: 1,
      status: "unavailable",
      code: "TARGET_UNAVAILABLE",
      message: "Target is temporarily unavailable.",
    };

    await expect(
      first.runtime.applyNextEffect({
        workerId: "bounded-recovery-worker",
        claimTtlMilliseconds: 1_000,
      }),
    ).resolves.toBeNull();
    expect(target.lookupCalls).toHaveLength(2);
    expect(target.applyCalls).toHaveLength(2);
    expect(
      (
        targetRows(
          fixture.runtime,
          first.command.id,
        ).latch as { readonly recovery_json: string }
      ).recovery_json,
    ).toContain('"status":"unavailable"');
    first.runtime.close();
  });

  it("blocks a forged applied receipt and preserves lookup recovery", async () => {
    const fixture = paths();
    const target = new RecordingCanvasTarget();
    target.forgeReceipt = true;
    const { command, runtime } = await authorizedRuntime(
      fixture.runtime,
      target,
      "J",
    );

    await expect(
      runtime.applyNextEffect({
        workerId: "forged-receipt-worker",
        claimTtlMilliseconds: 1_000,
      }),
    ).rejects.toThrow("does not match the durable effect request");
    expect(runtime.getOutboxForCommand(command.id)?.phase).toBe(
      "intent",
    );
    expect(runtime.getTargetReceipt(command.id)).toBeUndefined();
    expect(targetRows(fixture.runtime, command.id).latch).toMatchObject({
      state: "blocked-unknown",
    });
    runtime.close();
  });

  it("rolls back receipt persistence when the owned latch transition is lost", async () => {
    const fixture = paths();
    const target = new RecordingCanvasTarget();
    const prepared = await authorizedRuntime(
      fixture.runtime,
      target,
      "K",
    );
    target.beforeApplyResponse = () => {
      const database = new DatabaseSync(fixture.runtime);
      database
        .prepare(
          `DELETE FROM target_schedule_latches WHERE command_id = ?`,
        )
        .run(prepared.command.id);
      database.close();
    };

    await expect(
      prepared.runtime.applyNextEffect({
        workerId: "lost-latch-worker",
        claimTtlMilliseconds: 1_000,
      }),
    ).rejects.toThrow("schedule latch");
    expect(
      prepared.runtime.getOutboxForCommand(prepared.command.id)
        ?.phase,
    ).toBe("intent");
    expect(
      prepared.runtime.getTargetReceipt(prepared.command.id),
    ).toBeUndefined();
    prepared.runtime.close();
  });

  for (const status of [
    "mismatch",
    "unavailable",
    "corrupt",
  ] as const) {
    it(`retains the latch blocked when recovery lookup is ${status}`, async () => {
      const fixture = paths();
      const firstTarget = new RecordingCanvasTarget();
      firstTarget.applyStatus = "outcome-unknown";
      const first = await authorizedRuntime(
        fixture.runtime,
        firstTarget,
        status === "mismatch"
          ? "F"
          : status === "unavailable"
            ? "G"
            : "H",
      );
      await expect(
        first.runtime.applyNextEffect({
          workerId: "blocked-worker",
          claimTtlMilliseconds: 1_000,
        }),
      ).rejects.toThrow();
      first.runtime.close();

      const recoveredTarget = new RecordingCanvasTarget();
      recoveredTarget.lookupResult =
        status === "unavailable"
          ? {
              schemaVersion: 1,
              status,
              code: "TARGET_UNAVAILABLE",
              message: "Target unavailable.",
            }
          : {
              schemaVersion: 1,
              status,
              code:
                status === "mismatch"
                  ? "TARGET_HASH_MISMATCH"
                  : "LEDGER_CORRUPT",
              message: "Target evidence cannot be trusted.",
            };
      const recovered = new DurableRuntime({
        databasePath: fixture.runtime,
        clock: first.clock.now,
        canvasTarget: recoveredTarget,
        effectExecutor: new ForbiddenGenericExecutor(),
      });

      await expect(
        recovered.applyNextEffect({
          workerId: "must-not-apply",
          claimTtlMilliseconds: 1_000,
        }),
      ).resolves.toBeNull();
      expect(recoveredTarget.lookupCalls).toHaveLength(1);
      expect(recoveredTarget.applyCalls).toHaveLength(0);
      expect(
        targetRows(fixture.runtime, first.command.id).latch,
      ).toMatchObject({
        state: "blocked-unknown",
        recovery_json: expect.stringContaining(
          `"status":"${status}"`,
        ),
      });
      recovered.close();
    });
  }
});
