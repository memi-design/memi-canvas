import {
  ContentHashSchema,
  DurableCommandSchema,
  OutboxRecordSchema,
  OutboxTransitionSchema,
  type DurableCommand,
  type OutboxRecord,
} from "../../protocol/src/index.js";

import { AuthorityStore } from "./authority-store.js";
import { RuntimeDatabase } from "./database.js";
import { StaleWorkerClaimError } from "./errors.js";
import { assertM0EffectAllowed, validateCommandPolicy } from "./policy.js";
import { json, parsed } from "./runtime-records.js";
import type {
  CommandPolicyValidator,
  EffectExecutor,
  WorkerClaim,
} from "./types.js";

export interface LegacyEffectCallbacks {
  readonly fail: (
    outbox: OutboxRecord,
    error: unknown,
    code?: string,
  ) => void;
  readonly outcomeUnknown: (
    command: DurableCommand,
    outbox: OutboxRecord,
  ) => void;
}

export class LegacyEffectRunner {
  readonly #database: RuntimeDatabase;
  readonly #authority: AuthorityStore;
  readonly #clock: () => string;
  readonly #executor: EffectExecutor;
  readonly #policyValidator: CommandPolicyValidator | undefined;
  readonly #callbacks: LegacyEffectCallbacks;

  constructor(
    database: RuntimeDatabase,
    authority: AuthorityStore,
    clock: () => string,
    executor: EffectExecutor,
    policyValidator: CommandPolicyValidator | undefined,
    callbacks: LegacyEffectCallbacks,
  ) {
    this.#database = database;
    this.#authority = authority;
    this.#clock = clock;
    this.#executor = executor;
    this.#policyValidator = policyValidator;
    this.#callbacks = callbacks;
  }

  async apply(claim: WorkerClaim): Promise<OutboxRecord> {
    let prepared;
    try {
      prepared = this.#database.transaction(() => {
        this.#assertClaim(claim);
        const command = this.#command(claim.commandId);
        const outbox = this.#outbox(claim.commandId);
        assertM0EffectAllowed(command);
        const grant = this.#authority.validateEffect(command);
        const effectPayload = this.#payload(command.id);
        validateCommandPolicy(
          this.#policyValidator,
          command,
          effectPayload,
          grant,
        );
        return { command, outbox, effectPayload };
      });
    } catch (error) {
      this.#database.transaction(() => {
        this.#assertClaim(claim);
        this.#callbacks.fail(
          this.#outbox(claim.commandId),
          error,
        );
      });
      throw error;
    }

    let result;
    try {
      result = await this.#executor.execute({
        command: prepared.command,
        effectPayload: prepared.effectPayload,
        idempotencyKey: prepared.command.idempotencyKey,
        actionDigest: prepared.command.actionDigest,
      });
    } catch (error) {
      this.#database.transaction(() => {
        this.#assertClaim(claim);
        this.#callbacks.outcomeUnknown(
          prepared.command,
          prepared.outbox,
        );
      });
      throw error;
    }
    if (result.status === "outcome-unknown") {
      this.#database.transaction(() => {
        this.#assertClaim(claim);
        this.#callbacks.outcomeUnknown(
          prepared.command,
          prepared.outbox,
        );
      });
      throw new Error(result.error.message);
    }
    if (result.status === "definitely-not-applied") {
      this.#database.transaction(() => {
        this.#assertClaim(claim);
        this.#callbacks.fail(
          prepared.outbox,
          new Error(result.error.message),
          "EFFECT_NOT_APPLIED",
        );
      });
      throw new Error(result.error.message);
    }
    ContentHashSchema.parse(result.resultingHash);

    return this.#database.transaction(() => {
      this.#assertClaim(claim);
      const applied = OutboxRecordSchema.parse({
        ...prepared.outbox,
        phase: "effect-applied",
        appliedAt: this.#clock(),
        resultingHash: result.resultingHash,
      });
      OutboxTransitionSchema.parse({
        from: prepared.outbox,
        to: applied,
      });
      this.#database.run(
        `UPDATE outbox
         SET phase = ?, record_json = ?, worker_id = NULL,
             claim_expires_at = NULL WHERE id = ?`,
        applied.phase,
        json(applied),
        applied.id,
      );
      this.#database.run(
        "UPDATE commands SET state = 'effect-applied' WHERE id = ?",
        prepared.command.id,
      );
      this.#database.run(
        `INSERT INTO legacy_effect_receipts (command_id, receipt_json)
         VALUES (?, ?)`,
        prepared.command.id,
        json({ pending: true, executorReceipt: result.receipt }),
      );
      return applied;
    });
  }

  #assertClaim(claim: WorkerClaim): void {
    const row = this.#database.one(
      `SELECT phase, worker_id, claim_epoch, claim_expires_at
       FROM outbox WHERE id = ? AND command_id = ?`,
      claim.outboxId,
      claim.commandId,
    );
    if (
      row === undefined ||
      String(row.phase) !== "intent" ||
      String(row.worker_id) !== claim.workerId ||
      Number(row.claim_epoch) !== claim.fencingEpoch ||
      String(row.claim_expires_at) !== claim.expiresAt ||
      Date.parse(this.#clock()) >= Date.parse(claim.expiresAt)
    ) {
      throw new StaleWorkerClaimError(claim.commandId);
    }
  }

  #command(commandId: string): DurableCommand {
    const row = this.#database.one(
      "SELECT command_json FROM commands WHERE id = ?",
      commandId,
    );
    if (row === undefined) {
      throw new Error(`Command "${commandId}" was not found.`);
    }
    return DurableCommandSchema.parse(parsed(row.command_json));
  }

  #outbox(commandId: string): OutboxRecord {
    const row = this.#database.one(
      "SELECT record_json FROM outbox WHERE command_id = ?",
      commandId,
    );
    if (row === undefined) {
      throw new Error(`Outbox for "${commandId}" was not found.`);
    }
    return OutboxRecordSchema.parse(parsed(row.record_json));
  }

  #payload(commandId: string): unknown {
    const row = this.#database.one(
      "SELECT effect_payload_json FROM commands WHERE id = ?",
      commandId,
    );
    return parsed(row?.effect_payload_json);
  }
}
