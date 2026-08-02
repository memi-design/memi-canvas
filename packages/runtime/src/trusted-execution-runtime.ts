import {
  DurableCommandIdSchema,
  DurableCommandSchema,
  type DurableCommand,
} from "../../protocol/src/index.js";

import { RuntimeDatabase } from "./database.js";
import type { CanvasEffectCoordinator } from "./canvas-effect-coordinator.js";
import { ExecutionAuthorityStore } from "./execution-authority-store.js";
import { LeaseStore } from "./lease-store.js";
import { parsed, rowText } from "./runtime-records.js";
import { TargetScheduleStore } from "./target-schedule-store.js";
import { TrustedAuthorityStore } from "./trusted-authority-store.js";
import type {
  ApprovalTrustRoot,
  WorkerClaim,
} from "./types.js";

export class TrustedExecutionRuntime {
  readonly #clock: () => string;
  readonly #database: RuntimeDatabase;
  readonly #evidence: ExecutionAuthorityStore;
  readonly #schedule: TargetScheduleStore;
  readonly #trusted: TrustedAuthorityStore;
  readonly #allowCanvas: boolean;
  readonly #canvasEffects: CanvasEffectCoordinator | undefined;

  constructor(
    database: RuntimeDatabase,
    leases: LeaseStore,
    schedule: TargetScheduleStore,
    clock: () => string,
    roots: readonly ApprovalTrustRoot[],
    allowCanvas: boolean,
    allowInvalidLegacyCanvasPayload: boolean,
    canvasEffects?: CanvasEffectCoordinator,
  ) {
    this.#clock = clock;
    this.#database = database;
    this.#schedule = schedule;
    this.#allowCanvas = allowCanvas;
    this.#canvasEffects = canvasEffects;
    this.#trusted = new TrustedAuthorityStore(
      database,
      leases,
      clock,
      roots,
      allowInvalidLegacyCanvasPayload,
    );
    this.#evidence = new ExecutionAuthorityStore(
      database,
      this.#trusted,
    );
  }

  reserve(input: unknown) {
    return this.#trusted.reserve(input);
  }

  issue(input: unknown) {
    return this.#trusted.issue(input);
  }

  snapshot(input: unknown) {
    return this.#evidence.snapshot(input);
  }

  assertCommand(command: DurableCommand, payload?: unknown): void {
    this.#trusted.assertCommand(command, payload);
  }

  assertRecovery(): void {
    this.#trusted.assertPendingCommands();
  }

  async claimCommand(input: {
    readonly commandId: DurableCommand["id"];
    readonly workerId: string;
    readonly claimTtlMilliseconds: number;
  }): Promise<WorkerClaim> {
    const commandId = DurableCommandIdSchema.parse(input.commandId);
    if (
      input.workerId.trim().length === 0 ||
      !Number.isSafeInteger(input.claimTtlMilliseconds) ||
      input.claimTtlMilliseconds <= 0
    ) {
      throw new RangeError(
        "Command claim requires a worker and positive integer TTL.",
      );
    }
    const claim = this.#claimCommand(input, commandId);
    if (claim !== "recovery-required") {
      return claim;
    }
    const recovery = await this.#canvasEffects?.reconcileNext(
      commandId,
    );
    if (recovery !== "retry") {
      throw new Error(
        "Exact command claim requires accepted not-applied recovery evidence.",
      );
    }
    const recoveredClaim = this.#claimCommand(input, commandId);
    if (recoveredClaim === "recovery-required") {
      throw new Error(
        "Exact command recovery did not release its prior claim.",
      );
    }
    return recoveredClaim;
  }

  #claimCommand(
    input: {
      readonly workerId: string;
      readonly claimTtlMilliseconds: number;
    },
    commandId: DurableCommand["id"],
  ): WorkerClaim | "recovery-required" {
    return this.#database.transaction(() => {
      const commandRow = this.#database.one(
        "SELECT command_json FROM commands WHERE id = ?",
        commandId,
      );
      if (commandRow === undefined) {
        throw new Error(`Command "${commandId}" was not found.`);
      }
      const command = DurableCommandSchema.parse(
        parsed(commandRow.command_json),
      );
      this.#trusted.assertCommand(command);
      const now = this.#clock();
      const candidate = this.#schedule.exactCandidate(
        commandId,
        now,
        this.#allowCanvas,
      );
      if (candidate === undefined) {
        throw new Error(
          "Exact command claim conflicts with target queue order or state.",
        );
      }
      if (candidate.hadClaim) {
        return "recovery-required";
      }
      const fencingEpoch =
        Number(candidate.row.claim_epoch) + 1;
      const expiresAt = new Date(
        Date.parse(now) + input.claimTtlMilliseconds,
      ).toISOString();
      const claimed = this.#schedule.claim(
        candidate,
        input.workerId,
        fencingEpoch,
        expiresAt,
        now,
      );
      if (rowText(candidate.row, "command_id") !== commandId) {
        throw new Error("Exact command claim selected another command.");
      }
      return claimed;
    });
  }
}
