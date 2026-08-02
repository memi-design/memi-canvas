import { describe, expect, it, vi } from "vitest";
import type { ImportPurgeAllResultV1 } from "@memi/protocol";

import {
  recoverRuntimeAtStartup,
  recoverRuntimeBeforeServing,
} from "./runtime-startup-recovery.js";

const complete: ImportPurgeAllResultV1 = {
  complete: true,
  counts: {
    artifacts: 0,
    jobs: 0,
    managedWorktrees: 0,
    pendingPlans: 0,
    plans: 0,
    projectBindings: 0,
    simulatorAuthorities: 0,
  },
  failures: [],
};

describe("runtime startup recovery", () => {
  it("recovers durable jobs before serving without destructively collecting storage", async () => {
    const purgeAll = vi.fn();
    const recoverInterrupted = vi.fn(async () => []);
    const startupGarbageCollect = vi.fn(async () => ({}));

    await recoverRuntimeBeforeServing({
      purgeAuthority: {
        purgeRecoveryPending: vi.fn(async () => false),
      },
      coordinator: { purgeAll, recoverInterrupted },
      storageBudgetAuthority: { startupGarbageCollect },
    });

    expect(recoverInterrupted).toHaveBeenCalledTimes(1);
    expect(purgeAll).not.toHaveBeenCalled();
    expect(startupGarbageCollect).not.toHaveBeenCalled();
  });

  it("keeps the shell available when a legacy plan signature cannot be recovered", async () => {
    const recoverInterrupted = vi.fn(async () => {
      throw new Error("Stored import execution plan integrity is invalid.");
    });

    await expect(
      recoverRuntimeBeforeServing({
        purgeAuthority: {
          purgeRecoveryPending: vi.fn(async () => false),
        },
        coordinator: { purgeAll: vi.fn(), recoverInterrupted },
      }),
    ).resolves.toBeUndefined();

    expect(recoverInterrupted).toHaveBeenCalledTimes(1);
  });

  it("still fails closed for an unrelated durable recovery error", async () => {
    await expect(
      recoverRuntimeBeforeServing({
        purgeAuthority: {
          purgeRecoveryPending: vi.fn(async () => false),
        },
        coordinator: {
          purgeAll: vi.fn(),
          recoverInterrupted: vi.fn(async () => {
            throw new Error("runtime sqlite is unavailable");
          }),
        },
      }),
    ).rejects.toThrow("runtime sqlite is unavailable");
  });

  it("finishes a crash-interrupted purge before any job recovery", async () => {
    const purgeRecoveryPending = vi.fn(async () => true);
    const purgeAll = vi.fn(async () => complete);
    const recoverInterrupted = vi.fn();

    await recoverRuntimeAtStartup({
      purgeAuthority: { purgeRecoveryPending },
      coordinator: { purgeAll, recoverInterrupted },
    });

    expect(purgeAll).toHaveBeenCalledTimes(1);
    expect(recoverInterrupted).not.toHaveBeenCalled();
  });

  it("recovers jobs only when no durable purge is pending", async () => {
    const purgeAll = vi.fn();
    const recoverInterrupted = vi.fn(async () => []);

    await recoverRuntimeAtStartup({
      purgeAuthority: {
        purgeRecoveryPending: vi.fn(async () => false),
      },
      coordinator: { purgeAll, recoverInterrupted },
    });

    expect(recoverInterrupted).toHaveBeenCalledTimes(1);
    expect(purgeAll).not.toHaveBeenCalled();
  });

  it("garbage-collects only unreferenced storage after durable recovery", async () => {
    const artifactReferences = [{
      id: "art_AAAAAAAAAAAAAAAAAAAAAAAAAA" as const,
      hash: `sha256:${"a".repeat(64)}` as const,
      extension: "png",
    }];
    const listRetainedArtifactReferences = vi.fn(async () =>
      artifactReferences);
    const startupGarbageCollect = vi.fn(async () => ({}));

    await recoverRuntimeAtStartup({
      purgeAuthority: {
        purgeRecoveryPending: vi.fn(async () => false),
      },
      coordinator: {
        purgeAll: vi.fn(),
        recoverInterrupted: vi.fn(async () => []),
        listRetainedArtifactReferences,
      },
      storageBudgetAuthority: { startupGarbageCollect },
    });

    expect(listRetainedArtifactReferences).toHaveBeenCalledTimes(1);
    expect(startupGarbageCollect).toHaveBeenCalledWith({
      artifactReferences,
    });
  });

  it("fails startup closed when an interrupted purge remains incomplete", async () => {
    const recoverInterrupted = vi.fn();

    await expect(
      recoverRuntimeAtStartup({
        purgeAuthority: {
          purgeRecoveryPending: vi.fn(async () => true),
        },
        coordinator: {
          purgeAll: vi.fn(async (): Promise<ImportPurgeAllResultV1> => ({
            ...complete,
            complete: false,
            failures: [{
              category: "authority",
              code: "PURGE_MARKER_CLEAR_FAILED",
              message: "marker remains",
            }],
          })),
          recoverInterrupted,
        },
      }),
    ).rejects.toThrow(/purge|startup/i);
    expect(recoverInterrupted).not.toHaveBeenCalled();
  });
});
