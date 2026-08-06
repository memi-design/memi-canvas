import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";

import { describe, expect, it, vi } from "vitest";
import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";
import {
  CanvasDocumentAppendReceiptV3Schema,
  createWorkspaceSessionDraft,
  type CanvasDocumentIdentityV3,
  type CanvasDocumentJournalV3,
  type CanvasDocumentV3PersistencePort,
  type WorkspaceSessionDraftV1,
} from "@memi/protocol";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import { WorkspaceSessionLiveWriter } from "./workspace-session-live-state.js";

const shippedWorkbenchSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/canvas/CanvasWorkbench.tsx"),
  "utf8",
);
const shippedSessionSource = readFileSync(
  resolve(
    process.cwd(),
    "apps/web/src/canvas/useCanvasWorkbenchSessionState.ts",
  ),
  "utf8",
);
const shippedV3HistorySource = readFileSync(
  resolve(
    process.cwd(),
    "apps/web/src/canvas/workbench-v3-history-actions.ts",
  ),
  "utf8",
);
const shippedV3BridgeSource = readFileSync(
  resolve(
    process.cwd(),
    "apps/web/src/canvas/workbench-v3-session-bridge.ts",
  ),
  "utf8",
);
const shippedWorkbenchTypesSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/canvas/CanvasWorkbench.types.ts"),
  "utf8",
);

function v3MemoryPort(): CanvasDocumentV3PersistencePort {
  let journal: CanvasDocumentJournalV3 | null = null;
  return {
    load: async (_identity: CanvasDocumentIdentityV3) => journal,
    initialize: async (snapshot) => {
      journal = {
        schemaVersion: 1,
        kind: "canvas-document-v3-journal",
        identity: snapshot.identity,
        snapshot,
        operations: [],
        operationBytes: 0,
      };
    },
    append: async (request) => {
      if (journal === null) throw new Error("journal not initialized");
      journal = {
        ...journal,
        operations: [...journal.operations, request.operation],
        operationBytes: journal.operationBytes + 1,
      };
      return CanvasDocumentAppendReceiptV3Schema.parse({
        schemaVersion: 1,
        identity: request.identity,
        operationId: request.operation.id,
        revision: request.operation.expectedRevision + 1,
        stateHash: request.operation.resultingHash,
      });
    },
    checkpoint: async () => undefined,
  };
}

function v3Session() {
  const document = createCanvasDocumentV3({
    id: "doc_01J00000000000000000000000",
    projectId: "prj_01J00000000000000000000000",
    initialPage: {
      id: "pag_01J00000000000000000000000",
      kind: "design",
      name: "Page 1",
    },
  });
  return {
    activePageId: document.pageIds[0]!,
    document,
    persistence: v3MemoryPort(),
  } as const;
}

function multiPageV3Session() {
  const first = v3Session();
  const secondPageId = "pag_01J00000000000000000000001";
  const document = applyCanvasOperationV3(
    first.document,
    prepareCanvasOperationV3(first.document, {
      id: "opn_01J00000000000000000000001",
      actor: "human",
      actorId: "local-user",
      occurredAt: "2026-08-02T17:00:00.000Z",
      label: "Create Page 2",
      action: {
        type: "page.define",
        payload: {
          pageId: secondPageId,
          next: {
            id: secondPageId,
            kind: "design",
            name: "Page 2",
            rootIds: [],
          },
        },
      },
    }),
  );
  return {
    activePageId: document.pageIds[0]!,
    document,
    persistence: v3MemoryPort(),
    secondPageId,
  } as const;
}

