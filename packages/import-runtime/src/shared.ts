import { hashCanonicalValue } from "@memi/canonical-json";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const AUTHORITY_NAMESPACE = "memi.import-runtime.authority.v1";

export function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
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
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    Reflect.ownKeys(value).length !== actual.length ||
    actual.length !== wanted.length ||
    actual.some((key, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        key !== wanted[index] ||
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new Error(`${label} contains missing or unknown fields.`);
  }
}

export function deriveId(
  prefix: string,
  role: string,
  value: unknown,
): string {
  const digest = hashCanonicalValue({
    namespace: AUTHORITY_NAMESPACE,
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
