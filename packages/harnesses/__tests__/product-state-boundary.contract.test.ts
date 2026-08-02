import { describe, expect, it } from "vitest";

import {
  projectSharedProductState,
  type SharedProductRunState,
} from "../src/index.js";

function collectKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, found);
    }

    return found;
  }

  if (typeof value !== "object" || value === null) {
    return found;
  }

  for (const [key, child] of Object.entries(value)) {
    found.add(key);
    collectKeys(child, found);
  }

  return found;
}

describe("shared product state boundary", () => {
  it("projects only provider-neutral run state", () => {
    const state: SharedProductRunState = projectSharedProductState({
      taskId: "task-1",
      runId: "run-1",
      status: "awaiting-approval",
      harness: {
        harnessId: "codex",
        modelId: "model-1",
      },
      lastSequence: 7,
      pendingApproval: {
        approvalId: "approval-1",
        scopes: ["canvas:apply"],
        targetRefs: [{ kind: "canvas-node", id: "node-1" }],
      },
      checkpointId: "checkpoint-1",
      adapterPrivateState: {
        providerSessionId: "session-secret",
        providerConversationId: "conversation-secret",
        providerResponseId: "response-secret",
        providerCursor: "cursor-secret",
        vendorEventType: "vendor.internal.event",
        rawProviderEvent: { hidden: true },
      },
    });

    expect(state).toEqual({
      taskId: "task-1",
      runId: "run-1",
      status: "awaiting-approval",
      harness: {
        harnessId: "codex",
        modelId: "model-1",
      },
      lastSequence: 7,
      pendingApproval: {
        approvalId: "approval-1",
        scopes: ["canvas:apply"],
        targetRefs: [{ kind: "canvas-node", id: "node-1" }],
      },
      checkpointId: "checkpoint-1",
    });
  });

  it("contains no provider-private concepts at any nesting depth", () => {
    const state = projectSharedProductState({
      taskId: "task-1",
      runId: "run-1",
      status: "running",
      harness: { harnessId: "claude", modelId: "model-2" },
      lastSequence: 3,
      adapterPrivateState: {
        providerSessionId: "secret",
        providerConversationId: "secret",
        providerResponseId: "secret",
        providerCursor: "secret",
        vendorEventType: "secret",
        rawProviderEvent: { providerRequestId: "secret" },
      },
    });

    const forbiddenKeys = new Set([
      "providerSessionId",
      "providerConversationId",
      "providerResponseId",
      "providerRequestId",
      "providerCursor",
      "vendorEventType",
      "rawProviderEvent",
      "adapterPrivateState",
    ]);
    const sharedKeys = collectKeys(state);

    expect(
      [...sharedKeys].filter((key) => forbiddenKeys.has(key)),
    ).toEqual([]);
  });
});
