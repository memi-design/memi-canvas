import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  AuthorizationError,
  DurableRuntime,
  StaleLeaseError,
} from "./index.js";
import {
  MutableClock,
  RecordingEffectExecutor,
  alternateLeaseId,
  alternateOutboxId,
  approvalFor,
  commandSubmission,
  contentHash,
  durableCommand,
  grantFor,
  sortableId,
} from "./test-fixtures.js";

const temporaryDirectories: string[] = [];

function runtimeFixture() {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-runtime-grant-"),
  );
  temporaryDirectories.push(directory);
  const clock = new MutableClock();
  const executor = new RecordingEffectExecutor();
  const databasePath = join(directory, "runtime.sqlite");
  const runtime = new DurableRuntime({
    databasePath,
    clock: clock.now,
    effectExecutor: executor,
  });

  return { clock, databasePath, executor, runtime };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("capability grant enforcement", () => {
  it("rejects missing, expired, mismatched, and exhausted grants", () => {
    const command = durableCommand();

    const missing = runtimeFixture();
    missing.runtime.registerApprovalReceipt(approvalFor(command));
    expect(() =>
      missing.runtime.submitCommand(commandSubmission(command)),
    ).toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "GRANT_NOT_FOUND",
      }),
    );
    missing.runtime.close();

    const expired = runtimeFixture();
    expired.runtime.registerGrant(
      grantFor(command, {
        issuedAt: "2026-07-28T10:00:00.000Z",
        expiresAt: "2026-07-28T11:00:00.000Z",
      }),
    );
    expired.runtime.registerApprovalReceipt(approvalFor(command));
    expect(() =>
      expired.runtime.submitCommand(commandSubmission(command)),
    ).toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "GRANT_EXPIRED",
      }),
    );
    expired.runtime.close();

    const capability = runtimeFixture();
    capability.runtime.registerGrant(
      grantFor(command, {
        capabilities: ["canvas:read"],
      }),
    );
    capability.runtime.registerApprovalReceipt(approvalFor(command));
    expect(() =>
      capability.runtime.submitCommand(commandSubmission(command)),
    ).toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "CAPABILITY_NOT_GRANTED",
      }),
    );
    capability.runtime.close();

    const digest = runtimeFixture();
    digest.runtime.registerGrant(
      grantFor(command, {
        actionDigest: contentHash("f"),
      }),
    );
    digest.runtime.registerApprovalReceipt(approvalFor(command));
    expect(() =>
      digest.runtime.submitCommand(commandSubmission(command)),
    ).toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "ACTION_DIGEST_NOT_GRANTED",
      }),
    );
    digest.runtime.close();

    const exhausted = runtimeFixture();
    exhausted.runtime.registerGrant(
      grantFor(command, { maximumUses: 1 }),
    );
    exhausted.runtime.registerApprovalReceipt(approvalFor(command));
    exhausted.runtime.submitCommand(commandSubmission(command));
    const second = durableCommand({
      id: sortableId("cmd", "6"),
      idempotencyKey: sortableId("idem", "6"),
    });
    expect(() =>
      exhausted.runtime.submitCommand(
        commandSubmission(second, alternateOutboxId("6")),
      ),
    ).toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "GRANT_EXHAUSTED",
      }),
    );
    exhausted.runtime.close();
  });
});

