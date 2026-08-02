import { z } from "zod";
import { hashCanonicalValue } from "@memi/canonical-json";

import { CanvasOperationSchema } from "./canvas.js";
import {
  ContentHashSchema,
  IsoTimestampSchema,
  SchemaVersionSchema,
} from "./common.js";
import {
  ApprovalReceiptIdSchema,
  CanvasDocumentIdSchema,
  CapabilityGrantIdSchema,
  DurableCommandIdSchema,
  IdempotencyKeySchema,
  LeaseIdSchema,
  OperationIdSchema,
  OutboxIdSchema,
  ProjectIdSchema,
  RecoveryAttemptIdSchema,
  RunIdSchema,
  TaskIdSchema,
} from "./ids.js";

export const TARGET_ADAPTER_CONTRACT_VERSION = 1 as const;
export const BOUNDED_TARGET_RECEIPT_BYTES = 2_048;

const CanvasTargetIdentitySchema = z.strictObject({
  kind: z.literal("canvas-document"),
  id: CanvasDocumentIdSchema,
});

const CanvasTargetSchema = z
  .strictObject({
    kind: z.literal("canvas-document"),
    id: CanvasDocumentIdSchema,
    expectedBeforeHash: ContentHashSchema,
    baseline: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("content-hash"),
        value: ContentHashSchema,
      }),
      z.strictObject({
        kind: z.literal("canvas-revision"),
        revision: z.number().int().nonnegative(),
        stateHash: ContentHashSchema,
      }),
    ]),
  })
  .superRefine((target, context) => {
    const baselineHash =
      target.baseline.kind === "content-hash"
        ? target.baseline.value
        : target.baseline.stateHash;
    if (baselineHash !== target.expectedBeforeHash) {
      context.addIssue({
        code: "custom",
        path: ["baseline"],
        message:
          "Canvas target baseline must match its expected-before hash.",
      });
    }
  });

const LeaseAuthoritySchema = z.strictObject({
  id: LeaseIdSchema,
  holderId: z.string().trim().min(1).max(1_024),
  fencingEpoch: z.number().int().positive(),
});

const WorkerClaimAuthoritySchema = z.strictObject({
  id: z.string().trim().min(1).max(256),
  fencingEpoch: z.number().int().positive(),
  expiresAt: IsoTimestampSchema,
});

export const TargetEffectRequestSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    effectKind: z.literal("canvas.operation"),
    projectId: ProjectIdSchema,
    taskId: TaskIdSchema,
    runId: RunIdSchema,
    issuerId: z.string().trim().min(1).max(1_024),
    commandId: DurableCommandIdSchema,
    outboxId: OutboxIdSchema,
    target: CanvasTargetSchema,
    idempotencyKey: IdempotencyKeySchema,
    commandActionDigest: ContentHashSchema,
    operationActionDigest: ContentHashSchema,
    payloadHash: ContentHashSchema,
    payload: CanvasOperationSchema,
    capabilityGrantId: CapabilityGrantIdSchema,
    approvalReceiptId: ApprovalReceiptIdSchema,
    lease: LeaseAuthoritySchema,
    workerClaim: WorkerClaimAuthoritySchema,
  })
  .superRefine((request, context) => {
    if (request.payload.documentId !== request.target.id) {
      context.addIssue({
        code: "custom",
        path: ["payload", "documentId"],
        message: "Canvas payload must target the closed request target.",
      });
    }
    if (
      request.payload.expectedBeforeHash !==
      request.target.expectedBeforeHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["payload", "expectedBeforeHash"],
        message:
          "Canvas payload expected-before hash must match the target.",
      });
    }
    if (
      request.payload.actionDigest !==
      request.operationActionDigest
    ) {
      context.addIssue({
        code: "custom",
        path: ["payload", "actionDigest"],
        message:
          "Canvas payload must match the operation action digest.",
      });
    }
    const directActor =
      request.payload.actorId === request.issuerId;
    const trustedImportActor =
      request.issuerId === "import-runtime" &&
      request.payload.actorId === "memi-import-pipeline";
    if (!directActor && !trustedImportActor) {
      context.addIssue({
        code: "custom",
        path: ["payload", "actorId"],
        message:
          "Canvas payload actor must match the request issuer or the trusted import identity pair.",
      });
    }
    if (request.lease.holderId !== request.issuerId) {
      context.addIssue({
        code: "custom",
        path: ["lease", "holderId"],
        message: "Lease holder must match the request issuer.",
      });
    }
  });
