import { describe, expect, it } from "vitest";

import {
  DEFAULT_GLOBAL_AGENT_SETTINGS,
  GLOBAL_AGENT_SETTINGS_KEY,
  createGlobalAgentSettingsPersistence,
  globalHarnessDefinition,
  type GlobalAgentSettingsStorage,
} from "./global-settings.js";

function memoryStorage(
  initial: Readonly<Record<string, string>> = {},
): GlobalAgentSettingsStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("global agent settings persistence", () => {
  it("round-trips bounded safe settings without runtime connection claims", () => {
    const storage = memoryStorage();
    const persistence = createGlobalAgentSettingsPersistence(storage);
    const settings = {
      ...DEFAULT_GLOBAL_AGENT_SETTINGS,
      harnessId: "claude-code" as const,
      modelId: "claude-adapter-default" as const,
      reasoningEffort: "medium" as const,
      permissionPolicy: "inspect-only" as const,
    };

    expect(persistence.save(settings)).toBe(true);
    expect(persistence.load()).toEqual(settings);
    expect(storage.values.get(GLOBAL_AGENT_SETTINGS_KEY)).not.toContain(
      "connected",
    );
  });

  it("uses the safe catalog fallback and treats missing storage as unset", () => {
    const storage = memoryStorage();
    expect(createGlobalAgentSettingsPersistence(storage).load()).toBeNull();
    expect(
      globalHarnessDefinition("not-a-harness" as never).id,
    ).toBe("codex");
  });

  it.each([
    [
      "unknown fields",
      {
        ...DEFAULT_GLOBAL_AGENT_SETTINGS,
        unexpected: "unsafe",
      },
    ],
    [
      "unsupported harness",
      {
        ...DEFAULT_GLOBAL_AGENT_SETTINGS,
        harnessId: "remote-shell",
      },
    ],
    [
      "model and harness mismatch",
      {
        ...DEFAULT_GLOBAL_AGENT_SETTINGS,
        harnessId: "ollama",
        modelId: "gpt-5.5",
      },
    ],
    [
      "unsafe browser",
      {
        ...DEFAULT_GLOBAL_AGENT_SETTINGS,
        allowedBrowser: "Chrome",
      },
    ],
    [
      "weakened browser policy",
      {
        ...DEFAULT_GLOBAL_AGENT_SETTINGS,
        browserPolicy: "any-url",
      },
    ],
  ])("fails closed on %s", (_label, value) => {
    const storage = memoryStorage({
      [GLOBAL_AGENT_SETTINGS_KEY]: JSON.stringify(value),
    });

    expect(createGlobalAgentSettingsPersistence(storage).load()).toBeNull();
  });

  it("rejects oversized and malformed records without throwing", () => {
    const oversizedStorage = memoryStorage({
      [GLOBAL_AGENT_SETTINGS_KEY]: JSON.stringify({
        ...DEFAULT_GLOBAL_AGENT_SETTINGS,
        padding: "x".repeat(10_000),
      }),
    });
    const malformedStorage = memoryStorage({
      [GLOBAL_AGENT_SETTINGS_KEY]: "{not-json",
    });

    expect(
      createGlobalAgentSettingsPersistence(oversizedStorage).load(),
    ).toBeNull();
    expect(
      createGlobalAgentSettingsPersistence(malformedStorage).load(),
    ).toBeNull();
  });

  it("contains storage failures and preserves safe defaults", () => {
    const persistence = createGlobalAgentSettingsPersistence({
      getItem: () => {
        throw new Error("storage denied");
      },
      setItem: () => {
        throw new Error("storage denied");
      },
    });

    expect(persistence.load()).toBeNull();
    expect(persistence.save(DEFAULT_GLOBAL_AGENT_SETTINGS)).toBe(false);
  });

  it("refuses to save a value that fails the strict schema", () => {
    const persistence = createGlobalAgentSettingsPersistence(memoryStorage());

    expect(
      persistence.save({
        ...DEFAULT_GLOBAL_AGENT_SETTINGS,
        modelId: "ollama-runtime-model",
      }),
    ).toBe(false);
  });
});
