import { createHash } from "node:crypto";

import type { SandboxOutput } from "./types";

export interface BoundedOutputCollector {
  readonly output: () => SandboxOutput;
  readonly push: (chunk: Buffer) => boolean;
}

export function createBoundedOutputCollector(
  maximumBytes: number,
): BoundedOutputCollector {
  const chunks: Buffer[] = [];
  const hash = createHash("sha256");
  let capturedBytes = 0;
  let observedBytes = 0;
  let truncated = false;

  return {
    push(chunk) {
      observedBytes += chunk.byteLength;
      hash.update(chunk);

      const remaining = Math.max(0, maximumBytes - capturedBytes);
      if (remaining > 0) {
        const captured = Buffer.from(chunk.subarray(0, remaining));
        chunks.push(captured);
        capturedBytes += captured.byteLength;
      }

      if (chunk.byteLength > remaining) {
        truncated = true;
      }
      return truncated;
    },
    output() {
      return Object.freeze({
        text: Buffer.concat(chunks, capturedBytes).toString("utf8"),
        capturedBytes,
        observedBytes,
        sha256: `sha256:${hash.copy().digest("hex")}`,
        truncated,
      });
    },
  };
}

export function emptySandboxOutput(): SandboxOutput {
  return Object.freeze({
    text: "",
    capturedBytes: 0,
    observedBytes: 0,
    sha256:
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    truncated: false,
  });
}