export type TargetEffectRequest = z.infer<
  typeof TargetEffectRequestSchema
>;

export const TargetFenceActivationRequestSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  projectId: ProjectIdSchema,
  target: CanvasTargetIdentitySchema,
  leaseId: LeaseIdSchema,
  holderId: z.string().trim().min(1).max(1_024),
  fencingEpoch: z.number().int().positive(),
});
export type TargetFenceActivationRequest = z.infer<
  typeof TargetFenceActivationRequestSchema
>;

const fenceResultBase = {
  schemaVersion: SchemaVersionSchema,
  projectId: ProjectIdSchema,
  target: CanvasTargetIdentitySchema,
  leaseId: LeaseIdSchema,
  holderId: z.string().trim().min(1).max(1_024),
  fencingEpoch: z.number().int().positive(),
  highestFence: z.number().int().positive(),
};

export const TargetFenceActivationResultSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...fenceResultBase,
      status: z.literal("activated"),
    }),
    z.strictObject({
      ...fenceResultBase,
      status: z.literal("replayed"),
    }),
    z.strictObject({
      ...fenceResultBase,
      status: z.literal("rejected"),
      code: z.enum(["STALE_FENCE", "FENCE_IDENTITY_CONFLICT"]),
    }),
  ])
  .superRefine((result, context) => {
    if (
      result.status !== "rejected" &&
      result.highestFence !== result.fencingEpoch
    ) {
      context.addIssue({
        code: "custom",
        path: ["highestFence"],
        message:
          "Successful activation highest fence must equal its epoch.",
      });
    }
    if (
      result.status === "rejected" &&
      result.code === "STALE_FENCE" &&
      result.highestFence <= result.fencingEpoch
    ) {
      context.addIssue({
        code: "custom",
        path: ["highestFence"],
        message:
          "A stale-fence rejection must report a higher active fence.",
      });
    }
  });
export type TargetFenceActivationResult = z.infer<
  typeof TargetFenceActivationResultSchema
>;

const targetReceiptHashMaterialShape = {
  schemaVersion: SchemaVersionSchema,
  adapterContractVersion: z.literal(
    TARGET_ADAPTER_CONTRACT_VERSION,
  ),
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
  runId: RunIdSchema,
  commandId: DurableCommandIdSchema,
  outboxId: OutboxIdSchema,
  target: CanvasTargetIdentitySchema,
  idempotencyKey: IdempotencyKeySchema,
  commandActionDigest: ContentHashSchema,
  operationActionDigest: ContentHashSchema,
  payloadHash: ContentHashSchema,
  expectedBeforeHash: ContentHashSchema,
  resultingHash: ContentHashSchema,
  leaseId: LeaseIdSchema,
  leaseHolderId: z.string().trim().min(1).max(1_024),
  fencingEpoch: z.number().int().positive(),
  workerClaimId: z.string().trim().min(1).max(256),
  workerClaimFencingEpoch: z.number().int().positive(),
  operationId: OperationIdSchema,
  appliedRevision: z.number().int().nonnegative(),
  appliedAt: IsoTimestampSchema,
};

export const TargetReceiptHashMaterialSchema = z.strictObject(
  targetReceiptHashMaterialShape,
);
export type TargetReceiptHashMaterial = z.infer<
  typeof TargetReceiptHashMaterialSchema
>;

export const TargetReceiptSchema = z
  .strictObject({
    ...targetReceiptHashMaterialShape,
    receiptHash: ContentHashSchema,
  })
  .refine(
    (receipt) =>
      new TextEncoder().encode(JSON.stringify(receipt)).byteLength <=
      BOUNDED_TARGET_RECEIPT_BYTES,
    {
      message: `Target receipt exceeds ${BOUNDED_TARGET_RECEIPT_BYTES} bytes.`,
    },
  );
export type TargetReceipt = z.infer<typeof TargetReceiptSchema>;

const TargetNotAppliedEvidenceSchema = z.strictObject({
  code: z.enum([
    "STALE_TARGET",
    "STALE_FENCE",
    "STALE_CLAIM",
    "IDEMPOTENCY_CONFLICT",
    "TARGET_NOT_FOUND",
    "INVALID_REQUEST",
    "APPLY_REJECTED",
  ]),
  message: z.string().trim().min(1).max(512),
  currentTargetHash: ContentHashSchema.nullable(),
  evidenceHash: ContentHashSchema,
});

