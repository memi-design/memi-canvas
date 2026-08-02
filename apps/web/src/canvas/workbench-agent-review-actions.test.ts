import { describe, expect, it, vi } from "vitest";

import {
  createAgentPatch,
  createAgentPatchReview,
} from "./agent-patch.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import {
  createWorkbenchAgentReviewActions,
} from "./workbench-agent-review-actions.js";
import type { CanvasWorkbenchProject } from "./model.js";
import { createPreviewSession } from "../preview/preview-session.js";

describe("workbench agent review actions", () => {
  it("applies an approved local proposal as one agent command", async () => {
    const project =
      canvasWorkbenchFixture as CanvasWorkbenchProject;
    const selectedNodeId = project.selectedNodeId;
    if (selectedNodeId === null) {
      throw new Error("Expected the fixture to select a node.");
    }
    const patch = createAgentPatch({
      actor: {
        harnessId: "codex",
        kind: "agent",
        modelId: "gpt-5.5",
      },
      baseRevision: project.document.revision,
      id: "patch-test",
      operations: [
        {
          kind: "update",
          summary: "Refine selected frame",
          targetIds: [selectedNodeId],
        },
      ],
      proposedNodes: project.document.nodes,
      targetIds: [selectedNodeId],
    });
    const review = createAgentPatchReview(
      patch,
      project.document.revision,
    );
    const commitScene = vi.fn().mockReturnValue({
      nodes: project.document.nodes,
      revision: project.document.revision + 1,
    });
    const setAgentPatchReview = vi.fn();

    const actions = createWorkbenchAgentReviewActions({
      agentPatchReview: review,
      appendTrace: vi.fn(),
      canonicalDocumentRevision: project.document.revision,
      commitScene,
      documentNodes: project.document.nodes,
      documentRevision: project.document.revision,
      persistenceProjectId: project.id,
      previewSession: createPreviewSession("http://localhost:5173", {
        documentRevision: project.document.revision,
        projectId: project.id,
      }),
      restorePreview: null,
      runtimePort: undefined,
      runtimeSnapshot: null,
      selectedNodeId,
      selectedNodeIds: [selectedNodeId],
      setAgentPatchReview,
      setRestorePreview: vi.fn(),
      setRuntimeSnapshot: vi.fn(),
      setWorkspaceCollapsed: vi.fn(),
      setWorkspaceTab: vi.fn(),
    });

    await actions.approveAgentPatch();

    expect(commitScene).toHaveBeenCalledWith(
      "Apply agent patch patch-test",
      project.document.nodes,
      {
        actor: "agent",
        targetIds: [selectedNodeId],
      },
    );
    expect(setAgentPatchReview.mock.calls[0]?.[0]).toMatchObject({
      currentRevision: project.document.revision,
      status: "applying",
    });
    expect(setAgentPatchReview).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRevision: project.document.revision + 1,
        status: "applied",
      }),
    );
  });
});
