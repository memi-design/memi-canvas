import { describe, expect, it } from "vitest";

import { verifyExpoRuntimeEvidence } from "./expo-runtime-evidence.js";
import { scenarioFixture } from "./test-fixtures.js";

const NONCE = "01J00000000000000000000000";
const REVISION = "a6ce2458e0cd1b252663057f2e4060f0929c0687";
const READINESS_TOKEN = "READY-01J00000000000000000000000";

function evidence(overrides: Readonly<Record<string, unknown>> = {}) {
  return new TextEncoder().encode(
    `MEMI_CAPTURE_EVIDENCE_V1:${JSON.stringify({
      version: 1,
      nonce: NONCE,
      sourceRevision: REVISION,
      runtimeToken: READINESS_TOKEN,
      route: "/profile",
      state: scenarioFixture.state,
      readinessSelector: scenarioFixture.readinessSelector,
      readinessMatched: true,
      blank: false,
      splash: false,
      errorBoundary: false,
      ...overrides,
    })}`,
  );
}

describe("Expo route-state runtime evidence", () => {
  it("accepts only evidence bound to the capture nonce and source revision", () => {
    expect(
      verifyExpoRuntimeEvidence({
        scenario: scenarioFixture,
        bytes: evidence(),
        expectedRoute: "/profile",
        expectedNonce: NONCE,
        expectedSourceRevision: REVISION,
      }),
    ).toMatchObject({
      nonce: NONCE,
      sourceRevision: REVISION,
      route: "/profile",
    });
  });

  it.each([
    [{ route: "/sign-in" }, "ROUTE_MISMATCH"],
    [{ nonce: "01J11111111111111111111111" }, "ATTESTATION_NONCE_MISMATCH"],
    [{ sourceRevision: "b".repeat(40) }, "ATTESTATION_REVISION_MISMATCH"],
  ])("rejects redirected or stale runtime evidence %#", (override, code) => {
    expect(() =>
      verifyExpoRuntimeEvidence({
        scenario: scenarioFixture,
        bytes: evidence(override),
        expectedRoute: "/profile",
        expectedNonce: NONCE,
        expectedSourceRevision: REVISION,
      }),
    ).toThrow(expect.objectContaining({ code }));
  });
});

describe("Expo managed runtime readiness", () => {
  it("accepts either the exact readiness marker or evidence from the same runtime", async () => {
    const { isExpoManagedRuntimeReady } = await import(
      "./expo-runtime-evidence.js"
    );

    expect(
      isExpoManagedRuntimeReady(
        new TextEncoder().encode(`MEMI_CAPTURE_READY_V1:${READINESS_TOKEN}`),
        READINESS_TOKEN,
      ),
    ).toBe(true);
    expect(isExpoManagedRuntimeReady(evidence(), READINESS_TOKEN)).toBe(true);
  });

  it("rejects stale readiness and evidence from a different runtime", async () => {
    const { isExpoManagedRuntimeReady } = await import(
      "./expo-runtime-evidence.js"
    );

    expect(
      isExpoManagedRuntimeReady(
        new TextEncoder().encode("MEMI_CAPTURE_READY_V1:STALE"),
        READINESS_TOKEN,
      ),
    ).toBe(false);
    expect(
      isExpoManagedRuntimeReady(
        evidence({ runtimeToken: "READY-STALE" }),
        READINESS_TOKEN,
      ),
    ).toBe(false);
  });
});
