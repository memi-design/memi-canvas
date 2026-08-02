import { describe, expect, it } from "vitest";

import { ImportJobSnapshotSchemaV2 } from "@memi/protocol";

import { repositoryImportJobView } from "./repository-capture-runtime.js";

const now = "2026-07-29T12:00:00.000Z";

describe("repository capture runtime view", () => {
  it("projects precise runtime progress and scenario failures for the UI", () => {
    const job = ImportJobSnapshotSchemaV2.parse({
      applications: [
        {
          id: "northstar-web",
          label: "Northstar web",
          platform: "react-web",
          relativeRoot: ".",
        },
      ],
      artifacts: [],
      cancellationRequestedAt: null,
      checkpoints: ["validate", "inventory", "plan"],
      createdAt: now,
      currentApplicationId: "northstar-web",
      currentScenarioId: "csc_01J00000000000000000000000",
      failures: [
        {
          code: "READINESS_TIMEOUT",
          logTail: ["Waiting for [data-ready]"],
          message: "Home did not become ready.",
          occurredAt: now,
          remediation: "Add a readiness marker and retry.",
          retryable: true,
          scenarioId: "csc_01J00000000000000000000000",
          stage: "capture",
        },
      ],
      id: "imp_01J00000000000000000000000",
      kind: "memi-import-job",
      logs: [
        {
          level: "info",
          message: "Capturing Northstar web.",
          occurredAt: now,
        },
      ],
      managedWorktreeId: null,
      progress: { captured: 0, failed: 1, remaining: 0, total: 1 },
      projectId: null,
      projectName: "Northstar",
      repository: {
        dirtyFingerprint: null,
        rootPath: "/Projects/northstar",
        sourceRevision: "a".repeat(40),
      },
      revision: 3,
      scenarios: [
        {
          applicationId: "northstar-web",
          authContext: null,
          fixtureProfile: "deterministic-local",
          id: "csc_01J00000000000000000000000",
          parameters: [],
          readinessSelector: "[data-ready]",
          route: "/",
          sourceAnchor: {
            contentHash: `sha256:${"b".repeat(64)}`,
            relativePath: "src/pages/Home.tsx",
            symbol: "Home",
          },
          state: "default",
          viewport: {
            height: 800,
            name: "desktop",
            scale: 1,
            width: 1280,
          },
        },
      ],
      selectedHarness: null,
      stage: "capture",
      state: "running",
      updatedAt: now,
    });

    expect(
      repositoryImportJobView(job, Date.parse(now) + 8_000),
    ).toEqual({
      activity: "Capturing Northstar web.",
      currentApplication: "Northstar web",
      currentScenario: "/ · default",
      elapsedMs: 8_000,
      failures: [
        {
          code: "READINESS_TIMEOUT",
          id: "csc_01J00000000000000000000000:READINESS_TIMEOUT",
          message: "Home did not become ready.",
          remediation: "Add a readiness marker and retry.",
          retryable: true,
          route: "/",
          sourcePath: "src/pages/Home.tsx",
          state: "default",
        },
      ],
      id: "imp_01J00000000000000000000000",
      progress: { captured: 0, failed: 1, remaining: 0, total: 1 },
      stage: "capture",
      state: "running",
    });
  });
});
