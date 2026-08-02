import type {
  ImportApplicationV2,
} from "@memi/protocol";
import {
  CaptureScenarioSchemaV2,
  ImportJobSnapshotSchemaV2,
} from "@memi/protocol";

const hash = `sha256:${"a".repeat(64)}` as const;

export const applicationFixture: ImportApplicationV2 = {
  id: "web",
  label: "Web",
  platform: "react-web",
  relativeRoot: ".",
};

export const scenarioFixture = CaptureScenarioSchemaV2.parse({
  id: "csc_01J00000000000000000000000",
  applicationId: "web",
  route: "/dashboard",
  state: "Default",
  viewport: {
    name: "Desktop",
    width: 1_440,
    height: 900,
    scale: 1,
  },
  authContext: null,
  parameters: [],
  fixtureProfile: "default",
  readinessSelector: "[data-memi-ready]",
  sourceAnchor: null,
});

export const jobFixture = ImportJobSnapshotSchemaV2.parse({
  kind: "memi-import-job",
  id: "imp_01J00000000000000000000000",
  projectId: null,
  projectName: "Fixture",
  state: "running",
  stage: "capture",
  repository: {
    rootPath: "/tmp/source",
    sourceRevision: "a".repeat(40),
    dirtyFingerprint: hash,
  },
  managedWorktreeId: null,
  selectedHarness: null,
  applications: [applicationFixture],
  scenarios: [scenarioFixture],
  artifacts: [],
  failures: [],
  progress: { total: 1, captured: 0, failed: 0, remaining: 1 },
  currentApplicationId: "web",
  currentScenarioId: scenarioFixture.id,
  checkpoints: ["validate", "inventory", "plan"],
  logs: [],
  cancellationRequestedAt: null,
  createdAt: "2026-07-29T10:00:00.000Z",
  revision: 1,
  updatedAt: "2026-07-29T10:00:00.000Z",
});
