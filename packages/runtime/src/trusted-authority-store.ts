import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
  type KeyObject,
} from "node:crypto";

import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import {
  ApprovalReceiptSchema,
  CapabilityGrantSchema,
  CanvasOperationSchema,
  RuntimeIssuedCommandAuthoritySchema,
  TrustedCommandAuthorityIssuanceSchema,
  TrustedCommandAuthorityReservationRequestSchema,
  TrustedCommandAuthorityReservationSchema,
  type CanvasOperation,
  type DurableCommand,
  type RuntimeIssuedCommandAuthority,
  type TrustedCommandAuthorityIssuance,
  type TrustedCommandAuthorityReservation,
} from "../../protocol/src/index.js";

import { RuntimeDatabase, type SqlRow } from "./database.js";
import { AuthorizationError } from "./errors.js";
import { computeCommandActionDigest } from "./digests.js";
import { LeaseStore } from "./lease-store.js";
import { parsed, rowText } from "./runtime-records.js";
import type { ApprovalTrustRoot } from "./types.js";

const OPAQUE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RESERVATION_TTL_MILLISECONDS = 5 * 60_000;
const IMPORT_AUTHORITY_PRINCIPAL_ID = "import-runtime";
const IMPORT_OPERATION_ACTOR_ID = "memi-import-pipeline";

interface TrustedKey {
  readonly approverId: string;
  readonly consequence: string;
  readonly keyId: string;
  readonly publicKey: KeyObject;
  readonly fingerprint: `sha256:${string}`;
  readonly trustRootId: string;
}

