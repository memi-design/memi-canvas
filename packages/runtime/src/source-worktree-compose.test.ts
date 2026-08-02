import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createSourceAnchorForTarget,
  DeterministicSourceCompilerError,
  hashSourceText,
  type SourceEdit,
} from "@memi/source-compiler";
import type { SourceAnchorV2 } from "@memi/protocol";

import {
  createDeterministicSourceEditCoordinator,
  DeterministicSourceCompositionError,
  type ManagedSourceProjectAuthorityPort,
} from "./source-worktree-compose.js";
import {
  SourceWorktreeOperationError,
} from "./source-worktree.js";
import type {
  CompareAndApplySourceTextInput,
  CompareAndApplySourceTextResult,
  InspectedSourceFile,
  ManagedSourceProject,
  SourceRepositoryState,
  SourceWorktreeManager,
} from "./source-worktree.types.js";

const ROOT = "/memi/projects/buzzr";
const ORIGINAL_ROOT = "/repos/buzzr";
const PROJECT_ID = "buzzr";
const BASE_REVISION = "a".repeat(40);
const NEXT_REVISION = "b".repeat(40);
const RELATIVE_PATH = "src/theme/layout.ts";
const SOURCE = [
  "export const BUTTON_RADIUS_MD = 12;",
  "export const SPACING = {",
  "  lg: 12,",
  "} as const;",
  "",
].join("\n");
const BUZZR_ROOT =
  process.env["MEMI_BUZZR_REPOSITORY_ROOT"] ?? "";
const BUZZR_LAYOUT_PATH = "src/theme/layout.ts";
const BUZZR_AVAILABLE =
  BUZZR_ROOT.length > 0 &&
  existsSync(join(BUZZR_ROOT, BUZZR_LAYOUT_PATH));
const BUZZR_REVISION =
  "a6ce2458e0cd1b252663057f2e4060f0929c0687";
const TARGET = {
  declarationName: "BUTTON_RADIUS_MD",
  kind: "constant",
} as const;
const EDIT: SourceEdit = {
  after: { kind: "number", value: 14 },
  before: { kind: "number", value: 12 },
  target: TARGET,
};

async function state(
  revision = BASE_REVISION,
): Promise<SourceRepositoryState> {
  return {
    capturedAt: "2026-07-29T12:00:00.000Z",
    dirty: false,
    dirtyFingerprint: await hashSourceText(`clean:${revision}`),
    headRevision: revision,
    rootPath: ROOT,
  };
}

async function managedProject(
  projectState?: SourceRepositoryState,
): Promise<ManagedSourceProject> {
  const resolvedProjectState = projectState ?? (await state());
  return {
    createdAt: "2026-07-29T12:00:00.000Z",
    original: {
      capturedAt: "2026-07-29T12:00:00.000Z",
      dirty: false,
      dirtyFingerprint: await hashSourceText(
        `clean:${BASE_REVISION}`,
      ),
      headRevision: BASE_REVISION,
      rootPath: ORIGINAL_ROOT,
    },
    projectId: PROJECT_ID,
    recovery: {
      cleanupKind: "remove-independent-clone",
      ownerRootPath: null,
      rootPath: ROOT,
      state: "active",
    },
    rootPath: ROOT,
    state: resolvedProjectState,
  };
}

async function anchor(
  sourceText = SOURCE,
  projectState?: SourceRepositoryState,
): Promise<SourceAnchorV2> {
  const authority = projectState ?? (await state());
  return createSourceAnchorForTarget({
    componentIdentity: "buzzr.button",
    dirtyFingerprint: authority.dirtyFingerprint,
    expectedValue: EDIT.before,
    relativePath: RELATIVE_PATH,
    runtimeEvidenceRefs: ["capture:buzzr-button"],
    sourceRevision: authority.headRevision,
    sourceText,
    target: TARGET,
  });
}

