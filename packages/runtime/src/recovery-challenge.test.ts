import { describe, expect, it } from "vitest";

import { secureRecoveryChallengeFactory } from "./recovery-challenge.js";

describe("secure recovery challenge factory", () => {
  it("generates distinct runtime-owned ids and 32-byte base64url nonces", () => {
    const challenges = Array.from(
      { length: 64 },
      secureRecoveryChallengeFactory,
    );

    expect(new Set(challenges.map(({ id }) => id)).size).toBe(64);
    expect(new Set(challenges.map(({ nonce }) => nonce)).size).toBe(
      64,
    );
    for (const challenge of challenges) {
      expect(challenge.id).toMatch(
        /^rcv_[0-9A-HJKMNP-TV-Z]{26}$/u,
      );
      expect(challenge.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    }
  });
});
