import {
  parseCodexEventLine,
} from "./provider-event-normalizers.js";
import { ProcessHarnessAdapter } from "./process-harness-adapter.js";
import type {
  ProcessHarnessAdapterOptions,
  ProcessStartRequest,
  ProviderEventParseResult,
} from "./provider-process.types.js";

export class CodexProcessHarnessAdapter extends ProcessHarnessAdapter {
  constructor(options: ProcessHarnessAdapterOptions) {
    super(
      {
        harnessId: "codex-local",
        displayName: "Codex",
        executable: "codex",
      },
      options,
    );
  }

  protected processRequest(
    prompt: string,
    _maxBudgetUsd: number,
  ): ProcessStartRequest {
    return this.processStartRequest(
      [
        "exec",
        "--json",
        "--ignore-user-config",
        "--model",
        this.options.modelId,
        "--sandbox",
        "read-only",
        "-",
      ],
      prompt,
    );
  }

  protected parseLine(line: string): ProviderEventParseResult {
    return parseCodexEventLine(line);
  }
}