export const TargetApplyOutcomeSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      schemaVersion: SchemaVersionSchema,
      status: z.literal("applied"),
      receipt: TargetReceiptSchema,
    }),
    z.strictObject({
      schemaVersion: SchemaVersionSchema,
      status: z.literal("replayed"),
      receipt: TargetReceiptSchema,
    }),
    z.strictObject({
      schemaVersion: SchemaVersionSchema,
      status: z.literal("not-applied"),
      evidence: TargetNotAppliedEvidenceSchema,
    }),
    z.strictObject({
      schemaVersion: SchemaVersionSchema,
      status: z.literal("outcome-unknown"),
      error: z.strictObject({
        code: z.enum([
          "TARGET_UNAVAILABLE",
          "TARGET_TIMEOUT",
          "ACKNOWLEDGEMENT_LOST",
          "INTERNAL_ERROR",
        ]),
        message: z.string().trim().min(1).max(512),
      }),
    }),
  ],
);
export type TargetApplyOutcome = z.infer<
  typeof TargetApplyOutcomeSchema
>;

const trustedRequestBase = {
  schemaVersion: SchemaVersionSchema,
  projectId: ProjectIdSchema,
  target: CanvasTargetSchema,
  idempotencyKey: IdempotencyKeySchema,
  commandId: DurableCommandIdSchema,
  commandActionDigest: ContentHashSchema,
  operationActionDigest: ContentHashSchema,
  expectedBeforeHash: ContentHashSchema,
};

export const RecoveryChallengeNonceSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u);

export const TargetRecoveryChallengeSchema = z.strictObject({
  id: RecoveryAttemptIdSchema,
  nonce: RecoveryChallengeNonceSchema,
  issuedAt: IsoTimestampSchema,
});

export const TargetLookupRequestHashMaterialSchema =
  z.strictObject({
    ...trustedRequestBase,
    challenge: TargetRecoveryChallengeSchema,
  });
export type TargetLookupRequestHashMaterial = z.infer<
  typeof TargetLookupRequestHashMaterialSchema
>;

export const TargetLookupRequestSchema = z
  .strictObject({
    ...TargetLookupRequestHashMaterialSchema.shape,
    requestDigest: ContentHashSchema,
  })
  .superRefine((request, context) => {
    if (
      request.expectedBeforeHash !==
      request.target.expectedBeforeHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedBeforeHash"],
        message:
          "Lookup expected-before hash must match the target baseline.",
      });
    }
  });
export type TargetLookupRequest = z.infer<
  typeof TargetLookupRequestSchema
>;

const boundedEvidenceMessage = z.string().trim().min(1).max(512);

const targetLookupResultBinding = {
  schemaVersion: SchemaVersionSchema,
  requestDigest: ContentHashSchema,
  checkedAt: IsoTimestampSchema,
};

export const TargetLookupEvidenceHashMaterialSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...targetLookupResultBinding,
      status: z.literal("found"),
      receipt: TargetReceiptSchema,
      currentTargetHash: ContentHashSchema,
    }),
    z.strictObject({
      ...targetLookupResultBinding,
      status: z.literal("not-found"),
      currentTargetHash: ContentHashSchema,
    }),
    z.strictObject({
      ...targetLookupResultBinding,
      status: z.literal("mismatch"),
      code: z.enum([
        "RECEIPT_IDENTITY_MISMATCH",
        "TARGET_HASH_MISMATCH",
      ]),
      message: boundedEvidenceMessage,
    }),
    z.strictObject({
      ...targetLookupResultBinding,
      status: z.literal("unavailable"),
      code: z.literal("TARGET_UNAVAILABLE"),
      message: boundedEvidenceMessage,
    }),
    z.strictObject({
      ...targetLookupResultBinding,
      status: z.literal("corrupt"),
      code: z.enum([
        "RECEIPT_CORRUPT",
        "TARGET_CORRUPT",
        "LEDGER_CORRUPT",
      ]),
      message: boundedEvidenceMessage,
    }),
  ]);
export type TargetLookupEvidenceHashMaterial = z.infer<
  typeof TargetLookupEvidenceHashMaterialSchema
>;

