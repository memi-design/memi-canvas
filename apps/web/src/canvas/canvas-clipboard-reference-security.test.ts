import { describe, expect, it } from "vitest";

import { parseCanvasClipboardFallback } from "./canvas-clipboard.js";

const artifactId = "art_01J00000000000000000000000";

function referencePayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    mime: "application/x-memi-canvas+json",
    nodes: [{
      hidden: false,
      id: "reference-frame",
      kind: "ReferenceFrame",
      locked: false,
      name: "Production reference",
      parentId: null,
      position: { x: 0, y: 0 },
      reference: {
        alt: "Captured product screen",
        appVersion: "1.0.0",
        authority: "runtime-capture",
        capturedAt: "2026-08-08T12:00:00.000Z",
        sourceUrl: "memi-source://repository/src/App.tsx",
        src: `/imports/artifacts/${artifactId}.png`,
        ...overrides,
      },
      size: { height: 844, width: 390 },
    }],
    rootIds: ["reference-frame"],
    sourceDocumentId: "untrusted-document",
    version: 1,
  });
}

describe("canvas clipboard reference evidence security", () => {
  it("rejects unverified import paths and remote source URLs", () => {
    expect(parseCanvasClipboardFallback(referencePayload({
      src: "/imports/private/session.png",
    }))).toBeNull();
    expect(parseCanvasClipboardFallback(referencePayload({
      sourceUrl: "https://attacker.example/evidence",
    }))).toBeNull();
  });

  it("accepts persisted artifact identities with internal or loopback sources", () => {
    expect(parseCanvasClipboardFallback(referencePayload())).not.toBeNull();
    expect(parseCanvasClipboardFallback(referencePayload({
      sourceUrl: "http://127.0.0.1:4173/src/App.tsx",
      src: `memi-artifact://localhost/${artifactId}`,
    }))).not.toBeNull();
  });
});
