import { existsSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DemoAlphaHarnessAdapter,
  DemoBetaHarnessAdapter,
} from "../../harnesses/src/index.js";
import {
  DurableRuntime,
  type EffectExecutor,
} from "./index.js";

interface WorkerConfiguration {
  readonly databasePath: string;
  readonly readyPath: string;
  readonly startPath: string;
  readonly resultPath: string;
}

const configuration =
  process.env.MEMI_HARNESS_LIFECYCLE_WORKER === undefined
    ? undefined
    : (JSON.parse(
        process.env.MEMI_HARNESS_LIFECYCLE_WORKER,
      ) as WorkerConfiguration);

class ForbiddenExecutor implements EffectExecutor {
  async execute(): Promise<never> {
    throw new Error("Harness control worker cannot execute effects.");
  }
}

describe("harness lifecycle OS process worker", () => {
  it("executes one bounded stop attempt", async () => {
    if (configuration === undefined) {
      expect(configuration).toBeUndefined();
      return;
    }
    const runtime = new DurableRuntime({
      databasePath: configuration.databasePath,
      clock: () => "2026-07-28T12:00:00.000Z",
      effectExecutor: new ForbiddenExecutor(),
      lifecycleHarnesses: [
        new DemoAlphaHarnessAdapter(),
        new DemoBetaHarnessAdapter(),
      ],
    });
    writeFileSync(configuration.readyPath, "ready", {
      encoding: "utf8",
      flag: "wx",
    });
    const deadline = Date.now() + 10_000;
    while (!existsSync(configuration.startPath)) {
      if (Date.now() >= deadline) {
        throw new Error("Harness process barrier timed out.");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const result = runtime.stopHarnessRun({
      runId: "run-process-race",
      dispatchEpoch: 1,
      reason: "human-stop",
    });
    writeFileSync(configuration.resultPath, JSON.stringify(result), {
      encoding: "utf8",
      flag: "wx",
    });
    runtime.close();
    expect(result.state).toBe("stopped");
  });
});
