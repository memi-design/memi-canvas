import {
  CanvasDocumentV2Schema,
  LegacyCanvasIdMappingReceiptV2Schema,
} from "@memi/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  LEGACY_CANVAS_MAX_BYTES,
  migrateLegacyCanvasState,
  readLegacyCanvasState,
  type LegacyCanvasStorage,
} from "./canvas-state-migration.js";
import { createSceneState } from "./model.js";
import { sourceProjectFixture } from "./source-project.fixture.js";

function legacyNode(
  id: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    hidden: false,
    id,
    kind: "Rectangle",
    locked: false,
    name: id,
    parentId: null,
    position: { x: 100, y: 200 },
    size: { height: 100, width: 100 },
    ...overrides,
  };
}

function legacyScene(nodes: readonly Readonly<Record<string, unknown>>[]) {
  return {
    future: [],
    nextHistoryId: 1,
    nodes,
    past: [],
    revision: 7,
    selectedNodeId: nodes[0]?.id ?? null,
  };
}

const migrationOptions = {
  legacyDocumentId: "buzzr-canvas",
  legacyProjectId: "buzzr-project",
} as const;

describe("legacy canvas migration", () => {
  it("normalizes SceneState into canonical protocol V2 with mapping receipts", () => {
    const parent = legacyNode("parent", {
      fill: "#121212",
      kind: "Frame",
      source: {
        coverageCellId: "cell-1",
        repositoryRevision: "abc123",
        routeId: "route-1",
        sourceAnchor: "components/Card.tsx#Card",
        stateId: "default",
        viewport: { height: 844, name: "mobile", width: 390 },
      },
    });
    const child = legacyNode("child", {
      kind: "Text",
      parentId: "parent",
      position: { x: 140, y: 260 },
      text: "Hello",
    });
    const input = {
      ...legacyScene([parent, child]),
      nextHistoryId: 2,
      past: [
        {
          after: [parent, child],
          afterRevision: 7,
          afterSelectedNodeId: "parent",
          before: [parent],
          beforeRevision: 6,
          beforeSelectedNodeId: "parent",
          id: 1,
          label: "Legacy edit",
        },
      ],
    };

    const result = migrateLegacyCanvasState(input, migrationOptions);

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(CanvasDocumentV2Schema.safeParse(result.document).success).toBe(true);
    expect(result.document.schemaVersion).toBe(2);
    expect(result.document.id).toMatch(/^doc_/u);
    expect(result.document.projectId).toMatch(/^prj_/u);
    const parentId = result.receipt.nodeIds.parent;
    const childId = result.receipt.nodeIds.child;
    if (parentId === undefined || childId === undefined) {
      throw new Error("Expected migrated parent and child mappings.");
    }
    expect(result.document.rootIds).toEqual([parentId]);
    expect(result.document.nodesById[parentId]).toMatchObject({
      childIds: [childId],
      kind: "imported-source-frame",
      sourceBinding: {
        captureState: "captured",
        repositoryRevision: "abc123",
      },
      style: { fills: [{ color: "#121212", type: "solid" }] },
    });
    expect(result.document.nodesById[childId]).toMatchObject({
      parentId,
      text: { characters: "Hello" },
      transform: { x: 40, y: 60 },
    });
    expect(result.selection.selectedIds).toEqual([parentId]);
    expect(result.receipt).toMatchObject({
      historyArchive: {
        future: [],
        nextHistoryId: 2,
        past: [expect.objectContaining({ id: 1, label: "Legacy edit" })],
        status: "preserved-unreplayed",
      },
      legacyDocumentId: "buzzr-canvas",
      legacyProjectId: "buzzr-project",
      legacyRevision: 7,
      migratedNodeCount: 2,
      preservedFutureEntries: 0,
      preservedPastEntries: 1,
      sourceKind: "scene-state",
    });
    expect(
      result.receipt.idMappings.every(
        (mapping) =>
          LegacyCanvasIdMappingReceiptV2Schema.safeParse(mapping).success,
      ),
    ).toBe(true);
    expect(result.receipt.legacyMetadataByNodeId[parentId]).toMatchObject({
      source: { repositoryRevision: "abc123" },
    });
  });

  it("is deterministic across repeated migrations including operation IDs", () => {
    const input = legacyScene([
      legacyNode("parent", { kind: "Frame" }),
      legacyNode("child", { parentId: "parent" }),
    ]);

    const first = migrateLegacyCanvasState(input, migrationOptions);
    const second = migrateLegacyCanvasState(input, migrationOptions);

    expect(first).toEqual(second);
  });

  it("retains source authority for the real source-backed mobile CodeFrame", () => {
    const screen = sourceProjectFixture.document.nodes.find(
      (node) =>
        node.id === "northstar-home" &&
        node.kind === "CodeFrame" &&
        node.source?.sourceAnchor ===
          "src/pages/Home.tsx",
    );
    expect(screen).toMatchObject({
      source: {
        repositoryRevision:
          "northstar@abc123",
        sourceContentHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        viewport: {
          name: "mobile",
          width: 390,
          height: 844,
        },
      },
    });
    const result = migrateLegacyCanvasState(
      createSceneState(sourceProjectFixture),
      {
        legacyDocumentId: sourceProjectFixture.document.id,
        legacyProjectId: sourceProjectFixture.id,
      },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok || screen === undefined) {
      return;
    }
    const canonicalId = result.receipt.nodeIds[screen.id];
    expect(canonicalId).toBeDefined();
    expect(
      canonicalId === undefined
        ? undefined
        : result.document.nodesById[canonicalId],
    ).toMatchObject({
      kind: "imported-source-frame",
      sourceBinding: {
        captureState: "captured",
        sourceAnchor: screen.source?.sourceAnchor,
        viewport: { name: "mobile" },
      },
    });
  });

  it("migrates components and restores delayed root and child ordering", () => {
    const component = {
      atomicLevel: "atom",
      classification: "master",
      componentId: "button",
      componentName: "Button",
      editable: { icon: true, label: true, selected: false, variant: true },
      props: { label: "Continue" },
      role: "button",
      source: {
        repositoryRevision: "abc123",
        sourceAnchor: "components/Button.tsx#Button",
      },
    };
    const instance = {
      ...component,
      classification: "instance",
      masterId: "master",
      props: { label: "Start", selected: true },
    };
    const input = {
      ...legacyScene([
        legacyNode("root", { kind: "Frame" }),
        legacyNode("instance", {
          component: instance,
          kind: "ComponentInstance",
          parentId: "root",
        }),
        legacyNode("normal-child", { parentId: "root" }),
        legacyNode("root-instance", {
          component: instance,
          kind: "ComponentInstance",
        }),
        legacyNode("master", {
          component,
          fill: "#ff5470",
          kind: "ComponentInstance",
          provenance: { repositoryRevision: "abc123" },
          reference: { src: "/imports/button.png" },
          stroke: "#ffffff",
        }),
      ]),
      selectedNodeId: null,
    };

    const result = migrateLegacyCanvasState(input, migrationOptions);

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const { nodeIds } = result.receipt;
    const parent = nodeIds.root;
    const childInstance = nodeIds.instance;
    const normalChild = nodeIds["normal-child"];
    const rootInstance = nodeIds["root-instance"];
    const master = nodeIds.master;
    if (
      parent === undefined ||
      childInstance === undefined ||
      normalChild === undefined ||
      rootInstance === undefined ||
      master === undefined
    ) {
      throw new Error("Expected every component mapping.");
    }
    expect(result.document.rootIds).toEqual([parent, rootInstance, master]);
    expect(result.document.nodesById[parent]?.childIds).toEqual([
      childInstance,
      normalChild,
    ]);
    expect(result.document.nodesById[master]).toMatchObject({
      kind: "component",
      style: {
        fills: [{ color: "#ff5470", type: "solid" }],
        strokes: [{ color: "#ffffff", type: "solid" }],
      },
    });
    const canonicalInstance = result.document.nodesById[childInstance];
    expect(canonicalInstance).toMatchObject({
      instanceOverrides: { label: "Start", selected: true },
      kind: "instance",
    });
    expect(canonicalInstance?.componentId).toMatch(/^cmp_/u);
    expect(
      result.document.componentsById[canonicalInstance?.componentId ?? ""],
    ).toMatchObject({
      name: "Button",
      rootNodeId: master,
    });
    expect(result.selection.selectedIds).toEqual([]);
    expect(result.receipt.legacyMetadataByNodeId[master]).toMatchObject({
      component: { classification: "master" },
      provenance: { repositoryRevision: "abc123" },
      reference: { src: "/imports/button.png" },
    });
    expect(
      result.receipt.idMappings.filter(
        (mapping) => mapping.kind === "operation",
      ).length,
    ).toBeGreaterThan(input.nodes.length);
    const operationIds = result.receipt.idMappings
      .filter((mapping) => mapping.kind === "operation")
      .map((mapping) => mapping.canonicalId);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it("maps every legacy node family into the supported canonical vocabulary", () => {
    const kinds = [
      "CodeFrame",
      "RoutePlaceholder",
      "ReferenceFrame",
      "DraftFrame",
      "Text",
      "Rectangle",
      "Ellipse",
      "Line",
      "Arrow",
      "Vector",
      "Frame",
      "Group",
      "Section",
      "Slice",
      "Comment",
      "Component",
    ] as const;
    const nodes = kinds.map((kind, index) =>
      legacyNode(`${kind}-${index}`, {
        ...(kind === "Text" ? { text: "Label" } : {}),
        ...(kind === "RoutePlaceholder"
          ? {
              source: {
                coverageCellId: "route-placeholder-mobile",
                repositoryRevision: "abc123",
                routeId: "route-placeholder",
                sourceAnchor: "app/placeholder.tsx",
                stateId: "default",
                viewport: { height: 844, name: "mobile", width: 390 },
              },
            }
          : {}),
        kind,
      }),
    );

    const result = migrateLegacyCanvasState(
      { ...legacyScene(nodes), selectedNodeId: null },
      migrationOptions,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      Object.values(result.document.nodesById).map((item) => item.kind),
    ).toEqual([
      "imported-source-frame",
      "imported-source-frame",
      "imported-source-frame",
      "frame",
      "text",
      "rectangle",
      "ellipse",
      "line",
      "arrow",
      "vector",
      "frame",
      "group",
      "section",
      "section",
      "sticky",
      "component",
    ]);
    const routePlaceholderId = result.receipt.nodeIds["RoutePlaceholder-1"];
    expect(
      routePlaceholderId === undefined
        ? undefined
        : result.document.nodesById[routePlaceholderId]?.sourceBinding,
    ).toMatchObject({ captureState: "placeholder" });
  });

  it("preserves explicit placeholder authority on source-backed components", () => {
    const sourceBackedComponent = legacyNode("component-placeholder", {
      kind: "Component",
      source: {
        captureState: "placeholder",
        coverageCellId: "component-placeholder-mobile",
        repositoryRevision: "abc123",
        routeId: "component:button",
        sourceAnchor: "components/Button.tsx",
        stateId: "default",
        viewport: { height: 844, name: "mobile", width: 390 },
      },
    });

    const result = migrateLegacyCanvasState(
      legacyScene([sourceBackedComponent]),
      migrationOptions,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const componentId = result.receipt.nodeIds["component-placeholder"];
    expect(
      componentId === undefined
        ? undefined
        : result.document.nodesById[componentId]?.sourceBinding,
    ).toMatchObject({ captureState: "placeholder" });
  });

  it("accepts the localStorage autosave envelope and preserves its raw source", () => {
    const serialized = JSON.stringify({
      documentId: "buzzr-canvas",
      kind: "memi-canvas-autosave",
      schemaVersion: 1,
      scene: legacyScene([legacyNode("a")]),
      sourceFingerprint: "fnv1a64:0123456789abcdef",
      trace: [],
    });

    const result = migrateLegacyCanvasState(serialized, migrationOptions);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rawSource).toBe(serialized);
    expect(result.receipt.sourceKind).toBe("autosave-v1");
    const migratedId = result.receipt.nodeIds.a;
    if (migratedId === undefined) {
      throw new Error("Expected migrated node mapping.");
    }
    expect(result.document.nodesById[migratedId]).toBeDefined();
  });

  it.each([
    [
      "duplicate node identities",
      legacyScene([legacyNode("a"), legacyNode("a")]),
    ],
    [
      "dangling parents",
      legacyScene([legacyNode("a", { parentId: "missing" })]),
    ],
    [
      "missing selections",
      { ...legacyScene([legacyNode("a")]), selectedNodeId: "missing" },
    ],
    [
      "cyclic parents",
      legacyScene([
        legacyNode("a", { parentId: "b" }),
        legacyNode("b", { parentId: "a" }),
      ]),
    ],
  ])("rejects %s without producing a partial document", (_name, input) => {
    const result = migrateLegacyCanvasState(input, migrationOptions);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects the wrong autosave document and oversized serialized input", () => {
    const serialized = JSON.stringify({
      documentId: "other-document",
      kind: "memi-canvas-autosave",
      schemaVersion: 1,
      scene: legacyScene([legacyNode("a")]),
      sourceFingerprint: "fnv1a64:0123456789abcdef",
      trace: [],
    });

    expect(
      migrateLegacyCanvasState(serialized, migrationOptions),
    ).toMatchObject({ ok: false });
    expect(
      migrateLegacyCanvasState(
        "x".repeat(LEGACY_CANVAS_MAX_BYTES + 1),
        migrationOptions,
      ),
    ).toEqual({
      issues: [
        `Legacy canvas payload exceeds ${LEGACY_CANVAS_MAX_BYTES} bytes.`,
      ],
      ok: false,
    });
  });

  it("rejects malformed JSON, invalid options, cyclic data, and bad instances", () => {
    expect(
      migrateLegacyCanvasState("{", migrationOptions),
    ).toEqual({
      issues: ["Legacy canvas payload is not valid JSON."],
      ok: false,
    });
    expect(
      migrateLegacyCanvasState(legacyScene([]), {
        legacyDocumentId: "",
        legacyProjectId: "",
      }),
    ).toEqual({
      issues: ["Legacy project and document identities are required."],
      ok: false,
    });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(migrateLegacyCanvasState(cyclic, migrationOptions)).toEqual({
      issues: ["Legacy canvas state is not serializable JSON."],
      ok: false,
    });
    const badInstance = legacyNode("instance", {
      component: {
        classification: "instance",
        componentId: "button",
        masterId: "missing",
      },
      kind: "ComponentInstance",
    });
    expect(
      migrateLegacyCanvasState(
        legacyScene([badInstance]),
        migrationOptions,
      ),
    ).toMatchObject({ ok: false });
  });

  it("reads legacy storage without deleting or rewriting its source value", () => {
    const serialized = JSON.stringify({
      documentId: "buzzr-canvas",
      kind: "memi-canvas-autosave",
      schemaVersion: 1,
      scene: legacyScene([legacyNode("a")]),
      sourceFingerprint: "fnv1a64:0123456789abcdef",
      trace: [],
    });
    const values = new Map([["legacy-key", serialized]]);
    const storage: LegacyCanvasStorage = {
      getItem: vi.fn((key) => values.get(key) ?? null),
    };

    const result = readLegacyCanvasState(
      storage,
      "legacy-key",
      migrationOptions,
    );

    expect(result?.ok).toBe(true);
    expect(values.get("legacy-key")).toBe(serialized);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it("returns null when no legacy storage value exists", () => {
    const storage: LegacyCanvasStorage = {
      getItem: vi.fn(() => null),
    };

    expect(
      readLegacyCanvasState(storage, "missing", migrationOptions),
    ).toBeNull();
  });
});
