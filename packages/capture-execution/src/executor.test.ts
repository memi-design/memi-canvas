import type {
  CaptureAdapterV1,
  CaptureLaunchV1,
} from "@memi/capture-import";
import { CaptureArtifactSchemaV2 } from "@memi/protocol";
import type { CaptureArtifactV2 } from "@memi/protocol";
import { describe, expect, it, vi } from "vitest";

import { executeCaptureScenario } from "./executor.js";
import {
  applicationFixture,
  jobFixture,
  scenarioFixture,
} from "./test-fixtures.js";

function adapter(overrides: Partial<CaptureAdapterV1> = {}): CaptureAdapterV1 {
  return {
    metadata: {
      id: "fixture",
      platform: "react-web",
      version: "1",
      capabilities: [
        "discover",
        "prepare",
        "launch",
        "capture",
        "collect",
        "cleanup",
      ],
    },
    discover: vi.fn(async () => [applicationFixture]),
    prepare: vi.fn(async () => ({
      id: "preparation",
      application: applicationFixture,
      repository: jobFixture.repository,
    })),
    launch: vi.fn(async () => ({
      id: "launch",
      preparationId: "preparation",
    })),
    capture: vi.fn(async () => ({
      id: "raw",
      scenarioId: scenarioFixture.id,
    })),
    collect: vi.fn(async () => CaptureArtifactSchemaV2.parse({
      id: "art_01J00000000000000000000000",
      scenarioId: scenarioFixture.id,
      screenshotArtifactId: "art_01J00000000000000000000001",
      hierarchyArtifactId: null,
      geometryArtifactId: null,
      screenshotHash: `sha256:${"a".repeat(64)}`,
      sourceRevision: "a".repeat(40),
      fixtureFingerprint: `sha256:${"b".repeat(64)}`,
      dimensions: { width: 1_440, height: 900, scale: 1 },
      verification: {
        stableFrameHash: `sha256:${"a".repeat(64)}`,
        routeMatched: true,
        blankRejected: true,
        splashRejected: true,
        errorBoundaryRejected: true,
        verifiedAt: "2026-07-29T10:00:00.000Z",
      },
    })),
    cleanup: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("executeCaptureScenario", () => {
  it("runs the full adapter lifecycle and always cleans up", async () => {
    const captureAdapter = adapter();
    const result = await executeCaptureScenario({
      adapter: captureAdapter,
      application: applicationFixture,
      scenario: scenarioFixture,
      job: jobFixture,
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });

    expect(result.kind).toBe("captured");
    expect(captureAdapter.cleanup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "launch" }),
    );
  });

  it("returns a precise retryable failure at the failed stage", async () => {
    const cleanup = vi.fn(async () => undefined);
    const result = await executeCaptureScenario({
      adapter: adapter({
        launch: vi.fn(async (): Promise<CaptureLaunchV1> => {
          throw new Error("localhost refused connection");
        }),
        cleanup,
      }),
      application: applicationFixture,
      scenario: scenarioFixture,
      job: jobFixture,
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: {
        scenarioId: scenarioFixture.id,
        code: "LAUNCH_FAILED",
        stage: "launch",
        retryable: true,
      },
    });
    expect(cleanup).toHaveBeenCalledWith(expect.anything(), null);
  });

  it("reports cancellation distinctly and still cleans up", async () => {
    const controller = new AbortController();
    controller.abort();
    const captureAdapter = adapter();

    const result = await executeCaptureScenario({
      adapter: captureAdapter,
      application: applicationFixture,
      scenario: scenarioFixture,
      job: jobFixture,
      signal: controller.signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: { code: "CAPTURE_CANCELLED", retryable: true },
    });
    expect(captureAdapter.prepare).not.toHaveBeenCalled();
    expect(captureAdapter.cleanup).toHaveBeenCalled();
  });

  it("fails closed on adapter mismatches and cleanup failures", async () => {
    const mismatch = adapter({
      discover: vi.fn(async () => []),
    });
    const mismatchResult = await executeCaptureScenario({
      adapter: mismatch,
      application: applicationFixture,
      scenario: scenarioFixture,
      job: jobFixture,
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });
    expect(mismatchResult).toMatchObject({
      kind: "failed",
      failure: {
        code: "ADAPTER_APPLICATION_MISMATCH",
        retryable: false,
      },
    });

    const cleanupResult = await executeCaptureScenario({
      adapter: adapter({
        cleanup: vi.fn(async () => {
          throw new Error("cleanup unavailable");
        }),
      }),
      application: applicationFixture,
      scenario: scenarioFixture,
      job: jobFixture,
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });
    expect(cleanupResult).toMatchObject({
      kind: "failed",
      failure: { code: "CLEANUP_FAILED" },
    });
  });

  it.each([
    [
      "scenario",
      {
        scenarioId: "csc_01J00000000000000000000001",
      },
    ],
    [
      "revision",
      {
        sourceRevision: "b".repeat(40),
      },
    ],
    [
      "dimensions",
      {
        dimensions: { width: 100, height: 100, scale: 1 },
      },
    ],
    [
      "stable hash",
      {
        verification: {
          stableFrameHash: `sha256:${"c".repeat(64)}`,
          routeMatched: true,
          blankRejected: true,
          splashRejected: true,
          errorBoundaryRejected: true,
          verifiedAt: "2026-07-29T10:00:00.000Z",
        },
      },
    ],
  ])("rejects misattributed %s evidence", async (_label, override) => {
    const base = adapter();
    const collect = base.collect;
    const result = await executeCaptureScenario({
      adapter: adapter({
        collect: vi.fn(async (context, launch, capture) => ({
          ...(await collect(context, launch, capture)),
          ...override,
        }) as CaptureArtifactV2),
      }),
      application: applicationFixture,
      scenario: scenarioFixture,
      job: jobFixture,
      signal: new AbortController().signal,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });
    expect(result).toMatchObject({
      kind: "failed",
      failure: {
        code: "EVIDENCE_AUTHORITY_MISMATCH",
        stage: "verify",
        retryable: false,
      },
    });
  });
});
