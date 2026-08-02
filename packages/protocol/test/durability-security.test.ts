import { describe, expect, it } from "vitest";
import {
  ArtifactClassificationSchema,
  ArtifactDescriptorSchema,
  CapabilityGrantSchema,
  CapturePlanSchema,
  CheckpointSchema,
  LeaseSchema,
  OutboxRecordSchema,
  RecoveryRecordSchema,
} from "../src/index.js";
import { hash, ids, nextHash, timestamp } from "./fixtures.js";

describe("OutboxRecord transaction phases", () => {
  const intent = {
    schemaVersion: 1,
    id: ids.outbox,
    commandId: "cmd_01J00000000000000000000000",
    projectId: ids.project,
    idempotencyKey: "idem_01J00000000000000000000000",
    actionDigest: hash,
    phase: "intent",
    effect: {
      kind: "canvas.operation",
      targetId: ids.canvasDocument,
      expectedBeforeHash: hash,
      payloadHash: nextHash,
    },
    createdAt: timestamp,
  } as const;

  it("accepts a durable intent before any external effect", () => {
    expect(OutboxRecordSchema.parse(intent)).toEqual(intent);
  });

  it("requires a verified result hash once the effect is applied", () => {
    expect(
      OutboxRecordSchema.parse({
        ...intent,
        phase: "effect-applied",
        appliedAt: timestamp,
        resultingHash: nextHash,
      }).phase,
    ).toBe("effect-applied");
    expect(
      OutboxRecordSchema.safeParse({
        ...intent,
        phase: "effect-applied",
        appliedAt: timestamp,
      }).success,
    ).toBe(false);
  });

  it("requires terminal evidence for committed and failed phases", () => {
    expect(
      OutboxRecordSchema.parse({
        ...intent,
        phase: "committed",
        appliedAt: timestamp,
        resultingHash: nextHash,
        committedAt: timestamp,
        traceEventId: ids.traceEvent,
      }).phase,
    ).toBe("committed");
    expect(
      OutboxRecordSchema.parse({
        ...intent,
        phase: "failed",
        failedFrom: "intent",
        failedAt: timestamp,
        error: {
          code: "EXPECTED_HASH_MISMATCH",
          message: "Target changed before effect application.",
          retryable: false,
        },
      }).phase,
    ).toBe("failed");
    expect(
      OutboxRecordSchema.safeParse({
        ...intent,
        phase: "committed",
        committedAt: timestamp,
      }).success,
    ).toBe(false);
  });
});

describe("CapturePlan", () => {
  const capturePlan = {
    schemaVersion: 1,
    id: "cap_01J00000000000000000000000",
    projectId: ids.project,
    sourceRevision: "0123456789abcdef0123456789abcdef01234567",
    budgets: {
      maxCells: 100,
      maxRuntimeSeconds: 900,
      maxConcurrency: 2,
      maxBrowserStorageBytes: 10_000_000,
      maxArtifactBytes: 100_000_000,
    },
    cells: [
      {
        coverageCellId: ids.coverageCell,
        priority: "critical",
        status: "planned",
      },
    ],
  } as const;

  it("requires explicit bounded resource budgets", () => {
    expect(CapturePlanSchema.parse(capturePlan)).toEqual(capturePlan);
    expect(
      CapturePlanSchema.safeParse({
        ...capturePlan,
        budgets: { ...capturePlan.budgets, maxCells: 0 },
      }).success,
    ).toBe(false);
  });

  it("keeps omitted and blocked capture cells reason-coded", () => {
    for (const status of ["omitted", "blocked"] as const) {
      expect(
        CapturePlanSchema.safeParse({
          ...capturePlan,
          cells: [
            {
              ...capturePlan.cells[0],
              status,
            },
          ],
        }).success,
      ).toBe(false);
      expect(
        CapturePlanSchema.safeParse({
          ...capturePlan,
          cells: [
            {
              ...capturePlan.cells[0],
              status,
              reason: "runtime-provider-unavailable",
            },
          ],
        }).success,
      ).toBe(true);
    }
  });
});

