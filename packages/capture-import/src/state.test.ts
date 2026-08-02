import { describe, expect, it } from "vitest";

import {
  CaptureScenarioIdSchema,
  ImportJobSnapshotSchemaV2,
  type ImportJobDraftV2,
  type ImportJobSnapshotV2,
} from "@memi/protocol";

import {
  ImportTransitionError,
  createImportJobDraftV2,
  deriveImportProgressV2,
  isImportJobTerminal,
  transitionImportJobV2,
  type ImportJobTransitionV2,
} from "./index.js";

const hash = `sha256:${"a".repeat(64)}`;
const sourceRevision = "a".repeat(40);
const createdAt = "2026-07-29T10:00:00.000Z";
const jobId = "imp_01J00000000000000000000000";
const scenarioHome = "csc_01J00000000000000000000000";
const scenarioSettings = "csc_01J00000000000000000000001";
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function scenarioId(
  index: number,
): ReturnType<typeof CaptureScenarioIdSchema.parse> {
  const high = crockford[Math.floor(index / crockford.length)]!;
  const low = crockford[index % crockford.length]!;
  return CaptureScenarioIdSchema.parse(
    `csc_${"0".repeat(24)}${high}${low}`,
  );
}

function createDraft(): ImportJobDraftV2 {
  return createImportJobDraftV2({
    id: jobId,
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
    scenarios: [scenarioHome, scenarioSettings].map((id, index) => ({
      id,
      applicationId: "web",
      route: index === 0 ? "/" : "/settings",
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
        relativePath: index === 0
          ? "src/home.tsx"
          : "src/settings.tsx",
        symbol: null,
        contentHash: hash,
      },
    })),
    createdAt,
  });
}

function snapshot(
  value: ImportJobDraftV2,
  revision = 1,
  updatedAt = createdAt,
): ImportJobSnapshotV2 {
  return ImportJobSnapshotSchemaV2.parse({
    ...value,
    revision,
    updatedAt,
  });
}

function apply(
  transition: ImportJobTransitionV2,
  revision: number,
  at: string,
): ImportJobSnapshotV2 {
  return snapshot(transition.job, revision, at);
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
    return snapshot(result.job, current.revision + 1, current.updatedAt);
  }, job);
}

function artifact() {
  return {
    id: "art_01J00000000000000000000000",
    scenarioId: scenarioHome,
    screenshotArtifactId: "art_01J00000000000000000000001",
    hierarchyArtifactId: null,
    geometryArtifactId: null,
    screenshotHash: hash,
    sourceRevision,
    fixtureFingerprint: hash,
    dimensions: { width: 2_880, height: 1_800, scale: 2 },
    verification: {
      stableFrameHash: hash,
      routeMatched: true as const,
      blankRejected: true as const,
      splashRejected: true as const,
      errorBoundaryRejected: true as const,
      verifiedAt: "2026-07-29T10:01:00.000Z",
    },
  };
}

function failure(retryable = true) {
  return {
    scenarioId: scenarioSettings,
    code: "READINESS_TIMEOUT",
    stage: "capture" as const,
    message: "Settings did not become ready.",
    remediation: "Check the settings fixture.",
    logTail: [],
    retryable,
    occurredAt: "2026-07-29T10:02:00.000Z",
  };
}

function evidenceSnapshot(): ImportJobSnapshotV2 {
  const started = transitionImportJobV2(snapshot(createDraft()), {
    type: "start",
    expectedRevision: 1,
  });
  const running = advance(apply(
    started,
    2,
    "2026-07-29T10:00:01.000Z",
  ), [
    "inventory",
    "plan",
    "prepare-fixtures",
    "build",
    "launch",
    "capture",
  ]);
  const homeStarted = apply(
    transitionImportJobV2(running, {
      type: "scenario-started",
      expectedRevision: running.revision,
      scenarioId: scenarioHome,
    }),
    running.revision + 1,
    "2026-07-29T10:00:30.000Z",
  );
  const captured = transitionImportJobV2(homeStarted, {
    type: "scenario-captured",
    expectedRevision: homeStarted.revision,
    artifact: artifact(),
  });
  const afterCapture = apply(
    captured,
    homeStarted.revision + 1,
    "2026-07-29T10:01:00.000Z",
  );
  const settingsStarted = apply(
    transitionImportJobV2(afterCapture, {
      type: "scenario-started",
      expectedRevision: afterCapture.revision,
      scenarioId: scenarioSettings,
    }),
    afterCapture.revision + 1,
    "2026-07-29T10:01:30.000Z",
  );
  return apply(
    transitionImportJobV2(settingsStarted, {
      type: "scenario-failed",
      expectedRevision: settingsStarted.revision,
      failure: failure(),
    }),
    settingsStarted.revision + 1,
    "2026-07-29T10:02:00.000Z",
  );
}

