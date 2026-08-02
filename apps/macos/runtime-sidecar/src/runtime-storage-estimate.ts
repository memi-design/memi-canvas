import type { StorageBudgetEstimate } from "@memi/runtime/bun-import-stores";

const MIB = 1_024 * 1_024;
const GIB = 1_024 * MIB;

function positiveCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

export function estimateImportStorage(input: {
  readonly applicationCount: number;
  readonly scenarioCount: number;
}): StorageBudgetEstimate {
  const applicationCount = positiveCount(
    input.applicationCount,
    "Application count",
  );
  const scenarioCount = positiveCount(
    input.scenarioCount,
    "Scenario count",
  );
  return Object.freeze({
    transientBytes: Math.min(4 * GIB, applicationCount * GIB),
    artifactBytes: Math.min(2 * GIB, scenarioCount * 16 * MIB),
    sharedCacheBytes: Math.min(
      2 * GIB,
      applicationCount * 512 * MIB,
    ),
  });
}