describe("immutable approval receipt enforcement", () => {
  it("allows exact replay but rejects replacement of a recorded receipt", () => {
    const { runtime } = runtimeFixture();
    const command = durableCommand();
    const receipt = approvalFor(command);

    expect(runtime.registerApprovalReceipt(receipt)).toEqual(receipt);
    expect(runtime.registerApprovalReceipt(receipt)).toEqual(receipt);
    expect(() =>
      runtime.registerApprovalReceipt(
        approvalFor(command, {
          actionDigest: contentHash("f"),
        }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "APPROVAL_IMMUTABLE_CONFLICT",
      }),
    );
    runtime.close();
  });

  it("rejects missing, mismatched, expired, and exhausted receipts", () => {
    const command = durableCommand();

    const missing = runtimeFixture();
    missing.runtime.registerGrant(grantFor(command));
    expect(() =>
      missing.runtime.submitCommand(commandSubmission(command)),
    ).toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "APPROVAL_NOT_FOUND",
      }),
    );
    missing.runtime.close();

    const mismatched = runtimeFixture();
    mismatched.runtime.registerGrant(grantFor(command));
    mismatched.runtime.registerApprovalReceipt(
      approvalFor(command, {
        target: {
          ...command.target,
          expectedBeforeHash: contentHash("f"),
        },
      }),
    );
    expect(() =>
      mismatched.runtime.submitCommand(commandSubmission(command)),
    ).toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "APPROVAL_BINDING_MISMATCH",
      }),
    );
    mismatched.runtime.close();

    const expired = runtimeFixture();
    expired.runtime.registerGrant(grantFor(command));
    expired.runtime.registerApprovalReceipt(
      approvalFor(command, {
        issuedAt: "2026-07-28T10:00:00.000Z",
        expiresAt: "2026-07-28T11:00:00.000Z",
      }),
    );
    expect(() =>
      expired.runtime.submitCommand(commandSubmission(command)),
    ).toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "APPROVAL_EXPIRED",
      }),
    );
    expired.runtime.close();

    const exhausted = runtimeFixture();
    exhausted.runtime.registerGrant(grantFor(command));
    exhausted.runtime.registerApprovalReceipt(
      approvalFor(command, { maximumUses: 1 }),
    );
    exhausted.runtime.submitCommand(commandSubmission(command));
    const second = durableCommand({
      id: sortableId("cmd", "7"),
      idempotencyKey: sortableId("idem", "7"),
    });
    expect(() =>
      exhausted.runtime.submitCommand(
        commandSubmission(second, alternateOutboxId("7")),
      ),
    ).toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "APPROVAL_EXHAUSTED",
      }),
    );
    exhausted.runtime.close();
  });
});

