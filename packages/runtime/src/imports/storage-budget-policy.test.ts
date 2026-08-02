import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ContentAddressedArtifactStore } from "@memi/capture-execution";
import { describe, expect, it, vi } from "vitest";

import { importRuntimeStoragePaths } from "./import-runtime-storage.js";
import { planTransientStorageCleanup } from "./storage-budget-policy.js";
import {
  DEFAULT_STORAGE_BUDGET_POLICY,
  createImportRuntimeStorageBudgetAuthority,
  type StorageBudgetPolicyV1,
} from "../index.js";

const GIB = 1_024 * 1_024 * 1_024;

async function temporaryStorage() {
  const root = await mkdtemp(join(tmpdir(), "memi-storage-budget-"));
  const paths = importRuntimeStoragePaths(root);
  await Promise.all([
    mkdir(paths.artifacts, { recursive: true }),
    mkdir(paths.worktrees, { recursive: true }),
    mkdir(paths.evidence, { recursive: true }),
    mkdir(paths.staging, { recursive: true }),
    mkdir(paths.sharedCache, { recursive: true }),
  ]);
  return { root, paths };
}

function testPolicy(overrides: Partial<StorageBudgetPolicyV1> = {}) {
  return {
    cleanupThresholdBytes: 80,
    hardLimitBytes: 100,
    maximumTransientBytes: 60,
    maximumArtifactBytes: 40,
    maximumSharedCacheBytes: 30,
    minimumFreeBytes: 50,
    failedRetryTtlMs: 6 * 60 * 60 * 1_000,
    ...overrides,
  } satisfies StorageBudgetPolicyV1;
}

