import type {
  DurableHarnessAdapter,
  DurableHarnessSelection,
  DurableHarnessSelectionRequest,
} from "./durable-types.js";
import { HarnessSelectionError } from "./registry.js";

function hasCapabilities(
  adapter: DurableHarnessAdapter,
  required: readonly string[],
): boolean {
  return required.every((capability) =>
    adapter.descriptor.capabilities.includes(capability),
  );
}

export class DurableHarnessRegistry {
  readonly #adapters: ReadonlyMap<string, DurableHarnessAdapter>;

  constructor(adapters: readonly DurableHarnessAdapter[]) {
    const byId = new Map<string, DurableHarnessAdapter>();
    for (const adapter of adapters) {
      const { harnessId } = adapter.descriptor;
      if (byId.has(harnessId)) {
        throw new HarnessSelectionError(
          "HARNESS_DUPLICATE",
          harnessId,
          `Harness "${harnessId}" is registered more than once.`,
        );
      }
      byId.set(harnessId, adapter);
    }
    this.#adapters = byId;
  }

  get(harnessId: string): DurableHarnessAdapter | undefined {
    return this.#adapters.get(harnessId);
  }

  select(
    request: DurableHarnessSelectionRequest,
  ): DurableHarnessSelection {
    if (request.mode === "locked") {
      const adapter = this.#adapters.get(request.harnessId);
      if (adapter === undefined) {
        throw new HarnessSelectionError(
          "HARNESS_UNAVAILABLE",
          request.harnessId,
          `The explicitly selected harness "${request.harnessId}" is unavailable.`,
        );
      }
      if (!hasCapabilities(adapter, request.requiredCapabilities)) {
        throw new HarnessSelectionError(
          "HARNESS_CAPABILITY_MISMATCH",
          request.harnessId,
          `Harness "${request.harnessId}" lacks required capabilities.`,
        );
      }
      return {
        adapter,
        reason: "user-selected",
        candidates: [
          {
            harnessId: adapter.descriptor.harnessId,
            eligible: true,
            selected: true,
          },
        ],
      };
    }

    const ranked = [...this.#adapters.values()].sort(
      (left, right) =>
        left.descriptor.autoPriority - right.descriptor.autoPriority ||
        left.descriptor.harnessId.localeCompare(
          right.descriptor.harnessId,
          "en",
        ),
    );
    const selected = ranked.find((adapter) =>
      hasCapabilities(adapter, request.requiredCapabilities),
    );
    if (selected === undefined) {
      throw new HarnessSelectionError(
        "HARNESS_UNAVAILABLE",
        "auto",
        "No harness satisfies the automatic selection requirements.",
      );
    }
    return {
      adapter: selected,
      reason: "deterministic-auto",
      candidates: ranked.map((adapter) => ({
        harnessId: adapter.descriptor.harnessId,
        eligible: hasCapabilities(
          adapter,
          request.requiredCapabilities,
        ),
        selected: adapter === selected,
      })),
    };
  }
}
