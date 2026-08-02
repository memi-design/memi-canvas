import type {
  CaptureRoutePlan,
  CaptureScenarioPlan,
  RepositoryManifestInput,
} from "@memi/capture-platforms";
import { describe, expect, it } from "vitest";

import {
  resolveDeterministicRepositoryFixture,
} from "./deterministic-fixture-resolver.js";

const HASH = `sha256:${"a".repeat(64)}` as const;

function manifest(
  entries: RepositoryManifestInput["entries"],
): RepositoryManifestInput {
  return {
    schemaVersion: 1,
    repository: {
      revision: "b".repeat(40),
      dirtyFileFingerprint: HASH,
    },
    budgets: {
      maxEntries: 64,
      maxFileBytes: 65_536,
      maxTotalBytes: 524_288,
      maxDepth: 16,
    },
    entries,
  };
}

function route(
  path: string,
  names: readonly string[],
): CaptureRoutePlan {
  return {
    routeId: "rte_fixture",
    sourcePath: "app/game/[gameId].tsx",
    path,
    displayName: "Fixture route",
    parameters: names.map((name) => ({
      name,
      kind: "dynamic" as const,
    })),
    navigation: "deep-link",
  };
}

function scenario(
  path: string,
  names: readonly string[],
): CaptureScenarioPlan {
  return {
    scenarioId: "scn_fixture",
    applicationId: "app_fixture",
    routeId: "rte_fixture",
    routePath: path,
    state: "default",
    authContext: "public",
    fixture: {
      status: "required",
      parameterNames: names,
    },
    viewport: {
      name: "ios-mobile",
      width: 390,
      height: 844,
      scale: 3,
    },
    readiness: {
      strategy: "two-stable-frames",
      stableFrames: 2,
      rejectBlank: true,
      rejectSplash: true,
      rejectErrorBoundary: true,
    },
  };
}

describe("deterministic repository fixture resolution", () => {
  it("derives dynamic parameters from a concrete repository-owned test route", () => {
    const fixture = resolveDeterministicRepositoryFixture({
      manifest: manifest([
        {
          path: "tests/unit/sharing/game-route.test.ts",
          content:
            "expect(buildGameRoute('game-123')).toBe('/game/game-123')",
        },
      ]),
      route: route("/game/:gameId", ["gameId"]),
      scenario: scenario("/game/:gameId", ["gameId"]),
    });

    expect(fixture).toEqual({
      parameters: [{ key: "gameId", value: "game-123" }],
      fixtureProfile: "repository-route-evidence",
      readinessSelector: null,
    });
  });

  it("normalizes Expo route groups and resolves every parameter", () => {
    const fixture = resolveDeterministicRepositoryFixture({
      manifest: manifest([
        {
          path: "src/features/navigation/route-constants.ts",
          content:
            "export const PLAYER_FIXTURE_ROUTE = '/(protected)/player/nba/2544'",
        },
      ]),
      route: route(
        "/player/:league/:athleteId",
        ["league", "athleteId"],
      ),
      scenario: scenario(
        "/player/:league/:athleteId",
        ["league", "athleteId"],
      ),
    });

    expect(fixture?.parameters).toEqual([
      { key: "league", value: "nba" },
      { key: "athleteId", value: "2544" },
    ]);
  });

  it("prefers Maestro evidence over conflicting test and source constants", () => {
    const fixture = resolveDeterministicRepositoryFixture({
      manifest: manifest([
        {
          path: "src/features/navigation/route-constants.ts",
          content: "export const GAME_ROUTE = '/game/source-game'",
        },
        {
          path: "tests/game-route.test.ts",
          content: "expect(route).toBe('/game/test-game')",
        },
        {
          path: ".maestro/game-detail.yaml",
          content: "appId: com.example\n- openLink: buzzr://game/live-game",
        },
      ]),
      route: route("/game/:gameId", ["gameId"]),
      scenario: scenario("/game/:gameId", ["gameId"]),
    });

    expect(fixture?.parameters).toEqual([
      { key: "gameId", value: "live-game" },
    ]);
  });

  it("does not resolve from comments, documentation, interpolation, or partial evidence", () => {
    const fixture = resolveDeterministicRepositoryFixture({
      manifest: manifest([
        {
          path: "docs/routes.md",
          content: "Example: /player/nba/2544",
        },
        {
          path: "src/features/navigation/player.ts",
          content:
            "// '/player/nba/2544'\nconst route = `/player/${league}/${athleteId}`",
        },
        {
          path: "tests/player-route.test.ts",
          content: "expect(prefix).toBe('/player/nba')",
        },
      ]),
      route: route(
        "/player/:league/:athleteId",
        ["league", "athleteId"],
      ),
      scenario: scenario(
        "/player/:league/:athleteId",
        ["league", "athleteId"],
      ),
    });

    expect(fixture).toBeNull();
  });

  it("rejects unsafe decoded values and mismatched scenario contracts", () => {
    const unsafe = resolveDeterministicRepositoryFixture({
      manifest: manifest([
        {
          path: "tests/game-route.test.ts",
          content: "expect(route).toBe('/game/%2E%2E')",
        },
      ]),
      route: route("/game/:gameId", ["gameId"]),
      scenario: scenario("/game/:gameId", ["gameId"]),
    });
    const mismatched = resolveDeterministicRepositoryFixture({
      manifest: manifest([
        {
          path: "tests/game-route.test.ts",
          content: "expect(route).toBe('/game/game-123')",
        },
      ]),
      route: route("/game/:gameId", ["gameId"]),
      scenario: scenario("/game/:gameId", ["id"]),
    });

    expect(unsafe).toBeNull();
    expect(mismatched).toBeNull();
  });

  it("never materializes secret-bearing route contracts or provider credentials", () => {
    const sensitiveContract = resolveDeterministicRepositoryFixture({
      manifest: manifest([
        {
          path: ".maestro/reset-password.yaml",
          content:
            "appId: com.example\n- openLink: fixture://reset-password/fixture-value",
        },
      ]),
      route: route("/reset-password/:resetToken", ["resetToken"]),
      scenario: scenario("/reset-password/:resetToken", ["resetToken"]),
    });
    const sensitiveValue = resolveDeterministicRepositoryFixture({
      manifest: manifest([
        {
          path: "tests/game-route.test.ts",
          content:
            "expect(route).toBe('/game/sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')",
        },
      ]),
      route: route("/game/:gameId", ["gameId"]),
      scenario: scenario("/game/:gameId", ["gameId"]),
    });

    expect(sensitiveContract).toBeNull();
    expect(sensitiveValue).toBeNull();
  });
});
