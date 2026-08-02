import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import {
  compileCanvasOperations,
  validateCanvasMaterializationPlan,
  type CanvasMaterializationPlan,
  type ProductWorkspace,
} from "@memi/product-import";
import {
  ApprovalReceiptIdSchema,
  CanvasOperationSchema,
  CapabilityGrantIdSchema,
  ContentHashSchema,
  DurableCommandIdSchema,
  DurableCommandSchema,
  IdempotencyKeySchema,
  LeaseSchema,
  OutboxIdSchema,
  RunIdSchema,
  RuntimeIssuedCommandAuthoritySchema,
  TaskIdSchema,
  TrustedCommandAuthorityIssuanceSchema,
  TrustedCommandAuthorityReservationRequestSchema,
  TrustedCommandAuthorityReservationSchema,
  computeTrustedAuthorityBatchRoot,
  type CanvasOperation,
  type DurableCommand,
  type Lease,
  type TrustedCommandAuthorityReservation,
} from "@memi/protocol";
import {
  bindCommandAction,
  type DurableRuntime,
} from "@memi/runtime";

import { validateHumanImportBatchDecision } from "./decision.js";
import { assertExactKeys, deepFreeze, deriveId } from "./shared.js";
import type {
  HumanImportBatchDecision,
  ImportAuthoritySigner,
  IssuedImportAuthorityBatch,
  IssuedImportAuthorityEntry,
  ReservedImportAuthorityBatch,
  ReservedImportAuthorityEntry,
} from "./types.js";

const ISSUER_ID = "import-runtime";
const CAPABILITIES = ["canvas:apply"] as const;

interface DraftEntry {
  readonly ordinal: number;
  readonly operation: CanvasOperation;
  readonly commandDraft: DurableCommand;
  readonly outboxId: ReturnType<typeof OutboxIdSchema.parse>;
  readonly reservationRequest: ReturnType<
    typeof TrustedCommandAuthorityReservationRequestSchema.parse
  >;
}

interface BatchBasis {
  readonly plan: CanvasMaterializationPlan;
  readonly lease: Lease;
  readonly decision: HumanImportBatchDecision;
  readonly batchRootDigest: ReturnType<typeof ContentHashSchema.parse>;
  readonly taskId: ReturnType<typeof TaskIdSchema.parse>;
  readonly runId: ReturnType<typeof RunIdSchema.parse>;
  readonly entries: readonly DraftEntry[];
}

function batchDigestBody<Value extends { readonly batchDigest: string }>(
  batch: Value,
): Omit<Value, "batchDigest"> {
  const { batchDigest: _digest, ...body } = batch;
  return body;
}

function commandIdentity(
  basis: Omit<BatchBasis, "entries">,
  operation: CanvasOperation,
  ordinal: number,
): object {
  return {
    workspaceDigest: basis.plan.workspaceDigest,
    planDigest: basis.plan.planDigest,
    batchRootDigest: basis.batchRootDigest,
    leaseId: basis.lease.id,
    fencingEpoch: basis.lease.fencingEpoch,
    runId: basis.runId,
    operationId: operation.id,
    operationActionDigest: operation.actionDigest,
    ordinal,
  };
}

function buildCommandDraft(
  basis: Omit<BatchBasis, "entries">,
  operation: CanvasOperation,
  ordinal: number,
): {
  readonly command: DurableCommand;
  readonly outboxId: ReturnType<typeof OutboxIdSchema.parse>;
} {
  const identity = commandIdentity(basis, operation, ordinal);
  const placeholderGrantId = CapabilityGrantIdSchema.parse(
    deriveId("grt", "untrusted-placeholder-grant", identity),
  );
  const placeholderApprovalId = ApprovalReceiptIdSchema.parse(
    deriveId("apr", "untrusted-placeholder-approval", identity),
  );
  const command = bindCommandAction(
    DurableCommandSchema.parse({
      schemaVersion: 1,
      id: DurableCommandIdSchema.parse(
        deriveId("cmd", "trusted-import-command", identity),
      ),
      projectId: basis.plan.projectId,
      taskId: basis.taskId,
      runId: basis.runId,
      issuerId: ISSUER_ID,
      kind: "canvas.operation",
      target: {
        kind: "canvas-document",
        id: basis.plan.documentId,
        expectedBeforeHash: operation.expectedBeforeHash,
        baseline: {
          kind: "canvas-revision",
          revision: ordinal,
          stateHash: operation.expectedBeforeHash,
        },
      },
      payloadHash: `sha256:${"0".repeat(64)}`,
      idempotencyKey: IdempotencyKeySchema.parse(
        deriveId("idem", "trusted-import-idempotency", identity),
      ),
      actionDigest: `sha256:${"0".repeat(64)}`,
      requiredCapabilities: CAPABILITIES,
      authority: {
        capabilityGrantId: placeholderGrantId,
        approvalReceiptId: placeholderApprovalId,
        leaseId: basis.lease.id,
        fencingEpoch: basis.lease.fencingEpoch,
      },
      issuedAt: basis.decision.issuedAt,
    }),
    operation,
  );
  return {
    command,
    outboxId: OutboxIdSchema.parse(
      deriveId("obx", "trusted-import-outbox", identity),
    ),
  };
}

