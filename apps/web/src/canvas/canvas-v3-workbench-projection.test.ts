import { describe, expect, it } from "vitest";

import { migrateCanvasDocumentV2ToV3 } from "@memi/canvas-document";
import {
  CanvasDocumentV2Schema,
  CanvasPageIdSchema,
  type CanvasDocumentV2,
} from "@memi/protocol";

import { projectCanvasDocumentV3ToWorkbench } from "./canvas-v3-workbench-projection.js";

const ids = {
  document: "doc_01J00000000000000000000000",
  page: "pag_01J00000000000000000000000",
  project: "prj_01J00000000000000000000000",
  root: "nod_01J00000000000000000000000",
  child: "nod_01J00000000000000000000001",
} as const;

function legacyDocument(): CanvasDocumentV2 {
  return CanvasDocumentV2Schema.parse({
    componentsById: {},
    id: ids.document,
    nodesById: {
      [ids.child]: {
        childIds: [],
        componentBinding: null,
        componentId: null,
        content: null,
        geometry: { height: 40, width: 80 },
        id: ids.child,
        instanceOverrides: {},
        kind: "rectangle",
        layout: {
          alignCounter: "start",
          alignPrimary: "start",
          gap: 0,
          mode: "none",
          padding: { bottom: 0, left: 0, right: 0, top: 0 },
          sizingHorizontal: "fixed",
          sizingVertical: "fixed",
          wrap: false,
        },
        name: "Child",
        parentId: ids.root,
        provenance: null,
        referenceBinding: null,
        sourceAnchor: null,
        sourceBinding: null,
        style: {
          cornerRadii: [0, 0, 0, 0],
          fills: [{ color: "oklch(0.7 0.2 20)", type: "solid" }],
          opacity: 1,
          locked: false,
          strokes: [],
          visible: true,
        },
        text: null,
        transform: { rotation: 0, scaleX: 1, scaleY: 1, x: 16, y: 20 },
      },
      [ids.root]: {
        childIds: [ids.child],
        componentBinding: null,
        componentId: null,
        content: null,
        geometry: { height: 120, width: 200 },
        id: ids.root,
        instanceOverrides: {},
        kind: "frame",
        layout: {
          alignCounter: "start",
          alignPrimary: "start",
          gap: 0,
          mode: "none",
          padding: { bottom: 0, left: 0, right: 0, top: 0 },
          sizingHorizontal: "fixed",
          sizingVertical: "fixed",
          wrap: false,
        },
        name: "Parent",
        parentId: null,
        provenance: null,
        referenceBinding: null,
        sourceAnchor: null,
        sourceBinding: null,
        style: {
          cornerRadii: [0, 0, 0, 0],
          fills: [],
          opacity: 1,
          locked: false,
          strokes: [],
          visible: true,
        },
        text: null,
        transform: { rotation: 0, scaleX: 1, scaleY: 1, x: 100, y: 80 },
      },
    },
    operationCursor: null,
    projectId: ids.project,
    revision: 0,
    rootIds: [ids.root],
    schemaVersion: 2,
    stateHash: `sha256:${"0".repeat(64)}`,
    tokensById: {},
  });
}

describe("projectCanvasDocumentV3ToWorkbench", () => {
  it("projects one page with stable V3 ids and absolute renderer coordinates", () => {
    const v3 = migrateCanvasDocumentV2ToV3(legacyDocument()).document;
    const projected = projectCanvasDocumentV3ToWorkbench(
      v3,
      CanvasPageIdSchema.parse(ids.page),
    );

    expect(projected.map(({ id }) => id)).toEqual([ids.root, ids.child]);
    expect(projected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ids.root,
          parentId: null,
          position: { x: 100, y: 80 },
        }),
        expect.objectContaining({
          id: ids.child,
          parentId: ids.root,
          position: { x: 116, y: 100 },
        }),
      ]),
    );
  });

  it("rejects an unknown page instead of projecting unrelated document nodes", () => {
    const v3 = migrateCanvasDocumentV2ToV3(legacyDocument()).document;

    expect(() =>
      projectCanvasDocumentV3ToWorkbench(
        v3,
        CanvasPageIdSchema.parse("pag_01J00000000000000000000001"),
      ),
    ).toThrow(/page does not exist/i);
  });
});
