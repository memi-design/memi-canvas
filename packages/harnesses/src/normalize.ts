import { immutableCopy } from "./immutable.js";
import type {
  EventContext,
  NormalizedHarnessEvent,
  ProviderEventInput,
} from "./types.js";

const EVENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  "progress": "run.progress",
  "assistant.delta": "message.assistant.delta",
  "assistant.complete": "message.assistant.complete",
  "approval.requested": "approval.requested",
  "approval.resolved": "approval.resolved",
  "tool.started": "tool.call.started",
  "tool.completed": "tool.call.completed",
  "usage.recorded": "usage.recorded",
  "turn.completed": "turn.completed",
  "run.failed": "run.failed",
  "run.stopped": "run.stopped",
  "run.cancelled": "run.cancelled",
  "run.resumed": "run.resumed",
});

const EVENT_STATUSES: Readonly<Record<string, string>> = Object.freeze({
  "approval.requested": "waiting",
  "approval.resolved": "running",
  "tool.completed": "completed",
  "usage.recorded": "running",
  "turn.completed": "completed",
  "run.failed": "failed",
  "run.stopped": "stopped",
  "run.cancelled": "cancelled",
  "run.resumed": "running",
});

const PRIVATE_PROVIDER_KEYS = new Set([
  "providerSessionId",
  "providerConversationId",
  "providerResponseId",
  "providerRequestId",
  "providerCursor",
  "rawProviderEvent",
  "vendorEventType",
]);

function sanitizeProviderData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeProviderData);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_PROVIDER_KEYS.has(key))
      .map(([key, child]) => [
        key,
        sanitizeProviderData(child),
      ]),
  );
}

export function normalizeProviderEvent(
  providerEvent: ProviderEventInput,
  context: EventContext,
): NormalizedHarnessEvent {
  const sanitized = sanitizeProviderData(providerEvent.data);

  return immutableCopy({
    schemaVersion: 1,
    ...context,
    type: EVENT_TYPES[providerEvent.kind] ?? providerEvent.kind,
    status: EVENT_STATUSES[providerEvent.kind] ?? "running",
    payload: sanitized as Readonly<Record<string, unknown>>,
  });
}
