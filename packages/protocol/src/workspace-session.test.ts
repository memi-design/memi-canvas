import { describe, expect, it } from "vitest";

import {
  WorkspaceSessionDraftSchemaV1,
  WorkspaceSessionSnapshotSchemaV1,
  createWorkspaceSessionDraft,
} from "./workspace-session.js";

const SOURCE_REVISION = "a".repeat(40);
const OLDER_SOURCE_REVISION = "b".repeat(40);

const draft = createWorkspaceSessionDraft({
  projectId: "project-buzzr",
  documentId: "buzzr-mobile",
  documentRevision: 17,
  sourceRevision: SOURCE_REVISION,
});

describe("workspace session protocol", () => {
  it("creates a bounded restorable session without transient gesture state", () => {
    const parsed = WorkspaceSessionDraftSchemaV1.parse({
      ...draft,
      selection: {
        selectedIds: ["button-primary", "label-primary"],
        anchorId: "button-primary",
        focusedNodeId: "label-primary",
        editingNodeId: null,
      },
      camera: {
        x: -120,
        y: 42,
        zoom: 1.25,
        viewportWidth: 1440,
        viewportHeight: 900,
      },
      panels: {
        layersWidth: 240,
        inspectorWidth: 320,
        workspaceSplitRatio: 0.5,
        layersCollapsed: false,
        inspectorCollapsed: false,
      },
      activity: {
        activeRunId: "run-1",
        activeReviewId: "review-1",
        activeApprovalId: null,
        conflictedOverlayIds: ["overlay-1"],
        boundDocumentRevision: 17,
        boundSourceRevision: SOURCE_REVISION,
      },
    });

    expect(parsed.selection.selectedIds).toEqual([
      "button-primary",
      "label-primary",
    ]);
    expect(parsed).not.toHaveProperty("pointerGesture");
    expect(parsed).not.toHaveProperty("hover");
    expect(parsed).not.toHaveProperty("guides");
  });

  it("rejects forged selection, unbound activity, unsafe dimensions, and unknown fields", () => {
    const invalid = [
      {
        ...draft,
        selection: {
          ...draft.selection,
          selectedIds: ["button-primary"],
          anchorId: "not-selected",
        },
      },
      {
        ...draft,
        activity: {
          ...draft.activity,
          activeRunId: "run-1",
          boundDocumentRevision: null,
          boundSourceRevision: SOURCE_REVISION,
        },
      },
      {
        ...draft,
        camera: { ...draft.camera, zoom: 40 },
      },
      {
        ...draft,
        panels: { ...draft.panels, inspectorWidth: 20_000 },
      },
      {
        ...draft,
        pointerGesture: { type: "move" },
      },
    ];

    for (const candidate of invalid) {
      expect(WorkspaceSessionDraftSchemaV1.safeParse(candidate).success).toBe(
        false,
      );
    }
  });

  it("binds active recovery identifiers to a non-future document revision", () => {
    const futureBinding = {
      ...draft,
      activity: {
        ...draft.activity,
        activeReviewId: "review-1",
        boundDocumentRevision: 18,
        boundSourceRevision: SOURCE_REVISION,
      },
    };
    expect(
      WorkspaceSessionDraftSchemaV1.safeParse(futureBinding).success,
    ).toBe(false);
    expect(
      WorkspaceSessionDraftSchemaV1.safeParse({
        ...draft,
        activity: {
          ...draft.activity,
          activeRunId: "run-1",
          boundDocumentRevision: 16,
          boundSourceRevision: OLDER_SOURCE_REVISION,
        },
      }).success,
    ).toBe(true);
    expect(
      WorkspaceSessionDraftSchemaV1.safeParse({
        ...draft,
        activity: {
          ...draft.activity,
          activeRunId: "run-1",
          boundDocumentRevision: 17,
          boundSourceRevision: null,
        },
      }).success,
    ).toBe(false);

    expect(
      WorkspaceSessionSnapshotSchemaV1.parse({
        ...draft,
        sessionRevision: 1,
        updatedAt: "2026-07-29T12:00:00.000Z",
      }).sessionRevision,
    ).toBe(1);
  });
});