export const TargetLookupResultSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...targetLookupResultBinding,
      status: z.literal("found"),
      receipt: TargetReceiptSchema,
      currentTargetHash: ContentHashSchema,
      evidenceHash: ContentHashSchema,
    }),
    z.strictObject({
      ...targetLookupResultBinding,
      status: z.literal("not-found"),
      currentTargetHash: ContentHashSchema,
      evidenceHash: ContentHashSchema,
    }),
    z.strictObject({
      ...targetLookupResultBinding,
      status: z.literal("mismatch"),
      code: z.enum([
        "RECEIPT_IDENTITY_MISMATCH",
        "TARGET_HASH_MISMATCH",
      ]),
      message: boundedEvidenceMessage,
      evidenceHash: ContentHashSchema,
    }),
    z.strictObject({
      ...targetLookupResultBinding,
      status: z.literal("unavailable"),
      code: z.literal("TARGET_UNAVAILABLE"),
      message: boundedEvidenceMessage,
      evidenceHash: ContentHashSchema,
    }),
    z.strictObject({
      ...targetLookupResultBinding,
      status: z.literal("corrupt"),
      code: z.enum([
        "RECEIPT_CORRUPT",
        "TARGET_CORRUPT",
        "LEDGER_CORRUPT",
      ]),
      message: boundedEvidenceMessage,
      evidenceHash: ContentHashSchema,
    }),
  ])
  .superRefine((result, context) => {
    if (
      result.status === "found" &&
      result.currentTargetHash !== result.receipt.resultingHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentTargetHash"],
        message:
          "Found receipt resulting hash must match the current target.",
      });
    }
  });
export type TargetLookupResult = z.infer<
  typeof TargetLookupResultSchema
>;

export const TargetVerificationRequestHashMaterialSchema =
  z.strictObject({
    ...trustedRequestBase,
    expectedResultingHash: ContentHashSchema,
    expectedReceiptHash: ContentHashSchema,
    challenge: TargetRecoveryChallengeSchema,
  });
export type TargetVerificationRequestHashMaterial = z.infer<
  typeof TargetVerificationRequestHashMaterialSchema
>;

export const TargetVerificationRequestSchema = z
  .strictObject({
    ...TargetVerificationRequestHashMaterialSchema.shape,
    requestDigest: ContentHashSchema,
  })
  .superRefine((request, context) => {
    if (
      request.expectedBeforeHash !==
      request.target.expectedBeforeHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedBeforeHash"],
        message:
          "Verification expected-before hash must match the target baseline.",
      });
    }
  });
export type TargetVerificationRequest = z.infer<
  typeof TargetVerificationRequestSchema
>;

const targetVerificationResultBinding = {
  schemaVersion: SchemaVersionSchema,
  requestDigest: ContentHashSchema,
  checkedAt: IsoTimestampSchema,
};

export const TargetVerificationEvidenceHashMaterialSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...targetVerificationResultBinding,
      status: z.literal("verified-applied"),
      receipt: TargetReceiptSchema,
      currentTargetHash: ContentHashSchema,
    }),
    z.strictObject({
      ...targetVerificationResultBinding,
      status: z.literal("verified-not-applied"),
      expectedBeforeHash: ContentHashSchema,
      currentTargetHash: ContentHashSchema,
    }),
    z.strictObject({
      ...targetVerificationResultBinding,
      status: z.literal("mismatch"),
      code: z.enum([
        "RECEIPT_IDENTITY_MISMATCH",
        "TARGET_HASH_MISMATCH",
        "EXPECTED_EVIDENCE_MISMATCH",
      ]),
      message: boundedEvidenceMessage,
    }),
    z.strictObject({
      ...targetVerificationResultBinding,
      status: z.literal("unavailable"),
      code: z.literal("TARGET_UNAVAILABLE"),
      message: boundedEvidenceMessage,
    }),
    z.strictObject({
      ...targetVerificationResultBinding,
      status: z.literal("corrupt"),
      code: z.enum([
        "RECEIPT_CORRUPT",
        "TARGET_CORRUPT",
        "LEDGER_CORRUPT",
      ]),
      message: boundedEvidenceMessage,
    }),
  ]);
export type TargetVerificationEvidenceHashMaterial = z.infer<
  typeof TargetVerificationEvidenceHashMaterialSchema
>;

