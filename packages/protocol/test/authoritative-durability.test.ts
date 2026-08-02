import { describe, expect, it } from "vitest";

import {
  ApprovalReceiptSchema,
  ApprovalUseSchema,
  CapabilityGrantUseSchema,
  CrashRecoveryDecisionSchema,
  DurableCommandSchema,
  DurableRunStateSchema,
  DurableRunStateTransitionSchema,
  LeaseUseSchema,
  OutboxRecordSchema,
  OutboxTransitionSchema,
} from "../src/index.js";
import { hash, ids, nextHash, timestamp } from "./fixtures.js";

const command = {
  schemaVersion: 1,
  id: "cmd_01J00000000000000000000000",
  projectId: ids.project,
  taskId: ids.task,
  runId: ids.run,
  issuerId: "local-codex",
  kind: "sandbox.process",
  target: {
    kind: "process-request",
    id: "prq_01J00000000000000000000000",
    expectedBeforeHash: hash,
    baseline: {
      kind: "content-hash",
      value: hash,
    },
  },
  payloadHash: nextHash,
  idempotencyKey: "idem_01J00000000000000000000000",
  actionDigest: hash,
  requiredCapabilities: ["process:start"],
  authority: {
    capabilityGrantId: ids.capabilityGrant,
    approvalReceiptId: "apr_01J00000000000000000000000",
    leaseId: ids.lease,
    fencingEpoch: 3,
  },
  issuedAt: timestamp,
} as const;

const outboxIntent = {
  schemaVersion: 1,
  id: ids.outbox,
  commandId: command.id,
  projectId: ids.project,
  idempotencyKey: command.idempotencyKey,
  actionDigest: command.actionDigest,
  phase: "intent",
  effect: {
    kind: "sandbox.process",
    targetId: command.target.id,
    expectedBeforeHash: hash,
    payloadHash: nextHash,
  },
  createdAt: timestamp,
} as const;

