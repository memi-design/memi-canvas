import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  CanvasOperationSchema,
  CanvasDocumentIdSchema,
  LeaseSchema,
  TargetApplyOutcomeSchema,
  TargetFenceActivationResultSchema,
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
  StaleLeaseError,
  bindCommandAction,
  type CanvasTargetAdapter,
} from "./index.js";
import {
  RUNTIME_SCHEMA_V6,
  leasesTableSchemaV3,
} from "./schema.js";
import {
  MutableClock,
  RecordingEffectExecutor,
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
  readonly directory: string;
  readonly databasePath: string;
} {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-canvas-fence-"),
  );
  temporaryDirectories.push(directory);
  return {
    directory,
    databasePath: join(directory, "runtime.sqlite"),
  };
}

class RecordingCanvasTarget implements CanvasTargetAdapter {
  readonly activationCalls: TargetFenceActivationRequest[] = [];
  readonly compareCalls: TargetEffectRequest[] = [];
  activationStatus:
    | "activated"
    | "replayed"
    | "rejected" = "activated";
  beforeActivation?: () => void;

  activateFence(
    request: TargetFenceActivationRequest,
  ) {
    this.activationCalls.push(request);
    this.beforeActivation?.();
    return TargetFenceActivationResultSchema.parse({
      ...request,
      status: this.activationStatus,
      highestFence:
        this.activationStatus === "rejected"
          ? request.fencingEpoch + 1
          : request.fencingEpoch,
      ...(this.activationStatus === "rejected"
        ? { code: "STALE_FENCE" as const }
        : {}),
    });
  }

  compareAndApply(
    request: TargetEffectRequest,
  ): TargetApplyOutcome {
    this.compareCalls.push(request);
    return TargetApplyOutcomeSchema.parse({
      schemaVersion: 1,
      status: "not-applied",
      evidence: {
        code: "APPLY_REJECTED",
        message: "Target rejected before applying.",
        currentTargetHash: request.target.expectedBeforeHash,
        evidenceHash: contentHash("e"),
      },
    });
  }

  lookup(
    _request: TargetLookupRequest,
  ): Promise<TargetLookupResult> {
    throw new Error("Lookup is outside this phase.");
  }

  verify(
    _request: TargetVerificationRequest,
  ): Promise<TargetVerificationResult> {
    throw new Error("Verification is outside this phase.");
  }
}

function canvasCommand(suffix: string) {
  const documentId = CanvasDocumentIdSchema.parse(
    sortableId("doc", suffix),
  );
  return durableCommand({
    id: sortableId("cmd", suffix),
    idempotencyKey: sortableId("idem", suffix),
    target: {
      kind: "canvas-document",
      id: documentId,
      expectedBeforeHash: contentHash("a"),
      baseline: {
        kind: "canvas-revision",
        revision: 1,
        stateHash: contentHash("a"),
      },
    },
    authority: {
      capabilityGrantId: sortableId("grt", suffix),
      approvalReceiptId: sortableId("apr", suffix),
      leaseId: alternateLeaseId(suffix),
      fencingEpoch: 1,
    },
  });
}