function terminalSnapshot(): ImportJobSnapshotV2 {
  return advance(evidenceSnapshot(), ["extract-layers", "verify", "save"]);
}

describe("immutable import job transitions", () => {
  it("creates a frozen queued draft and starts without mutating it", () => {
    const before = createDraft();
    const transition = transitionImportJobV2(snapshot(before), {
      type: "start",
      expectedRevision: 1,
    });

    expect(before.state).toBe("queued");
    expect(transition).toMatchObject({
      expectedRevision: 1,
      job: { state: "running" },
    });
    expect(Object.isFrozen(transition.job)).toBe(true);
    expect(Object.isFrozen(transition.job.repository)).toBe(true);
  });

  it("persists an explicit pilot scope and otherwise retains all scenarios", () => {
    const all = createDraft();
    const pilot = createImportJobDraftV2({
      id: jobId,
      projectName: "Pilot",
      repository: all.repository,
      selectedHarness: null,
      applications: all.applications,
      scenarios: [all.scenarios[0]!],
      pilotScope: {
        sourceRevision,
        scenarioIds: [CaptureScenarioIdSchema.parse(scenarioHome)],
      },
      createdAt,
    });

    expect(all.pilotScope).toBeNull();
    expect(pilot.pilotScope).toEqual({
      sourceRevision,
      scenarioIds: [CaptureScenarioIdSchema.parse(scenarioHome)],
    });
    expect(() => createImportJobDraftV2({
      id: jobId,
      projectName: "Invalid pilot",
      repository: all.repository,
      selectedHarness: null,
      applications: all.applications,
      scenarios: [all.scenarios[0]!],
      pilotScope: {
        sourceRevision,
        scenarioIds: [CaptureScenarioIdSchema.parse(scenarioSettings)],
      },
      createdAt,
    })).toThrow();
  });

  it("derives truthful progress and terminal readiness from evidence", () => {
    const evidence = evidenceSnapshot();
    const job = terminalSnapshot();

    expect(evidence.state).toBe("running");
    expect(() => transitionImportJobV2(evidence, {
      type: "commit",
      expectedRevision: evidence.revision,
      projectId: "prj_01J00000000000000000000000",
    })).toThrow(/cannot commit/i);
    expect(deriveImportProgressV2(job)).toEqual({
      determinate: true,
      total: 2,
      captured: 1,
      failed: 1,
      remaining: 0,
      completionRatio: 1,
    });
    expect(job.state).toBe("ready-to-commit");
    expect(isImportJobTerminal(job)).toBe(true);
  });

  it("pauses cancellation safely and resumes the same work", () => {
    const running = apply(
      transitionImportJobV2(snapshot(createDraft()), {
        type: "start",
        expectedRevision: 1,
      }),
      2,
      "2026-07-29T10:00:01.000Z",
    );
    const paused = transitionImportJobV2(running, {
      type: "cancel",
      expectedRevision: 2,
      at: "2026-07-29T10:00:02.000Z",
    });
    const resumed = transitionImportJobV2(
      apply(paused, 3, "2026-07-29T10:00:02.000Z"),
      { type: "resume", expectedRevision: 3 },
    );

    expect(paused.job).toMatchObject({
      state: "paused",
      cancellationRequestedAt: "2026-07-29T10:00:02.000Z",
    });
    expect(resumed.job).toMatchObject({
      state: "running",
      cancellationRequestedAt: null,
    });
  });

  it("terminally discards a paused import so it cannot be recovered", () => {
    const running = apply(
      transitionImportJobV2(snapshot(createDraft()), {
        type: "start",
        expectedRevision: 1,
      }),
      2,
      "2026-07-29T10:00:01.000Z",
    );
    const paused = apply(
      transitionImportJobV2(running, {
        type: "cancel",
        expectedRevision: 2,
        at: "2026-07-29T10:00:02.000Z",
      }),
      3,
      "2026-07-29T10:00:02.000Z",
    );
    const discarded = transitionImportJobV2(paused, {
      type: "discard",
      expectedRevision: 3,
      at: "2026-07-29T10:00:03.000Z",
    });

    expect(discarded.job).toMatchObject({
      state: "cancelled",
      cancellationRequestedAt: "2026-07-29T10:00:03.000Z",
      currentApplicationId: null,
      currentScenarioId: null,
    });
    expect(() =>
      transitionImportJobV2(
        apply(discarded, 4, "2026-07-29T10:00:03.000Z"),
        { type: "resume", expectedRevision: 4 },
      ),
    ).toThrow(/cannot resume/i);
  });

  it("discards uncommitted terminal jobs but never a committed import", () => {
    const ready = terminalSnapshot();
    const failed = apply(
      transitionImportJobV2(
        apply(
          transitionImportJobV2(snapshot(createDraft()), {
            type: "start",
            expectedRevision: 1,
          }),
          2,
          "2026-07-29T10:00:01.000Z",
        ),
        {
          type: "fail",
          expectedRevision: 2,
          failure: {
            scenarioId: null,
            code: "PREPARATION_FAILED",
            stage: "prepare-fixtures",
            message: "The managed worktree could not be prepared.",
            remediation: "Discard this failed draft before a clean retry.",
            logTail: [],
            retryable: true,
            occurredAt: "2026-07-29T10:00:02.000Z",
          },
        },
      ),
      3,
      "2026-07-29T10:00:02.000Z",
    );
    const committed = apply(
      transitionImportJobV2(ready, {
        type: "commit",
        expectedRevision: ready.revision,
        projectId: "prj_01J00000000000000000000000",
      }),
      ready.revision + 1,
      "2026-07-29T10:00:03.000Z",
    );

    for (const terminal of [ready, failed]) {
      expect(
        transitionImportJobV2(terminal, {
          type: "discard",
          expectedRevision: terminal.revision,
          at: "2026-07-29T10:00:04.000Z",
        }).job.state,
      ).toBe("cancelled");
    }
    expect(() =>
      transitionImportJobV2(committed, {
        type: "discard",
        expectedRevision: committed.revision,
        at: "2026-07-29T10:00:04.000Z",
      }),
    ).toThrow(/cannot discard/i);
  });

  it("retries only selected retryable failures", () => {
    const terminal = terminalSnapshot();
    const retried = transitionImportJobV2(terminal, {
      type: "retry-failed",
      expectedRevision: terminal.revision,
      scenarioIds: [scenarioSettings],
    });

    expect(retried.job.state).toBe("running");
    expect(retried.job.artifacts).toHaveLength(1);
    expect(retried.job.failures).toHaveLength(0);
    expect(retried.job.progress).toEqual({
      total: 2,
      captured: 1,
      failed: 0,
      remaining: 1,
    });
  });

  it("commits only terminal evidence and binds the project atomically", () => {
    expect(() =>
      transitionImportJobV2(snapshot(createDraft()), {
        type: "commit",
        expectedRevision: 1,
        projectId: "prj_01J00000000000000000000000",
      }),
    ).toThrow(ImportTransitionError);

    const terminal = terminalSnapshot();
    const committed = transitionImportJobV2(terminal, {
      type: "commit",
      expectedRevision: terminal.revision,
      projectId: "prj_01J00000000000000000000000",
    });
    expect(committed.job).toMatchObject({
      state: "committed",
      stage: "save",
      projectId: "prj_01J00000000000000000000000",
    });
  });

  it("keeps 71 exact terminal failures retryable and rejects an empty project commit", () => {
    const scenarios = Array.from({ length: 71 }, (_, index) => ({
      applicationId: "web",
      authContext: null,
      fixtureProfile: "default",
      id: scenarioId(index),
      parameters: [],
      readinessSelector: "[data-memi-ready]",
      route: `/screen-${index}`,
      sourceAnchor: {
        contentHash: hash,
        relativePath: `src/screens/screen-${index}.tsx`,
        symbol: null,
      },
      state: "Default",
      viewport: {
        height: 900,
        name: "Desktop",
        scale: 2,
        width: 1_440,
      },
    }));
    const failures = scenarios.map((scenario, index) => ({
      code: index < 37 ? "PREPARATION_FAILED" : "FIXTURE_REQUIRED",
      logTail: [`failure evidence ${index}`],
      message:
        index < 37
          ? "Native command exited unsuccessfully (1)."
          : "The dynamic route has no deterministic fixture.",
      occurredAt: "2026-07-29T10:02:00.000Z",
      remediation:
        index < 37
          ? "Confirm the managed worktree and deterministic fixture recipe."
          : "Provide fixture parameters through the selected harness and retry this scenario.",
      retryable: true,
      scenarioId: CaptureScenarioIdSchema.parse(scenario.id),
      stage: "prepare-fixtures" as const,
    }));
    const draft = createImportJobDraftV2({
      id: jobId,
      projectName: "All failed",
      repository: {
        rootPath: "/managed/all-failed",
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
      scenarios,
      createdAt,
    });
    const verified = snapshot({
      ...draft,
      failures,
      progress: {
        captured: 0,
        failed: 71,
        remaining: 0,
        total: 71,
      },
      stage: "verify",
      state: "running",
    });
    const terminal = apply(
      transitionImportJobV2(verified, {
        type: "advance-stage",
        expectedRevision: verified.revision,
        stage: "save",
      }),
      verified.revision + 1,
      createdAt,
    );

    expect(terminal).toMatchObject({
      artifacts: [],
      failures,
      progress: {
        captured: 0,
        failed: 71,
        remaining: 0,
        total: 71,
      },
      projectId: null,
      state: "failed",
    });
    expect(() =>
      transitionImportJobV2(terminal, {
        type: "commit",
        expectedRevision: terminal.revision,
        projectId: "prj_01J00000000000000000000000",
      }),
    ).toThrow(/cannot commit/i);
    const forgedReady = snapshot(
      { ...terminal, state: "ready-to-commit" },
      terminal.revision + 1,
      terminal.updatedAt,
    );
    expect(() =>
      transitionImportJobV2(forgedReady, {
        type: "commit",
        expectedRevision: forgedReady.revision,
        projectId: "prj_01J00000000000000000000000",
      }),
    ).toThrow(/at least one verified capture/i);

    const retried = transitionImportJobV2(terminal, {
      type: "retry-failed",
      expectedRevision: terminal.revision,
    });
    expect(retried.job).toMatchObject({
      artifacts: [],
      failures: [],
      progress: {
        captured: 0,
        failed: 0,
        remaining: 71,
        total: 71,
      },
      projectId: null,
      state: "running",
    });
  });

  it("rejects stale revisions and backward stages", () => {
    const queued = snapshot(createDraft());
    expect(() =>
      transitionImportJobV2(queued, {
        type: "start",
        expectedRevision: 9,
      }),
    ).toThrow(/stale revision/i);

    const running = apply(
      transitionImportJobV2(queued, {
        type: "start",
        expectedRevision: 1,
      }),
      2,
      "2026-07-29T10:00:01.000Z",
    );
    const inventory = apply(
      transitionImportJobV2(running, {
        type: "advance-stage",
        expectedRevision: 2,
        stage: "inventory",
      }),
      3,
      "2026-07-29T10:00:02.000Z",
    );
    expect(inventory.checkpoints).toContain("validate");
    expect(() =>
      transitionImportJobV2(inventory, {
        type: "advance-stage",
        expectedRevision: 3,
        stage: "validate",
      }),
    ).toThrow(/backward/i);
  });

});