class CompositionProjectAuthority
  implements ManagedSourceProjectAuthorityPort
{
  readonly calls: string[] = [];

  constructor(
    readonly activeProject: ManagedSourceProject | null,
  ) {}

  async resolveActiveProject(
    projectId: string,
  ): Promise<ManagedSourceProject | null> {
    this.calls.push(projectId);
    return this.activeProject;
  }
}

class CompositionManager
  implements Pick<
    SourceWorktreeManager,
    "compareAndApplyTextChanges" | "inspectContainedFiles"
  >
{
  readonly applyCalls: CompareAndApplySourceTextInput[] = [];
  readonly inspectCalls: {
    readonly rootPath: string;
    readonly relativePaths: readonly string[];
  }[] = [];
  inspectedText = SOURCE;
  nextState: SourceRepositoryState | null = null;
  applyFailure: Error | null = null;

  async inspectContainedFiles(
    rootPath: string,
    relativePaths: readonly string[],
  ): Promise<readonly InspectedSourceFile[]> {
    this.inspectCalls.push({
      relativePaths: [...relativePaths],
      rootPath,
    });
    return [
      {
        contentHash: await hashSourceText(this.inspectedText),
        relativePath: RELATIVE_PATH,
        text: this.inspectedText,
      },
    ];
  }

  async compareAndApplyTextChanges(
    input: CompareAndApplySourceTextInput,
  ): Promise<CompareAndApplySourceTextResult> {
    this.applyCalls.push(structuredClone(input));
    if (this.applyFailure !== null) {
      throw this.applyFailure;
    }
    const nextState = this.nextState;
    if (nextState === null) {
      throw new Error("Test manager requires a next state.");
    }
    return {
      changedFiles: await Promise.all(
        input.changes.map(async (change) => ({
          afterHash: await hashSourceText(change.afterText),
          beforeHash: change.expectedBeforeHash,
          relativePath: change.relativePath,
        })),
      ),
      state: nextState,
    };
  }
}

