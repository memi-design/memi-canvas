import type { DurableCommand } from "../../protocol/src/index.js";
import { CanvasTraceCommitCoordinator } from "./canvas-trace-commit-coordinator.js";
import { CanvasTraceCommitStore } from "./canvas-trace-commit-store.js";
import { RuntimeDatabase } from "./database.js";
import { LeaseStore } from "./lease-store.js";
import { secureRecoveryChallengeFactory } from "./recovery-challenge.js";
import { secureTraceEventIdFactory } from "./trace-event-id.js";
import type {
  CommitClaim,
  CommitClaimRequest,
  CommittedEffectReceipt,
  DurableRuntimeOptions,
  VerifyAndCommitRequest,
} from "./types.js";

export class CanvasTraceRuntime {
  readonly #store: CanvasTraceCommitStore;
  readonly #coordinator: CanvasTraceCommitCoordinator | undefined;

  constructor(
    database: RuntimeDatabase,
    leases: LeaseStore,
    options: DurableRuntimeOptions,
  ) {
    this.#store = new CanvasTraceCommitStore(
      database,
      leases,
      options.clock,
      options.recoveryChallengeFactory ??
        secureRecoveryChallengeFactory,
      options.traceEventIdFactory ?? secureTraceEventIdFactory,
      options.runtimeFaults,
    );
    this.#coordinator =
      options.canvasTarget === undefined
        ? undefined
        : new CanvasTraceCommitCoordinator(
            this.#store,
            options.canvasTarget,
          );
  }

  claim(
    input: CommitClaimRequest,
    allowLegacyCanvasFixture: boolean,
  ): CommitClaim | undefined {
    if (!this.#store.handles(input.commandId)) {
      return undefined;
    }
    if (this.#coordinator !== undefined) {
      return this.#store.claim(input);
    }
    if (allowLegacyCanvasFixture) {
      return undefined;
    }
    throw new Error(
      "Canonical canvas commit requires a CanvasTargetAdapter.",
    );
  }

  verifyAndCommit(
    input: VerifyAndCommitRequest,
    allowLegacyCanvasFixture: boolean,
  ): Promise<CommittedEffectReceipt> | undefined {
    if (!this.#store.handles(input.claim.commandId)) {
      return undefined;
    }
    if (this.#coordinator !== undefined) {
      return this.#coordinator.verifyAndCommit(input);
    }
    if (allowLegacyCanvasFixture) {
      return undefined;
    }
    return Promise.reject(
      new Error(
        "Canonical canvas commit requires a CanvasTargetAdapter.",
      ),
    );
  }

  receipt(
    commandId: DurableCommand["id"],
  ): CommittedEffectReceipt | undefined {
    return this.#isCanonical(commandId)
      ? this.#store.getReceipt(commandId)
      : undefined;
  }

  trace(commandId: DurableCommand["id"]) {
    return this.#isCanonical(commandId)
      ? this.#store.getTrace(commandId)
      : undefined;
  }

  replay(projectId: string) {
    return this.#store.replayProject(projectId);
  }

  audit(): void {
    this.#store.audit();
  }

  #isCanonical(commandId: DurableCommand["id"]): boolean {
    return (
      this.#store.handles(commandId) &&
      this.#store.hasCanonicalAuthority(commandId)
    );
  }
}
