import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadOrCreatePilotPlanKey,
  resolveBuzzrPilotAppDataRoot,
  resolveBuzzrPilotWorktreeRoot,
  selectBuzzrPilotScenarios,
} from "./buzzr-pilot-contract.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

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

  it("keeps external pilot app data disjoint from source and staging", () => {
    expect(
      resolveBuzzrPilotAppDataRoot({
        configuredRoot: "/Volumes/ExtremeSSD/Memi/Gate-C/app-data",
        defaultRoot: "/Users/designer/Library/Application Support/Memi",
        repositoryRoot: "/Users/designer/Projects/Buzzr",
        worktreeRoot: "/Volumes/ExtremeSSD/Memi/Gate-C/worktrees",
      }),
    ).toBe("/Volumes/ExtremeSSD/Memi/Gate-C/app-data");
    expect(() =>
      resolveBuzzrPilotAppDataRoot({
        configuredRoot: "/Volumes/ExtremeSSD/Memi/Gate-C",
        defaultRoot: "/Users/designer/Library/Application Support/Memi",
        repositoryRoot: "/Users/designer/Projects/Buzzr",
        worktreeRoot: "/Volumes/ExtremeSSD/Memi/Gate-C/worktrees",
      }),
    ).toThrow(/app data root/u);
  });

  it("creates one private durable plan key and reuses it", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-gate-c-key-"));
    temporaryDirectories.push(root);

    const first = await loadOrCreatePilotPlanKey(root);
    const second = await loadOrCreatePilotPlanKey(root);
    const keyPath = join(root, "runtime", "plan-integrity-v1.key");

    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(second).toBe(first);
    expect((await readFile(keyPath, "utf8")).trim()).toBe(first);
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
  });
});
