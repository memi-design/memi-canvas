import {
  DurableRunStateSchema,
  type DurableRunState,
} from "../../protocol/src/index.js";
import {
  HarnessRegistry,
  type HarnessAdapter,
} from "../../harnesses/src/index.js";

import { RuntimeDatabase } from "./database.js";
import type {
  HarnessDispatch,
  HarnessDispatchRequest,
} from "./types.js";

export class HarnessStore {
  readonly #database: RuntimeDatabase;
  readonly #clock: () => string;
  readonly #registry: HarnessRegistry;

  constructor(
    database: RuntimeDatabase,
    clock: () => string,
    adapters: readonly HarnessAdapter[],
  ) {
    this.#database = database;
    this.#clock = clock;
    this.#registry = new HarnessRegistry(adapters);
  }

  dispatch(input: HarnessDispatchRequest): HarnessDispatch {
    const selection = this.#registry.select({
      mode: "locked",
      harnessId: input.harnessId,
      requiredCapabilities: input.requiredHarnessCapabilities,
    });
    const modelId = selection.adapter.descriptor.models[0];
    if (modelId === undefined) {
      throw new Error(
        `Harness "${input.harnessId}" has no configured model.`,
      );
    }
    const state = DurableRunStateSchema.parse({
      schemaVersion: 1,
      projectId: input.projectId,
      taskId: input.task.taskId,
      runId: input.runId,
      revision: 1,
      state: "queued",
      harness: {
        harnessId: input.harnessId,
        modelId,
      },
      requiredCapabilities: input.requiredCapabilities,
      updatedAt: this.#clock(),
    });
    this.#database.transaction(() => {
      this.#database.run(
        "INSERT INTO run_state (run_id, state_json) VALUES (?, ?)",
        input.runId,
        JSON.stringify(state),
      );
    });
    return {
      events: selection.adapter.start({
        runId: input.runId,
        task: input.task,
      }),
    };
  }

  getState(runId: string): DurableRunState | undefined {
    const row = this.#database.one(
      "SELECT state_json FROM run_state WHERE run_id = ?",
      runId,
    );
    return row === undefined
      ? undefined
      : DurableRunStateSchema.parse(
          JSON.parse(String(row.state_json)),
        );
  }
}
