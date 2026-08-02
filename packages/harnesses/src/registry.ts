import type {
  HarnessAdapter,
  HarnessSelection,
  LockedHarnessSelectionRequest,
} from "./types.js";

export type HarnessSelectionErrorCode =
  | "HARNESS_UNAVAILABLE"
  | "HARNESS_CAPABILITY_MISMATCH"
  | "HARNESS_DUPLICATE";

export class HarnessSelectionError extends Error {
  readonly code: HarnessSelectionErrorCode;
  readonly harnessId: string;

  constructor(
    code: HarnessSelectionErrorCode,
    harnessId: string,
    message: string,
  ) {
    super(message);
    this.name = "HarnessSelectionError";
    this.code = code;
    this.harnessId = harnessId;
  }
}

export class HarnessRegistry {
  readonly #adapters: ReadonlyMap<string, HarnessAdapter>;

  constructor(adapters: readonly HarnessAdapter[]) {
    const byId = new Map<string, HarnessAdapter>();

    for (const adapter of adapters) {
      const harnessId = adapter.descriptor.harnessId;

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

  select(request: LockedHarnessSelectionRequest): HarnessSelection {
    const selected = this.#adapters.get(request.harnessId);

    if (selected === undefined) {
      throw new HarnessSelectionError(
        "HARNESS_UNAVAILABLE",
        request.harnessId,
        `The explicitly selected harness "${request.harnessId}" is unavailable.`,
      );
    }

    const missingCapabilities = request.requiredCapabilities.filter(
      (capability) =>
        !selected.descriptor.capabilities.includes(capability),
    );

    if (missingCapabilities.length > 0) {
      throw new HarnessSelectionError(
        "HARNESS_CAPABILITY_MISMATCH",
        request.harnessId,
        `Harness "${request.harnessId}" lacks: ${missingCapabilities.join(", ")}.`,
      );
    }

    return Object.freeze({
      adapter: selected,
      reason: "user-selected",
      candidates: Object.freeze([
        Object.freeze({
          harnessId: request.harnessId,
          eligible: true,
          selected: true,
          reason: "user-selected",
        }),
      ]),
    });
  }
}
