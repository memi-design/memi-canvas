import {
  CanvasDocumentV2Schema,
  CanvasDocumentV3Schema,
  type CanvasDocumentV2,
  type CanvasDocumentV3,
} from "@memi/protocol";

import { hashValue } from "./hash.js";
import { immutableCanvasV3 } from "./v3-support.js";

export interface CanvasDocumentV2ToV3Migration {
  readonly strategy: "canvas-document-v2-to-v3";
  readonly sourceStateHash: string;
  readonly targetStateHash: string;
  readonly document: CanvasDocumentV3;
}

function semanticState(document: CanvasDocumentV3): object {
  const { stateHash: _stateHash, ...semantic } = document;
  return semantic;
}

export function migrateCanvasDocumentV2ToV3(
  untrustedDocument: CanvasDocumentV2,
): CanvasDocumentV2ToV3Migration {
  const source = CanvasDocumentV2Schema.parse(untrustedDocument);
  const pageId = `pag_${source.id.slice(4)}`;
  const hasImportedNodes = Object.values(source.nodesById).some(
    (node) => node.kind === "imported-source-frame",
  );
  const variableCollectionsById =
    Object.keys(source.tokensById).length === 0
      ? {}
      : {
          legacy: {
            id: "legacy",
            name: "Migrated tokens",
            modeIds: ["default"],
            defaultModeId: "default",
          },
        };
  const candidate = {
    schemaVersion: 3 as const,
    id: source.id,
    projectId: source.projectId,
    revision: source.revision,
    stateHash: `sha256:${"0".repeat(64)}`,
    operationCursor: source.operationCursor,
    pageIds: [pageId],
    pagesById: {
      [pageId]: {
        id: pageId,
        kind: hasImportedNodes ? "imported" as const : "design" as const,
        name: hasImportedNodes ? "Imported screens" : "Migrated canvas",
        rootIds: source.rootIds,
      },
    },
    nodesById: Object.fromEntries(
      Object.entries(source.nodesById).map(([nodeId, node]) => [
        nodeId,
        { ...node, pageId },
      ]),
    ),
    componentsById: Object.fromEntries(
      Object.entries(source.componentsById).map(([componentId, component]) => [
        componentId,
        {
          id: component.id,
          name: component.name,
          rootNodeId: component.rootNodeId,
          propertyDefinitions: Object.fromEntries(
            component.propertyKeys.map((key) => [
              key,
              { type: "unknown" as const, defaultValue: null },
            ]),
          ),
          variantAxes: {},
        },
      ]),
    ),
    variableCollectionsById,
    variablesById: Object.fromEntries(
      Object.entries(source.tokensById).map(([tokenId, token]) => [
        tokenId,
        {
          id: token.id,
          collectionId: "legacy",
          name: token.name,
          type: token.type,
          valuesByMode: { default: token.value },
        },
      ]),
    ),
    assetsById: {},
    prototypeConnectionsById: {},
    evidenceById: {},
    reconstructionsById: {},
  };
  const parsed = CanvasDocumentV3Schema.parse(candidate);
  const document = immutableCanvasV3(
    CanvasDocumentV3Schema.parse({
      ...parsed,
      stateHash: hashValue(semanticState(parsed)),
    }),
  );
  return immutableCanvasV3({
    strategy: "canvas-document-v2-to-v3",
    sourceStateHash: source.stateHash,
    targetStateHash: document.stateHash,
    document,
  });
}
