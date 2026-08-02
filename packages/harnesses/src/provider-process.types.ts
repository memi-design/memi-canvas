export type ProviderAvailability =
  | "available"
  | "unavailable"
  | "unknown";

export interface ProcessInspectionRequest {
  readonly executable: string;
  readonly cwd: string;
  readonly modelId: string;
}

export interface ProcessInspectionResult {
  readonly installed: boolean;
  readonly authenticated: ProviderAvailability;
  readonly reachable: ProviderAvailability;
  readonly cliVersion?: string;
  readonly protocolVersion?: string;
  readonly availableModels?: readonly string[];
  readonly capabilities?: readonly string[];
}

export interface ProcessOutputChunk {
  readonly source: "stdout" | "stderr";
  readonly text: string;
}

export interface ProcessCompletion {
  readonly exitCode: number;
  readonly signal?: string;
  readonly cleanupStatus?: "complete" | "incomplete" | "unknown";
}

export interface ProcessHandle {
  readonly output: AsyncIterable<ProcessOutputChunk>;
  readonly completion: Promise<ProcessCompletion>;
  cancel(reason: string): Promise<void>;
}

export interface ProcessStartRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin: string;
  readonly maxOutputBytes: number;
}

export interface ProcessPort {
  inspect(
    request: ProcessInspectionRequest,
  ): Promise<ProcessInspectionResult>;
  start(request: ProcessStartRequest): ProcessHandle;
}

export interface ProviderCapabilityHealth {
  readonly id: string;
  readonly status: ProviderAvailability;
}

export interface ProviderHealth {
  readonly harnessId: string;
  readonly checkedAt: string;
  readonly catalog: ProviderAvailability;
  readonly configured: ProviderAvailability;
  readonly execution: ProviderAvailability;
  readonly installed: ProviderAvailability;
  readonly authenticated: ProviderAvailability;
  readonly reachable: ProviderAvailability;
  readonly cli: {
    readonly version?: string;
    readonly status: ProviderAvailability;
  };
  readonly protocol: {
    readonly required: "structured-json-v1";
    readonly actual?: string;
    readonly status: ProviderAvailability;
  };
  readonly model: {
    readonly id: string;
    readonly status: ProviderAvailability;
  };
  readonly capabilities: readonly ProviderCapabilityHealth[];
}

export interface ProcessHarnessAdapterOptions {
  readonly processPort: ProcessPort;
  readonly cwd: string;
  readonly modelId: string;
  readonly maxTurns: number;
  readonly maxBudgetUsd: number;
  readonly maxOutputBytes: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly environmentAllowlist?: readonly string[];
  readonly executionPolicy?: "blocked" | "inspect-only" | "enabled";
  readonly clock?: () => string;
  readonly createEventId?: (sequence: number) => string;
}

export type PublicProviderEvent =
  | {
      readonly kind: "progress";
      readonly phase:
        | "starting"
        | "turn-started"
        | "running";
      readonly message: string;
    }
  | {
      readonly kind: "tool.started";
      readonly callId: string;
      readonly toolName: string;
    }
  | {
      readonly kind: "tool.completed";
      readonly callId: string;
      readonly toolName: string;
      readonly status: "completed" | "failed";
    }
  | {
      readonly kind: "assistant.delta";
      readonly text: string;
    }
  | {
      readonly kind: "assistant.complete";
      readonly text: string;
    }
  | {
      readonly kind: "usage.recorded";
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedInputTokens: number;
      readonly totalTokens: number;
      readonly costUsdMicros: number;
    }
  | {
      readonly kind: "turn.completed";
    }
  | {
      readonly kind: "run.cancelled";
      readonly reason: string;
    }
  | {
      readonly kind: "run.stopped";
      readonly reason: string;
      readonly cleanupStatus: "incomplete" | "unknown";
    }
  | {
      readonly kind: "run.failed";
      readonly code: string;
      readonly message: string;
    };

export interface ProviderEventParseResult {
  readonly events: readonly PublicProviderEvent[];
  readonly turnStarted: boolean;
}
