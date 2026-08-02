import { describe, expect, it } from "vitest";

import {
  CaptureAdapterMetadataSchemaV1,
  CaptureArtifactSchemaV2,
  CaptureFailureSchemaV1,
  CaptureScenarioSchemaV2,
  deepFreeze,
  parseCaptureAdapterMetadataV1,
  parseCaptureArtifactV2,
  parseCaptureFailureV1,
  parseCaptureScenarioV2,
} from "./index.js";

const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const revision = "a".repeat(40);
const scenarioId = "csc_01J00000000000000000000000";
const artifactId = "art_01J00000000000000000000000";

function scenario() {
  return {
    id: scenarioId,
    applicationId: "web",
    route: "/",
    state: "Default",
    viewport: {
      name: "Desktop",
      width: 1_440,
      height: 900,
      scale: 2,
    },
    authContext: null,
    parameters: [],
    fixtureProfile: "default",
    readinessSelector: "[data-memi-ready]",
    sourceAnchor: {
      relativePath: "src/routes/home.tsx",
      symbol: "HomePage",
      contentHash: hashA,
    },
  };
}

function artifact() {
  return {
    id: artifactId,
    scenarioId,
    screenshotArtifactId: "art_01J00000000000000000000001",
    hierarchyArtifactId: null,
    geometryArtifactId: null,
    screenshotHash: hashA,
    sourceRevision: revision,
    fixtureFingerprint: hashB,
    dimensions: { width: 2_880, height: 1_800, scale: 2 },
    verification: {
      stableFrameHash: hashA,
      routeMatched: true,
      blankRejected: true,
      splashRejected: true,
      errorBoundaryRejected: true,
      verifiedAt: "2026-07-29T10:01:00.000Z",
    },
  };
}

function failure() {
  return {
    scenarioId,
    code: "READINESS_TIMEOUT",
    stage: "capture",
    message: "The route did not become ready.",
    remediation: "Confirm the readiness selector and fixture.",
    logTail: ["waited 10s"],
    retryable: true,
    occurredAt: "2026-07-29T10:02:00.000Z",
  };
}

describe("capture import contract boundary", () => {
  it("re-exports the canonical protocol schemas", () => {
    expect(CaptureScenarioSchemaV2.parse(scenario()).id).toBe(scenarioId);
    expect(CaptureArtifactSchemaV2.parse(artifact()).id).toBe(artifactId);
    expect(CaptureFailureSchemaV1.parse(failure()).retryable).toBe(true);
  });

  it("deeply freezes validated scenario, artifact, and failure values", () => {
    const parsedScenario = parseCaptureScenarioV2(scenario());
    const parsedArtifact = parseCaptureArtifactV2(artifact());
    const parsedFailure = parseCaptureFailureV1(failure());

    expect(Object.isFrozen(parsedScenario)).toBe(true);
    expect(Object.isFrozen(parsedScenario.viewport)).toBe(true);
    expect(Object.isFrozen(parsedArtifact.verification)).toBe(true);
    expect(Object.isFrozen(parsedFailure.logTail)).toBe(true);
    expect(() => {
      (parsedScenario.viewport as { width: number }).width = 1;
    }).toThrow();
  });

  it("preserves protocol validation instead of accepting unsafe evidence", () => {
    expect(() =>
      parseCaptureScenarioV2({
        ...scenario(),
        sourceAnchor: {
          ...scenario().sourceAnchor,
          relativePath: "../outside.tsx",
        },
      }),
    ).toThrow();
    expect(() =>
      parseCaptureArtifactV2({
        ...artifact(),
        verification: {
          ...artifact().verification,
          blankRejected: false,
        },
      }),
    ).toThrow();
  });

  it("validates immutable adapter metadata with unique capabilities", () => {
    const metadata = parseCaptureAdapterMetadataV1({
      id: "playwright-react",
      platform: "react-web",
      version: "1.0.0",
      capabilities: [
        "discover",
        "prepare",
        "launch",
        "capture",
        "collect",
        "cleanup",
      ],
    });

    expect(CaptureAdapterMetadataSchemaV1.parse(metadata)).toEqual(metadata);
    expect(Object.isFrozen(metadata.capabilities)).toBe(true);
    expect(() =>
      parseCaptureAdapterMetadataV1({
        ...metadata,
        capabilities: ["discover", "discover"],
      }),
    ).toThrow(/unique/i);
  });

  it("keeps primitive and already-frozen values stable", () => {
    const value = deepFreeze({ nested: { value: 1 } });

    expect(deepFreeze(value)).toBe(value);
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze("capture")).toBe("capture");
  });
});
