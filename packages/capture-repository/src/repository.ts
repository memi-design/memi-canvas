import { resolve } from "node:path";

import {
  discoverCaptureApplications,
  type RepositoryManifestBudgets,
} from "@memi/capture-platforms";

import {
  assertAbsoluteNonRoot,
  assertCaptureId,
  assertContained,
  deepFreeze,
  RepositoryBoundaryError,
  rootsOverlap,
  stableHash,
  throwIfAborted,
} from "./guards.js";
import {
  captureGitSnapshot,
  createManagedRepositorySnapshot,
  sourceFromSnapshot,
} from "./git.js";
import { inventoryRepository, toRepositoryManifest } from "./inventory.js";
import type {
  ManagedCaptureApplication,
  PrepareRepositoryCaptureInput,
  RepositoryCapturePreparation,
} from "./types.js";

const DEFAULT_BUDGETS: RepositoryManifestBudgets = Object.freeze({
  maxDepth: 32,
  maxEntries: 4_096,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
});

function budgetsFor(
  overrides: PrepareRepositoryCaptureInput["budgets"],
): RepositoryManifestBudgets {
  const budgets = { ...DEFAULT_BUDGETS, ...overrides };
  for (const [name, value] of Object.entries(budgets)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RepositoryBoundaryError(
        "budget-exceeded",
        `Repository inventory ${name} must be a positive safe integer.`,
      );
    }
  }
  if (
    budgets.maxEntries > DEFAULT_BUDGETS.maxEntries ||
    budgets.maxFileBytes > DEFAULT_BUDGETS.maxFileBytes ||
    budgets.maxTotalBytes > DEFAULT_BUDGETS.maxTotalBytes ||
    budgets.maxDepth > DEFAULT_BUDGETS.maxDepth
  ) {
    throw new RepositoryBoundaryError(
      "budget-exceeded",
      "Repository inventory cannot exceed hard safety budgets.",
    );
  }
  return budgets;
}

function managedApplications(input: {
  readonly applications: ReturnType<
    typeof discoverCaptureApplications
  >["applications"];
  readonly managedRevision: string;
  readonly repositoryFingerprint: `sha256:${string}`;
  readonly snapshotExclusionFingerprint: `sha256:${string}`;
  readonly snapshotPolicyFingerprint: `sha256:${string}`;
  readonly targetRoot: string;
}): readonly ManagedCaptureApplication[] {
  return input.applications.map((application) => {
    const buildRecipe =
      application.buildRecipe === null
        ? null
        : {
            ...application.buildRecipe,
            cwd:
              application.buildRecipe.cwd === "."
                ? input.targetRoot
                : assertContained(
                    input.targetRoot,
                    resolve(input.targetRoot, application.buildRecipe.cwd),
                    application.buildRecipe.cwd,
                  ),
          };
    const recipePlan =
      buildRecipe === null
        ? null
        : {
            applicationId: application.applicationId,
            managedRevision: input.managedRevision,
            recipe: buildRecipe,
            recipeHash: stableHash({
              applicationId: application.applicationId,
              managedRevision: input.managedRevision,
              recipe: buildRecipe,
              repositoryFingerprint: input.repositoryFingerprint,
              snapshotExclusionFingerprint:
                input.snapshotExclusionFingerprint,
              snapshotPolicyFingerprint: input.snapshotPolicyFingerprint,
            }),
            repositoryFingerprint: input.repositoryFingerprint,
            snapshotExclusionFingerprint:
              input.snapshotExclusionFingerprint,
            snapshotPolicyFingerprint: input.snapshotPolicyFingerprint,
            schemaVersion: 2 as const,
          };
    return { ...application, buildRecipe, recipePlan };
  });
}

function sameSnapshot(
  left: Awaited<ReturnType<typeof captureGitSnapshot>>,
  right: Awaited<ReturnType<typeof captureGitSnapshot>>,
): boolean {
  return stableHash(left) === stableHash(right);
}

