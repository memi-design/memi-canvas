import { createElement } from "react";

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import {
  applyCanvasOperationV3,
  createCanvasDocumentV3,
  mapLegacyCanvasIdV2,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";
import { CanvasPageIdSchema, type CanvasDocumentV3 } from "@memi/protocol";

import {
  projectCanvasDocumentV3ToWorkbench,
  projectLegacyComponentMasterIdV3,
} from "./canvas-v3-workbench-projection.js";
import type { ComponentInstanceBinding } from "./component-model.js";
import type { WorkbenchNode } from "./model.js";
import { createWorkbenchDocumentActions } from "./workbench-document-actions.js";
import { createWorkbenchInspectorV3Actions } from "./workbench-inspector-v3-actions.js";
import { Inspector } from "./parts.js";
import {
  compileWorkbenchIntentReceiptV3,
  type WorkbenchIntentReceiptV3,
} from "./workbench-v3-intents.js";

const pageId = CanvasPageIdSchema.parse("pag_01J00000000000000000000000");

function emptyDocument(): CanvasDocumentV3 {
  return createCanvasDocumentV3({
    id: "doc_01J00000000000000000000000",
    initialPage: { id: pageId, kind: "design", name: "Canvas" },
    projectId: "prj_01J00000000000000000000000",
  });
}

function rectangle(
  id: string,
  parentId: string | null,
  x: number,
  y: number,
): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind: "Rectangle",
    locked: false,
    name: id,
    parentId,
    position: { x, y },
    size: { height: 40, width: 60 },
  };
}

function applyReceipt(
  document: CanvasDocumentV3,
  receipt: WorkbenchIntentReceiptV3,
): CanvasDocumentV3 {
  const action = compileWorkbenchIntentReceiptV3({ document, pageId, receipt });
  return applyCanvasOperationV3(
    document,
    prepareCanvasOperationV3(document, {
      action,
      actor: "human",
      actorId: "local-user",
      id: `opn_01J0000000000000000000000${document.revision}`,
      label: receipt.kind,
      occurredAt: "2026-08-02T12:00:00.000Z",
    }),
  );
}

function documentActionReceipt(
  nodes: readonly WorkbenchNode[],
  selectedNodeIds: readonly string[],
  run: (actions: ReturnType<typeof createWorkbenchDocumentActions>) => void,
): WorkbenchIntentReceiptV3 {
  const commitIntentReceipt = vi.fn();
  run(createWorkbenchDocumentActions({
    appendTrace: vi.fn(),
    commitIntentReceipt,
    commitScene: vi.fn(),
    documentId: "document",
    nodes,
    selectedNode: nodes.find(({ id }) => id === selectedNodeIds.at(-1)),
    selectedNodeId: selectedNodeIds.at(-1) ?? null,
    selectedNodeIds,
  }));
  expect(commitIntentReceipt).toHaveBeenCalledTimes(1);
  return commitIntentReceipt.mock.calls[0]![1] as WorkbenchIntentReceiptV3;
}

function componentBinding(
  componentId: string,
  componentName: string,
): ComponentInstanceBinding {
  return {
    atomicLevel: "atom",
    classification: "master",
    componentId,
    componentName,
    editable: { icon: false, label: true, selected: false, variant: true },
    props: { label: componentName },
    role: "button",
    source: {
      exportName: componentName.replaceAll(" ", ""),
      repositoryRevision: "fixture@abc123",
      sourceAnchor: `src/components/${componentName}.tsx#${componentName}`,
    },
    variant: "default",
  };
}

