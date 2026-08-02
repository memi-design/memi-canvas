import {
  approveRunWorktreeReview,
  createSourceWorktreeManager,
  hashSourceText,
  SourceWorktreeOperationError,
  type RunWorktreeApprovalAuthorityPort,
  type SourceGitRequest,
} from "./source-worktree.js";
import {
  expectRepositoryCapture,
  MemoryRunWorktreeApprovalAuthority,
  MemorySourceFileSystem,
  MemorySourceWorktreeSecurityAuthorization,
  ScriptedSourceGit,
} from "./source-worktree-test-support.js";

const ORIGINAL_ROOT = "/repos/buzzr";
const MANAGED_ROOT = "/memi/projects";
const PROJECT_ROOT = "/memi/projects/project-1";
const RUNS_ROOT = "/memi/runs";
const RUN_ROOT = "/memi/runs/run-1";
const BASE_REVISION = "a".repeat(40);
const APPLIED_REVISION = "b".repeat(40);
const RUN_REVISION = "c".repeat(40);

function createManager(
  git: ScriptedSourceGit,
  fileSystem: MemorySourceFileSystem,
  options: {
    readonly approvalAuthority?: RunWorktreeApprovalAuthorityPort;
    readonly now?: () => string;
    readonly securityAuthorization?: MemorySourceWorktreeSecurityAuthorization;
  } = {},
) {
  const managerOptions = {
    approvalAuthority:
      options.approvalAuthority ??
      new MemoryRunWorktreeApprovalAuthority(),
    fileSystem,
    now: options.now ?? (() => "2026-07-29T12:00:00.000Z"),
    process: git,
    securityAuthorization:
      options.securityAuthorization ??
      new MemorySourceWorktreeSecurityAuthorization(),
  };
  return createSourceWorktreeManager(managerOptions);
}