export const TargetVerificationResultSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...targetVerificationResultBinding,
      status: z.literal("verified-applied"),
      receipt: TargetReceiptSchema,
      currentTargetHash: ContentHashSchema,
      evidenceHash: ContentHashSchema,
    }),
    z.strictObject({
      ...targetVerificationResultBinding,
      status: z.literal("verified-not-applied"),
      expectedBeforeHash: ContentHashSchema,
      currentTargetHash: ContentHashSchema,
      evidenceHash: ContentHashSchema,
    }),
    z.strictObject({
      ...targetVerificationResultBinding,
      status: z.literal("mismatch"),
      code: z.enum([
        "RECEIPT_IDENTITY_MISMATCH",
        "TARGET_HASH_MISMATCH",
        "EXPECTED_EVIDENCE_MISMATCH",
      ]),
      message: boundedEvidenceMessage,
      evidenceHash: ContentHashSchema,
    }),
    z.strictObject({
      ...targetVerificationResultBinding,
      status: z.literal("unavailable"),
      code: z.literal("TARGET_UNAVAILABLE"),
      message: boundedEvidenceMessage,
      evidenceHash: ContentHashSchema,
    }),
    z.strictObject({
      ...targetVerificationResultBinding,
      status: z.literal("corrupt"),
      code: z.enum([
        "RECEIPT_CORRUPT",
        "TARGET_CORRUPT",
        "LEDGER_CORRUPT",
      ]),
      message: boundedEvidenceMessage,
      evidenceHash: ContentHashSchema,
    }),
  ])
  .superRefine((result, context) => {
    if (
      result.status === "verified-applied" &&
      result.currentTargetHash !== result.receipt.resultingHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentTargetHash"],
        message:
          "Verified target must match the receipt resulting hash.",
      });
    }
    if (
      result.status === "verified-not-applied" &&
      result.currentTargetHash !== result.expectedBeforeHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentTargetHash"],
        message:
          "Verified non-application must match the expected-before hash.",
      });
    }
  });
export type TargetVerificationResult = z.infer<
  typeof TargetVerificationResultSchema
>;

export const TARGET_VERIFICATION_FRESHNESS_MS = 30_000;

export type TargetVerificationValidation =
  | {
      readonly accepted: true;
      readonly result: TargetVerificationResult;
    }
  | {
      readonly accepted: false;
      readonly reason: string;
    };

function rejectedVerification(
  reason: string,
): TargetVerificationValidation {
  return { accepted: false, reason };
}

export function validateTargetVerificationEvidence(
  inputRequest: unknown,
  inputResult: unknown,
  observedAtInput: string,
): TargetVerificationValidation {
  const request = TargetVerificationRequestSchema.safeParse(
    inputRequest,
  );
  const result = TargetVerificationResultSchema.safeParse(inputResult);
  const observedAt = IsoTimestampSchema.safeParse(observedAtInput);
  if (!request.success || !result.success || !observedAt.success) {
    return rejectedVerification(
      "Target verification exchange failed strict validation.",
    );
  }
  const {
    requestDigest,
    ...untrustedRequestMaterial
  } = request.data;
  const requestMaterial =
    TargetVerificationRequestHashMaterialSchema.parse(
      untrustedRequestMaterial,
    );
  if (requestDigest !== hashCanonicalValue(requestMaterial)) {
    return rejectedVerification(
      "Target verification request digest is invalid.",
    );
  }
  const {
    evidenceHash,
    ...untrustedEvidenceMaterial
  } = result.data;
  const evidenceMaterial =
    TargetVerificationEvidenceHashMaterialSchema.parse(
      untrustedEvidenceMaterial,
    );
  if (result.data.requestDigest !== requestDigest) {
    return rejectedVerification(
      "Target verification result belongs to another request.",
    );
  }
  if (evidenceHash !== hashCanonicalValue(evidenceMaterial)) {
    return rejectedVerification(
      "Target verification evidence hash is invalid.",
    );
  }
  const issuedAt = Date.parse(request.data.challenge.issuedAt);
  const checkedAt = Date.parse(result.data.checkedAt);
  const now = Date.parse(observedAt.data);
  if (checkedAt < issuedAt) {
    return rejectedVerification(
      "Target verification predates its challenge.",
    );
  }
  if (
    issuedAt > now ||
    now - issuedAt > TARGET_VERIFICATION_FRESHNESS_MS
  ) {
    return rejectedVerification(
      "Target verification challenge is outside its freshness window.",
    );
  }
  if (
    checkedAt > now ||
    now - checkedAt > TARGET_VERIFICATION_FRESHNESS_MS
  ) {
    return rejectedVerification(
      "Target verification evidence is outside its freshness window.",
    );
  }
  return { accepted: true, result: result.data };
}
