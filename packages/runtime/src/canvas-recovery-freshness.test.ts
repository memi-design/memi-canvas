import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { hashCanonicalValue } from "@memi/canonical-json";
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
  type TargetVerificationRequest,
  type TargetVerificationResult,
} from "../../protocol/src/index.js";
import {
  DurableRuntime,
  bindCommandAction,
  type CanvasTargetAdapter,
  type DurableRuntimeOptions,
  type EffectExecutor,
} from "./index.js";
import { receiptFor } from "./canvas-effect-test-fixtures.js";
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

type RecoveryChallenge = {
  readonly id: string;
  readonly nonce: string;
  readonly issuedAt: string;
};

type ChallengedLookupRequest = TargetLookupRequest & {
  readonly challenge: RecoveryChallenge;
  readonly requestDigest: string;
};

type RawLookupResult = {
  readonly schemaVersion: 1;
  readonly status: string;
  readonly requestDigest: string;
  readonly checkedAt: string;
  readonly evidenceHash: string;
  readonly [key: string]: unknown;
};

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-canvas-recovery-freshness-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
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
      },
    },
  });
}

function commandFor(payload: CanvasOperation, suffix: string) {
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

function requestDigestMaterial(
  request: unknown,
) {
  return request;
}

function challengedRequest(
  command: ReturnType<typeof commandFor>,
  payload: CanvasOperation,
  challenge: RecoveryChallenge,
): ChallengedLookupRequest {
  const material = {
    schemaVersion: 1 as const,
    projectId: command.projectId,
    target: command.target,
    idempotencyKey: command.idempotencyKey,
    commandId: command.id,
    commandActionDigest: command.actionDigest,
    operationActionDigest: payload.actionDigest,
    expectedBeforeHash: command.target.expectedBeforeHash,
    challenge,
  };
  return {
    ...material,
    requestDigest: hashCanonicalValue(
      requestDigestMaterial(material),
    ),
  } as ChallengedLookupRequest;
}

function lookupResult(
  request: ChallengedLookupRequest,
  checkedAt: string,
  fields: Record<string, unknown> = {
    status: "not-found",
    currentTargetHash: contentHash("a"),
  },
): RawLookupResult {
  const material = {
    schemaVersion: 1 as const,
    ...fields,
    requestDigest: request.requestDigest,
    checkedAt,
  };
  return {
    ...material,
    evidenceHash: hashCanonicalValue(material),
  } as RawLookupResult;
}

class ForbiddenExecutor implements EffectExecutor {
  calls = 0;

  async execute(): Promise<
    Awaited<ReturnType<EffectExecutor["execute"]>>
  > {
    this.calls += 1;
    throw new Error("Generic execution is forbidden.");
  }
}

class RecoveryTarget implements CanvasTargetAdapter {
  readonly applyCalls: TargetEffectRequest[] = [];
  readonly lookupCalls: ChallengedLookupRequest[] = [];
  applyStatus: "applied" | "outcome-unknown" = "outcome-unknown";
  responder: (
    request: ChallengedLookupRequest,
  ) => unknown = () => {
    throw new Error("No recovery response configured.");
  };

  activateFence(request: TargetFenceActivationRequest) {
    return TargetFenceActivationResultSchema.parse({
      ...request,
      status: "activated",
      highestFence: request.fencingEpoch,
    });
  }

  compareAndApply(request: TargetEffectRequest): TargetApplyOutcome {
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
    const challenged = request as ChallengedLookupRequest;
    this.lookupCalls.push(challenged);
    return this.responder(challenged) as TargetLookupResult;
  }

  verify(
    _request: TargetVerificationRequest,
  ): Promise<TargetVerificationResult> {
    throw new Error("Verification is outside recovery freshness.");
  }
}

class ChallengeFactory {
  calls = 0;
  readonly #suffixes: readonly string[];

  constructor(...suffixes: readonly string[]) {
    this.#suffixes = suffixes;
  }

  next = () => {
    const suffix =
      this.#suffixes[this.calls] ??
      this.#suffixes[this.#suffixes.length - 1]!;
    this.calls += 1;
    return {
      id: sortableId("rcv", suffix),
      nonce: suffix.toLowerCase().repeat(43),
    };
  };
}

function openRuntime(
  path: string,
  clock: MutableClock,
  target: RecoveryTarget,
  factory: ChallengeFactory,
  faults?: Record<string, () => void>,
) {
  return new DurableRuntime({
    databasePath: path,
    clock: clock.now,
    canvasTarget: target,
    effectExecutor: new ForbiddenExecutor(),
    recoveryChallengeFactory: factory.next,
    runtimeFaults: faults,
  } as unknown as DurableRuntimeOptions);
}

async function setupAmbiguous(
  suffix: string,
  factory = new ChallengeFactory("A", "B", "C"),
) {
  const path = databasePath();
  const clock = new MutableClock();
  const target = new RecoveryTarget();
  const runtime = openRuntime(path, clock, target, factory);
  const payload = operation(suffix);
  const command = commandFor(payload, suffix);
  runtime.registerGrant(grantFor(command));
  runtime.registerApprovalReceipt(approvalFor(command));
  const lease = runtime.acquireLease({
    leaseId: command.authority.leaseId,
    projectId: command.projectId,
    targetId: command.target.id,
    holderId: command.issuerId,
    ttlMilliseconds: 120_000,
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
  await expect(
    runtime.applyNextEffect({
      workerId: "ambiguous-worker",
      claimTtlMilliseconds: 120_000,
    }),
  ).rejects.toThrow("acknowledgement was lost");
  target.applyStatus = "applied";
  return {
    clock,
    command,
    factory,
    path,
    payload,
    runtime,
    target,
  };
}

function recoveryRows(path: string) {
  const database = new DatabaseSync(path);
  const latch = database
    .prepare(
      `SELECT state, recovery_json
       FROM target_schedule_latches`,
    )
    .get();
  const evidence = database
    .prepare(
      `SELECT sequence, request_digest, disposition, evidence_json
       FROM target_recovery_evidence ORDER BY sequence`,
    )
    .all();
  database.close();
  return { evidence, latch };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("canvas recovery evidence freshness", () => {
  it("accepts a fresh challenge-bound not-found result before retrying", async () => {
    const fixture = await setupAmbiguous("A");
    fixture.target.responder = (request) =>
      lookupResult(request, fixture.clock.now());

    await expect(
      fixture.runtime.applyNextEffect({
        workerId: "fresh-recovery-worker",
        claimTtlMilliseconds: 120_000,
      }),
    ).resolves.toMatchObject({
      commandId: fixture.command.id,
      phase: "effect-applied",
    });
    expect(fixture.target.lookupCalls).toHaveLength(1);
    expect(fixture.target.applyCalls).toHaveLength(2);
    expect(recoveryRows(fixture.path).evidence).toHaveLength(1);
    fixture.runtime.close();
  });

  it("rejects not-found evidence captured before the ambiguous apply", async () => {
    const factory = new ChallengeFactory("B");
    const fixture = await setupAmbiguous("B", factory);
    const staleRequest = challengedRequest(
      fixture.command,
      fixture.payload,
      {
        id: sortableId("rcv", "P"),
        nonce: "p".repeat(43),
        issuedAt: "2026-07-28T11:59:00.000Z",
      },
    );
    const stale = lookupResult(
      staleRequest,
      "2026-07-28T11:59:00.000Z",
    );
    fixture.target.responder = () => stale;

    await expect(
      fixture.runtime.applyNextEffect({
        workerId: "stale-preplay-worker",
        claimTtlMilliseconds: 120_000,
      }),
    ).resolves.toBeNull();
    expect(fixture.target.applyCalls).toHaveLength(1);
    expect(recoveryRows(fixture.path).evidence).toEqual([
      expect.objectContaining({
        disposition: "rejected-response",
      }),
    ]);
    fixture.runtime.close();
  });

  it.each([
    ["challenge mismatch", "digest"],
    ["checked before issue", "before"],
    ["future dated", "future"],
    ["expired", "expired"],
    ["missing request digest", "missing-digest"],
    ["missing evidence hash", "missing-evidence"],
    ["tampered evidence hash", "tamper"],
  ] as const)(
    "keeps the latch blocked for %s",
    async (_label, failure) => {
      const suffix = {
        digest: "C",
        before: "D",
        future: "E",
        expired: "F",
        "missing-digest": "G",
        "missing-evidence": "N",
        tamper: "P",
      }[failure];
      const fixture = await setupAmbiguous(suffix);
      if (failure === "expired") {
        fixture.clock.advance(31_000);
      }
      fixture.target.responder = (request) => {
        const checkedAt =
          failure === "before"
            ? "2026-07-28T11:59:59.000Z"
            : failure === "future"
              ? "2026-07-28T12:00:01.000Z"
              : "2026-07-28T12:00:00.000Z";
        const valid = lookupResult(request, checkedAt);
        if (failure === "digest") {
          const forged = {
            ...valid,
            requestDigest: contentHash("f"),
          };
          const { evidenceHash: _ignored, ...material } = forged;
          return {
            ...material,
            evidenceHash: hashCanonicalValue(material),
          };
        }
        if (failure === "missing-digest") {
          const {
            requestDigest: _requestDigest,
            ...missingDigest
          } = valid;
          return missingDigest;
        }
        if (failure === "missing-evidence") {
          const {
            evidenceHash: _evidenceHash,
            ...missingEvidence
          } = valid;
          return missingEvidence;
        }
        return failure === "tamper"
          ? { ...valid, evidenceHash: contentHash("f") }
          : valid;
      };

      await expect(
        fixture.runtime.applyNextEffect({
          workerId: `invalid-${failure}-worker`,
          claimTtlMilliseconds: 120_000,
        }),
      ).resolves.toBeNull();
      expect(fixture.target.applyCalls).toHaveLength(1);
      expect(recoveryRows(fixture.path).evidence).toEqual([
        expect.objectContaining({
          disposition: "rejected-response",
        }),
      ]);
      fixture.runtime.close();
    },
  );

  it("rotates challenges and records immutable ordered attempt evidence", async () => {
    const fixture = await setupAmbiguous(
      "H",
      new ChallengeFactory("H", "J"),
    );
    let firstRequest: ChallengedLookupRequest | undefined;
    let firstValid: RawLookupResult | undefined;
    fixture.target.responder = (request) => {
      firstRequest = request;
      firstValid = lookupResult(request, fixture.clock.now(), {
        status: "mismatch",
        code: "TARGET_HASH_MISMATCH",
        message: "Target mismatch.",
      });
      return firstValid;
    };
    await fixture.runtime.applyNextEffect({
      workerId: "first-attempt-worker",
      claimTtlMilliseconds: 120_000,
    });
    fixture.target.responder = () =>
      lookupResult(
        firstRequest!,
        fixture.clock.now(),
      );
    await fixture.runtime.applyNextEffect({
      workerId: "replayed-attempt-worker",
      claimTtlMilliseconds: 120_000,
    });

    expect(fixture.target.lookupCalls[1]?.requestDigest).not.toBe(
      firstRequest?.requestDigest,
    );
    const rows = recoveryRows(fixture.path);
    expect(rows.evidence).toHaveLength(2);
    expect(rows.evidence).toEqual([
      expect.objectContaining({ sequence: 1 }),
      expect.objectContaining({ sequence: 2 }),
    ]);
    expect(rows.latch).toMatchObject({ state: "blocked-unknown" });
    expect(fixture.target.applyCalls).toHaveLength(1);
    fixture.runtime.close();
  });

  it("reuses a persisted challenge after restart before target I/O", async () => {
    const path = databasePath();
    const clock = new MutableClock();
    const target = new RecoveryTarget();
    const firstFactory = new ChallengeFactory("K");
    const first = openRuntime(
      path,
      clock,
      target,
      firstFactory,
      {
        afterRecoveryChallengePersisted: () => {
          throw new Error("crash after challenge persistence");
        },
      },
    );
    const payload = operation("K");
    const command = commandFor(payload, "K");
    first.registerGrant(grantFor(command));
    first.registerApprovalReceipt(approvalFor(command));
    const lease = first.acquireLease({
      leaseId: command.authority.leaseId,
      projectId: command.projectId,
      targetId: command.target.id,
      holderId: command.issuerId,
      ttlMilliseconds: 120_000,
    });
    await first.activateCanvasLease({
      projectId: lease.projectId,
      targetId: lease.targetId,
      leaseId: lease.id,
      fencingEpoch: lease.fencingEpoch,
    });
    first.submitCommand({
      command,
      outboxId: alternateOutboxId("K"),
      effectPayload: payload,
    });
    await expect(
      first.applyNextEffect({
        workerId: "restart-ambiguous",
        claimTtlMilliseconds: 120_000,
      }),
    ).rejects.toThrow();
    target.applyStatus = "applied";
    await expect(
      first.applyNextEffect({
        workerId: "challenge-crash",
        claimTtlMilliseconds: 120_000,
      }),
    ).rejects.toThrow("crash after challenge persistence");
    const persisted = JSON.parse(
      String(
        (
          recoveryRows(path).latch as {
            readonly recovery_json: string;
          }
        ).recovery_json,
      ),
    ) as { readonly request: ChallengedLookupRequest };
    first.close();

    const replayTarget = new RecoveryTarget();
    replayTarget.applyStatus = "applied";
    replayTarget.responder = (request) =>
      lookupResult(request, clock.now());
    const secondFactory = new ChallengeFactory("M");
    const reopened = openRuntime(
      path,
      clock,
      replayTarget,
      secondFactory,
    );
    await expect(
      reopened.applyNextEffect({
        workerId: "restart-recovery",
        claimTtlMilliseconds: 120_000,
      }),
    ).resolves.toMatchObject({ phase: "effect-applied" });
    expect(secondFactory.calls).toBe(0);
    expect(replayTarget.lookupCalls[0]?.requestDigest).toBe(
      persisted.request.requestDigest,
    );
    reopened.close();
  });

  it("rotates an expired persisted challenge before target I/O", async () => {
    const fixture = await setupAmbiguous(
      "Q",
      new ChallengeFactory("Q"),
    );
    const stale = challengedRequest(
      fixture.command,
      fixture.payload,
      {
        id: sortableId("rcv", "Q"),
        nonce: "q".repeat(43),
        issuedAt: fixture.clock.now(),
      },
    );
    const database = new DatabaseSync(fixture.path);
    database
      .prepare(
        `UPDATE target_schedule_latches
         SET recovery_json = ?`,
      )
      .run(
        JSON.stringify({
          status: "lookup-challenge-pending",
          request: stale,
        }),
      );
    database.close();
    fixture.runtime.close();
    fixture.clock.advance(31_000);

    const target = new RecoveryTarget();
    target.applyStatus = "applied";
    target.responder = (request) =>
      lookupResult(request, fixture.clock.now());
    const factory = new ChallengeFactory("R");
    const reopened = openRuntime(
      fixture.path,
      fixture.clock,
      target,
      factory,
    );
    await expect(
      reopened.applyNextEffect({
        workerId: "expired-challenge-worker",
        claimTtlMilliseconds: 120_000,
      }),
    ).resolves.toMatchObject({ phase: "effect-applied" });
    expect(factory.calls).toBe(1);
    expect(target.lookupCalls[0]?.requestDigest).not.toBe(
      stale.requestDigest,
    );
    reopened.close();
  });

  it("quarantines a challenge-valid found result with a forged receipt", async () => {
    const fixture = await setupAmbiguous(
      "S",
      new ChallengeFactory("S", "T"),
    );
    const trusted = receiptFor(fixture.target.applyCalls[0]!);
    const { receiptHash: _receiptHash, ...trustedMaterial } = trusted;
    const forgedMaterial = {
      ...trustedMaterial,
      commandId: sortableId("cmd", "Z"),
    };
    const forged = TargetReceiptSchema.parse({
      ...forgedMaterial,
      receiptHash: hashCanonicalValue(forgedMaterial),
    });
    fixture.target.responder = (request) =>
      lookupResult(request, fixture.clock.now(), {
        status: "found",
        receipt: forged,
        currentTargetHash: forged.resultingHash,
      });

    await expect(
      fixture.runtime.applyNextEffect({
        workerId: "forged-found-worker",
        claimTtlMilliseconds: 120_000,
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.runtime.applyNextEffect({
        workerId: "forged-found-retry-worker",
        claimTtlMilliseconds: 120_000,
      }),
    ).resolves.toBeNull();

    expect(fixture.target.applyCalls).toHaveLength(1);
    expect(fixture.target.lookupCalls[1]?.requestDigest).not.toBe(
      fixture.target.lookupCalls[0]?.requestDigest,
    );
    expect(recoveryRows(fixture.path)).toMatchObject({
      evidence: [
        { sequence: 1, disposition: "rejected-response" },
        { sequence: 2, disposition: "rejected-response" },
      ],
      latch: { state: "blocked-unknown" },
    });
    fixture.runtime.close();
  });
});
