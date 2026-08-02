import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { DemoAlphaHarnessAdapter } from "../../harnesses/src/index.js";
import {
  DurableRuntime,
  type EffectExecutor,
} from "./index.js";

const directories: string[] = [];
const execFileAsync = promisify(execFile);

class ForbiddenExecutor implements EffectExecutor {
  async execute(): Promise<never> {
    throw new Error("Harness race test cannot execute effects.");
  }
}

function worker(
  databasePath: string,
  readyPath: string,
  startPath: string,
  resultPath: string,
) {
  return execFileAsync(
    process.execPath,
    [
      join(process.cwd(), "node_modules/vitest/vitest.mjs"),
      "run",
      join(
        process.cwd(),
        "packages/runtime/src/harness-lifecycle-process-worker.test.ts",
      ),
      "--maxWorkers=1",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMI_HARNESS_LIFECYCLE_WORKER: JSON.stringify({
          databasePath,
          readyPath,
          startPath,
          resultPath,
        }),
      },
    },
  );
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("harness lifecycle OS process control", () => {
  it("serializes two stop attempts into one durable event", async () => {
    const directory = mkdtempSync(join(tmpdir(), "memi-harness-process-"));
    directories.push(directory);
    const databasePath = join(directory, "runtime.sqlite");
    const runtime = new DurableRuntime({
      databasePath,
      clock: () => "2026-07-28T12:00:00.000Z",
      effectExecutor: new ForbiddenExecutor(),
      lifecycleHarnesses: [
        new DemoAlphaHarnessAdapter({
          script: [
            {
              kind: "approval.requested",
              approvalId: "approval-process-race",
              scopes: ["canvas:apply"],
            },
          ],
        }),
      ],
    });
    runtime.createHarnessTask({
      projectId: "project-process-race",
      taskId: "task-process-race",
      goal: "Prove process-safe stop idempotency.",
      permissionCeiling: ["canvas:apply"],
      tokenBudget: 0,
      costBudgetUsdMicros: 0,
    });
    await runtime.startHarnessRun({
      taskId: "task-process-race",
      runId: "run-process-race",
      selection: {
        mode: "locked",
        harnessId: "demo-alpha",
        requiredCapabilities: ["approval"],
      },
    });
    runtime.close();

    const startPath = join(directory, "start");
    const readyPaths = [
      join(directory, "ready-a"),
      join(directory, "ready-b"),
    ];
    const resultPaths = [
      join(directory, "result-a.json"),
      join(directory, "result-b.json"),
    ];
    const workers = readyPaths.map((readyPath, index) =>
      worker(
        databasePath,
        readyPath,
        startPath,
        resultPaths[index]!,
      ),
    );
    const deadline = Date.now() + 10_000;
    while (readyPaths.some((path) => !existsSync(path))) {
      if (Date.now() >= deadline) {
        throw new Error("Harness process workers did not become ready.");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    writeFileSync(startPath, "go", "utf8");
    await Promise.all(workers);
    expect(readFileSync(resultPaths[0]!, "utf8")).toBe(
      readFileSync(resultPaths[1]!, "utf8"),
    );

    const reopened = new DurableRuntime({
      databasePath,
      clock: () => "2026-07-28T12:00:00.000Z",
      effectExecutor: new ForbiddenExecutor(),
      lifecycleHarnesses: [new DemoAlphaHarnessAdapter()],
    });
    expect(reopened.getHarnessRun("run-process-race")?.state).toBe(
      "stopped",
    );
    expect(
      reopened
        .getHarnessRunEvents("run-process-race")
        .filter((event) => event.signal.kind === "run.stopped"),
    ).toHaveLength(1);
    reopened.close();
  }, 20_000);
});
