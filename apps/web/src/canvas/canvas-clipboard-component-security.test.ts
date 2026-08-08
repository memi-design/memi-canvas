import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";
import { CanvasPageIdSchema } from "@memi/protocol";
import { describe, expect, it } from "vitest";

import {
  createCanvasClipboardPayload,
  parseCanvasClipboardFallback,
  pasteCanvasClipboard,
} from "./canvas-clipboard.js";
import type { WorkbenchNode } from "./model.js";
import { compileWorkbenchIntentReceiptV3 } from "./workbench-v3-intents.js";

const master: WorkbenchNode = {
  component: {
    atomicLevel: "molecule",
    classification: "master",
    componentId: "card",
    componentName: "Card",
    editable: { icon: false, label: true, selected: false, variant: true },
    props: { label: "Card" },
    role: "card",
    source: {
      repositoryRevision: "main@abc123",
      sourceAnchor: "src/Card.tsx#Card",
    },
  },
  hidden: false,
  id: "card-master",
  kind: "Component",
  locked: false,
  name: "Card",
  parentId: null,
  position: { x: 40, y: 80 },
  size: { height: 120, width: 240 },
};

const instance: WorkbenchNode = {
  ...master,
  component: {
    ...master.component!,
    classification: "instance",
    masterId: master.id,
  },
  id: "card-instance",
  kind: "ComponentInstance",
  name: "Card instance",
  parentId: master.id,
  position: { x: 64, y: 104 },
};

describe("canvas clipboard component integrity", () => {
  it("rejects an included masterId that targets a non-component node", () => {
    const { component: _component, ...rectangle } = master;
    const forged = {
      mime: "application/x-memi-canvas+json",
      nodes: [{ ...rectangle, kind: "Rectangle" }, instance],
      rootIds: [rectangle.id],
      sourceDocumentId: "untrusted-document",
      version: 1,
    };

    expect(parseCanvasClipboardFallback(JSON.stringify(forged))).toBeNull();
  });

  it("detaches an instance when its external master cannot resolve", () => {
    const externalInstance: WorkbenchNode = {
      ...instance,
      component: { ...instance.component!, masterId: "external-master" },
      parentId: null,
    };
    const payload = createCanvasClipboardPayload({
      documentId: "source-document",
      nodes: [externalInstance],
      selectedIds: [externalInstance.id],
    });
    const pasted = pasteCanvasClipboard([], payload);

    expect(pasted?.pastedNodes[0]).toMatchObject({ kind: "DraftFrame" });
    expect(pasted?.pastedNodes[0]?.component).toBeUndefined();
    const pageId = CanvasPageIdSchema.parse("pag_01J00000000000000000000000");
    const document = createCanvasDocumentV3({
      id: "doc_01J00000000000000000000000",
      initialPage: { id: pageId, kind: "design", name: "Canvas" },
      projectId: "prj_01J00000000000000000000000",
    });
    const action = compileWorkbenchIntentReceiptV3({
      document,
      pageId,
      receipt: { kind: "paste", nodes: pasted?.pastedNodes ?? [] },
    });

    expect(() => applyCanvasOperationV3(
      document,
      prepareCanvasOperationV3(document, {
        action,
        actor: "human",
        actorId: "local-user",
        id: "opn_01J00000000000000000000000",
        label: "Paste detached instance",
        occurredAt: "2026-08-08T12:00:00.000Z",
      }),
    )).not.toThrow();
  });
});
