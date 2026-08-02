import { hashCanonicalValue } from "@memi/canonical-json";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  CanvasOperationSchema,
  TargetApplyOutcomeSchema,
  TargetFenceActivationResultSchema,
  type CanvasOperation,
  type TargetApplyOutcome,
  type TargetEffectRequest,
  type TargetFenceActivationRequest,
  type TargetLookupRequest,
  type TargetLookupResult,
  type TargetVerificationRequest,
  type TargetVerificationResult,
} from "../../protocol/src/index.js";
import {
  lookupResultFor,
  receiptFor,
} from "./canvas-effect-test-fixtures.js";
import {
  bindCommandAction,
  DurableRuntime,
  type CanvasTargetAdapter,
} from "./index.js";
import {
  MutableClock,
  RecordingEffectExecutor,
  alternateOutboxId,
  approvalFor,
  grantFor,
} from "./test-fixtures.js";
import {
  TRUST_ROOT,
  activateLease,
  canvasCommandDraft,
  cleanupAuthorityFixtures,
  databasePath,
  finalCommand,
  reserveAuthority,
  runtime,
  signedIssuance,
} from "./trusted-command-authority-test-support.js";

afterEach(cleanupAuthorityFixtures);

const IMPORT_ACTOR_ID = "memi-import-pipeline";
const IMPORT_AUTHORITY_PRINCIPAL_ID = "import-runtime";

function operationWithActor(
  operation: CanvasOperation,
  actorId: string,
): CanvasOperation {
  const material = {
    schemaVersion: operation.schemaVersion,
    id: operation.id,
    documentId: operation.documentId,
    actorId,
    occurredAt: operation.occurredAt,
    type: operation.type,
    payload: operation.payload,
    expectedBeforeHash: operation.expectedBeforeHash,
  };
  return CanvasOperationSchema.parse({
    ...operation,
    actorId,
    actionDigest: hashCanonicalValue(material),
  });
}

function delegatedDraft(
  suffix: string,
  actorId = IMPORT_ACTOR_ID,
) {
  const base = canvasCommandDraft(suffix);
  const payload = operationWithActor(base.payload, actorId);
  return {
    payload,
    command: bindCommandAction(
      {
        ...base.command,
        issuerId: IMPORT_AUTHORITY_PRINCIPAL_ID,
      },
      payload,
    ),
  };
}

class DelegationTargetProbe implements CanvasTargetAdapter {
  readonly applyCalls: TargetEffectRequest[] = [];
  readonly lookupCalls: TargetLookupRequest[] = [];
  applyStatus: "applied" | "outcome-unknown" = "applied";
  lookupStatus: "not-found" | "unavailable" = "unavailable";

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
    if (this.applyStatus === "outcome-unknown") {
      return TargetApplyOutcomeSchema.parse({
        schemaVersion: 1,
        status: "outcome-unknown",
        error: {
          code: "ACKNOWLEDGEMENT_LOST",
          message: "Target acknowledgement was lost.",
        },
      });
    }
    return TargetApplyOutcomeSchema.parse({
      schemaVersion: 1,
      status: "applied",
      receipt: receiptFor(request),
    });
  }

  lookup(request: TargetLookupRequest): TargetLookupResult {
    this.lookupCalls.push(request);
    if (this.lookupStatus === "not-found") {
      return lookupResultFor(request, {
        status: "not-found",
        currentTargetHash: request.expectedBeforeHash,
      });
    }
    return lookupResultFor(request, {
      status: "unavailable",
      code: "TARGET_UNAVAILABLE",
      message: "No recovery result is configured.",
    });
  }

  verify(
    _request: TargetVerificationRequest,
  ): Promise<TargetVerificationResult> {
    throw new Error("Verification is outside this delegation slice.");
  }
}

function commandPersistenceCounts(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const count = (
      table:
        | "commands"
        | "outbox"
        | "target_schedule_latches",
    ) =>
      Number(
        (
          database
            .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
            .get() as { readonly count: number }
        ).count,
      );
    return {
      commands: count("commands"),
      outbox: count("outbox"),
      latches: count("target_schedule_latches"),
    };
  } finally {
    database.close();
  }
}

