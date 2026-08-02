import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { hashCanonicalValue } from "@memi/canonical-json";
import {
  CanvasOperationSchema,
  TargetApplyOutcomeSchema,
  TargetFenceActivationResultSchema,
  type CanvasOperation,
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
  type CommitClaim,
  type CommittedEffectReceipt,
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

const temporaryDirectories: string[] = [];
const TRACE_EVENT_ID = sortableId("evt", "T");

function databasePath(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-canonical-commit-"),
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

class CanonicalTarget implements CanvasTargetAdapter {
  readonly verificationCalls: TargetVerificationRequest[] = [];
  receipt?: TargetReceipt;
  beforeVerification?: (request: TargetVerificationRequest) => void;
  transformVerification?: (
    request: TargetVerificationRequest,
    result: TargetVerificationResult,
  ) => TargetVerificationResult;
  verificationStatus: "verified-applied" | "unavailable" =
    "verified-applied";

  activateFence(request: TargetFenceActivationRequest) {
    return TargetFenceActivationResultSchema.parse({
      ...request,
      status: "activated",
      highestFence: request.fencingEpoch,
    });
  }

  compareAndApply(request: TargetEffectRequest) {
    this.receipt = receiptFor(request);
    return TargetApplyOutcomeSchema.parse({
      schemaVersion: 1,
      status: "applied",
      receipt: this.receipt,
    });
  }

  lookup(_request: TargetLookupRequest): TargetLookupResult {
    throw new Error("Lookup is outside canonical commit.");
  }

  verify(
    request: TargetVerificationRequest,
  ): TargetVerificationResult {
    this.verificationCalls.push(request);
    this.beforeVerification?.(request);
    const material =
      this.verificationStatus === "verified-applied"
        ? {
            schemaVersion: 1 as const,
            status: "verified-applied" as const,
            receipt: this.receipt!,
            currentTargetHash: this.receipt!.resultingHash,
            requestDigest: request.requestDigest,
            checkedAt: "2026-07-28T12:00:00.000Z",
          }
        : {
            schemaVersion: 1 as const,
            status: "unavailable" as const,
            code: "TARGET_UNAVAILABLE" as const,
            message: "Target unavailable.",
            requestDigest: request.requestDigest,
            checkedAt: "2026-07-28T12:00:00.000Z",
          };
    const result = {
      ...material,
      evidenceHash: hashCanonicalValue(material),
    } as TargetVerificationResult;
    return this.transformVerification?.(request, result) ?? result;
  }
}

class ForbiddenExecutor implements EffectExecutor {
  async execute(): Promise<never> {
    throw new Error("Generic executor must not run.");
  }
}

type RuntimeWithCanonicalInjection = ConstructorParameters<
  typeof DurableRuntime
>[0] & {
  readonly traceEventIdFactory: () => string;
};

type CanonicalCommit = (
  request: { readonly claim: CommitClaim },
) => Promise<CommittedEffectReceipt>;

async function fixture(
  suffix: string,
  faults?: Record<string, () => void>,
  beforeClaim?: (value: {
    readonly path: string;
    readonly command: ReturnType<typeof durableCommand>;
  }) => void,
) {
  const path = databasePath();
  const clock = new MutableClock();
  const target = new CanonicalTarget();
  let eventAllocations = 0;
  let challengeAllocations = 0;
  const options = {
    databasePath: path,
    clock: clock.now,
    canvasTarget: target,
    effectExecutor: new ForbiddenExecutor(),
    effectVerifier: {
      verify: () => {
        throw new Error("Legacy verifier must never run for canvas.");
      },
    },
    recoveryChallengeFactory: () => ({
      id: sortableId(
        "rcv",
        challengeAllocations++ === 0 ? suffix : "N",
      ),
      nonce: (challengeAllocations === 1 ? suffix : "N")
        .toLowerCase()
        .repeat(43),
    }),
    traceEventIdFactory: () => {
      eventAllocations += 1;
      return TRACE_EVENT_ID;
    },
    ...(faults === undefined ? {} : { runtimeFaults: faults }),
  } as unknown as RuntimeWithCanonicalInjection;
  const runtime = new DurableRuntime(options);
  const payload = operation(suffix);
  const command = bindCommandAction(
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
  await runtime.applyNextEffect({
    workerId: "apply-worker",
    claimTtlMilliseconds: 5_000,
  });
  beforeClaim?.({ path, command });
  const claim = runtime.claimEffectCommit({
    commandId: command.id,
    workerId: "commit-worker",
    claimTtlMilliseconds: 5_000,
  });
  const commit = runtime.verifyAndCommit.bind(
    runtime,
  ) as unknown as CanonicalCommit;
  return {
    claim,
    clock,
    command,
    commit,
    eventAllocations: () => eventAllocations,
    path,
    runtime,
    target,
  };
}

function canonicalCounts(path: string) {
  const database = new DatabaseSync(path);
  const counts = Object.fromEntries(
    [
      "effect_receipts",
      "trace_effect_bindings",
      "trace_events",
      "trace_heads",
      "trace_projection_outbox",
      "target_verification_attempts",
    ].map((table) => [
      table,
      (
        database
          .prepare(`SELECT count(*) AS count FROM ${table}`)
          .get() as { readonly count: number }
      ).count,
    ]),
  );
  const outbox = database
    .prepare("SELECT phase, record_json FROM outbox")
    .get();
  const latch = database
    .prepare(
      `SELECT state, recovery_json
       FROM target_schedule_latches`,
    )
    .get();
  database.close();
  return { counts, latch, outbox };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("atomic canonical canvas trace commit", () => {
  it("persists challenge before target I/O and commits one closed authority transaction", async () => {
    const value = await fixture("T");
    value.target.beforeVerification = (request) => {
      const database = new DatabaseSync(value.path);
      const pending = database
        .prepare(
          `SELECT
             target_schedule_latches.recovery_json,
             target_verification_attempts.state,
             target_verification_attempts.request_json,
             target_verification_attempts.claim_worker_id,
             target_verification_attempts.claim_epoch,
             target_verification_attempts.target_receipt_hash
           FROM target_schedule_latches
           JOIN target_verification_attempts
             ON target_verification_attempts.command_id =
                target_schedule_latches.command_id
           WHERE target_schedule_latches.command_id = ?`,
        )
        .get(value.command.id) as {
        readonly recovery_json: string;
        readonly state: string;
        readonly request_json: string;
        readonly claim_worker_id: string;
        readonly claim_epoch: number;
        readonly target_receipt_hash: string;
      };
      expect(JSON.parse(pending.recovery_json)).toEqual({
        status: "verification-challenge-pending",
        request,
      });
      expect(JSON.parse(pending.request_json)).toEqual(request);
      expect(pending).toMatchObject({
        state: "issued",
        claim_worker_id: value.claim.workerId,
        claim_epoch: value.claim.fencingEpoch,
        target_receipt_hash: value.target.receipt?.receiptHash,
      });
      expect(
        database
          .prepare("SELECT count(*) AS count FROM trace_events")
          .get(),
      ).toEqual({ count: 0 });
      database.close();
    };

    const receipt = await value.commit({ claim: value.claim });
    expect(receipt).toMatchObject({ eventId: TRACE_EVENT_ID });
    expect(value.eventAllocations()).toBe(1);
    expect(value.target.verificationCalls).toHaveLength(1);
    expect(canonicalCounts(value.path)).toMatchObject({
      counts: {
        effect_receipts: 1,
        trace_effect_bindings: 1,
        trace_events: 1,
        trace_heads: 1,
        trace_projection_outbox: 1,
        target_verification_attempts: 1,
      },
      latch: undefined,
      outbox: { phase: "committed" },
    });
    const database = new DatabaseSync(value.path);
    const persisted = JSON.stringify(
      database
        .prepare(
          `SELECT event_json FROM trace_events
           UNION ALL SELECT receipt_json FROM effect_receipts`,
        )
        .all(),
    );
    database.close();
    expect(persisted).not.toContain(
      value.target.verificationCalls[0]!.challenge.nonce,
    );
    expect(JSON.stringify(receipt)).not.toContain(
      value.target.verificationCalls[0]!.challenge.nonce,
    );
    expect(
      JSON.stringify(value.runtime.getEffectReceipt(value.command.id)),
    ).not.toContain(
      value.target.verificationCalls[0]!.challenge.nonce,
    );
    expect(
      JSON.stringify(
        value.runtime.replayCanvasTrace(value.command.projectId),
      ),
    ).not.toContain(
      value.target.verificationCalls[0]!.challenge.nonce,
    );
    const projectionDatabase = new DatabaseSync(value.path);
    const projection = projectionDatabase
      .prepare("SELECT * FROM trace_projection_outbox")
      .get();
    projectionDatabase.close();
    expect(JSON.stringify(projection)).not.toContain(
      value.target.verificationCalls[0]!.challenge.nonce,
    );
    value.runtime.close();

    const reopened = new DurableRuntime({
      databasePath: value.path,
      clock: value.clock.now,
      effectExecutor: new ForbiddenExecutor(),
    });
    expect(
      JSON.stringify(reopened.getEffectReceipt(value.command.id)),
    ).not.toContain(
      value.target.verificationCalls[0]!.challenge.nonce,
    );
    reopened.close();
  });

  it("returns exact lost-response replay without target I/O or ID allocation", async () => {
    const value = await fixture("W");
    const first = await value.commit({ claim: value.claim });
    const replay = await value.commit({ claim: value.claim });

    expect(replay).toEqual(first);
    expect(value.target.verificationCalls).toHaveLength(1);
    expect(value.eventAllocations()).toBe(1);
    await expect(
      value.commit({
        claim: { ...value.claim, workerId: "different-worker" },
      }),
    ).rejects.toThrow(/claim|conflict|authority/i);
    expect(canonicalCounts(value.path).counts).toMatchObject({
      trace_events: 1,
      trace_effect_bindings: 1,
      trace_projection_outbox: 1,
    });
    value.runtime.close();
  });

  it("rejects caller trace authority and unavailable verification without canonical mutation", async () => {
    const value = await fixture("V");
    const untrustedCommit = value.runtime.verifyAndCommit.bind(
      value.runtime,
    ) as unknown as (
      request: Record<string, unknown>,
    ) => Promise<unknown>;
    await expect(
      untrustedCommit({
        claim: value.claim,
        traceEventId: sortableId("evt", "Z"),
      }),
    ).rejects.toThrow();
    expect(value.target.verificationCalls).toHaveLength(0);
    value.target.verificationStatus = "unavailable";
    await expect(
      value.commit({ claim: value.claim }),
    ).rejects.toThrow();
    expect(value.target.verificationCalls).toHaveLength(1);

    expect(canonicalCounts(value.path)).toMatchObject({
      counts: {
        effect_receipts: 0,
        trace_effect_bindings: 0,
        trace_events: 0,
        trace_heads: 0,
        trace_projection_outbox: 0,
        target_verification_attempts: 1,
      },
      latch: { state: "pending-commit" },
      outbox: { phase: "effect-applied" },
    });
    expect(value.eventAllocations()).toBe(0);
    value.runtime.close();
  });

  it("retains rejected attempts but clears their latch for a clean retry", async () => {
    const value = await fixture("J");
    value.target.transformVerification = (_request, result) => ({
      ...result,
      evidenceHash: "malformed",
    }) as TargetVerificationResult;
    await expect(value.commit({ claim: value.claim })).rejects.toThrow();
    delete value.target.transformVerification;

    await expect(value.commit({ claim: value.claim }))
      .resolves.toMatchObject({ eventId: TRACE_EVENT_ID });
    const database = new DatabaseSync(value.path);
    expect(
      database
        .prepare(
          `SELECT state, count(*) AS count
           FROM target_verification_attempts GROUP BY state
           ORDER BY state`,
        )
        .all(),
    ).toEqual([
      { state: "accepted", count: 1 },
      { state: "rejected", count: 1 },
    ]);
    database.close();
    value.runtime.close();
  });

  it.each([
    "afterTraceEventInsert",
    "afterTraceHeadUpdate",
    "afterTraceBindingInsert",
    "afterCanonicalReceiptInsert",
    "afterProjectionInsert",
    "afterCommittedOutboxUpdate",
  ])("rolls back the complete authority at %s", async (fault) => {
    const value = await fixture("Y", {
      [fault]: () => {
        throw new Error(`fault:${fault}`);
      },
    });

    await expect(
      value.commit({ claim: value.claim }),
    ).rejects.toThrow(`fault:${fault}`);
    expect(canonicalCounts(value.path)).toMatchObject({
      counts: {
        effect_receipts: 0,
        trace_effect_bindings: 0,
        trace_events: 0,
        trace_heads: 0,
        trace_projection_outbox: 0,
        target_verification_attempts: 1,
      },
      latch: { state: "pending-commit" },
      outbox: { phase: "effect-applied" },
    });
    value.runtime.close();
  });

  it.each(["missing-receipt", "wrong-latch", "cross-target"] as const)(
    "rejects canonical claim admission for %s",
    async (failure) => {
      await expect(
        fixture("Q", undefined, ({ path, command }) => {
          const database = new DatabaseSync(path);
          if (failure === "missing-receipt") {
            database
              .prepare(
                "DELETE FROM target_receipts WHERE command_id = ?",
              )
              .run(command.id);
          } else if (failure === "wrong-latch") {
            database
              .prepare(
                `UPDATE target_schedule_latches
                 SET state = 'blocked-unknown'
                 WHERE command_id = ?`,
              )
              .run(command.id);
          } else {
            database
              .prepare(
                `UPDATE target_receipts SET target_id = ?
                 WHERE command_id = ?`,
              )
              .run(sortableId("doc", "P"), command.id);
          }
          database.close();
        }),
      ).rejects.toThrow();
    },
  );

  it.each([
    "receipt",
    "latch",
    "lease",
    "outbox",
  ] as const)(
    "rejects changed %s authority after verification",
    async (authority) => {
      const value = await fixture("X");
      value.target.beforeVerification = () => {
        const database = new DatabaseSync(value.path);
        if (authority === "receipt") {
          database
            .prepare(
              `UPDATE target_receipts SET receipt_json = '{}'
               WHERE command_id = ?`,
            )
            .run(value.command.id);
        } else if (authority === "latch") {
          database
            .prepare(
              `UPDATE target_schedule_latches
               SET state = 'blocked-unknown'
               WHERE command_id = ?`,
            )
            .run(value.command.id);
        } else if (authority === "lease") {
          database
            .prepare(
              `UPDATE leases SET phase = 'pending-fence'
               WHERE id = ?`,
            )
            .run(value.command.authority.leaseId);
        } else {
          database
            .prepare(
              `UPDATE outbox SET record_json = '{}'
               WHERE command_id = ?`,
            )
            .run(value.command.id);
        }
        database.close();
      };

      await expect(
        value.commit({ claim: value.claim }),
      ).rejects.toThrow();
      expect(canonicalCounts(value.path).counts).toMatchObject({
        effect_receipts: 0,
        trace_effect_bindings: 0,
        trace_events: 0,
        trace_heads: 0,
        trace_projection_outbox: 0,
      });
      value.runtime.close();
    },
  );

  it.each([
    "tampered",
    "replayed",
    "future",
    "expired",
    "receipt-mutation",
  ] as const)("rejects %s target verification", async (failure) => {
    const value = await fixture("Z");
    if (failure === "expired") {
      value.target.beforeVerification = () =>
        value.clock.advance(30_001);
    }
    value.target.transformVerification = (_request, result) => {
      if (failure === "tampered") {
        return { ...result, evidenceHash: contentHash("9") };
      }
      if (failure === "replayed") {
        const material = {
          ...result,
          requestDigest: contentHash("8"),
        };
        const {
          evidenceHash: _evidenceHash,
          ...hashMaterial
        } = material;
        return {
          ...hashMaterial,
          evidenceHash: hashCanonicalValue(hashMaterial),
        } as TargetVerificationResult;
      }
      if (failure === "future") {
        const {
          evidenceHash: _evidenceHash,
          ...base
        } = result;
        const material = {
          ...base,
          checkedAt: "2026-07-28T12:00:01.000Z",
        };
        return {
          ...material,
          evidenceHash: hashCanonicalValue(material),
        } as TargetVerificationResult;
      }
      if (
        failure === "receipt-mutation" &&
        result.status === "verified-applied"
      ) {
        const {
          evidenceHash: _evidenceHash,
          ...base
        } = result;
        const material = {
          ...base,
          receipt: {
            ...result.receipt,
            appliedRevision: result.receipt.appliedRevision + 1,
          },
        };
        return {
          ...material,
          evidenceHash: hashCanonicalValue(material),
        };
      }
      return result;
    };

    await expect(
      value.commit({ claim: value.claim }),
    ).rejects.toThrow();
    expect(value.eventAllocations()).toBe(0);
    expect(canonicalCounts(value.path).counts.trace_events).toBe(0);
    value.runtime.close();
  });

  it("fails replay for tampered terminal rows and replays SQLite without target calls", async () => {
    const value = await fixture("R");
    await value.commit({ claim: value.claim });
    const replayCanvasTrace = value.runtime as unknown as {
      readonly replayCanvasTrace: (projectId: string) => unknown;
    };
    expect(replayCanvasTrace.replayCanvasTrace(
      value.command.projectId,
    )).toMatchObject({
      projectId: value.command.projectId,
      lastSequence: 1,
    });
    expect(value.target.verificationCalls).toHaveLength(1);

    const database = new DatabaseSync(value.path);
    database
      .prepare("UPDATE trace_events SET event_json = '{}'")
      .run();
    database.close();
    await expect(
      value.commit({ claim: value.claim }),
    ).rejects.toThrow(/trace|integrity|tamper|corrupt/i);
    expect(value.target.verificationCalls).toHaveLength(1);
    value.runtime.close();
  });

  it.each([
    [
      "receipt scalar",
      `UPDATE effect_receipts
       SET receipt_hash =
         'sha256:1111111111111111111111111111111111111111111111111111111111111111'`,
    ],
    [
      "binding request",
      `UPDATE trace_effect_bindings
       SET verification_request_digest =
         'sha256:2222222222222222222222222222222222222222222222222222222222222222'`,
    ],
    [
      "accepted attempt",
      `UPDATE target_verification_attempts SET state = 'rejected'`,
    ],
    [
      "projection hash",
      `UPDATE trace_projection_outbox
       SET event_hash =
         'sha256:3333333333333333333333333333333333333333333333333333333333333333'`,
    ],
    [
      "verification request JSON",
      `UPDATE target_verification_attempts SET request_json = '{}'`,
    ],
    ["orphaned binding", `DELETE FROM trace_effect_bindings`],
    [
      "all canonical rows",
      `DELETE FROM effect_receipts;
       DELETE FROM trace_effect_bindings;
       DELETE FROM target_verification_attempts;
       DELETE FROM trace_projection_outbox;
       DELETE FROM trace_heads;
       DELETE FROM trace_events`,
    ],
  ] as const)("fails closed on tampered %s", async (_label, sql) => {
    const value = await fixture("K");
    await value.commit({ claim: value.claim });
    const calls = value.target.verificationCalls.length;
    const database = new DatabaseSync(value.path);
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec(sql);
    database.close();

    expect(() =>
      value.runtime.replayCanvasTrace(value.command.projectId),
    ).toThrow(/integrity|authority|incomplete|missing|incoherent/i);
    expect(() => value.runtime.recover()).toThrow(
      /integrity|authority|incomplete|missing|incoherent/i,
    );
    await expect(
      value.commit({ claim: value.claim }),
    ).rejects.toThrow(
      /integrity|authority|incomplete|missing|incoherent/i,
    );
    expect(value.target.verificationCalls).toHaveLength(calls);
    value.runtime.close();
    expect(() =>
      new DurableRuntime({
        databasePath: value.path,
        clock: value.clock.now,
        effectExecutor: new ForbiddenExecutor(),
      }),
    ).toThrow(/integrity|authority|incomplete|missing|incoherent/i);
  });
});