describe("managed source-worktree authority", () => {
  it("captures an exact base revision and content-sensitive dirty fingerprint", async () => {
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem({
      [`${ORIGINAL_ROOT}/notes.txt`]: "private draft one",
    });
    expectRepositoryCapture(git, ORIGINAL_ROOT, BASE_REVISION, {
      status: " M src/App.tsx\u0000?? notes.txt\u0000",
      worktreeDiff: "diff --git a/src/App.tsx b/src/App.tsx\n+changed\n",
    });
    const manager = createManager(git, fileSystem);

    const first = await manager.captureRepositoryState(ORIGINAL_ROOT);

    expect(first).toMatchObject({
      dirty: true,
      headRevision: BASE_REVISION,
      rootPath: ORIGINAL_ROOT,
    });
    expect(first.dirtyFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(first)).toBe(true);

    const secondGit = new ScriptedSourceGit();
    const secondFileSystem = new MemorySourceFileSystem({
      [`${ORIGINAL_ROOT}/notes.txt`]: "private draft two",
    });
    expectRepositoryCapture(secondGit, ORIGINAL_ROOT, BASE_REVISION, {
      status: " M src/App.tsx\u0000?? notes.txt\u0000",
      worktreeDiff: "diff --git a/src/App.tsx b/src/App.tsx\n+changed\n",
    });

    const second = await createManager(
      secondGit,
      secondFileSystem,
    ).captureRepositoryState(ORIGINAL_ROOT);

    expect(second.dirtyFingerprint).not.toBe(first.dirtyFingerprint);
    git.assertDrained();
    secondGit.assertDrained();
  });

  it("creates an independent managed clone without changing the original checkout", async () => {
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem();
    expectRepositoryCapture(git, ORIGINAL_ROOT, BASE_REVISION);
    git.expect(MANAGED_ROOT, [
      "clone",
      "--local",
      "--no-hardlinks",
      "--no-checkout",
      "--no-recurse-submodules",
      "--",
      ORIGINAL_ROOT,
      PROJECT_ROOT,
    ]);
    git.expect(PROJECT_ROOT, [
      "-c",
      "core.hooksPath=/dev/null",
      "checkout",
      "--detach",
      BASE_REVISION,
    ]);
    expectRepositoryCapture(git, PROJECT_ROOT, BASE_REVISION);
    const manager = createManager(git, fileSystem);

    const project = await manager.createManagedProject({
      managedProjectsRoot: MANAGED_ROOT,
      originalRoot: ORIGINAL_ROOT,
      projectId: "project-1",
    });

    expect(project).toMatchObject({
      original: {
        dirty: false,
        headRevision: BASE_REVISION,
        rootPath: ORIGINAL_ROOT,
      },
      projectId: "project-1",
      rootPath: PROJECT_ROOT,
      state: {
        dirty: false,
        headRevision: BASE_REVISION,
        rootPath: PROJECT_ROOT,
      },
    });
    expect(project.recovery).toEqual({
      cleanupKind: "remove-independent-clone",
      ownerRootPath: null,
      rootPath: PROJECT_ROOT,
      state: "active",
    });
    expect(
      git.calls.some(({ cwd }) => cwd === ORIGINAL_ROOT),
    ).toBe(true);
    expect(
      git.calls.filter(({ cwd }) => cwd === ORIGINAL_ROOT).every(
        ({ args }) =>
          ["rev-parse", "status", "diff"].includes(args[0] ?? ""),
      ),
    ).toBe(true);
    expect(
      git.calls.every(
        (call) =>
          (call as SourceGitRequest & { readonly securityProfile?: string })
            .securityProfile === "source-worktree",
      ),
    ).toBe(true);
    git.assertDrained();
  });

  it("refuses to project a dirty original checkout onto a clean HEAD clone", async () => {
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem();
    expectRepositoryCapture(git, ORIGINAL_ROOT, BASE_REVISION, {
      status: " M src/App.tsx\u0000",
      worktreeDiff: "+uncommitted user work\n",
    });
    const manager = createManager(git, fileSystem);

    await expect(
      manager.createManagedProject({
        managedProjectsRoot: MANAGED_ROOT,
        originalRoot: ORIGINAL_ROOT,
        projectId: "project-1",
      }),
    ).rejects.toThrow(
      "must be clean before it can become source-editable",
    );
    expect(
      git.calls.some(({ args }) => args[0] === "clone"),
    ).toBe(false);
    git.assertDrained();
  });

  it("inspects only contained, non-sensitive source files and rejects symlink escapes", async () => {
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem({
      [`${PROJECT_ROOT}/src/Button.tsx`]: "export const Button = () => null;\n",
      "/private/.env": "SECRET=value\n",
    });
    fileSystem.setRealPath(
      `${PROJECT_ROOT}/src/linked.ts`,
      "/private/.env",
    );
    const manager = createManager(git, fileSystem);

    const [file] = await manager.inspectContainedFiles(PROJECT_ROOT, [
      "src/Button.tsx",
    ]);

    expect(file).toEqual({
      contentHash: await hashSourceText(
        "export const Button = () => null;\n",
      ),
      relativePath: "src/Button.tsx",
      text: "export const Button = () => null;\n",
    });
    await expect(
      manager.inspectContainedFiles(PROJECT_ROOT, ["../original/.env"]),
    ).rejects.toThrow("inside the managed source workspace");
    await expect(
      manager.inspectContainedFiles(PROJECT_ROOT, [".env"]),
    ).rejects.toThrow("inside the managed source workspace");
    await expect(
      manager.inspectContainedFiles(PROJECT_ROOT, ["src/linked.ts"]),
    ).rejects.toThrow("resolves outside");
    expect(git.calls).toEqual([]);
  });

  it("compare-and-applies exact text hashes, commits the managed workspace, and leaves the original untouched", async () => {
    const beforeText = "export const radius = 8;\n";
    const afterText = "export const radius = 12;\n";
    const relativePath = "src/tokens.ts";
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem({
      [`${ORIGINAL_ROOT}/${relativePath}`]: beforeText,
      [`${PROJECT_ROOT}/${relativePath}`]: beforeText,
    });
    expectRepositoryCapture(git, PROJECT_ROOT, BASE_REVISION);
    git.expect(PROJECT_ROOT, ["add", "--", relativePath]);
    git.expect(PROJECT_ROOT, [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Memi Canvas",
      "-c",
      "user.email=canvas@localhost",
      "commit",
      "--no-gpg-sign",
      "-m",
      "memi: apply source changes",
      "--",
      relativePath,
    ]);
    expectRepositoryCapture(git, PROJECT_ROOT, APPLIED_REVISION);
    const manager = createManager(git, fileSystem);

    const result = await manager.compareAndApplyTextChanges({
      changes: [
        {
          afterText,
          expectedBeforeHash: await hashSourceText(beforeText),
          relativePath,
        },
      ],
      commitMessage: "memi: apply source changes",
      expectedState: {
        capturedAt: "2026-07-29T12:00:00.000Z",
        dirty: false,
        dirtyFingerprint: await manager.cleanFingerprint(BASE_REVISION),
        headRevision: BASE_REVISION,
        rootPath: PROJECT_ROOT,
      },
      rootPath: PROJECT_ROOT,
    });

    expect(result.changedFiles).toEqual([
      {
        afterHash: await hashSourceText(afterText),
        beforeHash: await hashSourceText(beforeText),
        relativePath,
      },
    ]);
    expect(result.state.headRevision).toBe(APPLIED_REVISION);
    expect(
      new TextDecoder().decode(
        await fileSystem.readFile(`${ORIGINAL_ROOT}/${relativePath}`),
      ),
    ).toBe(beforeText);
    expect(fileSystem.atomicBatches).toHaveLength(1);
    git.assertDrained();
  });

  it("rejects stale file content before any write or Git mutation", async () => {
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem({
      [`${PROJECT_ROOT}/src/tokens.ts`]: "export const radius = 10;\n",
    });
    expectRepositoryCapture(git, PROJECT_ROOT, BASE_REVISION);
    const manager = createManager(git, fileSystem);

    await expect(
      manager.compareAndApplyTextChanges({
        changes: [
          {
            afterText: "export const radius = 12;\n",
            expectedBeforeHash: await hashSourceText(
              "export const radius = 8;\n",
            ),
            relativePath: "src/tokens.ts",
          },
        ],
        commitMessage: "memi: apply source changes",
        expectedState: {
          capturedAt: "2026-07-29T12:00:00.000Z",
          dirty: false,
          dirtyFingerprint: await manager.cleanFingerprint(BASE_REVISION),
          headRevision: BASE_REVISION,
          rootPath: PROJECT_ROOT,
        },
        rootPath: PROJECT_ROOT,
      }),
    ).rejects.toThrow("no longer matches its expected SHA-256");
    expect(fileSystem.atomicBatches).toEqual([]);
    git.assertDrained();
  });

  it("rejects binary or oversized replacement text before any write", async () => {
    const beforeText = "export const radius = 8;\n";
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem({
      [`${PROJECT_ROOT}/src/tokens.ts`]: beforeText,
    });
    expectRepositoryCapture(git, PROJECT_ROOT, BASE_REVISION);
    const manager = createManager(git, fileSystem);

    await expect(
      manager.compareAndApplyTextChanges({
        changes: [
          {
            afterText: "export const token = '\u0000';\n",
            expectedBeforeHash: await hashSourceText(beforeText),
            relativePath: "src/tokens.ts",
          },
        ],
        commitMessage: "memi: apply source changes",
        expectedState: {
          capturedAt: "2026-07-29T12:00:00.000Z",
          dirty: false,
          dirtyFingerprint: await manager.cleanFingerprint(BASE_REVISION),
          headRevision: BASE_REVISION,
          rootPath: PROJECT_ROOT,
        },
        rootPath: PROJECT_ROOT,
      }),
    ).rejects.toThrow("valid bounded UTF-8 source text");
    expect(fileSystem.atomicBatches).toEqual([]);
    git.assertDrained();
  });

  it("fails closed before a managed source write when security authorization is denied", async () => {
    const beforeText = "export const radius = 8;\n";
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem({
      [`${PROJECT_ROOT}/src/tokens.ts`]: beforeText,
    });
    const securityAuthorization =
      new MemorySourceWorktreeSecurityAuthorization(false);
    expectRepositoryCapture(git, PROJECT_ROOT, BASE_REVISION);
    const manager = createManager(git, fileSystem, {
      securityAuthorization,
    });

    await expect(
      manager.compareAndApplyTextChanges({
        changes: [
          {
            afterText: "export const radius = 12;\n",
            expectedBeforeHash: await hashSourceText(beforeText),
            relativePath: "src/tokens.ts",
          },
        ],
        commitMessage: "memi: apply source changes",
        expectedState: {
          capturedAt: "2026-07-29T12:00:00.000Z",
          dirty: false,
          dirtyFingerprint: await manager.cleanFingerprint(BASE_REVISION),
          headRevision: BASE_REVISION,
          rootPath: PROJECT_ROOT,
        },
        rootPath: PROJECT_ROOT,
      }),
    ).rejects.toThrow("security veto is active");
    expect(fileSystem.atomicBatches).toEqual([]);
    expect(securityAuthorization.calls).toHaveLength(1);
    git.assertDrained();
  });

  it("creates a child run worktree from the exact clean managed revision", async () => {
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem();
    expectRepositoryCapture(git, PROJECT_ROOT, APPLIED_REVISION);
    git.expect(PROJECT_ROOT, [
      "-c",
      "core.hooksPath=/dev/null",
      "worktree",
      "add",
      "--detach",
      RUN_ROOT,
      APPLIED_REVISION,
    ]);
    expectRepositoryCapture(git, RUN_ROOT, APPLIED_REVISION);
    const manager = createManager(git, fileSystem);

    const run = await manager.createRunWorktree({
      project: {
        createdAt: "2026-07-29T12:00:00.000Z",
        original: {
          capturedAt: "2026-07-29T12:00:00.000Z",
          dirty: false,
          dirtyFingerprint: await manager.cleanFingerprint(BASE_REVISION),
          headRevision: BASE_REVISION,
          rootPath: ORIGINAL_ROOT,
        },
        projectId: "project-1",
        recovery: {
          cleanupKind: "remove-independent-clone",
          ownerRootPath: null,
          rootPath: PROJECT_ROOT,
          state: "active",
        },
        rootPath: PROJECT_ROOT,
        state: {
          capturedAt: "2026-07-29T12:00:00.000Z",
          dirty: false,
          dirtyFingerprint: await manager.cleanFingerprint(APPLIED_REVISION),
          headRevision: APPLIED_REVISION,
          rootPath: PROJECT_ROOT,
        },
      },
      runId: "run-1",
      runsRoot: RUNS_ROOT,
    });

    expect(run).toMatchObject({
      baseProjectState: {
        headRevision: APPLIED_REVISION,
        rootPath: PROJECT_ROOT,
      },
      rootPath: RUN_ROOT,
      runId: "run-1",
    });
    expect(run.recovery).toEqual({
      cleanupKind: "git-worktree-remove",
      ownerRootPath: PROJECT_ROOT,
      rootPath: RUN_ROOT,
      state: "active",
    });
    git.assertDrained();
  });

  it("reviews an exact run diff and fast-forwards an approved child into an unchanged project", async () => {
    const relativePath = "src/Button.tsx";
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem({
      [`${RUN_ROOT}/${relativePath}`]: "export const label = 'Continue';\n",
    });
    const approvalAuthority = new MemoryRunWorktreeApprovalAuthority();
    let milliseconds = Date.parse("2026-07-29T12:00:00.000Z");
    expectRepositoryCapture(git, PROJECT_ROOT, APPLIED_REVISION);
    expectRepositoryCapture(git, RUN_ROOT, APPLIED_REVISION, {
      status: ` M ${relativePath}\u0000`,
      worktreeDiff:
        "diff --git a/src/Button.tsx b/src/Button.tsx\n-label\n+Continue\n",
    });
    git.expect(
      RUN_ROOT,
      ["diff", "--name-only", "-z", "--no-ext-diff", APPLIED_REVISION, "--"],
      `${relativePath}\u0000`,
    );
    git.expect(
      RUN_ROOT,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      ` M ${relativePath}\u0000`,
    );
    git.expect(
      RUN_ROOT,
      ["diff", "--binary", "--no-ext-diff", APPLIED_REVISION, "--"],
      "diff --git a/src/Button.tsx b/src/Button.tsx\n-label\n+Continue\n",
    );
    const manager = createManager(git, fileSystem, {
      approvalAuthority,
      now: () => {
        const value = new Date(milliseconds).toISOString();
        milliseconds += 1_000;
        return value;
      },
    });
    const run = {
      baseProjectState: {
        capturedAt: "2026-07-29T12:00:00.000Z",
        dirty: false,
        dirtyFingerprint: await manager.cleanFingerprint(APPLIED_REVISION),
        headRevision: APPLIED_REVISION,
        rootPath: PROJECT_ROOT,
      },
      createdAt: "2026-07-29T12:00:00.000Z",
      projectId: "project-1",
      recovery: {
        cleanupKind: "git-worktree-remove" as const,
        ownerRootPath: PROJECT_ROOT,
        rootPath: RUN_ROOT,
        state: "active" as const,
      },
      rootPath: RUN_ROOT,
      runId: "run-1",
    };

    const review = await manager.reviewRunWorktree(run);

    expect(review.status).toBe("ready");
    expect(review.changedPaths).toEqual([relativePath]);
    expect(review.diff).toContain("+Continue");
    expect(review.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const approval = await approveRunWorktreeReview(
      review,
      {
        id: "human-1",
        kind: "human",
      },
      approvalAuthority,
      { now: () => "2026-07-29T12:30:00.000Z" },
    );
    expectRepositoryCapture(git, PROJECT_ROOT, APPLIED_REVISION);
    expectRepositoryCapture(git, RUN_ROOT, APPLIED_REVISION, {
      status: ` M ${relativePath}\u0000`,
      worktreeDiff:
        "diff --git a/src/Button.tsx b/src/Button.tsx\n-label\n+Continue\n",
    });
    git.expect(
      RUN_ROOT,
      ["diff", "--name-only", "-z", "--no-ext-diff", APPLIED_REVISION, "--"],
      `${relativePath}\u0000`,
    );
    git.expect(
      RUN_ROOT,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      ` M ${relativePath}\u0000`,
    );
    git.expect(
      RUN_ROOT,
      ["diff", "--binary", "--no-ext-diff", APPLIED_REVISION, "--"],
      "diff --git a/src/Button.tsx b/src/Button.tsx\n-label\n+Continue\n",
    );
    git.expect(RUN_ROOT, ["add", "--", relativePath]);
    git.expect(RUN_ROOT, [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Memi Canvas",
      "-c",
      "user.email=canvas@localhost",
      "commit",
      "--no-gpg-sign",
      "-m",
      "memi: approve run run-1",
      "--",
      relativePath,
    ]);
    git.expect(RUN_ROOT, ["rev-parse", "HEAD"], `${RUN_REVISION}\n`);
    git.expect(PROJECT_ROOT, [
      "-c",
      "core.hooksPath=/dev/null",
      "merge",
      "--ff-only",
      "--no-edit",
      RUN_REVISION,
    ]);
    expectRepositoryCapture(git, PROJECT_ROOT, RUN_REVISION);

    const merged = await manager.mergeApprovedRunWorktree({
      approval,
      projectRoot: PROJECT_ROOT,
      review,
    });

    expect(merged).toMatchObject({
      mergedRevision: RUN_REVISION,
      status: "merged",
    });
    expect(merged.projectState.headRevision).toBe(RUN_REVISION);
    await expect(
      manager.mergeApprovedRunWorktree({
        approval,
        projectRoot: PROJECT_ROOT,
        review,
      }),
    ).rejects.toThrow("already been consumed");
    git.assertDrained();
  });

  it("retains exact approval and review identity when an authorized merge needs recovery", async () => {
    const relativePath = "src/Button.tsx";
    const diff =
      "diff --git a/src/Button.tsx b/src/Button.tsx\n-label\n+Continue\n";
    const git = new ScriptedSourceGit();
    const approvalAuthority = new MemoryRunWorktreeApprovalAuthority();
    const manager = createManager(
      git,
      new MemorySourceFileSystem({
        [`${RUN_ROOT}/${relativePath}`]: "export const label = 'Continue';\n",
      }),
      { approvalAuthority },
    );
    const run = {
      baseProjectState: {
        capturedAt: "2026-07-29T12:00:00.000Z",
        dirty: false,
        dirtyFingerprint: await manager.cleanFingerprint(APPLIED_REVISION),
        headRevision: APPLIED_REVISION,
        rootPath: PROJECT_ROOT,
      },
      createdAt: "2026-07-29T12:00:00.000Z",
      projectId: "project-1",
      recovery: {
        cleanupKind: "git-worktree-remove" as const,
        ownerRootPath: PROJECT_ROOT,
        rootPath: RUN_ROOT,
        state: "active" as const,
      },
      rootPath: RUN_ROOT,
      runId: "run-1",
    };
    const expectReviewReads = () => {
      expectRepositoryCapture(git, PROJECT_ROOT, APPLIED_REVISION);
      expectRepositoryCapture(git, RUN_ROOT, APPLIED_REVISION, {
        status: ` M ${relativePath}\u0000`,
        worktreeDiff: diff,
      });
      git.expect(
        RUN_ROOT,
        ["diff", "--name-only", "-z", "--no-ext-diff", APPLIED_REVISION, "--"],
        `${relativePath}\u0000`,
      );
      git.expect(
        RUN_ROOT,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        ` M ${relativePath}\u0000`,
      );
      git.expect(
        RUN_ROOT,
        ["diff", "--binary", "--no-ext-diff", APPLIED_REVISION, "--"],
        diff,
      );
    };
    expectReviewReads();
    const review = await manager.reviewRunWorktree(run);
    const approval = await approveRunWorktreeReview(
      review,
      { id: "human-1", kind: "human" },
      approvalAuthority,
      { now: () => "2026-07-29T12:30:00.000Z" },
    );
    expectReviewReads();
    git.expect(RUN_ROOT, ["add", "--", relativePath], "", 1, "disk full");

    const failure = await manager
      .mergeApprovedRunWorktree({
        approval,
        projectRoot: PROJECT_ROOT,
        review,
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SourceWorktreeOperationError);
    expect((failure as SourceWorktreeOperationError).recovery).toMatchObject({
      approvalId: approval.approvalId,
      reviewDigest: review.digest,
      runId: run.runId,
    });
    expect(await approvalAuthority.isActiveExact(approval)).toBe(false);
    git.assertDrained();
  });

  it("detects original revision, dirty-state, and managed-project promotion conflicts without writing the original", async () => {
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem();
    const manager = createManager(git, fileSystem);
    const connectedOriginal = {
      capturedAt: "2026-07-29T12:00:00.000Z",
      dirty: false,
      dirtyFingerprint: await manager.cleanFingerprint(BASE_REVISION),
      headRevision: BASE_REVISION,
      rootPath: ORIGINAL_ROOT,
    };
    const expectedProjectState = {
      capturedAt: "2026-07-29T12:00:00.000Z",
      dirty: false,
      dirtyFingerprint: await manager.cleanFingerprint(APPLIED_REVISION),
      headRevision: APPLIED_REVISION,
      rootPath: PROJECT_ROOT,
    };
    expectRepositoryCapture(git, ORIGINAL_ROOT, "d".repeat(40), {
      status: " M src/App.tsx\u0000",
      worktreeDiff: "+local change\n",
    });
    expectRepositoryCapture(git, PROJECT_ROOT, APPLIED_REVISION);

    const check = await manager.checkPromotion({
      connectedOriginal,
      expectedProjectState,
      projectRoot: PROJECT_ROOT,
    });

    expect(check.status).toBe("conflict");
    expect(check.conflicts).toEqual([
      "original-head-changed",
      "original-dirty-state-changed",
    ]);
    expect(
      git.calls.filter(({ cwd }) => cwd === ORIGINAL_ROOT).every(
        ({ args }) =>
          ["rev-parse", "status", "diff"].includes(args[0] ?? ""),
      ),
    ).toBe(true);
    git.assertDrained();
  });

  it("produces a review-only promotion when both authorities still match", async () => {
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem();
    const manager = createManager(git, fileSystem);
    const connectedOriginal = {
      capturedAt: "2026-07-29T12:00:00.000Z",
      dirty: false,
      dirtyFingerprint: await manager.cleanFingerprint(BASE_REVISION),
      headRevision: BASE_REVISION,
      rootPath: ORIGINAL_ROOT,
    };
    const expectedProjectState = {
      capturedAt: "2026-07-29T12:00:00.000Z",
      dirty: false,
      dirtyFingerprint: await manager.cleanFingerprint(APPLIED_REVISION),
      headRevision: APPLIED_REVISION,
      rootPath: PROJECT_ROOT,
    };
    expectRepositoryCapture(git, ORIGINAL_ROOT, BASE_REVISION);
    expectRepositoryCapture(git, PROJECT_ROOT, APPLIED_REVISION);
    git.expect(
      PROJECT_ROOT,
      ["diff", "--name-only", "-z", BASE_REVISION, APPLIED_REVISION, "--"],
      "src/tokens.ts\u0000",
    );
    git.expect(
      PROJECT_ROOT,
      ["diff", "--binary", "--no-ext-diff", BASE_REVISION, APPLIED_REVISION, "--"],
      "diff --git a/src/tokens.ts b/src/tokens.ts\n-8\n+12\n",
    );

    const check = await manager.checkPromotion({
      connectedOriginal,
      expectedProjectState,
      projectRoot: PROJECT_ROOT,
    });

    expect(check).toMatchObject({
      changedPaths: ["src/tokens.ts"],
      conflicts: [],
      status: "ready",
    });
    expect(check.diff).toContain("+12");
    expect(check.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    git.assertDrained();
  });

  it("cleans up only the registered child worktree through its owning managed repository", async () => {
    const git = new ScriptedSourceGit();
    const fileSystem = new MemorySourceFileSystem();
    git.expect(PROJECT_ROOT, [
      "worktree",
      "remove",
      "--force",
      "--",
      RUN_ROOT,
    ]);
    git.expect(PROJECT_ROOT, ["worktree", "prune"]);
    const manager = createManager(git, fileSystem);

    const cleanup = await manager.cleanupRunWorktree({
      cleanupKind: "git-worktree-remove",
      ownerRootPath: PROJECT_ROOT,
      rootPath: RUN_ROOT,
      state: "merged-pending-cleanup",
    });

    expect(cleanup).toEqual({
      cleanupKind: "git-worktree-remove",
      ownerRootPath: PROJECT_ROOT,
      rootPath: RUN_ROOT,
      state: "removed",
    });
    git.assertDrained();
  });
});
