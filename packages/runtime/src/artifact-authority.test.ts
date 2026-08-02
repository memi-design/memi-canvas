import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { hashCanonicalValue } from "@memi/canonical-json";
import { afterEach, describe, expect, it } from "vitest";

import {
  OutboxRecordSchema,
  type DurableCommand,
  type TargetApplyOutcome,
  type TargetEffectRequest,
  type TargetFenceActivationRequest,
  type TargetFenceActivationResult,
  type TargetLookupRequest,
  type TargetLookupResult,
  type TargetVerificationRequest,
  type TargetVerificationResult,
} from "../../protocol/src/index.js";
import {
  DurableRuntime,
  type CanvasTargetAdapter,
  type EffectExecutor,
} from "./index.js";
import {
  MutableClock,
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

function databasePath(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-artifact-authority-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
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

class ForbiddenCanvasTarget implements CanvasTargetAdapter {
  applyCalls = 0;
  lookupCalls = 0;

  activateFence(
    _request: TargetFenceActivationRequest,
  ): Promise<TargetFenceActivationResult> {
    throw new Error("Fence activation is forbidden.");
  }

  compareAndApply(
    _request: TargetEffectRequest,
  ): Promise<TargetApplyOutcome> {
    this.applyCalls += 1;
    throw new Error("Canvas application is forbidden.");
  }

  lookup(
    _request: TargetLookupRequest,
  ): Promise<TargetLookupResult> {
    this.lookupCalls += 1;
    throw new Error("Canvas lookup is forbidden.");
  }

  verify(
    _request: TargetVerificationRequest,
  ): Promise<TargetVerificationResult> {
    throw new Error("Canvas verification is forbidden.");
  }
}

function artifactCommand(suffix: string): DurableCommand {
  return durableCommand({
    id: sortableId("cmd", suffix),
    kind: "artifact.persist",
    target: {
      kind: "artifact",
      id: `artifact:${suffix.toLowerCase()}`,
      expectedBeforeHash: contentHash("a"),
      baseline: {
        kind: "content-hash",
        value: contentHash("a"),
      },
    },
    idempotencyKey: sortableId("idem", suffix),
    authority: {
      capabilityGrantId: sortableId("grt", suffix),
      approvalReceiptId: sortableId("apr", suffix),
      leaseId: alternateLeaseId(suffix),
      fencingEpoch: 1,
    },
  });
}

function crossKindCommand(): DurableCommand {
  const base = durableCommand({
    id: sortableId("cmd", "T"),
    idempotencyKey: sortableId("idem", "T"),
    authority: {
      capabilityGrantId: sortableId("grt", "T"),
      approvalReceiptId: sortableId("apr", "T"),
      leaseId: alternateLeaseId("T"),
      fencingEpoch: 1,
    },
  });
  const effectPayload = commandSubmission(base).effectPayload;
  const payloadHash = hashCanonicalValue(effectPayload);
  const malformed = {
    ...base,
    kind: "artifact.persist" as const,
    payloadHash,
  };
  const {
    actionDigest: _actionDigest,
    id: _id,
    idempotencyKey: _idempotencyKey,
    payloadHash: _payloadHash,
    ...commandAction
  } = malformed;
  return {
    ...malformed,
    actionDigest: hashCanonicalValue({
      commandActionVersion: 1,
      ...commandAction,
      payloadHash,
    }),
  };
}

function runtime(
  path: string,
  target: ForbiddenCanvasTarget,
  executor: ForbiddenExecutor,
) {
  return new DurableRuntime({
    databasePath: path,
    clock: new MutableClock().now,
    canvasTarget: target,
    effectExecutor: executor,
  });
}

function authorize(
  instance: DurableRuntime,
  command: DurableCommand,
): void {
  instance.registerGrant(grantFor(command));
  instance.registerApprovalReceipt(approvalFor(command));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("artifact target authority quarantine", () => {
  it("rejects an artifact command bound to a canvas target before scheduling", async () => {
    const path = databasePath();
    const target = new ForbiddenCanvasTarget();
    const executor = new ForbiddenExecutor();
    const instance = runtime(path, target, executor);
    const command = crossKindCommand();
    authorize(instance, command);

    expect(() =>
      instance.submitCommand(commandSubmission(command)),
    ).toThrow(/target kind/i);
    expect(
      instance.claimNextEffect({
        workerId: "cross-kind-claim",
        claimTtlMilliseconds: 1_000,
      }),
    ).toBeNull();
    await expect(
      instance.applyNextEffect({
        workerId: "cross-kind-apply",
        claimTtlMilliseconds: 1_000,
      }),
    ).resolves.toBeNull();
    expect(target.applyCalls).toBe(0);
    expect(target.lookupCalls).toBe(0);
    expect(executor.calls).toBe(0);

    const database = new DatabaseSync(path);
    const rows = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM target_schedule_latches`,
      )
      .get() as { readonly count: number };
    database.close();
    expect(rows.count).toBe(0);
    instance.close();
  });

  it("filters a prior cross-kind row by durable command kind", async () => {
    const path = databasePath();
    const seedTarget = new ForbiddenCanvasTarget();
    const seedExecutor = new ForbiddenExecutor();
    const seed = runtime(path, seedTarget, seedExecutor);
    const command = artifactCommand("V");
    authorize(seed, command);
    seed.submitCommand(
      commandSubmission(command, alternateOutboxId("V")),
    );
    seed.close();

    const canvasTargetId = sortableId("doc", "V");
    const malformed = {
      ...command,
      target: {
        kind: "canvas-document" as const,
        id: canvasTargetId,
        expectedBeforeHash: contentHash("a"),
        baseline: {
          kind: "canvas-revision" as const,
          revision: 1,
          stateHash: contentHash("a"),
        },
      },
    };
    const database = new DatabaseSync(path);
    database.exec("PRAGMA foreign_keys = OFF");
    database
      .prepare(
        `UPDATE commands
         SET target_kind = 'canvas-document', target_id = ?,
             command_json = ?
         WHERE id = ?`,
      )
      .run(canvasTargetId, JSON.stringify(malformed), command.id);
    const outboxRow = database
      .prepare(
        `SELECT record_json FROM outbox WHERE command_id = ?`,
      )
      .get(command.id) as { readonly record_json: string };
    const outbox = OutboxRecordSchema.parse(
      JSON.parse(outboxRow.record_json),
    );
    database
      .prepare(
        `UPDATE outbox
         SET target_kind = 'canvas-document', target_id = ?,
             record_json = ?
         WHERE command_id = ?`,
      )
      .run(
        canvasTargetId,
        JSON.stringify({
          ...outbox,
          effect: {
            ...outbox.effect,
            targetId: canvasTargetId,
          },
        }),
        command.id,
      );
    database.exec("PRAGMA foreign_keys = ON");
    database.close();

    const target = new ForbiddenCanvasTarget();
    const executor = new ForbiddenExecutor();
    const reopened = runtime(path, target, executor);
    expect(
      reopened.claimNextEffect({
        workerId: "prior-cross-kind",
        claimTtlMilliseconds: 1_000,
      }),
    ).toBeNull();
    await expect(
      reopened.applyNextEffect({
        workerId: "prior-cross-kind-apply",
        claimTtlMilliseconds: 1_000,
      }),
    ).resolves.toBeNull();
    expect(reopened.recover().blockedOutcomeUnknown).toEqual([
      command.id,
    ]);
    expect(target.applyCalls).toBe(0);
    expect(target.lookupCalls).toBe(0);
    expect(executor.calls).toBe(0);
    reopened.close();
  });

  it("quarantines pre-fix v5 artifact evidence without fabricating a receipt", () => {
    const path = databasePath();
    const target = new ForbiddenCanvasTarget();
    const executor = new ForbiddenExecutor();
    const seed = runtime(path, target, executor);
    const command = artifactCommand("W");
    authorize(seed, command);
    seed.submitCommand(
      commandSubmission(command, alternateOutboxId("W")),
    );
    seed.close();

    const database = new DatabaseSync(path);
    const row = database
      .prepare(
        `SELECT record_json FROM outbox WHERE command_id = ?`,
      )
      .get(command.id) as { readonly record_json: string };
    const intent = OutboxRecordSchema.parse(
      JSON.parse(row.record_json),
    );
    const applied = OutboxRecordSchema.parse({
      ...intent,
      phase: "effect-applied",
      appliedAt: "2026-07-28T12:00:01.000Z",
      resultingHash: contentHash("e"),
    });
    database
      .prepare(
        `UPDATE outbox SET phase = 'effect-applied', record_json = ?
         WHERE command_id = ?`,
      )
      .run(JSON.stringify(applied), command.id);
    database
      .prepare("UPDATE commands SET state = 'effect-applied' WHERE id = ?")
      .run(command.id);
    database
      .prepare(
        `INSERT INTO legacy_effect_receipts (
           command_id, receipt_json
         )
         VALUES (?, ?)`,
      )
      .run(
        command.id,
        JSON.stringify({
          pending: true,
          executorReceipt: { kind: "legacy-artifact" },
        }),
      );
    database
      .prepare(
        `INSERT INTO target_schedule_latches (
          project_id, target_kind, target_id, command_id, outbox_id,
          state, worker_claim_id, claim_epoch, acquired_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending-fence', ?, 1, ?, ?)`,
      )
      .run(
        command.projectId,
        command.target.kind,
        command.target.id,
        command.id,
        applied.id,
        `${applied.id}:1`,
        command.issuedAt,
        command.issuedAt,
      );
    database.close();

    const reopened = runtime(path, target, executor);
    expect(reopened.recover()).toEqual({
      intentsAwaitingEffect: [],
      effectsAwaitingCommit: [],
      blockedOutcomeUnknown: [command.id],
    });
    expect(() =>
      reopened.claimEffectCommit({
        commandId: command.id,
        workerId: "must-not-commit-artifact",
        claimTtlMilliseconds: 1_000,
      }),
    ).toThrow(/authoritative artifact receipt/i);
    reopened.close();

    const inspected = new DatabaseSync(path);
    const latch = inspected
      .prepare(
        `SELECT state, recovery_json
         FROM target_schedule_latches WHERE command_id = ?`,
      )
      .get(command.id);
    const targetReceipt = inspected
      .prepare(
        `SELECT receipt_json FROM target_receipts
         WHERE command_id = ?`,
      )
      .get(command.id);
    const legacyReceipt = inspected
      .prepare(
        `SELECT receipt_json FROM legacy_effect_receipts
         WHERE command_id = ?`,
      )
      .get(command.id);
    inspected.close();
    expect(latch).toMatchObject({
      state: "blocked-unknown",
      recovery_json: expect.stringContaining(
        '"status":"authority-unavailable"',
      ),
    });
    expect(targetReceipt).toBeUndefined();
    expect(legacyReceipt).toBeDefined();
  });
});
