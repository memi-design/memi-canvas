import type { CanvasActionIntentV2 } from "@memi/protocol";

export interface CreateCanvasDocumentV2Input {
  readonly id: string;
  readonly projectId: string;
}

export interface PrepareCanvasOperationV2Input {
  readonly id: string;
  readonly actor: "human" | "agent" | "system";
  readonly actorId: string;
  readonly occurredAt: string;
  readonly action: CanvasActionIntentV2;
}

export interface InvertCanvasOperationV2Input {
  readonly id: string;
  readonly actor: "human" | "agent" | "system";
  readonly actorId: string;
  readonly occurredAt: string;
}
