import type { ImportJobSnapshotV2 } from "@memi/protocol";

function sameAuthority(
  current: ImportJobSnapshotV2,
  next: ImportJobSnapshotV2,
): boolean {
  return current.id === next.id &&
    current.projectName === next.projectName &&
    current.repository.rootPath === next.repository.rootPath &&
    current.repository.sourceRevision === next.repository.sourceRevision &&
    current.repository.dirtyFingerprint ===
      next.repository.dirtyFingerprint;
}

export function acceptsImportJobSnapshot(
  current: ImportJobSnapshotV2 | undefined,
  next: ImportJobSnapshotV2,
): boolean {
  if (current === undefined) return true;
  if (!sameAuthority(current, next) || next.revision < current.revision) {
    return false;
  }
  return next.revision > current.revision ||
    JSON.stringify(next) === JSON.stringify(current);
}

/**
 * Prevents a delayed mutation or polling response from replacing newer import
 * state, and rejects snapshots that switch repository authority mid-job.
 */
export function selectLatestImportJob(
  current: ImportJobSnapshotV2 | undefined,
  next: ImportJobSnapshotV2,
): ImportJobSnapshotV2 {
  if (current === undefined) return next;
  if (!acceptsImportJobSnapshot(current, next)) return current;
  return next.revision > current.revision ? next : current;
}
