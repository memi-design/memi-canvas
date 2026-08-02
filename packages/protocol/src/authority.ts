import { canonicalJson } from "@memi/canonical-json";
import { z } from "zod";

import {
  ContentHashSchema,
  GitRevisionSchema,
  IsoTimestampSchema,
  SchemaVersionSchema,
  hasUniqueValues,
} from "./common.js";
import {
  ApprovalReceiptIdSchema,
  CapabilityGrantIdSchema,
  CheckpointIdSchema,
  DurableCommandIdSchema,
  IdempotencyKeySchema,
  LeaseIdSchema,
  OutboxIdSchema,
  OperationIdSchema,
  ProcessRequestIdSchema,
  ProjectIdSchema,
  RecoveryAttemptIdSchema,
  RunIdSchema,
  TaskIdSchema,
  TraceEventIdSchema,
  TrustedCommandAuthorityReservationIdSchema,
} from "./ids.js";
import {
  CapabilityGrantSchema,
  CapabilitySchema,
  LeaseSchema,
} from "./durability.js";
import {
  AuthorityChallengeSchema,
  AuthorityDigestSchema,
  CanonicalBase64Schema,
  RequiredAuthorityCapabilitiesSchema,
} from "./trusted-command-authority-primitives.js";
import {
  TrustedCommandAuthorityReviewedContextSchema,
} from "./trusted-authority-context.js";

export {
  TrustedAuthorityBatchRootMaterialSchema,
  TrustedCommandAuthorityReviewedContextSchema,
  computeTrustedAuthorityBatchRoot,
  type TrustedAuthorityBatchRootMaterial,
  type TrustedCommandAuthorityReviewedContext,
} from "./trusted-authority-context.js";

export const DurableCommandKindSchema = z.enum([
  "canvas.operation",
  "artifact.persist",
  "sandbox.process",
  "git.effect",
  "external.publish",
]);
export type DurableCommandKind = z.infer<
  typeof DurableCommandKindSchema
>;

const ContentHashBaselineSchema = z.strictObject({
  kind: z.literal("content-hash"),
  value: ContentHashSchema,
});

const GitRevisionBaselineSchema = z.strictObject({
  kind: z.literal("git-revision"),
  value: GitRevisionSchema,
});

const CanvasRevisionBaselineSchema = z.strictObject({
  kind: z.literal("canvas-revision"),
  revision: z.number().int().nonnegative(),
  stateHash: ContentHashSchema,
});

export const TargetBaselineSchema = z.discriminatedUnion("kind", [
  ContentHashBaselineSchema,
  GitRevisionBaselineSchema,
  CanvasRevisionBaselineSchema,
]);
export type TargetBaseline = z.infer<typeof TargetBaselineSchema>;

export const DurableTargetSchema = z.strictObject({
  kind: z.enum([
    "canvas-document",
    "artifact",
    "process-request",
    "source-worktree",
    "git-remote",
    "external-publication",
  ]),
  id: z.string().trim().min(1),
  expectedBeforeHash: ContentHashSchema,
  baseline: TargetBaselineSchema,
});
export type DurableTarget = z.infer<typeof DurableTargetSchema>;

const COMMAND_TARGET_KINDS: Readonly<
  Record<DurableCommandKind, readonly DurableTarget["kind"][]>
> = {
  "canvas.operation": ["canvas-document"],
  "artifact.persist": ["artifact"],
  "sandbox.process": ["process-request"],
  "git.effect": ["source-worktree", "git-remote"],
  "external.publish": ["external-publication"],
};

export function durableCommandTargetKindMatches(
  commandKind: string,
  targetKind: string,
): boolean {
  return (
    commandKind in COMMAND_TARGET_KINDS &&
    COMMAND_TARGET_KINDS[
      commandKind as DurableCommandKind
    ].includes(targetKind as DurableTarget["kind"])
  );
}

