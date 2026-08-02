import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import type {
  CanvasMaterializationPlan,
  ProductWorkspace,
} from "@memi/product-import";
import {
  ContentHashSchema,
  type DurableCommand,
} from "@memi/protocol";
import type { DurableRuntime } from "@memi/runtime";

import { validateImportRuntimeEvidence } from "./evidence.js";
import { validateIssuedImportAuthorityBatch } from "./prepare.js";
import type {
  ExecutionAuthorityCounts,
  ImportBatchExecutionResult,
  IssuedImportAuthorityBatch,
  IssuedImportAuthorityEntry,
} from "./types.js";

interface ExecutionAuthoritySnapshot {
  readonly schemaVersion: 1;
  readonly kind: "execution-authority-snapshot";
  readonly scope: {
    readonly projectId: string;
    readonly runId: string;
    readonly batchRootDigest: string;
  };
  readonly signedReviewedContext: {
    readonly workspaceDigest: string;
    readonly planDigest: string;
    readonly batchRootDigest: string;
  };
  readonly counts: ExecutionAuthorityCounts;
  readonly rows: {
    readonly commands: readonly (DurableCommand & {
      readonly state: string;
    })[];
    readonly outboxes: readonly {
      readonly commandId: string;
      readonly phase: string;
    }[];
    readonly grants: readonly { readonly id: string }[];
    readonly approvals: readonly { readonly id: string }[];
    readonly traceEvents: readonly { readonly operationId: string }[];
    readonly projectionIntents: readonly {
      readonly operationId: string;
    }[];
  };
  readonly observedRuntimeWork: {
    readonly allObservedCommandsBelongToBatch: boolean;
    readonly commandKinds: readonly string[];
    readonly targetKinds: readonly string[];
    readonly observedCommandIds: readonly string[];
    readonly outsideBatchCommandIds: readonly string[];
    readonly observedBatchRootDigests: readonly string[];
  };
}

function requireExactReplay(
  runtime: DurableRuntime,
  entry: IssuedImportAuthorityEntry,
): boolean {
  const existing = runtime.getCommand(entry.command.id);
  if (existing === undefined) {
    return false;
  }
  const outbox = runtime.getOutboxForCommand(entry.command.id);
  if (
    canonicalJson(existing) !== canonicalJson(entry.command) ||
    outbox?.phase !== "committed" ||
    outbox.id !== entry.outboxId ||
    runtime.getEffectReceipt(entry.command.id) === undefined ||
    runtime.getTargetReceipt(entry.command.id) === undefined
  ) {
    throw new Error("Existing import command is not an exact terminal replay.");
  }
  return true;
}

async function executeEntry(
  runtime: DurableRuntime,
  batch: IssuedImportAuthorityBatch,
  entry: IssuedImportAuthorityEntry,
): Promise<void> {
  if (requireExactReplay(runtime, entry)) {
    return;
  }
  const accepted = runtime.submitCommand({
    command: entry.command,
    outboxId: entry.outboxId,
    effectPayload: entry.operation,
  });
  if (accepted.commandId !== entry.command.id || accepted.state !== "intent") {
    throw new Error("Import command was not accepted as a new intent.");
  }
  const workerClaim = await runtime.claimCommandEffect({
    commandId: entry.command.id,
    workerId: `import-apply:${batch.runId}`,
    claimTtlMilliseconds: 30_000,
  });
  if (
    workerClaim.commandId !== entry.command.id ||
    workerClaim.outboxId !== entry.outboxId
  ) {
    throw new Error("Import runtime did not claim the exact operation.");
  }
  const applied = await runtime.applyClaimedEffect(workerClaim);
  if (applied.phase !== "effect-applied") {
    throw new Error("Import target operation did not reach effect-applied.");
  }
  const commitClaim = runtime.claimEffectCommit({
    commandId: entry.command.id,
    workerId: `import-commit:${batch.runId}`,
    claimTtlMilliseconds: 30_000,
  });
  const receipt = await runtime.verifyAndCommit({ claim: commitClaim });
  const terminal = runtime.getOutboxForCommand(entry.command.id);
  if (
    receipt.commandId !== entry.command.id ||
    terminal?.phase !== "committed" ||
    runtime.getTargetReceipt(entry.command.id) === undefined
  ) {
    throw new Error("Import command did not reach canonical committed authority.");
  }
}

