import { z } from "zod";

import { hasUniqueValues } from "./common.js";
import { CapabilitySchema } from "./durability.js";

export const CanonicalBase64Schema = z
  .string()
  .min(1)
  .regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u,
    "Signature must use canonical base64.",
  )
  .refine((value) => {
    const lastDataCharacter = value.replace(/=+$/u, "").at(-1);
    if (lastDataCharacter === undefined) {
      return false;
    }
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const index = alphabet.indexOf(lastDataCharacter);
    return value.endsWith("==")
      ? index % 16 === 0
      : value.endsWith("=")
        ? index % 4 === 0
        : true;
  }, "Signature must use canonical base64.");

export const AuthorityDigestSchema = z
  .string()
  .regex(/^sha256:[a-z0-9]{64}$/u);

export const AuthorityChallengeSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{32,256}$/u,
    "Authority challenge must be an opaque canonical token.",
  );

export const RequiredAuthorityCapabilitiesSchema = z
  .array(CapabilitySchema)
  .min(1)
  .superRefine((capabilities, context) => {
    if (!hasUniqueValues(capabilities)) {
      context.addIssue({
        code: "custom",
        message: "Authority capabilities must be unique.",
      });
    }
  });
