import {
  CanvasDocumentV2Schema,
  type CanvasDocumentV2,
  type CanvasDocumentV3,
  type CanvasPageId,
} from "@memi/protocol";

import { projectCanvasDocumentV2ToWorkbenchNodes } from "./canonical-workbench-authority.js";
import type { WorkbenchNode } from "./model.js";

function projectPageDocument(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
): CanvasDocumentV2 {
  const page = document.pagesById[pageId];
  if (page === undefined) {
    throw new Error(`Canvas V3 page does not exist: ${pageId}`);
  }
  const nodesById = Object.fromEntries(
    Object.values(document.nodesById)
      .filter((node) => node.pageId === pageId)
      .map(({ pageId: _pageId, ...node }) => [node.id, node]),
  );
  const componentsById = Object.fromEntries(
    Object.values(document.componentsById)
      .filter(({ rootNodeId }) => nodesById[rootNodeId] !== undefined)
      .map((component) => [
        component.id,
        {
          id: component.id,
          name: component.name,
          propertyKeys: Object.keys(component.propertyDefinitions),
          rootNodeId: component.rootNodeId,
        },
      ]),
  );
  const tokensById = Object.fromEntries(
    Object.values(document.variablesById).flatMap((variable) => {
      const collection = document.variableCollectionsById[variable.collectionId];
      const value = collection === undefined
        ? undefined
        : variable.valuesByMode[collection.defaultModeId];
      return value === undefined
        ? []
        : [[variable.id, { id: variable.id, name: variable.name, type: variable.type, value }]];
    }),
  );
  return CanvasDocumentV2Schema.parse({
    componentsById,
    id: document.id,
    nodesById,
    operationCursor: document.operationCursor,
    projectId: document.projectId,
    revision: document.revision,
    rootIds: page.rootIds,
    schemaVersion: 2,
    stateHash: document.stateHash,
    tokensById,
  });
}

/**
 * One-way V3-to-renderer projection. It intentionally keeps V3 ids and
 * computes absolute positions only for the legacy renderer; no UI action may
 * mutate the document through this result.
 */
export function projectCanvasDocumentV3ToWorkbench(
  document: CanvasDocumentV3,
  pageId: CanvasPageId,
): readonly WorkbenchNode[] {
  return projectCanvasDocumentV2ToWorkbenchNodes(
    projectPageDocument(document, pageId),
  );
}