export async function prepareRepositoryCapture(
  input: PrepareRepositoryCaptureInput,
): Promise<RepositoryCapturePreparation> {
  throwIfAborted(input.signal);
  const requestedSource = assertAbsoluteNonRoot(
    input.sourceRoot,
    "invalid-source-root",
    "Source repository root",
  );
  const requestedManaged = assertAbsoluteNonRoot(
    input.managedRoot,
    "invalid-managed-root",
    "Managed repository root",
  );
  const captureId = assertCaptureId(input.captureId);
  const sourceRoot = assertAbsoluteNonRoot(
    await input.ports.fileSystem.realpath(requestedSource),
    "invalid-source-root",
    "Canonical source repository root",
  );
  const managedRoot = assertAbsoluteNonRoot(
    await input.ports.fileSystem.realpath(requestedManaged),
    "invalid-managed-root",
    "Canonical managed repository root",
  );
  if (rootsOverlap(sourceRoot, managedRoot)) {
    throw new RepositoryBoundaryError(
      "managed-root-overlap",
      "Managed capture storage must be disjoint from the source repository.",
    );
  }
  const targetRoot = assertContained(
    managedRoot,
    resolve(managedRoot, captureId),
    captureId,
  );
  if ((await input.ports.fileSystem.entryKind(targetRoot)) !== "missing") {
    throw new RepositoryBoundaryError(
      "managed-target-exists",
      "Managed capture target already exists.",
    );
  }

  const snapshot = await captureGitSnapshot({
    process: input.ports.process,
    rootPath: sourceRoot,
    signal: input.signal,
  });
  const sourceTree = await input.ports.fileSystem.fingerprintSourceTree({
    rootPath: sourceRoot,
    signal: input.signal,
  });
  const budgets = budgetsFor(input.budgets);
  const entries = await inventoryRepository({
    budgets,
    fileSystem: input.ports.fileSystem,
    rootPath: sourceRoot,
    signal: input.signal,
  });
  const stableSnapshot = await captureGitSnapshot({
    process: input.ports.process,
    rootPath: sourceRoot,
    signal: input.signal,
  });
  if (!sameSnapshot(snapshot, stableSnapshot)) {
    throw new RepositoryBoundaryError(
      "source-changed",
      "Source repository changed while its capture authority was being established.",
    );
  }
  const inventoryFingerprint = stableHash(
    entries.map(({ path, content }) => ({ path, content })),
  );
  const source = sourceFromSnapshot({
    inventoryFingerprint: stableHash({
      inventoryFingerprint,
      sourceTree: sourceTree.contentFingerprint,
    }),
    rootPath: sourceRoot,
    snapshot,
  });
  const inventory = toRepositoryManifest({
    budgets,
    dirtyFileFingerprint: source.dirtyFingerprint,
    entries,
    revision: source.headRevision,
  });
  const discovery = discoverCaptureApplications(
    inventory,
    input.discoveryOptions,
  );
  if (
    discovery.applications.length === 0 ||
    discovery.errors.length > 0 ||
    discovery.applications.some(
      (application) =>
        application.status !== "supported" ||
        application.buildRecipe === null,
    )
  ) {
    throw new RepositoryBoundaryError(
      "unsupported-application",
      "Repository contains an unsupported or incomplete capture application.",
    );
  }
  const applications = managedApplications({
    applications: discovery.applications,
    managedRevision: source.headRevision,
    repositoryFingerprint: discovery.repositoryFingerprint,
    snapshotExclusionFingerprint:
      sourceTree.exclusionManifest.fingerprint,
    snapshotPolicyFingerprint:
      sourceTree.exclusionManifest.policyFingerprint,
    targetRoot,
  });
  throwIfAborted(input.signal);
  try {
    const managedTree = await createManagedRepositorySnapshot({
      fileSystem: input.ports.fileSystem,
      signal: input.signal,
      sourceRoot,
      targetRoot,
    });
    const finalSnapshot = await captureGitSnapshot({
      process: input.ports.process,
      rootPath: sourceRoot,
      signal: input.signal,
    });
    const finalEntries = await inventoryRepository({
      budgets,
      fileSystem: input.ports.fileSystem,
      rootPath: sourceRoot,
      signal: input.signal,
    });
    const finalSourceTree =
      await input.ports.fileSystem.fingerprintSourceTree({
        rootPath: sourceRoot,
        signal: input.signal,
      });
    if (
      !sameSnapshot(stableSnapshot, finalSnapshot) ||
      stableHash(finalEntries) !== stableHash(entries) ||
      finalSourceTree.contentFingerprint !== sourceTree.contentFingerprint ||
      managedTree.contentFingerprint !== sourceTree.contentFingerprint ||
      stableHash(finalSourceTree.exclusionManifest) !==
        stableHash(sourceTree.exclusionManifest) ||
      stableHash(managedTree.exclusionManifest) !==
        stableHash(sourceTree.exclusionManifest)
    ) {
      throw new RepositoryBoundaryError(
        "source-changed",
        "Source repository changed before the managed capture snapshot completed.",
      );
    }
  } catch (error) {
    await input.ports.fileSystem.removeManagedTree({
      rootPath: targetRoot,
      signal: new AbortController().signal,
    });
    throw error;
  }
  return deepFreeze({
    applications,
    cacheFingerprint: stableHash({
      applications: applications.map((application) => application.cacheKey),
      dirtyFingerprint: source.dirtyFingerprint,
      repositoryFingerprint: discovery.repositoryFingerprint,
      snapshotExclusionFingerprint:
        sourceTree.exclusionManifest.fingerprint,
      snapshotPolicyFingerprint:
        sourceTree.exclusionManifest.policyFingerprint,
    }),
    inventory,
    managedCopy: {
      revision: source.headRevision,
      rootPath: targetRoot,
      sourceProtected: true,
      strategy: "filesystem-snapshot",
    },
    repositoryFingerprint: discovery.repositoryFingerprint,
    snapshotExclusions: sourceTree.exclusionManifest,
    source,
  });
}
