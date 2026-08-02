import { normalizeProviderEvent } from "./normalize.js";
import type {
  ApprovalResponse,
  CancelRequest,
  FakeHarnessOptions,
  HarnessAdapter,
  HarnessScriptStep,
  NormalizedHarnessEvent,
  ResumeInput,
  StartInput,
  TaskEnvelope,
} from "./types.js";

interface ApprovalResolution {
  readonly decision: "approved" | "rejected";
  readonly grantId: string;
}

type ApprovalSettlement =
  | {
      readonly kind: "resolved";
      readonly resolution: ApprovalResolution;
    }
  | {
      readonly kind: "cancelled";
      readonly reason: string;
    };

interface DeferredApproval {
  readonly approvalId: string;
  readonly promise: Promise<ApprovalSettlement>;
  readonly resolve: (
    settlement: ApprovalSettlement,
  ) => "settled" | "matched" | "conflict";
}

interface ActiveRun {
  cancelled: boolean;
  cancelReason?: string;
  pendingApproval?: DeferredApproval;
  readonly resolvedApprovals: Map<string, ApprovalResolution>;
}

interface RunHistory {
  readonly nextScriptIndexBySequence: Map<number, number>;
}

interface StreamOptions {
  readonly runId: string;
  readonly task: TaskEnvelope;
  readonly startIndex: number;
  readonly initialSequence: number;
  readonly resumedFrom?: {
    readonly previousRunId: string;
    readonly afterSequence: number;
  };
  readonly run: ActiveRun;
  readonly history: RunHistory;
}

function deferredApproval(approvalId: string): DeferredApproval {
  let resolvePromise:
    | ((settlement: ApprovalSettlement) => void)
    | undefined;
  let current: ApprovalSettlement | undefined;
  const promise = new Promise<ApprovalSettlement>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    approvalId,
    promise,
    resolve: (settlement) => {
      if (current !== undefined) {
        return JSON.stringify(current) === JSON.stringify(settlement)
          ? "matched"
          : "conflict";
      }

      current = settlement;
      resolvePromise?.(settlement);
      return "settled";
    },
  };
}

function sameResolution(
  left: ApprovalResolution,
  right: ApprovalResolution,
): boolean {
  return (
    left.decision === right.decision &&
    left.grantId === right.grantId
  );
}

function dataFromStep(
  step: HarnessScriptStep,
): Readonly<Record<string, unknown>> {
  const data = Object.fromEntries(
    Object.entries(step).filter(([key]) => key !== "kind"),
  );

  return Object.freeze(data);
}

export class FakeHarnessAdapter implements HarnessAdapter {
  readonly descriptor;
  readonly #options: FakeHarnessOptions;
  readonly #runs = new Map<string, ActiveRun>();
  readonly #histories = new Map<string, RunHistory>();

  constructor(options: FakeHarnessOptions) {
    this.#options = options;
    this.descriptor = Object.freeze({
      ...options.descriptor,
      capabilities: Object.freeze([
        ...options.descriptor.capabilities,
      ]),
      models: Object.freeze([...options.descriptor.models]),
    });
  }

