import { hashCanonicalValue } from "@memi/canonical-json";

export const PRODUCT_IMPORT_PLAN_NAMESPACE =
  "memi.product-import.plan.v1" as const;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function hashValue(value: unknown): `sha256:${string}` {
  return hashCanonicalValue(value) as `sha256:${string}`;
}

export function roleSeparatedId(
  prefix: "doc" | "mpl" | "nod" | "opn",
  role: string,
  value: object,
): string {
  const digest = hashValue({
    namespace: PRODUCT_IMPORT_PLAN_NAMESPACE,
    role,
    value,
  }).slice("sha256:".length);
  let remaining = BigInt(`0x${digest}`) & ((1n << 130n) - 1n);
  let body = "";
  for (let index = 0; index < 26; index += 1) {
    body = CROCKFORD[Number(remaining & 31n)] + body;
    remaining >>= 5n;
  }
  return `${prefix}_${body}`;
}

export function assertExactKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} must not contain symbol fields.`);
  }
  const actual = Object.keys(value).sort();
  if (
    Reflect.ownKeys(value).length !== actual.length ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(`${label} accepts only enumerable data fields.`);
  }
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} contains missing or unknown fields.`);
  }
}

export function assertUnique(
  values: readonly string[],
  label: string,
): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} identifier collision.`);
  }
}

export function assertAllowedKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !actual.includes(key)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    throw new Error(`${label} contains missing or unknown fields.`);
  }
}
