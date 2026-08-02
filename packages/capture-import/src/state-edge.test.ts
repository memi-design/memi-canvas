import { describe, expect, it } from "vitest";
import {
  ImportJobSnapshotSchemaV2,
  type ImportJobDraftV2,
  type ImportJobSnapshotV2,
} from "@memi/protocol";
import {
  createImportJobDraftV2,
  deriveImportProgressV2,
  isImportJobTerminal,
  transitionImportJobV2,
} from "./index.js";

const hash = `sha256:${"a".repeat(64)}`;
const sourceRevision = "a".repeat(40);
const at = "2026-07-29T10:00:00.000Z";
const home = "csc_01J00000000000000000000000";
const settings = "csc_01J00000000000000000000001";

function draft(): ImportJobDraftV2 {
  return createImportJobDraftV2({
    id: "imp_01J00000000000000000000000",
    projectName: "Demo",
    repository: {
      rootPath: "/managed/demo",
      sourceRevision,
      dirtyFingerprint: hash,
    },
    selectedHarness: null,
    applications: [{
      id: "web",
      label: "Web",
      platform: "react-web",
      relativeRoot: ".",
    }],
    scenarios: [home, settings].map((id, index) => ({
      id,
      applicationId: "web",
      route: index === 0 ? "/" : "/settings",
      state: "Default",
      viewport: { name: "Desktop", width: 1440, height: 900, scale: 2 },
      authContext: null,
      parameters: [],
      fixtureProfile: "default",
      readinessSelector: "[data-memi-ready]",
      sourceAnchor: {
        relativePath: index === 0 ? "src/home.tsx" : "src/settings.tsx",
        symbol: null,
        contentHash: hash,
      },
    })),
    createdAt: at,
  });
}

function snap(
  job: ImportJobDraftV2,
  revision = 1,
  updatedAt = at,
): ImportJobSnapshotV2 {
  return ImportJobSnapshotSchemaV2.parse({ ...job, revision, updatedAt });
}

function running(): ImportJobSnapshotV2 {
  const result = transitionImportJobV2(snap(draft()), {
    type: "start",
    expectedRevision: 1,
  });
  return snap(result.job, 2, "2026-07-29T10:00:01.000Z");
}

function advance(
  job: ImportJobSnapshotV2,
  stages: readonly ImportJobDraftV2["stage"][],
): ImportJobSnapshotV2 {
  return stages.reduce((current, stage) => {
    const result = transitionImportJobV2(current, {
      type: "advance-stage",
      expectedRevision: current.revision,
      stage,
    });
    return snap(result.job, current.revision + 1, current.updatedAt);
  }, job);
}

function failure(retryable = true) {
  return {
    scenarioId: settings,
    code: "READINESS_TIMEOUT",
    stage: "capture" as const,
    message: "Settings did not become ready.",
    remediation: "Check the settings fixture.",
    logTail: [],
    retryable,
    occurredAt: "2026-07-29T10:02:00.000Z",
  };
}

function terminal(retryable = true): ImportJobSnapshotV2 {
  const job = advance(running(), [
    "inventory",
    "plan",
    "prepare-fixtures",
    "build",
    "launch",
    "capture",
  ]);
  const homeStarted = transitionImportJobV2(job, {
    type: "scenario-started",
    expectedRevision: job.revision,
    scenarioId: home,
  });
  const activeHome = snap(
    homeStarted.job,
    job.revision + 1,
    "2026-07-29T10:00:30.000Z",
  );
  const captured = transitionImportJobV2(activeHome, {
    type: "scenario-captured",
    expectedRevision: activeHome.revision,
    artifact: {
      id: "art_01J00000000000000000000000",
      scenarioId: home,
      screenshotArtifactId: "art_01J00000000000000000000001",
      hierarchyArtifactId: null,
      geometryArtifactId: null,
      screenshotHash: hash,
      sourceRevision,
      fixtureFingerprint: hash,
      dimensions: { width: 2880, height: 1800, scale: 2 },
      verification: {
        stableFrameHash: hash,
        routeMatched: true,
        blankRejected: true,
        splashRejected: true,
        errorBoundaryRejected: true,
        verifiedAt: "2026-07-29T10:01:00.000Z",
      },
    },
  });
  const afterCapture = snap(
    captured.job,
    activeHome.revision + 1,
    "2026-07-29T10:01:00.000Z",
  );
  const settingsStarted = transitionImportJobV2(afterCapture, {
    type: "scenario-started",
    expectedRevision: afterCapture.revision,
    scenarioId: settings,
  });
  const activeSettings = snap(
    settingsStarted.job,
    afterCapture.revision + 1,
    "2026-07-29T10:01:30.000Z",
  );
  const failed = transitionImportJobV2(activeSettings, {
    type: "scenario-failed",
    expectedRevision: activeSettings.revision,
    failure: failure(retryable),
  });
  return advance(
    snap(
      failed.job,
      activeSettings.revision + 1,
      "2026-07-29T10:02:00.000Z",
    ),
    ["extract-layers", "verify", "save"],
  );
}

