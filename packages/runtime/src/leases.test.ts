import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DurableRuntime,
  LeaseConflictError,
  StaleLeaseError,
} from "./index.js";
import {
  MutableClock,
  PROJECT_ID,
  RecordingEffectExecutor,
  alternateLeaseId,
} from "./test-fixtures.js";

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-runtime-lease-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

function runtime(path: string, clock: MutableClock) {
  return new DurableRuntime({
    databasePath: path,
    clock: clock.now,
    effectExecutor: new RecordingEffectExecutor(),
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("lease fencing", () => {
  it("rejects invalid TTLs and assertions without a lease", () => {
    const path = databasePath();
    const clock = new MutableClock();
    const instance = runtime(path, clock);

    expect(() =>
      instance.acquireLease({
        leaseId: alternateLeaseId("6"),
        projectId: PROJECT_ID,
        targetId: "canvas:node:invalid",
        holderId: "agent-a",
        ttlMilliseconds: 0,
      }),
    ).toThrow("Lease TTL must be a positive integer.");
    expect(() =>
      instance.assertLease({
        projectId: PROJECT_ID,
        targetId: "canvas:node:missing",
        leaseId: alternateLeaseId("7"),
        fencingEpoch: 1,
      }),
    ).toThrow(
      expect.objectContaining<Partial<StaleLeaseError>>({
        code: "LEASE_NOT_ACTIVE",
      }),
    );
    instance.close();
  });

  it("allows exactly one concurrent holder for a target", async () => {
    const path = databasePath();
    const clock = new MutableClock();
    const first = runtime(path, clock);
    const second = runtime(path, clock);
    const target = "canvas:node:shared";

    const attempts = await Promise.allSettled([
      Promise.resolve().then(() =>
        first.acquireLease({
          leaseId: alternateLeaseId("2"),
          projectId: PROJECT_ID,
          targetId: target,
          holderId: "agent-a",
          ttlMilliseconds: 5_000,
        }),
      ),
      Promise.resolve().then(() =>
        second.acquireLease({
          leaseId: alternateLeaseId("3"),
          projectId: PROJECT_ID,
          targetId: target,
          holderId: "agent-b",
          ttlMilliseconds: 5_000,
        }),
      ),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    const rejection = attempts.find(
      (attempt) => attempt.status === "rejected",
    );
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining<Partial<LeaseConflictError>>({
        code: "LEASE_HELD",
      }),
    });
    first.close();
    second.close();
  });

  it("increments fencing and rejects the stale holder after expiry", () => {
    const path = databasePath();
    const clock = new MutableClock();
    const first = runtime(path, clock);
    const second = runtime(path, clock);
    const targetId = "canvas:node:fenced";
    const original = first.acquireLease({
      leaseId: alternateLeaseId("4"),
      projectId: PROJECT_ID,
      targetId,
      holderId: "agent-a",
      ttlMilliseconds: 1_000,
    });
    expect(original.fencingEpoch).toBe(1);

    clock.advance(1_001);
    const replacement = second.acquireLease({
      leaseId: alternateLeaseId("5"),
      projectId: PROJECT_ID,
      targetId,
      holderId: "agent-b",
      ttlMilliseconds: 1_000,
    });
    expect(replacement.fencingEpoch).toBe(2);

    expect(() =>
      first.assertLease({
        projectId: PROJECT_ID,
        targetId,
        leaseId: original.id,
        fencingEpoch: original.fencingEpoch,
      }),
    ).toThrow(
      expect.objectContaining<Partial<StaleLeaseError>>({
        code: "STALE_FENCE",
      }),
    );
    expect(() =>
      second.assertLease({
        projectId: PROJECT_ID,
        targetId,
        leaseId: replacement.id,
        fencingEpoch: 1,
      }),
    ).toThrow(
      expect.objectContaining<Partial<StaleLeaseError>>({
        code: "STALE_FENCE",
      }),
    );
    first.close();
    second.close();
  });

  it("rejects an expired lease before any replacement", () => {
    const path = databasePath();
    const clock = new MutableClock();
    const instance = runtime(path, clock);
    const lease = instance.acquireLease({
      leaseId: alternateLeaseId("8"),
      projectId: PROJECT_ID,
      targetId: "canvas:node:expired",
      holderId: "agent-a",
      ttlMilliseconds: 1_000,
    });
    clock.advance(1_001);

    expect(() =>
      instance.assertLease({
        projectId: PROJECT_ID,
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
});
