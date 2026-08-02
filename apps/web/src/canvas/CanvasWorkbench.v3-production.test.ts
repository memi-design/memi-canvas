import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";

import { describe, expect, it } from "vitest";
import { createCanvasDocumentV3 } from "@memi/canvas-document";
import {
  CanvasDocumentAppendReceiptV3Schema,
  type CanvasDocumentIdentityV3,
  type CanvasDocumentJournalV3,
  type CanvasDocumentV3PersistencePort,
} from "@memi/protocol";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";

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
});
