import { describe, expect, it } from "vitest";

import { readPngDimensions, verifyStableFrames } from "./stability.js";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

describe("verifyStableFrames", () => {
  it("accepts two byte-identical, non-empty frames", () => {
    const result = verifyStableFrames(
      new Uint8Array([137, 80, 78, 71]),
      new Uint8Array([137, 80, 78, 71]),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hash).toMatch(/^sha256:/u);
    }
  });

  it("rejects unstable, empty, and over-limit frames precisely", () => {
    expect(
      verifyStableFrames(new Uint8Array([1]), new Uint8Array([2])),
    ).toMatchObject({ ok: false, code: "UNSTABLE_FRAME" });
    expect(
      verifyStableFrames(new Uint8Array(), new Uint8Array()),
    ).toMatchObject({ ok: false, code: "EMPTY_FRAME" });
    expect(
      verifyStableFrames(
        new Uint8Array(5),
        new Uint8Array(5),
        { maximumBytes: 4 },
      ),
    ).toMatchObject({ ok: false, code: "FRAME_TOO_LARGE" });
  });
});

describe("readPngDimensions", () => {
  it("reads native pixel authority from the PNG IHDR chunk", () => {
    expect(readPngDimensions(pngHeader(1_206, 2_622))).toEqual({
      width: 1_206,
      height: 2_622,
    });
  });

  it("rejects truncated, non-PNG, and impossible dimensions", () => {
    expect(readPngDimensions(new Uint8Array([137, 80, 78, 71]))).toBeNull();
    expect(readPngDimensions(new Uint8Array(24))).toBeNull();
    expect(readPngDimensions(pngHeader(0, 2_622))).toBeNull();
  });
});