export const DurableCommandSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: DurableCommandIdSchema,
    projectId: ProjectIdSchema,
    taskId: TaskIdSchema,
    runId: RunIdSchema,
    issuerId: z.string().trim().min(1),
    kind: DurableCommandKindSchema,
    target: DurableTargetSchema,
    payloadHash: ContentHashSchema,
    idempotencyKey: IdempotencyKeySchema,
    actionDigest: ContentHashSchema,
    requiredCapabilities: z.array(CapabilitySchema).min(1),
    authority: z.strictObject({
      capabilityGrantId: CapabilityGrantIdSchema,
      approvalReceiptId: ApprovalReceiptIdSchema.nullable(),
      leaseId: LeaseIdSchema,
      fencingEpoch: z.number().int().positive(),
    }),
    issuedAt: IsoTimestampSchema,
  })
  .superRefine((command, context) => {
    if (!hasUniqueValues(command.requiredCapabilities)) {
      context.addIssue({
        code: "custom",
        path: ["requiredCapabilities"],
        message: "Command capabilities must be unique.",
      });
    }
    if (
      !durableCommandTargetKindMatches(
        command.kind,
        command.target.kind,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["target", "kind"],
        message:
          `Command kind "${command.kind}" cannot use target kind ` +
          `"${command.target.kind}".`,
      });
    }
  });
export type DurableCommand = z.infer<typeof DurableCommandSchema>;

export const ApprovalReceiptSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: ApprovalReceiptIdSchema,
    projectId: ProjectIdSchema,
    approver: z.strictObject({
      kind: z.literal("human"),
      id: z.string().trim().min(1),
    }),
    target: DurableTargetSchema,
    actionDigest: ContentHashSchema,
    capabilities: z.array(CapabilitySchema).min(1),
    consequence: z.string().trim().min(1).max(1_000),
    issuedAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
    maximumUses: z.number().int().positive(),
  })
  .superRefine((receipt, context) => {
    if (!hasUniqueValues(receipt.capabilities)) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "Approval capabilities must be unique.",
      });
    }
    if (Date.parse(receipt.expiresAt) <= Date.parse(receipt.issuedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Approval receipts must expire after issuance.",
      });
    }
  });
export type ApprovalReceipt = z.infer<typeof ApprovalReceiptSchema>;

function equalStringSets(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

export const ApprovalUseSchema = z
  .strictObject({
    command: DurableCommandSchema,
    receipt: ApprovalReceiptSchema,
    useNumber: z.number().int().positive(),
    usedAt: IsoTimestampSchema,
  })
  .superRefine(({ command, receipt, useNumber, usedAt }, context) => {
    const targetMatches =
      JSON.stringify(command.target) === JSON.stringify(receipt.target);
    if (
      command.authority.approvalReceiptId !== receipt.id ||
      command.projectId !== receipt.projectId ||
      command.actionDigest !== receipt.actionDigest ||
      !targetMatches ||
      !equalStringSets(
        command.requiredCapabilities,
        receipt.capabilities,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["receipt"],
        message: "Approval receipt does not exactly authorize this command.",
      });
    }
    if (useNumber > receipt.maximumUses) {
      context.addIssue({
        code: "custom",
        path: ["useNumber"],
        message: "Approval receipt use limit exceeded.",
      });
    }
    const useTime = Date.parse(usedAt);
    if (
      useTime < Date.parse(receipt.issuedAt) ||
      useTime >= Date.parse(receipt.expiresAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["usedAt"],
        message: "Approval receipt is not valid at the use time.",
      });
    }
  });
export type ApprovalUse = z.infer<typeof ApprovalUseSchema>;

