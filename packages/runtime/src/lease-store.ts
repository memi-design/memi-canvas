import {
  LeaseSchema,
  TargetFenceActivationResultSchema,
  type Lease,
  type LeaseId,
  type ProjectId,
  type TargetFenceActivationResult,
} from "../../protocol/src/index.js";

import { RuntimeDatabase } from "./database.js";
import {
  LeaseConflictError,
  StaleLeaseError,
} from "./errors.js";

export interface AcquireLeaseRequest {
  readonly leaseId: LeaseId;
  readonly projectId: ProjectId;
  readonly targetId: string;
  readonly holderId: string;
  readonly ttlMilliseconds: number;
}

export interface AssertLeaseRequest {
  readonly projectId: ProjectId;
  readonly targetId: string;
  readonly leaseId: LeaseId;
  readonly fencingEpoch: number;
}

export class LeaseStore {
  readonly #database: RuntimeDatabase;
  readonly #clock: () => string;

  constructor(database: RuntimeDatabase, clock: () => string) {
    this.#database = database;
    this.#clock = clock;
  }

  acquire(
    input: AcquireLeaseRequest,
    phase: "pending-fence" | "active" = "active",
  ): Lease {
    if (
      !Number.isSafeInteger(input.ttlMilliseconds) ||
      input.ttlMilliseconds <= 0
    ) {
      throw new RangeError("Lease TTL must be a positive integer.");
    }
    return this.#database.transaction(() => {
      const now = this.#clock();
      const current = this.#database.one(
        `SELECT lease_json FROM leases
         WHERE project_id = ? AND target_id = ?`,
        input.projectId,
        input.targetId,
      );
      const previous =
        current === undefined
          ? undefined
          : LeaseSchema.parse(
              JSON.parse(String(current.lease_json)),
            );
      if (
        previous !== undefined &&
        Date.parse(now) < Date.parse(previous.expiresAt)
      ) {
        throw new LeaseConflictError(input.targetId);
      }
      const lease = LeaseSchema.parse({
        schemaVersion: 1,
        id: input.leaseId,
        projectId: input.projectId,
        targetId: input.targetId,
        holderId: input.holderId,
        fencingEpoch: (previous?.fencingEpoch ?? 0) + 1,
        acquiredAt: now,
        expiresAt: new Date(
          Date.parse(now) + input.ttlMilliseconds,
        ).toISOString(),
      });
      this.#database.run(
        `INSERT INTO leases (
          id, project_id, target_id, holder_id, fencing_epoch, phase,
          acquired_at, expires_at, target_activated_at, activated_at,
          activation_json, lease_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT(project_id, target_id) DO UPDATE SET
          id = excluded.id,
          holder_id = excluded.holder_id,
          fencing_epoch = excluded.fencing_epoch,
          phase = excluded.phase,
          acquired_at = excluded.acquired_at,
          expires_at = excluded.expires_at,
          target_activated_at = excluded.target_activated_at,
          activated_at = excluded.activated_at,
          activation_json = excluded.activation_json,
          lease_json = excluded.lease_json`,
        lease.id,
        lease.projectId,
        lease.targetId,
        lease.holderId,
        lease.fencingEpoch,
        phase,
        lease.acquiredAt,
        lease.expiresAt,
        phase === "active" ? lease.acquiredAt : null,
        phase === "active" ? lease.acquiredAt : null,
        JSON.stringify(lease),
      );
      return lease;
    });
  }

  assert(input: AssertLeaseRequest): Lease {
    const row = this.#database.one(
      `SELECT phase, lease_json FROM leases
       WHERE project_id = ? AND target_id = ?`,
      input.projectId,
      input.targetId,
    );
    if (row === undefined) {
      throw new StaleLeaseError(
        "LEASE_NOT_ACTIVE",
        `Target "${input.targetId}" has no active lease.`,
      );
    }
    const lease = LeaseSchema.parse(
      JSON.parse(String(row.lease_json)),
    );
    if (
      lease.id !== input.leaseId ||
      lease.fencingEpoch !== input.fencingEpoch
    ) {
      throw new StaleLeaseError(
        "STALE_FENCE",
        `Lease fence for target "${input.targetId}" is stale.`,
      );
    }
    if (Date.parse(this.#clock()) >= Date.parse(lease.expiresAt)) {
      throw new StaleLeaseError(
        "LEASE_NOT_ACTIVE",
        `Lease for target "${input.targetId}" has expired.`,
      );
    }
    if (String(row.phase) !== "active") {
      throw new StaleLeaseError(
        "LEASE_NOT_ACTIVE",
        `Lease for target "${input.targetId}" has not activated its target fence.`,
      );
    }
    return lease;
  }

  prepareActivation(input: AssertLeaseRequest): Lease {
    const row = this.#requireExact(input);
    const phase = String(row.phase);
    if (phase !== "pending-fence" && phase !== "target-activated") {
      if (phase === "active") {
        return LeaseSchema.parse(
          JSON.parse(String(row.lease_json)),
        );
      }
      throw new StaleLeaseError(
        "LEASE_NOT_ACTIVE",
        `Lease for target "${input.targetId}" cannot activate.`,
      );
    }
    return LeaseSchema.parse(JSON.parse(String(row.lease_json)));
  }

  recordTargetActivation(
    input: AssertLeaseRequest,
    untrustedResult: TargetFenceActivationResult,
  ): Lease {
    const result = TargetFenceActivationResultSchema.parse(
      untrustedResult,
    );
    if (
      result.status === "rejected" ||
      result.projectId !== input.projectId ||
      result.target.id !== input.targetId ||
      result.leaseId !== input.leaseId ||
      result.fencingEpoch !== input.fencingEpoch
    ) {
      throw new StaleLeaseError(
        result.status === "rejected" &&
          result.code === "STALE_FENCE"
          ? "STALE_FENCE"
          : "LEASE_NOT_ACTIVE",
        `Target fence activation was rejected for "${input.targetId}".`,
      );
    }
    return this.#database.transaction(() => {
      const row = this.#requireExact(input);
      const lease = LeaseSchema.parse(
        JSON.parse(String(row.lease_json)),
      );
      if (
        result.holderId !== lease.holderId ||
        result.highestFence !== lease.fencingEpoch
      ) {
        throw new StaleLeaseError(
          "STALE_FENCE",
          `Target fence activation does not match "${input.targetId}".`,
        );
      }
      if (String(row.phase) === "active") {
        return lease;
      }
      this.#database.run(
        `UPDATE leases
         SET phase = 'target-activated',
             target_activated_at = ?,
             activation_json = ?
         WHERE project_id = ? AND target_id = ?`,
        this.#clock(),
        JSON.stringify(result),
        input.projectId,
        input.targetId,
      );
      return lease;
    });
  }

  finalizeActivation(input: AssertLeaseRequest): Lease {
    return this.#database.transaction(() => {
      const row = this.#requireExact(input);
      const lease = LeaseSchema.parse(
        JSON.parse(String(row.lease_json)),
      );
      if (String(row.phase) === "active") {
        return lease;
      }
      if (String(row.phase) !== "target-activated") {
        throw new StaleLeaseError(
          "LEASE_NOT_ACTIVE",
          `Target fence is not recorded for "${input.targetId}".`,
        );
      }
      this.#database.run(
        `UPDATE leases SET phase = 'active', activated_at = ?
         WHERE project_id = ? AND target_id = ?`,
        this.#clock(),
        input.projectId,
        input.targetId,
      );
      return lease;
    });
  }

  #requireExact(input: AssertLeaseRequest) {
    const row = this.#database.one(
      `SELECT phase, lease_json FROM leases
       WHERE project_id = ? AND target_id = ?`,
      input.projectId,
      input.targetId,
    );
    if (row === undefined) {
      throw new StaleLeaseError(
        "LEASE_NOT_ACTIVE",
        `Target "${input.targetId}" has no lease.`,
      );
    }
    const lease = LeaseSchema.parse(
      JSON.parse(String(row.lease_json)),
    );
    if (
      lease.id !== input.leaseId ||
      lease.fencingEpoch !== input.fencingEpoch
    ) {
      throw new StaleLeaseError(
        "STALE_FENCE",
        `Lease fence for target "${input.targetId}" is stale.`,
      );
    }
    if (Date.parse(this.#clock()) >= Date.parse(lease.expiresAt)) {
      throw new StaleLeaseError(
        "LEASE_NOT_ACTIVE",
        `Lease for target "${input.targetId}" has expired.`,
      );
    }
    return row;
  }
}
