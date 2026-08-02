import type {
  ProjectId,
  TraceEvent,
  TraceEventInput,
} from "@memi/protocol";

export type { TraceEvent, TraceEventInput };

export interface TraceIntegrityResult {
  readonly valid: boolean;
  readonly eventCount: number;
}

export interface TraceReplayState {
  readonly projectId: ProjectId | null;
  readonly imported: boolean;
  readonly materializedCanvasIds: readonly string[];
  readonly lastSequence: number;
}
