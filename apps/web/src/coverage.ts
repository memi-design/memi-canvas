import {
  type Capture,
  type ImportedProject,
  isBlockedCell,
  isVerifiedCapture,
} from "./model";

export interface CoverageSummary {
  readonly required: number;
  readonly verified: number;
  readonly partial: number;
  readonly blocked: number;
  readonly complete: boolean;
}

export function coverageSummary(
  project: ImportedProject,
): CoverageSummary {
  const requiredCaptureIds = [
    ...new Set(project.coverage.requiredCaptureIds),
  ];
  const capturesById = project.screens
    .flatMap((screenItem) => screenItem.captures)
    .reduce<Readonly<Record<string, readonly Capture[]>>>(
      (index, capture) => ({
        ...index,
        [capture.id]: [...(index[capture.id] ?? []), capture],
      }),
      {},
    );
  const requiredStates = requiredCaptureIds.map(
    (captureId) => capturesById[captureId] ?? [],
  );
  const verified = requiredStates.filter((captures) =>
    captures.some(isVerifiedCapture),
  ).length;
  const partial = requiredStates.filter(
    (captures) =>
      !captures.some(isVerifiedCapture) &&
      captures.some((capture) => capture.coverageHealth === "partial"),
  ).length;
  const blocked = requiredStates.filter(
    (captures) =>
      !captures.some(isVerifiedCapture) &&
      !captures.some((capture) => capture.coverageHealth === "partial") &&
      captures.some(isBlockedCell),
  ).length;

  return {
    required: requiredCaptureIds.length,
    verified,
    partial,
    blocked,
    complete:
      requiredCaptureIds.length > 0 &&
      verified === requiredCaptureIds.length,
  };
}
