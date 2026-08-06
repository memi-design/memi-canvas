import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  applyAgentPatch,
  createAgentPatch,
  createAgentPatchReview,
  rejectAgentPatch,
} from "./agent-patch.js";
import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import { createCanvasWorkbenchV3TestSession } from "./canvas-workbench-v3-test-session.js";
import {
  createSelectionState,
  createSceneState,
  type WorkbenchNode,
} from "./model.js";
import { createSceneCommandAdapter } from "./scene-command-adapter.js";

function proposedNodes(): readonly WorkbenchNode[] {
  return canvasWorkbenchFixture.document.nodes.map((node) =>
    node.id === "node-campaign-card"
      ? { ...node, name: "Agent-refined campaign card" }
      : node,
  ) as readonly WorkbenchNode[];
}

function patchAt(baseRevision = canvasWorkbenchFixture.document.revision) {
  return createAgentPatch({
    id: "patch-campaign-1",
    actor: {
      kind: "agent",
      harnessId: "codex",
      modelId: "gpt-5.5",
    },
    baseRevision,
    targetIds: ["node-campaign-card"],
    proposedNodes: proposedNodes(),
    operations: [
      {
        kind: "update",
        summary: "Refine the campaign card hierarchy",
        targetIds: ["node-campaign-card"],
      },
    ],
  });
}

async function waitForWorkbench(): Promise<void> {
  await screen.findByRole("toolbar", { name: "Canvas tools" });
}

describe("agent patches", () => {
  it("clones and deeply freezes proposed nodes and operations at receipt", async () => {
    const proposed = proposedNodes();
    const patch = createAgentPatch({
      id: "patch-immutable",
      actor: {
        kind: "agent",
        harnessId: "claude-code",
        modelId: "claude-opus",
      },
      baseRevision: 7,
      targetIds: ["node-campaign-card"],
      proposedNodes: proposed,
      operations: [
        {
          kind: "update",
          summary: "Change the card",
          targetIds: ["node-campaign-card"],
        },
      ],
    });

    expect(patch.proposedNodes).not.toBe(proposed);
    expect(Object.isFrozen(patch)).toBe(true);
    expect(Object.isFrozen(patch.proposedNodes)).toBe(true);
    expect(Object.isFrozen(patch.proposedNodes[0]?.position)).toBe(true);
    expect(Object.isFrozen(patch.operations[0])).toBe(true);
  });

  it("applies a matching revision through the shared scene command adapter", async () => {
    const selection = createSelectionState(["node-campaign-card"]);
    const adapter = createSceneCommandAdapter({
      documentId: canvasWorkbenchFixture.document.id,
      scene: createSceneState(canvasWorkbenchFixture),
      selection,
    });
    const dispatchSpy = vi.spyOn(adapter, "dispatch");
    const review = createAgentPatchReview(
      patchAt(),
      canvasWorkbenchFixture.document.revision,
    );

    const result = applyAgentPatch(review, adapter, selection);

    expect(result.review.status).toBe("applied");
    expect(result.trace?.actor).toBe("agent");
    expect(result.trace?.beforeRevision).toBe(7);
    expect(result.trace?.afterRevision).toBe(8);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "agent",
        id: "patch-campaign-1",
        targetIds: ["node-campaign-card"],
      }),
    );
    expect(
      adapter
        .getBus()
        .getSnapshot()
        .document.nodes.find(({ id }) => id === "node-campaign-card")
        ?.name,
    ).toBe("Agent-refined campaign card");
  });

  it("preserves a stale patch as an explicit conflict without dispatching", async () => {
    const selection = createSelectionState(["node-campaign-card"]);
    const adapter = createSceneCommandAdapter({
      documentId: canvasWorkbenchFixture.document.id,
      scene: createSceneState(canvasWorkbenchFixture),
      selection,
    });
    const dispatchSpy = vi.spyOn(adapter, "dispatch");
    const patch = patchAt(6);
    const review = createAgentPatchReview(patch, 7);

    const result = applyAgentPatch(review, adapter, selection);

    expect(result.trace).toBeNull();
    expect(result.review).toMatchObject({
      status: "conflict",
      currentRevision: 7,
    });
    expect(result.review.patch).toBe(patch);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(adapter.getBus().getSnapshot().document.revision).toBe(7);
  });

  it("rejects a review without mutating its frozen patch", async () => {
    const review = createAgentPatchReview(patchAt(), 7);
    const rejected = rejectAgentPatch(review);

    expect(rejected).not.toBe(review);
    expect(rejected.status).toBe("rejected");
    expect(rejected.patch).toBe(review.patch);
    expect(review.status).toBe("pending");
  });
});

describe("CanvasWorkbench agent patch review", () => {
  it("shows matching patches in Runs and applies them only after approval", async () => {
    render(
      <CanvasWorkbench
        agentPatch={patchAt()}
        project={canvasWorkbenchFixture}
        v3Session={createCanvasWorkbenchV3TestSession(canvasWorkbenchFixture)}
      />,
    );
    await waitForWorkbench();

    const review = screen.getByRole("region", {
      name: "Agent patch review",
    });
    expect(review.textContent).toContain("codex");
    expect(review.textContent).toContain("gpt-5.5");
    expect(review.textContent).toContain("Revision 7");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Approve agent patch patch-campaign-1",
      }),
    );

    expect(
      await screen.findByRole("button", {
        name: "Agent-refined campaign card on canvas",
      }),
    ).toBeTruthy();
    expect(within(review).getByRole("status").textContent).toMatch(
      /applied/i,
    );
  });

  it("keeps stale patches reviewable, disables approval, and permits rejection", async () => {
    render(
      <CanvasWorkbench
        agentPatch={patchAt(6)}
        project={canvasWorkbenchFixture}
        v3Session={createCanvasWorkbenchV3TestSession(canvasWorkbenchFixture)}
      />,
    );
    await waitForWorkbench();

    const approve = screen.getByRole("button", {
      name: "Approve agent patch patch-campaign-1",
    });
    expect(approve.hasAttribute("disabled")).toBe(true);
    const review = screen.getByRole("region", {
      name: "Agent patch review",
    });
    expect(within(review).getByRole("status").textContent).toMatch(
      /conflict.*revision 6.*revision 7/i,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reject agent patch patch-campaign-1",
      }),
    );
    expect(within(review).getByRole("status").textContent).toMatch(
      /rejected/i,
    );
  });
});
