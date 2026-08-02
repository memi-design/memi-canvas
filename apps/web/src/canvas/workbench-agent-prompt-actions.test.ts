import { describe, expect, it, vi } from "vitest";

import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import {
  createWorkbenchAgentPromptActions,
} from "./workbench-agent-prompt-actions.js";
import type { CanvasWorkbenchProject } from "./model.js";

describe("workbench agent prompt actions", () => {
  it("switches harnesses and submits a bounded selection capsule", async () => {
    const appendTrace = vi.fn();
    const onHarnessChange = vi.fn();
    const onSendAgentContext = vi.fn();
    const setHarnessId = vi.fn();
    const setPrompt = vi.fn();
    const setWorkspaceCollapsed = vi.fn();
    const setWorkspaceTab = vi.fn();
    const project =
      canvasWorkbenchFixture as CanvasWorkbenchProject;
    const selectedNode = project.document.nodes[0];
    if (selectedNode === undefined) {
      throw new Error("Expected the fixture to contain a selected node.");
    }

    const actions = createWorkbenchAgentPromptActions({
      appendTrace,
      camera: { x: 10, y: 20, zoom: 1 },
      documentNodes: project.document.nodes,
      documentRevision: project.document.revision,
      harnessId: "codex",
      modelId: "gpt-5.5",
      onHarnessChange,
      onSendAgentContext,
      permissionPolicy: "approval",
      project,
      prompt: "Audit the selected dashboard",
      promptMode: "plan",
      reasoningEffort: "xhigh",
      runtimePort: undefined,
      runtimeUnsubscribe: { current: null },
      selectedHarnessLabel: "Codex",
      selectedNode,
      selectedNodeIds: [selectedNode.id],
      setHarnessId,
      setPrompt,
      setRuntimeSnapshot: vi.fn(),
      setWorkspaceCollapsed,
      setWorkspaceTab,
      viewportSize: { height: 700, width: 1000 },
    });

    actions.switchHarness("claude");
    expect(setHarnessId).toHaveBeenCalledWith("claude");
    expect(onHarnessChange).toHaveBeenCalledWith("claude");
    expect(appendTrace).toHaveBeenCalledWith(
      "Switched harness from Codex to Claude for Dashboard desktop",
      selectedNode.id,
      "claude",
    );

    await actions.sendAgentContext();
    expect(onSendAgentContext).toHaveBeenCalledTimes(1);
    expect(onSendAgentContext.mock.calls[0]?.[0]).toMatchObject({
      capsule: { selectedIds: [selectedNode.id] },
      documentId: project.document.id,
      harnessId: "codex",
      nodeIds: [selectedNode.id],
      prompt: "Audit the selected dashboard",
      revision: project.document.revision,
    });
    expect(setPrompt).toHaveBeenCalledWith("");
    expect(setWorkspaceCollapsed).toHaveBeenCalledWith(false);
    expect(setWorkspaceTab).toHaveBeenCalledWith("runs");
  });
});
