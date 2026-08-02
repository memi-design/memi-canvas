import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
  ArtifactReference,
  ContentAddressedArtifactStore,
} from "@memi/capture-execution";

import type { ImportRuntimeStoragePaths } from "./import-runtime-storage.js";
import {
  availableStorageBytes,
  inspectStorageChildren,
  inspectStorageTree,
  isMissingStorageEntry,
  storageEntriesBytes,
  storagePathsOverlap,
  type StorageEntryInspection,
} from "./storage-budget-policy-filesystem.js";

const GIB = 1_024 * 1_024 * 1_024;
const MAX_CHECKPOINT_BYTES = 64 * 1_024;

export interface StorageBudgetPolicyV1 {
  readonly cleanupThresholdBytes: number;
  readonly hardLimitBytes: number;
  readonly maximumTransientBytes: number;
  readonly maximumArtifactBytes: number;
  readonly maximumSharedCacheBytes: number;
  readonly minimumFreeBytes: number;
  readonly failedRetryTtlMs: number;
}

export const DEFAULT_STORAGE_BUDGET_POLICY: StorageBudgetPolicyV1 =
  Object.freeze({
    cleanupThresholdBytes: 6 * GIB,
    hardLimitBytes: 8 * GIB,
    maximumTransientBytes: 4 * GIB,
    maximumArtifactBytes: 2 * GIB,
    maximumSharedCacheBytes: 2 * GIB,
    minimumFreeBytes: 15 * GIB,
    failedRetryTtlMs: 6 * 60 * 60 * 1_000,
  });

export interface StorageBudgetEstimate {
  readonly transientBytes?: number;
  readonly artifactBytes?: number;
  readonly sharedCacheBytes?: number;
}

export interface StorageBudgetPreflightInput extends StorageBudgetEstimate {
  /** The lock already held by the import requesting this reservation. */
  readonly jobId?: string;
  readonly artifactReferences: readonly ArtifactReference[];
}

export interface StorageBudgetSnapshot {
  readonly totalBytes: number;
  readonly transientBytes: number;
  readonly artifactBytes: number;
  readonly sharedCacheBytes: number;
  readonly freeBytes: number;
  readonly cleanupRecommended: boolean;
  readonly hardLimitExceeded: boolean;
}

export interface StorageGarbageCollectionResult {
  readonly removedArtifacts: number;
  readonly removedTransientEntries: number;
  readonly removedSharedCacheEntries: number;
  readonly expiredFailedRetryCheckpoint: boolean;
  readonly skippedActiveJobs: number;
  readonly snapshot: StorageBudgetSnapshot;
}

export interface TransientStorageCleanupPlan {
  readonly removablePaths: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly retryCheckpointExpired: boolean;
}

export interface TransientStorageCleanupPlanInput {
  readonly transientEntries: readonly StorageEntryInspection[];
  readonly activePaths: readonly string[];
  readonly retryCheckpoint: {
    readonly transientPaths: readonly string[];
    readonly expiresAtMs: number;
  } | null;
  readonly nowMs: number;
}

/**
 * Selects only terminal Memi-owned transient entries for removal. Callers
 * provide entries already inspected below the runtime's managed roots, which
 * keeps source repositories outside this authority by construction.
 */
export function planTransientStorageCleanup(
  input: TransientStorageCleanupPlanInput,
): TransientStorageCleanupPlan {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    throw new Error("Storage cleanup clock is invalid.");
  }
  const checkpointExpired =
    input.retryCheckpoint !== null &&
    input.nowMs >= input.retryCheckpoint.expiresAtMs &&
    !input.activePaths.some((activePath) =>
      input.retryCheckpoint!.transientPaths.some((checkpointPath) =>
        storagePathsOverlap(activePath, [checkpointPath]),
      ),
    );
  const protectedPaths = Object.freeze([
    ...input.activePaths,
    ...(checkpointExpired || input.retryCheckpoint === null
      ? []
      : input.retryCheckpoint.transientPaths),
  ]);
  return Object.freeze({
    removablePaths: Object.freeze(
      input.transientEntries
        .filter((entry) => !storagePathsOverlap(entry.path, protectedPaths))
        .map((entry) => entry.path),
    ),
    protectedPaths,
    retryCheckpointExpired: checkpointExpired,
  });
}

