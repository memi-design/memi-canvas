import {
  compileSourceEdit,
  hashSourceText,
} from "@memi/source-compiler";

import {
  assertIdentifier,
  frozenClone,
  rootsOverlap,
  SourceWorktreeOperationError,
} from "./source-worktree-guards.js";
import type {
  DeterministicSourceCompositionErrorCode,
  DeterministicSourceEditCoordinator,
  DeterministicSourceEditCoordinatorOptions,
  DeterministicSourceEditReceipt,
  DeterministicSourceEditRequest,
  DeterministicSourceRecoveryEvidence,
  ManagedSourceProjectAuthorityPort,
} from "./source-worktree-compose.types.js";
import type {
  CompareAndApplySourceTextResult,
  InspectedSourceFile,
  ManagedSourceProject,
  SourceRepositoryState,
  SourceWorktreeFailureRecovery,
} from "./source-worktree.types.js";

export type * from "./source-worktree-compose.types.js";

const ZERO_USAGE = Object.freeze({
  inputTokens: 0 as const,
  modelCalls: 0 as const,
  outputTokens: 0 as const,
  totalTokens: 0 as const,
});

export class DeterministicSourceCompositionError extends Error {
  readonly code: DeterministicSourceCompositionErrorCode;
  readonly recovery: DeterministicSourceRecoveryEvidence | null;

  constructor(
    code: DeterministicSourceCompositionErrorCode,
    message: string,
    recovery: DeterministicSourceRecoveryEvidence | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DeterministicSourceCompositionError";
    this.code = code;
    this.recovery =
      recovery === null ? null : frozenClone(recovery);
  }
}

function assertManagedProject(
  request: DeterministicSourceEditRequest,
  project: ManagedSourceProject | null,
): ManagedSourceProject {
  if (
    project === null ||
    project.projectId !== request.projectId ||
    project.original.dirty ||
    project.state.dirty ||
    project.state.rootPath !== project.rootPath ||
    project.recovery.cleanupKind !== "remove-independent-clone" ||
    project.recovery.ownerRootPath !== null ||
    project.recovery.rootPath !== project.rootPath ||
    project.recovery.state !== "active" ||
    rootsOverlap(project.original.rootPath, project.rootPath)
  ) {
    throw new DeterministicSourceCompositionError(
      "stale-source-authority",
      "The project id does not resolve to an active independent managed source project.",
    );
  }
  if (
    request.anchor.sourceRevision !== project.state.headRevision ||
    request.anchor.dirtyFingerprint !== project.state.dirtyFingerprint
  ) {
    throw new DeterministicSourceCompositionError(
      "stale-source-authority",
      "The source anchor does not match the exact clean managed project authority.",
    );
  }
  return project;
}

async function assertInspection(
  files: readonly InspectedSourceFile[],
  expectedPath: string,
): Promise<InspectedSourceFile> {
  const inspected = files[0];
  if (
    files.length !== 1 ||
    inspected === undefined ||
    inspected.relativePath !== expectedPath ||
    inspected.contentHash !== (await hashSourceText(inspected.text))
  ) {
    throw new DeterministicSourceCompositionError(
      "source-inspection-failed",
      "Contained source inspection did not prove exactly one hash-bound file.",
    );
  }
  return inspected;
}

function recoveryEvidence(
  request: DeterministicSourceEditRequest,
  project: ManagedSourceProject,
  beforeHash: `sha256:${string}`,
  afterHash: `sha256:${string}`,
  stage: DeterministicSourceRecoveryEvidence["stage"],
  observedProjectState: SourceRepositoryState | null,
  worktree: SourceWorktreeFailureRecovery | null,
): DeterministicSourceRecoveryEvidence {
  return {
    action: "reinspect-before-recovery",
    baseRevision: project.state.headRevision,
    expectedAfterHash: afterHash,
    expectedBeforeHash: beforeHash,
    expectedProjectState: project.state,
    managedProjectId: project.projectId,
    observedProjectState,
    originalProtected: true,
    originalRootPath: project.original.rootPath,
    relativePath: request.anchor.path,
    rootPath: project.rootPath,
    stage,
    worktree,
  };
}

