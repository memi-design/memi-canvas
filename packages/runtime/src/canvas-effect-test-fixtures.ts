import { hashCanonicalValue } from "@memi/canonical-json";
import {
  TargetReceiptHashMaterialSchema,
  TargetReceiptSchema,
  TargetLookupResultSchema,
  type TargetEffectRequest,
  type TargetReceipt,
  type TargetLookupRequest,
  type TargetLookupResult,
} from "../../protocol/src/index.js";

export function lookupResultFor(
  request: TargetLookupRequest,
  configured: Record<string, unknown>,
): TargetLookupResult {
  const {
    evidenceHash: _evidenceHash,
    requestDigest: _requestDigest,
    checkedAt: _checkedAt,
    ...fields
  } = configured;
  const material = {
    schemaVersion: 1,
    ...fields,
    requestDigest: request.requestDigest,
    checkedAt: request.challenge.issuedAt,
  };
  return TargetLookupResultSchema.parse({
    ...material,
    evidenceHash: hashCanonicalValue(material),
  });
}

export function receiptFor(
  request: TargetEffectRequest,
): TargetReceipt {
  const material = TargetReceiptHashMaterialSchema.parse({
    schemaVersion: 1,
    adapterContractVersion: 1,
    projectId: request.projectId,
    taskId: request.taskId,
    runId: request.runId,
    commandId: request.commandId,
    outboxId: request.outboxId,
    target: {
      kind: "canvas-document",
      id: request.target.id,
    },
    idempotencyKey: request.idempotencyKey,
    commandActionDigest: request.commandActionDigest,
    operationActionDigest: request.operationActionDigest,
    payloadHash: request.payloadHash,
    expectedBeforeHash: request.target.expectedBeforeHash,
    resultingHash: request.payload.resultingHash,
    leaseId: request.lease.id,
    leaseHolderId: request.lease.holderId,
    fencingEpoch: request.lease.fencingEpoch,
    workerClaimId: request.workerClaim.id,
    workerClaimFencingEpoch: request.workerClaim.fencingEpoch,
    operationId: request.payload.id,
    appliedRevision: 2,
    appliedAt: "2026-07-28T12:00:00.000Z",
  });
  return TargetReceiptSchema.parse({
    ...material,
    receiptHash: hashCanonicalValue(material),
  });
}
