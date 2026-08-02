import { createHash } from "node:crypto";

import {
  DeterministicSourceCompilerError,
} from "./types.js";

export const MAX_SOURCE_TEXT_BYTES = 8 * 1_024 * 1_024;

export function assertSourceTextBounded(sourceText: string): void {
  if (
    sourceText.includes("\u0000") ||
    Buffer.byteLength(sourceText, "utf8") > MAX_SOURCE_TEXT_BYTES
  ) {
    throw new DeterministicSourceCompilerError(
      "invalid-input",
      `Source text must contain no null bytes and must not exceed ${MAX_SOURCE_TEXT_BYTES} bytes.`,
    );
  }
}

export async function hashSourceText(
  sourceText: string,
): Promise<`sha256:${string}`> {
  assertSourceTextBounded(sourceText);
  const digest = createHash("sha256").update(sourceText, "utf8").digest("hex");
  return `sha256:${digest}`;
}