function assertApplyReceipt(
  result: CompareAndApplySourceTextResult,
  request: DeterministicSourceEditRequest,
  project: ManagedSourceProject,
  beforeHash: `sha256:${string}`,
  afterHash: `sha256:${string}`,
): void {
  const changed = result.changedFiles[0];
  if (
    result.changedFiles.length !== 1 ||
    changed === undefined ||
    changed.relativePath !== request.anchor.path ||
    changed.beforeHash !== beforeHash ||
    changed.afterHash !== afterHash ||
    result.state.dirty ||
    result.state.rootPath !== project.rootPath ||
    result.state.headRevision === project.state.headRevision
  ) {
    throw new DeterministicSourceCompositionError(
      "apply-postcondition-failed",
      "Managed source apply did not prove one clean hash-bound revision.",
      recoveryEvidence(
        request,
        project,
        beforeHash,
        afterHash,
        "apply-postcondition",
        result.state,
        null,
      ),
    );
  }
}

class DeterministicSourceEditCoordinatorImpl
  implements DeterministicSourceEditCoordinator
{
  readonly #projectAuthority: ManagedSourceProjectAuthorityPort;
  readonly #sourceWorktree:
    DeterministicSourceEditCoordinatorOptions["sourceWorktree"];

  constructor(options: DeterministicSourceEditCoordinatorOptions) {
    this.#projectAuthority = options.projectAuthority;
    this.#sourceWorktree = options.sourceWorktree;
  }

  async apply(
    request: DeterministicSourceEditRequest,
  ): Promise<DeterministicSourceEditReceipt> {
    const projectId = assertIdentifier(request.projectId, "Project id");
    const resolvedProject =
      await this.#projectAuthority.resolveActiveProject(projectId);
    const project = assertManagedProject(
      request,
      resolvedProject === null ? null : frozenClone(resolvedProject),
    );
    const inspected = await assertInspection(
      await this.#sourceWorktree.inspectContainedFiles(
        project.rootPath,
        [request.anchor.path],
      ),
      request.anchor.path,
    );
    const compiled = await compileSourceEdit({
      anchor: request.anchor,
      edit: request.edit,
      sourceText: inspected.text,
    });
    if (
      !compiled.zeroToken ||
      compiled.beforeHash !== inspected.contentHash ||
      compiled.patch.expectedBeforeHash !== inspected.contentHash ||
      compiled.patch.relativePath !== request.anchor.path ||
      compiled.afterHash !== (await hashSourceText(compiled.afterText))
    ) {
      throw new DeterministicSourceCompositionError(
        "compile-postcondition-failed",
        "Deterministic compiler output did not preserve its hash-bound contract.",
      );
    }

    let applied: CompareAndApplySourceTextResult;
    try {
      applied =
        await this.#sourceWorktree.compareAndApplyTextChanges({
          changes: [
            {
              afterText: compiled.afterText,
              expectedBeforeHash: compiled.beforeHash,
              relativePath: request.anchor.path,
            },
          ],
          commitMessage: request.commitMessage,
          expectedState: project.state,
          rootPath: project.rootPath,
        });
    } catch (error) {
      const worktree =
        error instanceof SourceWorktreeOperationError
          ? error.recovery
          : null;
      throw new DeterministicSourceCompositionError(
        "apply-failed",
        "Deterministic source apply failed and requires exact reinspection.",
        recoveryEvidence(
          request,
          project,
          compiled.beforeHash,
          compiled.afterHash,
          "apply-error",
          null,
          worktree,
        ),
        { cause: error },
      );
    }
    assertApplyReceipt(
      applied,
      request,
      project,
      compiled.beforeHash,
      compiled.afterHash,
    );

    return frozenClone({
      actor: request.actor ?? "human",
      changedRange: compiled.changedRange,
      patchSummary: compiled.patch.summary,
      source: {
        after: {
          contentHash: compiled.afterHash,
          dirtyFingerprint: applied.state.dirtyFingerprint,
          revision: applied.state.headRevision,
        },
        before: {
          contentHash: compiled.beforeHash,
          dirtyFingerprint: project.state.dirtyFingerprint,
          revision: project.state.headRevision,
        },
        relativePath: request.anchor.path,
      },
      status: "applied",
      usage: ZERO_USAGE,
      zeroToken: true,
    });
  }
}

/**
 * Internal-only composition. Package-root export remains forbidden until the
 * production mutation broker and recovery service lift the source-write veto.
 */
export function createDeterministicSourceEditCoordinator(
  options: DeterministicSourceEditCoordinatorOptions,
): DeterministicSourceEditCoordinator {
  return new DeterministicSourceEditCoordinatorImpl(options);
}