describe("CanvasWorkbench V3 production authority boundary", () => {
  it("fails closed visibly when no durable V3 session is supplied", () => {
    render(createElement(CanvasWorkbench, { project: canvasWorkbenchFixture }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Canvas V3 session is unavailable.",
    );
  });

  it("uses the V3 controller/history seam and excludes V2 scene authority from the shipped path", () => {
    expect(shippedWorkbenchSource).toContain("useWorkbenchV3SessionBridge");
    expect(shippedWorkbenchSource).toContain(
      "createWorkbenchInspectorV3Actions",
    );
    expect(shippedWorkbenchSource).toContain(
      "v3Actions={inspectorV3Actions}",
    );
    expect(shippedSessionSource).toContain("V3WorkbenchSessionController");
    expect(shippedWorkbenchSource).not.toContain("createWorkbenchHistoryActions");
    expect(shippedSessionSource).not.toContain(
      "createCanonicalWorkbenchAuthority",
    );
    expect(shippedWorkbenchSource).not.toContain("onSceneChange");
    expect(shippedWorkbenchSource).not.toContain('from "./persistence.js"');
    expect(shippedWorkbenchTypesSource).not.toContain("SceneState");
    expect(shippedWorkbenchTypesSource).not.toContain("onSceneChange");
    expect(shippedV3BridgeSource).toContain(
      'from "./workbench-v3-history-actions.js"',
    );
    expect(shippedV3BridgeSource).not.toContain("workbench-history-actions.js");
    expect(shippedV3HistorySource).not.toContain("SceneState");
    expect(shippedV3HistorySource).not.toContain("scene-command-adapter");
    expect(shippedV3HistorySource).not.toContain("CanonicalWorkbenchAuthority\"");
  });

  it("keeps undo and redo controls driven by the V3 renderer history", async () => {
    render(
      createElement(CanvasWorkbench, {
        project: canvasWorkbenchFixture,
        v3Session: v3Session(),
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Rectangle tool" }));
    fireEvent.click(screen.getByRole("region", { name: "Infinite canvas" }), {
      clientX: 640,
      clientY: 360,
    });

    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Rectangle 1 on canvas" }),
      ).toBeTruthy();
      expect(undo.getAttribute("aria-disabled")).toBe("false");
    });

    fireEvent.keyDown(document, { key: "z", metaKey: true });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Rectangle 1 on canvas" }),
      ).toBeNull();
      expect(redo.getAttribute("aria-disabled")).toBe("false");
    });

    fireEvent.keyDown(document, { key: "z", metaKey: true, shiftKey: true });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Rectangle 1 on canvas" }),
      ).toBeTruthy();
      expect(undo.getAttribute("aria-disabled")).toBe("false");
      expect(redo.getAttribute("aria-disabled")).toBe("true");
    });
  });

  it("persists an actual page switch and restores it when the workbench reopens", async () => {
    const session = multiPageV3Session();
    let workspace: WorkspaceSessionDraftV1 = createWorkspaceSessionDraft({
      projectId: session.document.projectId,
      documentId: session.document.id,
      documentRevision: session.document.revision,
      sourceRevision: null,
    });
    let persistedWorkspace = workspace;
    let dirty = false;
    const persist = vi.fn(async () => {
      persistedWorkspace = structuredClone(workspace);
      dirty = false;
    });
    const writer = new WorkspaceSessionLiveWriter(
      {
        getSnapshot: () => ({ session: workspace, dirty }),
        update: (updater) => {
          const next = updater(workspace);
          dirty = dirty || next !== workspace;
          workspace = next;
        },
        persist,
      },
      vi.fn(),
      0,
    );
    const first = render(
      createElement(CanvasWorkbench, {
        initialNavigatorMode: "canvases",
        initialWorkspaceSession: workspace,
        onWorkspaceSessionChange: (state) => writer.write(state),
        project: canvasWorkbenchFixture,
        v3Session: session,
      }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Page 2" }),
    );
    await writer.flush();
    await waitFor(() => {
      expect(persist).toHaveBeenCalled();
      expect(persistedWorkspace.activePageId).toBe(session.secondPageId);
    });
    first.unmount();

    render(
      createElement(CanvasWorkbench, {
        initialNavigatorMode: "canvases",
        initialWorkspaceSession: persistedWorkspace,
        project: canvasWorkbenchFixture,
        v3Session: session,
      }),
    );

    expect(
      (await screen.findByRole("button", { name: "Page 2" })).getAttribute(
        "aria-current",
      ),
    ).toBe("page");
  });
});
