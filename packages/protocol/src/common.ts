import { z } from "zod";

export const CURRENT_SCHEMA_VERSION = 1 as const;
export const SchemaVersionSchema = z.literal(CURRENT_SCHEMA_VERSION);

export const ContentHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u);
export type ContentHash = z.infer<typeof ContentHashSchema>;

export const GitRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/u);
export const IsoTimestampSchema = z.iso.datetime({ offset: true });

const HOST_PATH_LABEL =
  /^(?:file:\/\/|\/|[a-z]:[\\/]|\\\\)/iu;
const BIDI_CONTROL_CODEPOINT = /\p{Bidi_Control}/u;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

function hasUnsafeUiCodepoint(value: string): boolean {
  return Array.from(value).some((character) => {
    const codepoint = character.codePointAt(0);
    return (
      codepoint !== undefined &&
      (codepoint <= 0x1f ||
        (codepoint >= 0x7f && codepoint <= 0x9f) ||
        BIDI_CONTROL_CODEPOINT.test(character))
    );
  });
}

function hasDelimiter(value: string, delimiters: string): boolean {
  return Array.from(value).some((character) => delimiters.includes(character));
}

function isContainedRelativeSourcePath(value: string): boolean {
  if (
    value.trim() !== value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    URI_SCHEME.test(value) ||
    hasUnsafeUiCodepoint(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

export const ContainedRelativeSourcePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    isContainedRelativeSourcePath,
    "Source paths must be canonical contained forward-slash relative paths.",
  );

export const SafeDisplayLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !hasUnsafeUiCodepoint(value), "Unsafe UI codepoint.")
  .refine(
    (value) => !hasDelimiter(value, "<>[]()"),
    "Markup delimiters are not allowed in display labels.",
  )
  .refine(
    (value) => !HOST_PATH_LABEL.test(value),
    "Host paths are not allowed in display labels.",
  );

export const SafeRoutePathSchema = z
  .string()
  .min(1)
  .max(2_048)
  .startsWith("/")
  .refine((value) => !value.startsWith("//"), "Route paths cannot name a host.")
  .refine((value) => !value.toLowerCase().includes("file://"), "Unsafe scheme.")
  .refine((value) => !hasUnsafeUiCodepoint(value), "Unsafe route codepoint.")
  .refine(
    (value) => !hasDelimiter(value, "<>[]()\\"),
    "Unsafe route-path delimiter.",
  );

export const PointSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const SizeSchema = z.strictObject({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
