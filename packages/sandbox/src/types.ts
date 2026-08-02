export type SandboxRunStatus =
  | "completed"
  | "denied"
  | "timed-out"
  | "output-limit-exceeded"
  | "provider-unavailable"
  | "failed";

export type SandboxRunReason =
  | "completed"
  | "unsupported-platform"
  | "provider-missing"
  | "executable-not-allowed"
  | "executable-symlink-prohibited"
  | "shell-interpreter-prohibited"
  | "environment-key-not-allowed"
  | "cwd-outside-writable-roots"
  | "symlink-root-prohibited"
  | "root-not-authorized"
  | "invalid-root"
  | "overlapping-roots"
  | "invalid-resource-bounds"
  | "request-too-large"
  | "security-gate-failed"
  | "timeout"
  | "aborted"
  | "stdout-limit-exceeded"
  | "stderr-limit-exceeded"
  | "spawn-error"
  | "nonzero-exit";

export interface SandboxAvailability {
  readonly providerId: "macos-sandbox-exec";
  readonly platform: string;
  readonly available: boolean;
  readonly enforced: boolean;
  readonly ready: boolean;
  readonly networkMode: "deny";
  readonly limitations: readonly string[];
}

export interface SandboxRunRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly sourceRoots: readonly string[];
  readonly worktreeRoot: string;
  readonly tempRoot: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly signal?: AbortSignal;
}

export interface SandboxOutput {
  readonly text: string;
  readonly capturedBytes: number;
  readonly observedBytes: number;
  readonly sha256: string;
  readonly truncated: boolean;
}

export interface SandboxProviderEvidence {
  readonly provider: "macos-sandbox-exec";
  readonly platform: "darwin";
  readonly enforcement: "enforced";
  readonly policyHash: string;
}

export interface SandboxCleanupEvidence {
  readonly verified: boolean;
  readonly scope: "not-started" | "process-group-only";
  readonly remainingDescendants: "none" | "unknown";
}

export interface SandboxRunResult {
  readonly providerId: "macos-sandbox-exec";
  readonly status: SandboxRunStatus;
  readonly reason: SandboxRunReason;
  readonly enforced: boolean;
  readonly providerEvidence: SandboxProviderEvidence | null;
  readonly cleanupEvidence: SandboxCleanupEvidence;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
  readonly stdout: SandboxOutput;
  readonly stderr: SandboxOutput;
}

export interface SandboxProvider {
  availability(): Promise<SandboxAvailability>;
  run(request: SandboxRunRequest): Promise<SandboxRunResult>;
}

export interface MacOSSandboxExecProviderOptions {
  readonly allowedExecutables: readonly string[];
  readonly allowedEnvironmentKeys: readonly string[];
  readonly authorizedSourceRoots: readonly string[];
  readonly authorizedWorktreeRoots: readonly string[];
  readonly authorizedTempRoots: readonly string[];
  readonly platform?: string;
  readonly sandboxExecutable?: string;
  readonly terminationGraceMs?: number;
  readonly feasibilityMode?: boolean;
}
