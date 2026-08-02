import type { RuntimeClientV1 } from "./runtime-client.js";

export const TRUTHFUL_IMPORT_RUNTIME_RESET_KEY =
  "memi.truthful-import-runtime-reset.v1";

export interface TruthfulImportResetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function hasCompletedTruthfulImportRuntimeReset(
  storage: Pick<TruthfulImportResetStorage, "getItem">,
): boolean {
  try {
    return storage.getItem(TRUTHFUL_IMPORT_RUNTIME_RESET_KEY) === "complete";
  } catch {
    return false;
  }
}

export async function ensureTruthfulImportRuntimeReset(input: {
  readonly imports: Pick<RuntimeClientV1["imports"], "purgeAll">;
  readonly storage: TruthfulImportResetStorage;
}): Promise<boolean> {
  if (hasCompletedTruthfulImportRuntimeReset(input.storage)) {
    return true;
  }
  const result = await input.imports.purgeAll({});
  if (!result.complete) {
    return false;
  }
  input.storage.setItem(
    TRUTHFUL_IMPORT_RUNTIME_RESET_KEY,
    "complete",
  );
  return true;
}
