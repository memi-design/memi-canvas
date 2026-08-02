import { describe, expect, it } from "vitest";

import {
  componentDuplicateBase,
  createSceneState,
  createSelectionState,
  type WorkbenchNode,
} from "./model.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import { createCanonicalWorkbenchAuthority } from "./canonical-workbench-authority.js";
import { diffWorkbenchProjections } from "./canonical-workbench-diff.js";
import { sourceProjectFixture } from "./source-project.fixture.js";

function authority() {
  return createCanonicalWorkbenchAuthority({
    documentId: canvasWorkbenchFixture.document.id,
    projectId: canvasWorkbenchFixture.id,
    scene: createSceneState(canvasWorkbenchFixture),
  });
}

describe("canonical workbench authority", () => {
  it("creates a human root node as one direct canonical operation", () => {
    const store = authority();
    const node: WorkbenchNode = {
      hidden: false,
      id: "direct-canonical-rectangle",
      kind: "Rectangle",
      locked: false,
      name: "Rectangle 1",
      parentId: null,
      position: { x: 240, y: 180 },
      size: { height: 120, width: 160 },
    };

    const result = store.createRootNode({
      actor: "human",
      label: "Create Rectangle 1",
      node,
    });

    expect(result.trace).toMatchObject({
      actor: "human",
      label: "Create Rectangle 1",
      targetIds: [node.id],
    });
    expect(
      store.getSnapshot().nodes.find(({ id }) => id === node.id),
    ).toMatchObject(node);
    expect(store.getSnapshot().selection.selectedIds).toEqual([node.id]);
    const entry = store.getSnapshot().history.past.at(-1);
    expect(entry?.operation.type).toBe("node.create");
    expect(entry?.operation.type).not.toBe("atomic.batch");

    expect(store.undo()?.trace.label).toBe("Undo Create Rectangle 1");
    expect(store.getSnapshot().nodes).not.toContainEqual(node);

    expect(() =>
      store.createRootNode({
        actor: "human",
        label: "Create Rectangle 1",
        node,
      }),
    ).not.toThrow();
    expect(
      store.getSnapshot().nodes.find(({ id }) => id === node.id),
    ).toMatchObject(node);
  });

  it("exposes a V2 document and operation-only history", () => {
    const store = authority();
    const initial = store.getSnapshot();
    const selected = initial.nodes[0];
    expect(selected).toBeDefined();

    const nodes = initial.nodes.map((node) =>
      node.id === selected?.id
        ? {
            ...node,
            position: { x: node.position.x + 24, y: node.position.y + 12 },
          }
        : node,
    );
    const result = store.commit({
      actor: "human",
      label: "Move selection",
      nodes,
      selection: createSelectionState(selected ? [selected.id] : []),
      targetIds: selected ? [selected.id] : [],
    });

    expect(result.trace.result).toBe("applied");
    expect(store.getSnapshot().document.schemaVersion).toBe(2);
    expect(store.getSnapshot().nodes.find(({ id }) => id === selected?.id))
      .toMatchObject({
        position: {
          x: (selected?.position.x ?? 0) + 24,
          y: (selected?.position.y ?? 0) + 12,
        },
      });
    const entry = store.getSnapshot().history.past[0];
    expect(entry).toBeDefined();
    expect(entry).toHaveProperty("operation");
    expect(entry).not.toHaveProperty("before");
    expect(entry).not.toHaveProperty("after");
  });

  it("commits projection intents as one narrow canonical operation batch", () => {
    const store = authority();
    const initial = store.getSnapshot();
    const selected = initial.nodes[0];
    expect(selected).toBeDefined();
    if (selected === undefined) {
      return;
    }
    const desired = initial.nodes.map((node) =>
      node.id === selected.id
        ? {
            ...node,
            position: { x: node.position.x + 36, y: node.position.y + 18 },
            size: { ...node.size, width: node.size.width + 80 },
          }
        : node,
    );

    const result = store.commitActions({
      actions: diffWorkbenchProjections(initial.nodes, desired),
      actor: "human",
      label: "Transform selection",
      selection: createSelectionState([selected.id]),
      targetIds: [selected.id],
    });

    expect(result.trace).toMatchObject({
      afterRevision: initial.revision + 1,
      beforeRevision: initial.revision,
      label: "Transform selection",
      targetIds: [selected.id],
    });
    expect(store.getSnapshot().nodes.find(({ id }) => id === selected.id))
      .toMatchObject({
        position: {
          x: selected.position.x + 36,
          y: selected.position.y + 18,
        },
        size: { width: selected.size.width + 80 },
      });
    const operation = store.getSnapshot().history.past.at(-1)?.operation;
    expect(operation?.type).toBe("atomic.batch");
    if (operation?.type !== "atomic.batch") {
      return;
    }
    expect(operation.payload.actions.map(({ type }) => type)).toEqual([
      "node.transform",
      "node.geometry",
    ]);
    expect(store.undo()?.trace.label).toBe("Undo Transform selection");
    expect(store.getSnapshot().nodes.find(({ id }) => id === selected.id))
      .toMatchObject({
        position: selected.position,
        size: selected.size,
      });
  });

  it("owns selection and restores it with operation inversion", () => {
    const store = authority();
    const [first, second] = store.getSnapshot().nodes;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    store.setSelection(
      createSelectionState(first === undefined ? [] : [first.id]),
    );
    const nodes = store.getSnapshot().nodes.map((node) =>
      node.id === first?.id
        ? { ...node, size: { ...node.size, width: node.size.width + 40 } }
        : node,
    );
    store.commit({
      actor: "human",
      label: "Resize selection",
      nodes,
      selection: createSelectionState(second === undefined ? [] : [second.id]),
      targetIds: first === undefined ? [] : [first.id],
    });

    const undo = store.undo();
    expect(undo?.trace.label).toBe("Undo Resize selection");
    expect(store.getSnapshot().selection.selectedIds).toEqual(
      first === undefined ? [] : [first.id],
    );
    const redo = store.redo();
    expect(redo?.trace.label).toBe("Resize selection");
    expect(store.getSnapshot().selection.selectedIds).toEqual(
      second === undefined ? [] : [second.id],
    );
  });

  it("keeps uncommitted duplicate selection transient and ignores no-op history", () => {
    const store = authority();
    const initial = store.getSnapshot();
    store.setSelection(createSelectionState(["uncommitted-preview-node"]));
    expect(store.getSnapshot().selection.selectedIds).toEqual([
      "uncommitted-preview-node",
    ]);
    expect(store.getSnapshot().history.past).toHaveLength(0);

    const result = store.commit({
      actor: "human",
      label: "No movement",
      nodes: initial.nodes,
      selection: initial.selection,
      targetIds: initial.selection.selectedIds,
    });
    expect(result.trace).toMatchObject({
      afterRevision: initial.revision,
      beforeRevision: initial.revision,
    });
    expect(store.getSnapshot().history.past).toHaveLength(0);
    expect(store.getSnapshot().selection).toEqual(initial.selection);
  });

  it("keeps legacy identity and detach metadata in the validated projection", () => {
    const store = authority();
    const source = store.getSnapshot().nodes.find(
      (node) => node.kind === "CodeFrame",
    );
    expect(source?.source).toBeDefined();
    if (source === undefined) {
      return;
    }
    const detached = store.getSnapshot().nodes.map((node) => {
      if (node.id !== source.id || node.source === undefined) {
        return node;
      }
      const { source: binding, ...withoutSource } = node;
      const { viewport: _viewport, ...provenance } = binding;
      return {
        ...withoutSource,
        kind: "DraftFrame" as const,
        frameContent: node.name,
        provenance,
      };
    });
    store.commit({
      actor: "human",
      label: `Detach ${source.name}`,
      nodes: detached,
      selection: createSelectionState([source.id]),
      targetIds: [source.id],
    });

    const projected = store.getSnapshot().nodes.find(
      (node) => node.id === source.id,
    );
    expect(projected).toMatchObject({
      frameContent: source.name,
      kind: "DraftFrame",
    });
    expect(projected).not.toHaveProperty("source");
    store.undo();
    expect(
      store.getSnapshot().nodes.find((node) => node.id === source.id),
    ).toMatchObject({ kind: "CodeFrame", source: source.source });
  });

  it("projects metadata edits and undo directly from canonical fields", () => {
    const store = authority();
    const draft = store.getSnapshot().nodes.find(
      (node) => node.kind === "DraftFrame",
    );
    expect(draft).toBeDefined();
    if (draft === undefined) {
      return;
    }
    store.commit({
      actor: "human",
      label: "Update draft metadata",
      nodes: store.getSnapshot().nodes.map((node) =>
        node.id === draft.id
          ? {
              ...node,
              frameContent: "Updated canonical content",
              name: "Updated canonical draft",
            }
          : node,
      ),
      selection: createSelectionState([draft.id]),
      targetIds: [draft.id],
    });
    const canonical = Object.values(
      store.getSnapshot().document.nodesById,
    ).find((node) => node.name === "Updated canonical draft");
    expect(canonical).toMatchObject({
      content: {
        type: "frame",
        value: "Updated canonical content",
      },
    });
    expect(store.getSnapshot().nodes.find(({ id }) => id === draft.id))
      .toMatchObject({
        frameContent: "Updated canonical content",
        name: "Updated canonical draft",
      });
    store.undo();
    expect(store.getSnapshot().nodes.find(({ id }) => id === draft.id))
      .toMatchObject({
        frameContent: "",
        name: draft.name,
      });
    expect(Object.keys(store.getSnapshot()).sort()).toEqual([
      "document",
      "history",
      "nodes",
      "revision",
      "selection",
    ]);
  });

  it("detaches component authority as one invertible canonical operation", () => {
    const componentProject = {
      ...canvasWorkbenchFixture,
      id: "component-authority-project",
      selectedNodeId: "component-master",
      document: {
        ...canvasWorkbenchFixture.document,
        id: "component-authority-document",
        nodes: [
          {
            id: "component-master",
            kind: "ComponentInstance" as const,
            name: "Primary button",
            parentId: null,
            position: { x: 20, y: 20 },
            size: { width: 160, height: 44 },
            locked: false,
            hidden: false,
            component: {
              atomicLevel: "atom" as const,
              classification: "master" as const,
              componentId: "primary-button",
              componentName: "Primary button",
              editable: {
                icon: false,
                label: true,
                selected: false,
                variant: true,
              },
              props: { label: "Continue" },
              role: "button" as const,
              source: {
                repositoryRevision: "buzzr@abc123",
                sourceAnchor: "components/Button.tsx#Button",
              },
            },
          },
        ],
      },
    };
    const store = createCanonicalWorkbenchAuthority({
      documentId: componentProject.document.id,
      projectId: componentProject.id,
      scene: createSceneState(componentProject),
    });
    const component = store.getSnapshot().nodes[0];
    expect(component?.component).toBeDefined();
    if (component === undefined) {
      return;
    }
    const { component: _binding, ...detached } = component;
    store.commit({
      actor: "human",
      label: "Detach Primary button",
      nodes: [
        {
          ...detached,
          frameContent: component.name,
          kind: "DraftFrame",
          provenance: {
            repositoryRevision: "buzzr@abc123",
            sourceAnchor: "components/Button.tsx#Button",
            routeId: null,
            stateId: null,
            coverageCellId: null,
          },
        },
      ],
      selection: createSelectionState([component.id]),
      targetIds: [component.id],
    });
    expect(store.getSnapshot().nodes[0]).toMatchObject({
      kind: "DraftFrame",
      provenance: {
        repositoryRevision: "buzzr@abc123",
      },
    });
    expect(store.getSnapshot().nodes[0]).not.toHaveProperty("component");
    const operation = store.getSnapshot().history.past[0]?.operation;
    expect(operation?.type).toBe("atomic.batch");
    if (operation?.type !== "atomic.batch") {
      return;
    }
    expect(operation.payload.actions[0]?.type).toBe("node.detach");
    expect(store.undo()?.trace.label).toBe("Undo Detach Primary button");
    expect(store.getSnapshot().nodes[0]).toMatchObject({
      kind: "Component",
      component: { classification: "master" },
    });
  });

  it("round-trips real source-backed mobile source screens from canonical state only", () => {
    const store = createCanonicalWorkbenchAuthority({
      documentId: sourceProjectFixture.document.id,
      projectId: sourceProjectFixture.id,
      scene: createSceneState(sourceProjectFixture),
    });
    const screen = store.getSnapshot().nodes.find(
      (node) =>
        node.id === "northstar-home",
    );
    expect(screen).toMatchObject({
      kind: "CodeFrame",
      source: {
        captureState: "captured",
        viewport: { name: "mobile" },
      },
    });
    const canonicalId =
      store.getSnapshot().document.rootIds.find(
        (id) =>
          store.getSnapshot().document.nodesById[id]?.name === screen?.name,
      );
    expect(
      canonicalId === undefined
        ? undefined
        : store.getSnapshot().document.nodesById[canonicalId],
    ).toMatchObject({
      kind: "imported-source-frame",
      sourceBinding: { captureState: "captured" },
    });
  });

  it("creates and selects an instance duplicated from a canonical master", () => {
    const store = createCanonicalWorkbenchAuthority({
      documentId: sourceProjectFixture.document.id,
      projectId: sourceProjectFixture.id,
      scene: createSceneState(sourceProjectFixture),
    });
    const master = store.getSnapshot().nodes.find(
      (node) => node.component?.classification === "master",
    );
    expect(master).toBeDefined();
    if (master === undefined) {
      return;
    }
    const copy = {
      ...componentDuplicateBase(master),
      id: `${master.id}-copy-test`,
      name: `${master.name} copy`,
      position: { x: master.position.x + 16, y: master.position.y + 16 },
    };
    expect(copy.component).toMatchObject({
      classification: "instance",
      componentId: master.component?.componentId,
      masterId: master.id,
    });
    store.commit({
      actor: "human",
      label: `Duplicate ${master.name}`,
      nodes: [...store.getSnapshot().nodes, copy],
      selection: createSelectionState([copy.id]),
      targetIds: [copy.id],
    });
    expect(store.getSnapshot().selection.selectedIds).toEqual([copy.id]);
    expect(
      store.getSnapshot().nodes.find((node) => node.id === copy.id),
    ).toMatchObject({
      kind: "ComponentInstance",
      component: {
        classification: "instance",
        masterId: master.id,
      },
    });
  });

  it("projects route placeholders from canonical capture state", () => {
    const source = canvasWorkbenchFixture.document.nodes[0];
    expect(source).toBeDefined();
    if (source === undefined) {
      return;
    }
    const placeholderProject = {
      ...canvasWorkbenchFixture,
      id: "route-placeholder-project",
      selectedNodeId: "route-placeholder",
      document: {
        ...canvasWorkbenchFixture.document,
        id: "route-placeholder-document",
        nodes: [
          {
            ...source,
            id: "route-placeholder",
            kind: "RoutePlaceholder" as const,
            name: "Pending route",
          },
        ],
      },
    };
    const store = createCanonicalWorkbenchAuthority({
      documentId: placeholderProject.document.id,
      projectId: placeholderProject.id,
      scene: createSceneState(placeholderProject),
    });
    expect(store.getSnapshot().nodes[0]).toMatchObject({
      kind: "RoutePlaceholder",
      source: { captureState: "placeholder" },
    });
    expect(
      Object.values(store.getSnapshot().document.nodesById)[0],
    ).toMatchObject({
      kind: "imported-source-frame",
      sourceBinding: { captureState: "placeholder" },
    });
  });

  it("continues revisions after archived legacy history without replaying snapshots", () => {
    const scene = createSceneState(canvasWorkbenchFixture);
    const recovered = {
      ...scene,
      past: [
        {
          after: scene.nodes,
          afterRevision: 8,
          afterSelectedNodeId: scene.selectedNodeId,
          before: scene.nodes,
          beforeRevision: 7,
          beforeSelectedNodeId: scene.selectedNodeId,
          id: 1,
          label: "Archived edit",
        },
      ],
      nextHistoryId: 2,
      revision: 8,
    };
    const store = createCanonicalWorkbenchAuthority({
      documentId: canvasWorkbenchFixture.document.id,
      projectId: canvasWorkbenchFixture.id,
      scene: recovered,
    });
    const selected = store.getSnapshot().nodes.find(
      ({ id }) => id === recovered.selectedNodeId,
    );
    expect(selected).toBeDefined();
    store.commit({
      actor: "human",
      label: "Move recovered selection",
      nodes: store.getSnapshot().nodes.map((node) =>
        node.id === selected?.id
          ? { ...node, position: { ...node.position, x: 999 } }
          : node,
      ),
      selection: store.getSnapshot().selection,
      targetIds: selected === undefined ? [] : [selected.id],
    });
    expect(store.getSnapshot().revision).toBe(9);
    expect(store.undo()?.trace).toMatchObject({
      beforeRevision: 9,
      afterRevision: 10,
    });
    expect(store.getSnapshot().revision).toBe(10);
    expect(store.redo()?.trace).toMatchObject({
      beforeRevision: 10,
      afterRevision: 11,
    });
    expect(store.getSnapshot().revision).toBe(11);
  });
});
