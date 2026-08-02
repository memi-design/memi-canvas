import {
  parseClaudeEventLine,
} from "./provider-event-normalizers.js";
import { ProcessHarnessAdapter } from "./process-harness-adapter.js";
import type {
  ProcessHarnessAdapterOptions,
  ProcessStartRequest,
  ProviderEventParseResult,
} from "./provider-process.types.js";

export class ClaudeProcessHarnessAdapter extends ProcessHarnessAdapter {
  constructor(options: ProcessHarnessAdapterOptions) {
    super(
      {
        harnessId: "claude-code-local",
        displayName: "Claude Code",
        executable: "claude",
      },
      options,
    );
  }

  protected processRequest(
    prompt: string,
    maxBudgetUsd: number,
  ): ProcessStartRequest {
    return this.processStartRequest(
      [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        this.options.modelId,
        "--permission-mode",
        "plan",
        "--max-turns",
        String(this.options.maxTurns),
        "--max-budget-usd",
        String(maxBudgetUsd),
        "--allowedTools",
        "Read,Glob,Grep",
      ],
      prompt,
    );
  }

  protected parseLine(line: string): ProviderEventParseResult {
    return parseClaudeEventLine(line);
  }
}
