import {
  ApprovalReceiptSchema,
  ApprovalUseSchema,
  CapabilityGrantSchema,
  CapabilityGrantUseSchema,
  LeaseSchema,
  LeaseUseSchema,
  type ApprovalReceipt,
  type CapabilityGrant,
  type DurableCommand,
} from "../../protocol/src/index.js";

import { RuntimeDatabase } from "./database.js";
import {
  AuthorizationError,
  StaleLeaseError,
} from "./errors.js";

export interface AuthorityReservation {
  readonly grant: CapabilityGrant;
  readonly grantUseNumber: number;
  readonly approval: ApprovalReceipt;
  readonly approvalUseNumber: number;
}

function parsed(value: unknown): unknown {
  return JSON.parse(String(value));
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function isBefore(timestamp: string, boundary: string): boolean {
  return Date.parse(timestamp) < Date.parse(boundary);
}

export class AuthorityStore {
  readonly #database: RuntimeDatabase;
  readonly #clock: () => string;

  constructor(database: RuntimeDatabase, clock: () => string) {
    this.#database = database;
    this.#clock = clock;
  }

  registerGrant(input: CapabilityGrant): CapabilityGrant {
    const grant = CapabilityGrantSchema.parse(input);
    return this.#database.transaction(() => {
      const existing = this.#database.one(
        "SELECT grant_json FROM capability_grants WHERE id = ?",
        grant.id,
      );
      if (existing !== undefined) {
        const recorded = CapabilityGrantSchema.parse(
          parsed(existing.grant_json),
        );
        if (json(recorded) !== json(grant)) {
          throw new AuthorizationError(
            "GRANT_IMMUTABLE_CONFLICT",
            `Capability grant "${grant.id}" cannot be replaced.`,
          );
        }
        return recorded;
      }
      this.#database.run(
        `INSERT INTO capability_grants (id, project_id, grant_json)
         VALUES (?, ?, ?)`,
        grant.id,
        grant.projectId,
        json(grant),
      );
      return grant;
    });
  }

  registerApproval(input: ApprovalReceipt): ApprovalReceipt {
    const receipt = ApprovalReceiptSchema.parse(input);
    return this.#database.transaction(() => {
      const existing = this.#database.one(
        "SELECT receipt_json FROM approval_receipts WHERE id = ?",
        receipt.id,
      );
      if (existing !== undefined) {
        const recorded = ApprovalReceiptSchema.parse(
          parsed(existing.receipt_json),
        );
        if (json(recorded) !== json(receipt)) {
          throw new AuthorizationError(
            "APPROVAL_IMMUTABLE_CONFLICT",
            `Approval receipt "${receipt.id}" cannot be replaced.`,
          );
        }
        return recorded;
      }
      this.#database.run(
        `INSERT INTO approval_receipts (id, project_id, receipt_json)
         VALUES (?, ?, ?)`,
        receipt.id,
        receipt.projectId,
        json(receipt),
      );
      return receipt;
    });
  }

  getGrantUsage(grantId: string): number {
    const row = this.#database.one(
      `SELECT COUNT(*) AS count
       FROM capability_grant_uses WHERE grant_id = ?`,
      grantId,
    );
    return Number(row?.count ?? 0);
  }

  getApprovalUsage(approvalId: string | null): number {
    if (approvalId === null) {
      return 0;
    }
    const row = this.#database.one(
      "SELECT COUNT(*) AS count FROM approval_uses WHERE approval_id = ?",
      approvalId,
    );
    return Number(row?.count ?? 0);
  }

  reserve(
    command: DurableCommand,
    usedAt: string,
  ): AuthorityReservation {
    const grantRow = this.#database.one(
      "SELECT grant_json FROM capability_grants WHERE id = ?",
      command.authority.capabilityGrantId,
    );
    if (grantRow === undefined) {
      throw new AuthorizationError(
        "GRANT_NOT_FOUND",
        "Capability grant was not found.",
      );
    }
    const grant = CapabilityGrantSchema.parse(
      parsed(grantRow.grant_json),
    );
    this.#validateGrant(command, grant, usedAt);
    const grantUseNumber = this.getGrantUsage(grant.id) + 1;
    if (grantUseNumber > grant.constraints.maximumUses) {
      throw new AuthorizationError(
        "GRANT_EXHAUSTED",
        "Capability grant use limit is exhausted.",
      );
    }
    CapabilityGrantUseSchema.parse({
      command,
      grant,
      useNumber: grantUseNumber,
      usedAt,
    });

    const approvalId = command.authority.approvalReceiptId;
    if (approvalId === null) {
      throw new AuthorizationError(
        "APPROVAL_NOT_FOUND",
        "Command has no approval receipt.",
      );
    }
    const approvalRow = this.#database.one(
      "SELECT receipt_json FROM approval_receipts WHERE id = ?",
      approvalId,
    );
    if (approvalRow === undefined) {
      throw new AuthorizationError(
        "APPROVAL_NOT_FOUND",
        "Approval receipt was not found.",
      );
    }
    const approval = ApprovalReceiptSchema.parse(
      parsed(approvalRow.receipt_json),
    );
    this.#validateApproval(command, approval, usedAt);
    const approvalUseNumber =
      this.getApprovalUsage(approval.id) + 1;
    if (approvalUseNumber > approval.maximumUses) {
      throw new AuthorizationError(
        "APPROVAL_EXHAUSTED",
        "Approval receipt use limit is exhausted.",
      );
    }
    ApprovalUseSchema.parse({
      command,
      receipt: approval,
      useNumber: approvalUseNumber,
      usedAt,
    });
    return {
      grant,
      grantUseNumber,
      approval,
      approvalUseNumber,
    };
  }

  validateEffect(command: DurableCommand): CapabilityGrant {
    const now = this.#clock();
    const grantRow = this.#database.one(
      "SELECT grant_json FROM capability_grants WHERE id = ?",
      command.authority.capabilityGrantId,
    );
    if (grantRow === undefined) {
      throw new AuthorizationError(
        "GRANT_NOT_FOUND",
        "Reserved capability grant is missing.",
      );
    }
    const grant = CapabilityGrantSchema.parse(
      parsed(grantRow.grant_json),
    );
    this.#validateGrant(command, grant, now, true);
    const approvalId = command.authority.approvalReceiptId;
    const approvalRow =
      approvalId === null
        ? undefined
        : this.#database.one(
            "SELECT receipt_json FROM approval_receipts WHERE id = ?",
            approvalId,
          );
    if (approvalRow === undefined) {
      throw new AuthorizationError(
        "APPROVAL_NOT_FOUND",
        "Reserved approval receipt is missing.",
      );
    }
    this.#validateApproval(
      command,
      ApprovalReceiptSchema.parse(parsed(approvalRow.receipt_json)),
      now,
      true,
    );
    this.validateLease(command);
    return grant;
  }

  validateLease(command: DurableCommand): void {
    const now = this.#clock();
    const leaseRow = this.#database.one(
      `SELECT phase, lease_json FROM leases
       WHERE project_id = ? AND target_id = ?`,
      command.projectId,
      command.target.id,
    );
    if (leaseRow === undefined) {
      throw new StaleLeaseError(
        "LEASE_NOT_ACTIVE",
        "Command target has no active lease.",
      );
    }
    const lease = LeaseSchema.parse(parsed(leaseRow.lease_json));
    if (String(leaseRow.phase) !== "active") {
      throw new StaleLeaseError(
        "LEASE_NOT_ACTIVE",
        "Command target fence is not active.",
      );
    }
    if (
      lease.id !== command.authority.leaseId ||
      lease.fencingEpoch !== command.authority.fencingEpoch ||
      lease.holderId !== command.issuerId
    ) {
      throw new StaleLeaseError(
        "STALE_FENCE",
        "Command lease authority has been fenced.",
      );
    }
    if (!isBefore(now, lease.expiresAt)) {
      throw new StaleLeaseError(
        "LEASE_NOT_ACTIVE",
        "Command lease has expired.",
      );
    }
    LeaseUseSchema.parse({ command, lease, usedAt: now });
  }

  #validateGrant(
    command: DurableCommand,
    grant: CapabilityGrant,
    usedAt: string,
    atEffect = false,
  ): void {
    if (
      grant.projectId !== command.projectId ||
      grant.clientId !== command.issuerId
    ) {
      throw new AuthorizationError(
        "GRANT_NOT_FOUND",
        "Capability grant does not belong to this command actor.",
      );
    }
    if (
      !command.requiredCapabilities.every((capability) =>
        grant.capabilities.includes(capability),
      )
    ) {
      throw new AuthorizationError(
        "CAPABILITY_NOT_GRANTED",
        "Capability grant does not include every required capability.",
      );
    }
    if (grant.constraints.actionDigest !== command.actionDigest) {
      throw new AuthorizationError(
        "ACTION_DIGEST_NOT_GRANTED",
        "Capability grant is bound to another action digest.",
      );
    }
    if (
      isBefore(usedAt, grant.issuedAt) ||
      !isBefore(usedAt, grant.expiresAt)
    ) {
      throw new AuthorizationError(
        atEffect ? "GRANT_EXPIRED_AT_EFFECT" : "GRANT_EXPIRED",
        "Capability grant is not active.",
      );
    }
  }

  #validateApproval(
    command: DurableCommand,
    approval: ApprovalReceipt,
    usedAt: string,
    atEffect = false,
  ): void {
    const exactBinding =
      approval.projectId === command.projectId &&
      approval.actionDigest === command.actionDigest &&
      json(approval.target) === json(command.target) &&
      json([...approval.capabilities].sort()) ===
        json([...command.requiredCapabilities].sort());
    if (!exactBinding) {
      throw new AuthorizationError(
        "APPROVAL_BINDING_MISMATCH",
        "Approval receipt does not exactly authorize this command.",
      );
    }
    if (
      isBefore(usedAt, approval.issuedAt) ||
      !isBefore(usedAt, approval.expiresAt)
    ) {
      throw new AuthorizationError(
        atEffect
          ? "APPROVAL_EXPIRED_AT_EFFECT"
          : "APPROVAL_EXPIRED",
        "Approval receipt is not active.",
      );
    }
  }
}
