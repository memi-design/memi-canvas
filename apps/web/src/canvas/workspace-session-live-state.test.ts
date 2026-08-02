import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceSessionDraft } from "@memi/protocol";

import { createSelectionState } from "./model.js";
import {
  WorkspaceSessionLiveWriter,
  workspaceSessionFromWorkbenchState,
} from "./workspace-session-live-state.js";

const SOURCE_REVISION = "a".repeat(40);

function liveState(x: number) {
  return {
    activity: {
      activeRunId: "run-1",
      activeReviewId: "review-1",
      activeApprovalId: null,
      conflictedOverlayIds: ["overlay-1"],
      boundDocumentRevision: 5,
      boundSourceRevision: SOURCE_REVISION,
    },
    camera: { x, y: 80, zoom: 1.5 },
    documentRevision: 5,
    panels: {
      layersWidth: 256,
      inspectorWidth: 360,
      workspaceSplitRatio: 0.6,
      layersCollapsed: false,
      inspectorCollapsed: true,
    },
    selection: createSelectionState(["node-1", "node-2"], {
      editingId: "node-2",
      focusedId: "node-1",
    }),
    viewportSize: { height: 900, width: 1_440 },
  } as const;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("workspace session live state", () => {
  it("projects bounded editor metadata without document arrays or revision regression", () => {
    const initial = createWorkspaceSessionDraft({
      projectId: "project-buzzr",
      documentId: "document-buzzr",
      documentRevision: 4,
      sourceRevision: SOURCE_REVISION,
    });

    const next = workspaceSessionFromWorkbenchState(
      initial,
      liveState(44),
    );

    expect(next).toMatchObject({
      documentRevision: 5,
      camera: {
        x: 44,
        y: 80,
        zoom: 1.5,
        viewportWidth: 1_440,
        viewportHeight: 900,
      },
      panels: {
        workspaceSplitRatio: 0.6,
        inspectorCollapsed: true,
      },
      selection: {
        selectedIds: ["node-1", "node-2"],
        anchorId: "node-2",
        focusedNodeId: "node-1",
        editingNodeId: "node-2",
      },
      activity: {
        activeRunId: "run-1",
        activeReviewId: "review-1",
        conflictedOverlayIds: ["overlay-1"],
        boundDocumentRevision: 5,
        boundSourceRevision: SOURCE_REVISION,
      },
    });
    expect(initial.documentRevision).toBe(4);
    expect("nodes" in next).toBe(false);
    expect(
      workspaceSessionFromWorkbenchState(next, liveState(44)),
    ).toBe(next);
  });

  it("coalesces rapid camera writes into one durable revision", async () => {
    vi.useFakeTimers();
    let session = createWorkspaceSessionDraft({
      projectId: "project-buzzr",
      documentId: "document-buzzr",
      documentRevision: 4,
      sourceRevision: SOURCE_REVISION,
    });
    let dirty = false;
    const persist = vi.fn(async () => {
      dirty = false;
    });
    const writer = new WorkspaceSessionLiveWriter(
      {
        getSnapshot: () => ({ session, dirty }),
        update: (updater) => {
          const next = updater(session);
          dirty = dirty || next !== session;
          session = next;
        },
        persist,
      },
      vi.fn(),
      160,
    );

    writer.write(liveState(10));
    writer.write(liveState(20));
    writer.write(liveState(30));
    expect(persist).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(160);

    expect(persist).toHaveBeenCalledOnce();
    expect(session.camera.x).toBe(30);
  });
});
