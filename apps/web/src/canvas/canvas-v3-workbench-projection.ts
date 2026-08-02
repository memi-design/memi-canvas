import {
  CanvasDocumentV2Schema,
  type CanvasDocumentV2,
  type CanvasDocumentV3,
  type CanvasPageId,
} from "@memi/protocol";
import { mapLegacyCanvasIdV2 } from "@memi/canvas-document";

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
  ).map((node) => projectComponentDefinitionDefaults(document, node));
}

function projectComponentDefinitionDefaults(
  document: CanvasDocumentV3,
  node: WorkbenchNode,
): WorkbenchNode {
  const component = node.component;
  if (component?.classification !== "master") return node;
  const definition = document.componentsById[component.componentId];
  if (definition === undefined) return node;
  const label = definition.propertyDefinitions.label?.defaultValue;
  const icon = definition.propertyDefinitions.icon?.defaultValue;
  const selected = definition.propertyDefinitions.selected?.defaultValue;
  const variant = definition.propertyDefinitions.variant?.defaultValue;
  return {
    ...node,
    component: {
      ...component,
      props: {
        ...component.props,
        ...(typeof label === "string" ? { label } : {}),
        ...(typeof icon === "string" ? { icon } : {}),
        ...(typeof selected === "boolean" ? { selected } : {}),
      },
      ...(typeof variant === "string" ? { variant } : {}),
    },
  };
}

/**
 * Restores a pre-migration master identity only for legacy-facing UI copy.
 * The V3 instance binding remains canonical and is never mutated by this view.
 */
export function projectLegacyComponentMasterIdV3(
  node: WorkbenchNode,
  legacyDocumentId: string,
  legacyNodes: readonly WorkbenchNode[],
): WorkbenchNode {
  const masterId = node.component?.masterId;
  if (
    node.component?.classification !== "instance" ||
    masterId === undefined
  ) {
    return node;
  }
  const legacyMaster = legacyNodes.find((candidate) =>
    candidate.component?.classification === "master" &&
    mapLegacyCanvasIdV2(
      "node",
      `${legacyDocumentId}:${candidate.id}`,
    ).canonicalId === masterId
  );
  return legacyMaster === undefined
    ? node
    : {
        ...node,
        component: { ...node.component, masterId: legacyMaster.id },
      };
}