export interface StorageBudgetFinalizeInput {
  readonly outcome: "succeeded" | "failed" | "cancelled";
  readonly artifactReferences: readonly ArtifactReference[];
}

export interface StorageBudgetJobLock {
  readonly jobId: string;
  finalize(
    input: StorageBudgetFinalizeInput,
  ): Promise<StorageGarbageCollectionResult>;
  release(): Promise<void>;
}

export interface ImportRuntimeStorageBudgetAuthority {
  acquireJobLock(input: {
    readonly jobId: string;
    readonly transientPaths: readonly string[];
  }): Promise<StorageBudgetJobLock>;
  garbageCollect(input: {
    readonly artifactReferences: readonly ArtifactReference[];
  }): Promise<StorageGarbageCollectionResult>;
  startupGarbageCollect(input: {
    readonly artifactReferences: readonly ArtifactReference[];
  }): Promise<StorageGarbageCollectionResult>;
  hasActiveJobs(): boolean;
  inspect(): Promise<StorageBudgetSnapshot>;
  preflight(input: StorageBudgetPreflightInput): Promise<StorageBudgetSnapshot>;
}

interface FailedRetryCheckpointV1 {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly failedAt: string;
  readonly expiresAt: string;
  readonly transientPaths: readonly string[];
  readonly artifactReferences: readonly ArtifactReference[];
}

interface StorageBudgetAuthorityOptions {
  readonly paths: ImportRuntimeStoragePaths;
  readonly artifactStore: ContentAddressedArtifactStore;
  readonly policy?: StorageBudgetPolicyV1;
  readonly freeBytes?: (root: string) => Promise<number>;
  readonly now?: () => Date;
}

interface ActiveJob {
  readonly jobId: string;
  readonly transientPaths: readonly string[];
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function validatePolicy(policy: StorageBudgetPolicyV1): StorageBudgetPolicyV1 {
  const validated = Object.freeze({
    cleanupThresholdBytes: positiveSafeInteger(
      policy.cleanupThresholdBytes,
      "Storage cleanup threshold",
    ),
    hardLimitBytes: positiveSafeInteger(
      policy.hardLimitBytes,
      "Storage hard limit",
    ),
    maximumTransientBytes: positiveSafeInteger(
      policy.maximumTransientBytes,
      "Transient storage limit",
    ),
    maximumArtifactBytes: positiveSafeInteger(
      policy.maximumArtifactBytes,
      "Artifact storage limit",
    ),
    maximumSharedCacheBytes: positiveSafeInteger(
      policy.maximumSharedCacheBytes,
      "Shared cache limit",
    ),
    minimumFreeBytes: positiveSafeInteger(
      policy.minimumFreeBytes,
      "Minimum free-space reserve",
    ),
    failedRetryTtlMs: positiveSafeInteger(
      policy.failedRetryTtlMs,
      "Failed retry checkpoint TTL",
    ),
  });
  if (validated.cleanupThresholdBytes > validated.hardLimitBytes) {
    throw new Error(
      "Storage cleanup threshold may not exceed the hard limit.",
    );
  }
  for (const [label, value] of [
    ["Transient storage limit", validated.maximumTransientBytes],
    ["Artifact storage limit", validated.maximumArtifactBytes],
    ["Shared cache limit", validated.maximumSharedCacheBytes],
  ] as const) {
    if (value > validated.hardLimitBytes) {
      throw new Error(`${label} may not exceed the storage hard limit.`);
    }
  }
  return validated;
}

function validateJobId(jobId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(jobId)) {
    throw new Error("Storage job identity is invalid.");
  }
  return jobId;
}

function relationship(root: string, candidate: string): string {
  const result = relative(root, candidate);
  if (
    result === "" ||
    result === ".." ||
    result.startsWith(`..${sep}`) ||
    isAbsolute(result)
  ) {
    throw new Error("Storage cleanup path escapes Memi-owned storage.");
  }
  return result;
}

