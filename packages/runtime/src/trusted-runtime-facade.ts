import type { DurableCommand } from "../../protocol/src/index.js";

import type { RuntimeDatabase } from "./database.js";
import type { CanvasEffectCoordinator } from "./canvas-effect-coordinator.js";
import type { LeaseStore } from "./lease-store.js";
import type { TargetScheduleStore } from "./target-schedule-store.js";
import { TrustedExecutionRuntime } from "./trusted-execution-runtime.js";
import type { ApprovalTrustRoot } from "./types.js";

export abstract class TrustedRuntimeFacade {
  #trustedExecution: TrustedExecutionRuntime | undefined;

  protected initializeTrustedExecution(input: {
    readonly database: RuntimeDatabase;
    readonly leases: LeaseStore;
    readonly schedule: TargetScheduleStore;
    readonly clock: () => string;
    readonly roots: readonly ApprovalTrustRoot[];
    readonly allowCanvas: boolean;
    readonly allowInvalidLegacyCanvasPayload: boolean;
    readonly canvasEffects: CanvasEffectCoordinator | undefined;
  }): void {
    if (this.#trustedExecution !== undefined) {
      throw new Error("Trusted execution runtime is already initialized.");
    }
    this.#trustedExecution = new TrustedExecutionRuntime(
      input.database,
      input.leases,
      input.schedule,
      input.clock,
      input.roots,
      input.allowCanvas,
      input.allowInvalidLegacyCanvasPayload,
      input.canvasEffects,
    );
  }

  reserveTrustedCommandAuthority(input: unknown) {
    return this.#trusted().reserve(input);
  }

  issueTrustedCommandAuthority(input: unknown) {
    return this.#trusted().issue(input);
  }

  getExecutionAuthoritySnapshot(input: unknown) {
    return this.#trusted().snapshot(input);
  }

  claimCommandEffect(input: {
    readonly commandId: DurableCommand["id"];
    readonly workerId: string;
    readonly claimTtlMilliseconds: number;
  }) {
    return this.#trusted().claimCommand(input);
  }

  protected assertTrustedCommand(
    command: DurableCommand,
    payload?: unknown,
  ): void {
    this.#trusted().assertCommand(command, payload);
  }

  protected assertTrustedRecovery(): void {
    this.#trusted().assertRecovery();
  }

  #trusted(): TrustedExecutionRuntime {
    if (this.#trustedExecution === undefined) {
      throw new Error("Trusted execution runtime is not initialized.");
    }
    return this.#trustedExecution;
  }
}
