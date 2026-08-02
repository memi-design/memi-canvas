import * as runtimeApi from "./index.js";

describe("source worktree production veto", () => {
  it("does not expose mutating manager composition from the package root", () => {
    expect("createSourceWorktreeManager" in runtimeApi).toBe(false);
    expect("approveRunWorktreeReview" in runtimeApi).toBe(false);
    expect(
      "createDeterministicSourceEditCoordinator" in runtimeApi,
    ).toBe(false);
    expect(
      "DeterministicSourceCompositionError" in runtimeApi,
    ).toBe(false);
  });
});
