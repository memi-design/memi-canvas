import {
  hashCanonicalValueWithByteLimit,
} from "@memi/canonical-json";

const MAX_CANVAS_OPERATION_HASH_BYTES = 2_000_000;
const MAX_CANVAS_DOCUMENT_HASH_BYTES = 64_000_000;

export function hashValue(value: unknown): string {
  return hashCanonicalValueWithByteLimit(
    value,
    MAX_CANVAS_OPERATION_HASH_BYTES,
  );
}

export function hashCanvasDocumentValue(value: unknown): string {
  return hashCanonicalValueWithByteLimit(
    value,
    MAX_CANVAS_DOCUMENT_HASH_BYTES,
  );
}
