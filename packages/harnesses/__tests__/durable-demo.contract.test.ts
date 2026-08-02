import { describe, expect, it } from "vitest";

import {
  DemoAlphaHarnessAdapter,
  DemoBetaHarnessAdapter,
  DurableHarnessRegistry,
  normalizeHarnessFailure,
} from "../src/index.js";

async function collect<T>(stream: AsyncIterable<T>): Promise<readonly T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

describe("durable demo harness adapters", () => {
  it("provide exactly two deterministic, zero-cost demo adapters", async () => {
    const first = new DemoAlphaHarnessAdapter();
    const second = new DemoAlphaHarnessAdapter();
    const input = {
      taskId: "task-1",
      runId: "run-1",
      dispatchEpoch: 1,
      afterSignalCount: 0,
    };

    const left = await collect(first.stream(input));
    const right = await collect(second.stream(input));

    expect(left).toEqual(right);
    expect(left).toContainEqual({
      kind: "usage.recorded",
      tokens: 0,
      costUsdMicros: 0,
    });
    expect(
      [new DemoAlphaHarnessAdapter(), new DemoBetaHarnessAdapter()].map(
        (adapter) => adapter.descriptor.harnessId,
      ),
    ).toEqual(["demo-alpha", "demo-beta"]);
  });

  it("supports exact locked selection and stable automatic ranking", () => {
    const alpha = new DemoAlphaHarnessAdapter();
    const beta = new DemoBetaHarnessAdapter();
    const registry = new DurableHarnessRegistry([beta, alpha]);

    expect(
      registry.select({
        mode: "locked",
        harnessId: "demo-beta",
        requiredCapabilities: ["text"],
      }).adapter,
    ).toBe(beta);
    expect(
      registry.select({
        mode: "auto",
        requiredCapabilities: ["text", "checkpoint"],
      }).adapter,
    ).toBe(alpha);
  });

  it("normalizes failures without retaining provider-private data", () => {
    const normalized = normalizeHarnessFailure(
      new Error(
        "providerSessionId=session-secret providerResponseId=response-secret",
      ),
    );

    expect(normalized).toEqual({
      kind: "run.failed",
      code: "HARNESS_PROVIDER_FAILURE",
      message: "Harness execution failed.",
    });
    expect(JSON.stringify(normalized)).not.toContain("secret");
  });

  it("rejects non-zero usage and private keys in demo scripts", () => {
    expect(
      () =>
        new DemoAlphaHarnessAdapter({
          script: [
            {
              kind: "usage.recorded",
              tokens: 1,
              costUsdMicros: 0,
            },
          ],
        }),
    ).toThrow("Demo harness usage must remain exactly zero.");

    expect(
      () =>
        new DemoBetaHarnessAdapter({
          script: [
            {
              kind: "assistant.delta",
              text: "safe",
              providerSessionId: "private",
            } as never,
          ],
        }),
    ).toThrow();
  });
});
