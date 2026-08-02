import type { SqlRow } from "./database.js";
import type {
  HarnessRunSnapshot,
  HarnessTaskInput,
} from "./types.js";

export interface StoredHarnessTask extends HarnessTaskInput {
  readonly taskHash: string;
}

export type StoredHarnessRun = HarnessRunSnapshot & {
  readonly lastEventSequence: number;
  readonly lastEventHash?: string;
};

export function harnessRowNumber(row: SqlRow, key: string): number {
  return Number(row[key]);
}

export function harnessRowString(row: SqlRow, key: string): string {
  return String(row[key]);
}

export function parseHarnessStringArray(
  value: unknown,
): readonly string[] {
  const parsed: unknown = JSON.parse(String(value));
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw new Error("Durable harness string-array state is corrupt.");
  }
  return parsed;
}

export function assertHarnessIdentifier(
  value: string,
  label: string,
): void {
  if (
    value.length < 1 ||
    value.length > 160 ||
    value.trim() !== value
  ) {
    throw new Error(`${label} is invalid.`);
  }
}

export function assertHarnessBudget(
  value: number,
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

export function storedHarnessTaskFromRow(
  row: SqlRow,
): StoredHarnessTask {
  return {
    projectId: harnessRowString(row, "project_id"),
    taskId: harnessRowString(row, "task_id"),
    goal: harnessRowString(row, "goal"),
    permissionCeiling: parseHarnessStringArray(
      row.permission_ceiling_json,
    ),
    tokenBudget: harnessRowNumber(row, "token_budget"),
    costBudgetUsdMicros: harnessRowNumber(
      row,
      "cost_budget_usd_micros",
    ),
    taskHash: harnessRowString(row, "task_hash"),
  };
}

export function storedHarnessRunFromRow(
  row: SqlRow,
): StoredHarnessRun {
  const failure =
    row.failure_json === null
      ? undefined
      : (JSON.parse(harnessRowString(row, "failure_json")) as {
          readonly code: string;
          readonly message: string;
        });
  return {
    runId: harnessRowString(row, "run_id"),
    taskId: harnessRowString(row, "task_id"),
    ...(row.parent_run_id === null
      ? {}
      : { parentRunId: harnessRowString(row, "parent_run_id") }),
    harnessId: harnessRowString(row, "harness_id"),
    modelId: harnessRowString(row, "model_id"),
    state: harnessRowString(
      row,
      "state",
    ) as HarnessRunSnapshot["state"],
    dispatchEpoch: harnessRowNumber(row, "dispatch_epoch"),
    adapterCursor: harnessRowNumber(row, "adapter_cursor"),
    remainingTokenBudget: harnessRowNumber(
      row,
      "remaining_token_budget",
    ),
    remainingCostBudgetUsdMicros: harnessRowNumber(
      row,
      "remaining_cost_budget_usd_micros",
    ),
    ...(row.checkpoint_id === null
      ? {}
      : { checkpointId: harnessRowString(row, "checkpoint_id") }),
    ...(failure === undefined ? {} : { failure }),
    lastEventSequence: harnessRowNumber(
      row,
      "last_event_sequence",
    ),
    ...(row.last_event_hash === null
      ? {}
      : {
          lastEventHash: harnessRowString(row, "last_event_hash"),
        }),
  };
}
