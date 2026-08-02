import {
  TargetApplyOutcomeSchema,
  type DurableCommand,
  type OutboxRecord,
  type TargetReceipt,
} from "../../protocol/src/index.js";

import {
  rejectedLookup,
  validateLookupEvidence,
} from "./canvas-recovery-evidence.js";
import {
  CanvasEffectStore,
} from "./canvas-effect-store.js";
import type {
  CanvasTargetAdapter,
  RuntimeFaults,
  WorkerClaim,
} from "./types.js";

export type CanvasRecoveryResult =
  | OutboxRecord
  | "retry"
  | "blocked"
  | undefined;

export class CanvasEffectCoordinator {
  readonly #store: CanvasEffectStore;
  readonly #target: CanvasTargetAdapter;
  readonly #faults: RuntimeFaults | undefined;

  constructor(
    store: CanvasEffectStore,
    target: CanvasTargetAdapter,
    faults?: RuntimeFaults,
  ) {
    this.#store = store;
    this.#target = target;
    this.#faults = faults;
  }

  async apply(claim: WorkerClaim): Promise<OutboxRecord> {
    const prepared = this.#store.prepare(claim);
    let outcome;
    try {
      outcome = TargetApplyOutcomeSchema.parse(
        await this.#target.compareAndApply(prepared.request),
      );
    } catch (error) {
      this.#store.recordUnknown(prepared);
      throw error;
    }
    if (
      outcome.status === "applied" ||
      outcome.status === "replayed"
    ) {
      try {
        return this.#store.recordApplied(
          prepared,
          outcome.receipt,
        );
      } catch (error) {
        this.#store.recordUnknown(prepared, {
          status: "receipt-persistence-failed",
          message:
            error instanceof Error
              ? error.message
              : "Target receipt persistence failed.",
        });
        throw error;
      }
    }
    if (outcome.status === "not-applied") {
      this.#store.recordNotApplied(
        prepared,
        outcome.evidence.message,
      );
      throw new Error(outcome.evidence.message);
    }
    this.#store.recordUnknown(prepared, outcome);
    throw new Error(outcome.error.message);
  }

  async reconcileNext(
    commandId?: DurableCommand["id"],
  ): Promise<CanvasRecoveryResult> {
    const candidate = this.#store.nextRecovery(commandId);
    if (candidate === undefined) {
      return undefined;
    }
    this.#faults?.afterRecoveryChallengePersisted?.();
    let validation;
    try {
      validation = validateLookupEvidence(
        candidate.lookup,
        await this.#target.lookup(candidate.lookup),
        this.#store.now(),
      );
    } catch (error) {
      validation = rejectedLookup(
        {
          kind: "target-lookup-threw",
          message:
            error instanceof Error
              ? error.message.slice(0, 256)
              : "Target lookup failed.",
        },
        "Target lookup threw before returning evidence.",
      );
    }
    if (!validation.accepted) {
      this.#store.recordRejectedEvidence(
        candidate,
        validation.reason,
        validation.responseHash,
      );
      return "blocked";
    }
    const result = validation.result;
    if (result.status === "found") {
      try {
        this.#store.assertRecoveredFound(candidate, result);
      } catch {
        this.#store.recordRejectedEvidence(
          candidate,
          "Target found receipt did not match the durable request.",
          validation.responseHash,
        );
        return "blocked";
      }
      return this.#store.recordRecoveredApplied(
        candidate,
        result,
      );
    }
    if (
      result.status === "not-found" &&
      result.currentTargetHash ===
        candidate.command.target.expectedBeforeHash
    ) {
      this.#store.releaseVerifiedNotApplied(candidate, result);
      return "retry";
    }
    this.#store.recordBlockedEvidence(candidate, result);
    return "blocked";
  }

  getReceipt(
    commandId: DurableCommand["id"],
  ): TargetReceipt | undefined {
    return this.#store.getReceipt(commandId);
  }
}
