import { describe, expect, it } from "vitest";
import { RuntimeCaptureScreenV1Schema } from "@memi/protocol";

import {
  parseRepositoryReconstructionArtifact,
  RepositoryReconstructionReviewSchema,
} from "./repository-reconstruction-review.js";

const hash = `sha256:${"a".repeat(64)}` as const;
const now = "2026-07-29T12:00:00.000Z";

const capture = RuntimeCaptureScreenV1Schema.parse({
  app: {
    appVersion: "1.0.0",
    buildRevision: "b".repeat(40),
    environment: "simulator",
    productId: "northstar",
  },
  artifact: {
    alt: "Home runtime capture",
    artifactId: "art_01J00000000000000000000001",
    hash,
    height: 800,
    kind: "image/png",
    src: "memi-artifact://localhost/art_01J00000000000000000000001",
    width: 1280,
  },
  authority: "local_capture",
  binding: {
    coverageCellId: "home-default",
    normalizedPath: "/",
    routeId: "/",
    sourceAnchor: "src/pages/Home.tsx#Home",
    sourceContentHash: hash,
    stateId: "default",
    viewport: { height: 800, name: "mobile", scale: 1, width: 1280 },
  },
  captureId: "art_01J00000000000000000000000",
  capturedAt: now,
  evidence: {
    captureMethod: "ios-simulator-screenshot",
    label: "Local capture",
    truthLabel: "Local capture",
  },
  layers: [],
  repository: {
    dirty: false,
    dirtyFileFingerprint: hash,
    revision: "b".repeat(40),
    rootPath: "/Projects/northstar",
    sourceFingerprint: hash,
  },
  schemaVersion: 1,
  screenId: "home",
  screenName: "Home",
});

describe("repository reconstruction review evidence", () => {
  it("treats legacy semantic captures without fidelity evidence as needs-review", () => {
    expect(parseRepositoryReconstructionArtifact(capture)).toEqual({
      capture,
      review: null,
    });
  });

  it("accepts a verified, content-addressed fidelity report", () => {
    const review = RepositoryReconstructionReviewSchema.parse({
      confidenceBySemanticKey: {
        "home.title": {
          basis: ["runtime-geometry", "source-anchor"],
          score: 0.96,
        },
      },
      fidelity: {
        diffArtifactId: "art_01J00000000000000000000009",
        evaluatedAt: now,
        maximumGeometryDelta: 0.5,
        ssim: 0.991,
        status: "verified",
      },
      schemaVersion: 1,
    });

    expect(parseRepositoryReconstructionArtifact({
      capture,
      review,
      schemaVersion: 1,
    })).toEqual({ capture, review });
  });

  it("fails closed when verified fidelity evidence is missing or below gate", () => {
    const base = {
      confidenceBySemanticKey: {},
      fidelity: {
        diffArtifactId: "art_01J00000000000000000000009",
        evaluatedAt: now,
        maximumGeometryDelta: 0.5,
        ssim: 0.991,
        status: "verified",
      },
      schemaVersion: 1,
    } as const;

    expect(() => RepositoryReconstructionReviewSchema.parse({
      ...base,
      fidelity: { ...base.fidelity, ssim: 0.984 },
    })).toThrow(/SSIM/iu);
    expect(() => RepositoryReconstructionReviewSchema.parse({
      ...base,
      fidelity: { ...base.fidelity, maximumGeometryDelta: 1.01 },
    })).toThrow(/geometry/iu);
    expect(() => RepositoryReconstructionReviewSchema.parse({
      ...base,
      fidelity: { ...base.fidelity, diffArtifactId: null },
    })).toThrow(/difference artifact/iu);
  });
});
