import { beforeEach, describe, expect, it } from "vitest";

import { sourceProjectFixture } from "./source-project.fixture.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import {
  createSelectionState,
  createSceneState,
  provenanceFromSource,
  replaceNode,
  sceneReducer,
  type SceneState,
} from "./model.js";
import { createCanonicalWorkbenchAuthority } from "./canonical-workbench-authority.js";
import { createRepositoryCanvasProject } from "../imports/repository/repository-workbench.js";
import {
  CANVAS_AUTOSAVE_MAX_BYTES,
  CANVAS_AUTOSAVE_MAX_HISTORY_ENTRIES,
  CANVAS_AUTOSAVE_MAX_TRACE_ENTRIES,
  canvasAutosaveKey,
  createCanvasAutosave,
} from "./persistence.js";

function editedScene(): SceneState {
  const initial = createSceneState(canvasWorkbenchFixture);
  return sceneReducer(initial, {
    type: "commit",
    label: "Move Dashboard desktop",
    nodes: replaceNode(
      initial.nodes,
      "node-dashboard-desktop",
      (node) => ({
        ...node,
        position: { ...node.position, x: 424 },
      }),
    ),
    selectedNodeId: "node-campaign-card",
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe("canvas local autosave boundary", () => {
  it("round-trips a self-contained pasted PNG without promoting it to runtime evidence", () => {
    const project = {
      ...canvasWorkbenchFixture,
      document: {
        ...canvasWorkbenchFixture.document,
        id: "document-pasted-image",
        nodes: [
          ...canvasWorkbenchFixture.document.nodes,
          {
            hidden: false,
            id: "pasted-image",
            image: {
              alt: "Pasted image",
              byteLength: 70,
              height: 1,
              mimeType: "image/png" as const,
              src:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/9Q9AiAAAAABJRU5ErkJggg==",
              width: 1,
            },
            kind: "Image" as const,
            locked: false,
            name: "Pasted image",
            parentId: null,
            position: { x: 24, y: 24 },
            size: { height: 1, width: 1 },
          },
        ],
      },
    };
    const autosave = createCanvasAutosave(localStorage);

    expect(
      autosave.save(project, createSceneState(project), project.trace),
    ).toBe(true);
    expect(
      autosave.load(project)?.scene.nodes.find(({ id }) => id === "pasted-image"),
    ).toMatchObject({
      image: {
        alt: "Pasted image",
        mimeType: "image/png",
        src: expect.stringMatching(/^data:image\/png;base64,/u),
      },
      kind: "Image",
    });
  });

  it("persists authenticated native capture artifact URLs", () => {
    const project = {
      ...canvasWorkbenchFixture,
      document: {
        ...canvasWorkbenchFixture.document,
        id: "document-native-capture",
        nodes: [
          ...canvasWorkbenchFixture.document.nodes,
          {
            id: "native-capture",
            kind: "ReferenceFrame" as const,
            name: "Native capture",
            parentId: null,
            position: { x: 0, y: 0 },
            size: { width: 390, height: 844 },
            locked: true,
            hidden: false,
            reference: {
              alt: "Verified native runtime capture",
              appVersion: "a1b2c3d4",
              authority: "local-runtime-capture",
              capturedAt: "2026-07-29T12:00:00.000Z",
              sourceUrl: "memi-source://repository/app/index.tsx",
              src:
                "memi-artifact://localhost/art_01J00000000000000000000000",
            },
          },
        ],
      },
    };
    const autosave = createCanvasAutosave(localStorage);

    expect(
      autosave.save(
        project,
        createSceneState(project),
        project.trace,
      ),
    ).toBe(true);
    expect(autosave.load(project)).not.toBeNull();
  });

  it("round-trips nodes, selection, revision, semantic history, and trace per document", () => {
    const autosave = createCanvasAutosave(localStorage);
    const scene = editedScene();
    const trace = [
      ...canvasWorkbenchFixture.trace,
      {
        id: "trace-local-edit",
        action: "Moved Dashboard desktop",
        targetNodeId: "node-dashboard-desktop",
      },
    ];

    expect(
      autosave.save(canvasWorkbenchFixture, scene, trace),
    ).toBe(true);
    expect(autosave.load(canvasWorkbenchFixture)).toEqual({
      scene,
      trace,
    });
    expect(
      autosave.load({
        ...canvasWorkbenchFixture,
        document: {
          ...canvasWorkbenchFixture.document,
          id: "document-other",
        },
      }),
    ).toBeNull();
    expect(localStorage.length).toBe(1);

    const recovered = autosave.load(canvasWorkbenchFixture);
    expect(recovered?.scene).not.toBe(scene);
    expect(recovered?.scene.nodes).not.toBe(scene.nodes);
  });

  it("recovers canonical drafts without rewriting repository placeholder authority", () => {
    const project = createRepositoryCanvasProject(
      {
        schemaVersion: 1,
        projectName: "Northstar",
        rootPath: "/Projects/northstar",
        revision: "a1b2c3d4",
        platform: "react-web",
        dirty: false,
        files: [],
        screens: [
          {
            id: "home",
            name: "Home",
            sourcePath: "src/Home.tsx",
            route: "/",
          },
        ],
        components: [
          {
            id: "primary-button",
            name: "Primary button",
            sourcePath: "src/PrimaryButton.tsx",
          },
        ],
        tokens: [],
      },
      "northstar-import",
      "codex",
    );
    const initial = createSceneState(project);
    const authority = createCanonicalWorkbenchAuthority({
      documentId: project.document.id,
      projectId: project.id,
      scene: initial,
    });
    const rectangle = {
      id: "node-rectangle-1",
      kind: "Rectangle" as const,
      name: "Rectangle 1",
      parentId: null,
      position: { x: 100, y: 100 },
      size: { width: 160, height: 120 },
      locked: false,
      hidden: false,
      fill: "#ff5470",
    };
    authority.commit({
      actor: "human",
      label: "Create Rectangle 1",
      nodes: [...authority.getSnapshot().nodes, rectangle],
      selection: createSelectionState([rectangle.id]),
      targetIds: [rectangle.id],
    });
    const snapshot = authority.getSnapshot();
    const scene: SceneState = {
      ...initial,
      nodes: snapshot.nodes,
      revision: snapshot.revision,
      selectedNodeId: rectangle.id,
    };
    const autosave = createCanvasAutosave(localStorage);

    expect(autosave.save(project, scene, [])).toBe(true);
    expect(autosave.load(project)?.scene.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: rectangle.id,
          fill: "#ff5470",
        }),
      ]),
    );
  });

  it("retains only bounded recent semantic history and trace entries", () => {
    const autosave = createCanvasAutosave(localStorage);
    let scene = createSceneState(canvasWorkbenchFixture);
    for (
      let index = 0;
      index < CANVAS_AUTOSAVE_MAX_HISTORY_ENTRIES + 5;
      index += 1
    ) {
      scene = sceneReducer(scene, {
        type: "commit",
        label: `Move ${index}`,
        nodes: replaceNode(
          scene.nodes,
          "node-dashboard-desktop",
          (node) => ({
            ...node,
            position: { ...node.position, x: 200 + index },
          }),
        ),
      });
    }
    const trace = Array.from(
      { length: CANVAS_AUTOSAVE_MAX_TRACE_ENTRIES + 5 },
      (_value, index) => ({
        id: `trace-${index}`,
        action: `Action ${index}`,
        targetNodeId: "node-dashboard-desktop",
      }),
    );

    expect(
      autosave.save(canvasWorkbenchFixture, scene, trace),
    ).toBe(true);
    const recovered = autosave.load(canvasWorkbenchFixture);

    expect(recovered?.scene.past).toHaveLength(
      CANVAS_AUTOSAVE_MAX_HISTORY_ENTRIES,
    );
    expect(recovered?.scene.past[0]?.label).toBe("Move 5");
    expect(recovered?.trace).toHaveLength(
      CANVAS_AUTOSAVE_MAX_TRACE_ENTRIES,
    );
    expect(recovered?.trace[0]?.id).toBe("trace-5");
    expect(
      new TextEncoder().encode(
        localStorage.getItem(
          canvasAutosaveKey(canvasWorkbenchFixture.document.id),
        ) ?? "",
      ).byteLength,
    ).toBeLessThanOrEqual(CANVAS_AUTOSAVE_MAX_BYTES);
  });

  it("round-trips source-backed component instances without losing authority metadata", () => {
    const autosave = createCanvasAutosave(localStorage);
    const scene = createSceneState(sourceProjectFixture);
    const movedScene = sceneReducer(scene, {
      type: "commit",
      label: "Move source button",
      nodes: replaceNode(
        scene.nodes,
        "northstar-button-primary-master",
        (node) =>
          node.component === undefined
            ? node
            : {
                ...node,
                position: { ...node.position, x: 1_420 },
                component: {
                  ...node.component,
                  props: {
                    ...node.component.props,
                    label: "Launch",
                  },
                  variant: "secondary",
                },
              },
      ),
      selectedNodeId: "northstar-button-primary-master",
    });
    const trace = [
      ...sourceProjectFixture.trace,
      {
        id: "trace-component-edit",
        action: "Edited source button",
        targetNodeId: "northstar-button-primary-master",
      },
    ];

    expect(autosave.save(sourceProjectFixture, movedScene, trace)).toBe(true);
    const recovered = autosave.load(sourceProjectFixture);

    expect(recovered?.scene.selectedNodeId).toBe(
      "northstar-button-primary-master",
    );
    expect(
      recovered?.scene.nodes.find(
        (node) => node.id === "northstar-button-primary-master",
      ),
    ).toMatchObject({
      kind: "Component",
      component: {
        componentId: "northstar.button.primary",
        classification: "master",
        props: {
          label: "Launch",
        },
        source: {
          sourceAnchor: "src/components/Button.tsx",
        },
        variant: "secondary",
      },
    });
  });

  it("recovers editable canonical component values without weakening source identity", () => {
    const authority = createCanonicalWorkbenchAuthority({
      documentId: sourceProjectFixture.document.id,
      projectId: sourceProjectFixture.id,
      scene: createSceneState(sourceProjectFixture),
    });
    const master = authority
      .getSnapshot()
      .nodes.find(({ id }) => id === "northstar-button-primary-master");
    expect(master?.component).toBeDefined();
    if (master?.component === undefined) {
      return;
    }
    authority.commit({
      actor: "human",
      label: "Edit primary button",
      nodes: replaceNode(
        authority.getSnapshot().nodes,
        master.id,
        (node) =>
          node.component === undefined
            ? node
            : {
                ...node,
                fill: "#34D399",
                component: {
                  ...node.component,
                  props: {
                    ...node.component.props,
                    label: "Launch now",
                  },
                },
              },
      ),
      selection: createSelectionState([master.id]),
      targetIds: [master.id],
    });
    const snapshot = authority.getSnapshot();
    const scene: SceneState = {
      future: [],
      nextHistoryId: 2,
      nodes: snapshot.nodes,
      past: [],
      revision: snapshot.revision,
      selectedNodeId: master.id,
    };
    const storage = new Map<string, string>();
    const autosave = createCanvasAutosave({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    });

    expect(autosave.save(sourceProjectFixture, scene, [])).toBe(true);
    expect(
      autosave
        .load(sourceProjectFixture)
        ?.scene.nodes.find(({ id }) => id === master.id),
    ).toMatchObject({
      fill: "#34D399",
      component: {
        props: { label: "Launch now" },
        source: master.component.source,
      },
    });
  });

  it("rejects recovered component masters that forge semantic identity", () => {
    const autosave = createCanvasAutosave(localStorage);
    const scene = createSceneState(sourceProjectFixture);
    const key = canvasAutosaveKey(sourceProjectFixture.document.id);

    expect(autosave.save(sourceProjectFixture, scene, [])).toBe(true);
    const serialized = localStorage.getItem(key);
    expect(serialized).not.toBeNull();
    const record = JSON.parse(serialized ?? "{}") as {
      readonly scene: {
        readonly nodes: readonly {
          readonly component?: {
            readonly classification: string;
            readonly componentId: string;
          };
          readonly id: string;
        }[];
      };
    };
    localStorage.setItem(
      key,
      JSON.stringify({
        ...record,
        scene: {
          ...record.scene,
          nodes: record.scene.nodes.map((node) =>
            node.id === "northstar-button-primary-master" &&
            node.component?.classification === "master"
              ? {
                  ...node,
                  component: {
                    ...node.component,
                    componentId: "forged.card",
                  },
                }
              : node,
          ),
        },
      }),
    );

    expect(autosave.load(sourceProjectFixture)).toBeNull();
  });

  it("rejects malformed, wrong-version, wrong-document, and oversized records", () => {
    const autosave = createCanvasAutosave(localStorage);
    const key = canvasAutosaveKey(canvasWorkbenchFixture.document.id);
    const invalidRecords = [
      "{not-json",
      JSON.stringify({ schemaVersion: 2 }),
      JSON.stringify({
        schemaVersion: 1,
        kind: "memi-canvas-autosave",
        documentId: "document-other",
        scene: editedScene(),
        trace: [],
      }),
      "x".repeat(CANVAS_AUTOSAVE_MAX_BYTES + 1),
    ];

    for (const record of invalidRecords) {
      localStorage.setItem(key, record);
      expect(autosave.load(canvasWorkbenchFixture)).toBeNull();
    }
  });

  it("rejects stale imports and recovered nodes that forge source authority", () => {
    const autosave = createCanvasAutosave(localStorage);
    const scene = editedScene();
    const key = canvasAutosaveKey(canvasWorkbenchFixture.document.id);

    expect(
      autosave.save(canvasWorkbenchFixture, scene, []),
    ).toBe(true);
    const serialized = localStorage.getItem(key);
    expect(serialized).not.toBeNull();
    const record = JSON.parse(serialized ?? "{}") as {
      readonly scene: {
        readonly nodes: readonly {
          readonly id: string;
          readonly source?: {
            readonly sourceAnchor: string;
          };
        }[];
      };
    };
    const forged = {
      ...record,
      scene: {
        ...record.scene,
        nodes: record.scene.nodes.map((node) =>
          node.id === "node-dashboard-desktop" && node.source !== undefined
            ? {
                ...node,
                source: {
                  ...node.source,
                  sourceAnchor: "src/forged.tsx:1",
                },
              }
            : node,
        ),
      },
    };
    localStorage.setItem(key, JSON.stringify(forged));
    expect(autosave.load(canvasWorkbenchFixture)).toBeNull();

    expect(
      autosave.save(canvasWorkbenchFixture, scene, []),
    ).toBe(true);
    expect(
      autosave.load({
        ...canvasWorkbenchFixture,
        document: {
          ...canvasWorkbenchFixture.document,
          revision: canvasWorkbenchFixture.document.revision + 1,
        },
      }),
    ).toBeNull();
  });

  it("rejects detached drafts with partially forged source provenance", () => {
    const autosave = createCanvasAutosave(localStorage);
    const initial = createSceneState(canvasWorkbenchFixture);
    const detachedScene: SceneState = {
      ...initial,
      nodes: replaceNode(
        initial.nodes,
        "node-dashboard-desktop",
        (node) => {
          if (node.source === undefined) {
            return node;
          }
          const { source, ...detached } = node;
          return {
            ...detached,
            kind: "DraftFrame",
            provenance: provenanceFromSource(source),
          };
        },
      ),
    };
    const key = canvasAutosaveKey(canvasWorkbenchFixture.document.id);

    expect(
      autosave.save(canvasWorkbenchFixture, detachedScene, []),
    ).toBe(true);
    const serialized = localStorage.getItem(key);
    expect(serialized).not.toBeNull();
    const record = JSON.parse(serialized ?? "{}") as {
      readonly scene: {
        readonly nodes: readonly {
          readonly id: string;
          readonly provenance?: {
            readonly routeId: string;
          };
        }[];
      };
    };
    localStorage.setItem(
      key,
      JSON.stringify({
        ...record,
        scene: {
          ...record.scene,
          nodes: record.scene.nodes.map((node) =>
            node.id === "node-dashboard-desktop" &&
            node.provenance !== undefined
              ? {
                  ...node,
                  provenance: {
                    ...node.provenance,
                    routeId: "route-forged",
                  },
                }
              : node,
          ),
        },
      }),
    );

    expect(autosave.load(canvasWorkbenchFixture)).toBeNull();
  });

  it("refuses an oversized current scene and fails closed on storage errors", () => {
    const scene = editedScene();
    const oversizedScene: SceneState = {
      ...scene,
      nodes: scene.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              frameContent: "x".repeat(CANVAS_AUTOSAVE_MAX_BYTES),
            }
          : node,
      ),
    };
    const autosave = createCanvasAutosave(localStorage);

    expect(
      autosave.save(
        canvasWorkbenchFixture,
        oversizedScene,
        [],
      ),
    ).toBe(false);
    expect(localStorage.length).toBe(0);

    const unavailableStorage = {
      getItem(): string | null {
        throw new Error("storage unavailable");
      },
      setItem(): void {
        throw new Error("storage unavailable");
      },
    };
    const unavailableAutosave = createCanvasAutosave(unavailableStorage);
    expect(
      unavailableAutosave.save(
        canvasWorkbenchFixture,
        scene,
        [],
      ),
    ).toBe(false);
    expect(
      unavailableAutosave.load(canvasWorkbenchFixture),
    ).toBeNull();
  });
});
