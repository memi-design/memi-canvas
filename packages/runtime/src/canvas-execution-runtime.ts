import { AuthorityStore } from "./authority-store.js";
import { CanvasEffectCoordinator } from "./canvas-effect-coordinator.js";
import { CanvasEffectStore } from "./canvas-effect-store.js";
import { CanvasFenceCoordinator } from "./canvas-fence-coordinator.js";
import { RuntimeDatabase } from "./database.js";
import { LeaseStore } from "./lease-store.js";
import { secureRecoveryChallengeFactory } from "./recovery-challenge.js";
import type { DurableRuntimeOptions } from "./types.js";

export function createCanvasExecutionRuntime(
  database: RuntimeDatabase,
  authority: AuthorityStore,
  leases: LeaseStore,
  options: DurableRuntimeOptions,
): {
  readonly fence: CanvasFenceCoordinator | undefined;
  readonly effects: CanvasEffectCoordinator | undefined;
} {
  if (options.canvasTarget === undefined) {
    return { fence: undefined, effects: undefined };
  }
  return {
    fence: new CanvasFenceCoordinator(
      leases,
      options.canvasTarget,
      options.runtimeFaults,
    ),
    effects: new CanvasEffectCoordinator(
      new CanvasEffectStore(
        database,
        authority,
        leases,
        options.clock,
        options.policyValidator,
        options.recoveryChallengeFactory ??
          secureRecoveryChallengeFactory,
      ),
      options.canvasTarget,
      options.runtimeFaults,
    ),
  };
}
