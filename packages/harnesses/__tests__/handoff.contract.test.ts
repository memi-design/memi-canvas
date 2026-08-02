import { describe, expect, it } from "vitest";

import { createHandoffPacket } from "../src/index.js";
import { taskEnvelope } from "./fixtures.js";

describe("harness handoff packets", () => {
  it("preserves accepted context, remaining work, permissions, and budget", () => {
    const packet = createHandoffPacket({
      task: taskEnvelope,
      fromRunId: "run-codex",
      fromHarnessId: "codex",
      toHarnessId: "claude",
      checkpointId: "checkpoint-7",
      traceCursor: 42,
      acceptedDecisions: [
        {
          id: "decision-token",
          summary: "Use the existing compact spacing token.",
          evidenceRefs: ["space-compact"],
        },
      ],
      completedArtifactRefs: ["artifact-audit"],
      remainingCriterionIds: ["criterion-responsive"],
      currentSelectionRefs: taskEnvelope.selectionRefs,
      permissionCeiling: taskEnvelope.permissionCeiling,
      remainingTokenBudget: 640,
    });

    expect(packet).toEqual({
      schemaVersion: 1,
      taskId: taskEnvelope.taskId,
      goal: taskEnvelope.goal,
      fromRunId: "run-codex",
      fromHarnessId: "codex",
      toHarnessId: "claude",
      checkpointId: "checkpoint-7",
      traceCursor: 42,
      acceptedDecisions: [
        {
          id: "decision-token",
          summary: "Use the existing compact spacing token.",
          evidenceRefs: ["space-compact"],
        },
      ],
      completedArtifactRefs: ["artifact-audit"],
      remainingCriteria: [
        {
          id: "criterion-responsive",
          statement:
            "The affected screen passes mobile, tablet, and desktop verification.",
          status: "pending",
        },
      ],
      currentSelectionRefs: taskEnvelope.selectionRefs,
      evidenceRefs: taskEnvelope.evidenceRefs,
      constraints: taskEnvelope.constraints,
      permissionCeiling: taskEnvelope.permissionCeiling,
      remainingTokenBudget: 640,
    });
    expect(Object.isFrozen(packet)).toBe(true);
    expect(Object.isFrozen(packet.currentSelectionRefs)).toBe(true);
  });

  it("does not copy provider-private session state into the handoff", () => {
    const unsafeRuntimeInput = {
      task: taskEnvelope,
      fromRunId: "run-codex",
      fromHarnessId: "codex",
      toHarnessId: "claude",
      checkpointId: "checkpoint-7",
      traceCursor: 42,
      acceptedDecisions: [],
      completedArtifactRefs: [],
      remainingCriterionIds: taskEnvelope.acceptanceCriteria.map(
        (criterion) => criterion.id,
      ),
      currentSelectionRefs: taskEnvelope.selectionRefs,
      permissionCeiling: taskEnvelope.permissionCeiling,
      remainingTokenBudget: 640,
      adapterPrivateState: {
        providerSessionId: "provider-secret",
        providerConversationId: "conversation-secret",
        rawProviderEvent: { private: true },
      },
    };
    const packet = createHandoffPacket(unsafeRuntimeInput);

    const serialized = JSON.stringify(packet);

    expect(serialized).not.toContain("providerSessionId");
    expect(serialized).not.toContain("providerConversationId");
    expect(serialized).not.toContain("rawProviderEvent");
    expect(serialized).not.toContain("provider-secret");
  });

  it("deep-clones and freezes nested handoff evidence", () => {
    const acceptedDecision = {
      id: "decision-token",
      summary: "Keep the existing semantic token.",
      evidenceRefs: ["space-compact"],
    };
    const packet = createHandoffPacket({
      task: taskEnvelope,
      fromRunId: "run-codex",
      fromHarnessId: "codex",
      toHarnessId: "claude",
      checkpointId: "checkpoint-immutable",
      traceCursor: 9,
      acceptedDecisions: [acceptedDecision],
      completedArtifactRefs: [],
      remainingCriterionIds: ["criterion-responsive"],
      currentSelectionRefs: taskEnvelope.selectionRefs,
      permissionCeiling: taskEnvelope.permissionCeiling,
      remainingTokenBudget: 500,
    });

    acceptedDecision.evidenceRefs.push("evidence-mutated");
    acceptedDecision.summary = "Mutated after handoff";

    expect(packet.acceptedDecisions).toEqual([
      {
        id: "decision-token",
        summary: "Keep the existing semantic token.",
        evidenceRefs: ["space-compact"],
      },
    ]);
    expect(Object.isFrozen(packet.acceptedDecisions[0])).toBe(true);
    expect(
      Object.isFrozen(
        packet.acceptedDecisions[0]?.evidenceRefs,
      ),
    ).toBe(true);
  });

  it("rejects unknown remaining acceptance criteria", () => {
    expect(() =>
      createHandoffPacket({
        task: taskEnvelope,
        fromRunId: "run-codex",
        fromHarnessId: "codex",
        toHarnessId: "claude",
        checkpointId: "checkpoint-invalid-criterion",
        traceCursor: 4,
        acceptedDecisions: [],
        completedArtifactRefs: [],
        remainingCriterionIds: ["criterion-does-not-exist"],
        currentSelectionRefs: taskEnvelope.selectionRefs,
        permissionCeiling: taskEnvelope.permissionCeiling,
        remainingTokenBudget: 500,
      }),
    ).toThrow(
      'Unknown remaining acceptance criterion "criterion-does-not-exist".',
    );
  });

  it.each([-1, taskEnvelope.tokenBudget + 1])(
    "rejects invalid remaining token budget %s",
    (remainingTokenBudget) => {
      expect(() =>
        createHandoffPacket({
          task: taskEnvelope,
          fromRunId: "run-codex",
          fromHarnessId: "codex",
          toHarnessId: "claude",
          checkpointId: "checkpoint-invalid-budget",
          traceCursor: 4,
          acceptedDecisions: [],
          completedArtifactRefs: [],
          remainingCriterionIds: ["criterion-responsive"],
          currentSelectionRefs: taskEnvelope.selectionRefs,
          permissionCeiling: taskEnvelope.permissionCeiling,
          remainingTokenBudget,
        }),
      ).toThrow(
        `Remaining token budget must be between 0 and ${taskEnvelope.tokenBudget}.`,
      );
    },
  );

  it("rejects a permission ceiling broader than the original task", () => {
    expect(() =>
      createHandoffPacket({
        task: taskEnvelope,
        fromRunId: "run-codex",
        fromHarnessId: "codex",
        toHarnessId: "claude",
        checkpointId: "checkpoint-invalid-permission",
        traceCursor: 4,
        acceptedDecisions: [],
        completedArtifactRefs: [],
        remainingCriterionIds: ["criterion-responsive"],
        currentSelectionRefs: taskEnvelope.selectionRefs,
        permissionCeiling: [
          ...taskEnvelope.permissionCeiling,
          "source:apply",
        ],
        remainingTokenBudget: 500,
      }),
    ).toThrow(
      'Handoff permission "source:apply" exceeds the original task ceiling.',
    );
  });
});
