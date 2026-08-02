import {
  ContentHashSchema,
  DurableCommandSchema,
  IsoTimestampSchema,
  OutboxIdSchema,
  OutboxRecordSchema,
  OutboxTransitionSchema,
  durableCommandTargetKindMatches,
  type DurableCommand,
  type OutboxRecord,
} from "../../protocol/src/index.js";

import { AuthorityStore } from "./authority-store.js";
import { RuntimeDatabase } from "./database.js";
import {
  EffectVerificationError,
  StaleWorkerClaimError,
} from "./errors.js";
import type {
  CommitClaim,
  CommitClaimRequest,
  CommittedEffectReceipt,
  EffectVerifier,
  LegacyCommittedEffectReceipt,
  VerifyAndCommitRequest,
  TraceEventIdFactory,
} from "./types.js";

type EffectAppliedOutbox = OutboxRecord & {
  readonly phase: "effect-applied";
};

function parsed<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

export class EffectCommitStore {
  readonly #database: RuntimeDatabase;
  readonly #authority: AuthorityStore;
  readonly #clock: () => string;
  readonly #verifier: EffectVerifier | undefined;
  readonly #traceEventIdFactory: TraceEventIdFactory;

  constructor(
    database: RuntimeDatabase,
    authority: AuthorityStore,
    clock: () => string,
    verifier: EffectVerifier | undefined,
    traceEventIdFactory: TraceEventIdFactory,
  ) {
    this.#database = database;
    this.#authority = authority;
    this.#clock = clock;
    this.#verifier = verifier;
    this.#traceEventIdFactory = traceEventIdFactory;
  }

