import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  FakeHarnessAdapter,
  HarnessSelectionError,
} from "../../harnesses/src/index.js";
import { DurableRuntime } from "./index.js";
import {
  MutableClock,
  PROJECT_ID,
  RUN_ID,
  RecordingEffectExecutor,
  TASK_ID,
} from "./test-fixtures.js";

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-runtime-harness-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

const task = {
  taskId: TASK_ID,
  goal: "Inspect the selected node.",
  acceptanceCriteria: [],
  selectionRefs: [],
  evidenceRefs: [],
  constraints: [],
  requestedHarness: "fake-runtime",
  risk: "read",
  tokenBudget: 500,
  costBudget: 0,
  permissionCeiling: ["canvas:read"],
};

function fakeHarness(
  capabilities: readonly string[],
  models: readonly string[] = ["fake-runtime-model"],
) {
  return new FakeHarnessAdapter({
    descriptor: {
      harnessId: "fake-runtime",
      displayName: "Fake Runtime Harness",
      capabilities,
      models,
    },
    modelId: "fake-runtime-model",
    script: [
      {
        kind: "turn.completed",
        outputArtifactRefs: [],
      },
    ],
    clock: () => "2026-07-28T12:00:00.000Z",
    createEventId: (sequence) => `runtime-event-${sequence}`,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("harness dispatch", () => {
  it("persists run state only after capability-checked dispatch", async () => {
    const runtime = new DurableRuntime({
      databasePath: databasePath(),
      clock: new MutableClock().now,
      effectExecutor: new RecordingEffectExecutor(),
      harnesses: [fakeHarness(["text", "tools"])],
    });

    const dispatch = runtime.dispatchHarness({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      harnessId: "fake-runtime",
      requiredHarnessCapabilities: ["tools"],
      requiredCapabilities: ["canvas:read"],
      task,
    });
    expect(runtime.getRunState(RUN_ID)).toMatchObject({
      schemaVersion: 1,
      runId: RUN_ID,
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      revision: 1,
      state: "queued",
      harness: {
        harnessId: "fake-runtime",
        modelId: "fake-runtime-model",
      },
      requiredCapabilities: ["canvas:read"],
    });

    const events = [];
    for await (const event of dispatch.events) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    runtime.close();
  });

  it("rejects an incapable harness without creating run state", () => {
    const runtime = new DurableRuntime({
      databasePath: databasePath(),
      clock: new MutableClock().now,
      effectExecutor: new RecordingEffectExecutor(),
      harnesses: [fakeHarness(["text"])],
    });

    expect(() =>
      runtime.dispatchHarness({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        harnessId: "fake-runtime",
        requiredHarnessCapabilities: ["tools"],
        requiredCapabilities: ["canvas:read"],
        task,
      }),
    ).toThrow(
      expect.objectContaining<Partial<HarnessSelectionError>>({
        code: "HARNESS_CAPABILITY_MISMATCH",
      }),
    );
    expect(runtime.getRunState(RUN_ID)).toBeUndefined();
    runtime.close();
  });

  it("rejects a harness without a configured model", () => {
    const runtime = new DurableRuntime({
      databasePath: databasePath(),
      clock: new MutableClock().now,
      effectExecutor: new RecordingEffectExecutor(),
      harnesses: [fakeHarness(["tools"], [])],
    });

    expect(() =>
      runtime.dispatchHarness({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        harnessId: "fake-runtime",
        requiredHarnessCapabilities: ["tools"],
        requiredCapabilities: ["canvas:read"],
        task,
      }),
    ).toThrow('Harness "fake-runtime" has no configured model.');
    expect(runtime.getRunState(RUN_ID)).toBeUndefined();
    runtime.close();
  });
});
