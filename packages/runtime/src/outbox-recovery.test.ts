import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DurableRuntime,
  StaleLeaseError,
  StaleWorkerClaimError,
} from "./index.js";
import { rewriteClaimedIntentAsLegacyProcess } from "./outbox-recovery-test-fixtures.js";
import {
  MutableClock,
  RecordingEffectExecutor,
  TRACE_EVENT_ID,
  alternateLeaseId,
  alternateOutboxId,
  approvalFor,
  commandSubmission,
  contentHash,
  durableCommand,
  grantFor,
  legacyCanvasFixtureExecutor,
  matchingEffectVerifier,
  sortableId,
} from "./test-fixtures.js";

const temporaryDirectories: string[] = [];

function newDatabasePath(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-runtime-recovery-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

function authorizeAndLease(
  runtime: DurableRuntime,
  command: ReturnType<typeof durableCommand>,
  ttlMilliseconds = 60_000,
): void {
  runtime.registerGrant(
    grantFor(command, {
      canonicalPaths:
        command.kind === "sandbox.process" ? ["/workspace"] : [],
    }),
  );
  runtime.registerApprovalReceipt(approvalFor(command));
  runtime.acquireLease({
    leaseId: command.authority.leaseId,
    projectId: command.projectId,
    targetId: command.target.id,
    holderId: command.issuerId,
    ttlMilliseconds,
  });
}

const allowPolicy = { validate: () => undefined };

function claimCommit(
  runtime: DurableRuntime,
  command: ReturnType<typeof durableCommand>,
  workerId: string,
) {
  return runtime.claimEffectCommit({
    commandId: command.id,
    workerId,
    claimTtlMilliseconds: 5_000,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("outbox transitions and crash recovery", () => {
  it("records effect-applied before a separate atomic commit", async () => {
    const executor = new RecordingEffectExecutor();
    const runtime = new DurableRuntime({
      databasePath: newDatabasePath(),
      clock: new MutableClock().now,
      effectExecutor: executor,
      effectVerifier: matchingEffectVerifier(),
      traceEventIdFactory: () => TRACE_EVENT_ID,
    });
    const command = durableCommand();
    authorizeAndLease(runtime, command);
    runtime.submitCommand(commandSubmission(command));

    const applied = await runtime.applyNextEffect({
      workerId: "worker-a",
      claimTtlMilliseconds: 5_000,
    });

    expect(applied).toMatchObject({
      commandId: command.id,
      phase: "effect-applied",
      resultingHash: executor.resultingHash,
    });
    expect(executor.calls).toHaveLength(1);
    expect(runtime.getEffectReceipt(command.id)).toBeUndefined();

    const commitClaim = claimCommit(
      runtime,
      command,
      "commit-worker-a",
    );
    const receipt = await runtime.verifyAndCommit({
      claim: commitClaim,
    });
    expect(receipt).toMatchObject({
      commandId: command.id,
      actionDigest: command.actionDigest,
      resultingHash: executor.resultingHash,
      traceEventId: TRACE_EVENT_ID,
    });
    expect(runtime.getOutboxForCommand(command.id)?.phase).toBe(
      "committed",
    );
    expect(runtime.getTraceReference(command.id)).toEqual({
      commandId: command.id,
      traceEventId: TRACE_EVENT_ID,
    });
    expect(
      await runtime.verifyAndCommit({
        claim: commitClaim,
      }),
    ).toEqual(receipt);
    runtime.close();
  });

  it("recovers effect-applied work without executing its effect twice", async () => {
    const databasePath = newDatabasePath();
    const clock = new MutableClock();
    const firstExecutor = new RecordingEffectExecutor();
    const command = durableCommand();
    const firstRuntime = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: firstExecutor,
    });
    authorizeAndLease(firstRuntime, command);
    firstRuntime.submitCommand(commandSubmission(command));
    await firstRuntime.applyNextEffect({
      workerId: "worker-a",
      claimTtlMilliseconds: 5_000,
    });
    expect(firstExecutor.calls).toHaveLength(1);
    firstRuntime.close();

    const recoveryExecutor = new RecordingEffectExecutor();
    const recoveredRuntime = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: recoveryExecutor,
      effectVerifier: matchingEffectVerifier(clock.now),
    });

    expect(recoveredRuntime.recover()).toEqual({
      intentsAwaitingEffect: [],
      effectsAwaitingCommit: [command.id],
      blockedOutcomeUnknown: [],
    });
    expect(
      await recoveredRuntime.applyNextEffect({
        workerId: "worker-recovery",
        claimTtlMilliseconds: 5_000,
      }),
    ).toBeNull();
    expect(recoveryExecutor.calls).toHaveLength(0);

    await recoveredRuntime.verifyAndCommit({
      claim: claimCommit(
        recoveredRuntime,
        command,
        "commit-worker-recovery",
      ),
    });
    expect(
      recoveredRuntime.recover().effectsAwaitingCommit,
    ).toEqual([]);
    recoveredRuntime.close();
  });

  it("rejects commit before an effect-applied transition", () => {
    const runtime = new DurableRuntime({
      databasePath: newDatabasePath(),
      clock: new MutableClock().now,
      effectExecutor: new RecordingEffectExecutor(),
    });
    const command = durableCommand();
    runtime.registerGrant(grantFor(command));
    runtime.registerApprovalReceipt(approvalFor(command));
    runtime.submitCommand(commandSubmission(command));

    expect(() =>
      runtime.claimEffectCommit({
        commandId: command.id,
        workerId: "commit-before-apply",
        claimTtlMilliseconds: 1_000,
      }),
    ).toThrow(
      `Command "${command.id}" must be effect-applied before commit claim.`,
    );
    expect(runtime.getEffectReceipt(command.id)).toBeUndefined();
    runtime.close();
  });

  it("rejects a stale worker claim after fenced takeover", async () => {
    const databasePath = newDatabasePath();
    const clock = new MutableClock();
    const firstExecutor = new RecordingEffectExecutor();
    const secondExecutor = new RecordingEffectExecutor();
    const first = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: firstExecutor,
      policyValidator: allowPolicy,
    });
    const second = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: secondExecutor,
      recoveryProbe: () => ({
        observedTargetHash: contentHash("a"),
        evidenceHash: contentHash("f"),
        checkedAt: clock.now(),
      }),
    });
    const command = durableCommand();
    authorizeAndLease(first, command);
    first.submitCommand(commandSubmission(command));

    const staleClaim = first.claimNextEffect({
      workerId: "worker-stale",
      claimTtlMilliseconds: 1_000,
    });
    expect(staleClaim?.fencingEpoch).toBe(1);

    clock.advance(1_001);
    const takeover = second.claimNextEffect({
      workerId: "worker-takeover",
      claimTtlMilliseconds: 1_000,
    });
    expect(takeover).toMatchObject({
      commandId: command.id,
      fencingEpoch: 2,
    });
    expect(second.getRecoveryDecision(command.id)).toMatchObject({
      decision: "retry-idempotent-effect",
      effectKind: "canvas.operation",
      expectedBeforeHash: contentHash("a"),
      observedTargetHash: contentHash("a"),
    });

    await expect(
      first.applyClaimedEffect(staleClaim!),
    ).rejects.toThrow(
      expect.objectContaining<Partial<StaleWorkerClaimError>>({
        code: "STALE_WORKER_CLAIM",
      }),
    );
    expect(firstExecutor.calls).toHaveLength(0);

    await second.applyClaimedEffect(takeover!);
    expect(secondExecutor.calls).toHaveLength(1);
    first.close();
    second.close();
  });

  it("blocks a legacy crashed process claim as outcome unknown without redispatch", async () => {
    const databasePath = newDatabasePath();
    const clock = new MutableClock();
    const firstExecutor = new RecordingEffectExecutor();
    const command = durableCommand({
      id: sortableId("cmd", "8"),
      kind: "sandbox.process",
      target: {
        kind: "process-request",
        id: sortableId("prq", "8"),
        expectedBeforeHash: contentHash("a"),
        baseline: {
          kind: "content-hash",
          value: contentHash("a"),
        },
      },
      payloadHash: contentHash("b"),
      idempotencyKey: sortableId("idem", "8"),
      actionDigest: contentHash("c"),
      requiredCapabilities: ["process:start"],
      authority: {
        capabilityGrantId: sortableId("grt", "8"),
        approvalReceiptId: sortableId("apr", "8"),
        leaseId: alternateLeaseId("8"),
        fencingEpoch: 1,
      },
    });
    const admittedCommand = durableCommand({
      id: command.id,
      idempotencyKey: command.idempotencyKey,
      authority: command.authority,
    });
    const first = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: firstExecutor,
    });
    authorizeAndLease(first, admittedCommand);
    first.submitCommand(
      commandSubmission(admittedCommand, alternateOutboxId("8")),
    );
    expect(
      first.claimNextEffect({
        workerId: "worker-before-crash",
        claimTtlMilliseconds: 1_000,
      }),
    ).not.toBeNull();
    first.close();
    rewriteClaimedIntentAsLegacyProcess(databasePath, command);

    clock.advance(1_001);
    const recoveryExecutor = new RecordingEffectExecutor();
    const recovered = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: recoveryExecutor,
    });

    expect(recovered.recover()).toEqual({
      intentsAwaitingEffect: [],
      effectsAwaitingCommit: [],
      blockedOutcomeUnknown: [command.id],
    });
    expect(recovered.getOutboxForCommand(command.id)).toMatchObject({
      phase: "failed",
      failedFrom: "intent",
      error: {
        code: "OUTCOME_UNKNOWN",
        retryable: false,
      },
    });
    expect(recovered.getRecoveryDecision(command.id)).toMatchObject({
      commandId: command.id,
      outboxId: alternateOutboxId("8"),
      observedPhase: "intent",
      decision: "block-outcome-unknown",
      effectKind: "sandbox.process",
    });
    expect(
      await recovered.applyNextEffect({
        workerId: "worker-after-crash",
        claimTtlMilliseconds: 1_000,
      }),
    ).toBeNull();
    expect(firstExecutor.calls).toHaveLength(0);
    expect(recoveryExecutor.calls).toHaveLength(0);
    recovered.close();
  });

  it("blocks live takeover of an expired legacy process claim", async () => {
    const databasePath = newDatabasePath();
    const clock = new MutableClock();
    const command = durableCommand({
      id: sortableId("cmd", "9"),
      kind: "sandbox.process",
      target: {
        kind: "process-request",
        id: sortableId("prq", "9"),
        expectedBeforeHash: contentHash("a"),
        baseline: {
          kind: "content-hash",
          value: contentHash("a"),
        },
      },
      idempotencyKey: sortableId("idem", "9"),
      requiredCapabilities: ["process:start"],
      authority: {
        capabilityGrantId: sortableId("grt", "9"),
        approvalReceiptId: sortableId("apr", "9"),
        leaseId: alternateLeaseId("9"),
        fencingEpoch: 1,
      },
    });
    const admittedCommand = durableCommand({
      id: command.id,
      idempotencyKey: command.idempotencyKey,
      authority: command.authority,
    });
    const first = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: new RecordingEffectExecutor(),
    });
    authorizeAndLease(first, admittedCommand);
    first.submitCommand(
      commandSubmission(admittedCommand, alternateOutboxId("9")),
    );
    expect(first.claimNextEffect({
      workerId: "worker-live-before",
      claimTtlMilliseconds: 1_000,
    })).not.toBeNull();
    first.close();
    rewriteClaimedIntentAsLegacyProcess(databasePath, command);

    clock.advance(1_001);
    const takeoverExecutor = new RecordingEffectExecutor();
    const takeover = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: takeoverExecutor,
    });
    expect(
      await takeover.applyNextEffect({
        workerId: "worker-live-after",
        claimTtlMilliseconds: 1_000,
      }),
    ).toBeNull();
    expect(takeoverExecutor.calls).toHaveLength(0);
    expect(takeover.getRecoveryDecision(command.id)).toMatchObject({
      decision: "block-outcome-unknown",
      effectKind: "sandbox.process",
    });
    expect(takeover.getOutboxForCommand(command.id)).toMatchObject({
      phase: "failed",
      error: { code: "OUTCOME_UNKNOWN" },
    });
    takeover.close();
  });

  it("preserves ordered recovery history when a retry later becomes outcome unknown", () => {
    const databasePath = newDatabasePath();
    const clock = new MutableClock();
    const command = durableCommand({
      id: sortableId("cmd", "D"),
      idempotencyKey: sortableId("idem", "D"),
      authority: {
        capabilityGrantId: sortableId("grt", "D"),
        approvalReceiptId: sortableId("apr", "D"),
        leaseId: alternateLeaseId("D"),
        fencingEpoch: 1,
      },
    });
    const first = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: new RecordingEffectExecutor(),
    });
    authorizeAndLease(first, command);
    first.submitCommand(
      commandSubmission(command, alternateOutboxId("D")),
    );
    first.claimNextEffect({
      workerId: "worker-first-attempt",
      claimTtlMilliseconds: 1_000,
    });
    first.close();

    clock.advance(1_001);
    const retrier = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: new RecordingEffectExecutor(),
      recoveryProbe: () => ({
        observedTargetHash: contentHash("a"),
        evidenceHash: contentHash("f"),
        checkedAt: clock.now(),
      }),
    });
    expect(
      retrier.claimNextEffect({
        workerId: "worker-retry",
        claimTtlMilliseconds: 1_000,
      }),
    ).not.toBeNull();
    expect(retrier.getRecoveryDecision(command.id)).toMatchObject({
      decision: "retry-idempotent-effect",
    });
    retrier.close();

    clock.advance(1_001);
    const blocker = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: new RecordingEffectExecutor(),
    });
    expect(blocker.recover().blockedOutcomeUnknown).toEqual([
      command.id,
    ]);
    expect(blocker.getRecoveryDecision(command.id)).toMatchObject({
      decision: "block-outcome-unknown",
    });
    const history = blocker.getRecoveryDecisions(command.id);
    expect(history).toHaveLength(2);
    expect(history.map((decision) => decision.decision)).toEqual([
      "retry-idempotent-effect",
      "block-outcome-unknown",
    ]);
    expect(new Set(history.map((decision) => decision.id)).size).toBe(2);
    blocker.close();
  });

  it("requires matching target verification before durable commit", async () => {
    const executor = new RecordingEffectExecutor();
    let verifierThrows = false;
    const runtime = new DurableRuntime({
      databasePath: newDatabasePath(),
      clock: new MutableClock().now,
      effectExecutor: executor,
      effectVerifier: {
        verify: () => {
          if (verifierThrows) {
            throw new Error("verifier unavailable");
          }
          return {
            observedTargetHash: contentHash("f"),
            evidenceHash: contentHash("d"),
            verifiedAt: "2026-07-28T12:00:00.000Z",
          };
        },
      },
    });
    const command = durableCommand();
    authorizeAndLease(runtime, command);
    runtime.submitCommand(commandSubmission(command));
    await runtime.applyNextEffect({
      workerId: "worker-verify",
      claimTtlMilliseconds: 5_000,
    });

    const forgedClaim = claimCommit(
      runtime,
      command,
      "commit-worker-forged",
    );
    await expect(
      runtime.verifyAndCommit({
        claim: forgedClaim,
      }),
    ).rejects.toThrow(
      "Target verification does not match the applied result.",
    );
    expect(runtime.getEffectReceipt(command.id)).toBeUndefined();
    expect(runtime.getTraceReference(command.id)).toBeUndefined();
    expect(runtime.getOutboxForCommand(command.id)?.phase).toBe(
      "effect-applied",
    );
    verifierThrows = true;
    await expect(
      runtime.verifyAndCommit({
        claim: forgedClaim,
      }),
    ).rejects.toThrow("verifier unavailable");
    expect(runtime.getOutboxForCommand(command.id)?.phase).toBe(
      "effect-applied",
    );
    runtime.close();
  });

  it("rejects commit after the command lease is fenced", async () => {
    const clock = new MutableClock();
    const runtime = new DurableRuntime({
      databasePath: newDatabasePath(),
      clock: clock.now,
      effectExecutor: new RecordingEffectExecutor(),
      effectVerifier: matchingEffectVerifier(clock.now),
    });
    const command = durableCommand({
      id: sortableId("cmd", "E"),
      idempotencyKey: sortableId("idem", "E"),
      authority: {
        capabilityGrantId: sortableId("grt", "E"),
        approvalReceiptId: sortableId("apr", "E"),
        leaseId: alternateLeaseId("E"),
        fencingEpoch: 1,
      },
    });
    authorizeAndLease(runtime, command, 1_000);
    runtime.submitCommand(
      commandSubmission(command, alternateOutboxId("E")),
    );
    await runtime.applyNextEffect({
      workerId: "worker-before-fence",
      claimTtlMilliseconds: 1_000,
    });
    const fencedClaim = claimCommit(
      runtime,
      command,
      "commit-worker-before-fence",
    );
    clock.advance(1_001);
    runtime.acquireLease({
      leaseId: alternateLeaseId("F"),
      projectId: command.projectId,
      targetId: command.target.id,
      holderId: "replacement-agent",
      ttlMilliseconds: 1_000,
    });

    await expect(
      runtime.verifyAndCommit({
        claim: fencedClaim,
      }),
    ).rejects.toThrow(
      expect.objectContaining<Partial<StaleLeaseError>>({
        code: "STALE_FENCE",
      }),
    );
    expect(runtime.getOutboxForCommand(command.id)?.phase).toBe(
      "effect-applied",
    );
    expect(runtime.getEffectReceipt(command.id)).toBeUndefined();
    expect(runtime.getTraceReference(command.id)).toBeUndefined();
    runtime.close();
  });

  it("rejects a stale commit claim after fenced takeover", async () => {
    const databasePath = newDatabasePath();
    const clock = new MutableClock();
    const first = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: new RecordingEffectExecutor(),
      effectVerifier: matchingEffectVerifier(clock.now),
    });
    const command = durableCommand({
      id: sortableId("cmd", "H"),
      idempotencyKey: sortableId("idem", "H"),
      authority: {
        capabilityGrantId: sortableId("grt", "H"),
        approvalReceiptId: sortableId("apr", "H"),
        leaseId: alternateLeaseId("H"),
        fencingEpoch: 1,
      },
    });
    authorizeAndLease(first, command);
    first.submitCommand(
      commandSubmission(command, alternateOutboxId("H")),
    );
    await first.applyNextEffect({
      workerId: "effect-worker",
      claimTtlMilliseconds: 1_000,
    });
    const staleClaim = first.claimEffectCommit({
      commandId: command.id,
      workerId: "commit-worker-stale",
      claimTtlMilliseconds: 1_000,
    });

    clock.advance(1_001);
    const second = new DurableRuntime({
      databasePath,
      clock: clock.now,
      effectExecutor: new RecordingEffectExecutor(),
      effectVerifier: matchingEffectVerifier(clock.now),
    });
    const takeover = second.claimEffectCommit({
      commandId: command.id,
      workerId: "commit-worker-takeover",
      claimTtlMilliseconds: 1_000,
    });
    expect(takeover.fencingEpoch).toBe(
      staleClaim.fencingEpoch + 1,
    );

    await expect(
      first.verifyAndCommit({
        claim: staleClaim,
      }),
    ).rejects.toThrow(
      expect.objectContaining<Partial<StaleWorkerClaimError>>({
        code: "STALE_WORKER_CLAIM",
      }),
    );
    await expect(
      second.verifyAndCommit({
        claim: takeover,
      }),
    ).resolves.toMatchObject({ commandId: command.id });
    first.close();
    second.close();
  });

  it("records executor rejection as outcome unknown and never redispatches", async () => {
    const executor = legacyCanvasFixtureExecutor({
      calls: 0,
      execute: async () => {
        executor.calls += 1;
        throw new Error("adapter acknowledgement lost");
      },
    });
    const runtime = new DurableRuntime({
      databasePath: newDatabasePath(),
      clock: new MutableClock().now,
      effectExecutor: executor,
    });
    const command = durableCommand({
      id: sortableId("cmd", "G"),
      idempotencyKey: sortableId("idem", "G"),
      authority: {
        capabilityGrantId: sortableId("grt", "G"),
        approvalReceiptId: sortableId("apr", "G"),
        leaseId: alternateLeaseId("G"),
        fencingEpoch: 1,
      },
    });
    authorizeAndLease(runtime, command);
    runtime.submitCommand(
      commandSubmission(command, alternateOutboxId("G")),
    );

    await expect(
      runtime.applyNextEffect({
        workerId: "worker-ambiguous",
        claimTtlMilliseconds: 1_000,
      }),
    ).rejects.toThrow("adapter acknowledgement lost");
    expect(executor.calls).toBe(1);
    expect(runtime.getOutboxForCommand(command.id)).toMatchObject({
      phase: "failed",
      error: {
        code: "OUTCOME_UNKNOWN",
        retryable: false,
      },
    });
    expect(runtime.getRecoveryDecision(command.id)).toMatchObject({
      decision: "block-outcome-unknown",
    });
    expect(
      await runtime.applyNextEffect({
        workerId: "worker-must-not-retry",
        claimTtlMilliseconds: 1_000,
      }),
    ).toBeNull();
    expect(executor.calls).toBe(1);
    runtime.close();
  });

  it("records an explicit negative acknowledgement as definitely not applied", async () => {
    const runtime = new DurableRuntime({
      databasePath: newDatabasePath(),
      clock: new MutableClock().now,
      effectExecutor: legacyCanvasFixtureExecutor({
        execute: async () => ({
          status: "definitely-not-applied",
          error: {
            code: "ADAPTER_REJECTED_BEFORE_DISPATCH",
            message: "Adapter rejected before dispatch.",
          },
        }),
      }),
    });
    const command = durableCommand({
      id: sortableId("cmd", "J"),
      idempotencyKey: sortableId("idem", "J"),
      authority: {
        capabilityGrantId: sortableId("grt", "J"),
        approvalReceiptId: sortableId("apr", "J"),
        leaseId: alternateLeaseId("J"),
        fencingEpoch: 1,
      },
    });
    authorizeAndLease(runtime, command);
    runtime.submitCommand(
      commandSubmission(command, alternateOutboxId("J")),
    );

    await expect(
      runtime.applyNextEffect({
        workerId: "worker-negative-ack",
        claimTtlMilliseconds: 1_000,
      }),
    ).rejects.toThrow("Adapter rejected before dispatch.");
    expect(runtime.getOutboxForCommand(command.id)).toMatchObject({
      phase: "failed",
      error: {
        code: "EFFECT_NOT_APPLIED",
        retryable: false,
      },
    });
    expect(runtime.getRecoveryDecision(command.id)).toBeUndefined();
    runtime.close();
  });
});