describe("ImportRuntimeStorageBudgetAuthority", () => {
  it("plans only abandoned Memi transient entries from a fake filesystem snapshot and clock", () => {
    const active = "/memi/capture-worktrees/capture-active";
    const retry = "/memi/capture-worktrees/capture-retry";
    const plan = planTransientStorageCleanup({
      transientEntries: [
        {
          path: "/memi/capture-worktrees/capture-abandoned",
          bytes: 20,
          modifiedAtMs: 1,
        },
        {
          path: "/memi/native-app-staging/build-abandoned",
          bytes: 10,
          modifiedAtMs: 2,
        },
        { path: active, bytes: 30, modifiedAtMs: 3 },
        { path: retry, bytes: 40, modifiedAtMs: 4 },
      ],
      activePaths: [active],
      retryCheckpoint: {
        transientPaths: [retry],
        expiresAtMs: Date.parse("2026-08-01T18:00:00.000Z"),
      },
      nowMs: Date.parse("2026-08-01T12:00:00.000Z"),
    });

    expect(plan.removablePaths).toEqual([
      "/memi/capture-worktrees/capture-abandoned",
      "/memi/native-app-staging/build-abandoned",
    ]);
    expect(plan.protectedPaths).toEqual([active, retry]);
    expect(plan.retryCheckpointExpired).toBe(false);
  });

  it("publishes the internal-default production limits", () => {
    expect(DEFAULT_STORAGE_BUDGET_POLICY).toEqual({
      cleanupThresholdBytes: 6 * GIB,
      hardLimitBytes: 8 * GIB,
      maximumTransientBytes: 4 * GIB,
      maximumArtifactBytes: 2 * GIB,
      maximumSharedCacheBytes: 2 * GIB,
      minimumFreeBytes: 15 * GIB,
      failedRetryTtlMs: 6 * 60 * 60 * 1_000,
    });
  });

  it("accounts for a separate Memi-owned capture-worktree root", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-storage-budget-"));
    const externalWorktreeRoot = await mkdtemp(
      join(tmpdir(), "memi-capture-worktrees-"),
    );
    const paths = importRuntimeStoragePaths(root, {
      managedWorktreeRoot: externalWorktreeRoot,
    });
    await Promise.all([
      mkdir(paths.artifacts, { recursive: true }),
      mkdir(paths.evidence, { recursive: true }),
      mkdir(paths.staging, { recursive: true }),
      mkdir(paths.sharedCache, { recursive: true }),
      mkdir(join(paths.worktrees, "capture-1"), { recursive: true }),
    ]);
    await writeFile(join(paths.worktrees, "capture-1", "fixture"), "capture");
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore: new ContentAddressedArtifactStore(paths.artifacts),
      policy: testPolicy(),
      freeBytes: async () => 100,
    });

    await expect(authority.inspect()).resolves.toMatchObject({
      transientBytes: 7,
      totalBytes: 7,
    });
  });

  it("rejects invalid and internally contradictory policies", async () => {
    const { paths } = await temporaryStorage();
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });

    expect(() =>
      createImportRuntimeStorageBudgetAuthority({
        paths,
        artifactStore,
        policy: testPolicy({ cleanupThresholdBytes: 101 }),
      }),
    ).toThrow(/cleanup threshold.*hard limit/iu);
    for (const policy of [
      testPolicy({ maximumTransientBytes: 101 }),
      testPolicy({ maximumArtifactBytes: 101 }),
      testPolicy({ maximumSharedCacheBytes: 101 }),
      testPolicy({ minimumFreeBytes: 0 }),
    ]) {
      expect(() =>
        createImportRuntimeStorageBudgetAuthority({
          paths,
          artifactStore,
          policy,
        }),
      ).toThrow(/positive safe integer|hard limit/iu);
    }
  });

  it("preflights total, category, and free-space budgets after safe GC", async () => {
    const { paths } = await temporaryStorage();
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const freeBytes = vi.fn(async () => 65);
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes,
    });

    await expect(
      authority.preflight({ transientBytes: 16, artifactReferences: [] }),
    ).rejects.toThrow(/50 bytes free-space/iu);
    await expect(
      authority.preflight({ transientBytes: 61, artifactReferences: [] }),
    ).rejects.toThrow(/transient/iu);
    await expect(
      authority.preflight({ artifactBytes: 41, artifactReferences: [] }),
    ).rejects.toThrow(/artifact/iu);
    await expect(
      authority.preflight({
        sharedCacheBytes: 31,
        artifactReferences: [],
      }),
    ).rejects.toThrow(/shared cache/iu);
    await expect(
      authority.preflight({
        transientBytes: -1,
        artifactReferences: [],
      }),
    ).rejects.toThrow(/non-negative safe integer/iu);
  });

  it("reports the configured free-space reserve when a capture cannot fit", async () => {
    const { paths } = await temporaryStorage();
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy({ minimumFreeBytes: 73 }),
      freeBytes: async () => 73,
    });

    await expect(
      authority.preflight({ transientBytes: 1, artifactReferences: [] }),
    ).rejects.toThrow(/73 bytes/iu);
  });

  it("enforces the total hard limit for durable data GC cannot remove", async () => {
    const { paths } = await temporaryStorage();
    await writeFile(paths.database, Buffer.alloc(70));
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 90,
      maximumStoreBytes: 90,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy({
        maximumTransientBytes: 90,
        maximumArtifactBytes: 90,
        maximumSharedCacheBytes: 90,
      }),
      freeBytes: async () => 1_000,
    });

    await expect(
      authority.preflight({
        transientBytes: 31,
        artifactReferences: [],
      }),
    ).rejects.toThrow(/hard limit/iu);
  });

  it("does not delete any artifacts during preflight GC", async () => {
    const { paths } = await temporaryStorage();
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const retained = await artifactStore.put(new Uint8Array([1]), "png");
    const orphaned = await artifactStore.put(new Uint8Array([2]), "png");
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });

    await authority.preflight({
      artifactReferences: [
        { id: retained.id, hash: retained.hash, extension: "png" },
      ],
    });

    await expect(readFile(retained.path)).resolves.toEqual(Buffer.from([1]));
    await expect(readFile(orphaned.path)).resolves.toEqual(Buffer.from([2]));
  });

  it("protects active job paths from automatic collection", async () => {
    const { paths } = await temporaryStorage();
    const activeWorktree = join(paths.worktrees, "capture-active");
    const orphanWorktree = join(paths.worktrees, "capture-orphan");
    await Promise.all([mkdir(activeWorktree), mkdir(orphanWorktree)]);
    await Promise.all([
      writeFile(join(activeWorktree, "active.txt"), "active"),
      writeFile(join(orphanWorktree, "orphan.txt"), "orphan"),
    ]);
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });
    const lock = await authority.acquireJobLock({
      jobId: "imp_active",
      transientPaths: [activeWorktree],
    });

    const during = await authority.garbageCollect({ artifactReferences: [] });
    expect(during.skippedActiveJobs).toBe(1);
    expect(during.removedTransientEntries).toBe(1);
    await expect(readFile(join(activeWorktree, "active.txt"), "utf8"))
      .resolves.toBe("active");
    await expect(access(orphanWorktree)).rejects.toThrow();

    await lock.release();
    const after = await authority.garbageCollect({ artifactReferences: [] });
    expect(after.removedTransientEntries).toBe(1);
  });

  it("cleans abandoned managed worktrees and staging before a locked capture preflight", async () => {
    const { root, paths } = await temporaryStorage();
    const activeWorktree = join(paths.worktrees, "capture-active");
    const abandonedWorktree = join(paths.worktrees, "capture-abandoned");
    const abandonedStaging = join(paths.staging, "build-abandoned");
    const sourceRepository = join(root, "source-repository");
    await Promise.all([
      mkdir(activeWorktree),
      mkdir(abandonedWorktree),
      mkdir(abandonedStaging),
      mkdir(sourceRepository),
    ]);
    await Promise.all([
      writeFile(join(activeWorktree, "active.bin"), Buffer.alloc(20)),
      writeFile(join(abandonedWorktree, "orphan.bin"), Buffer.alloc(20)),
      writeFile(join(abandonedStaging, "orphan.bin"), Buffer.alloc(20)),
      writeFile(join(sourceRepository, "source.txt"), "source truth"),
    ]);
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });
    const lock = await authority.acquireJobLock({
      jobId: "imp_active",
      transientPaths: [activeWorktree],
    });

    await expect(
      authority.preflight({
        transientBytes: 40,
        artifactReferences: [],
      }),
    ).resolves.toMatchObject({ transientBytes: 20 });
    await expect(access(activeWorktree)).resolves.toBeUndefined();
    await expect(access(abandonedWorktree)).rejects.toThrow();
    await expect(access(abandonedStaging)).rejects.toThrow();
    await expect(readFile(join(sourceRepository, "source.txt"), "utf8"))
      .resolves.toBe("source truth");
    await lock.release();
  });

  it("never reclaims evidence, artifacts, or simulator state during startup or preflight GC", async () => {
    const { paths } = await temporaryStorage();
    const evidence = join(paths.evidence, "capture-evidence");
    const simulator = join(paths.simulator, "managed-simulator");
    await Promise.all([
      mkdir(evidence, { recursive: true }),
      mkdir(simulator, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(evidence, "evidence.txt"), "evidence truth"),
      writeFile(join(simulator, "simulator.txt"), "simulator truth"),
    ]);
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const artifact = await artifactStore.put(new Uint8Array([1]), "png");
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });

    await expect(
      authority.startupGarbageCollect({ artifactReferences: [] }),
    ).resolves.toMatchObject({
      removedArtifacts: 0,
      removedTransientEntries: 0,
    });
    await expect(readFile(join(evidence, "evidence.txt"), "utf8"))
      .resolves.toBe("evidence truth");
    await expect(readFile(join(simulator, "simulator.txt"), "utf8"))
      .resolves.toBe("simulator truth");
    await expect(readFile(artifact.path)).resolves.toEqual(Buffer.from([1]));

    const abandonedStaging = join(paths.staging, "build-abandoned");
    await mkdir(abandonedStaging);
    await writeFile(join(abandonedStaging, "staging.bin"), Buffer.alloc(20));
    await authority.preflight({ transientBytes: 1, artifactReferences: [] });

    await expect(access(abandonedStaging)).rejects.toThrow();
    await expect(readFile(join(evidence, "evidence.txt"), "utf8"))
      .resolves.toBe("evidence truth");
    await expect(readFile(join(simulator, "simulator.txt"), "utf8"))
      .resolves.toBe("simulator truth");
    await expect(readFile(artifact.path)).resolves.toEqual(Buffer.from([1]));
  });

  it("accounts for the simulator diagnostic link without traversing or rejecting it", async () => {
    const { root, paths } = await temporaryStorage();
    const externalDeviceSet = join(root, "external-device-set");
    const diagnosticLink = join(paths.simulator, "device-set");
    await Promise.all([
      mkdir(paths.simulator, { recursive: true }),
      mkdir(externalDeviceSet, { recursive: true }),
    ]);
    await writeFile(join(externalDeviceSet, "outside.txt"), "outside truth");
    await symlink(externalDeviceSet, diagnosticLink, "dir");
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore: new ContentAddressedArtifactStore(paths.artifacts),
      policy: testPolicy({
        cleanupThresholdBytes: 900,
        hardLimitBytes: 1_000,
        maximumTransientBytes: 900,
        maximumArtifactBytes: 900,
        maximumSharedCacheBytes: 900,
      }),
      freeBytes: async () => 1_000,
    });

    await expect(
      authority.preflight({ transientBytes: 1, artifactReferences: [] }),
    ).resolves.toMatchObject({ transientBytes: expect.any(Number) });
    await expect(readFile(join(externalDeviceSet, "outside.txt"), "utf8"))
      .resolves.toBe("outside truth");
  });

  it("ignores the sidecar runtime socket while accounting for app storage", async () => {
    const { paths } = await temporaryStorage();
    const runtimeDirectory = join(paths.root, "runtime");
    const socketPath = join(runtimeDirectory, "runtime-v1.sock");
    await mkdir(runtimeDirectory, { recursive: true });
    const server = createServer();
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => resolvePromise());
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore: new ContentAddressedArtifactStore(paths.artifacts),
      policy: testPolicy({
        cleanupThresholdBytes: 900,
        hardLimitBytes: 1_000,
        maximumTransientBytes: 900,
        maximumArtifactBytes: 900,
        maximumSharedCacheBytes: 900,
      }),
      freeBytes: async () => 1_000,
    });

    try {
      await expect(
        authority.preflight({ transientBytes: 1, artifactReferences: [] }),
      ).resolves.toMatchObject({ totalBytes: expect.any(Number) });
    } finally {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  });

  it("collects an owned worktree with nested package-bin links without traversing them", async () => {
    const { root, paths } = await temporaryStorage();
    const worktree = join(paths.worktrees, "capture-complete");
    const external = join(root, "outside");
    await Promise.all([
      mkdir(join(worktree, "node_modules", ".bin"), { recursive: true }),
      mkdir(external, { recursive: true }),
    ]);
    await writeFile(join(external, "truth.txt"), "outside truth");
    await symlink(
      join(external, "truth.txt"),
      join(worktree, "node_modules", ".bin", "tool"),
      "file",
    );
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore: new ContentAddressedArtifactStore(paths.artifacts),
      policy: testPolicy({
        cleanupThresholdBytes: 900,
        hardLimitBytes: 1_000,
        maximumTransientBytes: 900,
        maximumArtifactBytes: 900,
        maximumSharedCacheBytes: 900,
      }),
      freeBytes: async () => 1_000,
    });

    await expect(
      authority.preflight({ transientBytes: 1, artifactReferences: [] }),
    ).resolves.toMatchObject({ transientBytes: 0 });
    await expect(access(worktree)).rejects.toThrow();
    await expect(readFile(join(external, "truth.txt"), "utf8"))
      .resolves.toBe("outside truth");
  });

  it("immediately removes successful staging and unreferenced artifacts", async () => {
    const { paths } = await temporaryStorage();
    const worktree = join(paths.worktrees, "capture-success");
    const staging = join(paths.staging, "build-success");
    await Promise.all([mkdir(worktree), mkdir(staging)]);
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const kept = await artifactStore.put(new Uint8Array([1]), "png");
    const removed = await artifactStore.put(new Uint8Array([2]), "png");
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });
    const lock = await authority.acquireJobLock({
      jobId: "imp_success",
      transientPaths: [worktree, staging],
    });

    const result = await lock.finalize({
      outcome: "succeeded",
      artifactReferences: [
        { id: kept.id, hash: kept.hash, extension: "png" },
      ],
    });

    expect(result.removedTransientEntries).toBe(2);
    await expect(readFile(removed.path)).rejects.toThrow();
    await expect(readFile(kept.path)).resolves.toEqual(Buffer.from([1]));
  });

  it("retains only the latest failed retry checkpoint for six hours", async () => {
    const { paths } = await temporaryStorage();
    const first = join(paths.worktrees, "capture-failed-first");
    const second = join(paths.worktrees, "capture-failed-second");
    await Promise.all([mkdir(first), mkdir(second)]);
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    let now = new Date("2026-07-31T12:00:00.000Z");
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
      now: () => now,
    });
    const firstLock = await authority.acquireJobLock({
      jobId: "imp_first",
      transientPaths: [first],
    });
    await firstLock.finalize({ outcome: "failed", artifactReferences: [] });
    const secondLock = await authority.acquireJobLock({
      jobId: "imp_second",
      transientPaths: [second],
    });
    await secondLock.finalize({ outcome: "failed", artifactReferences: [] });

    await expect(access(first)).rejects.toThrow();
    await expect(readFile(paths.failedRetryCheckpoint, "utf8"))
      .resolves.toContain("imp_second");

    now = new Date("2026-07-31T18:00:00.001Z");
    const collected = await authority.startupGarbageCollect({
      artifactReferences: [],
    });
    expect(collected.expiredFailedRetryCheckpoint).toBe(true);
    await expect(readFile(paths.failedRetryCheckpoint)).rejects.toThrow();
  });

  it("does not retain a failed checkpoint that exceeds the transient cap", async () => {
    const { paths } = await temporaryStorage();
    const oversized = join(paths.worktrees, "capture-failed-oversized");
    await mkdir(oversized);
    await writeFile(join(oversized, "derived-data.bin"), Buffer.alloc(61));
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });
    const lock = await authority.acquireJobLock({
      jobId: "imp_oversized",
      transientPaths: [oversized],
    });

    const result = await lock.finalize({
      outcome: "failed",
      artifactReferences: [],
    });

    expect(result.snapshot.transientBytes).toBe(0);
    await expect(access(oversized)).rejects.toThrow();
    await expect(access(paths.failedRetryCheckpoint)).rejects.toThrow();
  });

  it("retains a failed worktree with nested links without traversing their targets", async () => {
    const { root, paths } = await temporaryStorage();
    const worktree = join(paths.worktrees, "capture-failed-linked");
    const outside = join(root, "outside-linked");
    await Promise.all([mkdir(worktree), mkdir(outside)]);
    await writeFile(join(worktree, "capture.bin"), Buffer.alloc(4));
    await writeFile(join(outside, "preserve.bin"), Buffer.alloc(200));
    await symlink(outside, join(worktree, "linked-package"), "dir");
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore: new ContentAddressedArtifactStore(paths.artifacts, {
        maximumArtifactBytes: 40,
        maximumStoreBytes: 40,
      }),
      policy: testPolicy({
        maximumTransientBytes: 1_000,
        hardLimitBytes: 1_000,
      }),
      freeBytes: async () => 1_000,
    });
    const lock = await authority.acquireJobLock({
      jobId: "imp_linked_retry",
      transientPaths: [worktree],
    });

    await expect(
      lock.finalize({ outcome: "failed", artifactReferences: [] }),
    ).resolves.toEqual(expect.anything());
    await expect(readFile(join(outside, "preserve.bin"))).resolves.toHaveLength(200);
    await expect(readFile(paths.failedRetryCheckpoint, "utf8"))
      .resolves.toContain("imp_linked_retry");
  });

  it("removes an oversized failed worktree with nested links without traversing them", async () => {
    const { root, paths } = await temporaryStorage();
    const worktree = join(paths.worktrees, "capture-failed-linked-oversized");
    const outside = join(root, "outside-linked-oversized");
    await Promise.all([mkdir(worktree), mkdir(outside)]);
    await writeFile(join(worktree, "derived-data.bin"), Buffer.alloc(61));
    await writeFile(join(outside, "preserve.bin"), Buffer.alloc(200));
    await symlink(outside, join(worktree, "linked-package"), "dir");
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore: new ContentAddressedArtifactStore(paths.artifacts, {
        maximumArtifactBytes: 40,
        maximumStoreBytes: 40,
      }),
      policy: testPolicy({ maximumTransientBytes: 60, hardLimitBytes: 1_000 }),
      freeBytes: async () => 1_000,
    });
    const lock = await authority.acquireJobLock({
      jobId: "imp_linked_oversized",
      transientPaths: [worktree],
    });

    await expect(
      lock.finalize({ outcome: "failed", artifactReferences: [] }),
    ).resolves.toEqual(expect.anything());
    await expect(access(worktree)).rejects.toThrow();
    await expect(readFile(join(outside, "preserve.bin"))).resolves.toHaveLength(200);
  });

  it("does not evict shared-cache entries during startup GC", async () => {
    const { paths } = await temporaryStorage();
    const oldCache = join(paths.nativeDependencyCache, "old");
    const newCache = join(paths.toolchainCache, "new");
    await Promise.all([
      mkdir(oldCache, { recursive: true }),
      mkdir(newCache, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(oldCache, "cache.bin"), Buffer.alloc(20)),
      writeFile(join(newCache, "cache.bin"), Buffer.alloc(20)),
    ]);
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });

    const result = await authority.startupGarbageCollect({
      artifactReferences: [],
    });

    expect(result.removedSharedCacheEntries).toBe(0);
    expect(result.snapshot.sharedCacheBytes).toBe(40);
  });

  it("reclaims re-creatable shared cache when an approved job reserves that capacity", async () => {
    const { paths } = await temporaryStorage();
    const staleCache = join(paths.nativeDependencyCache, "stale");
    await mkdir(staleCache, { recursive: true });
    await writeFile(join(staleCache, "cache.bin"), Buffer.alloc(20));
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore: new ContentAddressedArtifactStore(paths.artifacts, {
        maximumArtifactBytes: 40,
        maximumStoreBytes: 40,
      }),
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });

    await expect(
      authority.preflight({ sharedCacheBytes: 15, artifactReferences: [] }),
    ).resolves.toMatchObject({ sharedCacheBytes: 0 });
    await expect(access(staleCache)).rejects.toThrow();
  });

  it("does not unlink shared-cache symlinks during startup GC", async () => {
    const { paths } = await temporaryStorage();
    const outside = await mkdtemp(join(tmpdir(), "memi-outside-cache-"));
    const cacheEntry = join(paths.sharedCache, "linked-cache");
    await writeFile(join(outside, "source.txt"), "preserve");
    await symlink(outside, cacheEntry, "dir");
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy({ cleanupThresholdBytes: 1 }),
      freeBytes: async () => 1_000,
    });

    await expect(
      authority.startupGarbageCollect({ artifactReferences: [] }),
    ).resolves.toMatchObject({ removedSharedCacheEntries: 0 });
    await expect(access(cacheEntry)).resolves.toBeUndefined();
    await expect(readFile(join(outside, "source.txt"), "utf8"))
      .resolves.toBe("preserve");
  });

  it("rejects overlapping active-job staging authorities", async () => {
    const { paths } = await temporaryStorage();
    const shared = join(paths.worktrees, "capture-shared");
    await mkdir(shared);
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });
    const first = await authority.acquireJobLock({
      jobId: "imp_first",
      transientPaths: [shared],
    });

    await expect(
      authority.acquireJobLock({
        jobId: "imp_first",
        transientPaths: [shared],
      }),
    ).rejects.toThrow(/already holds/iu);

    await expect(
      authority.acquireJobLock({
        jobId: "imp_second",
        transientPaths: [shared],
      }),
    ).rejects.toThrow(/overlaps|active/iu);
    await first.release();
    await first.release();
    await expect(
      first.finalize({ outcome: "cancelled", artifactReferences: [] }),
    ).rejects.toThrow(/no longer active/iu);
  });

  it("keeps release from racing a finalization in progress", async () => {
    const { paths } = await temporaryStorage();
    const staging = join(paths.staging, "finalizing");
    await mkdir(staging);
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    let finishInspection!: (value: number) => void;
    const freeBytes = vi.fn(
      () =>
        new Promise<number>((resolvePromise) => {
          finishInspection = resolvePromise;
        }),
    );
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes,
    });
    const lock = await authority.acquireJobLock({
      jobId: "imp_finalizing",
      transientPaths: [staging],
    });

    const finalization = lock.finalize({
      outcome: "cancelled",
      artifactReferences: [],
    });
    await expect(lock.release()).rejects.toThrow(/finalizing/iu);
    await vi.waitFor(() => expect(freeBytes).toHaveBeenCalled());
    finishInspection(1_000);
    await expect(finalization).resolves.toMatchObject({
      removedTransientEntries: 1,
    });
  });

  it("restores an active lock when finalization fails closed", async () => {
    const { root, paths } = await temporaryStorage();
    const staging = join(paths.staging, "unsafe-finalization");
    const outside = join(root, "outside-finalization");
    await Promise.all([mkdir(staging), mkdir(outside)]);
    await writeFile(join(outside, "truth.txt"), "preserve");
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });
    const lock = await authority.acquireJobLock({
      jobId: "imp_retry_finalization",
      transientPaths: [staging],
    });
    await rm(staging, { recursive: true });
    await symlink(outside, staging, "dir");

    await expect(
      lock.finalize({ outcome: "cancelled", artifactReferences: [] }),
    ).rejects.toThrow(/symbolic|symlink/iu);
    expect(authority.hasActiveJobs()).toBe(true);
    await expect(readFile(join(outside, "truth.txt"), "utf8"))
      .resolves.toBe("preserve");
    await lock.release();
  });

  it("reports cleanup and hard-limit pressure independently", async () => {
    const { paths } = await temporaryStorage();
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 90,
      maximumStoreBytes: 90,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy({
        maximumTransientBytes: 90,
        maximumArtifactBytes: 90,
        maximumSharedCacheBytes: 90,
      }),
      freeBytes: async () => 1_000,
    });
    await writeFile(paths.database, Buffer.alloc(90));

    await expect(authority.inspect()).resolves.toMatchObject({
      cleanupRecommended: true,
      hardLimitExceeded: false,
    });
    await writeFile(paths.database, Buffer.alloc(101));
    await expect(authority.inspect()).resolves.toMatchObject({
      cleanupRecommended: true,
      hardLimitExceeded: true,
    });
  });

  it("rejects invalid, duplicate, and broad job staging authorities", async () => {
    const { paths } = await temporaryStorage();
    const staging = join(paths.staging, "build");
    await mkdir(staging);
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });

    await expect(
      authority.acquireJobLock({
        jobId: "../bad",
        transientPaths: [staging],
      }),
    ).rejects.toThrow(/identity/iu);
    await expect(
      authority.acquireJobLock({
        jobId: "imp_broad",
        transientPaths: [paths.staging],
      }),
    ).rejects.toThrow(/owned transient child/iu);
    await expect(
      authority.acquireJobLock({
        jobId: "imp_duplicate",
        transientPaths: [staging, staging],
      }),
    ).rejects.toThrow(/unique/iu);
  });

  it("rejects corrupt retry metadata before automatic deletion", async () => {
    const { paths } = await temporaryStorage();
    const worktree = join(paths.worktrees, "preserve-on-corrupt-state");
    await mkdir(worktree);
    await mkdir(paths.budgetState, { recursive: true });
    await writeFile(
      paths.failedRetryCheckpoint,
      JSON.stringify({ schemaVersion: 1, jobId: "imp_corrupt" }),
    );
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });

    await expect(
      authority.startupGarbageCollect({ artifactReferences: [] }),
    ).rejects.toThrow(/checkpoint format/iu);
    await expect(access(worktree)).resolves.toBeUndefined();
  });

  it("rejects malformed retry artifact authorities before GC", async () => {
    const { paths } = await temporaryStorage();
    await mkdir(paths.budgetState, { recursive: true });
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });
    const invalidReferences: readonly unknown[] = [
      null,
      {},
      { id: 1, hash: `sha256:${"a".repeat(64)}`, extension: "png" },
      { id: `art_${"Z".repeat(26)}`, hash: `sha256:${"a".repeat(64)}`, extension: "png" },
      { id: `art_${"A".repeat(26)}`, hash: "bad", extension: "png" },
      { id: `art_${"A".repeat(26)}`, hash: `sha256:${"a".repeat(64)}`, extension: "PNG" },
    ];
    for (const artifactReference of invalidReferences) {
      await writeFile(
        paths.failedRetryCheckpoint,
        JSON.stringify({
          schemaVersion: 1,
          jobId: "imp_invalid_artifact",
          failedAt: "2026-07-31T00:00:00.000Z",
          expiresAt: "2026-07-31T06:00:00.000Z",
          transientPaths: [],
          artifactReferences: [artifactReference],
        }),
      );
      await expect(
        authority.startupGarbageCollect({ artifactReferences: [] }),
      ).rejects.toThrow(/artifact reference/iu);
    }
  });

  it("fails closed before deletion when a transient entry is a symlink", async () => {
    const { root, paths } = await temporaryStorage();
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "truth.txt"), "source truth");
    await symlink(outside, join(paths.worktrees, "linked"), "dir");
    const artifactStore = new ContentAddressedArtifactStore(paths.artifacts, {
      maximumArtifactBytes: 40,
      maximumStoreBytes: 40,
    });
    const authority = createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
      policy: testPolicy(),
      freeBytes: async () => 1_000,
    });

    await expect(
      authority.garbageCollect({ artifactReferences: [] }),
    ).rejects.toThrow(/symbolic|symlink/iu);
    await expect(readFile(join(outside, "truth.txt"), "utf8"))
      .resolves.toBe("source truth");
  });
});
