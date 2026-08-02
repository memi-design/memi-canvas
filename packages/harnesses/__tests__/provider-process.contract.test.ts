import { describe, expect, it } from "vitest";

import {
  ClaudeProcessHarnessAdapter,
  CodexProcessHarnessAdapter,
  DurableHarnessRegistry,
  type ProcessHandle,
  type ProcessInspectionResult,
  type ProcessPort,
  type ProcessStartRequest,
} from "../src/index.js";
import {
  collectEvents,
  FIXED_NOW,
  taskEnvelope,
} from "./fixtures.js";

interface FakeProcessOptions {
  readonly chunks?: readonly string[];
  readonly exitCode?: number;
  readonly inspection?: ProcessInspectionResult;
  readonly waitForCancel?: boolean;
}

class FakeProcessPort implements ProcessPort {
  readonly startRequests: ProcessStartRequest[] = [];
  readonly inspectionRequests: {
    readonly executable: string;
    readonly cwd: string;
    readonly modelId: string;
  }[] = [];
  readonly cancelReasons: string[] = [];
  readonly #options: FakeProcessOptions;

  constructor(options: FakeProcessOptions = {}) {
    this.#options = options;
  }

  async inspect(input: {
    readonly executable: string;
    readonly cwd: string;
    readonly modelId: string;
  }): Promise<ProcessInspectionResult> {
    this.inspectionRequests.push(input);
    return (
      this.#options.inspection ?? {
        installed: true,
        authenticated: "available",
        reachable: "available",
        cliVersion: "test-cli-1.0.0",
        protocolVersion: "structured-json-v1",
        availableModels: [input.modelId],
        capabilities: [
          "cancel",
          "read-repository",
          "streaming",
          "text",
          "tools",
        ],
      }
    );
  }

  start(request: ProcessStartRequest): ProcessHandle {
    this.startRequests.push(request);
    let release: (() => void) | undefined;
    const waitForCancellation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chunks = this.#options.chunks ?? [];
    const waitForCancel = this.#options.waitForCancel ?? false;

    return {
      output: (async function* () {
        for (const text of chunks) {
          yield { source: "stdout" as const, text };
        }
        if (waitForCancel) await waitForCancellation;
      })(),
      completion: waitForCancel
        ? waitForCancellation.then(() => ({
            exitCode: 143,
            signal: "SIGTERM",
            cleanupStatus: "complete" as const,
          }))
        : Promise.resolve({
            exitCode: this.#options.exitCode ?? 0,
          }),
      cancel: async (reason) => {
        this.cancelReasons.push(reason);
        release?.();
      },
    };
  }
}

function codexAdapter(
  processPort: ProcessPort,
  overrides: Partial<
    ConstructorParameters<typeof CodexProcessHarnessAdapter>[0]
  > = {},
) {
  return new CodexProcessHarnessAdapter({
    processPort,
    cwd: "/workspace/buzzr",
    modelId: "gpt-5.5",
    maxTurns: 4,
    maxBudgetUsd: 1.5,
    maxOutputBytes: 16_384,
    environment: {
      HOME: "/Users/test",
      PATH: "/opt/homebrew/bin:/usr/bin",
      SECRET_TOKEN: "must-not-cross-the-boundary",
    },
    environmentAllowlist: ["HOME", "PATH"],
    executionPolicy: "enabled",
    clock: () => FIXED_NOW,
    createEventId: (sequence) => `codex-event-${sequence}`,
    ...overrides,
  });
}

function claudeAdapter(
  processPort: ProcessPort,
  overrides: Partial<
    ConstructorParameters<typeof ClaudeProcessHarnessAdapter>[0]
  > = {},
) {
  return new ClaudeProcessHarnessAdapter({
    processPort,
    cwd: "/workspace/buzzr",
    modelId: "claude-sonnet-4-5",
    maxTurns: 3,
    maxBudgetUsd: 1.25,
    maxOutputBytes: 16_384,
    environment: {
      HOME: "/Users/test",
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "must-not-cross-the-boundary",
    },
    environmentAllowlist: ["HOME", "PATH"],
    executionPolicy: "enabled",
    clock: () => FIXED_NOW,
    createEventId: (sequence) => `claude-event-${sequence}`,
    ...overrides,
  });
}