  start(input: StartInput): AsyncIterable<NormalizedHarnessEvent> {
    const lifecycle = this.#reserveRun(input.runId);

    return this.#stream({
      runId: input.runId,
      task: input.task,
      startIndex: 0,
      initialSequence: 0,
      ...lifecycle,
    });
  }

  resume(input: ResumeInput): AsyncIterable<NormalizedHarnessEvent> {
    const previousHistory = this.#histories.get(
      input.previousRunId,
    );
    const startIndex =
      previousHistory?.nextScriptIndexBySequence.get(
        input.afterSequence,
      );

    if (startIndex === undefined) {
      throw new Error(
        `Run "${input.previousRunId}" has no resumable cursor at sequence ${input.afterSequence}.`,
      );
    }

    const lifecycle = this.#reserveRun(input.runId);

    return this.#stream({
      runId: input.runId,
      task: input.task,
      startIndex,
      initialSequence: input.afterSequence,
      resumedFrom: {
        previousRunId: input.previousRunId,
        afterSequence: input.afterSequence,
      },
      ...lifecycle,
    });
  }

  async resolveApproval(response: ApprovalResponse): Promise<void> {
    const run = this.#runs.get(response.runId);

    if (run === undefined) {
      throw new Error(`Run "${response.runId}" is not active.`);
    }

    const requestedResolution = {
      decision: response.decision,
      grantId: response.grantId,
    } satisfies ApprovalResolution;
    const existingResolution = run.resolvedApprovals.get(
      response.approvalId,
    );

    if (existingResolution !== undefined) {
      if (sameResolution(existingResolution, requestedResolution)) {
        return;
      }

      throw new Error(
        `Approval "${response.approvalId}" already resolved with a different decision.`,
      );
    }

    if (run.cancelled) {
      throw new Error(
        `Run "${response.runId}" was cancelled before approval "${response.approvalId}" resolved.`,
      );
    }

    const pending = run.pendingApproval;

    if (
      pending === undefined ||
      pending.approvalId !== response.approvalId
    ) {
      throw new Error(
        `Approval "${response.approvalId}" is not pending for run "${response.runId}".`,
      );
    }

    const result = pending.resolve({
      kind: "resolved",
      resolution: requestedResolution,
    });

    if (result === "conflict") {
      throw new Error(
        `Approval "${response.approvalId}" already resolved with a different decision.`,
      );
    }

    run.resolvedApprovals.set(
      response.approvalId,
      requestedResolution,
    );
  }

  async cancel(request: CancelRequest): Promise<void> {
    const run = this.#runs.get(request.runId);

    if (run === undefined) {
      throw new Error(`Run "${request.runId}" is not active.`);
    }

    if (run.cancelled) {
      if (run.cancelReason === request.reason) {
        return;
      }

      throw new Error(
        `Run "${request.runId}" was already cancelled for a different reason.`,
      );
    }

    const pending = run.pendingApproval;

    if (
      pending !== undefined &&
      run.resolvedApprovals.has(pending.approvalId)
    ) {
      throw new Error(
        `Run "${request.runId}" cannot be cancelled while an approval resolution is awaiting consumption.`,
      );
    }

    run.cancelled = true;
    run.cancelReason = request.reason;
    pending?.resolve({
      kind: "cancelled",
      reason: request.reason,
    });
  }

  #reserveRun(
    runId: string,
  ): Pick<StreamOptions, "run" | "history"> {
    if (
      this.#runs.has(runId) ||
      this.#histories.has(runId)
    ) {
      throw new Error(`Run "${runId}" already exists.`);
    }

    const run: ActiveRun = {
      cancelled: false,
      resolvedApprovals: new Map(),
    };
    const history: RunHistory = {
      nextScriptIndexBySequence: new Map(),
    };
    this.#runs.set(runId, run);
    this.#histories.set(runId, history);

    return { run, history };
  }

  async *#stream(
    options: StreamOptions,
  ): AsyncIterable<NormalizedHarnessEvent> {
    const { history, run } = options;
    let sequence = options.initialSequence;

    try {
      if (options.resumedFrom !== undefined) {
        sequence += 1;
        history.nextScriptIndexBySequence.set(
          sequence,
          options.startIndex,
        );
        yield this.#event(
          {
            kind: "run.resumed",
            previousRunId: options.resumedFrom.previousRunId,
            afterSequence: options.resumedFrom.afterSequence,
          },
          options,
          sequence,
        );
      }

      for (
        let index = options.startIndex;
        index < this.#options.script.length;
        index += 1
      ) {
        if (run.cancelled) {
          sequence += 1;
          history.nextScriptIndexBySequence.set(sequence, index);
          yield this.#cancelledEvent(options, sequence, run);
          return;
        }

        const step = this.#options.script[index];

        if (step === undefined) {
          continue;
        }

        sequence += 1;

        if (step.kind !== "approval.requested") {
          history.nextScriptIndexBySequence.set(
            sequence,
            index + 1,
          );
          yield this.#event(step, options, sequence);
          continue;
        }

        const approvalId = String(step.approvalId);
        const pending = deferredApproval(approvalId);
        run.pendingApproval = pending;
        history.nextScriptIndexBySequence.set(sequence, index);
        yield this.#event(step, options, sequence);

        const settlement = await pending.promise;
        delete run.pendingApproval;

        if (run.cancelled || settlement.kind === "cancelled") {
          sequence += 1;
          history.nextScriptIndexBySequence.set(sequence, index);
          yield this.#cancelledEvent(options, sequence, run);
          return;
        }

        const { resolution } = settlement;
        sequence += 1;
        history.nextScriptIndexBySequence.set(
          sequence,
          index + 1,
        );
        yield this.#event(
          {
            kind: "approval.resolved",
            approvalId,
            decision: resolution.decision,
            grantId: resolution.grantId,
          },
          options,
          sequence,
        );

        if (resolution.decision === "rejected") {
          return;
        }
      }
    } finally {
      if (this.#runs.get(options.runId) === run) {
        this.#runs.delete(options.runId);
      }
    }
  }

  #cancelledEvent(
    options: StreamOptions,
    sequence: number,
    run: ActiveRun,
  ): NormalizedHarnessEvent {
    return this.#event(
      {
        kind: "run.cancelled",
        reason: run.cancelReason ?? "cancelled",
      },
      options,
      sequence,
    );
  }

  #event(
    step: HarnessScriptStep,
    options: StreamOptions,
    sequence: number,
  ): NormalizedHarnessEvent {
    return normalizeProviderEvent(
      {
        kind: step.kind,
        data: dataFromStep(step),
        providerSequence: sequence,
      },
      {
        eventId: `${options.runId}:${this.#options.createEventId(sequence)}`,
        sequence,
        timestamp: this.#options.clock(),
        traceId: `trace:${options.task.taskId}`,
        spanId: `span:${options.runId}:${sequence}`,
        taskId: options.task.taskId,
        runId: options.runId,
        actor: {
          kind: "agent",
          id: `agent:${this.descriptor.harnessId}`,
        },
        harness: {
          harnessId: this.descriptor.harnessId,
          modelId: this.#options.modelId,
        },
        targetRefs: options.task.selectionRefs,
      },
    );
  }
}
