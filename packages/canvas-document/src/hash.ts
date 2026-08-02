import { hashCanonicalValue } from "@memi/canonical-json";

export function hashValue(value: unknown): string {
  return hashCanonicalValue(value);
}