describe("V3 production document component behaviors", () => {
  it("keeps group descendants moving by the same keyboard nudge without corrupting their local transforms", () => {
    const group: WorkbenchNode = {
      ...rectangle("group", null, 100, 80),
      kind: "Group",
      size: { height: 120, width: 180 },
    };
    const child = rectangle("child", group.id, 20, 30);
    const seeded = applyReceipt(emptyDocument(), {
      kind: "create",
      nodes: [group, child],
    });
    const projected = projectCanvasDocumentV3ToWorkbench(seeded, pageId);
    const nudged = projected.map((node) => ({
      ...node,
      position: { x: node.position.x + 1, y: node.position.y },
    }));

    const next = applyReceipt(seeded, { kind: "move", nodes: nudged });
    const nextProjection = projectCanvasDocumentV3ToWorkbench(next, pageId);
    const projectedGroup = nextProjection.find(({ name }) => name === "group")!;
    const projectedChild = nextProjection.find(({ name }) => name === "child")!;
    const canonicalChild = Object.values(next.nodesById).find(
      ({ name }) => name === "child",
    )!;

    expect(projectedGroup.position).toEqual({ x: 101, y: 80 });
    expect(projectedChild.position).toEqual({ x: 121, y: 110 });
    expect(canonicalChild.transform).toMatchObject({ x: 20, y: 30 });
  });

  it("creates a local component definition and duplicates its master as a ComponentInstance", () => {
    const initial = applyReceipt(emptyDocument(), {
      kind: "create",
      nodes: [rectangle("card", null, 40, 60)],
    });
    const projectedCard = projectCanvasDocumentV3ToWorkbench(initial, pageId);
    const groupReceipt = documentActionReceipt(
      projectedCard,
      [projectedCard[0]!.id],
      ({ createComponentFromSelection }) => createComponentFromSelection(),
    );
    const withMaster = applyReceipt(initial, groupReceipt);
    const masterProjection = projectCanvasDocumentV3ToWorkbench(withMaster, pageId);
    const master = masterProjection.find(({ kind }) => kind === "Component")!;

    expect(master.component?.classification).toBe("master");
    expect(Object.values(withMaster.componentsById)).toHaveLength(1);

    const duplicateReceipt = documentActionReceipt(
      masterProjection,
      [master.id],
      ({ duplicateSelection }) => duplicateSelection(),
    );
    const withInstance = applyReceipt(withMaster, duplicateReceipt);
    const instance = projectCanvasDocumentV3ToWorkbench(withInstance, pageId)
      .find(({ name }) => name === `${master.name} copy`)!;

    expect(instance).toMatchObject({
      kind: "ComponentInstance",
      component: {
        classification: "instance",
        componentId: master.component?.componentId,
        masterId: master.id,
      },
    });
  });

  it("duplicates a source component master as a ComponentInstance", () => {
    const componentId = mapLegacyCanvasIdV2(
      "component",
      "northstar.button.primary",
    ).canonicalId;
    const sourceMaster: WorkbenchNode = {
      ...rectangle("source-button", null, 24, 36),
      component: componentBinding(componentId, "Button Primary"),
      kind: "Component",
    };
    const withMaster = applyReceipt(emptyDocument(), {
      kind: "create",
      nodes: [sourceMaster],
    });
    const projected = projectCanvasDocumentV3ToWorkbench(withMaster, pageId);
    const master = projected[0]!;
    const duplicateReceipt = documentActionReceipt(
      projected,
      [master.id],
      ({ duplicateSelection }) => duplicateSelection(),
    );

    const withInstance = applyReceipt(withMaster, duplicateReceipt);
    const instance = projectCanvasDocumentV3ToWorkbench(withInstance, pageId)
      .find(({ name }) => name === "source-button copy")!;

    expect(instance).toMatchObject({
      kind: "ComponentInstance",
      component: {
        classification: "instance",
        componentId,
        masterId: master.id,
      },
    });
  });

  it("commits Lock selection as a V3 style receipt and projects the locked state", () => {
    const seeded = applyReceipt(emptyDocument(), {
      kind: "create",
      nodes: [rectangle("card", null, 20, 30)],
    });
    const projected = projectCanvasDocumentV3ToWorkbench(seeded, pageId);
    const receipts: WorkbenchIntentReceiptV3[] = [];
    const actions = createWorkbenchInspectorV3Actions({
      commitIntentReceipt: (_label, receipt) => receipts.push(receipt),
      projectNodes: projected,
      setPreview: vi.fn(),
    });

    actions.commit({
      label: "Lock card",
      targetIds: [projected[0]!.id],
      update: (node) => ({ ...node, locked: true }),
    });

    expect(receipts).toMatchObject([{ kind: "style" }]);
    const next = applyReceipt(seeded, receipts[0]!);
    expect(projectCanvasDocumentV3ToWorkbench(next, pageId)[0]?.locked).toBe(true);
  });

  it("retains and exposes authored Frame content after detaching a source frame", () => {
    const seeded = applyReceipt(emptyDocument(), {
      kind: "create",
      nodes: [{
        ...rectangle("dashboard", null, 40, 60),
        frameContent: "<main>Production dashboard</main>",
        kind: "Frame",
      }],
    });
    const projected = projectCanvasDocumentV3ToWorkbench(seeded, pageId);
    const sourceProjection: WorkbenchNode[] = [{
      ...projected[0]!,
      kind: "CodeFrame",
      source: {
        coverageCellId: "default",
        repositoryRevision: "fixture@abc123",
        routeId: "dashboard",
        sourceAnchor: "src/routes/dashboard.tsx#Dashboard",
        stateId: "default",
        viewport: { height: 844, name: "mobile", width: 390 },
      },
    }];
    const detachReceipt = documentActionReceipt(
      sourceProjection,
      [sourceProjection[0]!.id],
      ({ detachSelection }) => detachSelection(),
    );

    const detached = applyReceipt(seeded, detachReceipt);
    const draft = projectCanvasDocumentV3ToWorkbench(detached, pageId)[0]!;

    expect(draft).toMatchObject({
      frameContent: "<main>Production dashboard</main>",
      kind: "DraftFrame",
    });
    expect(Object.values(detached.nodesById)[0]?.content).toEqual({
      format: "plain-text",
      type: "frame",
      value: "<main>Production dashboard</main>",
    });
  });

  it("routes Inspector Lock and Hide controls through V3 actions", () => {
    const commit = vi.fn();
    const onChange = vi.fn(() => {
      throw new Error("V2 mutation must not run");
    });
    const node = rectangle("card", null, 20, 30);
    render(createElement(Inspector, {
      node,
      onChange,
      onDelete: vi.fn(),
      onDetach: vi.fn(),
      onDuplicate: vi.fn(),
      v3Actions: { clearPreview: vi.fn(), commit, preview: vi.fn() },
    }));

    const inspector = screen.getByRole("region", { name: "Inspector" });
    fireEvent.click(within(inspector).getByRole("button", { name: "Lock selection" }));
    fireEvent.click(within(inspector).getByRole("button", { name: "Hide selection" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(commit.mock.calls.map(([mutation]) => mutation)).toMatchObject([
      { label: "Lock card", targetIds: ["card"] },
      { label: "Hide card", targetIds: ["card"] },
    ]);
  });

  it("exposes retained DraftFrame content in the V3 Inspector", () => {
    const node: WorkbenchNode = {
      ...rectangle("draft", null, 20, 30),
      frameContent: "<main>Retained</main>",
      kind: "DraftFrame",
    };
    render(createElement(Inspector, {
      node,
      onChange: vi.fn(),
      onDelete: vi.fn(),
      onDetach: vi.fn(),
      onDuplicate: vi.fn(),
      v3Actions: {
        clearPreview: vi.fn(),
        commit: vi.fn(),
        preview: vi.fn(),
      },
    }));

    expect(screen.getByRole("textbox", { name: "Frame content" }))
      .toHaveProperty("value", "<main>Retained</main>");
  });

  it("projects a canonical instance master as its original workbench identity for Inspector metadata", () => {
    const legacyMaster: WorkbenchNode = {
      ...rectangle("northstar-button-primary-master", null, 20, 30),
      component: componentBinding("northstar.button.primary", "Button"),
      kind: "Component",
    };
    const canonicalMasterId = mapLegacyCanvasIdV2(
      "node",
      `fixture-document:${legacyMaster.id}`,
    ).canonicalId;
    const instance: WorkbenchNode = {
      ...rectangle("instance", null, 40, 50),
      component: {
        ...componentBinding("northstar.button.primary", "Button"),
        classification: "instance",
        masterId: canonicalMasterId,
      },
      kind: "ComponentInstance",
    };

    expect(projectLegacyComponentMasterIdV3(
      instance,
      "fixture-document",
      [legacyMaster],
    ).component?.masterId).toBe("northstar-button-primary-master");
  });
});
