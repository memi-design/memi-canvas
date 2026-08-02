import { hashCanonicalValue } from "@memi/canonical-json";
import {
  CanvasOperationCommittedActionMaterialSchema,
  CanvasOperationCommittedAllocationSchema,
  CanvasOperationCommittedBodySchema,
  CanvasOperationCommittedEventHashMaterialSchema,
  CanvasOperationCommittedEventSchema,
  type CanvasOperationCommittedActionMaterial,
  type CanvasOperationCommittedAllocation,
  type CanvasOperationCommittedBody,
  type CanvasOperationCommittedEvent,
  type CanvasOperationCommittedEventHashMaterial,
  type ContentHash,
  type ProjectId,
} from "@memi/protocol";

export interface CanvasOperationCommittedChainResult {
  readonly valid: boolean;
  readonly eventCount: number;
}

export interface CanvasOperationReplayEntry {
  readonly eventId: CanvasOperationCommittedEvent["id"];
  readonly sequence: number;
  readonly commandId: CanvasOperationCommittedEvent["commandId"];
  readonly outboxId: CanvasOperationCommittedEvent["outboxId"];
  readonly target: CanvasOperationCommittedEvent["target"];
  readonly operationId: CanvasOperationCommittedEvent["operationId"];
  readonly appliedRevision: number;
  readonly resultingHash: ContentHash;
}

export interface CanvasOperationCommittedReplayState {
  readonly projectId: ProjectId | null;
  readonly lastSequence: number;
  readonly lastEventHash: ContentHash | null;
  readonly operations: readonly CanvasOperationReplayEntry[];
}

export function hashCanvasOperationCommittedAction(
  input: CanvasOperationCommittedActionMaterial,
): ContentHash {
  const material =
    CanvasOperationCommittedActionMaterialSchema.parse(input);
  return hashCanonicalValue(material) as ContentHash;
}

export function hashCanvasOperationCommittedEvent(
  input: CanvasOperationCommittedEventHashMaterial,
): ContentHash {
  const material =
    CanvasOperationCommittedEventHashMaterialSchema.parse(input);
  return hashCanonicalValue(material) as ContentHash;
}

export function buildCanvasOperationCommittedEvent(
  inputBody: CanvasOperationCommittedBody,
  inputAllocation: CanvasOperationCommittedAllocation,
): CanvasOperationCommittedEvent {
  const body = CanvasOperationCommittedBodySchema.parse(inputBody);
  const allocation =
    CanvasOperationCommittedAllocationSchema.parse(inputAllocation);
  const actionMaterial =
    CanvasOperationCommittedActionMaterialSchema.parse({
      ...body,
      id: allocation.eventId,
    });
  const eventMaterial =
    CanvasOperationCommittedEventHashMaterialSchema.parse({
      ...actionMaterial,
      sequence: allocation.sequence,
      occurredAt: allocation.occurredAt,
      previousEventHash: allocation.previousEventHash,
      eventActionDigest:
        hashCanvasOperationCommittedAction(actionMaterial),
    });
  return CanvasOperationCommittedEventSchema.parse({
    ...eventMaterial,
    eventHash: hashCanvasOperationCommittedEvent(eventMaterial),
  });
}

export function verifyCanvasOperationCommittedChain(
  inputs: readonly unknown[],
): CanvasOperationCommittedChainResult {
  let projectId: ProjectId | null = null;
  let previousEventHash: ContentHash | null = null;
  const eventIds = new Set<string>();
  const commandIds = new Set<string>();
  const outboxIds = new Set<string>();

  for (const [index, input] of inputs.entries()) {
    const parsed =
      CanvasOperationCommittedEventSchema.safeParse(input);
    if (!parsed.success) {
      return { valid: false, eventCount: inputs.length };
    }
    const event = parsed.data;
    if (
      event.sequence !== index + 1 ||
      (projectId !== null && event.projectId !== projectId) ||
      event.previousEventHash !== previousEventHash ||
      eventIds.has(event.id) ||
      commandIds.has(event.commandId) ||
      outboxIds.has(event.outboxId)
    ) {
      return { valid: false, eventCount: inputs.length };
    }
    projectId = event.projectId;
    previousEventHash = event.eventHash;
    eventIds.add(event.id);
    commandIds.add(event.commandId);
    outboxIds.add(event.outboxId);
  }

  return { valid: true, eventCount: inputs.length };
}

export function replayCanvasOperationCommittedEvents(
  inputs: readonly unknown[],
): CanvasOperationCommittedReplayState {
  if (!verifyCanvasOperationCommittedChain(inputs).valid) {
    throw new Error(
      "Canonical canvas trace integrity verification failed before replay.",
    );
  }
  const events = inputs.map((input) =>
    CanvasOperationCommittedEventSchema.parse(input),
  );
  return {
    projectId: events[0]?.projectId ?? null,
    lastSequence: events.at(-1)?.sequence ?? 0,
    lastEventHash: events.at(-1)?.eventHash ?? null,
    operations: events.map((event) => ({
      eventId: event.id,
      sequence: event.sequence,
      commandId: event.commandId,
      outboxId: event.outboxId,
      target: event.target,
      operationId: event.operationId,
      appliedRevision: event.appliedRevision,
      resultingHash: event.resultingHash,
    })),
  };
}
