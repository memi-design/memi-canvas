import { describe, expect, it } from "vitest";

import { verifyStableFrames } from "./stability.js";

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