describe("import transition edge cases", () => {
  it("reports an empty inventory as indeterminate and active", () => {
    const empty = createImportJobDraftV2({
      ...draft(),
      applications: [],
      scenarios: [],
      createdAt: at,
    });
    expect(deriveImportProgressV2(empty)).toMatchObject({
      determinate: false,
      total: 0,
      completionRatio: 0,
    });
    expect(isImportJobTerminal(empty)).toBe(false);
  });

  it("tracks current work and rejects unknown or resolved scenarios", () => {
    const activeResult = transitionImportJobV2(running(), {
      type: "scenario-started",
      expectedRevision: 2,
      scenarioId: home,
    });
    const active = snap(activeResult.job, 3, "2026-07-29T10:00:02.000Z");
    expect(active.currentScenarioId).toBe(home);
    expect(() => transitionImportJobV2(active, {
      type: "scenario-started",
      expectedRevision: 3,
      scenarioId: settings,
    })).toThrow(/already active/i);
    expect(() => transitionImportJobV2(active, {
      type: "scenario-failed",
      expectedRevision: 3,
      failure: failure(),
    })).toThrow(/does not match active/i);
    expect(() => transitionImportJobV2(active, {
      type: "scenario-started",
      expectedRevision: 3,
      scenarioId: "csc_01J00000000000000000000009",
    })).toThrow(/unknown capture scenario/i);
    expect(() => transitionImportJobV2(running(), {
      type: "scenario-failed",
      expectedRevision: 2,
      failure: failure(),
    })).toThrow(/no active scenario/i);
    expect(() => transitionImportJobV2(terminal(), {
      type: "scenario-started",
      expectedRevision: terminal().revision,
      scenarioId: home,
    })).toThrow(/ready-to-commit/i);
  });

  it("logs activity and records a terminal job-level failure", () => {
    const loggedResult = transitionImportJobV2(snap(draft()), {
      type: "append-log",
      expectedRevision: 1,
      entry: {
        level: "info",
        message: "Validated repository.",
        occurredAt: "2026-07-29T10:00:01.000Z",
      },
    });
    const logged = snap(loggedResult.job, 2, "2026-07-29T10:00:01.000Z");
    const failed = transitionImportJobV2(logged, {
      type: "fail",
      expectedRevision: 2,
      failure: { ...failure(), scenarioId: null },
    });
    expect(logged.logs.at(-1)?.message).toBe("Validated repository.");
    expect(isImportJobTerminal(failed.job)).toBe(true);
  });

  it("rejects scenario-less failures and nonretryable retries", () => {
    expect(() => transitionImportJobV2(running(), {
      type: "scenario-failed",
      expectedRevision: 2,
      failure: { ...failure(), scenarioId: null },
    })).toThrow(/must identify/i);
    const nonretryable = terminal(false);
    expect(() => transitionImportJobV2(nonretryable, {
      type: "retry-failed",
      expectedRevision: nonretryable.revision,
    })).toThrow(/no retryable/i);
    expect(() => transitionImportJobV2(nonretryable, {
      type: "retry-failed",
      expectedRevision: nonretryable.revision,
      scenarioIds: [settings],
    })).toThrow(/not retryable/i);
    expect(() => transitionImportJobV2(running(), {
      type: "fail",
      expectedRevision: 2,
      failure: failure(),
    })).toThrow(/job-level failures cannot identify/i);
  });

  it("rejects skipped pipeline stages", () => {
    expect(() => transitionImportJobV2(running(), {
      type: "advance-stage",
      expectedRevision: 2,
      stage: "plan",
    })).toThrow(/cannot be skipped/i);
  });

  it("does not restart a scenario that already failed", () => {
    const started = transitionImportJobV2(running(), {
      type: "scenario-started",
      expectedRevision: 2,
      scenarioId: settings,
    });
    const active = snap(
      started.job,
      3,
      "2026-07-29T10:01:30.000Z",
    );
    const failed = transitionImportJobV2(active, {
      type: "scenario-failed",
      expectedRevision: 3,
      failure: failure(),
    });
    const afterFailure = snap(
      failed.job,
      4,
      "2026-07-29T10:02:00.000Z",
    );
    expect(() => transitionImportJobV2(afterFailure, {
      type: "scenario-started",
      expectedRevision: 4,
      scenarioId: settings,
    })).toThrow(/terminal evidence/i);
  });
});