export const CapabilityGrantUseSchema = z
  .strictObject({
    command: DurableCommandSchema,
    grant: CapabilityGrantSchema,
    useNumber: z.number().int().positive(),
    usedAt: IsoTimestampSchema,
  })
  .superRefine(({ command, grant, useNumber, usedAt }, context) => {
    const grantsRequiredCapabilities = command.requiredCapabilities.every(
      (capability) => grant.capabilities.includes(capability),
    );
    if (
      command.authority.capabilityGrantId !== grant.id ||
      command.projectId !== grant.projectId ||
      command.issuerId !== grant.clientId ||
      command.actionDigest !== grant.constraints.actionDigest ||
      !grantsRequiredCapabilities
    ) {
      context.addIssue({
        code: "custom",
        path: ["grant"],
        message: "Capability grant does not authorize this command.",
      });
    }
    if (useNumber > grant.constraints.maximumUses) {
      context.addIssue({
        code: "custom",
        path: ["useNumber"],
        message: "Capability grant use limit exceeded.",
      });
    }
    const useTime = Date.parse(usedAt);
    if (
      useTime < Date.parse(grant.issuedAt) ||
      useTime >= Date.parse(grant.expiresAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["usedAt"],
        message: "Capability grant is not valid at the use time.",
      });
    }
  });
export type CapabilityGrantUse = z.infer<
  typeof CapabilityGrantUseSchema
>;

export const LeaseUseSchema = z
  .strictObject({
    command: DurableCommandSchema,
    lease: LeaseSchema,
    usedAt: IsoTimestampSchema,
  })
  .superRefine(({ command, lease, usedAt }, context) => {
    if (
      command.authority.leaseId !== lease.id ||
      command.projectId !== lease.projectId ||
      command.target.id !== lease.targetId ||
      command.issuerId !== lease.holderId ||
      command.authority.fencingEpoch !== lease.fencingEpoch
    ) {
      context.addIssue({
        code: "custom",
        path: ["lease"],
        message: "Lease does not fence this command authority.",
      });
    }
    const useTime = Date.parse(usedAt);
    if (
      useTime < Date.parse(lease.acquiredAt) ||
      useTime >= Date.parse(lease.expiresAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["usedAt"],
        message: "Lease is not active at the use time.",
      });
    }
  });
export type LeaseUse = z.infer<typeof LeaseUseSchema>;

export const TrustedCommandAuthorityReservationRequestSchema =
  z
    .strictObject({
      schemaVersion: SchemaVersionSchema,
      kind: z.literal("trusted-command-authority-reservation-request"),
      projectId: ProjectIdSchema,
      issuerId: z.string().trim().min(1).max(1_024),
      commandId: DurableCommandIdSchema,
      operationId: OperationIdSchema,
      target: DurableTargetSchema,
      requiredCapabilities: RequiredAuthorityCapabilitiesSchema,
      leaseId: LeaseIdSchema,
      fencingEpoch: z.number().int().positive(),
      commandDraft: DurableCommandSchema,
      reviewedContext: TrustedCommandAuthorityReviewedContextSchema,
    })
    .superRefine((request, context) => {
      const command = request.commandDraft;
      if (
        command.projectId !== request.projectId ||
        command.issuerId !== request.issuerId ||
        command.id !== request.commandId ||
        !sameCanonicalValue(command.target, request.target) ||
        !sameCanonicalValue(
          command.requiredCapabilities,
          request.requiredCapabilities,
        ) ||
        command.authority.leaseId !== request.leaseId ||
        command.authority.fencingEpoch !== request.fencingEpoch
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Authority reservation must bind one exact command draft.",
        });
      }
    });
export type TrustedCommandAuthorityReservationRequest = z.infer<
  typeof TrustedCommandAuthorityReservationRequestSchema
>;

export const TrustedCommandAuthorityReservationSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    kind: z.literal("trusted-command-authority-reservation"),
    id: TrustedCommandAuthorityReservationIdSchema,
    requestDigest: AuthorityDigestSchema,
    challenge: AuthorityChallengeSchema,
    grantId: CapabilityGrantIdSchema,
    approvalId: ApprovalReceiptIdSchema,
    projectId: ProjectIdSchema,
    commandId: DurableCommandIdSchema,
    operationId: OperationIdSchema,
    target: DurableTargetSchema,
    leaseId: LeaseIdSchema,
    fencingEpoch: z.number().int().positive(),
    reviewedContext: TrustedCommandAuthorityReviewedContextSchema,
    reservedAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
  })
  .superRefine((reservation, context) => {
    if (Date.parse(reservation.expiresAt) <= Date.parse(reservation.reservedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Authority reservations must expire after reservation.",
      });
    }
  });
