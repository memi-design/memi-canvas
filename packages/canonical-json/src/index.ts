import { sha256Hex } from "./sha256.js";

export const MAX_CANONICAL_BYTES = 1_048_576;
export const MAX_CANONICAL_HASH_BYTES = 64_000_000;
export const MAX_JSON_DEPTH = 64;
export const MAX_JSON_NODES = 100_000;

const utf8Encoder = new TextEncoder();

function utf8ByteLength(value: string): number {
  if (/^\p{ASCII}*$/u.test(value)) {
    return value.length;
  }
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return bytes;
}

interface CanonicalValue {
  readonly text: string;
  readonly bytes: number;
  readonly nodes: number;
}

function checked(
  result: CanonicalValue,
  maximumBytes: number,
): CanonicalValue {
  if (result.bytes > maximumBytes) {
    throw new RangeError(
      `Canonical JSON exceeds ${maximumBytes} bytes.`,
    );
  }
  if (result.nodes > MAX_JSON_NODES) {
    throw new RangeError(
      `Canonical JSON exceeds ${MAX_JSON_NODES} JSON nodes.`,
    );
  }
  return result;
}

function scalar(text: string, maximumBytes: number): CanonicalValue {
  return checked({
    text,
    bytes: utf8ByteLength(text),
    nodes: 1,
  }, maximumBytes);
}

function dataProperty(
  object: object,
  key: string,
): PropertyDescriptor & { readonly value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !("value" in descriptor)
  ) {
    throw new TypeError(
      "Canonical JSON accepts only enumerable data properties.",
    );
  }
  return { ...descriptor, value: descriptor.value };
}

function canonicalize(
  value: unknown,
  ancestors: ReadonlySet<object>,
  depth: number,
  maximumBytes: number,
): CanonicalValue {
  if (depth > MAX_JSON_DEPTH) {
    throw new RangeError(
      `Canonical JSON exceeds ${MAX_JSON_DEPTH} levels.`,
    );
  }
  if (value === null) {
    return scalar("null", maximumBytes);
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return scalar(JSON.stringify(value), maximumBytes);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON numbers must be finite.");
    }
    return scalar(JSON.stringify(value), maximumBytes);
  }
  if (typeof value !== "object") {
    throw new TypeError("Canonical JSON accepts only JSON values.");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Canonical JSON must not contain cycles.");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Canonical JSON must not contain symbol keys.");
  }
  const nextAncestors = new Set(ancestors).add(value);

  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (
      keys.length !== value.length ||
      keys.some((key, index) => key !== String(index))
    ) {
      throw new TypeError(
        "Canonical JSON arrays must be dense and contain no extra keys.",
      );
    }
    const parts: string[] = [];
    let bytes = 2;
    let nodes = 1;
    for (let index = 0; index < value.length; index += 1) {
      const child = canonicalize(
        dataProperty(value, String(index)).value,
        nextAncestors,
        depth + 1,
        maximumBytes,
      );
      bytes += child.bytes + (index === 0 ? 0 : 1);
      nodes += child.nodes;
      checked({ text: "", bytes, nodes }, maximumBytes);
      parts.push(child.text);
    }
    return checked(
      { text: `[${parts.join(",")}]`, bytes, nodes },
      maximumBytes,
    );
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      "Canonical JSON objects must be plain objects.",
    );
  }
  const keys = Object.keys(value).sort();
  if (Reflect.ownKeys(value).length !== keys.length) {
    throw new TypeError(
      "Canonical JSON must not contain hidden properties.",
    );
  }
  const parts: string[] = [];
  let bytes = 2;
  let nodes = 1;
  for (const [index, key] of keys.entries()) {
    const keyText = JSON.stringify(key);
    const child = canonicalize(
      dataProperty(value, key).value,
      nextAncestors,
      depth + 1,
      maximumBytes,
    );
    const part = `${keyText}:${child.text}`;
    bytes +=
      utf8ByteLength(keyText) +
      1 +
      child.bytes +
      (index === 0 ? 0 : 1);
    nodes += child.nodes;
    checked({ text: "", bytes, nodes }, maximumBytes);
    parts.push(part);
  }
  return checked(
    { text: `{${parts.join(",")}}`, bytes, nodes },
    maximumBytes,
  );
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set(), 0, MAX_CANONICAL_BYTES).text;
}

export function hashCanonicalValue(value: unknown): string {
  const digest = sha256Hex(
    utf8Encoder.encode(canonicalJson(value)),
  );
  return `sha256:${digest}`;
}

export function hashCanonicalValueWithByteLimit(
  value: unknown,
  maximumBytes: number,
): string {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > MAX_CANONICAL_HASH_BYTES
  ) {
    throw new RangeError(
      `Canonical JSON hash byte limit must be between 1 and ${MAX_CANONICAL_HASH_BYTES}.`,
    );
  }
  const digest = sha256Hex(
    utf8Encoder.encode(
      canonicalize(value, new Set(), 0, maximumBytes).text,
    ),
  );
  return `sha256:${digest}`;
}
