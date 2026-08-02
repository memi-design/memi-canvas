import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import {
  ApprovalReceiptSchema,
  ApprovalReceiptIdSchema,
  CanvasOperationSchema,
  CapabilityGrantIdSchema,
  CapabilityGrantSchema,
  LeaseIdSchema,
  LeaseSchema,
  OutboxRecordSchema,
  ProjectIdSchema,
  RecoveryAttemptIdSchema,
  RunIdSchema,
  TargetApplyOutcomeSchema,
  TargetFenceActivationResultSchema,
  TargetVerificationResultSchema,
  TraceEventIdSchema,
  computeTrustedAuthorityBatchRoot,
  type CanvasOperation,
  type DurableCommand,
  type TargetApplyOutcome,
  type TargetEffectRequest,
  type TargetFenceActivationRequest,
  type TargetFenceActivationResult,
  type TargetLookupRequest,
  type TargetLookupResult,
  type TargetReceipt,
  type TargetVerificationRequest,
  type TargetVerificationResult,
} from "../../protocol/src/index.js";

import {
  lookupResultFor,
  receiptFor,
} from "./canvas-effect-test-fixtures.js";
import {
  DurableRuntime,
  bindCommandAction,
  type CanvasTargetAdapter,
  type EffectExecutor,
} from "./index.js";
import { RUNTIME_SCHEMA_V2 } from "./schema.js";
import {
  MutableClock,
  PROJECT_ID,
  TASK_ID,
  alternateOutboxId,
  contentHash,
  durableCommand,
  sortableId,
} from "./test-fixtures.js";

const temporaryDirectories: string[] = [];

function trustRoot() {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyDer = pair.publicKey.export({
    format: "der",
    type: "spki",
  });
  return Object.freeze({
    keyId: "human-root-key",
    trustRootId: "local-human-approval-root",
    fingerprint:
      `sha256:${createHash("sha256")
        .update(publicKeyDer)
        .digest("hex")}` as const,
    publicKeyPem: pair.publicKey
      .export({ format: "pem", type: "spki" })
      .toString(),
    sign(payload: object) {
      return sign(
        null,
        Buffer.from(canonicalJson(payload)),
        pair.privateKey,
      ).toString("base64");
    },
  });
}

export const TRUST_ROOT = trustRoot();
export const ALTERNATE_ROOT = trustRoot();

