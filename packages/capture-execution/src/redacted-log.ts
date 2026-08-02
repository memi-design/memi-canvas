export interface BoundedLogOptions {
  readonly maximumEntries?: number;
  readonly maximumLength?: number;
}

const REDACTIONS: readonly [RegExp, string][] = [
  [
    /\b(https?:\/\/)[^/\s:@]+:[^@\s/]+@/giu,
    "$1[URL_CREDENTIAL_REDACTED]@",
  ],
  [
    /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|A(?:KIA|SIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,})\b/gu,
    "[PROVIDER_CREDENTIAL_REDACTED]",
  ],
  [/\b(?:authorization\s*:\s*)?bearer\s+\S+/giu, "Bearer [REDACTED]"],
  [/\bauthorization\s*:\s*basic\s+\S+/giu, "Authorization: Basic [REDACTED]"],
  [/\b(?:cookie|set-cookie)\s*:\s*[^\r\n]+/giu, "[COOKIE_REDACTED]"],
  [
    /\b(?:access[_-]?token|refresh[_-]?token|token|secret|password|api[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[^\s"',}]+["']?/giu,
    "[SECRET_REDACTED]",
  ],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, "[JWT_REDACTED]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, "[PRIVATE_KEY_REDACTED]"],
  [/(?:\/Users|\/home|\/Volumes)\/[^/\s]+(?:\/[^\s]*)?/gu, "[PATH_REDACTED]"],
  [/\b[A-Z]:\\Users\\[^\\\s]+(?:\\[^\s]*)?/giu, "[PATH_REDACTED]"],
  [/([?&](?:token|secret|password|api[_-]?key)=)[^&#\s]+/giu, "$1[REDACTED]"],
  [/\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/giu, "[EMAIL_REDACTED]"],
] as const;

export function redactLogMessage(
  value: string,
  maximumLength = 2_048,
): string {
  const withoutControls = Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code >= 0x20 || character === "\t");
    })
    .join("");
  const redacted = REDACTIONS.reduce(
    (message, [pattern, replacement]) =>
      message.replace(pattern, replacement),
    withoutControls,
  );
  if (redacted.length <= maximumLength) {
    return redacted;
  }
  const lines = redacted.split(/\r?\n/u);
  const diagnosticIndex = lines.findIndex((line) =>
    /^\s*(?:\[!\]|(?:error|failed|denied|not permitted|no such file|command not found|invalid)\b)/iu.test(line),
  );
  if (diagnosticIndex !== -1) {
    const diagnostic = lines.slice(diagnosticIndex, diagnosticIndex + 5)
      .join("\n");
    const prefixLength = Math.min(
      diagnostic.length,
      Math.floor(maximumLength * 0.6),
    );
    const prefix = diagnostic.slice(0, prefixLength);
    const tailLength = maximumLength - prefix.length - 1;
    return `${prefix}…${redacted.slice(-tailLength)}`;
  }
  // External tools often print setup progress before the actionable failure.
  // Keep the end of an already-redacted message so users can diagnose and
  // retry a capture without retaining an unbounded process transcript.
  return `…${redacted.slice(-(maximumLength - 1))}`;
}

export class BoundedRedactedLog {
  readonly #maximumEntries: number;
  readonly #maximumLength: number;
  #entries: readonly string[] = Object.freeze([]);

  constructor(options: BoundedLogOptions = {}) {
    this.#maximumEntries = options.maximumEntries ?? 32;
    this.#maximumLength = options.maximumLength ?? 2_048;
    if (
      !Number.isSafeInteger(this.#maximumEntries) ||
      this.#maximumEntries < 1 ||
      !Number.isSafeInteger(this.#maximumLength) ||
      this.#maximumLength < 1
    ) {
      throw new Error("Log bounds must be positive safe integers.");
    }
  }

  append(message: string): void {
    const next = [
      ...this.#entries,
      redactLogMessage(message, this.#maximumLength),
    ].slice(-this.#maximumEntries);
    this.#entries = Object.freeze(next);
  }

  snapshot(): readonly string[] {
    return Object.freeze([...this.#entries]);
  }
}
