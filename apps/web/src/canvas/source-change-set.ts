import type {
  SourceChangeActor,
  SourceChangeApplication,
  SourceChangeApproval,
  SourceChangeRejection,
  SourceChangeReview,
  SourceChangeRollback,
  SourceChangeSet,
  SourceChangeSetInput,
  SourceChangeTraceEvent,
  SourceChangeTraceFamily,
  SourceChangeTraceOptions,
  SourceChangeVerification,
  SourceDecisionActor,
  SourceTextPatch,
  SourceWorkspaceFile,
  SourceWorkspacePort,
  SourceWorkspaceReceipt,
  SourceWorkspaceSnapshot,
  SourceWorkspaceTextChange,
} from "./source-change-set.types.js";

export type * from "./source-change-set.types.js";

const MAX_PATH_LENGTH = 1_024;
const MAX_PATCHES = 64;
const MAX_REPLACEMENTS_PER_PATCH = 256;
const MAX_REPLACEMENT_TEXT_BYTES = 256_000;
const MAX_TOTAL_PATCH_TEXT_BYTES = 1_000_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const BLOCKED_PATH_SEGMENTS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
]);
const issuedApprovals = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function freezeClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function assertText(value: string, label: string): void {
  if (value.includes("\u0000")) {
    throw new Error(`${label} must not contain binary data.`);
  }
  if (new TextEncoder().encode(value).byteLength > MAX_REPLACEMENT_TEXT_BYTES) {
    throw new Error(
      `${label} exceeds the ${MAX_REPLACEMENT_TEXT_BYTES}-byte limit.`,
    );
  }
}

function validateRelativeSourcePath(value: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    value.startsWith("/") ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error(
      "Source path must remain inside the connected project.",
    );
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        BLOCKED_PATH_SEGMENTS.has(segment) ||
        segment === ".env" ||
        segment.startsWith(".env."),
    )
  ) {
    throw new Error(
      "Source path must remain inside the connected project.",
    );
  }
  return value;
}

function validateInput(input: SourceChangeSetInput): void {
  nonEmpty(input.id, "Source ChangeSet id");
  nonEmpty(input.projectId, "Source ChangeSet project id");
  nonEmpty(input.runId, "Source ChangeSet run id");
  nonEmpty(input.rootId, "Source ChangeSet root id");
  nonEmpty(input.baseRevision, "Source ChangeSet base revision");
  nonEmpty(input.actor.harnessId, "Source ChangeSet harness");
  nonEmpty(input.actor.modelId, "Source ChangeSet model");
  if (input.patches.length === 0 || input.patches.length > MAX_PATCHES) {
    throw new Error(
      `Source ChangeSet must contain between 1 and ${MAX_PATCHES} patches.`,
    );
  }
  const paths = input.patches.map(({ relativePath }) =>
    validateRelativeSourcePath(relativePath),
  );
  if (new Set(paths).size !== paths.length) {
    throw new Error("Source ChangeSet paths must not contain duplicates.");
  }
  let totalPatchTextBytes = 0;
  input.patches.forEach((patch, patchIndex) => {
    nonEmpty(patch.summary, `Source patch ${patchIndex + 1} summary`);
    if (!SHA256_PATTERN.test(patch.expectedBeforeHash)) {
      throw new Error(
        `Source patch ${patchIndex + 1} requires a SHA-256 fingerprint.`,
      );
    }
    if (
      patch.replacements.length === 0 ||
      patch.replacements.length > MAX_REPLACEMENTS_PER_PATCH
    ) {
      throw new Error(
        `Source patch ${patchIndex + 1} must contain between 1 and ${MAX_REPLACEMENTS_PER_PATCH} replacements.`,
      );
    }
    patch.replacements.forEach((replacement, replacementIndex) => {
      if (replacement.before.length === 0) {
        throw new Error(
          `Source patch ${patchIndex + 1} replacement ${replacementIndex + 1} requires a non-empty exact anchor.`,
        );
      }
      assertText(
        replacement.before,
        `Source patch ${patchIndex + 1} replacement ${replacementIndex + 1} anchor`,
      );
      assertText(
        replacement.after,
        `Source patch ${patchIndex + 1} replacement ${replacementIndex + 1} text`,
      );
      totalPatchTextBytes += new TextEncoder().encode(
        replacement.before,
      ).byteLength;
      totalPatchTextBytes += new TextEncoder().encode(
        replacement.after,
      ).byteLength;
    });
  });
  if (totalPatchTextBytes > MAX_TOTAL_PATCH_TEXT_BYTES) {
    throw new Error(
      `Source ChangeSet aggregate text exceeds the ${MAX_TOTAL_PATCH_TEXT_BYTES}-byte limit.`,
    );
  }
}