export type TrustedCommandAuthorityReservation = z.infer<
  typeof TrustedCommandAuthorityReservationSchema
>;

export const TrustedCommandAuthorityIssuanceSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    kind: z.literal("trusted-command-authority-issuance"),
    reservationId: TrustedCommandAuthorityReservationIdSchema,
    reservationRequestDigest: AuthorityDigestSchema,
    challenge: AuthorityChallengeSchema,
    grantId: CapabilityGrantIdSchema,
    approvalId: ApprovalReceiptIdSchema,
    projectId: ProjectIdSchema,
    issuerId: z.string().trim().min(1).max(1_024),
    commandId: DurableCommandIdSchema,
    operationId: OperationIdSchema,
    target: DurableTargetSchema,
    actionDigest: ContentHashSchema,
    requiredCapabilities: RequiredAuthorityCapabilitiesSchema,
    leaseId: LeaseIdSchema,
    fencingEpoch: z.number().int().positive(),
    approver: z.strictObject({
      kind: z.literal("human"),
      id: z.string().trim().min(1).max(1_024),
      keyId: z.string().trim().min(1).max(1_024),
    }),
    trustRootId: z.string().trim().min(1).max(1_024),
    trustRootFingerprint: ContentHashSchema,
    reviewedContext: TrustedCommandAuthorityReviewedContextSchema,
    consequence: z.string().trim().min(1).max(1_000),
    issuedAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
    maximumUses: z.number().int().positive(),
    signatureAlgorithm: z.literal("ed25519"),
    signature: CanonicalBase64Schema,
  })
  .superRefine((issuance, context) => {
    if (Date.parse(issuance.expiresAt) <= Date.parse(issuance.issuedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Authority issuances must expire after issuance.",
      });
    }
  });
export type TrustedCommandAuthorityIssuance = z.infer<
  typeof TrustedCommandAuthorityIssuanceSchema
>;

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export const RuntimeIssuedCommandAuthoritySchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    kind: z.literal("runtime-issued-command-authority"),
    reservation: TrustedCommandAuthorityReservationSchema,
    issuanceDigest: ContentHashSchema,
    grant: CapabilityGrantSchema,
    approval: ApprovalReceiptSchema,
    leaseId: LeaseIdSchema,
    fencingEpoch: z.number().int().positive(),
    trustRootId: z.string().trim().min(1).max(1_024),
    trustRootFingerprint: ContentHashSchema,
    reviewedContext: TrustedCommandAuthorityReviewedContextSchema,
    signatureAlgorithm: z.literal("ed25519"),
    signature: CanonicalBase64Schema,
  })
  .superRefine((authority, context) => {
    const { reservation, grant, approval } = authority;
    const matchesReservation =
      grant.id === reservation.grantId &&
      approval.id === reservation.approvalId &&
      grant.projectId === reservation.projectId &&
      approval.projectId === reservation.projectId &&
      authority.leaseId === reservation.leaseId &&
      authority.fencingEpoch === reservation.fencingEpoch &&
      sameCanonicalValue(approval.target, reservation.target) &&
      sameCanonicalValue(authority.reviewedContext, reservation.reviewedContext);
    const matchesApprovedAction =
      grant.constraints.actionDigest === approval.actionDigest &&
      grant.constraints.maximumUses === approval.maximumUses &&
      sameCanonicalValue(grant.capabilities, approval.capabilities) &&
      grant.issuedAt === approval.issuedAt &&
      grant.expiresAt === approval.expiresAt;
    if (!matchesReservation || !matchesApprovedAction) {
      context.addIssue({
        code: "custom",
        message:
          "Runtime-issued authority must retain its exact reservation and approval binding.",
      });
    }
  });
