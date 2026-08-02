import {
  DurableCommandIdSchema,
  OutboxIdSchema,
  durableCommandTargetKindMatches,
} from "../../protocol/src/index.js";

import {
  RuntimeDatabase,
  type SqlRow,
} from "./database.js";
import type { WorkerClaim } from "./types.js";

export interface TargetScheduleCandidate {
  readonly row: SqlRow;
  readonly hadClaim: boolean;
}

function text(row: SqlRow, key: string): string {
  return String(row[key]);
}

export class TargetScheduleStore {
  readonly #database: RuntimeDatabase;

  constructor(database: RuntimeDatabase) {
    this.#database = database;
  }

  nextCandidate(
    now: string,
    allowCanvas: boolean,
  ): TargetScheduleCandidate | undefined {
    const rows = this.#database.all(
      `SELECT
         outbox.id,
         outbox.command_id,
         outbox.claim_epoch,
         outbox.worker_id,
         outbox.record_json,
         outbox.project_id,
         outbox.target_kind,
         outbox.target_id,
         json_extract(
           commands.command_json,
           '$.kind'
         ) AS command_kind,
         latch.outbox_id AS latch_outbox_id
       FROM outbox
       JOIN commands ON commands.id = outbox.command_id
       LEFT JOIN target_schedule_latches AS latch
         ON latch.project_id = outbox.project_id
        AND latch.target_kind = outbox.target_kind
        AND latch.target_id = outbox.target_id
       WHERE outbox.phase = 'intent'
         AND json_extract(commands.command_json, '$.issuerId')
           <> 'import-runtime'
         AND NOT EXISTS (
           SELECT 1
           FROM outbox AS earlier
           JOIN commands AS earlier_commands
             ON earlier_commands.id = earlier.command_id
           WHERE earlier.project_id = outbox.project_id
             AND earlier.target_kind = outbox.target_kind
             AND earlier.target_id = outbox.target_id
             AND earlier.phase = 'intent'
             AND earlier.rowid < outbox.rowid
             AND json_extract(
               earlier_commands.command_json,
               '$.issuerId'
             ) = 'import-runtime'
         )
         AND (outbox.worker_id IS NULL OR outbox.claim_expires_at <= ?)
         AND (? = 1 OR outbox.target_kind <> 'canvas-document')
         AND (
           latch.outbox_id IS NULL OR (
             latch.outbox_id = outbox.id
             AND latch.state <> 'blocked-unknown'
           )
         )
       ORDER BY
         CASE WHEN latch.outbox_id = outbox.id THEN 0 ELSE 1 END,
         outbox.rowid`,
      now,
      allowCanvas ? 1 : 0,
    );
    const row = rows.find((candidate) => {
      const commandKind = text(candidate, "command_kind");
      return (
        commandKind !== "artifact.persist" &&
        durableCommandTargetKindMatches(
          commandKind,
          text(candidate, "target_kind"),
        )
      );
    });
    return row === undefined
      ? undefined
      : { row, hadClaim: row.worker_id !== null };
  }

  exactCandidate(
    commandId: string,
    now: string,
    allowCanvas: boolean,
  ): TargetScheduleCandidate | undefined {
    const row = this.#database.one(
      `SELECT
         outbox.id,
         outbox.command_id,
         outbox.claim_epoch,
         outbox.worker_id,
         outbox.record_json,
         outbox.project_id,
         outbox.target_kind,
         outbox.target_id,
         json_extract(commands.command_json, '$.kind') AS command_kind,
         latch.outbox_id AS latch_outbox_id,
         latch.state AS latch_state
       FROM outbox
       JOIN commands ON commands.id = outbox.command_id
       LEFT JOIN target_schedule_latches AS latch
         ON latch.project_id = outbox.project_id
        AND latch.target_kind = outbox.target_kind
        AND latch.target_id = outbox.target_id
       WHERE outbox.command_id = ?
         AND outbox.phase = 'intent'
         AND (outbox.worker_id IS NULL OR outbox.claim_expires_at <= ?)
         AND (? = 1 OR outbox.target_kind <> 'canvas-document')
         AND (
           latch.outbox_id IS NULL OR latch.outbox_id = outbox.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM outbox AS earlier
           WHERE earlier.project_id = outbox.project_id
             AND earlier.target_kind = outbox.target_kind
             AND earlier.target_id = outbox.target_id
             AND earlier.phase = 'intent'
             AND earlier.rowid < outbox.rowid
         )`,
      commandId,
      now,
      allowCanvas ? 1 : 0,
    );
    if (row === undefined) {
      return undefined;
    }
    const commandKind = text(row, "command_kind");
    return commandKind === "artifact.persist" ||
      !durableCommandTargetKindMatches(
        commandKind,
        text(row, "target_kind"),
      )
      ? undefined
      : {
          row,
          hadClaim:
            row.worker_id !== null ||
            row.latch_state === "blocked-unknown",
        };
  }

  claim(
    candidate: TargetScheduleCandidate,
    workerId: string,
    fencingEpoch: number,
    expiresAt: string,
    now: string,
  ): WorkerClaim {
    const row = candidate.row;
    this.#database.run(
      `UPDATE outbox
       SET worker_id = ?, claim_epoch = ?, claim_expires_at = ?
       WHERE id = ?`,
      workerId,
      fencingEpoch,
      expiresAt,
      text(row, "id"),
    );
    const workerClaimId = `${text(row, "id")}:${fencingEpoch}`;
    if (row.latch_outbox_id === null) {
      this.#database.run(
        `INSERT INTO target_schedule_latches (
          project_id, target_kind, target_id, command_id, outbox_id,
          state, worker_claim_id, claim_epoch, acquired_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending-fence', ?, ?, ?, ?)`,
        text(row, "project_id"),
        text(row, "target_kind"),
        text(row, "target_id"),
        text(row, "command_id"),
        text(row, "id"),
        workerClaimId,
        fencingEpoch,
        now,
        now,
      );
    } else {
      const changes = this.#database.run(
        `UPDATE target_schedule_latches
         SET state = 'pending-fence', worker_claim_id = ?,
             claim_epoch = ?, recovery_json = NULL, updated_at = ?
         WHERE outbox_id = ?`,
        workerClaimId,
        fencingEpoch,
        now,
        text(row, "id"),
      );
      if (changes !== 1) {
        throw new Error(
          "Target schedule latch claim transition was lost.",
        );
      }
    }
    return {
      id: workerClaimId,
      commandId: DurableCommandIdSchema.parse(
        text(row, "command_id"),
      ),
      outboxId: OutboxIdSchema.parse(text(row, "id")),
      workerId,
      fencingEpoch,
      expiresAt,
    };
  }
}