describe("effect-bound authority revalidation", () => {
  it("dispatches no effect when reserved grant expires", async () => {
    const { clock, executor, runtime } = runtimeFixture();
    const command = durableCommand();
    runtime.registerGrant(
      grantFor(command, {
        expiresAt: "2026-07-28T12:00:00.500Z",
      }),
    );
    runtime.registerApprovalReceipt(approvalFor(command));
    runtime.acquireLease({
      leaseId: command.authority.leaseId,
      projectId: command.projectId,
      targetId: command.target.id,
      holderId: command.issuerId,
      ttlMilliseconds: 5_000,
    });
    runtime.submitCommand(commandSubmission(command));

    clock.advance(501);
    await expect(
      runtime.applyNextEffect({
        workerId: "worker-expired-grant",
        claimTtlMilliseconds: 1_000,
      }),
    ).rejects.toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "GRANT_EXPIRED_AT_EFFECT",
      }),
    );
    expect(executor.calls).toHaveLength(0);
    expect(runtime.getOutboxForCommand(command.id)?.phase).toBe(
      "failed",
    );
    expect(
      runtime.getGrantUsage(command.authority.capabilityGrantId),
    ).toBe(1);
    runtime.close();
  });

  it("dispatches no effect when reserved approval expires", async () => {
    const { clock, executor, runtime } = runtimeFixture();
    const command = durableCommand();
    runtime.registerGrant(grantFor(command));
    runtime.registerApprovalReceipt(
      approvalFor(command, {
        expiresAt: "2026-07-28T12:00:00.500Z",
      }),
    );
    runtime.acquireLease({
      leaseId: command.authority.leaseId,
      projectId: command.projectId,
      targetId: command.target.id,
      holderId: command.issuerId,
      ttlMilliseconds: 5_000,
    });
    runtime.submitCommand(commandSubmission(command));

    clock.advance(501);
    await expect(
      runtime.applyNextEffect({
        workerId: "worker-expired-approval",
        claimTtlMilliseconds: 1_000,
      }),
    ).rejects.toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "APPROVAL_EXPIRED_AT_EFFECT",
      }),
    );
    expect(executor.calls).toHaveLength(0);
    expect(
      runtime.getApprovalUsage(
        command.authority.approvalReceiptId,
      ),
    ).toBe(1);
    runtime.close();
  });

  it("requires the exact active lease and fencing epoch at dispatch", async () => {
    const missing = runtimeFixture();
    const command = durableCommand();
    missing.runtime.registerGrant(grantFor(command));
    missing.runtime.registerApprovalReceipt(approvalFor(command));
    missing.runtime.submitCommand(commandSubmission(command));

    await expect(
      missing.runtime.applyNextEffect({
        workerId: "worker-missing-lease",
        claimTtlMilliseconds: 1_000,
      }),
    ).rejects.toThrow(
      expect.objectContaining<Partial<StaleLeaseError>>({
        code: "LEASE_NOT_ACTIVE",
      }),
    );
    expect(missing.executor.calls).toHaveLength(0);
    missing.runtime.close();

    const stale = runtimeFixture();
    stale.runtime.registerGrant(grantFor(command));
    stale.runtime.registerApprovalReceipt(approvalFor(command));
    stale.runtime.acquireLease({
      leaseId: command.authority.leaseId,
      projectId: command.projectId,
      targetId: command.target.id,
      holderId: command.issuerId,
      ttlMilliseconds: 1_000,
    });
    stale.runtime.submitCommand(commandSubmission(command));
    stale.clock.advance(1_001);
    stale.runtime.acquireLease({
      leaseId: alternateLeaseId("8"),
      projectId: command.projectId,
      targetId: command.target.id,
      holderId: "replacement-agent",
      ttlMilliseconds: 1_000,
    });

    await expect(
      stale.runtime.applyNextEffect({
        workerId: "worker-stale-lease",
        claimTtlMilliseconds: 1_000,
      }),
    ).rejects.toThrow(
      expect.objectContaining<Partial<StaleLeaseError>>({
        code: "STALE_FENCE",
      }),
    );
    expect(stale.executor.calls).toHaveLength(0);
    stale.runtime.close();
  });
});

