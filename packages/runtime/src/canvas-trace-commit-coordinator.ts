import {
  validateTargetVerificationEvidence,
  type TargetVerificationResult,
} from "../../protocol/src/index.js";
import { canonicalJson } from "@memi/canonical-json";
import { EffectVerificationError } from "./errors.js";
import type {
  CanvasTargetAdapter,
  CommittedEffectReceipt,
  VerifyAndCommitRequest,
} from "./types.js";
import { CanvasTraceCommitStore } from "./canvas-trace-commit-store.js";

export class CanvasTraceCommitCoordinator {
  readonly #store: CanvasTraceCommitStore;
  readonly #target: CanvasTargetAdapter;

  constructor(
    store: CanvasTraceCommitStore,
    target: CanvasTargetAdapter,
  ) {
    this.#store = store;
    this.#target = target;
  }

  async verifyAndCommit(
    input: VerifyAndCommitRequest,
  ): Promise<CommittedEffectReceipt> {
    this.#store.assertRequest(input);
    const replay = this.#store.replay(input.claim);
    if (replay !== undefined) {
      return replay;
    }
    const prepared = this.#store.prepareVerification(input.claim);
    let result: TargetVerificationResult;
    try {
      result = await this.#target.verify(prepared.request);
    } catch (error) {
      this.#store.rejectVerification(
        prepared,
        error instanceof Error ? error.message : "Target unavailable.",
      );
      throw new EffectVerificationError(
        "EFFECT_VERIFICATION_MISMATCH",
        "Canvas target verification failed.",
      );
    }
    let validation;
    try {
      validation = validateTargetVerificationEvidence(
        prepared.request,
        result,
        this.#store.now(),
      );
    } catch {
      this.#store.rejectVerification(
        prepared,
        "Target verification response could not be inspected.",
      );
      throw new EffectVerificationError(
        "EFFECT_VERIFICATION_MISMATCH",
        "Canvas target verification was malformed.",
      );
    }
    if (
      !validation.accepted ||
      validation.result.status !== "verified-applied" ||
      validation.result.receipt.receiptHash !==
        prepared.targetReceipt.receiptHash ||
      validation.result.currentTargetHash !==
        prepared.targetReceipt.resultingHash ||
      canonicalJson(validation.result.receipt) !==
        canonicalJson(prepared.targetReceipt)
    ) {
      this.#store.rejectVerification(
        prepared,
        validation.accepted
          ? "Target did not verify the exact applied receipt."
          : validation.reason,
        result,
      );
      throw new EffectVerificationError(
        "EFFECT_VERIFICATION_MISMATCH",
        "Canvas target verification did not match durable authority.",
      );
    }
    return this.#store.commit(prepared, validation.result);
  }
}
