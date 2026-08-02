import type { ArtifactReference } from "@memi/capture-execution";
import type { ImportJobId, ImportJobSnapshotV2 } from "@memi/protocol";

import type { ImportCoordinatorOptions } from "./import-coordinator.types.js";
import type { StorageBudgetJobLock } from "./storage-budget-policy.js";

type StorageOutcome = "succeeded" | "failed" | "cancelled";
type StorageLockMode = "capture" | "cleanup";

function storageErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  return message === "" ? fallback : message;
}

export class ImportCoordinatorStorage {
  readonly #options: Pick<
    ImportCoordinatorOptions,
    | "artifactStore"
    | "storageBudgetAuthority"
    | "storageBudgetEstimateFor"
    | "store"
  >;
  readonly #locks = new Map<ImportJobId, StorageBudgetJobLock>();
  readonly #lockModes = new Map<ImportJobId, StorageLockMode>();
  readonly #finalizations = new Map<ImportJobId, Promise<void>>();

  constructor(options: ImportCoordinatorOptions) {
    this.#options = options;
  }

  async listRetainedArtifactReferences(
    excludedJobId?: ImportJobId,
  ): Promise<
    readonly ArtifactReference[]
  > {
    const [jobs, stored] = await Promise.all([
      this.#options.store.listAll(),
      this.#options.artifactStore.listReferences(),
    ]);
    const retainedIds: ReadonlySet<string> = new Set(
      jobs
        .filter(({ id }) => id !== excludedJobId)
        .flatMap(({ artifacts }) =>
        artifacts.flatMap((artifact) => [
          artifact.screenshotArtifactId,
          ...(artifact.hierarchyArtifactId === null
            ? []
            : [artifact.hierarchyArtifactId]),
          ...(artifact.geometryArtifactId === null
            ? []
            : [artifact.geometryArtifactId]),
          ...(artifact.reconstructionArtifactId === null
            ? []
            : [artifact.reconstructionArtifactId]),
        ]),
      ),
    );
    return Object.freeze(stored.filter(({ id }) => retainedIds.has(id)));
  }

  async ensure(
    job: ImportJobSnapshotV2,
    input: {
      readonly managedRootPath: string;
      readonly applicationCount: number;
      readonly scenarioCount: number;
    },
  ): Promise<void> {
    const authority = this.#options.storageBudgetAuthority;
    if (authority === undefined) return;
    const existing = this.#locks.get(job.id);
    if (existing !== undefined && this.#lockModes.get(job.id) !== "cleanup") {
      return;
    }
    const finalizing = this.#finalizations.get(job.id);
    if (finalizing !== undefined) await finalizing;
    const afterFinalization = this.#locks.get(job.id);
    if (
      afterFinalization !== undefined &&
      this.#lockModes.get(job.id) !== "cleanup"
    ) {
      return;
    }
    if (afterFinalization !== undefined) {
      await afterFinalization.release();
      this.#locks.delete(job.id);
      this.#lockModes.delete(job.id);
    }
    const estimate =
      this.#options.storageBudgetEstimateFor?.({
        applicationCount: input.applicationCount,
        scenarioCount: input.scenarioCount,
      }) ?? {};
    const lockInput = {
      jobId: job.id,
      transientPaths: [input.managedRootPath],
    };
    const lock = await authority.acquireJobLock(lockInput);
    this.#locks.set(job.id, lock);
    this.#lockModes.set(job.id, "capture");
    try {
      await authority.preflight({
        ...estimate,
        jobId: job.id,
        artifactReferences: await this.listRetainedArtifactReferences(),
      });
    } catch (error) {
      try {
        await lock.finalize({
          outcome: "cancelled",
          artifactReferences: await this.listRetainedArtifactReferences(),
        });
        this.#locks.delete(job.id);
        this.#lockModes.delete(job.id);
      } catch (finalizationError) {
        this.#locks.delete(job.id);
        this.#lockModes.delete(job.id);
        await lock.release().catch(() => undefined);
        throw new AggregateError([error, finalizationError],
          `Storage preflight failed: ${storageErrorMessage(error, "Memi could not reserve storage.")} Cleanup failed: ${storageErrorMessage(finalizationError, "Memi could not clean the interrupted staging area.")}`,
        );
      }
      throw error;
    }
  }

  /**
   * Reclaiming a durable draft must not reserve capacity for a new capture.
   * It only obtains the same bounded lock used by execution so finalization
   * can remove a retained worktree after a process restart.
   */
  async ensureCleanup(
    job: ImportJobSnapshotV2,
    managedRootPath: string,
  ): Promise<void> {
    const authority = this.#options.storageBudgetAuthority;
    if (authority === undefined || this.#locks.has(job.id)) return;
    const finalizing = this.#finalizations.get(job.id);
    if (finalizing !== undefined) await finalizing;
    if (this.#locks.has(job.id)) return;
    const lock = await authority.acquireJobLock({
      jobId: job.id,
      transientPaths: [managedRootPath],
    });
    this.#locks.set(job.id, lock);
    this.#lockModes.set(job.id, "cleanup");
  }

  async finalizeTerminal(jobId: ImportJobId): Promise<void> {
    const job = await this.#options.store.get(jobId);
    if (job === null) return;
    if (job.state === "failed") {
      await this.finalize(jobId, "failed");
    } else if (job.state === "committed") {
      await this.finalize(jobId, "succeeded");
    }
  }

  async finalizeDiscarded(job: ImportJobSnapshotV2): Promise<void> {
    await this.finalize(
      job.id,
      "cancelled",
      await this.listRetainedArtifactReferences(job.id),
    );
  }

  async finalize(
    jobId: ImportJobId,
    outcome: StorageOutcome,
    artifactReferences?: readonly ArtifactReference[],
  ): Promise<void> {
    const existing = this.#finalizations.get(jobId);
    if (existing !== undefined) return existing;
    const lock = this.#locks.get(jobId);
    if (lock === undefined) return;
    const operation = (async () => {
      await lock.finalize({
        outcome,
        artifactReferences:
          artifactReferences ?? (await this.listRetainedArtifactReferences()),
      });
      this.#locks.delete(jobId);
      this.#lockModes.delete(jobId);
    })();
    this.#finalizations.set(jobId, operation);
    try {
      await operation;
    } finally {
      if (this.#finalizations.get(jobId) === operation) {
        this.#finalizations.delete(jobId);
      }
    }
  }

  async releaseAll(): Promise<void> {
    await Promise.all(this.#finalizations.values());
    const locks = [...this.#locks.values()];
    await Promise.all(locks.map((lock) => lock.release()));
    this.#locks.clear();
    this.#lockModes.clear();
  }
}