describe("DurableCommand", () => {
  it("requires one immutable action digest, exact target hash, and fenced authority", () => {
    expect(DurableCommandSchema.parse(command)).toEqual(command);
    expect(
      DurableCommandSchema.safeParse({
        ...command,
        actionDigest: "not-a-content-hash",
      }).success,
    ).toBe(false);
    expect(
      DurableCommandSchema.safeParse({
        ...command,
        authority: { ...command.authority, fencingEpoch: 0 },
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate capabilities and unknown command kinds", () => {
    expect(
      DurableCommandSchema.safeParse({
        ...command,
        requiredCapabilities: ["process:start", "process:start"],
      }).success,
    ).toBe(false);
    expect(
      DurableCommandSchema.safeParse({
        ...command,
        kind: "shell.arbitrary",
      }).success,
    ).toBe(false);
  });
});

describe("Outbox state machine", () => {
  const effectApplied = {
    ...outboxIntent,
    phase: "effect-applied",
    appliedAt: "2026-07-28T12:00:01.000Z",
    resultingHash: nextHash,
  } as const;
  const committed = {
    ...outboxIntent,
    phase: "committed",
    appliedAt: effectApplied.appliedAt,
    resultingHash: nextHash,
    committedAt: "2026-07-28T12:00:02.000Z",
    traceEventId: ids.traceEvent,
  } as const;

  it("accepts intent to effect-applied to committed with invariant action identity", () => {
    expect(
      OutboxTransitionSchema.parse({
        from: outboxIntent,
        to: effectApplied,
      }).to,
    ).toEqual(effectApplied);
    expect(
      OutboxTransitionSchema.parse({
        from: effectApplied,
        to: committed,
      }).to,
    ).toEqual(committed);
  });

  it("rejects skipped commits and action-digest substitution", () => {
    expect(
      OutboxTransitionSchema.safeParse({
        from: outboxIntent,
        to: committed,
      }).success,
    ).toBe(false);
    expect(
      OutboxTransitionSchema.safeParse({
        from: outboxIntent,
        to: { ...effectApplied, actionDigest: nextHash },
      }).success,
    ).toBe(false);
  });

  it("binds failure evidence to the phase that failed", () => {
    const failed = {
      ...outboxIntent,
      phase: "failed",
      failedFrom: "intent",
      failedAt: "2026-07-28T12:00:01.000Z",
      error: {
        code: "SANDBOX_PROVIDER_UNAVAILABLE",
        message: "No enforcing provider is available.",
        retryable: false,
      },
    } as const;

    expect(
      OutboxTransitionSchema.parse({ from: outboxIntent, to: failed }).to,
    ).toEqual(failed);
    expect(
      OutboxTransitionSchema.safeParse({
        from: effectApplied,
        to: failed,
      }).success,
    ).toBe(false);
  });

  it("allows only exact idempotent repeats of the same phase", () => {
    expect(
      OutboxTransitionSchema.safeParse({
        from: outboxIntent,
        to: outboxIntent,
      }).success,
    ).toBe(true);
    expect(
      OutboxTransitionSchema.safeParse({
        from: outboxIntent,
        to: { ...outboxIntent, actionDigest: nextHash },
      }).success,
    ).toBe(false);
  });

  it("requires command identity and payload digest on every durable phase", () => {
    expect(OutboxRecordSchema.parse(outboxIntent)).toEqual(outboxIntent);
    const { actionDigest: _actionDigest, ...withoutDigest } = outboxIntent;
    expect(OutboxRecordSchema.safeParse(withoutDigest).success).toBe(false);
  });
});

describe("approval and lease authority", () => {
  const approvalReceipt = {
    schemaVersion: 1,
    id: "apr_01J00000000000000000000000",
    projectId: ids.project,
    approver: { kind: "human", id: "local-user" },
    target: command.target,
    actionDigest: command.actionDigest,
    capabilities: command.requiredCapabilities,
    consequence:
      "Runs the approved Node process inside the selected isolated worktree.",
    issuedAt: "2026-07-28T11:59:00.000Z",
    expiresAt: "2026-07-28T12:05:00.000Z",
    maximumUses: 1,
  } as const;
  const lease = {
    schemaVersion: 1,
    id: ids.lease,
    projectId: ids.project,
    targetId: command.target.id,
    holderId: command.issuerId,
    fencingEpoch: command.authority.fencingEpoch,
    acquiredAt: "2026-07-28T11:59:00.000Z",
    expiresAt: "2026-07-28T12:05:00.000Z",
  } as const;

  it("binds approval use to the exact command target, hash, capabilities, and use limit", () => {
    expect(ApprovalReceiptSchema.parse(approvalReceipt)).toEqual(
      approvalReceipt,
    );
    expect(
      ApprovalUseSchema.parse({
        command,
        receipt: approvalReceipt,
        useNumber: 1,
        usedAt: timestamp,
      }).receipt,
    ).toEqual(approvalReceipt);

    for (const receipt of [
      {
        ...approvalReceipt,
        id: "apr_01J00000000000000000000001",
      },
      {
        ...approvalReceipt,
        projectId: "prj_01J00000000000000000000001",
      },
      {
        ...approvalReceipt,
        target: {
          ...approvalReceipt.target,
          id: "prq_01J00000000000000000000001",
        },
      },
      {
        ...approvalReceipt,
        target: { ...approvalReceipt.target, expectedBeforeHash: nextHash },
      },
      {
        ...approvalReceipt,
        target: {
          ...approvalReceipt.target,
          baseline: {
            ...approvalReceipt.target.baseline,
            value: nextHash,
          },
        },
      },
      { ...approvalReceipt, actionDigest: nextHash },
      { ...approvalReceipt, capabilities: ["source:apply"] },
    ]) {
      expect(
        ApprovalUseSchema.safeParse({
          command,
          receipt,
          useNumber: 1,
          usedAt: timestamp,
        }).success,
      ).toBe(false);
    }
  });

  it("requires a plain-language consequence and explicit target baseline", () => {
    expect(
      ApprovalReceiptSchema.safeParse({
        ...approvalReceipt,
        consequence: "",
      }).success,
    ).toBe(false);
    expect(
      ApprovalReceiptSchema.safeParse({
        ...approvalReceipt,
        target: {
          kind: approvalReceipt.target.kind,
          id: approvalReceipt.target.id,
          expectedBeforeHash: approvalReceipt.target.expectedBeforeHash,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects expired approvals and uses beyond the receipt maximum", () => {
    expect(
      ApprovalUseSchema.safeParse({
        command,
        receipt: approvalReceipt,
        useNumber: 2,
        usedAt: timestamp,
      }).success,
    ).toBe(false);
    expect(
      ApprovalUseSchema.safeParse({
        command,
        receipt: approvalReceipt,
        useNumber: 1,
        usedAt: "2026-07-28T12:05:00.001Z",
      }).success,
    ).toBe(false);
  });

  it("requires the command holder, target, epoch, and use time to match its lease", () => {
    expect(
      LeaseUseSchema.parse({ command, lease, usedAt: timestamp }).lease,
    ).toEqual(lease);
    expect(
      LeaseUseSchema.safeParse({
        command,
        lease: { ...lease, fencingEpoch: lease.fencingEpoch - 1 },
        usedAt: timestamp,
      }).success,
    ).toBe(false);
    expect(
      LeaseUseSchema.safeParse({
        command,
        lease,
        usedAt: "2026-07-28T12:05:00.001Z",
      }).success,
    ).toBe(false);
  });

  it("consumes capability grant uses durably against the exact command digest", () => {
    const grant = {
      schemaVersion: 1,
      id: ids.capabilityGrant,
      projectId: ids.project,
      clientId: command.issuerId,
      capabilities: command.requiredCapabilities,
      constraints: {
        canonicalPaths: ["/workspace/worktree"],
        allowedHosts: [],
        actionDigest: command.actionDigest,
        maximumUses: 1,
      },
      issuedAt: "2026-07-28T11:59:00.000Z",
      expiresAt: "2026-07-28T12:05:00.000Z",
    } as const;

    expect(
      CapabilityGrantUseSchema.safeParse({
        command,
        grant,
        useNumber: 1,
        usedAt: timestamp,
      }).success,
    ).toBe(true);
    expect(
      CapabilityGrantUseSchema.safeParse({
        command,
        grant: {
          ...grant,
          constraints: {
            ...grant.constraints,
            actionDigest: nextHash,
          },
        },
        useNumber: 1,
        usedAt: timestamp,
      }).success,
    ).toBe(false);
    expect(
      CapabilityGrantUseSchema.safeParse({
        command,
        grant,
        useNumber: 2,
        usedAt: timestamp,
      }).success,
    ).toBe(false);
  });
});

describe("durable run state machine", () => {
  const queued = {
    schemaVersion: 1,
    projectId: ids.project,
    taskId: ids.task,
    runId: ids.run,
    revision: 1,
    state: "queued",
    harness: null,
    requiredCapabilities: command.requiredCapabilities,
    updatedAt: timestamp,
  } as const;
  const running = {
    ...queued,
    revision: 2,
    state: "running",
    harness: {
      harnessId: "fake-harness",
      modelId: "deterministic-v1",
    },
    startedAt: "2026-07-28T12:00:01.000Z",
    activeCommandId: command.id,
    updatedAt: "2026-07-28T12:00:01.000Z",
  } as const;
  const succeeded = {
    ...queued,
    revision: 3,
    state: "succeeded",
    harness: running.harness,
    completedAt: "2026-07-28T12:00:02.000Z",
    resultHash: nextHash,
    updatedAt: "2026-07-28T12:00:02.000Z",
  } as const;

  it("accepts queued to running to a terminal state with monotonic revisions", () => {
    expect(DurableRunStateSchema.parse(queued)).toEqual(queued);
    expect(
      DurableRunStateTransitionSchema.safeParse({
        from: queued,
        to: running,
      }).success,
    ).toBe(true);
    expect(
      DurableRunStateTransitionSchema.safeParse({
        from: running,
        to: succeeded,
      }).success,
    ).toBe(true);
  });

  it("rejects skipped revisions, identity changes, and terminal resurrection", () => {
    expect(
      DurableRunStateTransitionSchema.safeParse({
        from: queued,
        to: { ...running, revision: 3 },
      }).success,
    ).toBe(false);
    expect(
      DurableRunStateTransitionSchema.safeParse({
        from: queued,
        to: { ...running, projectId: "prj_01J00000000000000000000001" },
      }).success,
    ).toBe(false);
    expect(
      DurableRunStateTransitionSchema.safeParse({
        from: queued,
        to: {
          ...running,
          requiredCapabilities: ["external:publish"],
        },
      }).success,
    ).toBe(false);
    expect(
      DurableRunStateTransitionSchema.safeParse({
        from: succeeded,
        to: { ...running, revision: 4 },
      }).success,
    ).toBe(false);
  });

  it("preserves non-null harness attribution after dispatch", () => {
    expect(
      DurableRunStateTransitionSchema.safeParse({
        from: running,
        to: {
          ...succeeded,
          harness: {
            harnessId: "different-harness",
            modelId: "different-model",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      DurableRunStateTransitionSchema.safeParse({
        from: running,
        to: { ...succeeded, harness: null },
      }).success,
    ).toBe(false);
  });
});

describe("crash recovery decisions", () => {
  const base = {
    schemaVersion: 1,
    id: ids.recoveryAttempt,
    projectId: ids.project,
    commandId: command.id,
    outboxId: ids.outbox,
    checkpointId: ids.checkpoint,
    decidedAt: timestamp,
  } as const;

  it("retries an intent only for a proven-idempotent effect with probe evidence", () => {
    expect(
      CrashRecoveryDecisionSchema.safeParse({
        ...base,
        observedPhase: "intent",
        decision: "retry-idempotent-effect",
        effectKind: "canvas.operation",
        retryClass: "proven-idempotent",
        expectedBeforeHash: hash,
        observedTargetHash: hash,
        probe: {
          kind: "target-state-hash",
          checkedAt: timestamp,
          evidenceHash: nextHash,
        },
      }).success,
    ).toBe(true);
    expect(
      CrashRecoveryDecisionSchema.safeParse({
        ...base,
        observedPhase: "intent",
        decision: "retry-idempotent-effect",
        effectKind: "canvas.operation",
        retryClass: "proven-idempotent",
        expectedBeforeHash: hash,
        observedTargetHash: nextHash,
        probe: {
          kind: "target-state-hash",
          checkedAt: timestamp,
          evidenceHash: nextHash,
        },
      }).success,
    ).toBe(false);
  });

  it("blocks outcome-unknown process effects even when the target hash is unchanged", () => {
    expect(
      CrashRecoveryDecisionSchema.safeParse({
        ...base,
        observedPhase: "intent",
        decision: "retry-idempotent-effect",
        effectKind: "sandbox.process",
        retryClass: "proven-idempotent",
        expectedBeforeHash: hash,
        observedTargetHash: hash,
        probe: {
          kind: "target-state-hash",
          checkedAt: timestamp,
          evidenceHash: nextHash,
        },
      }).success,
    ).toBe(false);
    expect(
      CrashRecoveryDecisionSchema.safeParse({
        ...base,
        observedPhase: "intent",
        decision: "block-outcome-unknown",
        effectKind: "sandbox.process",
        reason:
          "A process may have produced effects not observable through the target hash.",
      }).success,
    ).toBe(true);
  });

  it("finalizes effect-applied only when target verification matches the result", () => {
    expect(
      CrashRecoveryDecisionSchema.safeParse({
        ...base,
        observedPhase: "effect-applied",
        decision: "commit-durable-evidence",
        resultingHash: nextHash,
        observedTargetHash: nextHash,
      }).success,
    ).toBe(true);
    expect(
      CrashRecoveryDecisionSchema.safeParse({
        ...base,
        observedPhase: "effect-applied",
        decision: "commit-durable-evidence",
        resultingHash: nextHash,
        observedTargetHash: hash,
      }).success,
    ).toBe(false);
  });

  it("never reapplies terminal committed or failed effects", () => {
    expect(
      CrashRecoveryDecisionSchema.safeParse({
        ...base,
        observedPhase: "committed",
        decision: "replay-without-effect",
        resultingHash: nextHash,
        traceEventId: ids.traceEvent,
      }).success,
    ).toBe(true);
    expect(
      CrashRecoveryDecisionSchema.safeParse({
        ...base,
        observedPhase: "failed",
        decision: "preserve-failure",
        errorCode: "SANDBOX_PROVIDER_UNAVAILABLE",
      }).success,
    ).toBe(true);
    expect(
      CrashRecoveryDecisionSchema.safeParse({
        ...base,
        observedPhase: "committed",
        decision: "retry-idempotent-effect",
        effectKind: "canvas.operation",
        retryClass: "proven-idempotent",
        expectedBeforeHash: hash,
        observedTargetHash: hash,
        probe: {
          kind: "target-state-hash",
          checkedAt: timestamp,
          evidenceHash: nextHash,
        },
      }).success,
    ).toBe(false);
  });
});
