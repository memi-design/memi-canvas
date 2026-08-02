import { describe, expect, it } from "vitest";

import type { WorkbenchNode } from "./model.js";
import {
  composeImportedMobileScreen,
  composeImportedMobileScreenWithEvidence,
} from "./imported-screen-composition.js";
import { createCanonicalWorkbenchAuthority } from "./canonical-workbench-authority.js";
import { createLegacyWorkbenchProjection } from "./legacy-workbench-projection.js";

const frame: WorkbenchNode = {
  fill: "#08090a",
  frameContent: "/games",
  hidden: false,
  id: "screen-games",
  kind: "CodeFrame",
  locked: false,
  name: "Games",
  parentId: null,
  position: { x: 120, y: 80 },
  size: { height: 844, width: 390 },
  source: {
    coverageCellId: "games:mobile",
    repositoryRevision: "buzzr@abc123",
    routeId: "games",
    sourceAnchor: "app/(protected)/(tabs)/games.tsx",
    stateId: "games:default",
    viewport: { height: 844, name: "mobile", width: 390 },
  },
};

const capture = {
  alt: "Buzzr Games screen running in the iOS simulator",
  appVersion: "2.1",
  assetPath: "/imports/buzzr-runtime/games-default.png",
  authority: "Buzzr runtime capture",
  accessibilitySnapshotRef: "artifact://buzzr/games.a11y.json",
  capturedAt: "2026-07-29T19:00:00.000Z",
  componentIds: ["buzzr.game-card"],
  gitSha: "abc123",
  height: 800,
  id: "capture-games-default",
  routeId: "games",
  screenId: "screen-games",
  screenshotSha256: "a".repeat(64),
  sourceAnchors: ["app/(protected)/(tabs)/games.tsx"],
  sourceUrl: "memi-source://repository/app/games.tsx",
  width: 368,
} as const;

function overlay(
  id: string,
  parentId = frame.id,
): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind: "Rectangle",
    locked: false,
    name: id,
    parentId,
    position: { x: 140, y: 180 },
    size: { height: 80, width: 340 },
  };
}

describe("imported mobile screen composition", () => {
  it("keeps immutable screenshot evidence separate from the visible reconstruction", () => {
    const composition = composeImportedMobileScreenWithEvidence({
      capture,
      frame,
      semanticNodes: [overlay("game-card")],
    });

    expect(composition.reconstruction).toMatchObject({
      evidenceNodeId: capture.id,
      reviewStatus: "needs-review",
      screenId: frame.id,
    });
    expect(composition.nodes[1]).toMatchObject({
      hidden: true,
      kind: "ReferenceFrame",
      locked: true,
      parentId: null,
    });
    expect(composition.nodes[2]).toMatchObject({
      hidden: false,
      locked: false,
      parentId: frame.id,
    });
  });

  it("keeps immutable runtime evidence outside the editable hierarchy", () => {
    const nodes = composeImportedMobileScreen({
      capture,
      frame,
      semanticNodes: [
        overlay("game-card"),
        overlay("game-title", "game-card"),
      ],
    });

    expect(nodes.map(({ id }) => id)).toEqual([
      frame.id,
      capture.id,
      "game-card",
      "game-title",
    ]);
    expect(nodes[0]).toMatchObject({
      size: { height: capture.height, width: capture.width },
      source: {
        viewport: {
          height: capture.height,
          name: "mobile",
          width: capture.width,
        },
      },
    });
    expect(nodes[1]).toMatchObject({
      hidden: true,
      kind: "ReferenceFrame",
      locked: true,
      parentId: null,
      position: frame.position,
      reference: {
        alt: capture.alt,
        appVersion: capture.appVersion,
        authority: capture.authority,
        captureId: capture.id,
        capturedAt: capture.capturedAt,
        contentHash: `sha256:${capture.screenshotSha256}`,
        sourceUrl: capture.sourceUrl,
        sourceRevision: capture.gitSha,
        src: capture.assetPath,
      },
      size: { height: capture.height, width: capture.width },
    });
    expect(nodes.slice(2).every(({ locked }) => !locked)).toBe(true);
    expect(nodes[2]?.provenance).toMatchObject({
      coverageCellId: frame.source?.coverageCellId,
      repositoryRevision: frame.source?.repositoryRevision,
      sourceAnchor: frame.source?.sourceAnchor,
    });
    expect(nodes[2]).toMatchObject({
      position: {
        x: frame.position.x + (20 * capture.width) / frame.size.width,
        y: frame.position.y + (100 * capture.height) / frame.size.height,
      },
      size: {
        height: (80 * capture.height) / frame.size.height,
        width: (340 * capture.width) / frame.size.width,
      },
    });
    expect(nodes[3]?.parentId).toBe("game-card");
  });

  it("rejects non-mobile, colliding, and orphaned compositions", () => {
    expect(() =>
      composeImportedMobileScreen({
        capture,
        frame: {
          ...frame,
          source: {
            ...frame.source!,
            viewport: { height: 900, name: "desktop", width: 1440 },
          },
        },
        semanticNodes: [],
      }),
    ).toThrow("mobile");

    expect(() =>
      composeImportedMobileScreen({
        capture: { ...capture, id: frame.id },
        frame,
        semanticNodes: [],
      }),
    ).toThrow("unique");

    expect(() =>
      composeImportedMobileScreen({
        capture,
        frame,
        semanticNodes: [overlay("orphan", "missing-parent")],
      }),
    ).toThrow("hierarchy");
  });

  it("round-trips immutable capture trace metadata through canonical V2", () => {
    const nodes = composeImportedMobileScreen({
      capture,
      frame,
      semanticNodes: [overlay("game-card")],
    });
    const authority = createCanonicalWorkbenchAuthority({
      documentId: "document-buzzr-runtime",
      projectId: "project-buzzr-runtime",
      scene: createLegacyWorkbenchProjection({
        nodes,
        revision: 1,
        selectedNodeId: frame.id,
      }),
    });

    expect(
      authority
        .getSnapshot()
        .nodes.find(({ id }) => id === capture.id)?.reference,
    ).toMatchObject({
      accessibilitySnapshotRef: capture.accessibilitySnapshotRef,
      captureId: capture.id,
      componentIds: capture.componentIds,
      contentHash: `sha256:${capture.screenshotSha256}`,
      sourceAnchors: capture.sourceAnchors,
      sourceRevision: capture.gitSha,
    });
  });

  it("requires source provenance and a trusted local capture path", () => {
    const { source: _source, ...frameWithoutSource } = frame;
    expect(() =>
      composeImportedMobileScreen({
        capture,
        frame: frameWithoutSource,
        semanticNodes: [],
      }),
    ).toThrow("source-backed");
    expect(() =>
      composeImportedMobileScreen({
        capture: { ...capture, assetPath: "https://example.com/games.png" },
        frame,
        semanticNodes: [],
      }),
    ).toThrow("/imports/");
  });
});
