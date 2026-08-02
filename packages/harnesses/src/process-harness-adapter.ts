import { isAbsolute } from "node:path";

import { immutableCopy } from "./immutable.js";
import { normalizeProviderEvent } from "./normalize.js";
import {
  publicEventToProviderInput,
} from "./provider-event-normalizers.js";
import type {
  ProcessHarnessAdapterOptions,
  ProcessHandle,
  ProcessInspectionResult,
  ProcessStartRequest,
  ProviderAvailability,
  ProviderEventParseResult,
  ProviderHealth,
  PublicProviderEvent,
} from "./provider-process.types.js";
import type {
  ApprovalResponse,
  CancelRequest,
  HarnessAdapter,
  HarnessDescriptor,
  NormalizedHarnessEvent,
  ResumeInput,
  StartInput,
  TaskEnvelope,
} from "./types.js";

const MAX_PROMPT_BYTES = 65_536;
const MAX_OUTPUT_BYTES = 16 * 1_024 * 1_024;
const ENVIRONMENT_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/u;
const REQUIRED_CAPABILITIES = Object.freeze([
  "cancel",
  "read-repository",
  "streaming",
  "text",
  "tools",
]);
const REQUIRED_PROTOCOL_VERSION = "structured-json-v1" as const;

interface ActiveProviderRun {
  readonly handle: ProcessHandle;
  cancelReason?: string;
}

interface ProviderDefinition {
  readonly harnessId: string;
  readonly displayName: string;
  readonly executable: string;
}

interface StreamState {
  sequence: number;
  turnCount: number;
  usedTokens: number;
  usedCostUsdMicros: number;
  terminalSeen: boolean;
}

function validateOptions(options: ProcessHarnessAdapterOptions): void {
  if (!isAbsolute(options.cwd) || options.cwd.includes("\0")) {
    throw new Error("Provider cwd must be an absolute, valid path.");
  }
  if (
    !Number.isSafeInteger(options.maxTurns) ||
    options.maxTurns < 1 ||
    options.maxTurns > 1_000
  ) {
    throw new Error("Provider maxTurns must be an integer from 1 to 1000.");
  }
  if (
    !Number.isFinite(options.maxBudgetUsd) ||
    options.maxBudgetUsd <= 0
  ) {
    throw new Error("Provider maxBudgetUsd must be greater than zero.");
  }
  if (
    !Number.isSafeInteger(options.maxOutputBytes) ||
    options.maxOutputBytes < 1 ||
    options.maxOutputBytes > MAX_OUTPUT_BYTES
  ) {
    throw new Error(
      `Provider maxOutputBytes must be from 1 to ${MAX_OUTPUT_BYTES}.`,
    );
  }
  if (options.modelId.trim().length === 0) {
    throw new Error("Provider modelId is required.");
  }
}

