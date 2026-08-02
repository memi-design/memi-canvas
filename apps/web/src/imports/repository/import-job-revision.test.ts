import { describe, expect, it } from "vitest";
import {
  ImportJobSnapshotSchemaV2,
  type ImportJobSnapshotV2,
} from "@memi/protocol";

import {
  acceptsImportJobSnapshot,
  selectLatestImportJob,
} from "./import-job-revision.js";

function job(input: {
  readonly id?: string;
  readonly revision: number;
  readonly rootPath?: string;
}): ImportJobSnapshotV2 {
  return ImportJobSnapshotSchemaV2.parse({
    applications: [],
    artifacts: [],
    cancellationRequestedAt: null,
    checkpoints: [],
    createdAt: "2026-07-31T12:00:00.000Z",
    currentApplicationId: null,
    currentScenarioId: null,
    failures: [],
    id: input.id ?? "imp_01J00000000000000000000000",
    kind: "memi-import-job",
    logs: [],
    managedWorktreeId: null,
    progress: { captured: 0, failed: 0, remaining: 0, total: 0 },
    projectId: null,
    projectName: "Fixture",
    repository: {
      dirtyFingerprint: null,
      rootPath: input.rootPath ?? "/Projects/fixture",
      sourceRevision: "a".repeat(40),
    },
    revision: input.revision,
    scenarios: [],
    selectedHarness: null,
    stage: "validate",
    state: "queued",
    updatedAt: `2026-07-31T12:00:0${input.revision}.000Z`,
  });
}

describe("import job revision selection", () => {
  it("accepts the first snapshot and a newer revision", () => {
    const first = job({ revision: 1 });
    const newer = job({ revision: 2 });

    expect(selectLatestImportJob(undefined, first)).toBe(first);
    expect(selectLatestImportJob(first, newer)).toBe(newer);
  });

  it("rejects delayed and authority-changing snapshots", () => {
    const current = job({ revision: 2 });

    expect(selectLatestImportJob(current, job({ revision: 1 }))).toBe(current);
    expect(
      selectLatestImportJob(
        current,
        job({ id: "imp_01J00000000000000000000001", revision: 3 }),
      ),
    ).toBe(current);
    expect(
      selectLatestImportJob(
        current,
        job({ revision: 3, rootPath: "/Projects/substituted" }),
      ),
    ).toBe(current);
  });

  it("accepts an identical same-revision materialization but rejects divergence", () => {
    const current = job({ revision: 2 });
    const identical = job({ revision: 2 });
    const divergent = {
      ...identical,
      logs: [{
        level: "info" as const,
        message: "Divergent",
        occurredAt: "2026-07-31T12:00:02.000Z",
      }],
    };

    expect(acceptsImportJobSnapshot(current, identical)).toBe(true);
    expect(acceptsImportJobSnapshot(current, divergent)).toBe(false);
  });
});
