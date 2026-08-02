import { describe, expect, it } from "vitest";

import {
  parseClaudeEventLine,
  parseCodexEventLine,
} from "../src/index.js";

describe("public provider event allowlists", () => {
  it("returns a generic protocol failure for malformed JSON", () => {
    expect(parseCodexEventLine("{private")).toEqual({
      events: [
        {
          kind: "run.failed",
          code: "PROVIDER_PROTOCOL_ERROR",
          message: "Provider returned an invalid structured event.",
        },
      ],
      turnStarted: false,
    });
    expect(parseClaudeEventLine("[]")).toEqual(
      parseCodexEventLine("{private"),
    );
  });

  it("ignores unknown Codex records and empty agent messages", () => {
    expect(
      parseCodexEventLine(JSON.stringify({ type: "private.thought" })),
    ).toEqual({ events: [], turnStarted: false });
    expect(
      parseCodexEventLine(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "" },
        }),
      ),
    ).toEqual({ events: [], turnStarted: false });
  });

  it("allowlists Codex tool identity and generic failure status only", () => {
    expect(
      parseCodexEventLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "",
            type: "mcp_tool_call",
            status: "failed",
            arguments: { secret: true },
            result: "private",
          },
        }),
      ),
    ).toEqual({
      events: [
        {
          kind: "tool.completed",
          callId: "provider-tool",
          toolName: "mcp_tool_call",
          status: "failed",
        },
      ],
      turnStarted: false,
    });
    expect(
      parseCodexEventLine(
        JSON.stringify({
          type: "error",
          message: "private provider error",
        }),
      ),
    ).toEqual({
      events: [
        {
          kind: "run.failed",
          code: "PROVIDER_REPORTED_FAILURE",
          message: "Codex reported a provider failure.",
        },
      ],
      turnStarted: false,
    });
  });

  it("normalizes invalid usage values to bounded nonnegative public numbers", () => {
    expect(
      parseCodexEventLine(
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: -1,
            output_tokens: "private",
            cached_input_tokens: 3,
            cost_usd: -5,
          },
        }),
      ),
    ).toEqual({
      events: [
        {
          kind: "usage.recorded",
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 3,
          totalTokens: 0,
          costUsdMicros: 0,
        },
        { kind: "turn.completed" },
      ],
      turnStarted: false,
    });
  });

  it("ignores Claude thinking blocks and allowlists failed tool completion", () => {
    expect(
      parseClaudeEventLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              null,
              { type: "thinking", thinking: "private" },
              { type: "text", text: "" },
            ],
          },
        }),
      ),
    ).toEqual({ events: [], turnStarted: true });
    expect(
      parseClaudeEventLine(
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "",
                is_error: true,
                content: "private",
              },
            ],
          },
        }),
      ),
    ).toEqual({
      events: [
        {
          kind: "tool.completed",
          callId: "provider-tool",
          toolName: "tool",
          status: "failed",
        },
      ],
      turnStarted: false,
    });
  });

  it("turns Claude error results into generic public failures", () => {
    const parsed = parseClaudeEventLine(
      JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        error: "private stack trace",
      }),
    );

    expect(parsed).toEqual({
      events: [
        {
          kind: "run.failed",
          code: "PROVIDER_REPORTED_FAILURE",
          message: "Claude reported a provider failure.",
        },
      ],
      turnStarted: false,
    });
    expect(JSON.stringify(parsed)).not.toContain("private stack trace");
  });
});
