import { resolve } from "node:path";
import type {
  AppliedSourceFile, CheckSourcePromotionInput,
  CompareAndApplySourceTextInput, CompareAndApplySourceTextResult,
  CreateManagedSourceProjectInput, CreateRunSourceWorktreeInput,
  InspectedSourceFile, ManagedSourceProject,
  MergeApprovedRunWorktreeInput, MergeApprovedRunWorktreeResult,
  RunSourceWorktree, RunWorktreeApprovalAuthorityPort, RunWorktreeReview,
  SourceContentHash, SourceFileSystemPort, SourceGitRequest, SourceGitResult,
  SourcePromotionCheck, SourceRepositoryState, SourceWorktreeManager,
  SourceWorktreeManagerOptions, SourceWorktreeMutationAuthorizationPort,
  SourceWorktreeProcessPort, SourceWorktreeRecovery,
} from "./source-worktree.types.js";
import {
  assertAbsoluteRoot, assertBoundedSourceText, assertIdentifier,
  assertRevision, frozenClone, hashSourceBytes, hashSourceText,
  hashStableValue, isPathContained, MAX_CHANGED_FILES,
  MAX_COMMIT_MESSAGE_LENGTH, MAX_FILE_BYTES, MAX_TOTAL_BYTES, parseNulPaths,
  parseTrackedStatusPaths, parseUntrackedPaths, recoveryFor, rootsOverlap,
  SHA256_PATTERN, stateAuthorityValue, stateMatches,
  SourceWorktreeOperationError, validateRelativeSourcePath,
} from "./source-worktree-guards.js";
import {
  checkSourcePromotion,
  cleanupRegisteredRunWorktree,
} from "./source-worktree-lifecycle.js";
import {
  authorizeSourceWorktreeMutation,
  SOURCE_REPOSITORY_PROCESS_POLICY,
} from "./source-worktree-security.js";
export type * from "./source-worktree.types.js";
export {
  hashSourceBytes,
  hashSourceText,
  SourceWorktreeOperationError,
} from "./source-worktree-guards.js";
export { approveRunWorktreeReview } from "./source-worktree-approval.js";
class SourceWorktreeManagerImpl implements SourceWorktreeManager {
  readonly #approvalAuthority: RunWorktreeApprovalAuthorityPort;
  readonly #fileSystem: SourceFileSystemPort;
  readonly #now: () => string;
  readonly #process: SourceWorktreeProcessPort;
  readonly #securityAuthorization: SourceWorktreeMutationAuthorizationPort;

  constructor(options: SourceWorktreeManagerOptions) {
    this.#approvalAuthority = options.approvalAuthority;
    this.#fileSystem = options.fileSystem;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#process = options.process;
    this.#securityAuthorization = options.securityAuthorization;
  }

