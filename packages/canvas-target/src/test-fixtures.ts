import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { hashCanonicalValue } from "@memi/canonical-json";
import {
  createCanvasDocument,
  prepareNodeCreateOperation,
  type CanvasDocument,
  type CanvasOperation,
} from "@memi/canvas-document";
import {
  TargetEffectRequestSchema,
  TargetLookupRequestSchema,
  TargetVerificationRequestSchema,
  type TargetEffectRequest,
  type TargetFenceActivationRequest,
  type TargetLookupRequest,
  type TargetReceipt,
  type TargetVerificationRequest,
} from "@memi/protocol";

const temporaryDirectories: string[] = [];
const idBody = "01J00000000000000000000000";
export const ids = {
  project: `prj_${idBody}`,
  task: `tsk_${idBody}`,
  run: `run_${idBody}`,
  document: `doc_${idBody}`,
  grant: `grt_${idBody}`,
  approval: `apr_${idBody}`,
} as const;
export const NOW = "2026-07-28T12:00:00.000Z";

type NodeCreateOperation = Extract<
  CanvasOperation,
  { readonly type: "node.create" }
>;
type CanvasCreateRequest = TargetEffectRequest & {
  readonly payload: NodeCreateOperation;
};

export function sortableId(
  prefix: string,
  suffix: string,
): string {
  return `${prefix}_${"0".repeat(25)}${suffix}`;
}

export function databasePath(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-canvas-target-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "canvas-target.sqlite");
}

export function documentFixture(): CanvasDocument {
  return createCanvasDocument({
    id: ids.document,
    projectId: ids.project,
  });
}

export function operationFor(
  document: CanvasDocument,
  suffix: string,
  nodeSuffix = suffix,
): NodeCreateOperation {
  return prepareNodeCreateOperation(document, {
    id: sortableId("opn", suffix),
    actorId: "issuer-agent",
    occurredAt: NOW,
    node: {
      id: sortableId("nod", nodeSuffix),
      kind: "draft-frame",
      authority: "canvas-document",
      evidenceLevel: "proposed",
      coverageHealth: "current",
      parentId: null,
      position: { x: Number.parseInt(suffix, 16) || 0, y: 0 },
      size: { width: 320, height: 240 },
    },
  }) as NodeCreateOperation;
}

export function requestFor(
  document: CanvasDocument,
  operation: NodeCreateOperation,
  suffix: string,
  overrides: {
    readonly idempotencySuffix?: string;
    readonly commandActionDigest?: string;
    readonly leaseId?: string;
    readonly fencingEpoch?: number;
  } = {},
): CanvasCreateRequest {
  return TargetEffectRequestSchema.parse({
    schemaVersion: 1,
    effectKind: "canvas.operation",
    projectId: ids.project,
    taskId: ids.task,
    runId: ids.run,
    issuerId: "issuer-agent",
    commandId: sortableId("cmd", suffix),
    outboxId: sortableId("obx", suffix),
    target: {
      kind: "canvas-document",
      id: document.id,
      expectedBeforeHash: document.stateHash,
      baseline: {
        kind: "canvas-revision",
        revision: document.revision,
        stateHash: document.stateHash,
      },
    },
    idempotencyKey: sortableId(
      "idem",
      overrides.idempotencySuffix ?? suffix,
    ),
    commandActionDigest:
      overrides.commandActionDigest ??
      hashCanonicalValue({
        command: suffix,
        operation: operation.actionDigest,
      }),
    operationActionDigest: operation.actionDigest,
    payloadHash: hashCanonicalValue(operation),
    payload: operation,
    capabilityGrantId: ids.grant,
    approvalReceiptId: ids.approval,
    lease: {
      id: overrides.leaseId ?? sortableId("lse", "1"),
      holderId: "issuer-agent",
      fencingEpoch: overrides.fencingEpoch ?? 1,
    },
    workerClaim: {
      id: `worker-claim-${suffix}`,
      fencingEpoch: 1,
      expiresAt: "2026-07-28T12:05:00.000Z",
    },
  }) as CanvasCreateRequest;
}

export function fenceFor(
  request: TargetEffectRequest,
): TargetFenceActivationRequest {
  return {
    schemaVersion: 1,
    projectId: request.projectId,
    target: {
      kind: request.target.kind,
      id: request.target.id,
    },
    leaseId: request.lease.id,
    holderId: request.lease.holderId,
    fencingEpoch: request.lease.fencingEpoch,
  };
}

export function lookupFor(
  request: TargetEffectRequest,
): TargetLookupRequest {
  const material = {
    schemaVersion: 1,
    projectId: request.projectId,
    target: request.target,
    idempotencyKey: request.idempotencyKey,
    commandId: request.commandId,
    commandActionDigest: request.commandActionDigest,
    operationActionDigest: request.operationActionDigest,
    expectedBeforeHash: request.target.expectedBeforeHash,
    challenge: {
      id: sortableId("rcv", "1"),
      nonce: "a".repeat(43),
      issuedAt: NOW,
    },
  };
  return TargetLookupRequestSchema.parse({
    ...material,
    requestDigest: hashCanonicalValue(material),
  });
}

export function verificationFor(
  request: TargetEffectRequest,
  receipt: TargetReceipt,
): TargetVerificationRequest {
  const material = {
    schemaVersion: 1,
    projectId: request.projectId,
    target: request.target,
    idempotencyKey: request.idempotencyKey,
    commandId: request.commandId,
    commandActionDigest: request.commandActionDigest,
    operationActionDigest: request.operationActionDigest,
    expectedBeforeHash: request.target.expectedBeforeHash,
    expectedResultingHash: receipt.resultingHash,
    expectedReceiptHash: receipt.receiptHash,
    challenge: {
      id: sortableId("rcv", "2"),
      nonce: "b".repeat(43),
      issuedAt: NOW,
    },
  };
  return TargetVerificationRequestSchema.parse({
    ...material,
    requestDigest: hashCanonicalValue(material),
  });
}

export function tableCounts(
  path: string,
): Record<string, number> {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return Object.fromEntries(
      [
        "documents",
        "target_fences",
        "operations",
        "receipts",
        "idempotency_ledger",
      ].map((table) => {
        const row = database
          .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
          .get() as { readonly count: number };
        return [table, Number(row.count)];
      }),
    );
  } finally {
    database.close();
  }
}

export function cleanupTemporaryDirectories(): void {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}
