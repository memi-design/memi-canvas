import type { CanvasMaterializationPlan } from "@memi/product-import";
import {
  CanvasDocumentIdSchema,
  ContentHashSchema,
  IsoTimestampSchema,
  ProjectIdSchema,
} from "@memi/protocol";

import { assertExactKeys } from "./shared.js";
import type { HumanImportBatchDecision } from "./types.js";

export const IMPORT_BATCH_CONSEQUENCE =
  "Approves only these reviewed canvas operations. It grants no source, Git, network, model, harness, process, or deployment access.";

const MAX_DECISION_MILLISECONDS = 15 * 60 * 1_000;

export function validateHumanImportBatchDecision(
  input: HumanImportBatchDecision,
  plan: CanvasMaterializationPlan,
): HumanImportBatchDecision {
  assertExactKeys(
    input,
    [
      "schemaVersion",
      "kind",
      "outcome",
      "projectId",
      "planId",
      "planDigest",
      "documentId",
      "approver",
      "issuedAt",
      "expiresAt",
      "consequence",
    ],
    "Human import batch decision",
  );
  assertExactKeys(input.approver, ["kind", "id"], "Human approver");
  ProjectIdSchema.parse(input.projectId);
  CanvasDocumentIdSchema.parse(input.documentId);
  ContentHashSchema.parse(input.planDigest);
  IsoTimestampSchema.parse(input.issuedAt);
  IsoTimestampSchema.parse(input.expiresAt);
  const issued = Date.parse(input.issuedAt);
  const expires = Date.parse(input.expiresAt);
  if (
    input.schemaVersion !== 1 ||
    input.kind !== "human-import-batch-decision" ||
    input.outcome !== "approved" ||
    input.approver.kind !== "human" ||
    input.approver.id.trim().length === 0 ||
    input.projectId !== plan.projectId ||
    input.planId !== plan.planId ||
    input.planDigest !== plan.planDigest ||
    input.documentId !== plan.documentId ||
    input.consequence !== IMPORT_BATCH_CONSEQUENCE ||
    expires <= issued ||
    expires - issued > MAX_DECISION_MILLISECONDS
  ) {
    throw new Error("Human import batch decision is not exact and approved.");
  }
  return input;
}
