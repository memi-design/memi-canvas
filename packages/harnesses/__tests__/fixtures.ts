export const FIXED_NOW = "2026-07-28T00:00:00.000Z";

export const taskEnvelope = Object.freeze({
  taskId: "task-responsive-button",
  goal: "Increase the selected button spacing without changing its semantics.",
  acceptanceCriteria: Object.freeze([
    Object.freeze({
      id: "criterion-spacing",
      statement: "The selected button uses the existing compact spacing token.",
      status: "pending",
    }),
    Object.freeze({
      id: "criterion-responsive",
      statement: "The affected screen passes mobile, tablet, and desktop verification.",
      status: "pending",
    }),
  ]),
  selectionRefs: Object.freeze([
    Object.freeze({
      kind: "canvas-node",
      id: "node-button-primary",
      revision: "sha256:node-before",
    }),
  ]),
  evidenceRefs: Object.freeze([
    Object.freeze({
      kind: "source-slice",
      id: "source-button",
      revision: "sha256:source-before",
    }),
    Object.freeze({
      kind: "design-token",
      id: "space-compact",
      revision: "sha256:token",
    }),
  ]),
  constraints: Object.freeze([
    "Use an existing semantic token.",
    "Do not change source files before approval.",
  ]),
  requestedHarness: "fake",
  risk: "canvas-write",
  tokenBudget: 1_200,
  costBudget: 0,
  permissionCeiling: Object.freeze([
    "canvas:read",
    "canvas:propose",
    "canvas:apply",
  ]),
});

export const deterministicScript = Object.freeze([
  Object.freeze({
    kind: "assistant.delta",
    text: "I will update the selected button with the existing compact token.",
  }),
  Object.freeze({
    kind: "approval.requested",
    approvalId: "approval-canvas-apply",
    scopes: Object.freeze(["canvas:apply"]),
    targetRefs: taskEnvelope.selectionRefs,
    expectedBeforeHash: "sha256:node-before",
  }),
  Object.freeze({
    kind: "tool.started",
    callId: "call-canvas-apply",
    toolName: "canvas.applyChangeSet",
    argumentsHash: "sha256:arguments",
  }),
  Object.freeze({
    kind: "tool.completed",
    callId: "call-canvas-apply",
    toolName: "canvas.applyChangeSet",
    resultArtifactRefs: Object.freeze(["artifact-change-set"]),
  }),
  Object.freeze({
    kind: "turn.completed",
    outputArtifactRefs: Object.freeze(["artifact-change-set"]),
  }),
]);

export interface ContractEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly taskId: string;
  readonly runId: string;
  readonly type: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export function fakeHarnessOptions() {
  return {
    descriptor: {
      harnessId: "fake",
      displayName: "Deterministic Fake",
      capabilities: [
        "text",
        "tools",
        "approval-pause",
        "cancel",
        "resume",
      ],
      models: ["fake-model-v1"],
    },
    modelId: "fake-model-v1",
    script: deterministicScript,
    clock: () => FIXED_NOW,
    createEventId: (sequence: number) =>
      `event-task-responsive-button-${String(sequence).padStart(4, "0")}`,
  } as const;
}

export async function collectEvents<T>(
  stream: AsyncIterable<T>,
): Promise<readonly T[]> {
  const events: T[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  return events;
}