async function issuedDelegation(
  suffix: string,
  target: DelegationTargetProbe,
  actorId = IMPORT_ACTOR_ID,
) {
  const path = databasePath("memi-target-delegation-");
  const clock = new MutableClock();
  const draft = delegatedDraft(suffix, actorId);
  const instance = runtime(path, clock, [TRUST_ROOT], target);
  await activateLease(instance, draft.command);
  const reservation = await reserveAuthority(instance, draft);
  const command = finalCommand(draft, reservation);
  const issuance = signedIssuance(
    command,
    draft.payload,
    reservation,
  );
  const issued =
    await instance.issueTrustedCommandAuthority(issuance);
  return {
    clock,
    command,
    draft,
    instance,
    issuance,
    issued,
    outboxId: alternateOutboxId(suffix),
    path,
    reservation,
  };
}

describe("runtime-owned trusted import identity delegation", () => {
  it("accepts and dispatches the canonical unequal pair only with exact signed lineage", async () => {
    const target = new DelegationTargetProbe();
    const fixture = await issuedDelegation("A", target);
    const accepted = fixture.instance.submitCommand({
      command: fixture.command,
      outboxId: fixture.outboxId,
      effectPayload: fixture.draft.payload,
    });
    const claim = await fixture.instance.claimCommandEffect({
      commandId: fixture.command.id,
      workerId: "trusted-import-worker",
      claimTtlMilliseconds: 5_000,
    });

    const applied =
      await fixture.instance.applyClaimedEffect(claim);

    expect(accepted).toMatchObject({
      commandId: fixture.command.id,
      state: "intent",
    });
    expect(applied.phase).toBe("effect-applied");
    expect(target.applyCalls).toHaveLength(1);
    expect(target.applyCalls[0]).toMatchObject({
      issuerId: IMPORT_AUTHORITY_PRINCIPAL_ID,
      payload: { actorId: IMPORT_ACTOR_ID },
      lease: { holderId: IMPORT_AUTHORITY_PRINCIPAL_ID },
    });
    fixture.instance.close();
  });

  it.each([
    ["generic foreign actor", "caller-recomputed-actor"],
    ["noncanonical import actor", "import-runtime-worker"],
  ])(
    "rejects a signed %s before command persistence or dispatch",
    async (_label, actorId) => {
      const target = new DelegationTargetProbe();
      const fixture = await issuedDelegation(
        "B",
        target,
        actorId,
      );
      const before = commandPersistenceCounts(fixture.path);

      expect(() =>
        fixture.instance.submitCommand({
          command: fixture.command,
          outboxId: fixture.outboxId,
          effectPayload: fixture.draft.payload,
        }),
      ).toThrow(/actor|delegat|identity|import/i);
      expect(commandPersistenceCounts(fixture.path)).toEqual(before);
      expect(target.applyCalls).toHaveLength(0);
      fixture.instance.close();
    },
  );

  it("rejects the canonical unequal pair when trusted issuance is missing", async () => {
    const target = new DelegationTargetProbe();
    const path = databasePath("memi-missing-delegation-");
    const clock = new MutableClock();
    const draft = delegatedDraft("C");
    const instance = runtime(path, clock, [TRUST_ROOT], target);
    await activateLease(instance, draft.command);
    const before = commandPersistenceCounts(path);

    expect(() =>
      instance.submitCommand({
        command: draft.command,
        outboxId: alternateOutboxId("C"),
        effectPayload: draft.payload,
      }),
    ).toThrow(/authority|issuance|lineage|trusted/i);
    expect(commandPersistenceCounts(path)).toEqual(before);
    expect(target.applyCalls).toHaveLength(0);
    instance.close();
  });

  it("rejects the canonical actor when the authority principal is not import-runtime", async () => {
    const target = new DelegationTargetProbe();
    const path = databasePath("memi-foreign-principal-");
    const clock = new MutableClock();
    const base = delegatedDraft("H");
    const command = bindCommandAction(
      {
        ...base.command,
        issuerId: "other-runtime",
      },
      base.payload,
    );
    const instance = runtime(path, clock, [TRUST_ROOT], target);
    instance.registerGrant(grantFor(command));
    instance.registerApprovalReceipt(approvalFor(command));
    await activateLease(instance, command);
    const before = commandPersistenceCounts(path);

    expect(() =>
      instance.submitCommand({
        command,
        outboxId: alternateOutboxId("H"),
        effectPayload: base.payload,
      }),
    ).toThrow(/actor|delegat|identity|import/i);
    expect(commandPersistenceCounts(path)).toEqual(before);
    expect(target.applyCalls).toHaveLength(0);
    instance.close();
  });

  it("rejects unsigned direct use of the reserved import actor before persistence or claim", async () => {
    const target = new DelegationTargetProbe();
    const path = databasePath("memi-reserved-actor-direct-");
    const clock = new MutableClock();
    const base = canvasCommandDraft("M");
    const payload = operationWithActor(
      base.payload,
      IMPORT_ACTOR_ID,
    );
    const command = bindCommandAction(
      {
        ...base.command,
        issuerId: IMPORT_ACTOR_ID,
      },
      payload,
    );
    const instance = runtime(path, clock, [TRUST_ROOT], target);
    instance.registerGrant(grantFor(command));
    instance.registerApprovalReceipt(approvalFor(command));
    await activateLease(instance, command);
    const before = commandPersistenceCounts(path);

    expect(() =>
      instance.submitCommand({
        command,
        outboxId: alternateOutboxId("M"),
        effectPayload: payload,
      }),
    ).toThrow(/actor|authority|identity|import|reserved/i);
    expect(commandPersistenceCounts(path)).toEqual(before);
    expect(
      instance.claimNextEffect({
        workerId: "forbidden-reserved-actor-worker",
        claimTtlMilliseconds: 1_000,
      }),
    ).toBeNull();
    expect(commandPersistenceCounts(path)).toEqual(before);
    expect(target.applyCalls).toHaveLength(0);
    instance.close();
  });

  it("rejects an ordinary unequal actor before persistence, claim, or target dispatch", async () => {
    const target = new DelegationTargetProbe();
    const path = databasePath("memi-ordinary-actor-mismatch-");
    const clock = new MutableClock();
    const base = canvasCommandDraft("J");
    const payload = operationWithActor(base.payload, "other-agent");
    const command = bindCommandAction(
      {
        ...base.command,
        issuerId: "designer-agent",
      },
      payload,
    );
    const instance = runtime(path, clock, [TRUST_ROOT], target);
    instance.registerGrant(grantFor(command));
    instance.registerApprovalReceipt(approvalFor(command));
    await activateLease(instance, command);
    const before = commandPersistenceCounts(path);

    expect(() =>
      instance.submitCommand({
        command,
        outboxId: alternateOutboxId("J"),
        effectPayload: payload,
      }),
    ).toThrow(/actor|authority|identity|issuer/i);
    expect(commandPersistenceCounts(path)).toEqual(before);
    expect(
      instance.claimNextEffect({
        workerId: "forbidden-ordinary-mismatch-worker",
        claimTtlMilliseconds: 1_000,
      }),
    ).toBeNull();
    expect(commandPersistenceCounts(path)).toEqual(before);
    expect(target.applyCalls).toHaveLength(0);
    instance.close();
  });

  it("rejects an invalid non-import canvas payload before persistence", async () => {
    const target = new DelegationTargetProbe();
    const path = databasePath("memi-invalid-ordinary-canvas-");
    const clock = new MutableClock();
    const base = canvasCommandDraft("K");
    const payload = {
      operation: "invalid-canvas-operation",
    } as const;
    const command = bindCommandAction(
      {
        ...base.command,
        issuerId: "designer-agent",
      },
      payload,
    );
    const instance = runtime(path, clock, [TRUST_ROOT], target);
    instance.registerGrant(grantFor(command));
    instance.registerApprovalReceipt(approvalFor(command));
    await activateLease(instance, command);
    const before = commandPersistenceCounts(path);

    expect(() =>
      instance.submitCommand({
        command,
        outboxId: alternateOutboxId("K"),
        effectPayload: payload,
      }),
    ).toThrow(/canvas|operation|payload|invalid/i);
    expect(commandPersistenceCounts(path)).toEqual(before);
    expect(target.applyCalls).toHaveLength(0);
    instance.close();
  });

  it("does not let a tagged legacy executor bypass platform canvas payload validation", async () => {
    const target = new DelegationTargetProbe();
    const path = databasePath("memi-tagged-platform-canvas-");
    const clock = new MutableClock();
    const base = canvasCommandDraft("N");
    const payload = {
      operation: "invalid-tagged-platform-canvas",
    } as const;
    const command = bindCommandAction(
      {
        ...base.command,
        issuerId: "designer-agent",
      },
      payload,
    );
    const instance = new DurableRuntime({
      databasePath: path,
      clock: clock.now,
      canvasTarget: target,
      effectExecutor: new RecordingEffectExecutor(),
    });
    instance.registerGrant(grantFor(command));
    instance.registerApprovalReceipt(approvalFor(command));
    await activateLease(instance, command);
    const before = commandPersistenceCounts(path);

    expect(() =>
      instance.submitCommand({
        command,
        outboxId: alternateOutboxId("N"),
        effectPayload: payload,
      }),
    ).toThrow(/canvas|operation|payload|invalid/i);
    expect(commandPersistenceCounts(path)).toEqual(before);
    expect(target.applyCalls).toHaveLength(0);
    instance.close();
  });

  it("rejects an actor and payload tamper chain after valid issuance", async () => {
    const target = new DelegationTargetProbe();
    const fixture = await issuedDelegation("D", target);
    const changedPayload = operationWithActor(
      fixture.draft.payload,
      "caller-recomputed-actor",
    );
    const changedCommand = bindCommandAction(
      fixture.command,
      changedPayload,
    );
    const before = commandPersistenceCounts(fixture.path);

    expect(() =>
      fixture.instance.submitCommand({
        command: changedCommand,
        outboxId: fixture.outboxId,
        effectPayload: changedPayload,
      }),
    ).toThrow(/actor|authority|command|issuance|trusted/i);
    expect(commandPersistenceCounts(fixture.path)).toEqual(before);
    expect(target.applyCalls).toHaveLength(0);
    fixture.instance.close();
  });

  it("rejects a cross-entry actor and payload swap before persistence", async () => {
    const target = new DelegationTargetProbe();
    const first = await issuedDelegation("E", target);
    const second = delegatedDraft(
      "F",
      "caller-recomputed-actor",
    );
    const before = commandPersistenceCounts(first.path);

    expect(() =>
      first.instance.submitCommand({
        command: first.command,
        outboxId: first.outboxId,
        effectPayload: second.payload,
      }),
    ).toThrow(/digest|payload|authority|operation/i);
    expect(commandPersistenceCounts(first.path)).toEqual(before);
    expect(target.applyCalls).toHaveLength(0);
    first.instance.close();
  });

  it("recovery preserves the accepted actor, payload, and authority identity", async () => {
    const firstTarget = new DelegationTargetProbe();
    firstTarget.applyStatus = "outcome-unknown";
    const first = await issuedDelegation("G", firstTarget);
    first.instance.submitCommand({
      command: first.command,
      outboxId: first.outboxId,
      effectPayload: first.draft.payload,
    });
    const claim = await first.instance.claimCommandEffect({
      commandId: first.command.id,
      workerId: "uncertain-import-worker",
      claimTtlMilliseconds: 1_000,
    });

    await expect(
      first.instance.applyClaimedEffect(claim),
    ).rejects.toThrow(/acknowledgement|lost|unknown/i);
    expect(firstTarget.applyCalls).toHaveLength(1);
    const initial = firstTarget.applyCalls[0]!;
    first.instance.close();
    first.clock.advance(1_000);

    const recoveredTarget = new DelegationTargetProbe();
    recoveredTarget.lookupStatus = "not-found";
    const recovered = runtime(
      first.path,
      first.clock,
      [TRUST_ROOT],
      recoveredTarget,
    );
    const recoveredClaim = await recovered.claimCommandEffect({
      commandId: first.command.id,
      workerId: "recovered-import-worker",
      claimTtlMilliseconds: 1_000,
    });
    const applied =
      await recovered.applyClaimedEffect(recoveredClaim);

    expect(applied?.phase).toBe("effect-applied");
    expect(recoveredTarget.lookupCalls).toHaveLength(1);
    expect(recoveredTarget.applyCalls).toHaveLength(1);
    const replay = recoveredTarget.applyCalls[0]!;
    expect(replay.payload).toEqual(initial.payload);
    expect(replay.payload.actorId).toBe(IMPORT_ACTOR_ID);
    expect(replay.issuerId).toBe(
      IMPORT_AUTHORITY_PRINCIPAL_ID,
    );
    expect(replay.lease.holderId).toBe(
      IMPORT_AUTHORITY_PRINCIPAL_ID,
    );
    recovered.close();
  });
});