  claim(input: CommitClaimRequest): CommitClaim {
    if (
      !Number.isSafeInteger(input.claimTtlMilliseconds) ||
      input.claimTtlMilliseconds <= 0
    ) {
      throw new RangeError("Commit claim TTL must be a positive integer.");
    }
    return this.#database.transaction(() => {
      const row = this.#database.one(
        `SELECT outbox.id, outbox.phase, outbox.worker_id,
                outbox.claim_epoch, outbox.claim_expires_at,
                target_schedule_latches.state AS latch_state,
                target_receipts.command_id AS target_receipt_command_id,
                commands.command_json, commands.target_kind
         FROM outbox
         JOIN commands ON commands.id = outbox.command_id
         LEFT JOIN target_schedule_latches
           ON target_schedule_latches.outbox_id = outbox.id
         LEFT JOIN target_receipts
           ON target_receipts.command_id = outbox.command_id
         WHERE outbox.command_id = ?`,
        input.commandId,
      );
      if (row === undefined || String(row.phase) !== "effect-applied") {
        throw new Error(
          `Command "${input.commandId}" must be effect-applied before commit claim.`,
        );
      }
      const storedCommand = parsed<{
        readonly kind?: unknown;
      }>(row.command_json);
      const commandKind = String(storedCommand.kind);
      const targetKind = String(row.target_kind);
      if (commandKind === "artifact.persist") {
        throw new Error(
          `Command "${input.commandId}" requires an authoritative artifact receipt before commit claim.`,
        );
      }
      if (
        !durableCommandTargetKindMatches(
          commandKind,
          targetKind,
        )
      ) {
        throw new Error(
          `Command "${input.commandId}" has an incompatible target binding.`,
        );
      }
      if (
        String(row.latch_state) === "blocked-unknown" &&
        row.target_receipt_command_id === null
      ) {
        throw new Error(
          `Command "${input.commandId}" requires an authoritative target receipt before commit claim.`,
        );
      }
      const now = this.#clock();
      if (
        row.worker_id !== null &&
        Date.parse(now) < Date.parse(String(row.claim_expires_at))
      ) {
        throw new StaleWorkerClaimError(input.commandId);
      }
      const fencingEpoch = Number(row.claim_epoch) + 1;
      const expiresAt = new Date(
        Date.parse(now) + input.claimTtlMilliseconds,
      ).toISOString();
      this.#database.run(
        `UPDATE outbox
         SET worker_id = ?, claim_epoch = ?, claim_expires_at = ?
         WHERE id = ?`,
        input.workerId,
        fencingEpoch,
        expiresAt,
        String(row.id),
      );
      return {
        commandId: input.commandId,
        outboxId: OutboxIdSchema.parse(String(row.id)),
        workerId: input.workerId,
        fencingEpoch,
        expiresAt,
      };
    });
  }

  async verifyAndCommit(
    input: VerifyAndCommitRequest,
  ): Promise<CommittedEffectReceipt> {
    if (
      typeof input !== "object" ||
      input === null ||
      Object.keys(input).length !== 1 ||
      !("claim" in input)
    ) {
      throw new Error("Commit request contains caller trace authority.");
    }
    const replay = this.#committedReplay(input.claim.commandId);
    if (replay !== undefined) {
      return replay;
    }
    if (this.#verifier === undefined) {
      throw new EffectVerificationError(
        "EFFECT_VERIFIER_REQUIRED",
        "An authoritative effect verifier is required before commit.",
      );
    }
    const prepared = this.#database.transaction(() => {
      const outbox = this.#assertClaim(input.claim);
      const command = this.#requireCommand(input.claim.commandId);
      this.#authority.validateLease(command);
      const pending = this.#database.one(
        `SELECT receipt_json FROM legacy_effect_receipts
         WHERE command_id = ?`,
        command.id,
      );
      if (pending === undefined) {
        throw new Error(
          `Effect evidence for command "${command.id}" is missing.`,
        );
      }
      return {
        command,
        outbox,
        executorReceipt: parsed<{
          readonly executorReceipt: unknown;
        }>(pending.receipt_json).executorReceipt,
      };
    });

    const verification = await this.#verifier.verify({
      command: prepared.command,
      outbox: prepared.outbox,
      resultingHash: prepared.outbox.resultingHash,
      executorReceipt: prepared.executorReceipt,
    });
    ContentHashSchema.parse(verification.evidenceHash);
    ContentHashSchema.parse(verification.observedTargetHash);
    IsoTimestampSchema.parse(verification.verifiedAt);
    if (
      verification.observedTargetHash !==
      prepared.outbox.resultingHash
    ) {
      throw new EffectVerificationError(
        "EFFECT_VERIFICATION_MISMATCH",
        "Target verification does not match the applied result.",
      );
    }
    if (
      Date.parse(verification.verifiedAt) <
      Date.parse(prepared.outbox.appliedAt)
    ) {
      throw new EffectVerificationError(
        "EFFECT_VERIFICATION_MISMATCH",
        "Target verification cannot predate the applied effect.",
      );
    }

    return this.#database.transaction(() => {
      const outbox = this.#assertClaim(input.claim);
      this.#authority.validateLease(prepared.command);
      if (
        outbox.resultingHash !== prepared.outbox.resultingHash ||
        outbox.appliedAt !== prepared.outbox.appliedAt
      ) {
        throw new EffectVerificationError(
          "EFFECT_VERIFICATION_MISMATCH",
          "Applied effect evidence changed during verification.",
        );
      }
      const traceEventId = this.#traceEventIdFactory();
      const committed = OutboxRecordSchema.parse({
        ...outbox,
        phase: "committed",
        committedAt: this.#clock(),
        traceEventId,
      });
      OutboxTransitionSchema.parse({ from: outbox, to: committed });
      const receipt: LegacyCommittedEffectReceipt = {
        commandId: prepared.command.id,
        actionDigest: prepared.command.actionDigest,
        resultingHash: outbox.resultingHash,
        traceEventId,
        verification,
        executorReceipt: prepared.executorReceipt,
      };
      this.#database.run(
        `UPDATE outbox
         SET phase = ?, record_json = ?, worker_id = NULL,
             claim_expires_at = NULL
         WHERE id = ?`,
        committed.phase,
        JSON.stringify(committed),
        committed.id,
      );
      this.#database.run(
        `UPDATE legacy_effect_receipts SET receipt_json = ?
         WHERE command_id = ?`,
        JSON.stringify(receipt),
        prepared.command.id,
      );
      this.#database.run(
        `INSERT INTO legacy_trace_references (
           command_id, trace_event_id
         )
         VALUES (?, ?)`,
        prepared.command.id,
        traceEventId,
      );
      this.#database.run(
        "UPDATE commands SET state = 'committed' WHERE id = ?",
        prepared.command.id,
      );
      return receipt;
    });
  }

  getReceipt(
    commandId: DurableCommand["id"],
  ): CommittedEffectReceipt | undefined {
    const outbox = this.#getOutbox(commandId);
    if (outbox?.phase !== "committed") {
      return undefined;
    }
    const row = this.#database.one(
      `SELECT receipt_json FROM legacy_effect_receipts
       WHERE command_id = ?`,
      commandId,
    );
    return row === undefined ? undefined : parsed(row.receipt_json);
  }

  getTrace(commandId: DurableCommand["id"]) {
    const row = this.#database.one(
      `SELECT trace_event_id FROM legacy_trace_references
       WHERE command_id = ?`,
      commandId,
    );
    return row === undefined
      ? undefined
      : {
          commandId,
          traceEventId: String(row.trace_event_id),
        };
  }

  #assertClaim(claim: CommitClaim): EffectAppliedOutbox {
    const row = this.#database.one(
      `SELECT phase, record_json, worker_id, claim_epoch,
              claim_expires_at
       FROM outbox WHERE id = ? AND command_id = ?`,
      claim.outboxId,
      claim.commandId,
    );
    if (
      row === undefined ||
      String(row.phase) !== "effect-applied" ||
      row.worker_id !== claim.workerId ||
      Number(row.claim_epoch) !== claim.fencingEpoch ||
      row.claim_expires_at !== claim.expiresAt ||
      Date.parse(this.#clock()) >= Date.parse(claim.expiresAt)
    ) {
      throw new StaleWorkerClaimError(claim.commandId);
    }
    const outbox = OutboxRecordSchema.parse(
      parsed(row.record_json),
    );
    if (outbox.phase !== "effect-applied") {
      throw new StaleWorkerClaimError(claim.commandId);
    }
    return outbox;
  }

  #committedReplay(
    commandId: DurableCommand["id"],
  ): CommittedEffectReceipt | undefined {
    const outbox = this.#getOutbox(commandId);
    if (outbox?.phase !== "committed") {
      return undefined;
    }
    return this.getReceipt(commandId);
  }

  #requireCommand(commandId: DurableCommand["id"]): DurableCommand {
    const row = this.#database.one(
      "SELECT command_json FROM commands WHERE id = ?",
      commandId,
    );
    if (row === undefined) {
      throw new Error(`Command "${commandId}" was not found.`);
    }
    return DurableCommandSchema.parse(parsed(row.command_json));
  }

  #getOutbox(
    commandId: DurableCommand["id"],
  ): OutboxRecord | undefined {
    const row = this.#database.one(
      "SELECT record_json FROM outbox WHERE command_id = ?",
      commandId,
    );
    return row === undefined
      ? undefined
      : OutboxRecordSchema.parse(parsed(row.record_json));
  }
}
