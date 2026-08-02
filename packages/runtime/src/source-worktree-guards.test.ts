import {
  assertAbsoluteRoot,
  assertIdentifier,
  assertRevision,
  parseNulPaths,
  parseTrackedStatusPaths,
  rootsOverlap,
  validateRelativeSourcePath,
} from "./source-worktree-guards.js";

describe("source path policy", () => {
  it.each([
    "",
    "/absolute.ts",
    "src\\Button.tsx",
    "./src/Button.tsx",
    "src/../Button.tsx",
    ".git/config",
    "node_modules/pkg/index.js",
    ".env.local",
    "src/\u0000Button.tsx",
  ])("rejects %j", (relativePath) => {
    expect(() => validateRelativeSourcePath(relativePath)).toThrow(
      "inside the managed source workspace",
    );
  });

  it("accepts a normalized nested source path", () => {
    expect(validateRelativeSourcePath("src/ui/Button.tsx")).toBe(
      "src/ui/Button.tsx",
    );
  });

  it("rejects invalid ids, revisions, roots, and duplicate Git paths", () => {
    expect(() => assertIdentifier("..", "Run id")).toThrow(
      "safe local identifier",
    );
    expect(() => assertRevision("not-a-revision", "HEAD")).toThrow(
      "exact Git object id",
    );
    expect(() => assertAbsoluteRoot("relative/path", "Root")).toThrow(
      "absolute path",
    );
    expect(() => parseNulPaths("src/a.ts\u0000src/a.ts\u0000")).toThrow(
      "duplicate changed source paths",
    );
  });

  it("rejects untracked and renamed files from the first merge slice", () => {
    expect(() => parseTrackedStatusPaths("?? src/new.ts\u0000")).toThrow(
      "existing tracked text files only",
    );
    expect(() =>
      parseTrackedStatusPaths("R  src/renamed.ts\u0000"),
    ).toThrow("existing tracked text files only");
  });

  it("detects equal, nested, and disjoint roots", () => {
    expect(rootsOverlap("/memi/projects", "/memi/projects")).toBe(true);
    expect(rootsOverlap("/memi/projects", "/memi/projects/one")).toBe(true);
    expect(rootsOverlap("/memi/projects/one", "/memi/projects")).toBe(true);
    expect(rootsOverlap("/memi/projects", "/memi/runs")).toBe(false);
  });
});