describe("live provider process adapters", () => {
  it("accepts non-demo durable harness identifiers without changing demo selection", () => {
    const registry = new DurableHarnessRegistry([
      {
        descriptor: {
          harnessId: "codex-local",
          displayName: "Codex",
          modelId: "gpt-5.5",
          capabilities: ["source-proposal"],
          autoPriority: 100,
        },
        streamInvocationCount: 0,
        stream: async function* () {
          yield { kind: "run.completed" as const };
        },
      },
    ]);

    expect(
      registry.select({
        mode: "locked",
        harnessId: "codex-local",
        requiredCapabilities: ["source-proposal"],
      }).adapter.descriptor.harnessId,
    ).toBe("codex-local");
  });

  it("invokes Codex structured noninteractive mode with a read-only sandbox", async () => {
    const processPort = new FakeProcessPort({
      chunks: [
        [
          JSON.stringify({
            type: "thread.started",
            thread_id: "private-thread",
          }),
          JSON.stringify({ type: "turn.started" }),
          JSON.stringify({
            type: "item.started",
            item: {
              id: "call-1",
              type: "command_execution",
              command: "cat secret.txt",
            },
          }),
          JSON.stringify({
            type: "item.completed",
            item: {
              id: "message-1",
              type: "agent_message",
              text: "I prepared a source proposal.",
              thinking: "private chain of thought",
            },
          }),
          JSON.stringify({
            type: "item.completed",
            item: {
              id: "call-1",
              type: "command_execution",
              status: "completed",
              aggregated_output: "private tool output",
            },
          }),
          JSON.stringify({
            type: "turn.completed",
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cached_input_tokens: 2,
              cost_usd: 0.01,
            },
          }),
          "",
        ].join("\n"),
      ],
    });
    const adapter = codexAdapter(processPort);

    const events = await collectEvents(
      adapter.start({ runId: "run-codex", task: taskEnvelope }),
    );

    expect(processPort.startRequests).toHaveLength(1);
    expect(processPort.startRequests[0]).toMatchObject({
      executable: "codex",
      args: [
        "exec",
        "--json",
        "--ignore-user-config",
        "--model",
        "gpt-5.5",
        "--sandbox",
        "read-only",
        "-",
      ],
      cwd: "/workspace/buzzr",
      environment: {
        HOME: "/Users/test",
        PATH: "/opt/homebrew/bin:/usr/bin",
      },
      maxOutputBytes: 16_384,
    });
    expect(processPort.startRequests[0]?.stdin).toContain(
      taskEnvelope.goal,
    );
    expect(processPort.startRequests[0]?.args).not.toContain(
      taskEnvelope.goal,
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool.call.started",
          payload: { callId: "call-1", toolName: "command_execution" },
        }),
        expect.objectContaining({
          type: "message.assistant.delta",
          payload: { text: "I prepared a source proposal." },
        }),
        expect.objectContaining({
          type: "usage.recorded",
          payload: {
            cachedInputTokens: 2,
            costUsdMicros: 10_000,
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        }),
        expect.objectContaining({
          type: "turn.completed",
          status: "completed",
        }),
      ]),
    );

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("private chain of thought");
    expect(serialized).not.toContain("private tool output");
    expect(serialized).not.toContain("cat secret.txt");
    expect(serialized).not.toContain("private-thread");
    expect(serialized).not.toContain("SECRET_TOKEN");
  });

  it("invokes Claude print mode with stream-json and read/propose permissions", async () => {
    const processPort = new FakeProcessPort({
      chunks: [
        [
          JSON.stringify({
            type: "system",
            subtype: "init",
            session_id: "private-session",
          }),
          JSON.stringify({
            type: "assistant",
            message: {
              content: [
                {
                  type: "thinking",
                  thinking: "private chain of thought",
                },
                {
                  type: "text",
                  text: "I prepared the visual source change.",
                },
                {
                  type: "tool_use",
                  id: "tool-1",
                  name: "Read",
                  input: { file_path: "/private/path" },
                },
              ],
            },
          }),
          JSON.stringify({
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "tool-1",
                  content: "private file contents",
                },
              ],
            },
          }),
          JSON.stringify({
            type: "result",
            subtype: "success",
            result: "Proposal complete.",
            total_cost_usd: 0.02,
            usage: {
              input_tokens: 20,
              output_tokens: 8,
              cache_read_input_tokens: 4,
            },
          }),
          "",
        ].join("\n"),
      ],
    });
    const adapter = claudeAdapter(processPort);

    const events = await collectEvents(
      adapter.start({ runId: "run-claude", task: taskEnvelope }),
    );

    expect(processPort.startRequests[0]).toMatchObject({
      executable: "claude",
      args: [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        "claude-sonnet-4-5",
        "--permission-mode",
        "plan",
        "--max-turns",
        "3",
        "--max-budget-usd",
        "1.25",
        "--allowedTools",
        "Read,Glob,Grep",
      ],
      cwd: "/workspace/buzzr",
      environment: {
        HOME: "/Users/test",
        PATH: "/usr/bin",
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "message.assistant.delta",
          payload: { text: "I prepared the visual source change." },
        }),
        expect.objectContaining({
          type: "tool.call.started",
          payload: { callId: "tool-1", toolName: "Read" },
        }),
        expect.objectContaining({
          type: "tool.call.completed",
          payload: {
            callId: "tool-1",
            status: "completed",
            toolName: "tool",
          },
        }),
        expect.objectContaining({
          type: "message.assistant.complete",
          payload: { text: "Proposal complete." },
        }),
      ]),
    );

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("private chain of thought");
    expect(serialized).not.toContain("private file contents");
    expect(serialized).not.toContain("/private/path");
    expect(serialized).not.toContain("private-session");
    expect(serialized).not.toContain("ANTHROPIC_API_KEY");
  });

  it("reports installed, authenticated, reachable, model, and capability health independently", async () => {
    const processPort = new FakeProcessPort({
      inspection: {
        installed: true,
        authenticated: "unavailable",
        reachable: "available",
        cliVersion: "codex-cli-0.145.0",
        protocolVersion: "structured-json-v1",
        availableModels: ["gpt-5.4"],
        capabilities: ["streaming", "text"],
      },
    });
    const adapter = codexAdapter(processPort);

    await expect(adapter.health()).resolves.toEqual({
      harnessId: "codex-local",
      checkedAt: FIXED_NOW,
      catalog: "available",
      configured: "available",
      execution: "available",
      installed: "available",
      authenticated: "unavailable",
      reachable: "available",
      cli: {
        version: "codex-cli-0.145.0",
        status: "available",
      },
      protocol: {
        required: "structured-json-v1",
        actual: "structured-json-v1",
        status: "available",
      },
      model: {
        id: "gpt-5.5",
        status: "unavailable",
      },
      capabilities: [
        { id: "cancel", status: "unavailable" },
        { id: "read-repository", status: "unavailable" },
        { id: "streaming", status: "available" },
        { id: "text", status: "available" },
        { id: "tools", status: "unavailable" },
      ],
    });
  });

  it("keeps execution blocked by default without probing or spawning", async () => {
    const processPort = new FakeProcessPort();
    const adapter = codexAdapter(processPort, {
      executionPolicy: "blocked",
    });

    await expect(adapter.health()).resolves.toMatchObject({
      catalog: "available",
      configured: "available",
      execution: "unavailable",
      installed: "unknown",
      authenticated: "unknown",
      reachable: "unknown",
    });
    const events = await collectEvents(
      adapter.start({
        runId: "run-policy-blocked",
        task: taskEnvelope,
      }),
    );

    expect(processPort.inspectionRequests).toEqual([]);
    expect(processPort.startRequests).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run.failed",
        payload: {
          code: "PROVIDER_EXECUTION_BLOCKED",
          message: "Provider execution is blocked by policy.",
        },
      }),
    );
  });

  it("requires a compatible CLI protocol and capability handshake before spawning", async () => {
    const processPort = new FakeProcessPort({
      inspection: {
        installed: true,
        authenticated: "available",
        reachable: "available",
        cliVersion: "codex-cli-incompatible",
        protocolVersion: "plain-text-v0",
        availableModels: ["gpt-5.5"],
        capabilities: ["text"],
      },
    });
    const adapter = codexAdapter(processPort);

    const events = await collectEvents(
      adapter.start({
        runId: "run-handshake",
        task: taskEnvelope,
      }),
    );

    expect(processPort.startRequests).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run.failed",
        payload: {
          code: "PROVIDER_NOT_READY",
          message:
            "Provider health or protocol requirements are not satisfied.",
        },
      }),
    );
  });

  it("enforces the lower explicit runtime remaining budget in USD micros", async () => {
    const processPort = new FakeProcessPort({
      chunks: [
        `${JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cost_usd: 0.02,
          },
        })}\n`,
      ],
    });
    const adapter = codexAdapter(processPort);

    const events = await collectEvents(
      adapter.start({
        runId: "run-budget",
        task: taskEnvelope,
        executionBudget: {
          remainingTokens: 100,
          remainingCostUsdMicros: 10_000,
        },
      }),
    );

    expect(processPort.cancelReasons).toEqual([
      "provider-budget-limit",
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run.failed",
        payload: {
          code: "PROVIDER_BUDGET_LIMIT",
          message:
            "Provider exceeded the configured token or cost budget.",
        },
      }),
    );
  });

  it("cancels the injected process for an explicit run cancellation", async () => {
    const processPort = new FakeProcessPort({
      chunks: [`${JSON.stringify({ type: "turn.started" })}\n`],
      waitForCancel: true,
    });
    const adapter = codexAdapter(processPort);
    const collecting = collectEvents(
      adapter.start({ runId: "run-cancel", task: taskEnvelope }),
    );

    await Promise.resolve();
    await adapter.cancel({
      runId: "run-cancel",
      reason: "user-cancelled",
    });
    const events = await collecting;

    expect(processPort.cancelReasons).toEqual(["user-cancelled"]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run.cancelled",
        status: "cancelled",
        payload: { reason: "user-cancelled" },
      }),
    );
  });

  it("reports stopped instead of cancelled when descendant cleanup is unproven", async () => {
    const processPort = new FakeProcessPort({
      chunks: [`${JSON.stringify({ type: "turn.started" })}\n`],
      waitForCancel: true,
    });
    const originalStart = processPort.start.bind(processPort);
    processPort.start = (request): ProcessHandle => {
      const handle = originalStart(request);
      return {
        ...handle,
        completion: handle.completion.then((completion) => ({
          ...completion,
          cleanupStatus: "unknown",
        })),
      };
    };
    const adapter = codexAdapter(processPort);
    const collecting = collectEvents(
      adapter.start({
        runId: "run-cleanup-unknown",
        task: taskEnvelope,
      }),
    );

    await Promise.resolve();
    await adapter.cancel({
      runId: "run-cleanup-unknown",
      reason: "user-cancelled",
    });
    const events = await collecting;

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run.stopped",
        status: "stopped",
        payload: {
          cleanupStatus: "unknown",
          reason: "user-cancelled",
        },
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "run.cancelled" }),
    );
  });

  it("stops and emits a bounded public failure when provider output exceeds the cap", async () => {
    const processPort = new FakeProcessPort({
      chunks: ["x".repeat(256)],
    });
    const adapter = codexAdapter(processPort, {
      maxOutputBytes: 128,
    });

    const events = await collectEvents(
      adapter.start({ runId: "run-output-limit", task: taskEnvelope }),
    );

    expect(processPort.cancelReasons).toEqual([
      "provider-output-limit",
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run.failed",
        status: "failed",
        payload: {
          code: "PROVIDER_OUTPUT_LIMIT",
          message: "Provider output exceeded the configured limit.",
        },
      }),
    );
    expect(JSON.stringify(events)).not.toContain("xxx");
  });

  it("validates cwd, limits, model, and environment policy before use", () => {
    const processPort = new FakeProcessPort();
    const invalidOptions = [
      { cwd: "relative/project" },
      { maxTurns: 0 },
      { maxBudgetUsd: 0 },
      { maxOutputBytes: 0 },
      { modelId: " " },
      { environmentAllowlist: ["not-valid"] },
    ] as const;

    for (const options of invalidOptions) {
      expect(() => codexAdapter(processPort, options)).toThrow();
    }
  });

  it("normalizes health inspection failures without spawning", async () => {
    const processPort = new FakeProcessPort();
    processPort.inspect = async () => {
      throw new Error("private inspection failure");
    };
    const adapter = codexAdapter(processPort, {
      executionPolicy: "inspect-only",
    });

    const health = await adapter.health();

    expect(health).toMatchObject({
      catalog: "available",
      configured: "available",
      execution: "unavailable",
      installed: "unknown",
      cli: { status: "unknown" },
      protocol: { status: "unknown" },
    });
    expect(JSON.stringify(health)).not.toContain("private");
    expect(processPort.startRequests).toEqual([]);
  });

  it("enforces maximum turns and token budget with public failures", async () => {
    const processPort = new FakeProcessPort({
      chunks: [
        [
          JSON.stringify({ type: "turn.started" }),
          JSON.stringify({ type: "turn.started" }),
          "",
        ].join("\n"),
      ],
    });
    const turnAdapter = codexAdapter(processPort, { maxTurns: 1 });

    const turnEvents = await collectEvents(
      turnAdapter.start({ runId: "run-turn-limit", task: taskEnvelope }),
    );

    expect(turnEvents).toContainEqual(
      expect.objectContaining({
        payload: {
          code: "PROVIDER_TURN_LIMIT",
          message: "Provider exceeded the configured turn limit.",
        },
      }),
    );

    const tokenPort = new FakeProcessPort({
      chunks: [
        `${JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 1_201, output_tokens: 0 },
        })}\n`,
      ],
    });
    const tokenEvents = await collectEvents(
      codexAdapter(tokenPort).start({
        runId: "run-token-limit",
        task: taskEnvelope,
      }),
    );
    expect(tokenEvents).toContainEqual(
      expect.objectContaining({
        payload: {
          code: "PROVIDER_BUDGET_LIMIT",
          message:
            "Provider exceeded the configured token or cost budget.",
        },
      }),
    );
  });

  it("turns process start failures into a bounded public error", async () => {
    const processPort = new FakeProcessPort();
    processPort.start = () => {
      throw new Error("private spawn error with credentials");
    };

    const events = await collectEvents(
      codexAdapter(processPort).start({
        runId: "run-spawn-failure",
        task: taskEnvelope,
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run.failed",
        payload: {
          code: "PROVIDER_PROCESS_FAILED",
          message: "Provider process could not start.",
        },
      }),
    );
    expect(JSON.stringify(events)).not.toContain("credentials");
  });
});
