import {
  checkSourcePromotion,
  cleanupRegisteredRunWorktree,
} from "./source-worktree-lifecycle.js";
import type {
  SourceRepositoryState,
  SourceWorktreeRecovery,
} from "./source-worktree.types.js";

const HASH = `sha256:${"a".repeat(64)}` as const;
const BASE = "a".repeat(40);
const NEXT = "b".repeat(40);

function state(
  rootPath: string,
  overrides: Partial<SourceRepositoryState> = {},
): SourceRepositoryState {
  return {
    capturedAt: "2026-07-29T12:00:00.000Z",
    dirty: false,
    dirtyFingerprint: HASH,
    headRevision: BASE,
    rootPath,
    ...overrides,
  };
}

describe("source worktree lifecycle conflicts", () => {
  it("fails closed for a dirty connected source and changed dirty project", async () => {
    const connectedOriginal = state("/repos/original", { dirty: true });
    const expectedProjectState = state("/memi/project");
    const currentProject = state("/memi/project", {
      dirty: true,
      headRevision: NEXT,
    });

    const result = await checkSourcePromotion(
      {
        connectedOriginal,
        expectedProjectState,
        projectRoot: currentProject.rootPath,
      },
      {
        canonicalRoot: async (rootPath) => rootPath,
        captureRepositoryState: async (rootPath) =>
          rootPath === connectedOriginal.rootPath
            ? state("/repos/original")
            : currentProject,
        runGit: async () => {
          throw new Error("promotion diff must not run for conflicts");
        },
      },
    );

    expect(result.status).toBe("conflict");
    expect(result.conflicts).toEqual([
      "original-dirty-at-connect",
      "managed-project-state-changed",
      "managed-project-dirty",
    ]);
  });

  it("rejects cleanup for an already removed registration", async () => {
    const recovery: SourceWorktreeRecovery = {
      cleanupKind: "git-worktree-remove",
      ownerRootPath: "/memi/project",
      rootPath: "/memi/run",
      state: "removed",
    };
    await expect(
      cleanupRegisteredRunWorktree(recovery, {
        canonicalRoot: async (rootPath) => rootPath,
        captureRepositoryState: async (rootPath) => state(rootPath),
        runGit: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
      }),
    ).rejects.toThrow("merged run worktree");
  });

  it("does not force-delete an active unmerged run", async () => {
    const recovery: SourceWorktreeRecovery = {
      cleanupKind: "git-worktree-remove",
      ownerRootPath: "/memi/project",
      rootPath: "/memi/run",
      state: "active",
    };
    await expect(
      cleanupRegisteredRunWorktree(recovery, {
        canonicalRoot: async (rootPath) => rootPath,
        captureRepositoryState: async (rootPath) => state(rootPath),
        runGit: async () => {
          throw new Error("active run cleanup must not invoke Git");
        },
      }),
    ).rejects.toThrow("merged run worktree");
  });

  it("rejects a cleanup target nested inside its owning repository", async () => {
    const recovery: SourceWorktreeRecovery = {
      cleanupKind: "git-worktree-remove",
      ownerRootPath: "/memi/project",
      rootPath: "/memi/project/run",
      state: "merged-pending-cleanup",
    };
    await expect(
      cleanupRegisteredRunWorktree(recovery, {
        canonicalRoot: async (rootPath) => rootPath,
        captureRepositoryState: async (rootPath) => state(rootPath),
        runGit: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
      }),
    ).rejects.toThrow("must be disjoint");
  });
});
