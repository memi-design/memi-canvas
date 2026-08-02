import {
  HarnessSignalSchema,
  type HarnessSignal,
} from "../../protocol/src/index.js";

import { immutableCopy } from "./immutable.js";
import type {
  DurableHarnessAdapter,
  DurableHarnessDescriptor,
  DurableHarnessStreamInput,
} from "./durable-types.js";

interface DemoHarnessOptions {
  readonly script?: readonly HarnessSignal[];
  readonly failure?: Error;
}

const DEFAULT_SCRIPT: readonly HarnessSignal[] = [
  {
    kind: "assistant.delta",
    text: "Documented with deterministic local demo evidence.",
  },
  {
    kind: "usage.recorded",
    tokens: 0,
    costUsdMicros: 0,
  },
  {
    kind: "checkpoint.saved",
    checkpointId: "demo-checkpoint",
  },
  { kind: "run.completed" },
];

abstract class DemoHarnessAdapter implements DurableHarnessAdapter {
  readonly descriptor: DurableHarnessDescriptor;
  readonly #script: readonly HarnessSignal[];
  readonly #failure: Error | undefined;
  #streamInvocationCount = 0;

  protected constructor(
    descriptor: DurableHarnessDescriptor,
    options: DemoHarnessOptions = {},
  ) {
    this.descriptor = immutableCopy(descriptor);
    const script = (options.script ?? DEFAULT_SCRIPT).map((signal) =>
      HarnessSignalSchema.parse(signal),
    );
    for (const signal of script) {
      if (
        signal.kind === "usage.recorded" &&
        (signal.tokens !== 0 || signal.costUsdMicros !== 0)
      ) {
        throw new Error("Demo harness usage must remain exactly zero.");
      }
    }
    this.#script = immutableCopy(script);
    this.#failure = options.failure;
  }

  get streamInvocationCount(): number {
    return this.#streamInvocationCount;
  }

  async *stream(
    input: DurableHarnessStreamInput,
  ): AsyncIterable<HarnessSignal> {
    if (
      !Number.isSafeInteger(input.dispatchEpoch) ||
      input.dispatchEpoch < 1 ||
      !Number.isSafeInteger(input.afterSignalCount) ||
      input.afterSignalCount < 0
    ) {
      throw new Error("Demo harness received an invalid durable cursor.");
    }
    this.#streamInvocationCount += 1;
    if (this.#failure !== undefined) throw this.#failure;

    for (
      let index = input.afterSignalCount;
      index < this.#script.length;
      index += 1
    ) {
      const signal = this.#script[index];
      if (signal !== undefined) yield immutableCopy(signal);
    }
  }
}

export class DemoAlphaHarnessAdapter extends DemoHarnessAdapter {
  constructor(options: DemoHarnessOptions = {}) {
    super(
      {
        harnessId: "demo-alpha",
        displayName: "Demo Alpha",
        modelId: "demo-alpha-v1",
        capabilities: ["approval", "checkpoint", "text"],
        autoPriority: 10,
      },
      options,
    );
  }
}

export class DemoBetaHarnessAdapter extends DemoHarnessAdapter {
  constructor(options: DemoHarnessOptions = {}) {
    super(
      {
        harnessId: "demo-beta",
        displayName: "Demo Beta",
        modelId: "demo-beta-v1",
        capabilities: ["checkpoint", "text"],
        autoPriority: 20,
      },
      options,
    );
  }
}

export function normalizeHarnessFailure(_error?: unknown): HarnessSignal {
  return Object.freeze({
    kind: "run.failed",
    code: "HARNESS_PROVIDER_FAILURE",
    message: "Harness execution failed.",
  });
}