export type RuntimeIssuedCommandAuthority = z.infer<
  typeof RuntimeIssuedCommandAuthoritySchema
>;

const runStateBase = {
  schemaVersion: SchemaVersionSchema,
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
  runId: RunIdSchema,
  revision: z.number().int().positive(),
  harness: z
    .strictObject({
      harnessId: z.string().trim().min(1),
      modelId: z.string().trim().min(1),
    })
    .nullable(),
  requiredCapabilities: z.array(CapabilitySchema),
  updatedAt: IsoTimestampSchema,
};

const QueuedRunStateSchema = z.strictObject({
  ...runStateBase,
  state: z.literal("queued"),
});

const RunningRunStateSchema = z.strictObject({
  ...runStateBase,
  state: z.literal("running"),
  harness: z.strictObject({
    harnessId: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
  }),
  startedAt: IsoTimestampSchema,
  activeCommandId: DurableCommandIdSchema.nullable(),
});

const WaitingApprovalRunStateSchema = z.strictObject({
  ...runStateBase,
  state: z.literal("waiting-approval"),
  commandId: DurableCommandIdSchema,
  actionDigest: ContentHashSchema,
});

const WaitingProcessRunStateSchema = z.strictObject({
  ...runStateBase,
  state: z.literal("waiting-process"),
  commandId: DurableCommandIdSchema,
  processRequestId: ProcessRequestIdSchema,
});

const SucceededRunStateSchema = z.strictObject({
  ...runStateBase,
  state: z.literal("succeeded"),
  completedAt: IsoTimestampSchema,
  resultHash: ContentHashSchema,
});

const FailedRunStateSchema = z.strictObject({
  ...runStateBase,
  state: z.literal("failed"),
  completedAt: IsoTimestampSchema,
  error: z.strictObject({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
    message: z.string().trim().min(1),
  }),
});

const InterruptedRunStateSchema = z.strictObject({
  ...runStateBase,
  state: z.literal("interrupted"),
  interruptedAt: IsoTimestampSchema,
  reason: z.string().trim().min(1),
  checkpointId: CheckpointIdSchema.nullable(),
});

export const DurableRunStateSchema = z
  .discriminatedUnion("state", [
    QueuedRunStateSchema,
    RunningRunStateSchema,
    WaitingApprovalRunStateSchema,
    WaitingProcessRunStateSchema,
    SucceededRunStateSchema,
    FailedRunStateSchema,
    InterruptedRunStateSchema,
  ])
  .superRefine((state, context) => {
    if (!hasUniqueValues(state.requiredCapabilities)) {
      context.addIssue({
        code: "custom",
        path: ["requiredCapabilities"],
        message: "Run capabilities must be unique.",
      });
    }
  });
export type DurableRunState = z.infer<typeof DurableRunStateSchema>;

const RUN_TRANSITIONS: Readonly<Record<DurableRunState["state"], readonly string[]>> =
  {
    queued: ["running", "failed", "interrupted"],
    running: [
      "waiting-approval",
      "waiting-process",
      "succeeded",
      "failed",
      "interrupted",
    ],
    "waiting-approval": ["running", "failed", "interrupted"],
    "waiting-process": ["running", "failed", "interrupted"],
    succeeded: [],
    failed: [],
    interrupted: [],
  };

