import {
  canonicalJson,
} from "@memi/canonical-json";
import { ContentHashSchema } from "@memi/protocol";

import { assertExactKeys, deepFreeze } from "./shared.js";
import type { ImportRuntimeEvidence } from "./types.js";

export const IMPORT_RUNTIME_EVIDENCE_RELATIVE_PATH =
  "dist/test-evidence/import-runtime";
const MAX_EVIDENCE_BYTES = 4_096;
const COUNT_KEYS = [
  "operations",
  "targetReceipts",
  "committedReceipts",
  "traceEvents",
  "projectionIntents",
] as const;
const AUTHORITY_COUNT_KEYS = [
  "commands",
  "outboxes",
  "grants",
  "approvals",
  "grantUses",
  "approvalUses",
  "targetReceipts",
  "acceptedVerificationAttempts",
  "traceBindings",
  "traceEvents",
  "projectionIntents",
  "canonicalReceipts",
  "latches",
] as const;

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateImportRuntimeEvidence(
  input: ImportRuntimeEvidence,
): ImportRuntimeEvidence {
  assertExactKeys(
    input,
    [
      "schemaVersion",
      "kind",
      "batchDigest",
      "workspaceDigest",
      "planDigest",
      "initialStateHash",
      "finalStateHash",
      "lastEventHash",
      "counts",
      "authoritySummary",
    ],
    "Import runtime evidence",
  );
  assertExactKeys(input.counts, COUNT_KEYS, "Import evidence counts");
  const summary = input.authoritySummary;
  assertExactKeys(
    summary,
    [
      "snapshotDigest",
      "lineage",
      "counts",
      "observedCommandKinds",
      "observedTargetKinds",
      "unexpectedCommandIds",
    ],
    "Import authority summary",
  );
  assertExactKeys(
    summary.lineage,
    ["workspaceDigest", "planDigest", "batchRootDigest"],
    "Import authority lineage",
  );
  assertExactKeys(
    summary.counts,
    AUTHORITY_COUNT_KEYS,
    "Import authority counts",
  );
  for (const hash of [
    input.batchDigest,
    input.workspaceDigest,
    input.planDigest,
    input.initialStateHash,
    input.finalStateHash,
    summary.snapshotDigest,
    summary.lineage.workspaceDigest,
    summary.lineage.planDigest,
    summary.lineage.batchRootDigest,
  ]) {
    ContentHashSchema.parse(hash);
  }
  if (input.lastEventHash !== null) {
    ContentHashSchema.parse(input.lastEventHash);
  }
  const operationCount = input.counts.operations;
  const authorityCounts = summary.counts;
  if (
    input.schemaVersion !== 1 ||
    input.kind !== "import-runtime-e2e" ||
    Object.values(input.counts).some((count) => !validCount(count)) ||
    Object.values(authorityCounts).some(
      (count) => !validCount(count as number),
    ) ||
    Object.values(input.counts).some((count) => count !== operationCount) ||
    [
      authorityCounts.commands,
      authorityCounts.outboxes,
      authorityCounts.grants,
      authorityCounts.approvals,
      authorityCounts.grantUses,
      authorityCounts.approvalUses,
      authorityCounts.targetReceipts,
      authorityCounts.acceptedVerificationAttempts,
      authorityCounts.traceBindings,
      authorityCounts.traceEvents,
      authorityCounts.projectionIntents,
      authorityCounts.canonicalReceipts,
    ].some((count) => count !== operationCount) ||
    authorityCounts.latches !== 0 ||
    input.workspaceDigest !== summary.lineage.workspaceDigest ||
    input.planDigest !== summary.lineage.planDigest ||
    canonicalJson(summary.observedCommandKinds) !==
      canonicalJson(["canvas.operation"]) ||
    canonicalJson(summary.observedTargetKinds) !==
      canonicalJson(["canvas-document"]) ||
    summary.unexpectedCommandIds.length !== 0
  ) {
    throw new Error("Import runtime evidence is invalid.");
  }
  const text = canonicalJson(input);
  if (
    Buffer.byteLength(text, "utf8") > MAX_EVIDENCE_BYTES ||
    /(?:signature|challenge|approver|keyId|publicKey|command_json|receipt_json|\/Users\/|\/Volumes\/)/iu.test(
      text,
    )
  ) {
    throw new Error("Import runtime evidence is unsafe or oversized.");
  }
  return deepFreeze(structuredClone(input));
}