function finalizeCommand(
  draft: DurableCommand,
  operation: CanvasOperation,
  reservation: TrustedCommandAuthorityReservation,
): DurableCommand {
  return bindCommandAction(
    {
      ...draft,
      authority: {
        ...draft.authority,
        capabilityGrantId: reservation.grantId,
        approvalReceiptId: reservation.approvalId,
      },
    },
    operation,
  );
}

function buildBasis(
  workspace: ProductWorkspace,
  plan: CanvasMaterializationPlan,
  activeLease: Lease,
  humanDecision: HumanImportBatchDecision,
): BatchBasis {
  const validatedPlan = validateCanvasMaterializationPlan(plan, workspace);
  const lease = LeaseSchema.parse(activeLease);
  const decision = validateHumanImportBatchDecision(
    humanDecision,
    validatedPlan,
  );
  if (
    lease.projectId !== validatedPlan.projectId ||
    lease.targetId !== validatedPlan.documentId ||
    lease.holderId !== ISSUER_ID ||
    Date.parse(decision.issuedAt) < Date.parse(lease.acquiredAt) ||
    Date.parse(decision.expiresAt) > Date.parse(lease.expiresAt)
  ) {
    throw new Error("Active lease does not authorize the import batch.");
  }
  const operations = compileCanvasOperations(validatedPlan, workspace);
  const batchRootDigest = ContentHashSchema.parse(
    computeTrustedAuthorityBatchRoot({
      schemaVersion: 1,
      kind: "memi-import-authority-batch-root",
      projectId: validatedPlan.projectId,
      documentId: validatedPlan.documentId,
      workspaceDigest: workspace.workspaceDigest,
      planDigest: validatedPlan.planDigest,
      operations: operations.map((operation, ordinal) => ({
        ordinal,
        operationId: operation.id,
        actionDigest: operation.actionDigest,
      })),
    }),
  );
  const identity = {
    workspaceDigest: workspace.workspaceDigest,
    planDigest: validatedPlan.planDigest,
    batchRootDigest,
    leaseId: lease.id,
    fencingEpoch: lease.fencingEpoch,
    decision,
  };
  const taskId = TaskIdSchema.parse(
    deriveId("tsk", "trusted-import-task", identity),
  );
  const runId = RunIdSchema.parse(
    deriveId("run", "trusted-import-run", { ...identity, taskId }),
  );
  const partial = {
    plan: validatedPlan,
    lease,
    decision,
    batchRootDigest,
    taskId,
    runId,
  };
  const entries = operations.map((untrustedOperation, ordinal) => {
    const operation = CanvasOperationSchema.parse(untrustedOperation);
    const { command, outboxId } = buildCommandDraft(
      partial,
      operation,
      ordinal,
    );
    return {
      ordinal,
      operation,
      commandDraft: command,
      outboxId,
      reservationRequest:
        TrustedCommandAuthorityReservationRequestSchema.parse({
          schemaVersion: 1,
          kind: "trusted-command-authority-reservation-request",
          projectId: validatedPlan.projectId,
          issuerId: ISSUER_ID,
          commandId: command.id,
          operationId: operation.id,
          target: command.target,
          requiredCapabilities: CAPABILITIES,
          leaseId: lease.id,
          fencingEpoch: lease.fencingEpoch,
          commandDraft: command,
          reviewedContext: {
            workspaceDigest: workspace.workspaceDigest,
            planDigest: validatedPlan.planDigest,
            batchRootDigest,
          },
        }),
    };
  });
  return { ...partial, entries };
}

function reservedBody(
  basis: BatchBasis,
  entries: readonly ReservedImportAuthorityEntry[],
) {
  return {
    schemaVersion: 1 as const,
    kind: "reserved-import-authority-batch" as const,
    batchRootDigest: basis.batchRootDigest,
    workspaceDigest: basis.plan.workspaceDigest,
    planDigest: basis.plan.planDigest,
    projectId: basis.plan.projectId,
    documentId: basis.plan.documentId,
    taskId: basis.taskId,
    runId: basis.runId,
    lease: basis.lease,
    decision: basis.decision,
    entries,
  };
}