function opaqueId(prefix: "apr" | "grt" | "rsv"): string {
  let value = BigInt(`0x${randomBytes(16).toString("hex")}`);
  let body = "";
  for (let index = 0; index < 26; index += 1) {
    body = OPAQUE_ALPHABET[Number(value & 31n)] + body;
    value >>= 5n;
  }
  return `${prefix}_${body}`;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function assertedCanvasOperation(
  command: DurableCommand,
  effectPayload: unknown,
  allowInvalidLegacyCanvasPayload: boolean,
): CanvasOperation | undefined {
  if (
    effectPayload === undefined ||
    command.kind !== "canvas.operation"
  ) {
    return undefined;
  }
  const parsedOperation =
    CanvasOperationSchema.safeParse(effectPayload);
  if (!parsedOperation.success) {
    if (
      allowInvalidLegacyCanvasPayload &&
      command.issuerId !== IMPORT_AUTHORITY_PRINCIPAL_ID &&
      command.issuerId !== IMPORT_OPERATION_ACTOR_ID
    ) {
      return undefined;
    }
    throw new AuthorizationError(
      "TRUSTED_AUTHORITY_OPERATION_INVALID",
      "Platform canvas commands require a valid canvas operation.",
    );
  }
  const operation = parsedOperation.data;
  const directActor = operation.actorId === command.issuerId;
  const trustedImportActor =
    command.issuerId === IMPORT_AUTHORITY_PRINCIPAL_ID &&
    operation.actorId === IMPORT_OPERATION_ACTOR_ID;
  const signedImportSelfAuthored =
    command.issuerId === IMPORT_AUTHORITY_PRINCIPAL_ID &&
    operation.actorId === IMPORT_AUTHORITY_PRINCIPAL_ID;
  const usesReservedImportIdentity = [
    command.issuerId,
    operation.actorId,
  ].some(
    (identity) =>
      identity === IMPORT_AUTHORITY_PRINCIPAL_ID ||
      identity === IMPORT_OPERATION_ACTOR_ID,
  );
  if (
    !trustedImportActor &&
    !signedImportSelfAuthored &&
    (!directActor || usesReservedImportIdentity)
  ) {
    throw new AuthorizationError(
      "TRUSTED_AUTHORITY_ACTOR_MISMATCH",
      "Canvas operation actor does not match a direct or trusted import authority identity.",
    );
  }
  return operation;
}

function unsignedIssuance(
  issuance: TrustedCommandAuthorityIssuance,
): object {
  const {
    signature: _signature,
    signatureAlgorithm: _algorithm,
    ...unsigned
  } = issuance;
  return unsigned;
}

function parseTrustedKey(
  root: ApprovalTrustRoot,
  key: ApprovalTrustRoot["keys"][number],
): TrustedKey {
  const publicKey = createPublicKey(key.publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("Trusted approval keys must be Ed25519 SPKI keys.");
  }
  const der = publicKey.export({ format: "der", type: "spki" });
  return {
    approverId: key.approverId ?? "local-user",
    consequence:
      root.consequence ?? "Apply the reviewed import batch.",
    keyId: key.keyId,
    publicKey,
    fingerprint:
      `sha256:${createHash("sha256").update(der).digest("hex")}`,
    trustRootId: root.id,
  };
}

function trustKeyId(rootId: string, keyId: string): string {
  return canonicalJson([rootId, keyId]);
}

export class TrustedAuthorityStore {
  readonly #clock: () => string;
  readonly #database: RuntimeDatabase;
  readonly #keys: ReadonlyMap<string, TrustedKey>;
  readonly #leases: LeaseStore;
  readonly #allowInvalidLegacyCanvasPayload: boolean;

  constructor(
    database: RuntimeDatabase,
    leases: LeaseStore,
    clock: () => string,
    roots: readonly ApprovalTrustRoot[],
    allowInvalidLegacyCanvasPayload = false,
  ) {
    this.#database = database;
    this.#leases = leases;
    this.#clock = clock;
    this.#allowInvalidLegacyCanvasPayload =
      allowInvalidLegacyCanvasPayload;
    const keys = new Map<string, TrustedKey>();
    for (const root of roots) {
      if (root.id.trim().length === 0 || root.keys.length === 0) {
        throw new TypeError("Trusted approval roots require an id and keys.");
      }
      for (const key of root.keys) {
        const id = trustKeyId(root.id, key.keyId);
        if (keys.has(id)) {
          throw new TypeError("Trusted approval root keys must be unique.");
        }
        keys.set(id, parseTrustedKey(root, key));
      }
    }
    this.#keys = keys;
  }

  async reserve(input: unknown): Promise<TrustedCommandAuthorityReservation> {
    const request =
      TrustedCommandAuthorityReservationRequestSchema.parse(input);
    const lease = this.#leases.assert({
      projectId: request.projectId,
      targetId: request.target.id,
      leaseId: request.leaseId,
      fencingEpoch: request.fencingEpoch,
    });
    if (lease.holderId !== request.issuerId) {
      throw new AuthorizationError(
        "TRUSTED_AUTHORITY_LEASE_MISMATCH",
        "Trusted authority reservation issuer does not hold the lease.",
      );
    }
    const now = this.#clock();
    return this.#database.transaction(() => {
      const existing = this.#database.one(
        `SELECT request_json, reservation_json
         FROM trusted_authority_reservations
         WHERE command_id = ?`,
        request.commandId,
      );
      if (existing !== undefined) {
        const recordedRequest =
          TrustedCommandAuthorityReservationRequestSchema.parse(
            parsed(existing.request_json),
          );
        const reservation =
          TrustedCommandAuthorityReservationSchema.parse(
            parsed(existing.reservation_json),
          );
        if (!canonicalEqual(recordedRequest, request)) {
          throw new AuthorizationError(
            "TRUSTED_AUTHORITY_RESERVATION_CONFLICT",
            "Command authority reservation is immutable.",
          );
        }
        this.#assertActiveReservation(reservation, now);
        return reservation;
      }
      const expiresAt = new Date(
        Math.min(
          Date.parse(now) + RESERVATION_TTL_MILLISECONDS,
          Date.parse(lease.expiresAt),
        ),
      ).toISOString();
      const reservation =
        TrustedCommandAuthorityReservationSchema.parse({
          schemaVersion: 1,
          kind: "trusted-command-authority-reservation",
          id: opaqueId("rsv"),
          requestDigest: hashCanonicalValue(request),
          challenge: randomBytes(32).toString("base64url"),
          grantId: opaqueId("grt"),
          approvalId: opaqueId("apr"),
          projectId: request.projectId,
          commandId: request.commandId,
          operationId: request.operationId,
          target: request.target,
          leaseId: request.leaseId,
          fencingEpoch: request.fencingEpoch,
          reviewedContext: request.reviewedContext,
          reservedAt: now,
          expiresAt,
        });
      this.#database.run(
        `INSERT INTO trusted_authority_reservations (
          id, request_digest, project_id, command_id, operation_id,
          lease_id, fencing_epoch, state, expires_at, request_json,
          reservation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)`,
        reservation.id,
        reservation.requestDigest,
        reservation.projectId,
        reservation.commandId,
        reservation.operationId,
        reservation.leaseId,
        reservation.fencingEpoch,
        reservation.expiresAt,
        canonicalJson(request),
        canonicalJson(reservation),
      );
      return reservation;
    });
  }

  async issue(input: unknown): Promise<RuntimeIssuedCommandAuthority> {
    const issuance = TrustedCommandAuthorityIssuanceSchema.parse(input);
    return this.#database.transaction(() => {
      const row = this.#database.one(
        `SELECT request_json, reservation_json
         FROM trusted_authority_reservations WHERE id = ?`,
        issuance.reservationId,
      );
      if (row === undefined) {
        throw new AuthorizationError(
          "TRUSTED_AUTHORITY_RESERVATION_MISSING",
          "Trusted authority reservation is missing.",
        );
      }
      const request =
        TrustedCommandAuthorityReservationRequestSchema.parse(
          parsed(row.request_json),
        );
      const reservation =
        TrustedCommandAuthorityReservationSchema.parse(
          parsed(row.reservation_json),
        );
      this.#validateIssuance(issuance, request, reservation);
      const existing = this.#database.one(
        `SELECT issuance_digest, authority_json
         FROM trusted_command_authorities
         WHERE reservation_id = ?`,
        reservation.id,
      );
      const issuanceDigest = hashCanonicalValue(issuance);
      if (existing !== undefined) {
        if (rowText(existing, "issuance_digest") !== issuanceDigest) {
          throw new AuthorizationError(
            "TRUSTED_AUTHORITY_IMMUTABLE_CONFLICT",
            "Issued trusted authority cannot be replaced.",
          );
        }
        return RuntimeIssuedCommandAuthoritySchema.parse(
          parsed(existing.authority_json),
        );
      }
      const grant = CapabilityGrantSchema.parse({
        schemaVersion: 1,
        id: reservation.grantId,
        projectId: issuance.projectId,
        clientId: issuance.issuerId,
        capabilities: issuance.requiredCapabilities,
        constraints: {
          canonicalPaths: [],
          allowedHosts: [],
          actionDigest: issuance.actionDigest,
          maximumUses: 1,
        },
        issuedAt: issuance.issuedAt,
        expiresAt: issuance.expiresAt,
      });
      const approval = ApprovalReceiptSchema.parse({
        schemaVersion: 1,
        id: reservation.approvalId,
        projectId: issuance.projectId,
        approver: {
          kind: "human",
          id: issuance.approver.id,
        },
        target: issuance.target,
        actionDigest: issuance.actionDigest,
        capabilities: issuance.requiredCapabilities,
        consequence: issuance.consequence,
        issuedAt: issuance.issuedAt,
        expiresAt: issuance.expiresAt,
        maximumUses: 1,
      });
      const issued = RuntimeIssuedCommandAuthoritySchema.parse({
        schemaVersion: 1,
        kind: "runtime-issued-command-authority",
        reservation,
        issuanceDigest,
        grant,
        approval,
        leaseId: issuance.leaseId,
        fencingEpoch: issuance.fencingEpoch,
        trustRootId: issuance.trustRootId,
        trustRootFingerprint: issuance.trustRootFingerprint,
        reviewedContext: issuance.reviewedContext,
        signatureAlgorithm: issuance.signatureAlgorithm,
        signature: issuance.signature,
      });
      this.#persistIssued(issuance, issued);
      return issued;
    });
  }

  assertCommand(
    command: DurableCommand,
    effectPayload?: unknown,
  ): RuntimeIssuedCommandAuthority | undefined {
    const operation = assertedCanvasOperation(
      command,
      effectPayload,
      this.#allowInvalidLegacyCanvasPayload,
    );
    if (command.issuerId !== IMPORT_AUTHORITY_PRINCIPAL_ID) {
      return undefined;
    }
    const row = this.#database.one(
      `SELECT authority_json, issuance_json
       FROM trusted_command_authorities WHERE command_id = ?`,
      command.id,
    );
    if (row === undefined) {
      throw new AuthorizationError(
        "TRUSTED_AUTHORITY_REQUIRED",
        "Import-runtime commands require trusted reservation lineage.",
      );
    }
    const issuance = TrustedCommandAuthorityIssuanceSchema.parse(
      parsed(row.issuance_json),
    );
    const issued = RuntimeIssuedCommandAuthoritySchema.parse(
      parsed(row.authority_json),
    );
    this.#assertConfiguredTrust(issuance);
    this.#assertIssuanceTime(issuance, issued.reservation);
    this.#leases.assert({
      projectId: command.projectId,
      targetId: command.target.id,
      leaseId: command.authority.leaseId,
      fencingEpoch: command.authority.fencingEpoch,
    });
    const exactCommand =
      issuance.commandId === command.id &&
      issuance.projectId === command.projectId &&
      issuance.issuerId === command.issuerId &&
      issuance.actionDigest === command.actionDigest &&
      issuance.grantId === command.authority.capabilityGrantId &&
      issuance.approvalId === command.authority.approvalReceiptId &&
      issuance.leaseId === command.authority.leaseId &&
      issuance.fencingEpoch === command.authority.fencingEpoch &&
      canonicalEqual(issuance.target, command.target) &&
      canonicalEqual(
        issuance.requiredCapabilities,
        command.requiredCapabilities,
      );
    if (!exactCommand) {
      throw new AuthorizationError(
        "TRUSTED_AUTHORITY_COMMAND_MISMATCH",
        "Command does not exactly match its trusted reservation authority.",
      );
    }
    if (
      operation !== undefined &&
      operation.id !== issuance.operationId
    ) {
      throw new AuthorizationError(
        "TRUSTED_AUTHORITY_OPERATION_MISMATCH",
        "Command operation does not match its trusted reservation.",
      );
    }
    return issued;
  }

  assertPendingCommands(): void {
    for (const row of this.#database.all(
      `SELECT commands.command_json
       FROM commands
       JOIN outbox ON outbox.command_id = commands.id
       WHERE outbox.phase IN ('intent', 'effect-applied')
         AND json_extract(commands.command_json, '$.issuerId') =
           'import-runtime'
       ORDER BY commands.rowid`,
    )) {
      const command = parsed<DurableCommand>(row.command_json);
      this.assertCommand(command);
    }
  }

  issuanceRowsForScope(
    projectId: string,
    runId: string,
    batchRootDigest: string,
  ): readonly SqlRow[] {
    return this.#database.all(
      `SELECT commands.rowid AS command_rowid,
              commands.command_json,
              trusted_command_authorities.*
       FROM trusted_command_authorities
       JOIN commands
         ON commands.id = trusted_command_authorities.command_id
       WHERE commands.project_id = ?
         AND json_extract(commands.command_json, '$.runId') = ?
         AND trusted_command_authorities.batch_root_digest = ?
       ORDER BY commands.rowid`,
      projectId,
      runId,
      batchRootDigest,
    );
  }

  readonly database = (): RuntimeDatabase => this.#database;

  #persistIssued(
    issuance: TrustedCommandAuthorityIssuance,
    issued: RuntimeIssuedCommandAuthority,
  ): void {
    this.#database.run(
      `INSERT INTO capability_grants (id, project_id, grant_json)
       VALUES (?, ?, ?)`,
      issued.grant.id,
      issued.grant.projectId,
      canonicalJson(issued.grant),
    );
    this.#database.run(
      `INSERT INTO approval_receipts (id, project_id, receipt_json)
       VALUES (?, ?, ?)`,
      issued.approval.id,
      issued.approval.projectId,
      canonicalJson(issued.approval),
    );
    this.#database.run(
      `INSERT INTO trusted_command_authorities (
        reservation_id, command_id, grant_id, approval_id,
        trust_root_id, key_id, trust_root_fingerprint,
        workspace_digest, plan_digest, batch_root_digest,
        issuance_digest, expires_at, issuance_json, authority_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      issued.reservation.id,
      issued.reservation.commandId,
      issued.grant.id,
      issued.approval.id,
      issued.trustRootId,
      issuance.approver.keyId,
      issued.trustRootFingerprint,
      issued.reviewedContext.workspaceDigest,
      issued.reviewedContext.planDigest,
      issued.reviewedContext.batchRootDigest,
      issued.issuanceDigest,
      issuance.expiresAt,
      canonicalJson(issuance),
      canonicalJson(issued),
    );
    this.#database.run(
      `UPDATE trusted_authority_reservations
       SET state = 'issued' WHERE id = ?`,
      issued.reservation.id,
    );
  }

  #validateIssuance(
    issuance: TrustedCommandAuthorityIssuance,
    request: ReturnType<
      typeof TrustedCommandAuthorityReservationRequestSchema.parse
    >,
    reservation: TrustedCommandAuthorityReservation,
  ): void {
    const expectedActionDigest = computeCommandActionDigest({
      ...request.commandDraft,
      authority: {
        ...request.commandDraft.authority,
        capabilityGrantId: reservation.grantId,
        approvalReceiptId: reservation.approvalId,
      },
    });
    const exactReservation =
      issuance.reservationRequestDigest ===
        reservation.requestDigest &&
      issuance.challenge === reservation.challenge &&
      issuance.grantId === reservation.grantId &&
      issuance.approvalId === reservation.approvalId &&
      issuance.projectId === request.projectId &&
      issuance.issuerId === request.issuerId &&
      issuance.commandId === request.commandId &&
      issuance.operationId === request.operationId &&
      issuance.leaseId === request.leaseId &&
      issuance.fencingEpoch === request.fencingEpoch &&
      issuance.actionDigest === expectedActionDigest &&
      canonicalEqual(issuance.target, request.target) &&
      canonicalEqual(
        issuance.requiredCapabilities,
        request.requiredCapabilities,
      ) &&
      canonicalEqual(
        issuance.reviewedContext,
        request.reviewedContext,
      );
    if (!exactReservation) {
      throw new AuthorizationError(
        "TRUSTED_AUTHORITY_BINDING_MISMATCH",
        "Trusted issuance does not match its reservation binding.",
      );
    }
    this.#leases.assert({
      projectId: request.projectId,
      targetId: request.target.id,
      leaseId: request.leaseId,
      fencingEpoch: request.fencingEpoch,
    });
    this.#assertActiveReservation(reservation, this.#clock());
    this.#assertIssuanceTime(issuance, reservation);
    this.#assertConfiguredTrust(issuance);
  }

  #assertActiveReservation(
    reservation: TrustedCommandAuthorityReservation,
    now: string,
  ): void {
    if (
      Date.parse(now) < Date.parse(reservation.reservedAt) ||
      Date.parse(now) >= Date.parse(reservation.expiresAt)
    ) {
      throw new AuthorizationError(
        "TRUSTED_AUTHORITY_RESERVATION_EXPIRED",
        "Trusted authority reservation has expired.",
      );
    }
  }

  #assertIssuanceTime(
    issuance: TrustedCommandAuthorityIssuance,
    reservation: TrustedCommandAuthorityReservation,
  ): void {
    const now = Date.parse(this.#clock());
    if (
      issuance.maximumUses !== 1 ||
      now < Date.parse(issuance.issuedAt) ||
      now >= Date.parse(issuance.expiresAt) ||
      Date.parse(issuance.expiresAt) >
        Date.parse(reservation.expiresAt)
    ) {
      throw new AuthorizationError(
        "TRUSTED_AUTHORITY_EXPIRED",
        "Trusted command authority is not valid at this time.",
      );
    }
  }

  #assertConfiguredTrust(
    issuance: TrustedCommandAuthorityIssuance,
  ): void {
    const key = this.#keys.get(
      trustKeyId(issuance.trustRootId, issuance.approver.keyId),
    );
    if (
      key === undefined ||
      key.fingerprint !== issuance.trustRootFingerprint
    ) {
      throw new AuthorizationError(
        "TRUSTED_AUTHORITY_ROOT_MISMATCH",
        "Trusted approval root or SPKI fingerprint is not configured.",
      );
    }
    if (
      issuance.approver.id !== key.approverId ||
      issuance.consequence !== key.consequence
    ) {
      throw new AuthorizationError(
        "TRUSTED_AUTHORITY_APPROVAL_POLICY_MISMATCH",
        "Trusted issuance violates the root approval binding.",
      );
    }
    const verified = verify(
      null,
      Buffer.from(canonicalJson(unsignedIssuance(issuance))),
      key.publicKey,
      Buffer.from(issuance.signature, "base64"),
    );
    if (!verified) {
      throw new AuthorizationError(
        "TRUSTED_AUTHORITY_SIGNATURE_INVALID",
        "Trusted approval signature verification failed.",
      );
    }
  }
}
