import { z } from "zod";

export const GLOBAL_AGENT_SETTINGS_KEY = "memi.global-agent-settings.v1";
const MAX_SETTINGS_BYTES = 4_096;

export type GlobalHarnessId =
  | "claude-code"
  | "codex"
  | "gemini"
  | "ollama"
  | "opencode";
export type GlobalModelId =
  | "claude-adapter-default"
  | "gemini-adapter-default"
  | "gpt-5.4"
  | "gpt-5.4-mini"
  | "gpt-5.5"
  | "ollama-runtime-model"
  | "opencode-adapter-default";
export type GlobalReasoningEffort = "high" | "low" | "medium" | "xhigh";
export type GlobalPermissionPolicy =
  | "approval"
  | "full-access"
  | "inspect-only";

export interface GlobalModelDefinition {
  readonly id: GlobalModelId;
  readonly label: string;
  readonly note: string;
}

export interface GlobalHarnessDefinition {
  readonly compatibility: "declared";
  readonly id: GlobalHarnessId;
  readonly label: string;
  readonly models: readonly GlobalModelDefinition[];
  readonly note: string;
}

export interface GlobalAgentSettings {
  readonly allowedBrowser: "Helium";
  readonly browserPolicy: "localhost-explicit-port";
  readonly harnessId: GlobalHarnessId;
  readonly kind: "memi-global-agent-settings";
  readonly modelId: GlobalModelId;
  readonly permissionPolicy: GlobalPermissionPolicy;
  readonly planFirst: true;
  readonly reasoningEffort: GlobalReasoningEffort;
  readonly requireComputerApproval: true;
  readonly schemaVersion: 1;
}

export interface AdapterRuntimeConnection {
  readonly harnessId: GlobalHarnessId;
  readonly runtimeLabel?: string;
  readonly state: "connected" | "disconnected";
}

export interface GlobalAgentSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface GlobalAgentSettingsPersistence {
  load(): GlobalAgentSettings | null;
  save(settings: GlobalAgentSettings): boolean;
}

export const GLOBAL_HARNESS_CATALOG: readonly GlobalHarnessDefinition[] = [
  {
    id: "codex",
    label: "Codex",
    compatibility: "declared",
    note:
      "Declared in Memi's local compatibility catalog; not runtime-verified.",
    models: [
      {
        id: "gpt-5.5",
        label: "GPT-5.5",
        note: "Declared locally; the runtime has not verified availability.",
      },
      {
        id: "gpt-5.4",
        label: "GPT-5.4",
        note: "Declared locally; the runtime has not verified availability.",
      },
      {
        id: "gpt-5.4-mini",
        label: "GPT-5.4 mini",
        note: "Declared locally; the runtime has not verified availability.",
      },
    ],
  },
  {
    id: "claude-code",
    label: "Claude Code",
    compatibility: "declared",
    note:
      "Declared in Memi's local compatibility catalog; not runtime-verified.",
    models: [
      {
        id: "claude-adapter-default",
        label: "Adapter default",
        note: "The connected runtime must resolve the exact model.",
      },
    ],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    compatibility: "declared",
    note:
      "Declared in Memi's local compatibility catalog; not runtime-verified.",
    models: [
      {
        id: "gemini-adapter-default",
        label: "Adapter default",
        note: "The connected runtime must resolve the exact model.",
      },
    ],
  },
  {
    id: "opencode",
    label: "OpenCode",
    compatibility: "declared",
    note:
      "Declared in Memi's local compatibility catalog; not runtime-verified.",
    models: [
      {
        id: "opencode-adapter-default",
        label: "Adapter default",
        note: "The connected runtime must resolve the exact model.",
      },
    ],
  },
  {
    id: "ollama",
    label: "Ollama",
    compatibility: "declared",
    note:
      "Declared in Memi's local compatibility catalog; not runtime-verified.",
    models: [
      {
        id: "ollama-runtime-model",
        label: "Runtime-selected local model",
        note: "A connected Ollama runtime must provide the model name.",
      },
    ],
  },
];

export const DEFAULT_GLOBAL_AGENT_SETTINGS: GlobalAgentSettings =
  Object.freeze({
    schemaVersion: 1,
    kind: "memi-global-agent-settings",
    harnessId: "codex",
    modelId: "gpt-5.5",
    reasoningEffort: "xhigh",
    permissionPolicy: "approval",
    planFirst: true,
    requireComputerApproval: true,
    allowedBrowser: "Helium",
    browserPolicy: "localhost-explicit-port",
  });

const GlobalAgentSettingsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("memi-global-agent-settings"),
    harnessId: z.enum([
      "claude-code",
      "codex",
      "gemini",
      "ollama",
      "opencode",
    ]),
    modelId: z.enum([
      "claude-adapter-default",
      "gemini-adapter-default",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.5",
      "ollama-runtime-model",
      "opencode-adapter-default",
    ]),
    reasoningEffort: z.enum(["high", "low", "medium", "xhigh"]),
    permissionPolicy: z.enum([
      "approval",
      "full-access",
      "inspect-only",
    ]),
    planFirst: z.literal(true),
    requireComputerApproval: z.literal(true),
    allowedBrowser: z.literal("Helium"),
    browserPolicy: z.literal("localhost-explicit-port"),
  })
  .superRefine((settings, context) => {
    const harness = GLOBAL_HARNESS_CATALOG.find(
      ({ id }) => id === settings.harnessId,
    );
    if (!harness?.models.some(({ id }) => id === settings.modelId)) {
      context.addIssue({
        code: "custom",
        message: "Selected model is not declared for this harness.",
        path: ["modelId"],
      });
    }
  });

export function globalHarnessDefinition(
  harnessId: GlobalHarnessId,
): GlobalHarnessDefinition {
  return (
    GLOBAL_HARNESS_CATALOG.find(({ id }) => id === harnessId) ??
    GLOBAL_HARNESS_CATALOG[0]!
  );
}

export function settingsForHarness(
  current: GlobalAgentSettings,
  harnessId: GlobalHarnessId,
): GlobalAgentSettings {
  const harness = globalHarnessDefinition(harnessId);
  return {
    ...current,
    harnessId,
    modelId: harness.models[0]!.id,
  };
}

export function validateGlobalAgentSettings(
  value: unknown,
): GlobalAgentSettings | null {
  const parsed = GlobalAgentSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createGlobalAgentSettingsPersistence(
  storage: GlobalAgentSettingsStorage,
): GlobalAgentSettingsPersistence {
  return {
    load() {
      try {
        const serialized = storage.getItem(GLOBAL_AGENT_SETTINGS_KEY);
        if (
          serialized === null ||
          new TextEncoder().encode(serialized).byteLength > MAX_SETTINGS_BYTES
        ) {
          return null;
        }
        return validateGlobalAgentSettings(JSON.parse(serialized));
      } catch {
        return null;
      }
    },
    save(settings) {
      try {
        const validated = validateGlobalAgentSettings(settings);
        if (validated === null) {
          return false;
        }
        const serialized = JSON.stringify(validated);
        if (
          new TextEncoder().encode(serialized).byteLength > MAX_SETTINGS_BYTES
        ) {
          return false;
        }
        storage.setItem(GLOBAL_AGENT_SETTINGS_KEY, serialized);
        return true;
      } catch {
        return false;
      }
    },
  };
}
