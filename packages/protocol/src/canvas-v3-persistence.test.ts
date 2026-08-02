import { describe, expect, it } from "vitest";

import {
  CanvasDocumentIdentityV3Schema,
  CanvasDocumentSnapshotV3Schema,
} from "./canvas-v3-persistence.js";

const ids = {
  project: "prj_01J00000000000000000000000",
  otherProject: "prj_01J00000000000000000000001",
  document: "doc_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
} as const;

function document() {
  return {
    schemaVersion: 3 as const,
    id: ids.document,
    projectId: ids.project,
    revision: 0,
    stateHash: `sha256:${"0".repeat(64)}` as const,
    operationCursor: null,
    pageIds: [ids.page],
    pagesById: {
      [ids.page]: {
        id: ids.page,
        kind: "design" as const,
        name: "Page 1",
        rootIds: [],
      },
    },
    nodesById: {},
    componentsById: {},
    variableCollectionsById: {},
    variablesById: {},
    assetsById: {},
    prototypeConnectionsById: {},
    evidenceById: {},
    reconstructionsById: {},
  };
}

describe("Canvas V3 persistence protocol", () => {
  it("binds every durable snapshot to one canonical project and document", () => {
    const identity = CanvasDocumentIdentityV3Schema.parse({
      schemaVersion: 1,
      projectId: ids.project,
      documentId: ids.document,
    });
    const snapshot = CanvasDocumentSnapshotV3Schema.parse({
      schemaVersion: 1,
      kind: "canvas-document-v3-snapshot",
      identity,
      document: document(),
      persistedAt: "2026-07-31T20:00:00.000Z",
    });

    expect(snapshot.document.id).toBe(identity.documentId);
    expect(snapshot.document.projectId).toBe(identity.projectId);
    expect(() =>
      CanvasDocumentSnapshotV3Schema.parse({
        ...snapshot,
        identity: { ...identity, projectId: ids.otherProject },
      }),
    ).toThrow(/identity/i);
  });
});