function assertReservedEntryShape(entry: ReservedImportAuthorityEntry): void {
  assertExactKeys(
    entry,
    [
      "ordinal",
      "operation",
      "command",
      "outboxId",
      "reservationRequest",
      "reservation",
    ],
    "Reserved import authority entry",
  );
}

function validateReservedCore(
  input: ReservedImportAuthorityBatch,
  workspace: ProductWorkspace,
  plan: CanvasMaterializationPlan,
): { readonly batch: ReservedImportAuthorityBatch; readonly basis: BatchBasis } {
  assertExactKeys(
    input,
    [
      "schemaVersion",
      "kind",
      "batchDigest",
      "batchRootDigest",
      "workspaceDigest",
      "planDigest",
      "projectId",
      "documentId",
      "taskId",
      "runId",
      "lease",
      "decision",
      "entries",
    ],
    "Reserved import authority batch",
  );
  if (
    input.schemaVersion !== 1 ||
    input.kind !== "reserved-import-authority-batch" ||
    !Array.isArray(input.entries)
  ) {
    throw new Error("Reserved import authority batch is invalid.");
  }
  const basis = buildBasis(
    workspace,
    plan,
    input.lease,
    input.decision,
  );
  if (input.entries.length !== basis.entries.length) {
    throw new Error("Reserved import batch entry count is invalid.");
  }
  const entries = input.entries.map((untrustedEntry, index) => {
    assertReservedEntryShape(untrustedEntry);
    const expected = basis.entries[index];
    if (expected === undefined) {
      throw new Error("Reserved import entry is out of bounds.");
    }
    const operation = CanvasOperationSchema.parse(untrustedEntry.operation);
    const request =
      TrustedCommandAuthorityReservationRequestSchema.parse(
        untrustedEntry.reservationRequest,
      );
    const reservation = TrustedCommandAuthorityReservationSchema.parse(
      untrustedEntry.reservation,
    );
    const command = DurableCommandSchema.parse(untrustedEntry.command);
    OutboxIdSchema.parse(untrustedEntry.outboxId);
    const expectedCommand = finalizeCommand(
      expected.commandDraft,
      expected.operation,
      reservation,
    );
    if (
      untrustedEntry.ordinal !== index ||
      canonicalJson(operation) !== canonicalJson(expected.operation) ||
      canonicalJson(request) !==
        canonicalJson(expected.reservationRequest) ||
      reservation.requestDigest !== hashCanonicalValue(request) ||
      reservation.projectId !== request.projectId ||
      reservation.commandId !== request.commandId ||
      reservation.operationId !== request.operationId ||
      reservation.leaseId !== request.leaseId ||
      reservation.fencingEpoch !== request.fencingEpoch ||
      canonicalJson(reservation.target) !== canonicalJson(request.target) ||
      canonicalJson(reservation.reviewedContext) !==
        canonicalJson(request.reviewedContext) ||
      canonicalJson(command) !== canonicalJson(expectedCommand) ||
      untrustedEntry.outboxId !== expected.outboxId
    ) {
      throw new Error(
        "Reserved import operation, action, command, or reservation binding is invalid.",
      );
    }
    return {
      ordinal: index,
      operation,
      command,
      outboxId: untrustedEntry.outboxId,
      reservationRequest: request,
      reservation,
    };
  });
  const body = reservedBody(basis, entries);
  const batch = deepFreeze({
    ...body,
    batchDigest: hashCanonicalValue(body),
  });
  if (canonicalJson(input) !== canonicalJson(batch)) {
    throw new Error(
      "Reserved import batch digest, lineage, or entry order is invalid.",
    );
  }
  return { batch, basis };
}

export async function reserveApprovedImportAuthorityBatch(
  runtime: DurableRuntime,
  workspace: ProductWorkspace,
  plan: CanvasMaterializationPlan,
  activeLease: Lease,
  humanDecision: HumanImportBatchDecision,
): Promise<ReservedImportAuthorityBatch> {
  const basis = buildBasis(
    workspace,
    plan,
    activeLease,
    humanDecision,
  );
  const entries: ReservedImportAuthorityEntry[] = [];
  for (const entry of basis.entries) {
    const reservation = TrustedCommandAuthorityReservationSchema.parse(
      await runtime.reserveTrustedCommandAuthority(
        entry.reservationRequest,
      ),
    );
    entries.push({
      ordinal: entry.ordinal,
      operation: entry.operation,
      command: finalizeCommand(
        entry.commandDraft,
        entry.operation,
        reservation,
      ),
      outboxId: entry.outboxId,
      reservationRequest: entry.reservationRequest,
      reservation,
    });
  }
  const body = reservedBody(basis, entries);
  return deepFreeze({
    ...body,
    batchDigest: hashCanonicalValue(body),
  });
}

