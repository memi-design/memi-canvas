import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const artifactId = "art_01J00000000000000000000000";
  const reconstructionArtifactId =
    "art_01J00000000000000000000001";
  const review = {
    confidenceByNodeId: {},
    differenceOverlayNodeId: null,
    differenceOverlayVisible: false,
    evidenceNodeId: "evidence",
    fidelity: null,
    frameId: "frame",
    reviewStatus: "needs-review" as const,
    scenarioId: "scenario",
  };
  const record = {
    capture: {
      artifactReferences: {
        [artifactId]: {
          alt: "Runtime evidence",
          capturedAt: "2026-07-29T12:00:00.000Z",
          sourceUrl: "memi-source://repository/src/Home.tsx",
          src: `/imports/artifacts/${artifactId}.png`,
        },
      },
      job: {
        artifacts: [{ id: artifactId, reconstructionArtifactId }],
      },
    },
    harnessId: "deterministic-import",
    manifest: {},
  };
  return { artifactId, reconstructionArtifactId, record, review };
});

vi.mock("../canvas/CanvasWorkbench.js", () => ({
  CanvasWorkbench: ({ reconstructionReviews }: {
    readonly reconstructionReviews?: readonly unknown[];
  }) => (
    <output aria-label="Reconstruction count">
      {reconstructionReviews?.length ?? 0}
    </output>
  ),
}));

vi.mock(
  "../imports/repository/repository-project-persistence.js",
  () => ({
    createRepositoryProjectPersistence: () => ({
      load: () => fixture.record,
    }),
  }),
);

vi.mock(
  "../imports/repository/repository-capture-workbench.js",
  () => ({
    createCapturedRepositoryCanvasProject: (input: {
      readonly artifactReference: (artifact: { readonly id: string }) => {
        readonly reconstructionReview?: unknown;
      };
      readonly projectId: string;
    }) => {
      const reference = input.artifactReference({ id: fixture.artifactId });
      return {
        document: {
          id: `document-${input.projectId}`,
          nodes: [],
          revision: 1,
        },
        failureCards: [],
        harness: { options: [], selectedId: "deterministic-import" },
        id: input.projectId,
        importState: { sequence: 1, state: "ready" },
        reconstructions:
          reference.reconstructionReview === undefined
            ? []
            : [fixture.review],
        selectedNodeId: null,
        title: "Imported project",
        trace: [],
      };
    },
  }),
);

vi.mock(
  "../imports/repository/repository-reconstruction-rehydration.js",
  () => ({
    rehydrateRepositoryProjectRecord: async (
      record: typeof fixture.record,
      loader: (artifactId: string) => Promise<unknown>,
    ) => {
      await loader(fixture.reconstructionArtifactId);
      return {
        ...record,
        capture: {
          ...record.capture,
          artifactReferences: {
            [fixture.artifactId]: {
              ...record.capture.artifactReferences[
                fixture.artifactId as keyof typeof record.capture.artifactReferences
              ],
              reconstruction: { schemaVersion: 1 },
              reconstructionReview: { schemaVersion: 1 },
            },
          },
        },
      };
    },
  }),
);

import { LocalDesignConsumer } from "./LocalDesignConsumer.js";
import type { ProjectRecord } from "./project-library.js";

const project: ProjectRecord = {
  archived: false,
  documentRef: "canvas:repository-design",
  id: "repository-design",
  kind: "design",
  name: "Repository design",
  source: {
    componentCount: 1,
    fileCount: 2,
    harnessId: "deterministic-import",
    kind: "repository",
    label: "team/repository-design",
    platform: "react-web",
    rootPath: "/Projects/repository-design",
    screenCount: 1,
  },
  updatedAt: "2026-07-29T12:00:00.000Z",
};

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}

describe("LocalDesignConsumer reconstruction recovery", () => {
  it("rehydrates review metadata from the artifact loader without persisting artifact bytes", async () => {
    const storage = createStorage();
    const loader = vi.fn(async () => ({ schemaVersion: 1 }));

    render(
      <LocalDesignConsumer
        onExit={() => {}}
        project={project}
        reconstructionArtifactLoader={loader}
        storage={storage}
      />,
    );

    expect(screen.getByLabelText("Reconstruction count").textContent).toBe("0");
    await waitFor(() => {
      expect(screen.getByLabelText("Reconstruction count").textContent).toBe("1");
    });
    expect(loader).toHaveBeenCalledWith(fixture.reconstructionArtifactId);
    expect([...storage.values.values()].join(" ")).not.toContain(
      "reconstructionReview",
    );
  });
});
