import {
  hashCanvasDocumentV3,
  mapLegacyCanvasIdV2,
} from "@memi/canvas-document";
import {
  CanvasPageIdSchema,
  type CanvasDocumentV3,
  type ProjectId,
} from "@memi/protocol";

import {
  migrateLegacyWorkbenchProjectionToV3,
} from "../canvas/canonical-workbench-authority-v3.js";
import { createLegacyWorkbenchProjection } from "../canvas/legacy-workbench-projection.js";
import type { CanvasWorkbenchProject } from "../canvas/model.js";

function inventoryLegacyNodeIds(project: CanvasWorkbenchProject): Set<string> {
  const nodesById = new Map(
    project.document.nodes.map((node) => [node.id, node] as const),
  );
  const inventory = new Set(
    project.document.nodes
      .filter((node) => node.provenance?.stateId === "inventory")
      .map(({ id }) => id),
  );
  for (const nodeId of Array.from(inventory)) {
    let parentId = nodesById.get(nodeId)?.parentId ?? null;
    while (parentId !== null && !inventory.has(parentId)) {
      inventory.add(parentId);
      parentId = nodesById.get(parentId)?.parentId ?? null;
    }
  }
  return inventory;
}

function importedSeed(
  project: CanvasWorkbenchProject,
  migration: ReturnType<typeof migrateLegacyWorkbenchProjectionToV3>,
): Pick<
  CanvasDocumentV3,
  "componentsById" | "nodesById" | "pageIds" | "pagesById"
> {
  const importedPageId = migration.document.pageIds[0]!;
  const importedPage = {
    ...migration.document.pagesById[importedPageId]!,
    kind: "imported" as const,
    name: "Imported flow",
    rootIds: [],
  };
  const legacyIds = inventoryLegacyNodeIds(project);
  const inventoryIds = new Set(
    [...legacyIds]
      .map((legacyId) => migration.legacyReceipt.nodeIds[legacyId])
      .filter((nodeId): nodeId is string => nodeId !== undefined),
  );
  if (inventoryIds.size === 0) {
    return {
      componentsById: {},
      nodesById: {},
      pageIds: [importedPageId],
      pagesById: { [importedPageId]: importedPage },
    };
  }
  const mapped = mapLegacyCanvasIdV2(
    "node",
    `${migration.document.id}:design-system-page`,
  ).canonicalId;
  const libraryPageId = CanvasPageIdSchema.parse(`pag_${mapped.slice(4)}`);
  const nodesById = Object.fromEntries(
    [...inventoryIds].map((nodeId) => {
      const node = migration.document.nodesById[nodeId]!;
      return [
        nodeId,
        {
          ...node,
          pageId: libraryPageId,
          parentId:
            node.parentId !== null && inventoryIds.has(node.parentId)
              ? node.parentId
              : null,
          childIds: node.childIds.filter((childId) => inventoryIds.has(childId)),
        },
      ];
    }),
  );
  const rootIds = Object.values(nodesById)
    .filter(({ parentId }) => parentId === null)
    .map(({ id }) => id);
  const componentsById = Object.fromEntries(
    Object.entries(migration.document.componentsById).filter(
      ([, component]) => inventoryIds.has(component.rootNodeId),
    ),
  );
  return {
    componentsById,
    nodesById,
    pageIds: [importedPageId, libraryPageId],
    pagesById: {
      [importedPageId]: importedPage,
      [libraryPageId]: {
        id: libraryPageId,
        kind: "library",
        name: "Design system",
        rootIds,
      },
    },
  };
}

/**
 * One deterministic identity seam shared by import commit and editor reopen.
 * Legacy nodes seed a new journal only; persisted V3 operations remain the
 * authority whenever a journal already exists for this identity.
 */
export function createLocalDesignCanvasDocumentV3(
  project: CanvasWorkbenchProject,
  runtimeProjectId?: ProjectId,
  pageKind?: "design" | "imported",
): CanvasDocumentV3 {
  const migration = migrateLegacyWorkbenchProjectionToV3(
    createLegacyWorkbenchProjection({
      nodes: project.document.nodes,
      revision: project.document.revision,
      selectedNodeId: project.selectedNodeId,
    }),
    {
      legacyDocumentId: project.document.id,
      legacyProjectId: project.id,
    },
  );
  const imported =
    pageKind === "imported" ? importedSeed(project, migration) : null;
  const pagesById: CanvasDocumentV3["pagesById"] = imported?.pagesById ??
    (pageKind === undefined
      ? migration.document.pagesById
      : Object.fromEntries(
          Object.entries(migration.document.pagesById).map(
            ([pageId, page]) => [pageId, { ...page, kind: pageKind }],
          ),
        ));
  const rebasedDocument = {
    ...migration.document,
    pagesById,
    pageIds: imported?.pageIds ?? migration.document.pageIds,
    projectId: runtimeProjectId ?? migration.document.projectId,
    ...(pageKind === "imported"
      ? {
          assetsById: {},
          componentsById: imported?.componentsById ?? {},
          evidenceById: {},
          nodesById: imported?.nodesById ?? {},
          prototypeConnectionsById: {},
          reconstructionsById: {},
          variableCollectionsById: {},
          variablesById: {},
        }
      : {}),
  };
  return Object.freeze({
    ...rebasedDocument,
    stateHash: hashCanvasDocumentV3(rebasedDocument),
  });
}