function parseSnapshot(
  input: unknown,
  batch: IssuedImportAuthorityBatch,
): ExecutionAuthoritySnapshot {
  const snapshot = input as ExecutionAuthoritySnapshot;
  const commandIds = batch.entries.map((entry) => entry.command.id);
  const operationIds = batch.entries.map((entry) => entry.operation.id);
  const grantIds = batch.entries.map((entry) => entry.grant.id);
  const approvalIds = batch.entries.map((entry) => entry.approval.id);
  const exact = (left: unknown, right: unknown) =>
    canonicalJson(left) === canonicalJson(right);
  if (
    snapshot?.schemaVersion !== 1 ||
    snapshot.kind !== "execution-authority-snapshot" ||
    snapshot.scope.projectId !== batch.projectId ||
    snapshot.scope.runId !== batch.runId ||
    snapshot.scope.batchRootDigest !== batch.batchRootDigest ||
    snapshot.signedReviewedContext.workspaceDigest !==
      batch.workspaceDigest ||
    snapshot.signedReviewedContext.planDigest !== batch.planDigest ||
    snapshot.signedReviewedContext.batchRootDigest !==
      batch.batchRootDigest ||
    !snapshot.observedRuntimeWork.allObservedCommandsBelongToBatch ||
    !exact(
      snapshot.observedRuntimeWork.commandKinds,
      ["canvas.operation"],
    ) ||
    !exact(
      snapshot.observedRuntimeWork.targetKinds,
      ["canvas-document"],
    ) ||
    !exact(
      snapshot.observedRuntimeWork.observedCommandIds,
      commandIds,
    ) ||
    snapshot.observedRuntimeWork.outsideBatchCommandIds.length !== 0 ||
    !exact(
      snapshot.observedRuntimeWork.observedBatchRootDigests,
      [batch.batchRootDigest],
    ) ||
    !exact(
      snapshot.rows.commands.map((command) => command.id),
      commandIds,
    ) ||
    snapshot.rows.commands.some(
      (command) => command.state !== "committed",
    ) ||
    !exact(
      snapshot.rows.outboxes.map((outbox) => outbox.commandId),
      commandIds,
    ) ||
    snapshot.rows.outboxes.some(
      (outbox) => outbox.phase !== "committed",
    ) ||
    !exact(snapshot.rows.grants.map((grant) => grant.id), grantIds) ||
    !exact(
      snapshot.rows.approvals.map((approval) => approval.id),
      approvalIds,
    ) ||
    !exact(
      snapshot.rows.traceEvents.map((event) => event.operationId),
      operationIds,
    ) ||
    !exact(
      snapshot.rows.projectionIntents.map((event) => event.operationId),
      operationIds,
    )
  ) {
    throw new Error(
      "Execution authority snapshot does not prove the exact import batch.",
    );
  }
  return snapshot;
}

export async function executeApprovedImportBatch(
  runtime: DurableRuntime,
  workspace: ProductWorkspace,
  plan: CanvasMaterializationPlan,
  input: IssuedImportAuthorityBatch,
): Promise<ImportBatchExecutionResult> {
  const batch = await validateIssuedImportAuthorityBatch(
    runtime,
    input,
    workspace,
    plan,
  );
  runtime.assertLease({
    projectId: batch.lease.projectId,
    targetId: batch.lease.targetId,
    leaseId: batch.lease.id,
    fencingEpoch: batch.lease.fencingEpoch,
  });
  const commandIds: DurableCommand["id"][] = [];
  for (const entry of batch.entries) {
    await executeEntry(runtime, batch, entry);
    commandIds.push(entry.command.id);
  }
  const replay = runtime.replayCanvasTrace(batch.projectId);
  const scopedEvents = replay.events.filter((event) =>
    commandIds.includes(event.commandId),
  );
  if (
    scopedEvents.length !== batch.entries.length ||
    batch.entries.some(
      (entry, index) =>
        scopedEvents[index]?.operationId !== entry.operation.id,
    )
  ) {
    throw new Error("Canonical trace does not exactly replay the import batch.");
  }
  const snapshot = parseSnapshot(
    runtime.getExecutionAuthoritySnapshot({
      schemaVersion: 1,
      projectId: batch.projectId,
      runId: batch.runId,
      batchRootDigest: batch.batchRootDigest,
    }),
    batch,
  );
  const counts = snapshot.counts;
  const evidence = validateImportRuntimeEvidence({
    schemaVersion: 1,
    kind: "import-runtime-e2e",
    batchDigest: batch.batchDigest,
    workspaceDigest: batch.workspaceDigest,
    planDigest: batch.planDigest,
    initialStateHash: plan.initialDocument.stateHash,
    finalStateHash: plan.finalDocument.stateHash,
    lastEventHash: ContentHashSchema.parse(
      scopedEvents.at(-1)?.eventHash,
    ),
    counts: {
      operations: counts.commands,
      targetReceipts: counts.targetReceipts,
      committedReceipts: counts.canonicalReceipts,
      traceEvents: counts.traceEvents,
      projectionIntents: counts.projectionIntents,
    },
    authoritySummary: {
      snapshotDigest: ContentHashSchema.parse(
        hashCanonicalValue(snapshot),
      ),
      lineage: {
        workspaceDigest: ContentHashSchema.parse(
          snapshot.signedReviewedContext.workspaceDigest,
        ),
        planDigest: ContentHashSchema.parse(
          snapshot.signedReviewedContext.planDigest,
        ),
        batchRootDigest: ContentHashSchema.parse(
          snapshot.signedReviewedContext.batchRootDigest,
        ),
      },
      counts,
      observedCommandKinds:
        snapshot.observedRuntimeWork.commandKinds,
      observedTargetKinds:
        snapshot.observedRuntimeWork.targetKinds,
      unexpectedCommandIds:
        snapshot.observedRuntimeWork.outsideBatchCommandIds,
    },
  });
  return {
    batchDigest: batch.batchDigest,
    committedCount: counts.canonicalReceipts,
    totalCount: batch.entries.length,
    commandIds,
    evidence,
  };
}
