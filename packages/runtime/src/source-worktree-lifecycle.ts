import type {
  CheckSourcePromotionInput,
  PromotionConflict,
  SourceGitRequest,
  SourceGitResult,
  SourcePromotionCheck,
  SourceRepositoryState,
  SourceWorktreeRecovery,
} from "./source-worktree.types.js";
import {
  assertAbsoluteRoot,
  frozenClone,
  hashStableValue,
  parseNulPaths,
  rootsOverlap,
  stateMatches,
} from "./source-worktree-guards.js";

interface SourceWorktreeLifecycleDependencies {
  readonly canonicalRoot: (rootPath: string) => Promise<string>;
  readonly captureRepositoryState: (
    rootPath: string,
  ) => Promise<SourceRepositoryState>;
  readonly runGit: (
    request: Omit<
      SourceGitRequest,
      "repositoryProcessPolicy" | "securityProfile"
    >,
  ) => Promise<SourceGitResult>;
}

export async function checkSourcePromotion(
  input: CheckSourcePromotionInput,
  dependencies: SourceWorktreeLifecycleDependencies,
): Promise<SourcePromotionCheck> {
  const currentOriginal = await dependencies.captureRepositoryState(
    input.connectedOriginal.rootPath,
  );
  const currentProject = await dependencies.captureRepositoryState(
    input.projectRoot,
  );
  const conflicts: PromotionConflict[] = [];
  if (
    currentOriginal.headRevision !== input.connectedOriginal.headRevision
  ) {
    conflicts.push("original-head-changed");
  }
  if (
    currentOriginal.dirtyFingerprint !==
    input.connectedOriginal.dirtyFingerprint
  ) {
    conflicts.push("original-dirty-state-changed");
  }
  if (input.connectedOriginal.dirty) {
    conflicts.push("original-dirty-at-connect");
  }
  if (!stateMatches(currentProject, input.expectedProjectState)) {
    conflicts.push("managed-project-state-changed");
  }
  if (currentProject.dirty) {
    conflicts.push("managed-project-dirty");
  }
  if (conflicts.length > 0) {
    return frozenClone({
      changedPaths: [],
      conflicts,
      currentOriginal,
      currentProject,
      diff: "",
      digest: hashStableValue({
        conflicts,
        currentOriginal,
        currentProject,
      }),
      status: "conflict" as const,
    });
  }
  const changedPaths = parseNulPaths(
    (
      await dependencies.runGit({
        args: [
          "diff",
          "--name-only",
          "-z",
          input.connectedOriginal.headRevision,
          currentProject.headRevision,
          "--",
        ],
        cwd: currentProject.rootPath,
      })
    ).stdout,
  );
  const diff = (
    await dependencies.runGit({
      args: [
        "diff",
        "--binary",
        "--no-ext-diff",
        input.connectedOriginal.headRevision,
        currentProject.headRevision,
        "--",
      ],
      cwd: currentProject.rootPath,
    })
  ).stdout;
  return frozenClone({
    changedPaths,
    conflicts,
    currentOriginal,
    currentProject,
    diff,
    digest: hashStableValue({
      changedPaths,
      currentOriginal,
      currentProject,
      diff,
    }),
    status: "ready" as const,
  });
}

export async function cleanupRegisteredRunWorktree(
  recovery: SourceWorktreeRecovery,
  dependencies: SourceWorktreeLifecycleDependencies,
): Promise<SourceWorktreeRecovery> {
  if (
    recovery.cleanupKind !== "git-worktree-remove" ||
    recovery.ownerRootPath === null ||
    recovery.state !== "merged-pending-cleanup"
  ) {
    throw new Error(
      "Only a merged run worktree pending cleanup can be removed.",
    );
  }
  const ownerRootPath = await dependencies.canonicalRoot(
    recovery.ownerRootPath,
  );
  const rootPath = assertAbsoluteRoot(
    recovery.rootPath,
    "Run worktree cleanup root",
  );
  if (rootsOverlap(ownerRootPath, rootPath)) {
    throw new Error(
      "Run worktree cleanup root must be disjoint from its owner.",
    );
  }
  await dependencies.runGit({
    args: ["worktree", "remove", "--force", "--", rootPath],
    cwd: ownerRootPath,
  });
  await dependencies.runGit({
    args: ["worktree", "prune"],
    cwd: ownerRootPath,
  });
  return frozenClone({ ...recovery, state: "removed" as const });
}
