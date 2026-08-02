import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { importExpoRouterProject } from "./index.js";
import {
  cleanupExpoRouterFixtures,
  createExpoRouterFixture,
  expectSentinelAbsent,
  TEST_BUDGETS,
  TEST_REPOSITORY,
} from "./test-support.js";

const UNAVAILABLE_CAPTURE = {
  kind: "unavailable",
  reason: "No trusted Expo web runtime was supplied.",
} as const;

afterEach(cleanupExpoRouterFixtures);

function importFixture(rootDir: string) {
  return importExpoRouterProject({
    rootDir,
    repository: TEST_REPOSITORY,
    budgets: TEST_BUDGETS,
    runtimeCapture: UNAVAILABLE_CAPTURE,
  });
}

describe("importExpoRouterProject", () => {
  it("normalizes grouped and dynamic routes while preserving identity for URL collisions", async () => {
    const fixture = await createExpoRouterFixture();
    const imported = await importFixture(fixture.root);

    expect(
      imported.routes.map((route) => ({
        kind: route.kind,
        sourcePath: route.sourcePath,
        normalizedPath: route.normalizedPath,
        groups: route.groups,
        parameters: route.parameters,
      })),
    ).toEqual([
      {
        kind: "screen",
        sourcePath: "app/(auth)/index.tsx",
        normalizedPath: "/",
        groups: ["auth"],
        parameters: [],
      },
      {
        kind: "screen",
        sourcePath: "app/(auth)/sign-in.tsx",
        normalizedPath: "/sign-in",
        groups: ["auth"],
        parameters: [],
      },
      {
        kind: "screen",
        sourcePath: "app/(protected)/(tabs)/game/[gameId].tsx",
        normalizedPath: "/game/:gameId",
        groups: ["protected", "tabs"],
        parameters: [{ kind: "dynamic", name: "gameId" }],
      },
      {
        kind: "screen",
        sourcePath: "app/index.tsx",
        normalizedPath: "/",
        groups: [],
        parameters: [],
      },
      {
        kind: "screen",
        sourcePath: "app/search/[...query].tsx",
        normalizedPath: "/search/:query*",
        groups: [],
        parameters: [{ kind: "catch-all", name: "query" }],
      },
      {
        kind: "screen",
        sourcePath: "app/team/[league]/[teamId]/index.tsx",
        normalizedPath: "/team/:league/:teamId",
        groups: [],
        parameters: [
          { kind: "dynamic", name: "league" },
          { kind: "dynamic", name: "teamId" },
        ],
      },
    ]);
    const collidingRoutes = imported.routes.filter(
      (route) => route.normalizedPath === "/",
    );
    expect(collidingRoutes.map((route) => route.sourcePath)).toEqual([
      "app/(auth)/index.tsx",
      "app/index.tsx",
    ]);
    expect(new Set(collidingRoutes.map((route) => route.routeId)).size).toBe(2);
    expect(imported.sourceAnchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "layout",
          sourcePath: "app/_layout.tsx",
        }),
        expect.objectContaining({
          kind: "html-shell",
          sourcePath: "app/+html.tsx",
        }),
        expect.objectContaining({
          kind: "not-found",
          sourcePath: "app/+not-found.tsx",
        }),
        expect.objectContaining({
          kind: "api-route",
          sourcePath: "app/api/health+api.ts",
        }),
      ]),
    );
  });

  it("does not execute project config and rejects source escaping through a symlink", async () => {
    const fixture = await createExpoRouterFixture();

    await importFixture(fixture.root);
    await expectSentinelAbsent(fixture.sentinel);

    await symlink("/etc/hosts", join(fixture.root, "app/symlinked.tsx"));
    await expect(importFixture(fixture.root)).rejects.toThrow(
      /symbolic link|outside.*project/i,
    );
    await expectSentinelAbsent(fixture.sentinel);
  });

  it("emits deterministic sorted design evidence and dirty provenance", async () => {
    const firstFixture = await createExpoRouterFixture();
    const secondFixture = await createExpoRouterFixture({
      reverseCreationOrder: true,
    });

    const [first, second] = await Promise.all([
      importFixture(firstFixture.root),
      importFixture(secondFixture.root),
    ]);

    expect(second).toEqual(first);
    expect(first.routes.map((route) => route.sourcePath)).toEqual(
      first.routes.map((route) => route.sourcePath).sort(),
    );
    expect(first.designEvidence.tokenFiles).toEqual([
      expect.objectContaining({
        sourcePath: "constants/Colors.ts",
        evidenceKind: "declared-source",
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      }),
      expect.objectContaining({
        sourcePath: "src/theme/tokens.ts",
        evidenceKind: "declared-source",
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      }),
    ]);
    expect(first.designEvidence.tokenFiles.map((file) => file.sourcePath)).not
      .toContain("src/features/notifications/services/push-token-service.ts");
    expect(first.designEvidence.tokenFiles.map((file) => file.sourcePath)).not
      .toContain("src/features/theme/services/theme-preferences-service.ts");
    expect(first.designEvidence.componentFiles.map((file) => file.sourcePath))
      .toEqual([
        "components/ui/GameCard.tsx",
        "components/ui/index.ts",
        "src/features/games/components/GameRow.tsx",
        "src/features/games/screens/GamesTabScreen.tsx",
      ]);
    expect(first.provenance).toEqual({
      adapterVersion: "expo-router-static@1",
      analysisMode: "static-source",
      executedProjectCode: false,
      repository: TEST_REPOSITORY,
      sourceFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it("plans native mobile states for every route without desktop or tablet duplication", async () => {
    const fixture = await createExpoRouterFixture();
    const imported = await importFixture(fixture.root);
    const gameFrames = imported.framePlans.filter(
      (frame) =>
        frame.routeSourcePath ===
        "app/(protected)/(tabs)/game/[gameId].tsx",
    );

    expect(gameFrames.map((frame) => frame.viewport)).toEqual([
      { name: "mobile", width: 390, height: 844 },
      { name: "mobile", width: 390, height: 844 },
    ]);
    expect(gameFrames.map((frame) => frame.context)).toEqual([
      "guest",
      "authenticated",
    ]);
    expect(gameFrames.map((frame) => frame.contextProvenance)).toEqual([
      "inferred-from-route-group",
      "inferred-from-route-group",
    ]);
    expect(gameFrames.map((frame) => frame.fixture)).toEqual([
      {
        status: "required",
        parameterNames: ["gameId"],
      },
      {
        status: "required",
        parameterNames: ["gameId"],
      },
    ]);
    const protectedRoutes = imported.routes.filter((route) =>
      route.groups.includes("protected"),
    );
    expect(imported.framePlans).toHaveLength(
      imported.routes.length + protectedRoutes.length,
    );
    expect(
      imported.framePlans.every((frame) => frame.viewport.name === "mobile"),
    ).toBe(true);
    expect(imported.coverage).toEqual({
      capture: {
        blocked: imported.framePlans.length,
        captured: 0,
        failed: 0,
        planned: 0,
      },
      contexts: {
        authenticated: protectedRoutes.length,
        guest: protectedRoutes.length,
        public: imported.routes.filter(
          (route) =>
            !route.groups.includes("auth") &&
            !route.groups.includes("protected"),
        ).length,
        "signed-out": imported.routes.filter((route) =>
          route.groups.includes("auth"),
        ).length,
      },
      deviceProfiles: ["ios-mobile"],
      dynamicScenarios: imported.framePlans.filter(
        (frame) => frame.fixture.status === "required",
      ).length,
      normalizedRoutes: new Set(
        imported.routes.map((route) => route.normalizedPath),
      ).size,
      routeFiles: imported.routes.length,
      scenarios: imported.framePlans.length,
    });
  });

  it("marks every planned frame blocked when no trusted runtime capture exists", async () => {
    const fixture = await createExpoRouterFixture();
    const imported = await importFixture(fixture.root);

    expect(imported.framePlans.map((frame) => frame.capture)).toEqual(
      imported.framePlans.map(() => ({
        status: "blocked",
        reasonCode: "runtime-capture-unavailable",
        reason: "No trusted Expo web runtime was supplied.",
      })),
    );
  });
});
