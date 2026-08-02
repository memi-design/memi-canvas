import { describe, expect, it } from "vitest";

import { normalizeProviderEvent } from "../src/index.js";
import { FIXED_NOW } from "./fixtures.js";

describe("provider event normalization", () => {
  it("maps an adapter event into the provider-neutral Memi event envelope", () => {
    const event = normalizeProviderEvent(
      {
        kind: "assistant.delta",
        data: { text: "Measured response" },
        providerSequence: 41,
        providerMetadata: {
          providerSessionId: "private-provider-session",
          providerResponseId: "private-provider-response",
          vendorEventType: "vendor.output_text.delta",
        },
      },
      {
        eventId: "event-0001",
        sequence: 1,
        timestamp: FIXED_NOW,
        traceId: "trace-1",
        spanId: "span-1",
        taskId: "task-1",
        runId: "run-1",
        actor: { kind: "agent", id: "agent-fake" },
        harness: { harnessId: "fake", modelId: "fake-model-v1" },
        targetRefs: [{ kind: "canvas-node", id: "node-1" }],
      },
    );

    expect(event).toEqual({
      schemaVersion: 1,
      eventId: "event-0001",
      sequence: 1,
      timestamp: FIXED_NOW,
      traceId: "trace-1",
      spanId: "span-1",
      taskId: "task-1",
      runId: "run-1",
      actor: { kind: "agent", id: "agent-fake" },
      harness: { harnessId: "fake", modelId: "fake-model-v1" },
      targetRefs: [{ kind: "canvas-node", id: "node-1" }],
      type: "message.assistant.delta",
      status: "running",
      payload: { text: "Measured response" },
    });
  });

  it("does not retain raw provider metadata or event names", () => {
    const normalized = normalizeProviderEvent(
      {
        kind: "turn.completed",
        data: { outputArtifactRefs: ["artifact-1"] },
        providerSequence: 99,
        providerMetadata: {
          providerSessionId: "secret-session",
          providerResponseId: "secret-response",
          rawProviderEvent: { internal: true },
          vendorEventType: "vendor.response.completed",
        },
      },
      {
        eventId: "event-0002",
        sequence: 2,
        timestamp: FIXED_NOW,
        traceId: "trace-1",
        spanId: "span-2",
        taskId: "task-1",
        runId: "run-1",
        actor: { kind: "agent", id: "agent-fake" },
        harness: { harnessId: "fake", modelId: "fake-model-v1" },
        targetRefs: [],
      },
    );

    const serialized = JSON.stringify(normalized);

    expect(serialized).not.toContain("providerSessionId");
    expect(serialized).not.toContain("providerResponseId");
    expect(serialized).not.toContain("rawProviderEvent");
    expect(serialized).not.toContain("vendor.response.completed");
    expect(serialized).not.toContain("providerSequence");
  });

  it("deep-clones and freezes nested normalized payload data", () => {
    const sourceData = {
      result: {
        evidenceRefs: ["evidence-1"],
        nested: { confidence: 0.98 },
      },
    };
    const normalized = normalizeProviderEvent(
      {
        kind: "turn.completed",
        data: sourceData,
      },
      {
        eventId: "event-immutable",
        sequence: 3,
        timestamp: FIXED_NOW,
        traceId: "trace-1",
        spanId: "span-3",
        taskId: "task-1",
        runId: "run-1",
        actor: { kind: "agent", id: "agent-fake" },
        harness: {
          harnessId: "fake",
          modelId: "fake-model-v1",
        },
        targetRefs: [{ kind: "canvas-node", id: "node-1" }],
      },
    );

    sourceData.result.evidenceRefs.push("evidence-mutated");
    sourceData.result.nested.confidence = 0;

    expect(normalized.payload).toEqual({
      result: {
        evidenceRefs: ["evidence-1"],
        nested: { confidence: 0.98 },
      },
    });
    expect(Object.isFrozen(normalized.payload)).toBe(true);
    expect(Object.isFrozen(normalized.payload.result)).toBe(true);
    expect(
      Object.isFrozen(
        (
          normalized.payload.result as {
            evidenceRefs: readonly string[];
          }
        ).evidenceRefs,
      ),
    ).toBe(true);
  });
});