describe("artifact privacy classification", () => {
  it.each([
    "public",
    "project-private",
    "sensitive",
    "authentication",
    "prohibited",
  ])("accepts the closed classification %s", (classification) => {
    expect(ArtifactClassificationSchema.parse(classification)).toBe(
      classification,
    );
  });

  it("never permits authentication or prohibited content in the CAS", () => {
    for (const classification of ["authentication", "prohibited"] as const) {
      expect(
        ArtifactDescriptorSchema.safeParse({
          schemaVersion: 1,
          id: ids.artifact,
          projectId: ids.project,
          contentHash: hash,
          byteLength: 128,
          mediaType: "application/json",
          classification,
          storage: "content-addressed",
          redaction: "complete",
          createdAt: timestamp,
        }).success,
      ).toBe(false);
    }
  });

  it("requires redaction before sensitive content becomes durable", () => {
    expect(
      ArtifactDescriptorSchema.safeParse({
        schemaVersion: 1,
        id: ids.artifact,
        projectId: ids.project,
        contentHash: hash,
        byteLength: 128,
        mediaType: "application/json",
        classification: "sensitive",
        storage: "content-addressed",
        redaction: "pending",
        createdAt: timestamp,
      }).success,
    ).toBe(false);
  });
});

describe("capability grants and fenced leases", () => {
  const grant = {
    schemaVersion: 1,
    id: ids.capabilityGrant,
    projectId: ids.project,
    clientId: "local-codex",
    capabilities: ["canvas:read", "source:propose"],
    constraints: {
      canonicalPaths: ["/workspace/product/src"],
      allowedHosts: [],
      actionDigest: hash,
      maximumUses: 1,
    },
    issuedAt: timestamp,
    expiresAt: "2026-07-28T12:05:00.000Z",
  } as const;

  it("accepts only closed capability names and constrained grants", () => {
    expect(CapabilityGrantSchema.parse(grant)).toEqual(grant);
    expect(
      CapabilityGrantSchema.safeParse({
        ...grant,
        capabilities: ["shell:arbitrary"],
      }).success,
    ).toBe(false);
  });

  it("rejects unbounded mutating grants", () => {
    expect(
      CapabilityGrantSchema.safeParse({
        ...grant,
        capabilities: ["source:apply"],
        constraints: {
          canonicalPaths: [],
          allowedHosts: [],
          maximumUses: 0,
        },
      }).success,
    ).toBe(false);
  });

  it("requires a positive fencing epoch and matching project/target scope", () => {
    const lease = {
      schemaVersion: 1,
      id: ids.lease,
      projectId: ids.project,
      targetId: ids.canvasDocument,
      holderId: "local-codex",
      fencingEpoch: 1,
      acquiredAt: timestamp,
      expiresAt: "2026-07-28T12:01:00.000Z",
    } as const;

    expect(LeaseSchema.parse(lease)).toEqual(lease);
    expect(
      LeaseSchema.safeParse({ ...lease, fencingEpoch: 0 }).success,
    ).toBe(false);
  });
});

describe("checkpoint and recovery contracts", () => {
  const checkpoint = {
    schemaVersion: 1,
    id: ids.checkpoint,
    projectId: ids.project,
    kind: "canvas-task",
    createdAt: timestamp,
    canvas: {
      documentId: ids.canvasDocument,
      operationCursor: ids.operation,
      stateHash: hash,
    },
    task: {
      taskId: ids.task,
      runId: ids.run,
      traceSequence: 1,
    },
    source: null,
  } as const;

  it("accepts source-free canvas checkpoints", () => {
    expect(CheckpointSchema.parse(checkpoint)).toEqual(checkpoint);
  });

  it("requires worktree and baseline hashes for source checkpoints", () => {
    expect(
      CheckpointSchema.safeParse({
        ...checkpoint,
        kind: "changeset",
        source: null,
      }).success,
    ).toBe(false);
    expect(
      CheckpointSchema.safeParse({
        ...checkpoint,
        kind: "changeset",
        source: {
          changeSetId: ids.changeSet,
          worktreeId: "wrk_01J00000000000000000000000",
          baselineCommit: "0123456789abcdef0123456789abcdef01234567",
          treeHash: hash,
        },
      }).success,
    ).toBe(true);
  });

  it("distinguishes replay, fork, pre-commit restore, and post-commit revert", () => {
    const base = {
      schemaVersion: 1,
      id: ids.recoveryAttempt,
      projectId: ids.project,
      checkpointId: ids.checkpoint,
      requestedAt: timestamp,
      status: "requested",
    } as const;

    for (const action of [
      "replay-read-only",
      "fork-from-checkpoint",
      "restore-pre-commit-worktree",
      "revert-post-commit",
    ] as const) {
      expect(RecoveryRecordSchema.parse({ ...base, action }).action).toBe(
        action,
      );
    }
    expect(
      RecoveryRecordSchema.safeParse({
        ...base,
        action: "restore",
      }).success,
    ).toBe(false);
  });
});
