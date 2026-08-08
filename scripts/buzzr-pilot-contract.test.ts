import { describe, expect, it } from "vitest";

import {
  resolveBuzzrPilotWorktreeRoot,
  selectBuzzrPilotScenarios,
} from "./buzzr-pilot-contract.js";

const scenarios = [
  { id: "csc_sign_in", route: "/sign-in", state: "default" },
  { id: "csc_profile", route: "/profile", state: "default" },
  { id: "csc_forgot", route: "/forgot-password", state: "default" },
  { id: "csc_sign_up", route: "/sign-up", state: "default" },
] as const;

describe("Buzzr pilot contract", () => {
  it("selects the ordered signed-out auth flow rather than one screen", () => {
    expect(selectBuzzrPilotScenarios(scenarios).map(({ route }) => route)).toEqual([
      "/sign-in",
      "/sign-up",
      "/forgot-password",
    ]);
  });

  it("fails closed when any required auth-flow screen is absent", () => {
    expect(() => selectBuzzrPilotScenarios(scenarios.slice(0, 1))).toThrow(
      /sign-up, \/forgot-password/u,
    );
  });

  it("accepts an absolute external staging root disjoint from source", () => {
    expect(
      resolveBuzzrPilotWorktreeRoot({
        configuredRoot: "/Volumes/ExtremeSSD/Memi/Capture",
        defaultRoot: "/Users/designer/Library/Caches/Memi/Capture",
        repositoryRoot: "/Users/designer/Projects/Buzzr",
      }),
    ).toBe("/Volumes/ExtremeSSD/Memi/Capture");
  });

  it.each([
    "relative/capture",
    "/",
    "/Users/designer/Projects/Buzzr",
    "/Users/designer/Projects/Buzzr/.memi",
    "/Users/designer/Projects",
  ])("rejects unsafe staging root %s", (configuredRoot) => {
    expect(() =>
      resolveBuzzrPilotWorktreeRoot({
        configuredRoot,
        defaultRoot: "/Users/designer/Library/Caches/Memi/Capture",
        repositoryRoot: "/Users/designer/Projects/Buzzr",
      }),
    ).toThrow(/worktree root/u);
  });
});