function unsignedIssuance(
  entry: ReservedImportAuthorityEntry,
  batch: ReservedImportAuthorityBatch,
  signer: ImportAuthoritySigner,
) {
  return {
    schemaVersion: 1 as const,
    kind: "trusted-command-authority-issuance" as const,
    reservationId: entry.reservation.id,
    reservationRequestDigest: entry.reservation.requestDigest,
    challenge: entry.reservation.challenge,
    grantId: entry.reservation.grantId,
    approvalId: entry.reservation.approvalId,
    projectId: entry.command.projectId,
    issuerId: entry.command.issuerId,
    commandId: entry.command.id,
    operationId: entry.operation.id,
    target: entry.command.target,
    actionDigest: entry.command.actionDigest,
    requiredCapabilities: entry.command.requiredCapabilities,
    leaseId: entry.command.authority.leaseId,
    fencingEpoch: entry.command.authority.fencingEpoch,
    approver: signer.approver,
    trustRootId: signer.trustRootId,
    trustRootFingerprint: signer.trustRootFingerprint,
    reviewedContext: {
      workspaceDigest: batch.workspaceDigest,
      planDigest: batch.planDigest,
      batchRootDigest: batch.batchRootDigest,
    },
    consequence: batch.decision.consequence,
    issuedAt: batch.decision.issuedAt,
    expiresAt: batch.decision.expiresAt,
    maximumUses: 1 as const,
  };
}

export async function issueApprovedImportAuthorityBatch(
  runtime: DurableRuntime,
  workspace: ProductWorkspace,
  plan: CanvasMaterializationPlan,
  input: ReservedImportAuthorityBatch,
  signer: ImportAuthoritySigner,
): Promise<IssuedImportAuthorityBatch> {
  const { batch } = validateReservedCore(input, workspace, plan);
  ContentHashSchema.parse(signer.trustRootFingerprint);
  if (
    signer.approver.kind !== "human" ||
    signer.approver.id !== batch.decision.approver.id ||
    signer.approver.keyId.trim().length === 0 ||
    signer.trustRootId.trim().length === 0 ||
    signer.signatureAlgorithm !== "ed25519"
  ) {
    throw new Error("External approval signer does not match the review.");
  }
  const entries: IssuedImportAuthorityEntry[] = [];
  for (const entry of batch.entries) {
    const unsigned = unsignedIssuance(entry, batch, signer);
    const issuance = TrustedCommandAuthorityIssuanceSchema.parse({
      ...unsigned,
      signatureAlgorithm: signer.signatureAlgorithm,
      signature: await signer.sign(unsigned),
    });
    const issuedAuthority = RuntimeIssuedCommandAuthoritySchema.parse(
      await runtime.issueTrustedCommandAuthority(issuance),
    );
    entries.push({
      ...entry,
      issuance,
      issuedAuthority,
      grant: issuedAuthority.grant,
      approval: issuedAuthority.approval,
    });
  }
  const body = {
    ...batchDigestBody(batch),
    kind: "issued-import-authority-batch" as const,
    entries,
  };
  return deepFreeze({
    ...body,
    batchDigest: hashCanonicalValue(body),
  });
}

