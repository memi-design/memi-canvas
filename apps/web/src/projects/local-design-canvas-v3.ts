import { hashCanvasDocumentV3 } from "@memi/canvas-document";
import type { CanvasDocumentV3, ProjectId } from "@memi/protocol";

import {
  migrateLegacyWorkbenchProjectionToV3,
} from "../canvas/canonical-workbench-authority-v3.js";
import { createLegacyWorkbenchProjection } from "../canvas/legacy-workbench-projection.js";
import type { CanvasWorkbenchProject } from "../canvas/model.js";

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
  const pagesById: CanvasDocumentV3["pagesById"] =
    pageKind === undefined
      ? migration.document.pagesById
      : Object.fromEntries(
          Object.entries(migration.document.pagesById).map(
            ([pageId, page]) => [
              pageId,
              {
                ...page,
                kind: pageKind,
                ...(pageKind === "imported" ? { rootIds: [] } : {}),
              },
            ],
          ),
        );
  const rebasedDocument = {
    ...migration.document,
    pagesById,
    projectId: runtimeProjectId ?? migration.document.projectId,
    ...(pageKind === "imported"
      ? {
          assetsById: {},
          componentsById: {},
          evidenceById: {},
          nodesById: {},
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