export async function sha256SourceText(
  value: string,
): Promise<`sha256:${string}`> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("Secure SHA-256 support is unavailable.");
  }
  const bytes = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  const digest = [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${digest}`;
}

export async function createSourceChangeSet(
  input: SourceChangeSetInput,
): Promise<SourceChangeSet> {
  validateInput(input);
  const cloned = structuredClone(input);
  const digest = await sha256SourceText(
    JSON.stringify(stableValue(cloned)),
  );
  return deepFreeze({ ...cloned, digest });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function defaultTraceOptions(
  options: SourceChangeTraceOptions,
): Required<SourceChangeTraceOptions> {
  return {
    idFactory: options.idFactory ?? (() => globalThis.crypto.randomUUID()),
    now: options.now ?? (() => new Date().toISOString()),
  };
}

function traceEvent(
  current: readonly SourceChangeTraceEvent[],
  changeSet: SourceChangeSet,
  actor: SourceChangeActor | SourceDecisionActor,
  family: SourceChangeTraceFamily,
  message: string,
  options: SourceChangeTraceOptions,
): readonly SourceChangeTraceEvent[] {
  const trace = defaultTraceOptions(options);
  return freezeClone([
    ...current,
    {
      actor,
      at: trace.now(),
      changeSetId: changeSet.id,
      family,
      id: trace.idFactory(),
      message,
      runId: changeSet.runId,
      sequence: current.length + 1,
    },
  ]);
}

function occurrenceCount(value: string, anchor: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= value.length - anchor.length) {
    const match = value.indexOf(anchor, offset);
    if (match === -1) {
      break;
    }
    count += 1;
    offset = match + 1;
  }
  return count;
}

function applyReplacements(
  text: string,
  patch: SourceTextPatch,
): string {
  return patch.replacements.reduce((current, replacement, index) => {
    const count = occurrenceCount(current, replacement.before);
    if (count !== 1) {
      throw new Error(
        `${patch.relativePath} replacement ${index + 1} exact anchor matched ${count} times; exactly one match is required.`,
      );
    }
    return current.replace(replacement.before, replacement.after);
  }, text);
}

function replacementDiff(
  patch: SourceTextPatch,
): readonly string[] {
  return patch.replacements.flatMap((replacement, index) => [
    `@@ exact replacement ${index + 1} @@`,
    ...replacement.before.split("\n").map((line) => `-${line}`),
    ...replacement.after.split("\n").map((line) => `+${line}`),
  ]);
}

function buildDiff(changeSet: SourceChangeSet): string {
  return changeSet.patches
    .flatMap((patch) => [
      `--- a/${patch.relativePath}`,
      `+++ b/${patch.relativePath}`,
      ...replacementDiff(patch),
    ])
    .join("\n");
}

function conflictReview(
  changeSet: SourceChangeSet,
  currentRevision: string,
  message: string,
  options: SourceChangeTraceOptions,
): SourceChangeReview {
  return freezeClone({
    changeSet,
    currentRevision,
    diff: buildDiff(changeSet),
    files: [],
    message,
    status: "conflict" as const,
    trace: traceEvent(
      [],
      changeSet,
      changeSet.actor,
      "source.previewed",
      message,
      options,
    ),
  });
}

function filesByPath(
  snapshot: SourceWorkspaceSnapshot,
): ReadonlyMap<string, SourceWorkspaceFile> {
  const files = new Map(
    snapshot.files.map((file) => [file.relativePath, file]),
  );
  if (files.size !== snapshot.files.length) {
    throw new Error("Workspace inspection returned duplicate source paths.");
  }
  return files;
}

export async function previewSourceChangeSet(
  changeSet: SourceChangeSet,
  workspace: SourceWorkspacePort,
  options: SourceChangeTraceOptions = {},
): Promise<SourceChangeReview> {
  const paths = changeSet.patches.map(({ relativePath }) => relativePath);
  let snapshot: SourceWorkspaceSnapshot;
  try {
    snapshot = await workspace.inspect(paths);
  } catch (error) {
    return conflictReview(
      changeSet,
      changeSet.baseRevision,
      `Source preview failed: ${error instanceof Error ? error.message : String(error)}`,
      options,
    );
  }
  if (snapshot.rootId !== changeSet.rootId) {
    return conflictReview(
      changeSet,
      snapshot.revision,
      "Connected project root changed before preview.",
      options,
    );
  }
  if (snapshot.revision !== changeSet.baseRevision) {
    return conflictReview(
      changeSet,
      snapshot.revision,
      `Workspace revision ${snapshot.revision} does not match ChangeSet revision ${changeSet.baseRevision}.`,
      options,
    );
  }

  try {
    const inspected = filesByPath(snapshot);
    const files: SourceWorkspaceTextChange[] = [];
    for (const patch of changeSet.patches) {
      const source = inspected.get(patch.relativePath);
      if (source === undefined) {
        throw new Error(
          `Workspace inspection omitted ${patch.relativePath}.`,
        );
      }
      const currentHash = await sha256SourceText(source.text);
      if (currentHash !== patch.expectedBeforeHash) {
        throw new Error(
          `${patch.relativePath} no longer matches its expected source fingerprint.`,
        );
      }
      files.push({
        afterText: applyReplacements(source.text, patch),
        beforeText: source.text,
        relativePath: patch.relativePath,
      });
    }
    const message = `${files.length} source file${files.length === 1 ? "" : "s"} ready for human approval.`;
    return freezeClone({
      changeSet,
      currentRevision: snapshot.revision,
      diff: buildDiff(changeSet),
      files,
      message,
      status: "ready" as const,
      trace: traceEvent(
        [],
        changeSet,
        changeSet.actor,
        "source.previewed",
        message,
        options,
      ),
    });
  } catch (error) {
    return conflictReview(
      changeSet,
      snapshot.revision,
      `Source conflict: ${error instanceof Error ? error.message : String(error)}`,
      options,
    );
  }
}

export function approveSourceChangeSet(
  review: SourceChangeReview,
  actor: SourceDecisionActor,
  options: SourceChangeTraceOptions = {},
): SourceChangeApproval {
  if (review.status !== "ready") {
    throw new Error("Only a ready source preview can be approved.");
  }
  nonEmpty(actor.id, "Source approval actor id");
  const trace = defaultTraceOptions(options);
  const approval: SourceChangeApproval = deepFreeze({
    approvedAt: trace.now(),
    approvedBy: structuredClone(actor),
    baseRevision: review.currentRevision,
    changeSetDigest: review.changeSet.digest,
    id: trace.idFactory(),
    rootId: review.changeSet.rootId,
    trace: traceEvent(
      review.trace,
      review.changeSet,
      actor,
      "source.approved",
      `Approved ${review.files.length} source file${review.files.length === 1 ? "" : "s"} at revision ${review.currentRevision}.`,
      options,
    ),
    usesRemaining: 1,
  });
  issuedApprovals.add(approval);
  return approval;
}

export function rejectSourceChangeSet(
  review: SourceChangeReview,
  actor: SourceDecisionActor,
  reason: string,
  options: SourceChangeTraceOptions = {},
): SourceChangeRejection {
  nonEmpty(actor.id, "Source rejection actor id");
  const decision = nonEmpty(reason, "Source rejection reason");
  const message = `Rejected without changing source: ${decision}`;
  return freezeClone({
    message,
    review,
    status: "rejected" as const,
    trace: traceEvent(
      review.trace,
      review.changeSet,
      actor,
      "source.rejected",
      message,
      options,
    ),
  });
}

function approvalMatches(
  review: SourceChangeReview,
  approval: SourceChangeApproval,
): boolean {
  return (
    issuedApprovals.has(approval) &&
    approval.baseRevision === review.currentRevision &&
    approval.changeSetDigest === review.changeSet.digest &&
    approval.rootId === review.changeSet.rootId
  );
}

async function snapshotMatchesFiles(
  snapshot: SourceWorkspaceSnapshot,
  files: readonly SourceWorkspaceTextChange[],
  side: "afterText" | "beforeText",
): Promise<boolean> {
  const inspected = filesByPath(snapshot);
  if (inspected.size !== files.length) {
    return false;
  }
  return files.every(
    (file) =>
      inspected.get(file.relativePath)?.text === file[side],
  );
}

function failedApplication(
  review: SourceChangeReview,
  approval: SourceChangeApproval,
  message: string,
  options: SourceChangeTraceOptions,
  receipt: SourceWorkspaceReceipt | null = null,
): SourceChangeApplication {
  return freezeClone({
    approval,
    files: review.files,
    message,
    receipt,
    review,
    status: "failed" as const,
    trace: traceEvent(
      approval.trace,
      review.changeSet,
      review.changeSet.actor,
      "source.failed",
      message,
      options,
    ),
    verification: null,
  });
}

export async function applyApprovedSourceChangeSet(
  review: SourceChangeReview,
  approval: SourceChangeApproval,
  workspace: SourceWorkspacePort,
  options: SourceChangeTraceOptions = {},
): Promise<SourceChangeApplication> {
  if (review.status !== "ready") {
    return failedApplication(
      review,
      approval,
      "Source apply failed: the preview is not ready.",
      options,
    );
  }
  if (!approvalMatches(review, approval)) {
    return failedApplication(
      review,
      approval,
      "Source apply failed: approval does not match the exact preview digest, revision, and root.",
      options,
    );
  }
  issuedApprovals.delete(approval);

  let acceptedReceipt: SourceWorkspaceReceipt | null = null;
  try {
    const before = await workspace.inspect(
      review.files.map(({ relativePath }) => relativePath),
    );
    if (
      before.rootId !== review.changeSet.rootId ||
      before.revision !== review.currentRevision
    ) {
      throw new Error("Workspace revision or connected project root changed.");
    }
    if (!(await snapshotMatchesFiles(before, review.files, "beforeText"))) {
      throw new Error("Source text changed after preview.");
    }

    const receipt = await workspace.replaceTextFilesAtomically({
      changes: review.files,
      expectedRevision: review.currentRevision,
      rootId: review.changeSet.rootId,
    });
    acceptedReceipt = receipt;
    if (
      receipt.rootId !== review.changeSet.rootId ||
      receipt.changedPaths.length !== review.files.length ||
      new Set(receipt.changedPaths).size !== review.files.length ||
      !review.files.every(({ relativePath }) =>
        receipt.changedPaths.includes(relativePath),
      )
    ) {
      throw new Error("Atomic source receipt did not match the approved files.");
    }
    const appliedTrace = traceEvent(
      approval.trace,
      review.changeSet,
      review.changeSet.actor,
      "source.applied",
      `Applied ${receipt.changedPaths.length} approved source file${receipt.changedPaths.length === 1 ? "" : "s"}.`,
      options,
    );
    const after = await workspace.inspect(receipt.changedPaths);
    const verified =
      after.rootId === review.changeSet.rootId &&
      after.revision === receipt.revision &&
      (await snapshotMatchesFiles(after, review.files, "afterText"));
    if (!verified) {
      return freezeClone({
        approval,
        files: review.files,
        message:
          "Source apply completed, but exact post-write verification failed. Rollback remains available.",
        receipt,
        review,
        status: "failed" as const,
        trace: traceEvent(
          appliedTrace,
          review.changeSet,
          review.changeSet.actor,
          "source.failed",
          "Exact source verification failed after apply.",
          options,
        ),
        verification: {
          checkedRevision: after.revision,
          changedPaths: receipt.changedPaths,
          status: "failed" as const,
          summary: "Resulting source did not match the approved preview.",
        },
      });
    }
    const verification: SourceChangeVerification = {
      checkedRevision: receipt.revision,
      changedPaths: receipt.changedPaths,
      status: "passed",
      summary: "Exact resulting source matched the approved preview.",
    };
    return freezeClone({
      approval,
      files: review.files,
      message: verification.summary,
      receipt,
      review,
      status: "applied" as const,
      trace: traceEvent(
        appliedTrace,
        review.changeSet,
        review.changeSet.actor,
        "source.verified",
        verification.summary,
        options,
      ),
      verification,
    });
  } catch (error) {
    const failure =
      error instanceof Error ? error.message : String(error);
    return failedApplication(
      review,
      approval,
      acceptedReceipt === null
        ? `Source apply failed without an accepted write: ${failure}`
        : `Source was written, but post-write verification did not complete: ${failure} Rollback remains available.`,
      options,
      acceptedReceipt,
    );
  }
}

function failedRollback(
  application: SourceChangeApplication,
  message: string,
  actor: SourceDecisionActor,
  options: SourceChangeTraceOptions,
): SourceChangeRollback {
  return freezeClone({
    application,
    message,
    receipt: null,
    status: "failed" as const,
    trace: traceEvent(
      application.trace,
      application.review.changeSet,
      actor,
      "source.failed",
      message,
      options,
    ),
    verification: null,
  });
}

export async function rollbackSourceChangeSet(
  application: SourceChangeApplication,
  workspace: SourceWorkspacePort,
  actor: SourceDecisionActor,
  options: SourceChangeTraceOptions = {},
): Promise<SourceChangeRollback> {
  nonEmpty(actor.id, "Source rollback actor id");
  if (application.receipt === null) {
    return failedRollback(
      application,
      "Source rollback failed: no applied source receipt is available.",
      actor,
      options,
    );
  }
  const appliedReceipt = application.receipt;
  const paths = application.files.map(({ relativePath }) => relativePath);
  try {
    const current = await workspace.inspect(paths);
    if (
      current.rootId !== appliedReceipt.rootId ||
      current.revision !== appliedReceipt.revision
    ) {
      throw new Error(
        "Workspace revision or connected project root changed after apply.",
      );
    }
    if (
      !(await snapshotMatchesFiles(
        current,
        application.files,
        "afterText",
      ))
    ) {
      throw new Error("Applied source changed before rollback.");
    }
    const rollbackChanges = application.files.map((file) => ({
      afterText: file.beforeText,
      beforeText: file.afterText,
      relativePath: file.relativePath,
    }));
    const receipt = await workspace.replaceTextFilesAtomically({
      changes: rollbackChanges,
      expectedRevision: appliedReceipt.revision,
      rootId: appliedReceipt.rootId,
    });
    const rollbackTrace = traceEvent(
      application.trace,
      application.review.changeSet,
      actor,
      "source.rolled-back",
      `Rolled back ${receipt.changedPaths.length} source file${receipt.changedPaths.length === 1 ? "" : "s"}.`,
      options,
    );
    const restored = await workspace.inspect(paths);
    const verified =
      restored.rootId === appliedReceipt.rootId &&
      restored.revision === receipt.revision &&
      (await snapshotMatchesFiles(
        restored,
        application.files,
        "beforeText",
      ));
    const verification: SourceChangeVerification = {
      checkedRevision: restored.revision,
      changedPaths: receipt.changedPaths,
      status: verified ? "passed" : "failed",
      summary: verified
        ? "Exact pre-change source was restored."
        : "Rollback write completed, but restored source verification failed.",
    };
    return freezeClone({
      application,
      message: verification.summary,
      receipt,
      status: verified ? ("rolled-back" as const) : ("failed" as const),
      trace: traceEvent(
        rollbackTrace,
        application.review.changeSet,
        actor,
        verified ? "source.verified" : "source.failed",
        verification.summary,
        options,
      ),
      verification,
    });
  } catch (error) {
    return failedRollback(
      application,
      `Source rollback failed without an accepted write: ${error instanceof Error ? error.message : String(error)}`,
      actor,
      options,
    );
  }
}