export const DurableRunStateTransitionSchema = z
  .strictObject({
    from: DurableRunStateSchema,
    to: DurableRunStateSchema,
  })
  .superRefine(({ from, to }, context) => {
    if (
      from.projectId !== to.projectId ||
      from.taskId !== to.taskId ||
      from.runId !== to.runId
    ) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Run identity cannot change during a transition.",
      });
    }
    if (
      !equalStringSets(
        from.requiredCapabilities,
        to.requiredCapabilities,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["to", "requiredCapabilities"],
        message: "Run capability requirements cannot change.",
      });
    }
    if (
      from.state !== "queued" &&
      (from.harness === null ||
        to.harness === null ||
        from.harness.harnessId !== to.harness.harnessId ||
        from.harness.modelId !== to.harness.modelId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["to", "harness"],
        message:
          "Post-dispatch harness attribution cannot change within a run.",
      });
    }
    if (to.revision !== from.revision + 1) {
      context.addIssue({
        code: "custom",
        path: ["to", "revision"],
        message: "Run revisions must advance by exactly one.",
      });
    }
    if (Date.parse(to.updatedAt) < Date.parse(from.updatedAt)) {
      context.addIssue({
        code: "custom",
        path: ["to", "updatedAt"],
        message: "Run update time cannot move backwards.",
      });
    }
    if (!RUN_TRANSITIONS[from.state].includes(to.state)) {
      context.addIssue({
        code: "custom",
        path: ["to", "state"],
        message: `Run state cannot transition from ${from.state} to ${to.state}.`,
      });
    }
  });
export type DurableRunStateTransition = z.infer<
  typeof DurableRunStateTransitionSchema
>;

const recoveryBase = {
  schemaVersion: SchemaVersionSchema,
  id: RecoveryAttemptIdSchema,
  projectId: ProjectIdSchema,
  commandId: DurableCommandIdSchema,
  outboxId: OutboxIdSchema,
  checkpointId: CheckpointIdSchema.nullable(),
  decidedAt: IsoTimestampSchema,
};

const RecoveryProbeSchema = z.strictObject({
  kind: z.literal("target-state-hash"),
  checkedAt: IsoTimestampSchema,
  evidenceHash: ContentHashSchema,
});

const RetryIntentDecisionSchema = z
  .strictObject({
    ...recoveryBase,
    observedPhase: z.literal("intent"),
    decision: z.literal("retry-idempotent-effect"),
    effectKind: z.enum(["canvas.operation", "artifact.persist"]),
    retryClass: z.literal("proven-idempotent"),
    expectedBeforeHash: ContentHashSchema,
    observedTargetHash: ContentHashSchema,
    probe: RecoveryProbeSchema,
  })
  .superRefine((decision, context) => {
    if (decision.expectedBeforeHash !== decision.observedTargetHash) {
      context.addIssue({
        code: "custom",
        path: ["observedTargetHash"],
        message: "Retry requires proof that the target remains unchanged.",
      });
    }
  });

const BlockedIntentDecisionSchema = z.strictObject({
  ...recoveryBase,
  observedPhase: z.literal("intent"),
  decision: z.literal("block-outcome-unknown"),
  effectKind: DurableCommandKindSchema,
  reason: z.string().trim().min(1),
});

const EffectAppliedDecisionSchema = z
  .strictObject({
    ...recoveryBase,
    observedPhase: z.literal("effect-applied"),
    decision: z.literal("commit-durable-evidence"),
    resultingHash: ContentHashSchema,
    observedTargetHash: ContentHashSchema,
  })
  .superRefine((decision, context) => {
    if (decision.resultingHash !== decision.observedTargetHash) {
      context.addIssue({
        code: "custom",
        path: ["observedTargetHash"],
        message: "Recovery verification must match the applied result.",
      });
    }
  });

const CommittedDecisionSchema = z.strictObject({
  ...recoveryBase,
  observedPhase: z.literal("committed"),
  decision: z.literal("replay-without-effect"),
  resultingHash: ContentHashSchema,
  traceEventId: TraceEventIdSchema,
});

const FailedDecisionSchema = z.strictObject({
  ...recoveryBase,
  observedPhase: z.literal("failed"),
  decision: z.literal("preserve-failure"),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
});

export const CrashRecoveryDecisionSchema = z.union([
  RetryIntentDecisionSchema,
  BlockedIntentDecisionSchema,
  EffectAppliedDecisionSchema,
  CommittedDecisionSchema,
  FailedDecisionSchema,
]);
export type CrashRecoveryDecision = z.infer<
  typeof CrashRecoveryDecisionSchema
>;