function isOwnedChild(root: string, candidate: string): boolean {
  try {
    relationship(root, candidate);
    return true;
  } catch {
    return false;
  }
}

function validateEstimate(value: number | undefined, label: string): number {
  const normalized = value ?? 0;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${label} estimate must be a non-negative safe integer.`);
  }
  return normalized;
}

function formatStorageBytes(value: number): string {
  if (value % GIB === 0) return `${value / GIB} GB`;
  return `${value} ${value === 1 ? "byte" : "bytes"}`;
}

function validateArtifactReference(value: unknown): ArtifactReference {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("hash" in value) ||
    !("extension" in value) ||
    typeof value.id !== "string" ||
    typeof value.hash !== "string" ||
    typeof value.extension !== "string" ||
    !/^art_[A-F0-9]{26}$/u.test(value.id) ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.hash) ||
    !/^[a-z0-9]{1,12}$/u.test(value.extension)
  ) {
    throw new Error("Failed retry artifact reference is invalid.");
  }
  return Object.freeze({
    id: value.id as `art_${string}`,
    hash: value.hash as `sha256:${string}`,
    extension: value.extension,
  });
}

export function createImportRuntimeStorageBudgetAuthority(
  options: StorageBudgetAuthorityOptions,
): ImportRuntimeStorageBudgetAuthority {
  const policy = validatePolicy(
    options.policy ?? DEFAULT_STORAGE_BUDGET_POLICY,
  );
  const now = options.now ?? (() => new Date());
  const freeBytes = options.freeBytes ?? availableStorageBytes;
  const activeJobs = new Map<string, ActiveJob>();
  const transientRoots = Object.freeze([
    options.paths.worktrees,
    options.paths.evidence,
    options.paths.staging,
    options.paths.simulator,
  ]);
  const reclaimableTransientRoots = Object.freeze([
    options.paths.worktrees,
    options.paths.staging,
  ]);
  const cacheRoots = Object.freeze([
    options.paths.sharedCache,
    options.paths.nativeDependencyCache,
    options.paths.toolchainCache,
  ]);
  const usesExternalWorktreeRoot = !isOwnedChild(
    options.paths.root,
    options.paths.worktrees,
  );
  let mutationTail = Promise.resolve();

  const withMutationLock = async <Value>(
    operation: () => Promise<Value>,
  ): Promise<Value> => {
    const preceding = mutationTail;
    let release!: () => void;
    mutationTail = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await preceding;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const ensureRoot = async (): Promise<void> => {
    if (!isAbsolute(options.paths.root)) {
      throw new Error("Memi storage root must be absolute.");
    }
    const metadata = await lstat(options.paths.root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Memi storage root must be a real directory.");
    }
    for (const path of [
      options.paths.artifacts,
      options.paths.budgetState,
      options.paths.evidence,
      options.paths.staging,
      options.paths.simulator,
      ...cacheRoots,
    ]) {
      relationship(options.paths.root, path);
    }
    const worktreeMetadata = await lstat(options.paths.worktrees);
    if (
      worktreeMetadata.isSymbolicLink() ||
      !worktreeMetadata.isDirectory()
    ) {
      throw new Error(
        "Managed worktree root must be a real canonical directory.",
      );
    }
  };

  const validateTransientPath = async (path: string): Promise<string> => {
    const candidate = resolve(path);
    const owner = transientRoots.find((root) => {
      try {
        relationship(root, candidate);
        return true;
      } catch {
        return false;
      }
    });
    if (owner === undefined) {
      throw new Error("Job staging path is not an owned transient child.");
    }
    const relativePath = relationship(owner, candidate);
    let current = owner;
    for (const segment of relativePath.split(sep)) {
      current = resolve(current, segment);
      const metadata = await lstat(current).catch((error: unknown) => {
        if (isMissingStorageEntry(error)) return null;
        throw error;
      });
      if (metadata === null) break;
      if (metadata.isSymbolicLink()) {
        throw new Error("Job staging path may not traverse symbolic links.");
      }
      if (current !== candidate && !metadata.isDirectory()) {
        throw new Error("Job staging parent must be a directory.");
      }
    }
    return candidate;
  };

  const validateReclaimableTransientPath = async (
    path: string,
  ): Promise<string> => {
    const candidate = await validateTransientPath(path);
    if (
      !reclaimableTransientRoots.some((root) => {
        try {
          relationship(root, candidate);
          return true;
        } catch {
          return false;
        }
      })
    ) {
      throw new Error(
        "Job staging path is not an owned reclaimable transient child.",
      );
    }
    return candidate;
  };

  const checkpoint = async (): Promise<FailedRetryCheckpointV1 | null> => {
    const path = options.paths.failedRetryCheckpoint;
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (isMissingStorageEntry(error)) return null;
      throw error;
    }
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.size > MAX_CHECKPOINT_BYTES
    ) {
      throw new Error("Failed retry checkpoint is not a bounded regular file.");
    }
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("schemaVersion" in parsed) ||
      parsed.schemaVersion !== 1 ||
      !("jobId" in parsed) ||
      typeof parsed.jobId !== "string" ||
      !("failedAt" in parsed) ||
      typeof parsed.failedAt !== "string" ||
      !("expiresAt" in parsed) ||
      typeof parsed.expiresAt !== "string" ||
      !("transientPaths" in parsed) ||
      !Array.isArray(parsed.transientPaths) ||
      !("artifactReferences" in parsed) ||
      !Array.isArray(parsed.artifactReferences)
    ) {
      throw new Error("Failed retry checkpoint format is invalid.");
    }
    const transientPaths = await Promise.all(
      parsed.transientPaths.map((value) => {
        if (typeof value !== "string") {
          throw new Error("Failed retry checkpoint path is invalid.");
        }
        return validateReclaimableTransientPath(value);
      }),
    );
    const failedAt = new Date(parsed.failedAt);
    const expiresAt = new Date(parsed.expiresAt);
    if (
      Number.isNaN(failedAt.getTime()) ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() - failedAt.getTime() !== policy.failedRetryTtlMs
    ) {
      throw new Error("Failed retry checkpoint time bounds are invalid.");
    }
    return Object.freeze({
      schemaVersion: 1,
      jobId: validateJobId(parsed.jobId),
      failedAt: failedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      transientPaths: Object.freeze(transientPaths),
      artifactReferences: Object.freeze(
        parsed.artifactReferences.map(validateArtifactReference),
      ),
    });
  };

  const deletePaths = async (paths: readonly string[]): Promise<number> => {
    const inspected = await Promise.all(
      paths.map(async (path) => ({
        path: await validateReclaimableTransientPath(path),
        // The staging root itself was validated above as a real owned path.
        // Package managers legitimately place links below that root; count
        // those links as entries so finalization can remove the owned tree
        // without ever traversing an external target.
        inspection: await inspectStorageTree(path, "entry"),
      })),
    );
    let removed = 0;
    for (const entry of inspected) {
      if (entry.inspection === null) continue;
      await rm(entry.path, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  };

  const syncDirectory = async (path: string): Promise<void> => {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  };

  const removeCheckpoint = async (): Promise<void> => {
    let removed = false;
    await unlink(options.paths.failedRetryCheckpoint)
      .then(() => {
        removed = true;
      })
      .catch((error: unknown) => {
        if (!isMissingStorageEntry(error)) throw error;
      });
    if (removed) await syncDirectory(options.paths.budgetState);
  };

  const writeCheckpoint = async (
    value: FailedRetryCheckpointV1,
  ): Promise<void> => {
    await mkdir(options.paths.budgetState, {
      recursive: true,
      mode: 0o700,
    });
    const stateMetadata = await lstat(options.paths.budgetState);
    if (stateMetadata.isSymbolicLink() || !stateMetadata.isDirectory()) {
      throw new Error("Storage budget state must be a real directory.");
    }
    const temporary = resolve(
      options.paths.budgetState,
      `.failed-retry-${randomUUID()}.tmp`,
    );
    relationship(options.paths.budgetState, temporary);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, options.paths.failedRetryCheckpoint);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    await syncDirectory(options.paths.budgetState);
  };

  const inspectRoots = async () => {
    await ensureRoot();
    await options.artifactStore.initialize();
    const [root, transientGroups, cacheGroups, artifactUsage] =
      await Promise.all([
        inspectStorageTree(options.paths.root, "entry", [
          resolve(options.paths.root, "runtime"),
        ]),
        Promise.all(
          transientRoots.map((root) =>
            inspectStorageChildren(
              root,
              root === options.paths.simulator ? "entry" : "reject",
              root === options.paths.worktrees || root === options.paths.staging
                ? "entry"
                : "reject",
            ),
          ),
        ),
        Promise.all(
          cacheRoots.map((root) => inspectStorageChildren(root, "entry")),
        ),
        options.artifactStore.inspectUsage(),
      ]);
    const transientEntries = Object.freeze(transientGroups.flat());
    const reclaimableTransientEntries = Object.freeze(
      transientEntries.filter((entry) =>
        reclaimableTransientRoots.some((root) =>
          storagePathsOverlap(entry.path, [root]),
        ),
      ),
    );
    const cacheEntries = Object.freeze(cacheGroups.flat());
    const rootBytes = root?.bytes ?? 0;
    const externalWorktreeBytes = usesExternalWorktreeRoot
      ? storageEntriesBytes(transientGroups[0] ?? [])
      : 0;
    return Object.freeze({
      rootBytes,
      totalBytes: rootBytes + externalWorktreeBytes,
      transientEntries,
      reclaimableTransientEntries,
      transientBytes: storageEntriesBytes(transientEntries),
      cacheEntries,
      cacheBytes: storageEntriesBytes(cacheEntries),
      artifactBytes: artifactUsage.totalBytes,
    });
  };

  const inspect = async (): Promise<StorageBudgetSnapshot> => {
    const usage = await inspectRoots();
    const measuredFreeBytes = await freeBytes(options.paths.root);
    return Object.freeze({
      totalBytes: usage.totalBytes,
      transientBytes: usage.transientBytes,
      artifactBytes: usage.artifactBytes,
      sharedCacheBytes: usage.cacheBytes,
      freeBytes: measuredFreeBytes,
      cleanupRecommended:
        usage.totalBytes >= policy.cleanupThresholdBytes ||
        usage.transientBytes > policy.maximumTransientBytes ||
        usage.artifactBytes > policy.maximumArtifactBytes ||
        usage.cacheBytes > policy.maximumSharedCacheBytes,
      hardLimitExceeded: usage.totalBytes > policy.hardLimitBytes,
    });
  };

  const garbageCollectUnlocked = async (input: {
    readonly artifactReferences: readonly ArtifactReference[];
  }, mode: "automatic" | "finalization" = "automatic"): Promise<
    StorageGarbageCollectionResult
  > => {
    await ensureRoot();
    const initial = await inspectRoots();
    let retainedCheckpoint = await checkpoint();
    const activePaths = Object.freeze(
      [...activeJobs.values()].flatMap((job) => job.transientPaths),
    );
    const cleanupPlan = planTransientStorageCleanup({
      transientEntries: initial.reclaimableTransientEntries,
      activePaths,
      retryCheckpoint:
        retainedCheckpoint === null
          ? null
          : {
              transientPaths: retainedCheckpoint.transientPaths,
              expiresAtMs: new Date(retainedCheckpoint.expiresAt).getTime(),
            },
      nowMs: now().getTime(),
    });
    const expiredFailedRetryCheckpoint = cleanupPlan.retryCheckpointExpired;
    if (expiredFailedRetryCheckpoint && retainedCheckpoint !== null) {
      await deletePaths(retainedCheckpoint.transientPaths);
      await removeCheckpoint();
      retainedCheckpoint = null;
    }
    let removedTransientEntries = 0;
    for (const path of cleanupPlan.removablePaths) {
      await rm(path, { recursive: true, force: true });
      removedTransientEntries += 1;
    }
    if (activeJobs.size > 0) {
      return Object.freeze({
        removedArtifacts: 0,
        removedTransientEntries,
        removedSharedCacheEntries: 0,
        expiredFailedRetryCheckpoint,
        skippedActiveJobs: activeJobs.size,
        snapshot: await inspect(),
      });
    }
    const removedArtifacts =
      mode === "finalization"
        ? await options.artifactStore.purgeUnreferenced(
            Object.freeze([
              ...input.artifactReferences,
              ...(retainedCheckpoint?.artifactReferences ?? []),
            ]),
          )
        : 0;

    let removedSharedCacheEntries = 0;
    if (mode === "finalization") {
      const afterTransient = await inspectRoots();
      const targetCacheBytes = Math.max(
        0,
        Math.min(
          policy.maximumSharedCacheBytes,
          afterTransient.cacheBytes -
            Math.max(
              0,
              afterTransient.totalBytes - policy.cleanupThresholdBytes,
            ),
        ),
      );
      let remainingCacheBytes = afterTransient.cacheBytes;
      for (const entry of [...afterTransient.cacheEntries].sort(
        (left, right) => left.modifiedAtMs - right.modifiedAtMs,
      )) {
        if (remainingCacheBytes <= targetCacheBytes) break;
        await rm(entry.path, { recursive: true, force: true });
        remainingCacheBytes -= entry.bytes;
        removedSharedCacheEntries += 1;
      }
    }

    return Object.freeze({
      removedArtifacts,
      removedTransientEntries,
      removedSharedCacheEntries,
      expiredFailedRetryCheckpoint,
      skippedActiveJobs: 0,
      snapshot: await inspect(),
    });
  };

  const garbageCollect = (input: {
    readonly artifactReferences: readonly ArtifactReference[];
  }) => withMutationLock(() => garbageCollectUnlocked(input));

  /**
   * Dependency and toolchain caches are always re-creatable. A new approved
   * job reserves part of the shared-cache budget before it writes anything, so
   * compact only enough oldest cache entries to honour that reservation. This
   * deliberately does not run during startup GC: opening Memi must never evict
   * a useful cache merely because it exists.
   */
  const reserveSharedCacheCapacity = async (
    requestedBytes: number,
    requestingJobId: string | undefined,
  ): Promise<void> => {
    if (requestedBytes === 0 || requestedBytes > policy.maximumSharedCacheBytes) {
      return;
    }
    const usage = await inspectRoots();
    const targetBytes = policy.maximumSharedCacheBytes - requestedBytes;
    const hasForeignActiveJob = [...activeJobs.keys()].some(
      (jobId) => jobId !== requestingJobId,
    );
    if (usage.cacheBytes <= targetBytes || hasForeignActiveJob) return;
    let remainingBytes = usage.cacheBytes;
    for (const entry of [...usage.cacheEntries].sort(
      (left, right) => left.modifiedAtMs - right.modifiedAtMs,
    )) {
      if (remainingBytes <= targetBytes) break;
      await rm(entry.path, { recursive: true, force: true });
      remainingBytes -= entry.bytes;
    }
  };

  const retainFailure = async (
    job: ActiveJob,
    artifactReferences: readonly ArtifactReference[],
  ): Promise<void> => {
    const prior = await checkpoint();
    const inspections = await Promise.all(
      // Capture worktrees can contain package-manager links. Count the link
      // itself but never traverse it: a nested link must not crash finalization
      // or make an external target eligible for Memi cleanup.
      job.transientPaths.map((path) => inspectStorageTree(path, "entry")),
    );
    const retryBytes = inspections.reduce(
      (total, entry) => total + (entry?.bytes ?? 0),
      0,
    );
    if (
      !Number.isSafeInteger(retryBytes) ||
      retryBytes > policy.maximumTransientBytes
    ) {
      await deletePaths(job.transientPaths);
      return;
    }
    if (prior !== null && prior.jobId !== job.jobId) {
      await deletePaths(prior.transientPaths);
    }
    const failedAt = now();
    await writeCheckpoint(
      Object.freeze({
        schemaVersion: 1,
        jobId: job.jobId,
        failedAt: failedAt.toISOString(),
        expiresAt: new Date(
          failedAt.getTime() + policy.failedRetryTtlMs,
        ).toISOString(),
        transientPaths: job.transientPaths,
        artifactReferences: Object.freeze([...artifactReferences]),
      }),
    );
  };

  return Object.freeze({
    async acquireJobLock(input: {
      readonly jobId: string;
      readonly transientPaths: readonly string[];
    }) {
      await ensureRoot();
      const jobId = validateJobId(input.jobId);
      if (activeJobs.has(jobId)) {
        throw new Error("Import job already holds a storage lock.");
      }
      const transientPaths = Object.freeze(
        await Promise.all(
          input.transientPaths.map(validateReclaimableTransientPath),
        ),
      );
      if (new Set(transientPaths).size !== transientPaths.length) {
        throw new Error("Import job staging paths must be unique.");
      }
      if (activeJobs.has(jobId)) {
        throw new Error("Import job already holds a storage lock.");
      }
      for (const active of activeJobs.values()) {
        if (
          transientPaths.some((candidate) =>
            storagePathsOverlap(candidate, active.transientPaths),
          )
        ) {
          throw new Error(
            "Import job staging overlaps an active storage lock.",
          );
        }
      }
      const job = Object.freeze({ jobId, transientPaths });
      activeJobs.set(jobId, job);
      let state: "active" | "finalizing" | "released" = "active";

      const release = async (): Promise<void> => {
        if (state === "released") return;
        if (state === "finalizing") {
          throw new Error("Import storage lock is finalizing.");
        }
        activeJobs.delete(jobId);
        state = "released";
      };

      return Object.freeze({
        jobId,
        async finalize(input: StorageBudgetFinalizeInput) {
          if (state !== "active" || activeJobs.get(jobId) !== job) {
            throw new Error("Import storage lock is no longer active.");
          }
          state = "finalizing";
          try {
            return await withMutationLock(async () => {
              let removedImmediately = 0;
              if (input.outcome === "failed") {
                await retainFailure(job, input.artifactReferences);
              } else {
                removedImmediately = await deletePaths(job.transientPaths);
              }
              activeJobs.delete(jobId);
              state = "released";
              const collected = await garbageCollectUnlocked({
                artifactReferences: input.artifactReferences,
              }, "finalization");
              return Object.freeze({
                ...collected,
                removedTransientEntries:
                  removedImmediately + collected.removedTransientEntries,
              });
            });
          } catch (error) {
            if (state === "finalizing") state = "active";
            throw error;
          }
        },
        release,
      });
    },
    garbageCollect,
    startupGarbageCollect: garbageCollect,
    hasActiveJobs: () => activeJobs.size > 0,
    inspect,
    async preflight(input: StorageBudgetPreflightInput) {
      const requestedTransient = validateEstimate(
        input.transientBytes,
        "Transient storage",
      );
      const requestedArtifacts = validateEstimate(
        input.artifactBytes,
        "Artifact storage",
      );
      const requestedCache = validateEstimate(
        input.sharedCacheBytes,
        "Shared cache",
      );
      const requestingJobId = input.jobId === undefined
        ? undefined
        : validateJobId(input.jobId);
      return withMutationLock(async () => {
        await garbageCollectUnlocked({
          artifactReferences: input.artifactReferences,
        });
        await reserveSharedCacheCapacity(requestedCache, requestingJobId);
        const snapshot = await inspect();
        if (
          snapshot.transientBytes + requestedTransient >
          policy.maximumTransientBytes
        ) {
          throw new Error("Import exceeds the transient storage budget.");
        }
        if (
          snapshot.artifactBytes + requestedArtifacts >
          policy.maximumArtifactBytes
        ) {
          throw new Error("Import exceeds the artifact storage budget.");
        }
        if (
          snapshot.sharedCacheBytes + requestedCache >
          policy.maximumSharedCacheBytes
        ) {
          throw new Error("Import exceeds the shared cache budget.");
        }
        const requestedTotal =
          requestedTransient + requestedArtifacts + requestedCache;
        if (snapshot.totalBytes + requestedTotal > policy.hardLimitBytes) {
          throw new Error("Import exceeds the Memi storage hard limit.");
        }
        if (snapshot.freeBytes < policy.minimumFreeBytes + requestedTotal) {
          throw new Error(
            `Import requires the ${formatStorageBytes(policy.minimumFreeBytes)} free-space reserve plus its estimated storage.`,
          );
        }
        return snapshot;
      });
    },
  });
}
