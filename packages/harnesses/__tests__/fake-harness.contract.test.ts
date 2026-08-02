import { describe, expect, it } from "vitest";

import { FakeHarnessAdapter } from "../src/index.js";
import {
  collectEvents,
  type ContractEvent,
  fakeHarnessOptions,
  taskEnvelope,
} from "./fixtures.js";

describe("deterministic fake harness adapter", () => {
  it("emits byte-equivalent normalized events for the same task and run inputs", async () => {
    const script = [
      {
        kind: "assistant.delta",
        text: "I inspected the selected button.",
      },
      {
        kind: "turn.completed",
        outputArtifactRefs: ["artifact-inspection"],
      },
    ] as const;
    const firstAdapter = new FakeHarnessAdapter({
      ...fakeHarnessOptions(),
      script,
    });
    const secondAdapter = new FakeHarnessAdapter({
      ...fakeHarnessOptions(),
      script,
    });

    const firstEvents = await collectEvents(
      firstAdapter.start({
        runId: "run-deterministic",
        task: taskEnvelope,
      }) as AsyncIterable<ContractEvent>,
    );
    const secondEvents = await collectEvents(
      secondAdapter.start({
        runId: "run-deterministic",
        task: taskEnvelope,
      }) as AsyncIterable<ContractEvent>,
    );

    expect(firstEvents).toEqual(secondEvents);
    expect(JSON.stringify(firstEvents)).toBe(JSON.stringify(secondEvents));
  });

  it("uses monotonic sequences and stable causal identifiers", async () => {
    const adapter = new FakeHarnessAdapter({
      ...fakeHarnessOptions(),
      script: [
        { kind: "assistant.delta", text: "Measured response." },
        { kind: "turn.completed", outputArtifactRefs: [] },
      ],
    });

    const events = await collectEvents(
      adapter.start({
        runId: "run-sequences",
        task: taskEnvelope,
      }) as AsyncIterable<ContractEvent>,
    );

    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(new Set(events.map((event) => event.eventId)).size).toBe(
      events.length,
    );
    expect(
      events.every(
        (event) =>
          event.taskId === taskEnvelope.taskId &&
          event.runId === "run-sequences",
      ),
    ).toBe(true);
  });
});
