const DECLARATION_PREFIX = "export const flows = ";
const DECLARATION_SUFFIX = " as const;";
const SAFE_LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SAFE_REFERENCE = /^[A-Za-z][A-Za-z0-9_-]*$/u;

export interface DeclaredFlowStep {
  readonly order: number;
  readonly route: string;
  readonly state: string;
  readonly trigger: string;
  readonly assertion: string;
}

export interface DeclaredFlow {
  readonly key: string;
  readonly name: string;
  readonly provenance: "declared";
  readonly steps: readonly DeclaredFlowStep[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function requiredString(
  value: unknown,
  field: string,
  pattern?: RegExp,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new Error(`Invalid declared flow ${field}.`);
  }
  return value;
}

function parseStep(value: unknown, index: number): DeclaredFlowStep {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "assertion",
      "order",
      "route",
      "state",
      "trigger",
    ])
  ) {
    throw new Error(`Invalid declared flow step ${index + 1}.`);
  }
  if (
    !Number.isSafeInteger(value.order) ||
    value.order !== index + 1
  ) {
    throw new Error("Declared flow steps must use contiguous 1-based order.");
  }
  return {
    order: value.order,
    route: requiredString(value.route, "route", SAFE_REFERENCE),
    state: requiredString(value.state, "state", SAFE_REFERENCE),
    trigger: requiredString(value.trigger, "trigger", SAFE_LABEL),
    assertion: requiredString(value.assertion, "assertion", SAFE_LABEL),
  };
}

function parseFlow(value: unknown): DeclaredFlow {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "name", "provenance", "steps"])
  ) {
    throw new Error("Invalid declared flow.");
  }
  if (value.provenance !== "declared") {
    throw new Error('Declared flow provenance must be "declared".');
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new Error("Declared flows require at least one step.");
  }
  const name = requiredString(value.name, "name");
  if (name.length > 160) {
    throw new Error("Declared flow name exceeds 160 characters.");
  }
  return {
    key: requiredString(value.id, "id", SAFE_LABEL),
    name,
    provenance: "declared",
    steps: value.steps.map(parseStep),
  };
}

export function parseDeclaredFlows(source: string): readonly DeclaredFlow[] {
  const declaration = source.trim();
  if (
    !declaration.startsWith(DECLARATION_PREFIX) ||
    !declaration.endsWith(DECLARATION_SUFFIX)
  ) {
    throw new Error(
      "Flow declarations must be a non-executable JSON literal exported as const.",
    );
  }
  const payload = declaration.slice(
    DECLARATION_PREFIX.length,
    -DECLARATION_SUFFIX.length,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Flow declarations must contain valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Flow declarations must contain an array.");
  }
  const flows = parsed.map(parseFlow);
  if (new Set(flows.map((flow) => flow.key)).size !== flows.length) {
    throw new Error("Declared flow IDs must be unique.");
  }
  return flows;
}
