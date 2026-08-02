import { describe, expect, it, vi } from "vitest";

import {
  TRUTHFUL_IMPORT_RUNTIME_RESET_KEY,
  ensureTruthfulImportRuntimeReset,
  hasCompletedTruthfulImportRuntimeReset,
} from "./truthful-import-reset.js";

function storage(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const counts = {
  artifacts: 2,
  jobs: 1,
  managedWorktrees: 1,
  pendingPlans: 1,
  plans: 1,
  projectBindings: 1,
  simulatorAuthorities: 1,
} as const;

describe("truthful import runtime reset gate", () => {
  it("lets local creation continue during a sidecar outage only after reset completed", () => {
    expect(hasCompletedTruthfulImportRuntimeReset(storage())).toBe(false);
    expect(
      hasCompletedTruthfulImportRuntimeReset(
        storage({ [TRUTHFUL_IMPORT_RUNTIME_RESET_KEY]: "complete" }),
      ),
    ).toBe(true);
    expect(
      hasCompletedTruthfulImportRuntimeReset({
        getItem: () => {
          throw new Error("storage unavailable");
        },
      }),
    ).toBe(false);
  });
  it("marks the runtime reset complete only after every owned category is purged", async () => {
    const target = storage();
    const purgeAll = vi.fn(async () => ({
      complete: true,
      counts,
      failures: [],
    }));

    await expect(
      ensureTruthfulImportRuntimeReset({
        imports: { purgeAll },
        storage: target,
      }),
    ).resolves.toBe(true);
    expect(purgeAll).toHaveBeenCalledWith({});
    expect(target.values.get(TRUTHFUL_IMPORT_RUNTIME_RESET_KEY)).toBe(
      "complete",
    );
  });

  it("does not mark partial runtime cleanup complete", async () => {
    const target = storage();
    const purgeAll = vi.fn(async () => ({
      complete: false,
      counts: { ...counts, managedWorktrees: 0 },
      failures: [{
        category: "managed-worktrees" as const,
        code: "WORKTREE_PURGE_FAILED",
        message: "Managed capture worktrees remain.",
      }],
    }));

    await expect(
      ensureTruthfulImportRuntimeReset({
        imports: { purgeAll },
        storage: target,
      }),
    ).resolves.toBe(false);
    expect(target.values.has(TRUTHFUL_IMPORT_RUNTIME_RESET_KEY)).toBe(
      false,
    );
  });

  it("does not purge projects created after the one-time runtime reset", async () => {
    const target = storage({
      [TRUTHFUL_IMPORT_RUNTIME_RESET_KEY]: "complete",
    });
    const purgeAll = vi.fn();

    await expect(
      ensureTruthfulImportRuntimeReset({
        imports: { purgeAll },
        storage: target,
      }),
    ).resolves.toBe(true);
    expect(purgeAll).not.toHaveBeenCalled();
  });
});
