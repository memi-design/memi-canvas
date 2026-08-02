import { describe, expect, it } from "vitest";

import {
  FakeHarnessAdapter,
  HarnessRegistry,
  HarnessSelectionError,
} from "../src/index.js";
import { fakeHarnessOptions } from "./fixtures.js";

function adapter(
  harnessId: string,
  capabilities: readonly string[] = ["text", "tools"],
) {
  return new FakeHarnessAdapter({
    ...fakeHarnessOptions(),
    descriptor: {
      harnessId,
      displayName: harnessId,
      capabilities,
      models: [`${harnessId}-model`],
    },
    modelId: `${harnessId}-model`,
  });
}

describe("explicit harness selection", () => {
  it("selects the exact requested harness without consulting ranking", () => {
    const requested = adapter("requested");
    const alternative = adapter("alternative");
    const registry = new HarnessRegistry([alternative, requested]);

    const selection = registry.select({
      mode: "locked",
      harnessId: "requested",
      requiredCapabilities: ["tools"],
    });

    expect(selection.adapter).toBe(requested);
    expect(selection.reason).toBe("user-selected");
    expect(selection.candidates).toEqual([
      {
        harnessId: "requested",
        eligible: true,
        selected: true,
        reason: "user-selected",
      },
    ]);
  });

  it("fails truthfully instead of falling back when the requested harness is unavailable", () => {
    const registry = new HarnessRegistry([adapter("available")]);

    expect(() =>
      registry.select({
        mode: "locked",
        harnessId: "missing",
        requiredCapabilities: ["tools"],
      }),
    ).toThrow(
      expect.objectContaining<Partial<HarnessSelectionError>>({
        code: "HARNESS_UNAVAILABLE",
        harnessId: "missing",
      }),
    );
  });

  it("fails when the requested harness lacks a required capability", () => {
    const registry = new HarnessRegistry([adapter("text-only", ["text"])]);

    expect(() =>
      registry.select({
        mode: "locked",
        harnessId: "text-only",
        requiredCapabilities: ["tools"],
      }),
    ).toThrow(
      expect.objectContaining<Partial<HarnessSelectionError>>({
        code: "HARNESS_CAPABILITY_MISMATCH",
        harnessId: "text-only",
      }),
    );
  });

  it("rejects duplicate harness identifiers during registration", () => {
    expect(
      () =>
        new HarnessRegistry([
          adapter("duplicate"),
          adapter("duplicate"),
        ]),
    ).toThrow(
      expect.objectContaining<Partial<HarnessSelectionError>>({
        code: "HARNESS_DUPLICATE",
        harnessId: "duplicate",
      }),
    );
  });
});