function allowedEnvironment(
  source: Readonly<Record<string, string | undefined>> | undefined,
  allowlist: readonly string[] | undefined,
): Readonly<Record<string, string>> {
  const allowed = new Set(allowlist ?? []);
  const result: Record<string, string> = {};

  for (const key of allowed) {
    if (!ENVIRONMENT_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid environment allowlist key "${key}".`);
    }
    const value = source?.[key];
    if (value !== undefined) result[key] = value;
  }

  return Object.freeze(result);
}

function availability(
  condition: boolean | undefined,
): ProviderAvailability {
  if (condition === undefined) return "unknown";
  return condition ? "available" : "unavailable";
}

function unknownInspection(): ProcessInspectionResult {
  return {
    installed: false,
    authenticated: "unknown",
    reachable: "unknown",
  };
}

function promptForTask(task: TaskEnvelope): string {
  const prompt = [
    "You are operating in Memi read/propose mode.",
    "Read the repository only. Do not write files, run destructive commands, or publish changes.",
    "Return a bounded source proposal for review.",
    JSON.stringify({
      goal: task.goal,
      acceptanceCriteria: task.acceptanceCriteria,
      selectionRefs: task.selectionRefs,
      evidenceRefs: task.evidenceRefs,
      constraints: task.constraints,
      permissionCeiling: task.permissionCeiling,
      tokenBudget: task.tokenBudget,
    }),
  ].join("\n");

  if (new TextEncoder().encode(prompt).byteLength > MAX_PROMPT_BYTES) {
    throw new Error("Provider prompt exceeds the 64 KiB selection limit.");
  }

  return prompt;
}

function publicFailure(
  code: string,
  message: string,
): PublicProviderEvent {
  return { kind: "run.failed", code, message };
}

export abstract class ProcessHarnessAdapter
  implements HarnessAdapter
{
  readonly descriptor: HarnessDescriptor;
  readonly #definition: ProviderDefinition;
  readonly #options: ProcessHarnessAdapterOptions;
  readonly #environment: Readonly<Record<string, string>>;
  readonly #activeRuns = new Map<string, ActiveProviderRun>();
  readonly #clock: () => string;
  readonly #createEventId: (sequence: number) => string;

  protected constructor(
    definition: ProviderDefinition,
    options: ProcessHarnessAdapterOptions,
  ) {
    validateOptions(options);
    this.#definition = definition;
    this.#options = options;
    this.#environment = allowedEnvironment(
      options.environment,
      options.environmentAllowlist,
    );
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#createEventId =
      options.createEventId ??
      ((sequence) => `${definition.harnessId}-${sequence}`);
    this.descriptor = immutableCopy({
      harnessId: definition.harnessId,
      displayName: definition.displayName,
      capabilities: REQUIRED_CAPABILITIES,
      models: [options.modelId],
    });
  }

  protected get options(): ProcessHarnessAdapterOptions {
    return this.#options;
  }

  protected abstract processRequest(
    prompt: string,
    maxBudgetUsd: number,
  ): ProcessStartRequest;

  protected abstract parseLine(line: string): ProviderEventParseResult;

  async health(): Promise<ProviderHealth> {
    const executionPolicy = this.#options.executionPolicy ?? "blocked";
    if (executionPolicy === "blocked") {
      return immutableCopy({
        harnessId: this.descriptor.harnessId,
        checkedAt: this.#clock(),
        catalog: "available",
        configured: "available",
        execution: "unavailable",
        installed: "unknown",
        authenticated: "unknown",
        reachable: "unknown",
        cli: { status: "unknown" },
        protocol: {
          required: REQUIRED_PROTOCOL_VERSION,
          status: "unknown",
        },
        model: {
          id: this.#options.modelId,
          status: "unknown",
        },
        capabilities: REQUIRED_CAPABILITIES.map((id) => ({
          id,
          status: "unknown" as const,
        })),
      });
    }

    let inspected: ProcessInspectionResult;
    try {
      inspected = await this.#options.processPort.inspect({
        executable: this.#definition.executable,
        cwd: this.#options.cwd,
        modelId: this.#options.modelId,
      });
    } catch {
      inspected = unknownInspection();
      return immutableCopy({
        harnessId: this.descriptor.harnessId,
        checkedAt: this.#clock(),
        catalog: "available",
        configured: "available",
        execution:
          executionPolicy === "enabled" ? "unknown" : "unavailable",
        installed: "unknown",
        authenticated: "unknown",
        reachable: "unknown",
        cli: { status: "unknown" },
        protocol: {
          required: REQUIRED_PROTOCOL_VERSION,
          status: "unknown",
        },
        model: {
          id: this.#options.modelId,
          status: "unknown",
        },
        capabilities: REQUIRED_CAPABILITIES.map((id) => ({
          id,
          status: "unknown" as const,
        })),
      });
    }

    const installed = availability(inspected.installed);
    const canInspect = inspected.installed;
    const modelStatus = canInspect
      ? inspected.availableModels === undefined
        ? "unknown"
        : availability(
            inspected.availableModels.includes(this.#options.modelId),
          )
      : "unknown";
    const availableCapabilities = inspected.capabilities;
    const protocolStatus = canInspect
      ? inspected.protocolVersion === undefined
        ? "unknown"
        : availability(
            inspected.protocolVersion === REQUIRED_PROTOCOL_VERSION,
          )
      : "unknown";

    return immutableCopy({
      harnessId: this.descriptor.harnessId,
      checkedAt: this.#clock(),
      catalog: "available",
      configured: "available",
      execution:
        executionPolicy === "enabled" ? "available" : "unavailable",
      installed,
      authenticated: canInspect
        ? inspected.authenticated
        : "unknown",
      reachable: canInspect ? inspected.reachable : "unknown",
      cli: {
        ...(inspected.cliVersion === undefined
          ? {}
          : { version: inspected.cliVersion }),
        status: canInspect
          ? inspected.cliVersion === undefined
            ? "unknown"
            : "available"
          : "unknown",
      },
      protocol: {
        required: REQUIRED_PROTOCOL_VERSION,
        ...(inspected.protocolVersion === undefined
          ? {}
          : { actual: inspected.protocolVersion }),
        status: protocolStatus,
      },
      model: {
        id: this.#options.modelId,
        status: modelStatus,
      },
      capabilities: REQUIRED_CAPABILITIES.map((id) => ({
        id,
        status: canInspect
          ? availableCapabilities === undefined
            ? "unknown"
            : availability(availableCapabilities.includes(id))
          : "unknown",
      })),
    });
  }

  start(input: StartInput): AsyncIterable<NormalizedHarnessEvent> {
    return this.#stream(input);
  }

  resume(_input: ResumeInput): AsyncIterable<NormalizedHarnessEvent> {
    throw new Error(
      "Provider resume requires a durable provider session reference.",
    );
  }

  async resolveApproval(_response: ApprovalResponse): Promise<void> {
    throw new Error(
      "Read/propose provider adapters never request direct-write approval.",
    );
  }

  async cancel(request: CancelRequest): Promise<void> {
    const active = this.#activeRuns.get(request.runId);
    if (active === undefined) {
      throw new Error(`Run "${request.runId}" is not active.`);
    }
    if (active.cancelReason !== undefined) {
      if (active.cancelReason === request.reason) return;
      throw new Error(
        `Run "${request.runId}" was already cancelled for a different reason.`,
      );
    }
    active.cancelReason = request.reason;
    await active.handle.cancel(request.reason);
  }

  protected processStartRequest(
    args: readonly string[],
    prompt: string,
  ): ProcessStartRequest {
    return Object.freeze({
      executable: this.#definition.executable,
      args: Object.freeze([...args]),
      cwd: this.#options.cwd,
      environment: this.#environment,
      stdin: prompt,
      maxOutputBytes: this.#options.maxOutputBytes,
    });
  }

  async *#stream(
    input: StartInput,
  ): AsyncIterable<NormalizedHarnessEvent> {
    if (this.#activeRuns.has(input.runId)) {
      throw new Error(`Run "${input.runId}" is already active.`);
    }

    const state: StreamState = {
      sequence: 0,
      turnCount: 0,
      usedTokens: 0,
      usedCostUsdMicros: 0,
      terminalSeen: false,
    };
    if ((this.#options.executionPolicy ?? "blocked") !== "enabled") {
      yield this.#normalized(
        publicFailure(
          "PROVIDER_EXECUTION_BLOCKED",
          "Provider execution is blocked by policy.",
        ),
        input,
        state,
      );
      return;
    }

    let inspected: ProcessInspectionResult;
    try {
      inspected = await this.#options.processPort.inspect({
        executable: this.#definition.executable,
        cwd: this.#options.cwd,
        modelId: this.#options.modelId,
      });
    } catch {
      yield this.#normalized(
        publicFailure(
          "PROVIDER_HEALTH_UNKNOWN",
          "Provider readiness could not be verified.",
        ),
        input,
        state,
      );
      return;
    }
    const missingCapability = REQUIRED_CAPABILITIES.some(
      (capability) => !inspected.capabilities?.includes(capability),
    );
    if (
      !inspected.installed ||
      inspected.authenticated !== "available" ||
      inspected.reachable !== "available" ||
      inspected.cliVersion === undefined ||
      inspected.protocolVersion !== REQUIRED_PROTOCOL_VERSION ||
      !inspected.availableModels?.includes(this.#options.modelId) ||
      missingCapability
    ) {
      yield this.#normalized(
        publicFailure(
          "PROVIDER_NOT_READY",
          "Provider health or protocol requirements are not satisfied.",
        ),
        input,
        state,
      );
      return;
    }

    const prompt = promptForTask(input.task);
    const adapterCostLimitMicros = Math.round(
      this.#options.maxBudgetUsd * 1_000_000,
    );
    const effectiveCostLimitMicros = Math.min(
      adapterCostLimitMicros,
      input.executionBudget?.remainingCostUsdMicros ??
        adapterCostLimitMicros,
    );
    let handle: ProcessHandle;
    try {
      handle = this.#options.processPort.start(
        this.processRequest(
          prompt,
          effectiveCostLimitMicros / 1_000_000,
        ),
      );
    } catch {
      yield this.#normalized(
        publicFailure(
          "PROVIDER_PROCESS_FAILED",
          "Provider process could not start.",
        ),
        input,
        state,
      );
      return;
    }
    const active: ActiveProviderRun = { handle };
    this.#activeRuns.set(input.runId, active);
    let outputBytes = 0;
    let stdoutBuffer = "";

    try {
      for await (const chunk of handle.output) {
        outputBytes += new TextEncoder().encode(chunk.text).byteLength;
        if (outputBytes > this.#options.maxOutputBytes) {
          active.cancelReason = "provider-output-limit";
          await handle.cancel(active.cancelReason);
          yield this.#normalized(
            publicFailure(
              "PROVIDER_OUTPUT_LIMIT",
              "Provider output exceeded the configured limit.",
            ),
            input,
            state,
          );
          await handle.completion.catch(() => undefined);
          return;
        }
        if (chunk.source !== "stdout") continue;

        stdoutBuffer += chunk.text;
        const lines = stdoutBuffer.split(/\r?\n/u);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          const stopped = yield* this.#eventsFromLine(
            line,
            input,
            state,
            active,
          );
          if (stopped) return;
        }
      }

      if (stdoutBuffer.trim().length > 0) {
        const stopped = yield* this.#eventsFromLine(
          stdoutBuffer,
          input,
          state,
          active,
        );
        if (stopped) return;
      }

      const completion = await handle.completion;
      if (active.cancelReason !== undefined) {
        const cleanupStatus =
          completion.cleanupStatus === "complete"
            ? "complete"
            : completion.cleanupStatus === "incomplete"
              ? "incomplete"
              : "unknown";
        yield this.#normalized(
          cleanupStatus === "complete"
            ? {
                kind: "run.cancelled",
                reason: active.cancelReason,
              }
            : {
                kind: "run.stopped",
                reason: active.cancelReason,
                cleanupStatus,
              },
          input,
          state,
        );
        return;
      }
      if (completion.exitCode !== 0 && !state.terminalSeen) {
        yield this.#normalized(
          publicFailure(
            "PROVIDER_PROCESS_FAILED",
            "Provider process exited without a successful result.",
          ),
          input,
          state,
        );
        return;
      }
      if (!state.terminalSeen) {
        yield this.#normalized(
          publicFailure(
            "PROVIDER_PROTOCOL_ERROR",
            "Provider completed without a terminal structured event.",
          ),
          input,
          state,
        );
      }
    } catch {
      yield this.#normalized(
        publicFailure(
          "PROVIDER_PROCESS_FAILED",
          "Provider process could not complete.",
        ),
        input,
        state,
      );
    } finally {
      if (this.#activeRuns.get(input.runId) === active) {
        this.#activeRuns.delete(input.runId);
      }
    }
  }

  async *#eventsFromLine(
    line: string,
    input: StartInput,
    state: StreamState,
    active: ActiveProviderRun,
  ): AsyncGenerator<NormalizedHarnessEvent, boolean> {
    const parsed = this.parseLine(line);
    if (parsed.turnStarted) state.turnCount += 1;
    if (state.turnCount > this.#options.maxTurns) {
      active.cancelReason = "provider-turn-limit";
      await active.handle.cancel(active.cancelReason);
      yield this.#normalized(
        publicFailure(
          "PROVIDER_TURN_LIMIT",
          "Provider exceeded the configured turn limit.",
        ),
        input,
        state,
      );
      await active.handle.completion.catch(() => undefined);
      return true;
    }

    for (const event of parsed.events) {
      if (event.kind === "usage.recorded") {
        state.usedTokens += event.totalTokens;
        state.usedCostUsdMicros += event.costUsdMicros;
        const adapterCostLimitMicros = Math.round(
          this.#options.maxBudgetUsd * 1_000_000,
        );
        const tokenLimit = Math.min(
          input.task.tokenBudget,
          input.executionBudget?.remainingTokens ??
            input.task.tokenBudget,
        );
        const costLimitMicros = Math.min(
          adapterCostLimitMicros,
          input.executionBudget?.remainingCostUsdMicros ??
            adapterCostLimitMicros,
        );
        if (
          state.usedTokens > tokenLimit ||
          state.usedCostUsdMicros > costLimitMicros
        ) {
          active.cancelReason = "provider-budget-limit";
          await active.handle.cancel(active.cancelReason);
          yield this.#normalized(
            publicFailure(
              "PROVIDER_BUDGET_LIMIT",
              "Provider exceeded the configured token or cost budget.",
            ),
            input,
            state,
          );
          await active.handle.completion.catch(() => undefined);
          return true;
        }
      }
      if (
        event.kind === "turn.completed" ||
        event.kind === "run.failed"
      ) {
        state.terminalSeen = true;
      }
      yield this.#normalized(event, input, state);
    }
    return false;
  }

  #normalized(
    event: PublicProviderEvent,
    input: StartInput,
    state: StreamState,
  ): NormalizedHarnessEvent {
    state.sequence += 1;
    const providerInput = publicEventToProviderInput(event);

    return normalizeProviderEvent(providerInput, {
        eventId: `${input.runId}:${this.#createEventId(state.sequence)}`,
        sequence: state.sequence,
        timestamp: this.#clock(),
        traceId: `trace:${input.task.taskId}`,
        spanId: `span:${input.runId}:${state.sequence}`,
        taskId: input.task.taskId,
        runId: input.runId,
        actor: {
          kind: "agent",
          id: `agent:${this.descriptor.harnessId}`,
        },
        harness: {
          harnessId: this.descriptor.harnessId,
          modelId: this.#options.modelId,
        },
        targetRefs: input.task.selectionRefs,
    });
  }
}