function canvasOperation(
  command: ReturnType<typeof canvasCommand>,
  suffix: string,
) {
  return CanvasOperationSchema.parse({
    schemaVersion: 1,
    id: sortableId("opn", suffix),
    documentId: command.target.id,
    actorId: command.issuerId,
    occurredAt: command.issuedAt,
    actionDigest: contentHash("d"),
    expectedBeforeHash: command.target.expectedBeforeHash,
    resultingHash: contentHash("e"),
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

function runtime(
  databasePath: string,
  target: CanvasTargetAdapter,
  clock = new MutableClock(),
  faults?: {
    readonly afterTargetFenceRecorded?: () => void;
  },
) {
  return new DurableRuntime({
    databasePath,
    clock: clock.now,
    canvasTarget: target,
    effectExecutor: new RecordingEffectExecutor(),
    ...(faults === undefined ? {} : { runtimeFaults: faults }),
  });
}

function leasePhase(path: string): string {
  const database = new DatabaseSync(path);
  const row = database
    .prepare("SELECT phase FROM leases")
    .get() as { readonly phase: string };
  database.close();
  return row.phase;
}

function seedVersionThreeLease(
  path: string,
  command: ReturnType<typeof canvasCommand>,
) {
  const lease = LeaseSchema.parse({
    schemaVersion: 1,
    id: command.authority.leaseId,
    projectId: command.projectId,
    targetId: command.target.id,
    holderId: command.issuerId,
    fencingEpoch: command.authority.fencingEpoch,
    acquiredAt: command.issuedAt,
    expiresAt: "2026-07-28T13:00:00.000Z",
  });
  const database = new DatabaseSync(path);
  database.exec(RUNTIME_SCHEMA_V6);
  database.exec("DROP TABLE target_recovery_evidence");
  database.exec("DROP TABLE leases");
  database.exec(leasesTableSchemaV3());
  database
    .prepare(
      `INSERT INTO leases (
        id, project_id, target_id, holder_id, fencing_epoch,
        acquired_at, expires_at, lease_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      lease.id,
      lease.projectId,
      lease.targetId,
      lease.holderId,
      lease.fencingEpoch,
      lease.acquiredAt,
      lease.expiresAt,
      JSON.stringify(lease),
    );
  database.exec("PRAGMA user_version = 3");
  database.close();
  return lease;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("canvas lease target-fence handshake", () => {
  it("migrates a direct v3 lease without fabricating target activation", async () => {
    const fixture = paths();
    const target = new RecordingCanvasTarget();
    const baseCommand = canvasCommand("Q");
    const payload = canvasOperation(baseCommand, "Q");
    const command = bindCommandAction(baseCommand, payload);
    const lease = seedVersionThreeLease(
      fixture.databasePath,
      command,
    );
    const instance = runtime(fixture.databasePath, target);

    const migrated = new DatabaseSync(fixture.databasePath);
    const beforeActivation = migrated
      .prepare(
        `SELECT phase, target_activated_at, activated_at,
                activation_json
         FROM leases WHERE id = ?`,
      )
      .get(lease.id);
    migrated.close();
    expect(beforeActivation).toEqual({
      phase: "pending-fence",
      target_activated_at: null,
      activated_at: null,
      activation_json: null,
    });

    instance.registerGrant(grantFor(command));
    instance.registerApprovalReceipt(approvalFor(command));
    instance.submitCommand({
      command,
      outboxId: alternateOutboxId("Q"),
      effectPayload: payload,
    });
    const claim = instance.claimNextEffect({
      workerId: "pre-activation-worker",
      claimTtlMilliseconds: 1_000,
    });
    await expect(
      instance.applyClaimedEffect(claim!),
    ).rejects.toThrow(
      expect.objectContaining<Partial<StaleLeaseError>>({
        code: "LEASE_NOT_ACTIVE",
      }),
    );
    expect(target.compareCalls).toHaveLength(0);

    await instance.activateCanvasLease({
      projectId: lease.projectId,
      targetId: lease.targetId,
      leaseId: lease.id,
      fencingEpoch: lease.fencingEpoch,
    });
    expect(target.activationCalls).toHaveLength(1);
    expect(leasePhase(fixture.databasePath)).toBe("active");
    expect(target.compareCalls).toHaveLength(0);

    await expect(
      instance.applyClaimedEffect(claim!),
    ).rejects.toThrow("Target rejected before applying.");
    expect(target.compareCalls).toHaveLength(1);
    instance.close();
  });

  it("keeps dispatch disabled until target activation is durably active", async () => {
    const fixture = paths();
    const target = new RecordingCanvasTarget();
    const instance = runtime(fixture.databasePath, target);
    const baseCommand = canvasCommand("F");
    const payload = canvasOperation(baseCommand, "F");
    const command = bindCommandAction(baseCommand, payload);
    instance.registerGrant(grantFor(command));
    instance.registerApprovalReceipt(approvalFor(command));
    instance.submitCommand({
      command,
      outboxId: alternateOutboxId("F"),
      effectPayload: payload,
    });
    const lease = instance.acquireLease({
      leaseId: command.authority.leaseId,
      projectId: command.projectId,
      targetId: command.target.id,
      holderId: command.issuerId,
      ttlMilliseconds: 5_000,
    });

    expect(leasePhase(fixture.databasePath)).toBe("pending-fence");
    expect(() =>
      instance.assertLease({
        projectId: lease.projectId,
        targetId: lease.targetId,
        leaseId: lease.id,
        fencingEpoch: lease.fencingEpoch,
      }),
    ).toThrow(
      expect.objectContaining<Partial<StaleLeaseError>>({
        code: "LEASE_NOT_ACTIVE",
      }),
    );
    const claim = instance.claimNextEffect({
      workerId: "worker-before-fence",
      claimTtlMilliseconds: 1_000,
    });
    await expect(
      instance.applyClaimedEffect(claim!),
    ).rejects.toThrow(
      expect.objectContaining<Partial<StaleLeaseError>>({
        code: "LEASE_NOT_ACTIVE",
      }),
    );

    await instance.activateCanvasLease({
      projectId: lease.projectId,
      targetId: lease.targetId,
      leaseId: lease.id,
      fencingEpoch: lease.fencingEpoch,
    });
    expect(leasePhase(fixture.databasePath)).toBe("active");
    expect(instance.assertLease({
      projectId: lease.projectId,
      targetId: lease.targetId,
      leaseId: lease.id,
      fencingEpoch: lease.fencingEpoch,
    })).toEqual(lease);
    expect(target.activationCalls).toHaveLength(1);
    instance.close();
  });

  it("calls target activation without holding the runtime write transaction", async () => {
    const fixture = paths();
    const target = new RecordingCanvasTarget();
    const instance = runtime(fixture.databasePath, target);
    const command = canvasCommand("G");
    const lease = instance.acquireLease({
      leaseId: command.authority.leaseId,
      projectId: command.projectId,
      targetId: command.target.id,
      holderId: command.issuerId,
      ttlMilliseconds: 5_000,
    });
    target.beforeActivation = () => {
      const concurrent = new DatabaseSync(fixture.databasePath, {
        timeout: 50,
      });
      concurrent.exec("BEGIN IMMEDIATE");
      concurrent.exec("ROLLBACK");
      concurrent.close();
    };

    await expect(
      instance.activateCanvasLease({
        projectId: lease.projectId,
        targetId: lease.targetId,
        leaseId: lease.id,
        fencingEpoch: lease.fencingEpoch,
      }),
    ).resolves.toEqual(lease);
    instance.close();
  });

  it("keeps rejected activation pending and never treats it as active", async () => {
    const fixture = paths();
    const target = new RecordingCanvasTarget();
    target.activationStatus = "rejected";
    const instance = runtime(fixture.databasePath, target);
    const command = canvasCommand("H");
    const lease = instance.acquireLease({
      leaseId: command.authority.leaseId,
      projectId: command.projectId,
      targetId: command.target.id,
      holderId: command.issuerId,
      ttlMilliseconds: 5_000,
    });

    await expect(
      instance.activateCanvasLease({
        projectId: lease.projectId,
        targetId: lease.targetId,
        leaseId: lease.id,
        fencingEpoch: lease.fencingEpoch,
      }),
    ).rejects.toThrow(
      expect.objectContaining<Partial<StaleLeaseError>>({
        code: "STALE_FENCE",
      }),
    );
    expect(leasePhase(fixture.databasePath)).toBe("pending-fence");
    expect(() =>
      instance.assertLease({
        projectId: lease.projectId,
        targetId: lease.targetId,
        leaseId: lease.id,
        fencingEpoch: lease.fencingEpoch,
      }),
    ).toThrow(
      expect.objectContaining<Partial<StaleLeaseError>>({
        code: "LEASE_NOT_ACTIVE",
      }),
    );
    instance.close();
  });

  it("replays a recorded target activation after restart before finalizing active", async () => {
    const fixture = paths();
    const firstTarget = new RecordingCanvasTarget();
    const first = runtime(
      fixture.databasePath,
      firstTarget,
      new MutableClock(),
      {
        afterTargetFenceRecorded: () => {
          throw new Error("crash after target activation record");
        },
      },
    );
    const command = canvasCommand("J");
    const lease = first.acquireLease({
      leaseId: command.authority.leaseId,
      projectId: command.projectId,
      targetId: command.target.id,
      holderId: command.issuerId,
      ttlMilliseconds: 5_000,
    });
    await expect(
      first.activateCanvasLease({
        projectId: lease.projectId,
        targetId: lease.targetId,
        leaseId: lease.id,
        fencingEpoch: lease.fencingEpoch,
      }),
    ).rejects.toThrow("crash after target activation record");
    expect(leasePhase(fixture.databasePath)).toBe("target-activated");
    first.close();

    const replayTarget = new RecordingCanvasTarget();
    replayTarget.activationStatus = "replayed";
    const reopened = runtime(fixture.databasePath, replayTarget);
    await expect(
      reopened.activateCanvasLease({
        projectId: lease.projectId,
        targetId: lease.targetId,
        leaseId: lease.id,
        fencingEpoch: lease.fencingEpoch,
      }),
    ).resolves.toEqual(lease);
    expect(leasePhase(fixture.databasePath)).toBe("active");
    expect(replayTarget.activationCalls).toHaveLength(1);
    reopened.close();
  });
});
