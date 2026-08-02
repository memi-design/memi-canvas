import type {
  ProviderEventInput,
} from "./types.js";
import type {
  ProviderEventParseResult,
  PublicProviderEvent,
} from "./provider-process.types.js";

const MAX_PUBLIC_TEXT_LENGTH = 32_768;
const MAX_IDENTIFIER_LENGTH = 160;

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, MAX_PUBLIC_TEXT_LENGTH);
}

function identifier(value: unknown, fallback: string): string {
  const candidate = text(value)?.trim();
  return (candidate === undefined || candidate.length === 0
    ? fallback
    : candidate
  ).slice(0, MAX_IDENTIFIER_LENGTH);
}

function count(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : 0;
}

function dollarsToMicros(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return 0;
  }
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.round(value * 1_000_000),
  );
}

function usageEvent(
  usage: Readonly<Record<string, unknown>> | undefined,
  costUsd: unknown,
): PublicProviderEvent | undefined {
  if (usage === undefined && costUsd === undefined) return undefined;
  const inputTokens = count(usage?.input_tokens);
  const outputTokens = count(usage?.output_tokens);
  const cachedInputTokens = count(
    usage?.cached_input_tokens ?? usage?.cache_read_input_tokens,
  );

  return {
    kind: "usage.recorded",
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsdMicros: dollarsToMicros(costUsd ?? usage?.cost_usd),
  };
}

function protocolFailure(): ProviderEventParseResult {
  return {
    events: [
      {
        kind: "run.failed",
        code: "PROVIDER_PROTOCOL_ERROR",
        message: "Provider returned an invalid structured event.",
      },
    ],
    turnStarted: false,
  };
}

function parseJsonLine(
  line: string,
): Readonly<Record<string, unknown>> | undefined {
  try {
    return record(JSON.parse(line));
  } catch {
    return undefined;
  }
}

export function parseCodexEventLine(
  line: string,
): ProviderEventParseResult {
  const raw = parseJsonLine(line);
  if (raw === undefined) return protocolFailure();
  const type = raw.type;

  if (type === "thread.started") {
    return {
      events: [
        {
          kind: "progress",
          phase: "starting",
          message: "Codex session started.",
        },
      ],
      turnStarted: false,
    };
  }

  if (type === "turn.started") {
    return {
      events: [
        {
          kind: "progress",
          phase: "turn-started",
          message: "Codex turn started.",
        },
      ],
      turnStarted: true,
    };
  }

  if (type === "item.started" || type === "item.completed") {
    const item = record(raw.item);
    const itemType = item?.type;
    const callId = identifier(item?.id, "provider-tool");
    const isTool =
      itemType === "command_execution" ||
      itemType === "mcp_tool_call" ||
      itemType === "tool_call";

    if (isTool) {
      return {
        events: [
          type === "item.started"
            ? {
                kind: "tool.started",
                callId,
                toolName: identifier(itemType, "tool"),
              }
            : {
                kind: "tool.completed",
                callId,
                toolName: identifier(itemType, "tool"),
                status:
                  item?.status === "failed" ? "failed" : "completed",
              },
        ],
        turnStarted: false,
      };
    }

    if (type === "item.completed" && itemType === "agent_message") {
      const message = text(item?.text);
      return {
        events:
          message === undefined || message.length === 0
            ? []
            : [{ kind: "assistant.delta", text: message }],
        turnStarted: false,
      };
    }

    return { events: [], turnStarted: false };
  }

  if (type === "turn.completed") {
    const usage = usageEvent(record(raw.usage), undefined);
    return {
      events: [
        ...(usage === undefined ? [] : [usage]),
        { kind: "turn.completed" },
      ],
      turnStarted: false,
    };
  }

  if (type === "error" || type === "turn.failed") {
    return {
      events: [
        {
          kind: "run.failed",
          code: "PROVIDER_REPORTED_FAILURE",
          message: "Codex reported a provider failure.",
        },
      ],
      turnStarted: false,
    };
  }

  return { events: [], turnStarted: false };
}

