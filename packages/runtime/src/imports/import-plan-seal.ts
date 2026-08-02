import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import {
  gunzipSync,
  gzipSync,
} from "node:zlib";

import type { ImportJobId } from "@memi/protocol";

const ALGORITHM = "aes-256-gcm";
const COMPRESSION = "gzip";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_CONTEXT = "memi:import-plan-encryption:v1";

interface SealedImportPlanV3 {
  readonly schemaVersion: 3;
  readonly algorithm: typeof ALGORITHM;
  readonly compression: typeof COMPRESSION;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authenticationTag: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deriveKey(authority: Uint8Array): Buffer {
  return createHmac("sha256", authority)
    .update(KEY_CONTEXT)
    .digest();
}

function associatedData(jobId: ImportJobId): Buffer {
  return Buffer.from(`memi-import-plan\0${jobId}`, "utf8");
}

function decodeBase64Url(
  value: unknown,
  label: string,
  exactBytes?: number,
): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new Error(`Sealed import plan ${label} is invalid.`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (exactBytes !== undefined && decoded.byteLength !== exactBytes)
  ) {
    throw new Error(`Sealed import plan ${label} is invalid.`);
  }
  return decoded;
}

function parseEnvelope(serialized: string): SealedImportPlanV3 {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("Sealed import plan envelope is invalid.");
  }
  const expectedKeys = [
    "algorithm",
    "authenticationTag",
    "ciphertext",
    "compression",
    "nonce",
    "schemaVersion",
  ];
  if (
    !record(value) ||
    Object.keys(value).sort().join(",") !== expectedKeys.sort().join(",") ||
    value.schemaVersion !== 3 ||
    value.algorithm !== ALGORITHM ||
    value.compression !== COMPRESSION
  ) {
    throw new Error("Sealed import plan envelope is invalid.");
  }
  decodeBase64Url(value.nonce, "nonce", IV_BYTES);
  decodeBase64Url(value.authenticationTag, "authentication tag", TAG_BYTES);
  decodeBase64Url(value.ciphertext, "ciphertext");
  return value as unknown as SealedImportPlanV3;
}

export function sealImportPlan(
  jobId: ImportJobId,
  plaintext: string,
  authority: Uint8Array,
): string {
  const nonce = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(authority), nonce);
  cipher.setAAD(associatedData(jobId));
  const compressed = gzipSync(Buffer.from(plaintext, "utf8"), { level: 9 });
  const ciphertext = Buffer.concat([
    cipher.update(compressed),
    cipher.final(),
  ]);
  const envelope: SealedImportPlanV3 = {
    schemaVersion: 3,
    algorithm: ALGORITHM,
    compression: COMPRESSION,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authenticationTag: cipher.getAuthTag().toString("base64url"),
  };
  return JSON.stringify(envelope);
}

export function openImportPlan(
  jobId: ImportJobId,
  serialized: string,
  authority: Uint8Array,
  maximumPlaintextBytes: number,
): string {
  const envelope = parseEnvelope(serialized);
  const nonce = decodeBase64Url(envelope.nonce, "nonce", IV_BYTES);
  const ciphertext = decodeBase64Url(
    envelope.ciphertext,
    "ciphertext",
  );
  const tag = decodeBase64Url(
    envelope.authenticationTag,
    "authentication tag",
    TAG_BYTES,
  );
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      deriveKey(authority),
      nonce,
    );
    decipher.setAAD(associatedData(jobId));
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return gunzipSync(compressed, {
      maxOutputLength: maximumPlaintextBytes,
    }).toString("utf8");
  } catch {
    throw new Error(
      "Stored import execution plan confidentiality is invalid.",
    );
  }
}

export function isLegacyPlaintextImportPlan(
  serialized: string,
): boolean {
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!record(value) || "ciphertext" in value) {
      return false;
    }
    const keys = Object.keys(value);
    return (
      keys.every((key) =>
        [
          "approvals",
          "authority",
          "dependencyPreparations",
          "manifest",
          "recipeCwds",
          "snapshotExclusions",
        ].includes(key),
      ) &&
      ["approvals", "authority", "manifest", "recipeCwds", "snapshotExclusions"]
        .every((key) => key in value) &&
      record(value.manifest) &&
      Array.isArray(value.approvals)
    );
  } catch {
    return false;
  }
}
