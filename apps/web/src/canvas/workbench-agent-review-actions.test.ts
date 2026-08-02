import { describe, expect, it, vi } from "vitest";

import {
  createAgentPatch,
  createAgentPatchReview,
} from "./agent-patch.js";
import {
  agentPatchUsesLegacyNodeIds,
  agentPatchV3Receipt,
} from "./agent-patch-v3-receipt.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import {
  createWorkbenchAgentReviewActions,
} from "./workbench-agent-review-actions.js";
import type { CanvasWorkbenchProject } from "./model.js";
import { createPreviewSession } from "../preview/preview-session.js";

describe("workbench agent review actions", () => {
  it("rejects a patch that mixes legacy and canonical target identities", () => {
    expect(() =>
      agentPatchUsesLegacyNodeIds(
        ["node-campaign-card", "nod_canonical-campaign-card"],
        [{
          ...canvasWorkbenchFixture.document.nodes[1]!,
          id: "nod_canonical-campaign-card",
        }],
      )
    ).toThrow(/mixes legacy and canonical V3 target identities/i);
  });

  it("rejects a legacy update that hides a geometry change in full nodes", () => {
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
      id: "patch-hidden-geometry",
      operations: [{
        kind: "update",
        summary: "Rename selected frame",
        targetIds: [selectedNodeId],
      }],
      proposedNodes: project.document.nodes.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              name: "Agent-refined campaign card",
              size: { ...node.size, width: node.size.width + 1 },
            }
          : node,
      ),
      targetIds: [selectedNodeId],
    });

    expect(() =>
      agentPatchV3Receipt(patch, project.document.nodes)
    ).toThrow(/without an exact V3 semantic receipt/i);
  });

  it("fails closed rather than applying a full-node agent proposal", async () => {
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

    expect(commitScene).not.toHaveBeenCalled();
    expect(setAgentPatchReview).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRevision: project.document.revision,
        status: "failed",
      }),
    );
  });

  it("commits an exact legacy rename as a V3 semantic receipt after approval", async () => {
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
      id: "patch-rename",
      operations: [
        {
          kind: "update",
          summary: "Rename selected frame",
          targetIds: [selectedNodeId],
        },
      ],
      proposedNodes: project.document.nodes.map((node) =>
        node.id === selectedNodeId
          ? { ...node, name: "Agent-refined campaign card" }
          : node,
      ),
      targetIds: [selectedNodeId],
    });
    const review = createAgentPatchReview(
      patch,
      project.document.revision,
    );
    const commitIntentReceipt = vi.fn();
    const commitScene = vi.fn();
    const setAgentPatchReview = vi.fn();

    const actions = createWorkbenchAgentReviewActions({
      agentPatchReview: review,
      appendTrace: vi.fn(),
      canonicalDocumentRevision: project.document.revision,
      commitIntentReceipt,
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

    expect(commitScene).not.toHaveBeenCalled();
    expect(commitIntentReceipt).toHaveBeenCalledWith(
      "Apply agent patch patch-rename",
      {
        kind: "node.name",
        next: "Agent-refined campaign card",
        nodeId: selectedNodeId,
      },
      { selectedIds: [selectedNodeId] },
    );
    expect(setAgentPatchReview).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRevision: project.document.revision + 1,
        status: "applied",
      }),
    );
  });

  it("does not mark an agent patch applied when the durable commit rejects", async () => {
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
      id: "patch-persistence-failure",
      operations: [{
        kind: "update",
        summary: "Rename selected frame",
        targetIds: [selectedNodeId],
      }],
      proposedNodes: project.document.nodes.map((node) =>
        node.id === selectedNodeId
          ? { ...node, name: "Agent-refined campaign card" }
          : node,
      ),
      targetIds: [selectedNodeId],
    });
    const setAgentPatchReview = vi.fn();
    const actions = createWorkbenchAgentReviewActions({
      agentPatchReview: createAgentPatchReview(
        patch,
        project.document.revision,
      ),
      appendTrace: vi.fn(),
      canonicalDocumentRevision: project.document.revision,
      commitIntentReceipt: vi.fn(async () => {
        throw new Error("Persistence receipt mismatch.");
      }),
      commitScene: vi.fn(),
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

    expect(setAgentPatchReview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/persistence receipt mismatch/i),
        status: "failed",
      }),
    );
    expect(setAgentPatchReview).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "applied" }),
    );
  });

  it("uses current V3 nodes rather than legacy base nodes for canonical patches", async () => {
    const project =
      canvasWorkbenchFixture as CanvasWorkbenchProject;
    const canonicalNodes = project.document.nodes.map((node) => ({
      ...node,
      id: `nod_${node.id}`,
      parentId:
        node.parentId === null ? null : `nod_${node.parentId}`,
    }));
    const targetId = canonicalNodes[1]?.id;
    if (targetId === undefined) {
      throw new Error("Expected a canonical target node.");
    }
    const patch = createAgentPatch({
      actor: {
        harnessId: "codex",
        kind: "agent",
        modelId: "gpt-5.5",
      },
      baseRevision: project.document.revision,
      id: "patch-canonical-rename",
      operations: [{
        kind: "update",
        summary: "Rename canonical frame",
        targetIds: [targetId],
      }],
      proposedNodes: canonicalNodes.map((node) =>
        node.id === targetId
          ? { ...node, name: "Canonical agent rename" }
          : node,
      ),
      targetIds: [targetId],
    });
    const commitIntentReceipt = vi.fn(async () => undefined);
    const actions = createWorkbenchAgentReviewActions({
      agentPatchBaseNodes: project.document.nodes,
      agentPatchLegacyDocumentId: project.document.id,
      agentPatchReview: createAgentPatchReview(
        patch,
        project.document.revision,
      ),
      appendTrace: vi.fn(),
      canonicalDocumentRevision: project.document.revision,
      commitIntentReceipt,
      commitScene: vi.fn(),
      documentNodes: canonicalNodes,
      documentRevision: project.document.revision,
      persistenceProjectId: project.id,
      previewSession: createPreviewSession("http://localhost:5173", {
        documentRevision: project.document.revision,
        projectId: project.id,
      }),
      restorePreview: null,
      runtimePort: undefined,
      runtimeSnapshot: null,
      selectedNodeId: targetId,
      selectedNodeIds: [targetId],
      setAgentPatchReview: vi.fn(),
      setRestorePreview: vi.fn(),
      setRuntimeSnapshot: vi.fn(),
      setWorkspaceCollapsed: vi.fn(),
      setWorkspaceTab: vi.fn(),
    });

    await actions.approveAgentPatch();

    expect(commitIntentReceipt).toHaveBeenCalledWith(
      "Apply agent patch patch-canonical-rename",
      {
        kind: "node.name",
        next: "Canonical agent rename",
        nodeId: targetId,
      },
      { selectedIds: [targetId] },
    );
  });
});