function parseClaudeAssistant(
  raw: Readonly<Record<string, unknown>>,
): readonly PublicProviderEvent[] {
  const message = record(raw.message);
  const content = Array.isArray(message?.content)
    ? message.content
    : [];
  const events: PublicProviderEvent[] = [];

  for (const blockValue of content) {
    const block = record(blockValue);
    if (block?.type === "text") {
      const publicText = text(block.text);
      if (publicText !== undefined && publicText.length > 0) {
        events.push({ kind: "assistant.delta", text: publicText });
      }
      continue;
    }
    if (block?.type === "tool_use") {
      events.push({
        kind: "tool.started",
        callId: identifier(block.id, "provider-tool"),
        toolName: identifier(block.name, "tool"),
      });
    }
  }

  return events;
}

function parseClaudeToolResults(
  raw: Readonly<Record<string, unknown>>,
): readonly PublicProviderEvent[] {
  const message = record(raw.message);
  const content = Array.isArray(message?.content)
    ? message.content
    : [];

  return content.flatMap((blockValue) => {
    const block = record(blockValue);
    if (block?.type !== "tool_result") return [];
    return [
      {
        kind: "tool.completed" as const,
        callId: identifier(block.tool_use_id, "provider-tool"),
        toolName: "tool",
        status: block.is_error === true ? "failed" : "completed",
      },
    ];
  });
}

export function parseClaudeEventLine(
  line: string,
): ProviderEventParseResult {
  const raw = parseJsonLine(line);
  if (raw === undefined) return protocolFailure();

  if (raw.type === "system" && raw.subtype === "init") {
    return {
      events: [
        {
          kind: "progress",
          phase: "starting",
          message: "Claude session started.",
        },
      ],
      turnStarted: false,
    };
  }

  if (raw.type === "assistant") {
    return {
      events: parseClaudeAssistant(raw),
      turnStarted: true,
    };
  }

  if (raw.type === "user") {
    return {
      events: parseClaudeToolResults(raw),
      turnStarted: false,
    };
  }

  if (raw.type === "result") {
    const result = text(raw.result);
    const usage = usageEvent(record(raw.usage), raw.total_cost_usd);
    const succeeded = raw.subtype === "success";

    return {
      events: [
        ...(result === undefined || result.length === 0
          ? []
          : [{ kind: "assistant.complete" as const, text: result }]),
        ...(usage === undefined ? [] : [usage]),
        succeeded
          ? { kind: "turn.completed" }
          : {
              kind: "run.failed",
              code: "PROVIDER_REPORTED_FAILURE",
              message: "Claude reported a provider failure.",
            },
      ],
      turnStarted: false,
    };
  }

  return { events: [], turnStarted: false };
}

export function publicEventToProviderInput(
  event: PublicProviderEvent,
): ProviderEventInput {
  switch (event.kind) {
    case "progress":
      return {
        kind: event.kind,
        data: {
          phase: event.phase,
          message: event.message,
        },
      };
    case "tool.started":
      return {
        kind: event.kind,
        data: {
          callId: event.callId,
          toolName: event.toolName,
        },
      };
    case "tool.completed":
      return {
        kind: event.kind,
        data: {
          callId: event.callId,
          toolName: event.toolName,
          status: event.status,
        },
      };
    case "assistant.delta":
    case "assistant.complete":
      return {
        kind: event.kind,
        data: { text: event.text },
      };
    case "usage.recorded":
      return {
        kind: event.kind,
        data: {
          cachedInputTokens: event.cachedInputTokens,
          costUsdMicros: event.costUsdMicros,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          totalTokens: event.totalTokens,
        },
      };
    case "turn.completed":
      return { kind: event.kind, data: {} };
    case "run.cancelled":
      return {
        kind: event.kind,
        data: { reason: event.reason },
      };
    case "run.stopped":
      return {
        kind: event.kind,
        data: {
          cleanupStatus: event.cleanupStatus,
          reason: event.reason,
        },
      };
    case "run.failed":
      return {
        kind: event.kind,
        data: {
          code: event.code,
          message: event.message,
        },
      };
  }
}