export function databasePath(prefix = "memi-trusted-authority-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

export function cleanupAuthorityFixtures(): void {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function operation(
  suffix: string,
  documentSuffix = suffix,
): CanvasOperation {
  return CanvasOperationSchema.parse({
    schemaVersion: 1,
    id: sortableId("opn", suffix),
    documentId: sortableId("doc", documentSuffix),
    actorId: "import-runtime",
    occurredAt: "2026-07-28T12:00:00.000Z",
    actionDigest: contentHash("d"),
    expectedBeforeHash: contentHash("a"),
    resultingHash: contentHash("b"),
    type: "node.create",
    payload: {
      node: {
        id: sortableId("nod", suffix),
        kind: "draft-frame",
        authority: "canvas-document",
        evidenceLevel: "proposed",
        coverageHealth: "partial",
        parentId: null,
        position: { x: 0, y: 0 },
        size: { width: 320, height: 640 },
      },
    },
  });
}

export function canvasCommandDraft(
  suffix: string,
  runId = sortableId("run", suffix),
  documentSuffix = suffix,
  projectId = PROJECT_ID,
): {
  readonly command: DurableCommand;
  readonly payload: CanvasOperation;
} {
  const payload = operation(suffix, documentSuffix);
  return {
    payload,
    command: bindCommandAction(
      durableCommand({
        id: sortableId("cmd", suffix),
        projectId: ProjectIdSchema.parse(projectId),
        taskId: TASK_ID,
        runId: RunIdSchema.parse(runId),
        issuerId: "import-runtime",
        idempotencyKey: sortableId("idem", suffix),
        target: {
          kind: "canvas-document",
          id: payload.documentId,
          expectedBeforeHash: payload.expectedBeforeHash,
          baseline: {
            kind: "canvas-revision",
            revision: 0,
            stateHash: payload.expectedBeforeHash,
          },
        },
        authority: {
          capabilityGrantId: sortableId("grt", "Z"),
          approvalReceiptId: sortableId("apr", "Z"),
          leaseId: LeaseIdSchema.parse(
            sortableId("lse", documentSuffix),
          ),
          fencingEpoch: 1,
        },
      }),
      payload,
    ),
  };
}

export function reviewedContext(
  command: DurableCommand,
  payload: CanvasOperation,
  overrides: {
    readonly workspaceDigest?: `sha256:${string}`;
    readonly planDigest?: `sha256:${string}`;
  } = {},
) {
  const workspaceDigest =
    overrides.workspaceDigest ?? contentHash("w");
  const planDigest = overrides.planDigest ?? contentHash("p");
  return Object.freeze({
    workspaceDigest,
    planDigest,
    batchRootDigest: computeTrustedAuthorityBatchRoot({
      schemaVersion: 1,
      kind: "memi-import-authority-batch-root",
      projectId: command.projectId,
      documentId: payload.documentId,
      workspaceDigest,
      planDigest,
      operations: [
        {
          ordinal: 0,
          operationId: payload.id,
          actionDigest: payload.actionDigest,
        },
      ],
    }),
  });
}

class ForbiddenExecutor implements EffectExecutor {
  async execute(): Promise<never> {
    throw new Error("Generic executor must not run.");
  }
}

export class TargetMutationProbe implements CanvasTargetAdapter {
  readonly #receipts = new Map<string, TargetReceipt>();
  applyCalls = 0;
  lookupCalls = 0;

  activateFence(
    request: TargetFenceActivationRequest,
  ): TargetFenceActivationResult {
    return TargetFenceActivationResultSchema.parse({
      ...request,
      status: "activated",
      highestFence: request.fencingEpoch,
    });
  }

  compareAndApply(
    request: TargetEffectRequest,
  ): TargetApplyOutcome {
    this.applyCalls += 1;
    const receipt = receiptFor(request);
    this.#receipts.set(request.commandId, receipt);
    return TargetApplyOutcomeSchema.parse({
      schemaVersion: 1,
      status: "applied",
      receipt,
    });
  }

  lookup(request: TargetLookupRequest): TargetLookupResult {
    this.lookupCalls += 1;
    return lookupResultFor(request, {
      status: "not-found",
      currentTargetHash: request.expectedBeforeHash,
    });
  }

  verify(
    request: TargetVerificationRequest,
  ): TargetVerificationResult {
    const receipt = this.#receipts.get(request.commandId);
    if (receipt === undefined) {
      throw new Error("No target receipt exists.");
    }
    const material = {
      schemaVersion: 1,
      status: "verified-applied",
      receipt,
      currentTargetHash: receipt.resultingHash,
      requestDigest: request.requestDigest,
      checkedAt: "2026-07-28T12:00:00.000Z",
    } as const;
    return TargetVerificationResultSchema.parse({
      ...material,
      evidenceHash: hashCanonicalValue(material),
    });
  }
}

export function runtime(
  path: string,
  clock: MutableClock,
  roots: readonly {
    readonly trustRootId: string;
    readonly keyId: string;
    readonly publicKeyPem: string;
  }[] = [TRUST_ROOT],
  target: CanvasTargetAdapter = new TargetMutationProbe(),
): DurableRuntime {
  return new DurableRuntime({
    databasePath: path,
    clock: clock.now,
    canvasTarget: target,
    effectExecutor: new ForbiddenExecutor(),
    effectVerifier: {
      verify: () => {
        throw new Error("Legacy verifier must never run for canvas.");
      },
    },
    recoveryChallengeFactory: () => ({
      id: RecoveryAttemptIdSchema.parse(sortableId("rcv", "A")),
      nonce: "a".repeat(43),
    }),
    traceEventIdFactory: () =>
      TraceEventIdSchema.parse(sortableId("evt", "A")),
    approvalTrustRoots: roots.map((root) => ({
      id: root.trustRootId,
      keys: [
        {
          keyId: root.keyId,
          publicKeyPem: root.publicKeyPem,
        },
      ],
    })),
  } as unknown as ConstructorParameters<typeof DurableRuntime>[0] & {
    readonly approvalTrustRoots: readonly unknown[];
  });
}

export async function activateLease(
  instance: DurableRuntime,
  command: DurableCommand,
  ttlMilliseconds = 10 * 60_000,
) {
  const lease = instance.acquireLease({
    leaseId: command.authority.leaseId,
    projectId: command.projectId,
    targetId: command.target.id,
    holderId: command.issuerId,
    ttlMilliseconds,
  });
  return instance.activateCanvasLease({
    projectId: lease.projectId,
    targetId: lease.targetId,
    leaseId: lease.id,
    fencingEpoch: lease.fencingEpoch,
  });
}

export async function reserveAuthority(
  instance: DurableRuntime,
  draft: {
    readonly command: DurableCommand;
    readonly payload: CanvasOperation;
  },
  context = reviewedContext(draft.command, draft.payload),
) {
  return instance.reserveTrustedCommandAuthority({
    schemaVersion: 1,
    kind: "trusted-command-authority-reservation-request",
    projectId: draft.command.projectId,
    issuerId: draft.command.issuerId,
    commandId: draft.command.id,
    operationId: draft.payload.id,
    target: draft.command.target,
    requiredCapabilities: ["canvas:apply"],
    leaseId: draft.command.authority.leaseId,
    fencingEpoch: draft.command.authority.fencingEpoch,
    commandDraft: draft.command,
    reviewedContext: context,
  });
}

export function finalCommand(
  draft: {
    readonly command: DurableCommand;
    readonly payload: CanvasOperation;
  },
  reservation: {
    readonly grantId: string;
    readonly approvalId: string;
  },
): DurableCommand {
  return bindCommandAction(
    {
      ...draft.command,
      authority: {
        ...draft.command.authority,
        capabilityGrantId: CapabilityGrantIdSchema.parse(
          reservation.grantId,
        ),
        approvalReceiptId: ApprovalReceiptIdSchema.parse(
          reservation.approvalId,
        ),
      },
    },
    draft.payload,
  );
}

export function signedIssuance(
  command: DurableCommand,
  payload: CanvasOperation,
  reservation: {
    readonly id: string;
    readonly requestDigest: string;
    readonly challenge: string;
    readonly grantId: string;
    readonly approvalId: string;
  },
  options: {
    readonly signer?: typeof TRUST_ROOT;
    readonly overrides?: Record<string, unknown>;
    readonly signatureOverride?: string;
  } = {},
) {
  const signer = options.signer ?? TRUST_ROOT;
  const unsigned = {
    schemaVersion: 1,
    kind: "trusted-command-authority-issuance",
    reservationId: reservation.id,
    reservationRequestDigest: reservation.requestDigest,
    challenge: reservation.challenge,
    grantId: reservation.grantId,
    approvalId: reservation.approvalId,
    projectId: command.projectId,
    issuerId: command.issuerId,
    commandId: command.id,
    operationId: payload.id,
    target: command.target,
    actionDigest: command.actionDigest,
    requiredCapabilities: command.requiredCapabilities,
    leaseId: command.authority.leaseId,
    fencingEpoch: command.authority.fencingEpoch,
    approver: {
      kind: "human",
      id: "local-user",
      keyId: signer.keyId,
    },
    trustRootId: signer.trustRootId,
    trustRootFingerprint: signer.fingerprint,
    reviewedContext: reviewedContext(command, payload),
    consequence: "Apply the reviewed import batch.",
    issuedAt: "2026-07-28T12:00:00.000Z",
    expiresAt: "2026-07-28T12:05:00.000Z",
    maximumUses: 1,
    ...options.overrides,
  };
  return {
    ...unsigned,
    signatureAlgorithm: "ed25519" as const,
    signature:
      options.signatureOverride ?? signer.sign(unsigned),
  };
}

export async function authorizeAndQueue(
  instance: DurableRuntime,
  draft: {
    readonly command: DurableCommand;
    readonly payload: CanvasOperation;
  },
  context = reviewedContext(draft.command, draft.payload),
) {
  const reservation = await reserveAuthority(
    instance,
    draft,
    context,
  );
  const command = finalCommand(draft, reservation);
  const issued = await instance.issueTrustedCommandAuthority(
    signedIssuance(command, draft.payload, reservation, {
      overrides: { reviewedContext: context },
    }),
  );
  const accepted = instance.submitCommand({
    command,
    outboxId: alternateOutboxId(command.id.slice(-1)),
    effectPayload: draft.payload,
  });
  return { accepted, command, issued, reservation };
}

export function rawLegacyAuthority(command: DurableCommand) {
  return {
    grant: CapabilityGrantSchema.parse({
      schemaVersion: 1,
      id: command.authority.capabilityGrantId,
      projectId: command.projectId,
      clientId: command.issuerId,
      capabilities: command.requiredCapabilities,
      constraints: {
        canonicalPaths: [],
        allowedHosts: [],
        actionDigest: command.actionDigest,
        maximumUses: 1,
      },
      issuedAt: "2026-07-28T12:00:00.000Z",
      expiresAt: "2026-07-28T12:05:00.000Z",
    }),
    approval: ApprovalReceiptSchema.parse({
      schemaVersion: 1,
      id: command.authority.approvalReceiptId!,
      projectId: command.projectId,
      approver: { kind: "human", id: "caller-authored" },
      target: command.target,
      actionDigest: command.actionDigest,
      capabilities: command.requiredCapabilities,
      consequence: "Caller-authored approval.",
      issuedAt: "2026-07-28T12:00:00.000Z",
      expiresAt: "2026-07-28T12:05:00.000Z",
      maximumUses: 1,
    }),
  };
}

export function seedMigratedLegacyPendingCommand(
  path: string,
  clock: MutableClock,
  draft = canvasCommandDraft("V"),
): {
  readonly command: DurableCommand;
  readonly payload: CanvasOperation;
  readonly outboxId: ReturnType<typeof alternateOutboxId>;
  readonly claim: {
    readonly id: string;
    readonly commandId: DurableCommand["id"];
    readonly outboxId: ReturnType<typeof alternateOutboxId>;
    readonly workerId: string;
    readonly fencingEpoch: number;
    readonly expiresAt: string;
  };
} {
  const command = draft.command;
  const raw = rawLegacyAuthority(command);
  const outboxId = alternateOutboxId("V");
  const outbox = OutboxRecordSchema.parse({
    schemaVersion: 1,
    id: outboxId,
    commandId: command.id,
    projectId: command.projectId,
    idempotencyKey: command.idempotencyKey,
    actionDigest: command.actionDigest,
    phase: "intent",
    effect: {
      kind: command.kind,
      targetId: command.target.id,
      expectedBeforeHash: command.target.expectedBeforeHash,
      payloadHash: command.payloadHash,
    },
    createdAt: command.issuedAt,
  });
  const lease = LeaseSchema.parse({
    schemaVersion: 1,
    id: command.authority.leaseId,
    projectId: command.projectId,
    targetId: command.target.id,
    holderId: command.issuerId,
    fencingEpoch: command.authority.fencingEpoch,
    acquiredAt: command.issuedAt,
    expiresAt: "2026-07-28T12:10:00.000Z",
  });
  const legacy = new DatabaseSync(path);
  legacy.exec(RUNTIME_SCHEMA_V2);
  legacy
    .prepare(
      `INSERT INTO capability_grants
        (id, project_id, grant_json) VALUES (?, ?, ?)`,
    )
    .run(
      raw.grant.id,
      raw.grant.projectId,
      canonicalJson(raw.grant),
    );
  legacy
    .prepare(
      `INSERT INTO approval_receipts
        (id, project_id, receipt_json) VALUES (?, ?, ?)`,
    )
    .run(
      raw.approval.id,
      raw.approval.projectId,
      canonicalJson(raw.approval),
    );
  legacy
    .prepare(
      `INSERT INTO leases (
        id, project_id, target_id, holder_id, fencing_epoch,
        acquired_at, expires_at, lease_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      lease.id,
      lease.projectId,
      lease.targetId,
      lease.holderId,
      lease.fencingEpoch,
      lease.acquiredAt,
      lease.expiresAt,
      canonicalJson(lease),
    );
  legacy
    .prepare(
      `INSERT INTO commands (
        id, project_id, idempotency_key, action_digest, grant_id,
        approval_id, state, command_json, effect_payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, 'intent', ?, ?)`,
    )
    .run(
      command.id,
      command.projectId,
      command.idempotencyKey,
      command.actionDigest,
      raw.grant.id,
      raw.approval.id,
      canonicalJson(command),
      canonicalJson(draft.payload),
    );
  legacy
    .prepare(
      `INSERT INTO outbox
        (id, command_id, phase, record_json)
       VALUES (?, ?, 'intent', ?)`,
    )
    .run(outbox.id, command.id, canonicalJson(outbox));
  legacy.exec("PRAGMA user_version = 2");
  legacy.close();

  const migrated = runtime(path, clock);
  migrated.close();
  const current = new DatabaseSync(path);
  current
    .prepare(
      `UPDATE leases
       SET phase = 'active', target_activated_at = ?,
           activated_at = ?, activation_json = ?
       WHERE id = ?`,
    )
    .run(
      command.issuedAt,
      command.issuedAt,
      canonicalJson({ kind: "legacy-migration-fixture" }),
      lease.id,
    );
  current.close();
  return {
    command,
    payload: draft.payload,
    outboxId,
    claim: {
      id: "legacy-migrated-claim",
      commandId: command.id,
      outboxId,
      workerId: "legacy-migrated-worker",
      fencingEpoch: 1,
      expiresAt: "2026-07-28T12:01:00.000Z",
    },
  };
}
