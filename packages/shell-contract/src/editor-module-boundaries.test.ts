import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const MAX_PRODUCTION_MODULE_LINES = 800;
const PRODUCTION_EDITOR_MODULES = [
  "apps/web/src/canvas/CanvasWorkbench.tsx",
  "apps/web/src/canvas/workspace-dock.tsx",
  "apps/web/src/canvas/model.ts",
  "apps/web/src/canvas/canvas-runtime-port.ts",
] as const;

describe("production editor module boundaries", () => {
  it.each(PRODUCTION_EDITOR_MODULES)(
    "keeps %s below the 800-line architecture ceiling",
    async (path) => {
      const source = await readFile(path, "utf8");
      const lineCount = source.split(/\r?\n/u).length;

      expect(lineCount, `${path} has ${lineCount} lines`).toBeLessThanOrEqual(
        MAX_PRODUCTION_MODULE_LINES,
      );
    },
  );

  it("uses the canonical operation store instead of the legacy snapshot command bridge", async () => {
    const workbench = await readFile(
      "apps/web/src/canvas/CanvasWorkbench.tsx",
      "utf8",
    );

    expect(workbench).not.toMatch(
      /createSceneCommandAdapter|sceneReducer/u,
    );
  });

  it("delegates reconstruction review projection and navigation filtering", async () => {
    const [workbench, reconstructionWorkspace] = await Promise.all([
      readFile("apps/web/src/canvas/CanvasWorkbench.tsx", "utf8"),
      readFile(
        "apps/web/src/canvas/reconstruction-review-workspace.tsx",
        "utf8",
      ),
    ]);

    expect(workbench).toContain("useReconstructionReviewWorkspace");
    expect(workbench).not.toMatch(
      /projectDifferenceOverlayVisibility|findSelectedReconstructionReview/u,
    );
    expect(reconstructionWorkspace).toContain(
      "reconstructionWorkspaceFiles",
    );
    expect(reconstructionWorkspace).toContain(
      "projectDifferenceOverlayVisibility",
    );
  });

  it("keeps the deterministic runtime behind an explicit test-only dynamic boundary", async () => {
    const [main, consumer] = await Promise.all([
      readFile("apps/web/src/main.tsx", "utf8"),
      readFile("apps/web/src/projects/LocalDesignConsumer.tsx", "utf8"),
    ]);

    expect(main).not.toMatch(
      /^import .*createDemoCanvasRuntimePort/mu,
    );
    expect(main).toContain('search.get("runtime") === "demo"');
    expect(consumer).not.toContain("createDemoCanvasRuntimePort");
  });

  it("keeps browser SceneState autosave outside the production editor authority", async () => {
    const [consumer, agentReview] = await Promise.all([
      readFile("apps/web/src/projects/LocalDesignConsumer.tsx", "utf8"),
      readFile(
        "apps/web/src/canvas/workbench-agent-review-actions.ts",
        "utf8",
      ),
    ]);

    expect(consumer).not.toMatch(
      /createCanvasAutosave|\bpersistence=\{persistence\}/u,
    );
    expect(consumer).toContain("migrateLegacyWorkspaceSession");
    expect(consumer).toContain(
      "createRuntimeClientCanvasDocumentPersistence",
    );
    expect(consumer).toContain("v3Session");
    expect(agentReview).not.toContain("context.commitScene(");
  });
});
