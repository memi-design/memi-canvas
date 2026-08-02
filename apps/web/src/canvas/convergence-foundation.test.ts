import {
  mapLegacyCanvasIdV2,
  prepareCanvasOperationV2,
} from "@memi/canvas-document";
import type {
  CanvasNodeV2,
  OperationId,
} from "@memi/protocol";
import { describe, expect, it } from "vitest";

import { sourceProjectFixture } from "./source-project.fixture.js";
import { routeAgentRequest } from "./agent-router.js";
import { createCanonicalCanvasStore } from "./canonical-canvas-store.js";
import { migrateLegacyCanvasState } from "./canvas-state-migration.js";
import {
  createSceneState,
  createSelectionState,
  designDocumentFromWorkbench,
} from "./model.js";
import { createSelectionContextCapsuleFromLegacyDocument } from "./selection-context-capsule.js";

const POLICY_HASH = `sha256:${"c".repeat(64)}`;

function historyOperationId(index: number): OperationId {
  return mapLegacyCanvasIdV2(
    "operation",
    `convergence-history:${index}`,
  ).canonicalId as OperationId;
}

describe("inverse-Figma convergence foundation", () => {
  it("routes a real source-backed Buzzr selection locally, applies one V2 canvas operation, and recovers without source effects", async () => {
    const legacyScene = createSceneState(sourceProjectFixture);
    const selected = legacyScene.nodes.find(
      (node) =>
        node.component?.role === "button" &&
        node.component.classification === "master" &&
        node.component.source.sourceContentHash !== undefined,
    );
    expect(selected).toBeDefined();
    if (selected?.component === undefined) {
      throw new Error("Buzzr button source evidence is unavailable.");
    }

    const sourceRevision = selected.component.source.repositoryRevision;
    const capsule =
      await createSelectionContextCapsuleFromLegacyDocument({
        document: designDocumentFromWorkbench({
          ...sourceProjectFixture.document,
          nodes: legacyScene.nodes,
        }),
        selection: createSelectionState([selected.id]),
        sourceRevision,
        viewport: {
          pointerMode: "select",
          translation: { x: 0, y: 0 },
          viewportSize: { height: 900, width: 1_440 },
          zoom: 1,
        },
      });
    const decision = await routeAgentRequest({
      budget: {
        remainingCostUsdMicros: 0,
        remainingEscalations: 0,
        remainingInputTokens: 0,
      },
      capsule,
      intent: {
        deterministicOperation: "radius",
        kind: "semantic-edit",
        prompt: "Set the selected Buzzr button radius to 12.",
        requiresVision: false,
      },
      localCompiler: {
        adapterVersion: "fixture-source-compiler-1",
        available: true,
        preflight: {
          deterministicOperation: "radius",
          selectionSemanticHash: capsule.selectionSemanticHash,
          sourceAnchorCount: capsule.sourceAnchors.length,
          sourceRevision,
          status: "eligible",
        },
        supportedOperations: ["radius"],
      },
      models: {
        fast: {
          adapterVersion: "blocked-fast",
          available: false,
          capabilities: { structural: false, vision: false },
          estimatedCostUsdMicros: 1,
          maxInputTokens: 1,
        },
        strong: {
          adapterVersion: "blocked-strong",
          available: false,
          capabilities: { structural: true, vision: true },
          estimatedCostUsdMicros: 1,
          maxInputTokens: 1,
        },
      },
      policy: {
        allowModelUse: false,
        policyHash: POLICY_HASH,
      },
    });
    expect(decision).toMatchObject({
      level: "local",
      zeroToken: true,
      budget: {
        estimate: { costUsdMicros: 0, inputTokens: 0 },
      },
    });

    const migration = migrateLegacyCanvasState(legacyScene, {
      legacyDocumentId: sourceProjectFixture.document.id,
      legacyProjectId: sourceProjectFixture.id,
    });
    if (!migration.ok) {
      throw new Error(migration.issues.join("\n"));
    }
    expect(migration.ok).toBe(true);
    const canonicalNodeId = migration.receipt.nodeIds[
      selected.id
    ] as CanvasNodeV2["id"];
    const canonicalNode = migration.document.nodesById[canonicalNodeId];
    expect(canonicalNode).toBeDefined();
    if (canonicalNode === undefined) {
      throw new Error("Migrated Buzzr button is unavailable.");
    }
    // Migration preserves incomplete source metadata as evidence without
    // fabricating a source-editable AST anchor.
    expect(canonicalNode.sourceAnchor).toBeNull();

    let historyId = 0;
    const store = createCanonicalCanvasStore({
      allocateHistoryOperation: () => ({
        actor: "human",
        actorId: "convergence-test",
        id: historyOperationId(historyId++),
        occurredAt: "2026-07-29T12:00:00.000Z",
      }),
      document: migration.document,
      selection: migration.selection,
    });
    const originalStyle = structuredClone(canonicalNode.style);
    const operation = prepareCanvasOperationV2(
      store.getSnapshot().document,
      {
        action: {
          payload: {
            next: {
              ...originalStyle,
              cornerRadii: [12, 12, 12, 12],
            },
            nodeId: canonicalNodeId,
          },
          type: "node.style",
        },
        actor: "human",
        actorId: "convergence-test",
        id: historyOperationId(10_000),
        occurredAt: "2026-07-29T12:00:00.000Z",
      },
    );

    expect(store.dispatch(operation).ok).toBe(true);
    expect(
      store.getSnapshot().document.nodesById[canonicalNodeId]?.style
        .cornerRadii,
    ).toEqual([12, 12, 12, 12]);
    expect(store.undo().ok).toBe(true);
    expect(
      store.getSnapshot().document.nodesById[canonicalNodeId]?.style,
    ).toEqual(originalStyle);

    const recovered = createCanonicalCanvasStore({
      allocateHistoryOperation: () => ({
        actor: "system",
        actorId: "recovery-test",
        id: historyOperationId(historyId++),
        occurredAt: "2026-07-29T12:00:00.000Z",
      }),
      document: store.getSnapshot().document,
      selection: store.getSnapshot().selection,
      viewport: store.getSnapshot().viewport,
    });
    expect(recovered.getSnapshot().document.stateHash).toBe(
      store.getSnapshot().document.stateHash,
    );
    expect(legacyScene.nodes).toEqual(
      createSceneState(sourceProjectFixture).nodes,
    );
  });
});
