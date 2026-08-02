import { describe, expect, it } from "vitest";

import { HarnessSignalSchema } from "./harness.js";

describe("HarnessSignal", () => {
  it("accepts the closed provider-neutral lifecycle vocabulary", () => {
    const signals = [
      { kind: "assistant.delta", text: "Measured locally." },
      {
        kind: "approval.requested",
        approvalId: "approval-1",
        scopes: ["canvas:apply"],
      },
      {
        kind: "approval.resolved",
        approvalId: "approval-1",
        decision: "approved",
        actorId: "human-demo",
      },
      {
        kind: "decision.accepted",
        decisionId: "decision-1",
        summary: "Reuse the semantic spacing token.",
      },
      { kind: "artifact.produced", artifactRef: "artifact-1" },
      { kind: "checkpoint.saved", checkpointId: "checkpoint-1" },
      {
        kind: "effect.requested",
        effectKind: "canvas.operation",
        requiredPermission: "canvas:apply",
        payloadDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      { kind: "usage.recorded", tokens: 0, costUsdMicros: 0 },
      { kind: "run.completed" },
      {
        kind: "run.failed",
        code: "HARNESS_PROVIDER_FAILURE",
        message: "Harness execution failed.",
      },
    ];

    expect(signals.map((signal) => HarnessSignalSchema.parse(signal))).toEqual(
      signals,
    );
  });

  it.each([
    {
      kind: "assistant.delta",
      text: "safe",
      providerSessionId: "private",
    },
    {
      kind: "run.completed",
      eventId: "adapter-owned-event",
    },
    {
      kind: "usage.recorded",
      tokens: 0,
      costUsdMicros: 0,
      timestamp: "2026-07-28T00:00:00.000Z",
    },
    {
      kind: "vendor.private.event",
      rawProviderEvent: { secret: true },
    },
  ])("rejects provider-private or adapter-owned identity fields", (signal) => {
    expect(() => HarnessSignalSchema.parse(signal)).toThrow();
  });

  it("rejects unsafe numeric budgets", () => {
    expect(() =>
      HarnessSignalSchema.parse({
        kind: "usage.recorded",
        tokens: 0.5,
        costUsdMicros: -1,
      }),
    ).toThrow();
  });
});