export async function validateIssuedImportAuthorityBatch(
  runtime: DurableRuntime,
  input: IssuedImportAuthorityBatch,
  workspace: ProductWorkspace,
  plan: CanvasMaterializationPlan,
): Promise<IssuedImportAuthorityBatch> {
  assertExactKeys(
    input,
    [
      "schemaVersion",
      "kind",
      "batchDigest",
      "batchRootDigest",
      "workspaceDigest",
      "planDigest",
      "projectId",
      "documentId",
      "taskId",
      "runId",
      "lease",
      "decision",
      "entries",
    ],
    "Issued import authority batch",
  );
  if (
    input.schemaVersion !== 1 ||
    input.kind !== "issued-import-authority-batch" ||
    !Array.isArray(input.entries)
  ) {
    throw new Error("Issued import authority batch is invalid.");
  }
  const reservedInput = {
    ...input,
    kind: "reserved-import-authority-batch" as const,
    entries: input.entries.map((entry) => {
      const {
        issuance: _issuance,
        issuedAuthority: _authority,
        grant: _grant,
        approval: _approval,
        ...reserved
      } = entry;
      return reserved;
    }),
  };
  const reservedBodyValue = batchDigestBody(reservedInput);
  const { batch: reserved } = validateReservedCore(
    {
      ...reservedBodyValue,
      batchDigest: hashCanonicalValue(reservedBodyValue),
    },
    workspace,
    plan,
  );
  const entries = input.entries.map((entry, index) => {
    assertExactKeys(
      entry,
      [
        "ordinal",
        "operation",
        "command",
        "outboxId",
        "reservationRequest",
        "reservation",
        "issuance",
        "issuedAuthority",
        "grant",
        "approval",
      ],
      "Issued import authority entry",
    );
    const issuance = TrustedCommandAuthorityIssuanceSchema.parse(
      entry.issuance,
    );
    const authority = RuntimeIssuedCommandAuthoritySchema.parse(
      entry.issuedAuthority,
    );
    const reservedEntry = reserved.entries[index];
    const reservation = reservedEntry?.reservation;
    const command = reservedEntry?.command;
    if (
      reservedEntry === undefined ||
      reservation === undefined ||
      command === undefined ||
      issuance.reservationId !== reservation.id ||
      issuance.reservationRequestDigest !==
        reservation.requestDigest ||
      issuance.challenge !== reservation.challenge ||
      issuance.grantId !== reservation.grantId ||
      issuance.approvalId !== reservation.approvalId ||
      issuance.projectId !== command.projectId ||
      issuance.issuerId !== command.issuerId ||
      issuance.commandId !== command.id ||
      issuance.operationId !== reservedEntry.operation.id ||
      canonicalJson(issuance.target) !==
        canonicalJson(command.target) ||
      issuance.actionDigest !== command.actionDigest ||
      canonicalJson(issuance.requiredCapabilities) !==
        canonicalJson(command.requiredCapabilities) ||
      issuance.leaseId !== command.authority.leaseId ||
      issuance.fencingEpoch !== command.authority.fencingEpoch ||
      issuance.approver.id !== reserved.decision.approver.id ||
      issuance.trustRootId !== authority.trustRootId ||
      issuance.trustRootFingerprint !==
        authority.trustRootFingerprint ||
      canonicalJson(issuance.reviewedContext) !==
        canonicalJson(reservation.reviewedContext) ||
      issuance.consequence !== reserved.decision.consequence ||
      issuance.consequence !== authority.approval.consequence ||
      issuance.issuedAt !== reserved.decision.issuedAt ||
      issuance.issuedAt !== authority.grant.issuedAt ||
      issuance.issuedAt !== authority.approval.issuedAt ||
      issuance.expiresAt !== reserved.decision.expiresAt ||
      issuance.expiresAt !== authority.grant.expiresAt ||
      issuance.expiresAt !== authority.approval.expiresAt ||
      issuance.maximumUses !== 1 ||
      issuance.maximumUses !==
        authority.grant.constraints.maximumUses ||
      issuance.maximumUses !== authority.approval.maximumUses ||
      issuance.signatureAlgorithm !==
        authority.signatureAlgorithm ||
      issuance.signature !== authority.signature ||
      canonicalJson(authority.reservation) !==
        canonicalJson(reservation) ||
      canonicalJson(authority.grant) !== canonicalJson(entry.grant) ||
      canonicalJson(authority.approval) !== canonicalJson(entry.approval) ||
      authority.issuanceDigest !== hashCanonicalValue(issuance)
    ) {
      throw new Error("Issued import authority binding is invalid.");
    }
    return {
      ...reservedEntry,
      issuance,
      issuedAuthority: authority,
      grant: authority.grant,
      approval: authority.approval,
    };
  });
  const body = {
    ...batchDigestBody(reserved),
    kind: "issued-import-authority-batch" as const,
    entries,
  };
  const batch = deepFreeze({
    ...body,
    batchDigest: hashCanonicalValue(body),
  });
  if (canonicalJson(input) !== canonicalJson(batch)) {
    throw new Error("Issued import authority batch is not canonical.");
  }
  for (const entry of batch.entries) {
    const resolved = RuntimeIssuedCommandAuthoritySchema.parse(
      await runtime.issueTrustedCommandAuthority(entry.issuance),
    );
    if (
      canonicalJson(resolved) !==
      canonicalJson(entry.issuedAuthority)
    ) {
      throw new Error(
        "Issued import authority does not match trusted runtime state.",
      );
    }
  }
  return batch;
}
