export type PromptMode = "plan" | "propose" | "apply";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type PermissionPolicy = "inspect-only" | "approval" | "full-access";

export interface CanvasModelOption {
  readonly id: string;
  readonly label: string;
  readonly provider: "OpenAI";
}

export interface CanvasHarnessOption {
  readonly disabled?: boolean;
  readonly id: string;
  readonly label: string;
}

export const CANVAS_HARNESSES: readonly CanvasHarnessOption[] = [
  { id: "memoire", label: "Mémoire" },
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
  { id: "gemini", label: "Gemini" },
  { id: "ollama", label: "Ollama" },
  { id: "hermes", label: "Hermes" },
  { id: "shell", label: "Shell", disabled: true },
];

export const CANVAS_MODELS: readonly CanvasModelOption[] = [
  { id: "gpt-5.5", label: "GPT-5.5", provider: "OpenAI" },
  { id: "gpt-5.4", label: "GPT-5.4", provider: "OpenAI" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", provider: "OpenAI" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", provider: "OpenAI" },
];

export const SAFE_CANVAS_AGENT_DEFAULTS = Object.freeze({
  modelId: "gpt-5.5",
  reasoningEffort: "xhigh" as ReasoningEffort,
  permissionPolicy: "approval" as PermissionPolicy,
  promptMode: "plan" as PromptMode,
  planFirst: true,
  requireComputerApproval: true,
  webSearch: true,
  validateGitRepository: true,
  allowedBrowser: "Helium",
});