  async #runGit(
    request: Omit<
      SourceGitRequest,
      "repositoryProcessPolicy" | "securityProfile"
    >,
  ): Promise<SourceGitResult> {
    const result = await this.#process.runGit(
      frozenClone({
        ...request,
        repositoryProcessPolicy: SOURCE_REPOSITORY_PROCESS_POLICY,
        securityProfile: "source-worktree" as const,
      }),
    );
    if (!Number.isSafeInteger(result.exitCode) || result.exitCode !== 0) {
      throw new Error(
        `Git operation failed with exit code ${String(result.exitCode)}.`,
      );
    }
    return result;
  }

  async #canonicalRoot(rootPath: string): Promise<string> {
    const absolute = assertAbsoluteRoot(rootPath, "Source workspace root");
    const canonical = await this.#fileSystem.realpath(absolute);
    return assertAbsoluteRoot(canonical, "Canonical source workspace root");
  }

  async #containedFilePath(
    rootPath: string,
    relativePath: string,
  ): Promise<string> {
    const safePath = validateRelativeSourcePath(relativePath);
    const candidate = resolve(rootPath, safePath);
    if (!isPathContained(rootPath, candidate)) {
      throw new Error(
        "Source path must remain inside the managed source workspace.",
      );
    }
    const canonicalFile = await this.#fileSystem.realpath(candidate);
    if (!isPathContained(rootPath, canonicalFile)) {
      throw new Error(
        `Source path ${safePath} resolves outside the managed source workspace.`,
      );
    }
    return canonicalFile;
  }

  async #repositoryFingerprint(
    rootPath: string,
    headRevision: string,
    status: string,
    worktreeDiff: string,
    cachedDiff: string,
  ): Promise<SourceContentHash> {
    const untracked = await Promise.all(
      parseUntrackedPaths(status).map(async (relativePath) => {
        const absolutePath = await this.#containedFilePath(
          rootPath,
          relativePath,
        );
        return {
          contentHash: hashSourceBytes(
            await this.#fileSystem.readFile(absolutePath),
          ),
          relativePath,
        };
      }),
    );
    return hashStableValue({
      cachedDiff,
      headRevision,
      status,
      untracked,
      worktreeDiff,
    });
  }

  async cleanFingerprint(
    headRevision: string,
  ): Promise<SourceContentHash> {
    assertRevision(headRevision, "Clean source revision");
    return this.#repositoryFingerprint(
      "/",
      headRevision,
      "",
      "",
      "",
    );
  }

  async captureRepositoryState(
    rootPath: string,
  ): Promise<SourceRepositoryState> {
    const canonicalRoot = await this.#canonicalRoot(rootPath);
    const reportedRoot = (
      await this.#runGit({
        args: ["rev-parse", "--show-toplevel"],
        cwd: canonicalRoot,
      })
    ).stdout.trim();
    if (reportedRoot !== canonicalRoot) {
      throw new Error(
        "Connected source root does not match the Git repository root.",
      );
    }
    const headRevision = assertRevision(
      (
        await this.#runGit({
          args: ["rev-parse", "HEAD"],
          cwd: canonicalRoot,
        })
      ).stdout.trim(),
      "Repository HEAD",
    );
    const status = (
      await this.#runGit({
        args: [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ],
        cwd: canonicalRoot,
      })
    ).stdout;
    const worktreeDiff = (
      await this.#runGit({
        args: ["diff", "--binary", "--no-ext-diff", "HEAD", "--"],
        cwd: canonicalRoot,
      })
    ).stdout;
    const cachedDiff = (
      await this.#runGit({
        args: [
          "diff",
          "--binary",
          "--cached",
          "--no-ext-diff",
          "HEAD",
          "--",
        ],
        cwd: canonicalRoot,
      })
    ).stdout;
    return frozenClone({
      capturedAt: this.#now(),
      dirty: status.length > 0,
      dirtyFingerprint: await this.#repositoryFingerprint(
        canonicalRoot,
        headRevision,
        status,
        worktreeDiff,
        cachedDiff,
      ),
      headRevision,
      rootPath: canonicalRoot,
    });
  }

  async createManagedProject(
    input: CreateManagedSourceProjectInput,
  ): Promise<ManagedSourceProject> {
    const projectId = assertIdentifier(input.projectId, "Project id");
    const managedProjectsRoot = await this.#canonicalRoot(
      input.managedProjectsRoot,
    );
    const original = await this.captureRepositoryState(
      input.originalRoot,
    );
    if (original.dirty) {
      throw new Error(
        "The original repository must be clean before it can become source-editable.",
      );
    }
    if (rootsOverlap(original.rootPath, managedProjectsRoot)) {
      throw new Error(
        "Managed project storage must be disjoint from the original repository.",
      );
    }
    const projectRoot = resolve(managedProjectsRoot, projectId);
    if (!isPathContained(managedProjectsRoot, projectRoot)) {
      throw new Error("Managed project path escaped its storage root.");
    }
    await authorizeSourceWorktreeMutation(this.#securityAuthorization, {
      kind: "managed-project.create",
      relativePaths: [],
      sourceRootPath: original.rootPath,
      targetRootPath: projectRoot,
    });
    try {
      await this.#runGit({
        args: [
          "clone",
          "--local",
          "--no-hardlinks",
          "--no-checkout",
          "--no-recurse-submodules",
          "--",
          original.rootPath,
          projectRoot,
        ],
        cwd: managedProjectsRoot,
      });
      await this.#runGit({
        args: [
          "-c",
          "core.hooksPath=/dev/null",
          "checkout",
          "--detach",
          original.headRevision,
        ],
        cwd: projectRoot,
      });
      const state = await this.captureRepositoryState(projectRoot);
      if (
        state.headRevision !== original.headRevision ||
        state.dirty
      ) {
        throw new Error(
          "Managed clone did not reproduce the exact clean base revision.",
        );
      }
      return frozenClone({
        createdAt: this.#now(),
        original,
        projectId,
        recovery: {
          cleanupKind: "remove-independent-clone" as const,
          ownerRootPath: null,
          rootPath: projectRoot,
          state: "active" as const,
        },
        rootPath: projectRoot,
        state,
      });
    } catch (error) {
      throw new SourceWorktreeOperationError(
        "Managed project creation failed; the original repository was not written.",
        recoveryFor("clone", projectRoot, []),
        { cause: error },
      );
    }
  }

  async inspectContainedFiles(
    rootPath: string,
    relativePaths: readonly string[],
  ): Promise<readonly InspectedSourceFile[]> {
    if (
      relativePaths.length === 0 ||
      relativePaths.length > MAX_CHANGED_FILES
    ) {
      throw new Error(
        `Source inspection requires between 1 and ${MAX_CHANGED_FILES} files.`,
      );
    }
    const canonicalRoot = await this.#canonicalRoot(rootPath);
    const safePaths = relativePaths.map(validateRelativeSourcePath);
    if (new Set(safePaths).size !== safePaths.length) {
      throw new Error("Source inspection paths must be unique.");
    }
    let totalBytes = 0;
    const files = await Promise.all(
      safePaths.map(async (relativePath) => {
        const absolutePath = await this.#containedFilePath(
          canonicalRoot,
          relativePath,
        );
        const bytes = await this.#fileSystem.readFile(absolutePath);
        totalBytes += bytes.byteLength;
        if (
          bytes.byteLength > MAX_FILE_BYTES ||
          totalBytes > MAX_TOTAL_BYTES
        ) {
          throw new Error("Source inspection exceeds the bounded text limit.");
        }
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new Error(
            `${relativePath} is not valid UTF-8 source text.`,
          );
        }
        if (text.includes("\u0000")) {
          throw new Error(`${relativePath} contains binary data.`);
        }
        return {
          contentHash: hashSourceBytes(bytes),
          relativePath,
          text,
        };
      }),
    );
    return frozenClone(files);
  }

  async compareAndApplyTextChanges(
    input: CompareAndApplySourceTextInput,
  ): Promise<CompareAndApplySourceTextResult> {
    const canonicalRoot = await this.#canonicalRoot(input.rootPath);
    const current = await this.captureRepositoryState(canonicalRoot);
    if (!stateMatches(current, input.expectedState) || current.dirty) {
      throw new Error(
        "Managed source workspace changed before compare-and-apply.",
      );
    }
    const commitMessage = input.commitMessage.trim();
    if (
      commitMessage.length === 0 ||
      commitMessage.length > MAX_COMMIT_MESSAGE_LENGTH ||
      [...commitMessage].some(
        (character) =>
          character.charCodeAt(0) < 32 && character !== "\t",
      )
    ) {
      throw new Error("Source commit message is invalid.");
    }
    const files = await this.inspectContainedFiles(
      canonicalRoot,
      input.changes.map(({ relativePath }) => relativePath),
    );
    const filesByPath = new Map(
      files.map((file) => [file.relativePath, file]),
    );
    const writePaths = await Promise.all(
      input.changes.map(({ relativePath }) =>
        this.#containedFilePath(canonicalRoot, relativePath),
      ),
    );
    let replacementBytes = 0;
    const writes = input.changes.map((change, index) => {
      assertBoundedSourceText(change.afterText, change.relativePath);
      replacementBytes += new TextEncoder().encode(
        change.afterText,
      ).byteLength;
      if (replacementBytes > MAX_TOTAL_BYTES) {
        throw new Error(
          "Source changes exceed the bounded aggregate text limit.",
        );
      }
      if (!SHA256_PATTERN.test(change.expectedBeforeHash)) {
        throw new Error(
          `${change.relativePath} requires an exact SHA-256 source fingerprint.`,
        );
      }
      const inspected = filesByPath.get(change.relativePath);
      if (
        inspected === undefined ||
        inspected.contentHash !== change.expectedBeforeHash
      ) {
        throw new Error(
          `${change.relativePath} no longer matches its expected SHA-256 source fingerprint.`,
        );
      }
      if (inspected.text === change.afterText) {
        throw new Error(
          `${change.relativePath} does not contain a source change.`,
        );
      }
      return {
        absolutePath: writePaths[index]!,
        afterText: change.afterText,
        beforeText: inspected.text,
      };
    });
    const paths = input.changes.map(({ relativePath }) => relativePath);
    await authorizeSourceWorktreeMutation(this.#securityAuthorization, {
      kind: "managed-source.apply",
      relativePaths: paths,
      sourceRootPath: canonicalRoot,
      targetRootPath: canonicalRoot,
    });
    let writeAccepted = false;
    try {
      await this.#fileSystem.replaceTextFilesRecoverably(
        frozenClone(writes),
      );
      writeAccepted = true;
      await this.#runGit({
        args: ["add", "--", ...paths],
        cwd: canonicalRoot,
      });
      await this.#runGit({
        args: [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "user.name=Memi Canvas",
          "-c",
          "user.email=canvas@localhost",
          "commit",
          "--no-gpg-sign",
          "-m",
          commitMessage,
          "--",
          ...paths,
        ],
        cwd: canonicalRoot,
      });
      const state = await this.captureRepositoryState(canonicalRoot);
      if (state.dirty || state.headRevision === current.headRevision) {
        throw new Error(
          "Managed source commit did not produce a clean new revision.",
        );
      }
      const changedFiles: AppliedSourceFile[] = await Promise.all(
        input.changes.map(async (change) => ({
          afterHash: await hashSourceText(change.afterText),
          beforeHash: change.expectedBeforeHash,
          relativePath: change.relativePath,
        })),
      );
      return frozenClone({ changedFiles, state });
    } catch (error) {
      if (!writeAccepted) {
        throw error;
      }
      throw new SourceWorktreeOperationError(
        "Managed source write requires recovery before another operation.",
        recoveryFor("apply-commit", canonicalRoot, paths),
        { cause: error },
      );
    }
  }

  async createRunWorktree(
    input: CreateRunSourceWorktreeInput,
  ): Promise<RunSourceWorktree> {
    const runId = assertIdentifier(input.runId, "Run id");
    const projectRoot = await this.#canonicalRoot(input.project.rootPath);
    const runsRoot = await this.#canonicalRoot(input.runsRoot);
    if (rootsOverlap(projectRoot, runsRoot)) {
      throw new Error(
        "Run worktree storage must be disjoint from its managed project.",
      );
    }
    const current = await this.captureRepositoryState(projectRoot);
    if (!stateMatches(current, input.project.state) || current.dirty) {
      throw new Error(
        "Managed project changed before run worktree creation.",
      );
    }
    const runRoot = resolve(runsRoot, runId);
    await authorizeSourceWorktreeMutation(this.#securityAuthorization, {
      kind: "run-worktree.create",
      relativePaths: [],
      sourceRootPath: projectRoot,
      targetRootPath: runRoot,
    });
    try {
      await this.#runGit({
        args: [
          "-c",
          "core.hooksPath=/dev/null",
          "worktree",
          "add",
          "--detach",
          runRoot,
          current.headRevision,
        ],
        cwd: projectRoot,
      });
      const runState = await this.captureRepositoryState(runRoot);
      if (
        runState.dirty ||
        runState.headRevision !== current.headRevision
      ) {
        throw new Error(
          "Run worktree did not reproduce the managed project revision.",
        );
      }
      return frozenClone({
        baseProjectState: current,
        createdAt: this.#now(),
        projectId: input.project.projectId,
        recovery: {
          cleanupKind: "git-worktree-remove" as const,
          ownerRootPath: projectRoot,
          rootPath: runRoot,
          state: "active" as const,
        },
        rootPath: runRoot,
        runId,
      });
    } catch (error) {
      throw new SourceWorktreeOperationError(
        "Run worktree creation failed.",
        recoveryFor("create-run", runRoot, []),
        { cause: error },
      );
    }
  }

  async #buildRunReview(
    run: RunSourceWorktree,
    currentProjectState: SourceRepositoryState,
  ): Promise<RunWorktreeReview> {
    if (!stateMatches(currentProjectState, run.baseProjectState)) {
      throw new Error("Managed project changed after the run started.");
    }
    const runState = await this.captureRepositoryState(run.rootPath);
    if (runState.headRevision !== run.baseProjectState.headRevision) {
      throw new Error("Run worktree HEAD changed before review.");
    }
    const statusPaths = parseNulPaths(
      (
        await this.#runGit({
          args: [
            "diff",
            "--name-only",
            "-z",
            "--no-ext-diff",
            run.baseProjectState.headRevision,
            "--",
          ],
          cwd: run.rootPath,
        })
      ).stdout,
    );
    if (statusPaths.length === 0) {
      throw new Error("Run worktree does not contain reviewable changes.");
    }
    const capturedStatusPaths = parseTrackedStatusPaths(
      (
        await this.#runGit({
          args: [
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
          ],
          cwd: run.rootPath,
        })
      ).stdout,
    );
    if (
      capturedStatusPaths.length !== statusPaths.length ||
      !statusPaths.every((path) => capturedStatusPaths.includes(path))
    ) {
      throw new Error(
        "Run status and review diff do not identify the same source files.",
      );
    }
    const diff = (
      await this.#runGit({
        args: [
          "diff",
          "--binary",
          "--no-ext-diff",
          run.baseProjectState.headRevision,
          "--",
        ],
        cwd: run.rootPath,
      })
    ).stdout;
    const reviewedAt = this.#now();
    const digest = hashStableValue({
      baseProjectState: stateAuthorityValue(run.baseProjectState),
      changedPaths: statusPaths,
      currentProjectState: stateAuthorityValue(currentProjectState),
      diff,
      runId: run.runId,
    });
    return frozenClone({
      baseProjectState: run.baseProjectState,
      changedPaths: statusPaths,
      currentProjectState,
      diff,
      digest,
      reviewedAt,
      run,
      status: "ready" as const,
    });
  }

  async reviewRunWorktree(
    run: RunSourceWorktree,
  ): Promise<RunWorktreeReview> {
    const currentProjectState = await this.captureRepositoryState(
      run.baseProjectState.rootPath,
    );
    return this.#buildRunReview(run, currentProjectState);
  }

  async mergeApprovedRunWorktree(
    input: MergeApprovedRunWorktreeInput,
  ): Promise<MergeApprovedRunWorktreeResult> {
    if (
      !(await this.#approvalAuthority.isActiveExact(input.approval))
    ) {
      throw new Error("Run worktree approval has already been consumed.");
    }
    if (
      input.approval.digest !== input.review.digest ||
      input.approval.runId !== input.review.run.runId
    ) {
      throw new Error(
        "Run worktree approval does not match the exact review.",
      );
    }
    const projectRoot = await this.#canonicalRoot(input.projectRoot);
    if (
      projectRoot !== input.review.run.baseProjectState.rootPath ||
      input.review.run.recovery.ownerRootPath !== projectRoot
    ) {
      throw new Error("Run worktree is not owned by this managed project.");
    }
    const projectState = await this.captureRepositoryState(projectRoot);
    const repeatedReview = await this.#buildRunReview(
      input.review.run,
      projectState,
    );
    if (repeatedReview.digest !== input.review.digest) {
      throw new Error("Run worktree changed after approval.");
    }
    await authorizeSourceWorktreeMutation(this.#securityAuthorization, {
      kind: "run-worktree.merge",
      relativePaths: input.review.changedPaths,
      sourceRootPath: input.review.run.rootPath,
      targetRootPath: projectRoot,
    });
    if (
      !(await this.#approvalAuthority.consumeExact(input.approval))
    ) {
      throw new Error(
        "Run worktree approval could not be reserved for this merge.",
      );
    }
    const paths = input.review.changedPaths;
    try {
      await this.#runGit({
        args: ["add", "--", ...paths],
        cwd: input.review.run.rootPath,
      });
      await this.#runGit({
        args: [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "user.name=Memi Canvas",
          "-c",
          "user.email=canvas@localhost",
          "commit",
          "--no-gpg-sign",
          "-m",
          `memi: approve run ${input.review.run.runId}`,
          "--",
          ...paths,
        ],
        cwd: input.review.run.rootPath,
      });
      const mergedRevision = assertRevision(
        (
          await this.#runGit({
            args: ["rev-parse", "HEAD"],
            cwd: input.review.run.rootPath,
          })
        ).stdout.trim(),
        "Approved run revision",
      );
      await this.#runGit({
        args: [
          "-c",
          "core.hooksPath=/dev/null",
          "merge",
          "--ff-only",
          "--no-edit",
          mergedRevision,
        ],
        cwd: projectRoot,
      });
      const resultingProjectState =
        await this.captureRepositoryState(projectRoot);
      if (
        resultingProjectState.dirty ||
        resultingProjectState.headRevision !== mergedRevision
      ) {
        throw new Error(
          "Managed project did not converge to the approved run revision.",
        );
      }
      return frozenClone({
        mergedRevision,
        projectState: resultingProjectState,
        recovery: {
          ...input.review.run.recovery,
          state: "merged-pending-cleanup" as const,
        },
        status: "merged" as const,
      });
    } catch (error) {
      throw new SourceWorktreeOperationError(
        "Approved run merge requires recovery.",
        recoveryFor("merge-run", projectRoot, paths, {
          approvalId: input.approval.approvalId,
          reviewDigest: input.review.digest,
          runId: input.review.run.runId,
        }),
        { cause: error },
      );
    }
  }

  async checkPromotion(
    input: CheckSourcePromotionInput,
  ): Promise<SourcePromotionCheck> {
    return checkSourcePromotion(input, {
      canonicalRoot: (rootPath) => this.#canonicalRoot(rootPath),
      captureRepositoryState: (rootPath) =>
        this.captureRepositoryState(rootPath),
      runGit: (request) => this.#runGit(request),
    });
  }

  async cleanupRunWorktree(
    recovery: SourceWorktreeRecovery,
  ): Promise<SourceWorktreeRecovery> {
    await authorizeSourceWorktreeMutation(this.#securityAuthorization, {
      kind: "run-worktree.cleanup",
      relativePaths: [],
      sourceRootPath: recovery.ownerRootPath ?? "",
      targetRootPath: recovery.rootPath,
    });
    return cleanupRegisteredRunWorktree(recovery, {
      canonicalRoot: (rootPath) => this.#canonicalRoot(rootPath),
      captureRepositoryState: (rootPath) =>
        this.captureRepositoryState(rootPath),
      runGit: (request) => this.#runGit(request),
    });
  }
}

export function createSourceWorktreeManager(
  options: SourceWorktreeManagerOptions,
): SourceWorktreeManager {
  return new SourceWorktreeManagerImpl(options);
}
