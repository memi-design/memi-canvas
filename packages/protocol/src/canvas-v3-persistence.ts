import { z } from "zod";

import { ContentHashSchema, IsoTimestampSchema } from "./common.js";
import {
  CanvasDocumentIdSchema,
  OperationIdSchema,
  ProjectIdSchema,
} from "./ids.js";
import { CanvasDocumentV3Schema } from "./canvas-v3-core.js";
import { CanvasOperationV3Schema } from "./canvas-v3-operation.js";

export const CanvasDocumentIdentityV3Schema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  documentId: CanvasDocumentIdSchema,
});
export type CanvasDocumentIdentityV3 = z.infer<
  typeof CanvasDocumentIdentityV3Schema
>;

export const CanvasDocumentSnapshotV3Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("canvas-document-v3-snapshot"),
    identity: CanvasDocumentIdentityV3Schema,
    document: CanvasDocumentV3Schema,
    persistedAt: IsoTimestampSchema,
  })
  .superRefine((snapshot, context) => {
    if (
      snapshot.document.id !== snapshot.identity.documentId ||
      snapshot.document.projectId !== snapshot.identity.projectId
    ) {
      context.addIssue({
        code: "custom",
        path: ["identity"],
        message: "Snapshot identity must match its CanvasDocumentV3.",
      });
    }
  });
export type CanvasDocumentSnapshotV3 = z.infer<
  typeof CanvasDocumentSnapshotV3Schema
>;

export const CanvasDocumentAppendV3Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("canvas-document-v3-append"),
    identity: CanvasDocumentIdentityV3Schema,
    operation: CanvasOperationV3Schema,
  })
  .superRefine((append, context) => {
    if (append.operation.documentId !== append.identity.documentId) {
      context.addIssue({
        code: "custom",
        path: ["operation", "documentId"],
        message: "Appended operation must target the bound document.",
      });
    }
  });
export type CanvasDocumentAppendV3 = z.infer<
  typeof CanvasDocumentAppendV3Schema
>;

export const CanvasDocumentAppendReceiptV3Schema = z.strictObject({
  schemaVersion: z.literal(1),
  identity: CanvasDocumentIdentityV3Schema,
  operationId: OperationIdSchema,
  revision: z.number().int().nonnegative(),
  stateHash: ContentHashSchema,
});
export type CanvasDocumentAppendReceiptV3 = z.infer<
  typeof CanvasDocumentAppendReceiptV3Schema
>;

export const CanvasDocumentJournalV3Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("canvas-document-v3-journal"),
    identity: CanvasDocumentIdentityV3Schema,
    snapshot: CanvasDocumentSnapshotV3Schema,
    operations: z.array(CanvasOperationV3Schema).max(10_000),
    operationBytes: z.number().int().nonnegative().max(2_000_000_000),
  })
  .superRefine((journal, context) => {
    if (
      journal.snapshot.identity.projectId !== journal.identity.projectId ||
      journal.snapshot.identity.documentId !== journal.identity.documentId
    ) {
      context.addIssue({
        code: "custom",
        path: ["snapshot", "identity"],
        message: "Journal snapshot must use the journal identity.",
      });
    }
    if (
      journal.operations.some(
        (operation) => operation.documentId !== journal.identity.documentId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message: "Journal operations must target the journal document.",
      });
    }
  });
export type CanvasDocumentJournalV3 = z.infer<
  typeof CanvasDocumentJournalV3Schema
>;

export interface CanvasDocumentV3PersistencePort {
  load(
    identity: CanvasDocumentIdentityV3,
  ): Promise<CanvasDocumentJournalV3 | null>;
  initialize(snapshot: CanvasDocumentSnapshotV3): Promise<void>;
  append(
    request: CanvasDocumentAppendV3,
  ): Promise<CanvasDocumentAppendReceiptV3>;
  checkpoint(snapshot: CanvasDocumentSnapshotV3): Promise<void>;
}
