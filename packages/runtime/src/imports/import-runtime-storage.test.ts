import { describe, expect, it } from "vitest";

import { importRuntimeStoragePaths } from "./import-runtime-storage.js";

describe("import runtime storage paths", () => {
  it("uses the exact Memi-owned app-data reset targets", () => {
    expect(importRuntimeStoragePaths("/tmp/Memi Canvas")).toEqual({
      root: "/tmp/Memi Canvas",
      database: "/tmp/Memi Canvas/imports.sqlite",
      artifacts: "/tmp/Memi Canvas/capture-artifacts",
      evidence: "/tmp/Memi Canvas/capture-evidence",
      worktrees: "/tmp/Memi Canvas/capture-worktrees",
      jobs: "/tmp/Memi Canvas/import-jobs",
      staging: "/tmp/Memi Canvas/native-app-staging",
      simulator: "/tmp/Memi Canvas/capture-simulator",
      sharedCache: "/tmp/Memi Canvas/shared-cache",
      nativeDependencyCache:
        "/tmp/Memi Canvas/native-dependency-sandbox",
      toolchainCache: "/tmp/Memi Canvas/toolchains",
      budgetState: "/tmp/Memi Canvas/storage-budget",
      failedRetryCheckpoint:
        "/tmp/Memi Canvas/storage-budget/failed-retry-checkpoint-v1.json",
    });
  });

  it("rejects relative and filesystem-root app-data paths", () => {
    expect(() => importRuntimeStoragePaths("relative")).toThrow(
      /absolute/u,
    );
    expect(() => importRuntimeStoragePaths("/")).toThrow(
      /filesystem root/u,
    );
  });

  it("accepts a no-space external worktree root for native build tools", () => {
    expect(
      importRuntimeStoragePaths("/tmp/Memi Canvas", {
        managedWorktreeRoot: "/tmp/memi-capture-worktrees",
      }),
    ).toMatchObject({
      root: "/tmp/Memi Canvas",
      worktrees: "/tmp/memi-capture-worktrees",
    });
  });

  it("rejects an explicit managed worktree root that native codegen cannot shell safely", () => {
    expect(() =>
      importRuntimeStoragePaths("/tmp/Memi Canvas", {
        managedWorktreeRoot: "/tmp/Memi Capture/capture-worktrees",
      }),
    ).toThrow("Managed worktree root cannot contain whitespace");
  });
});
