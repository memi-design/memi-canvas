import { createHash } from "node:crypto";

export interface StableFrameOptions {
  readonly maximumBytes?: number;
  readonly minimumBytes?: number;
}

export type StableFrameResult =
  | Readonly<{ ok: true; hash: `sha256:${string}` }>
  | Readonly<{
      ok: false;
      code: "EMPTY_FRAME" | "FRAME_TOO_LARGE" | "UNSTABLE_FRAME";
      message: string;
    }>;

function frameHash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);

export function readPngDimensions(
  bytes: Uint8Array,
): Readonly<{ width: number; height: number }> | null {
  if (
    bytes.byteLength < 24 ||
    !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) ||
    bytes[12] !== 73 ||
    bytes[13] !== 72 ||
    bytes[14] !== 68 ||
    bytes[15] !== 82
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width === 0 || height === 0 ? null : Object.freeze({ width, height });
}

export function verifyStableFrames(
  first: Uint8Array,
  second: Uint8Array,
  options: StableFrameOptions = {},
): StableFrameResult {
  const maximumBytes = options.maximumBytes ?? 64 * 1_024 * 1_024;
  const minimumBytes = options.minimumBytes ?? 1;
  if (first.byteLength < minimumBytes || second.byteLength < minimumBytes) {
    return Object.freeze({
      ok: false,
      code: "EMPTY_FRAME",
      message: "Runtime capture produced an empty frame.",
    });
  }
  if (
    first.byteLength > maximumBytes ||
    second.byteLength > maximumBytes
  ) {
    return Object.freeze({
      ok: false,
      code: "FRAME_TOO_LARGE",
      message: "Runtime capture exceeded the configured frame limit.",
    });
  }
  const firstHash = frameHash(first);
  const secondHash = frameHash(second);
  if (firstHash !== secondHash) {
    return Object.freeze({
      ok: false,
      code: "UNSTABLE_FRAME",
      // Hash prefixes are safe diagnostic evidence: they expose neither pixels
      // nor runtime text, but make an unstable capture debuggable in a retry.
      message: `The two runtime frames were not byte-identical (${firstHash.slice(0, 19)} → ${secondHash.slice(0, 19)}).`,
    });
  }
  return Object.freeze({ ok: true, hash: firstHash });
}
