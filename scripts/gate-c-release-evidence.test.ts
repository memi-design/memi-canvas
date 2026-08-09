import { describe, expect, it } from "vitest";

import {
  createGateCReleaseEvidenceManifest,
  parseGateCReleasePilotEvents,
} from "./gate-c-release-evidence.js";

const sourceRevision = "a6ce2458e0cd1b252663057f2e4060f0929c0687";
const screenshotHash = `sha256:${"a".repeat(64)}` as const;

function artifact() {
  return {
    captureId: "art_01J00000000000000000000001",
    scenarioId: "csc_01J00000000000000000000001",
    route: "/sign-in",
    state: "default",
    sourceRevision,
    dimensions: { width: 1206, height: 2622, scale: 3 },
    verification: {
      stableFrameHash: screenshotHash,
      routeMatched: true,
      blankRejected: true,
      splashRejected: true,
      errorBoundaryRejected: true,
      verifiedAt: "2026-08-08T21:04:00.000Z",
    },
    screenshot: {
      hash: screenshotHash,
      bytes: 2_790_000,
      extension: "png",
    },
    hierarchy: {
      hash: `sha256:${"b".repeat(64)}` as const,
      bytes: 12_000,
      extension: "csv",
    },
    geometry: {
      hash: `sha256:${"c".repeat(64)}` as const,
      bytes: 10_000,
      extension: "json",
    },
    reconstruction: {
      hash: `sha256:${"d".repeat(64)}` as const,
      bytes: 185_929,
      extension: "json",
    },
  } as const;
}

function input() {
  return {
    projectId: "prj_01J00000000000000000000001",
    jobId: "imp_01J00000000000000000000001",
    jobRevision: 18,
    sourceRevision,
    dirtyFingerprint: `sha256:${"e".repeat(64)}` as const,
    completedAt: "2026-08-08T21:05:00.000Z",
    progress: { total: 1, captured: 1, failed: 0, remaining: 0 },
    hydration: { artifacts: 1, components: 250, screens: 142 },
    artifacts: [artifact()],
    databaseReceipts: [
      {
        name: "imports.sqlite",
        hash: `sha256:${"f".repeat(64)}` as const,
        bytes: 1_048_576,
      },
    ],
  } as const;
}

describe("Gate C release evidence", () => {
  it("requires one committed pilot event", () => {
    const committed = JSON.stringify({
      event: "committed",
      jobId: "imp_01J00000000000000000000001",
      projectId: "prj_01J00000000000000000000001",
      state: "committed",
    });

    expect(parseGateCReleasePilotEvents(`${committed}\n`)).toEqual({
      jobId: "imp_01J00000000000000000000001",
      projectId: "prj_01J00000000000000000000001",
    });
    expect(() =>
      parseGateCReleasePilotEvents(
        `${JSON.stringify({ event: "terminal", state: "failed" })}\n`,
      ),
    ).toThrow(/committed/u);
  });

  it("creates a sanitized hash-only manifest for real native evidence", () => {
    const manifest = createGateCReleaseEvidenceManifest(input());
    const serialized = JSON.stringify(manifest);

    expect(manifest.schema).toBe("memi.gate-c-release-evidence.v1");
    expect(manifest.artifacts).toHaveLength(1);
    expect(manifest.artifacts[0]?.screenshot.hash).toBe(screenshotHash);
    expect(manifest.hydration).toEqual({
      artifacts: 1,
      components: 250,
      screens: 142,
    });
    expect(serialized).not.toMatch(/Users|Volumes|rootPath|repositoryPath/u);
    expect(serialized).not.toContain("capture-artifacts");
  });

  it.each(["hierarchy", "geometry", "reconstruction"] as const)(
    "rejects missing %s authority",
    (field) => {
      const current = artifact();
      const incomplete = {
        ...input(),
        artifacts: [{ ...current, [field]: null }],
      };

      expect(() =>
        createGateCReleaseEvidenceManifest(incomplete),
      ).toThrow(new RegExp(field, "u"));
    },
  );

  it("rejects zero captures and contradictory stable-frame evidence", () => {
    expect(() =>
      createGateCReleaseEvidenceManifest({
        ...input(),
        artifacts: [],
        hydration: { artifacts: 0, components: 0, screens: 0 },
        progress: { total: 0, captured: 0, failed: 0, remaining: 0 },
      }),
    ).toThrow(/native capture/u);
    expect(() =>
      createGateCReleaseEvidenceManifest({
        ...input(),
        artifacts: [
          {
            ...artifact(),
            verification: {
              ...artifact().verification,
              stableFrameHash: `sha256:${"0".repeat(64)}` as const,
            },
          },
        ],
      }),
    ).toThrow(/stable-frame/u);
  });
});
