import { hashCanonicalValue } from "@memi/canonical-json";
import { z } from "zod";

import {
  ContentHashSchema,
  SchemaVersionSchema,
  hasUniqueValues,
} from "./common.js";
import {
  CanvasDocumentIdSchema,
  OperationIdSchema,
  ProjectIdSchema,
} from "./ids.js";
import { AuthorityDigestSchema } from "./trusted-command-authority-primitives.js";

export const TrustedCommandAuthorityReviewedContextSchema =
  z.strictObject({
    workspaceDigest: AuthorityDigestSchema,
    planDigest: AuthorityDigestSchema,
    batchRootDigest: AuthorityDigestSchema,
  });
export type TrustedCommandAuthorityReviewedContext = z.infer<
  typeof TrustedCommandAuthorityReviewedContextSchema
>;

export const TrustedAuthorityBatchRootMaterialSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    kind: z.literal("memi-import-authority-batch-root"),
    projectId: ProjectIdSchema,
    documentId: CanvasDocumentIdSchema,
    workspaceDigest: AuthorityDigestSchema,
    planDigest: AuthorityDigestSchema,
    operations: z
      .array(
        z.strictObject({
          ordinal: z.number().int().nonnegative(),
          operationId: OperationIdSchema,
          actionDigest: ContentHashSchema,
        }),
      )
      .min(1),
  })
  .superRefine((material, context) => {
    if (
      !hasUniqueValues(
        material.operations.map(({ ordinal }) => String(ordinal)),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message: "Authority batch operation ordinals must be unique.",
      });
    }
    if (
      !hasUniqueValues(
        material.operations.map(({ operationId }) => operationId),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message: "Authority batch operation ids must be unique.",
      });
    }
  });
export type TrustedAuthorityBatchRootMaterial = z.infer<
  typeof TrustedAuthorityBatchRootMaterialSchema
>;

export function computeTrustedAuthorityBatchRoot(
  input: unknown,
): string {
  return hashCanonicalValue(
    TrustedAuthorityBatchRootMaterialSchema.parse(input),
  );
}