describe("deterministic zero-token source composition", () => {
  it("inspects, compiles, and compare-applies complete source text with exact revisions", async () => {
    const beforeState = await state();
    const afterState = await state(NEXT_REVISION);
    const manager = new CompositionManager();
    manager.nextState = afterState;
    const coordinator = createDeterministicSourceEditCoordinator({
      projectAuthority: new CompositionProjectAuthority(
        await managedProject(beforeState),
      ),
      sourceWorktree: manager,
    });

    const receipt = await coordinator.apply({
      anchor: await anchor(SOURCE, beforeState),
      commitMessage: "memi: set Buzzr button radius",
      edit: EDIT,
      projectId: PROJECT_ID,
    });

    expect(manager.inspectCalls).toEqual([
      { relativePaths: [RELATIVE_PATH], rootPath: ROOT },
    ]);
    expect(manager.applyCalls).toHaveLength(1);
    const apply = manager.applyCalls[0];
    expect(apply?.changes).toEqual([
      {
        afterText: SOURCE.replace(
          "export const BUTTON_RADIUS_MD = 12;",
          "export const BUTTON_RADIUS_MD = 14;",
        ),
        expectedBeforeHash: await hashSourceText(SOURCE),
        relativePath: RELATIVE_PATH,
      },
    ]);
    expect(apply?.expectedState).toEqual(beforeState);
    expect(receipt).toMatchObject({
      actor: "human",
      source: {
        after: {
          contentHash: await hashSourceText(
            SOURCE.replace(
              "export const BUTTON_RADIUS_MD = 12;",
              "export const BUTTON_RADIUS_MD = 14;",
            ),
          ),
          revision: NEXT_REVISION,
        },
        before: {
          contentHash: await hashSourceText(SOURCE),
          revision: BASE_REVISION,
        },
        relativePath: RELATIVE_PATH,
      },
      status: "applied",
      usage: {
        inputTokens: 0,
        modelCalls: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      zeroToken: true,
    });
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("rejects a stale anchor revision before inspecting or mutating source", async () => {
    const manager = new CompositionManager();
    const current = await state(NEXT_REVISION);
    const coordinator = createDeterministicSourceEditCoordinator({
      projectAuthority: new CompositionProjectAuthority(
        await managedProject(current),
      ),
      sourceWorktree: manager,
    });

    await expect(
      coordinator.apply({
        anchor: await anchor(),
        commitMessage: "memi: stale edit",
        edit: EDIT,
        projectId: PROJECT_ID,
      }),
    ).rejects.toMatchObject({
      code: "stale-source-authority",
      name: "DeterministicSourceCompositionError",
    });
    expect(manager.inspectCalls).toEqual([]);
    expect(manager.applyCalls).toEqual([]);
  });

  it("requires an active registered independent managed-project capability", async () => {
    const manager = new CompositionManager();
    const unregistered = createDeterministicSourceEditCoordinator({
      projectAuthority: new CompositionProjectAuthority(null),
      sourceWorktree: manager,
    });

    await expect(
      unregistered.apply({
        anchor: await anchor(),
        commitMessage: "memi: reject unregistered target",
        edit: EDIT,
        projectId: PROJECT_ID,
      }),
    ).rejects.toMatchObject({
      code: "stale-source-authority",
    });

    const candidate = await managedProject();
    const forgedOverlap = createDeterministicSourceEditCoordinator({
      projectAuthority: new CompositionProjectAuthority({
        ...candidate,
        original: {
          ...candidate.original,
          rootPath: ROOT,
        },
      }),
      sourceWorktree: manager,
    });
    await expect(
      forgedOverlap.apply({
        anchor: await anchor(),
        commitMessage: "memi: reject overlapping target",
        edit: EDIT,
        projectId: PROJECT_ID,
      }),
    ).rejects.toMatchObject({
      code: "stale-source-authority",
    });
    expect(manager.inspectCalls).toEqual([]);
    expect(manager.applyCalls).toEqual([]);
  });

  it("proves an anchor hash conflict against contained inspected source before apply", async () => {
    const manager = new CompositionManager();
    manager.inspectedText = SOURCE.replace("12;", "10;");
    const coordinator = createDeterministicSourceEditCoordinator({
      projectAuthority: new CompositionProjectAuthority(
        await managedProject(),
      ),
      sourceWorktree: manager,
    });

    await expect(
      coordinator.apply({
        anchor: await anchor(),
        commitMessage: "memi: stale hash edit",
        edit: EDIT,
        projectId: PROJECT_ID,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof DeterministicSourceCompilerError &&
        error.code === "anchor-hash-mismatch",
    );
    expect(manager.applyCalls).toEqual([]);
  });

  it("carries exact reinspection recovery evidence when apply fails after write acceptance", async () => {
    const manager = new CompositionManager();
    const worktreeRecovery = {
      approvalId: null,
      changedPaths: [RELATIVE_PATH],
      originalProtected: true,
      phase: "apply-commit",
      reviewDigest: null,
      rootPath: ROOT,
      runId: null,
    } as const;
    manager.applyFailure = new SourceWorktreeOperationError(
      "commit failed",
      worktreeRecovery,
    );
    const coordinator = createDeterministicSourceEditCoordinator({
      projectAuthority: new CompositionProjectAuthority(
        await managedProject(),
      ),
      sourceWorktree: manager,
    });

    const failure = await coordinator
      .apply({
        anchor: await anchor(),
        commitMessage: "memi: recover this edit",
        edit: EDIT,
        projectId: PROJECT_ID,
      })
      .catch((error: unknown) => error);

    if (!(failure instanceof DeterministicSourceCompositionError)) {
      throw failure;
    }
    expect(failure).toBeInstanceOf(DeterministicSourceCompositionError);
    expect(failure).toMatchObject({
      code: "apply-failed",
      recovery: {
        action: "reinspect-before-recovery",
        baseRevision: BASE_REVISION,
        expectedAfterHash: await hashSourceText(
          SOURCE.replace(
            "export const BUTTON_RADIUS_MD = 12;",
            "export const BUTTON_RADIUS_MD = 14;",
          ),
        ),
        expectedBeforeHash: await hashSourceText(SOURCE),
        managedProjectId: PROJECT_ID,
        observedProjectState: null,
        originalProtected: true,
        originalRootPath: ORIGINAL_ROOT,
        relativePath: RELATIVE_PATH,
        rootPath: ROOT,
        stage: "apply-error",
        worktree: worktreeRecovery,
      },
    });
    expect(failure.cause).toBe(manager.applyFailure);
  });

  it("fails closed when the apply receipt does not prove the compiled after hash", async () => {
    const manager = new CompositionManager();
    manager.nextState = await state(NEXT_REVISION);
    const originalApply = manager.compareAndApplyTextChanges.bind(manager);
    manager.compareAndApplyTextChanges = async (input) => {
      const result = await originalApply(input);
      return {
        ...result,
        changedFiles: [
          {
            afterHash: await hashSourceText("unexpected"),
            beforeHash: input.changes[0]!.expectedBeforeHash,
            relativePath: RELATIVE_PATH,
          },
        ],
      };
    };
    const coordinator = createDeterministicSourceEditCoordinator({
      projectAuthority: new CompositionProjectAuthority(
        await managedProject(),
      ),
      sourceWorktree: manager,
    });

    await expect(
      coordinator.apply({
        anchor: await anchor(),
        commitMessage: "memi: verify apply receipt",
        edit: EDIT,
        projectId: PROJECT_ID,
      }),
    ).rejects.toMatchObject({
      code: "apply-postcondition-failed",
      recovery: {
        action: "reinspect-before-recovery",
        observedProjectState: await state(NEXT_REVISION),
        relativePath: RELATIVE_PATH,
        stage: "apply-postcondition",
      },
    });
  });

  it.skipIf(!BUZZR_AVAILABLE)(
    "proves real Buzzr source compatibility without claiming managed-worktree E2E",
    async () => {
      const sourceText = readFileSync(
        join(BUZZR_ROOT, BUZZR_LAYOUT_PATH),
        "utf8",
      );
      const beforeState = await state(BUZZR_REVISION);
      const afterState = await state(NEXT_REVISION);
      const manager = new CompositionManager();
      manager.inspectedText = sourceText;
      manager.nextState = afterState;
      const realAnchor = await createSourceAnchorForTarget({
        componentIdentity: "buzzr.button",
        dirtyFingerprint: beforeState.dirtyFingerprint,
        expectedValue: { kind: "number", value: 12 },
        relativePath: BUZZR_LAYOUT_PATH,
        runtimeEvidenceRefs: ["buzzr-release:2.1"],
        sourceRevision: BUZZR_REVISION,
        sourceText,
        target: TARGET,
      });
      const coordinator = createDeterministicSourceEditCoordinator({
        projectAuthority: new CompositionProjectAuthority(
          await managedProject(beforeState),
        ),
        sourceWorktree: manager,
      });

      const receipt = await coordinator.apply({
        anchor: realAnchor,
        commitMessage: "memi: edit real Buzzr button radius",
        edit: EDIT,
        projectId: PROJECT_ID,
      });

      expect(manager.applyCalls[0]?.changes[0]?.afterText).toContain(
        "export const BUTTON_RADIUS_MD = 14;",
      );
      expect(receipt.usage.totalTokens).toBe(0);
      expect(receipt.source.before.revision).toBe(BUZZR_REVISION);
      expect(
        readFileSync(join(BUZZR_ROOT, BUZZR_LAYOUT_PATH), "utf8"),
      ).toBe(sourceText);
    },
  );
});
