import type { HarnessSignal } from "../../protocol/src/index.js";

export interface DurableHarnessDescriptor {
  readonly harnessId: string;
  readonly displayName: string;
  readonly modelId: string;
  readonly capabilities: readonly string[];
  readonly autoPriority: number;
}

export interface DurableHarnessStreamInput {
  readonly taskId: string;
  readonly runId: string;
  readonly dispatchEpoch: number;
  readonly afterSignalCount: number;
}

export interface DurableHarnessAdapter {
  readonly descriptor: DurableHarnessDescriptor;
  readonly streamInvocationCount: number;
  stream(input: DurableHarnessStreamInput): AsyncIterable<HarnessSignal>;
}

export type DurableHarnessSelectionRequest =
  | {
      readonly mode: "locked";
      readonly harnessId: DurableHarnessDescriptor["harnessId"];
      readonly requiredCapabilities: readonly string[];
    }
  | {
      readonly mode: "auto";
      readonly requiredCapabilities: readonly string[];
    };

export interface DurableHarnessSelection {
  readonly adapter: DurableHarnessAdapter;
  readonly reason: "user-selected" | "deterministic-auto";
  readonly candidates: readonly {
    readonly harnessId: string;
    readonly eligible: boolean;
    readonly selected: boolean;
  }[];
}
