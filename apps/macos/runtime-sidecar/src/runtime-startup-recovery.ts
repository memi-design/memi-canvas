import type { ImportPurgeAllResultV1 } from "@memi/protocol";
import type { ArtifactReference } from "@memi/capture-execution/core";

interface RuntimeStartupRecoveryOptions {
  readonly purgeAuthority: {
    purgeRecoveryPending(): Promise<boolean>;
  };
  readonly coordinator: {
    purgeAll(): Promise<ImportPurgeAllResultV1>;
    recoverInterrupted(): Promise<unknown>;
    listRetainedArtifactReferences?(): Promise<
      readonly ArtifactReference[]
    >;
  };
  readonly storageBudgetAuthority?: {
    startupGarbageCollect(input: {
      readonly artifactReferences: readonly ArtifactReference[];
    }): Promise<unknown>;
  };
}

function isDeferredLegacyPlanIntegrityError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Stored import execution plan integrity is invalid."
  );
}

/**
 * Restores only the durable state required before the RPC socket can serve.
 *
 * Storage collection runs only after durable recovery has settled. This keeps
 * abandoned Memi-owned capture worktrees from accumulating across launches,
 * while active jobs and the single retry checkpoint stay protected by the
 * storage authority's locks and retention policy.
 */
export async function recoverRuntimeBeforeServing(
  options: RuntimeStartupRecoveryOptions,
): Promise<void> {
  if (await options.purgeAuthority.purgeRecoveryPending()) {
    const result = await options.coordinator.purgeAll();
    if (!result.complete) {
      throw new Error(
        "Runtime startup is blocked until interrupted import purge completes.",
      );
    }
  } else {
    try {
      await options.coordinator.recoverInterrupted();
    } catch (error) {
      // A plan sealed by a prior local key cannot be resumed safely. Keep its
      // durable job untouched for review, but do not make that historical
      // recovery issue prevent new imports or the editor from opening.
      if (!isDeferredLegacyPlanIntegrityError(error)) throw error;
    }
  }
}

export async function garbageCollectRuntimeAtStartup(
  options: RuntimeStartupRecoveryOptions,
): Promise<void> {
  if (options.storageBudgetAuthority !== undefined) {
    if (
      options.coordinator.listRetainedArtifactReferences === undefined
    ) {
      throw new Error(
        "Runtime storage cleanup requires durable artifact references.",
      );
    }
    await options.storageBudgetAuthority.startupGarbageCollect({
      artifactReferences:
        await options.coordinator.listRetainedArtifactReferences(),
    });
  }
}

export async function recoverRuntimeAtStartup(
  options: RuntimeStartupRecoveryOptions,
): Promise<void> {
  await recoverRuntimeBeforeServing(options);
  await garbageCollectRuntimeAtStartup(options);
}