describe("typed grant policy enforcement", () => {
  it("does not let an allow-all validator promote a blocked effect kind", () => {
    const command = durableCommand({
      id: sortableId("cmd", "C"),
      kind: "sandbox.process",
      target: {
        kind: "process-request",
        id: sortableId("prq", "C"),
        expectedBeforeHash: contentHash("a"),
        baseline: {
          kind: "content-hash",
          value: contentHash("a"),
        },
      },
      idempotencyKey: sortableId("idem", "C"),
      requiredCapabilities: ["process:start", "network:access"],
      authority: {
        capabilityGrantId: sortableId("grt", "C"),
        approvalReceiptId: sortableId("apr", "C"),
        leaseId: alternateLeaseId("C"),
        fencingEpoch: 1,
      },
    });
    const directory = mkdtempSync(
      join(tmpdir(), "memi-runtime-policy-"),
    );
    temporaryDirectories.push(directory);
    const validations: unknown[] = [];
    const allowed = new DurableRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      clock: new MutableClock().now,
      effectExecutor: new RecordingEffectExecutor(),
      policyValidator: {
        validate: (request: unknown) => {
          validations.push(request);
        },
      },
    });
    allowed.registerGrant(
      grantFor(command, {
        canonicalPaths: ["/workspace"],
      }),
    );
    allowed.registerApprovalReceipt(approvalFor(command));
    expect(() =>
      allowed.submitCommand(
        commandSubmission(command, alternateOutboxId("C")),
      ),
    ).toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "EFFECT_CLASS_BLOCKED",
      }),
    );
    expect(validations).toHaveLength(0);
    expect(
      allowed.getGrantUsage(command.authority.capabilityGrantId),
    ).toBe(0);
    expect(
      allowed.getApprovalUsage(command.authority.approvalReceiptId),
    ).toBe(0);
    expect(allowed.getCommand(command.id)).toBeUndefined();
    allowed.close();
  });

  it.each([
    [
      "E", "git.effect", "git:commit", "source-worktree",
      "worktree:policy-test",
    ],
    [
      "F", "external.publish", "external:publish",
      "external-publication",
      "publication:policy-test",
    ],
  ] as const)(
    "%s: blocks the %s effect kind before invoking policy",
    (suffix, kind, capability, targetKind, targetId) => {
      const command = durableCommand({
        id: sortableId("cmd", suffix),
        kind,
        target: {
          kind: targetKind,
          id: targetId,
          expectedBeforeHash: contentHash("a"),
          baseline: {
            kind: "content-hash",
            value: contentHash("a"),
          },
        },
        idempotencyKey: sortableId("idem", suffix),
        requiredCapabilities: [capability],
        authority: {
          capabilityGrantId: sortableId("grt", suffix),
          approvalReceiptId: sortableId("apr", suffix),
          leaseId: alternateLeaseId(suffix),
          fencingEpoch: 1,
        },
      });
      const directory = mkdtempSync(
        join(tmpdir(), "memi-runtime-policy-effect-"),
      );
      temporaryDirectories.push(directory);
      const validations: unknown[] = [];
      const runtime = new DurableRuntime({
        databasePath: join(directory, "runtime.sqlite"),
        clock: new MutableClock().now,
        effectExecutor: new RecordingEffectExecutor(),
        policyValidator: {
          validate: (request: unknown) => {
            validations.push(request);
          },
        },
      });
      runtime.registerGrant(
        grantFor(command, { canonicalPaths: ["/workspace"] }),
      );
      runtime.registerApprovalReceipt(approvalFor(command));

      expect(() =>
        runtime.submitCommand(commandSubmission(command)),
      ).toThrow(
        expect.objectContaining<Partial<AuthorizationError>>({
          code: "EFFECT_CLASS_BLOCKED",
        }),
      );
      expect(validations).toHaveLength(0);
      expect(
        runtime.getGrantUsage(command.authority.capabilityGrantId),
      ).toBe(0);
      expect(runtime.getCommand(command.id)).toBeUndefined();
      runtime.close();
    },
  );

  it("does not let an allow-all validator promote blocked capabilities", () => {
    const command = durableCommand({
      id: sortableId("cmd", "D"),
      idempotencyKey: sortableId("idem", "D"),
      requiredCapabilities: ["canvas:apply", "network:access"],
      authority: {
        capabilityGrantId: sortableId("grt", "D"),
        approvalReceiptId: sortableId("apr", "D"),
        leaseId: alternateLeaseId("D"),
        fencingEpoch: 1,
      },
    });
    const directory = mkdtempSync(
      join(tmpdir(), "memi-runtime-policy-capability-"),
    );
    temporaryDirectories.push(directory);
    const validations: unknown[] = [];
    const runtime = new DurableRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      clock: new MutableClock().now,
      effectExecutor: new RecordingEffectExecutor(),
      policyValidator: {
        validate: (request: unknown) => {
          validations.push(request);
        },
      },
    });
    runtime.registerGrant(grantFor(command));
    runtime.registerApprovalReceipt(approvalFor(command));

    expect(() =>
      runtime.submitCommand(
        commandSubmission(command, alternateOutboxId("D")),
      ),
    ).toThrow(
      expect.objectContaining<Partial<AuthorizationError>>({
        code: "EFFECT_CLASS_BLOCKED",
      }),
    );
    expect(validations).toHaveLength(0);
    expect(
      runtime.getGrantUsage(command.authority.capabilityGrantId),
    ).toBe(0);
    expect(
      runtime.getApprovalUsage(command.authority.approvalReceiptId),
    ).toBe(0);
    expect(runtime.getCommand(command.id)).toBeUndefined();
    runtime.close();
  });

  it.each([
    ["G", "source:read"],
    ["H", "source:propose"],
    ["J", "source:apply"],
    ["K", "process:start"],
    ["M", "git:commit"],
    ["N", "git:push"],
    ["P", "external:publish"],
  ] as const)(
    "%s: blocks the %s capability before invoking policy",
    (suffix, capability) => {
      const command = durableCommand({
        id: sortableId("cmd", suffix),
        idempotencyKey: sortableId("idem", suffix),
        requiredCapabilities: ["canvas:apply", capability],
        authority: {
          capabilityGrantId: sortableId("grt", suffix),
          approvalReceiptId: sortableId("apr", suffix),
          leaseId: alternateLeaseId(suffix),
          fencingEpoch: 1,
        },
      });
      const directory = mkdtempSync(
        join(tmpdir(), "memi-runtime-policy-capability-"),
      );
      temporaryDirectories.push(directory);
      const validations: unknown[] = [];
      const runtime = new DurableRuntime({
        databasePath: join(directory, "runtime.sqlite"),
        clock: new MutableClock().now,
        effectExecutor: new RecordingEffectExecutor(),
        policyValidator: {
          validate: (request: unknown) => {
            validations.push(request);
          },
        },
      });
      runtime.registerGrant(
        grantFor(command, { canonicalPaths: ["/workspace"] }),
      );
      runtime.registerApprovalReceipt(approvalFor(command));

      expect(() =>
        runtime.submitCommand(commandSubmission(command)),
      ).toThrow(
        expect.objectContaining<Partial<AuthorizationError>>({
          code: "EFFECT_CLASS_BLOCKED",
        }),
      );
      expect(validations).toHaveLength(0);
      expect(
        runtime.getGrantUsage(command.authority.capabilityGrantId),
      ).toBe(0);
      expect(runtime.getCommand(command.id)).toBeUndefined();
      runtime.close();
    },
  );

  it("keeps artifact persistence eligible in M0", () => {
    const command = durableCommand({
      id: sortableId("cmd", "Q"),
      kind: "artifact.persist",
      target: {
        kind: "artifact",
        id: "artifact:design-system",
        expectedBeforeHash: contentHash("a"),
        baseline: {
          kind: "content-hash",
          value: contentHash("a"),
        },
      },
      idempotencyKey: sortableId("idem", "Q"),
      authority: {
        capabilityGrantId: sortableId("grt", "Q"),
        approvalReceiptId: sortableId("apr", "Q"),
        leaseId: alternateLeaseId("Q"),
        fencingEpoch: 1,
      },
    });
    const fixture = runtimeFixture();
    fixture.runtime.registerGrant(grantFor(command));
    fixture.runtime.registerApprovalReceipt(approvalFor(command));

    expect(
      fixture.runtime.submitCommand(commandSubmission(command)),
    ).toMatchObject({
      commandId: command.id,
      state: "intent",
    });
    fixture.runtime.close();
  });

  it("does not claim or execute fresh artifact persistence without target authority", async () => {
    const command = durableCommand({
      id: sortableId("cmd", "R"),
      kind: "artifact.persist",
      target: {
        kind: "artifact",
        id: "artifact:fresh-design-system",
        expectedBeforeHash: contentHash("a"),
        baseline: {
          kind: "content-hash",
          value: contentHash("a"),
        },
      },
      idempotencyKey: sortableId("idem", "R"),
      authority: {
        capabilityGrantId: sortableId("grt", "R"),
        approvalReceiptId: sortableId("apr", "R"),
        leaseId: alternateLeaseId("R"),
        fencingEpoch: 1,
      },
    });
    const fixture = runtimeFixture();
    fixture.runtime.registerGrant(grantFor(command));
    fixture.runtime.registerApprovalReceipt(approvalFor(command));
    fixture.runtime.submitCommand(commandSubmission(command));
    expect(fixture.runtime.recover()).toEqual({
      intentsAwaitingEffect: [],
      effectsAwaitingCommit: [],
      blockedOutcomeUnknown: [command.id],
    });

    await expect(
      fixture.runtime.applyNextEffect({
        workerId: "must-not-persist",
        claimTtlMilliseconds: 1_000,
      }),
    ).resolves.toBeNull();
    expect(fixture.executor.calls).toHaveLength(0);

    const database = new DatabaseSync(fixture.databasePath);
    const outbox = database
      .prepare(
        `SELECT phase, worker_id, claim_epoch
         FROM outbox WHERE command_id = ?`,
      )
      .get(command.id);
    const latch = database
      .prepare(
        `SELECT state FROM target_schedule_latches
         WHERE command_id = ?`,
      )
      .get(command.id);
    database.close();
    expect(outbox).toEqual({
      phase: "intent",
      worker_id: null,
      claim_epoch: 0,
    });
    expect(latch).toBeUndefined();
    fixture.runtime.close();
  });

  it("quarantines a prior artifact claim without retry or execution", async () => {
    const command = durableCommand({
      id: sortableId("cmd", "S"),
      kind: "artifact.persist",
      target: {
        kind: "artifact",
        id: "artifact:prior-active",
        expectedBeforeHash: contentHash("a"),
        baseline: {
          kind: "content-hash",
          value: contentHash("a"),
        },
      },
      idempotencyKey: sortableId("idem", "S"),
      authority: {
        capabilityGrantId: sortableId("grt", "S"),
        approvalReceiptId: sortableId("apr", "S"),
        leaseId: alternateLeaseId("S"),
        fencingEpoch: 1,
      },
    });
    const fixture = runtimeFixture();
    fixture.runtime.registerGrant(grantFor(command));
    fixture.runtime.registerApprovalReceipt(approvalFor(command));
    fixture.runtime.submitCommand(
      commandSubmission(command, alternateOutboxId("S")),
    );
    const outboxId = alternateOutboxId("S");
    const database = new DatabaseSync(fixture.databasePath);
    database
      .prepare(
        `UPDATE outbox
         SET worker_id = ?, claim_epoch = 7, claim_expires_at = ?
         WHERE command_id = ?`,
      )
      .run(
        "legacy-artifact-worker",
        "2026-07-28T11:59:59.000Z",
        command.id,
      );
    database
      .prepare(
        `INSERT INTO target_schedule_latches (
          project_id, target_kind, target_id, command_id, outbox_id,
          state, worker_claim_id, claim_epoch, acquired_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending-fence', ?, 7, ?, ?)`,
      )
      .run(
        command.projectId,
        command.target.kind,
        command.target.id,
        command.id,
        outboxId,
        `${outboxId}:7`,
        command.issuedAt,
        command.issuedAt,
      );
    database.close();

    await expect(
      fixture.runtime.applyNextEffect({
        workerId: "must-not-retry-artifact",
        claimTtlMilliseconds: 1_000,
      }),
    ).resolves.toBeNull();
    expect(fixture.executor.calls).toHaveLength(0);

    const inspected = new DatabaseSync(fixture.databasePath);
    const outbox = inspected
      .prepare(
        `SELECT phase, worker_id, claim_epoch, claim_expires_at
         FROM outbox WHERE command_id = ?`,
      )
      .get(command.id);
    const latch = inspected
      .prepare(
        `SELECT state, worker_claim_id, claim_epoch
         FROM target_schedule_latches WHERE command_id = ?`,
      )
      .get(command.id);
    inspected.close();
    expect(outbox).toEqual({
      phase: "intent",
      worker_id: "legacy-artifact-worker",
      claim_epoch: 7,
      claim_expires_at: "2026-07-28T11:59:59.000Z",
    });
    expect(latch).toEqual({
      state: "pending-fence",
      worker_claim_id: `${outboxId}:7`,
      claim_epoch: 7,
    });
    fixture.runtime.close();
  });
});
