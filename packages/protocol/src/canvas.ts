import { z } from "zod";
import {
  ContentHashSchema,
  IsoTimestampSchema,
  PointSchema,
  SchemaVersionSchema,
  SizeSchema,
  hasUniqueValues,
} from "./common.js";
import {
  CanvasDocumentIdSchema,
  CanvasNodeIdSchema,
  CoverageCellIdSchema,
  OperationIdSchema,
  ProjectIdSchema,
  RouteIdSchema,
  StateIdSchema,
} from "./ids.js";
import {
  CoverageHealthSchema,
  EvidenceLevelSchema,
  FrameAuthoritySchema,
  FrameKindSchema,
} from "./manifests.js";

const CodeFrameSourceSchema = z.strictObject({
  routeId: RouteIdSchema,
  stateId: StateIdSchema,
  coverageCellId: CoverageCellIdSchema,
});

export const CanvasNodeSchema = z
  .strictObject({
    id: CanvasNodeIdSchema,
    kind: FrameKindSchema,
    authority: FrameAuthoritySchema,
    evidenceLevel: EvidenceLevelSchema,
    coverageHealth: CoverageHealthSchema,
    parentId: CanvasNodeIdSchema.nullable(),
    position: PointSchema,
    size: SizeSchema,
    viewport: z
      .strictObject({
        name: z.enum(["desktop", "tablet", "mobile"]),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .optional(),
    source: CodeFrameSourceSchema.optional(),
  })
  .superRefine((node, context) => {
    if (node.kind === "code-frame" && node.source === undefined) {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: "Code frames require a route and state source.",
      });
    }

    if (node.kind !== "code-frame" && node.source !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: "Only code frames may carry a live source binding.",
      });
    }

    const authorityByKind = {
      "code-frame": "product-source",
      "draft-frame": "canvas-document",
      "snapshot-frame": "evidence-store",
      "reference-frame": "external-reference",
    } as const;
    if (node.authority !== authorityByKind[node.kind]) {
      context.addIssue({
        code: "custom",
        path: ["authority"],
        message: `${node.kind} requires ${authorityByKind[node.kind]} authority.`,
      });
    }

    if (node.coverageHealth === "blocked") {
      context.addIssue({
        code: "custom",
        path: ["coverageHealth"],
        message: "Blocked coverage cells cannot be materialized as frames.",
      });
    }

    if (
      node.kind === "draft-frame" &&
      node.evidenceLevel !== "proposed"
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceLevel"],
        message: "Draft frames carry proposed evidence.",
      });
    }

    if (
      node.kind === "reference-frame" &&
      node.evidenceLevel !== "reference"
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceLevel"],
        message: "Reference frames carry reference evidence.",
      });
    }
  });
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;
export type CanvasNodeInput = z.input<typeof CanvasNodeSchema>;

export const CanvasDocumentSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: CanvasDocumentIdSchema,
    projectId: ProjectIdSchema,
    revision: z.number().int().nonnegative(),
    stateHash: ContentHashSchema,
    operationCursor: OperationIdSchema.nullable(),
    nodes: z.array(CanvasNodeSchema),
    appliedOperations: z.array(
      z.strictObject({
        id: OperationIdSchema,
        actionDigest: ContentHashSchema,
        resultingHash: ContentHashSchema,
      }),
    ),
  })
  .superRefine((document, context) => {
    if (!hasUniqueValues(document.nodes.map((node) => node.id))) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Canvas node IDs must be unique.",
      });
    }
    if (
      !hasUniqueValues(
        document.appliedOperations.map((operation) => operation.id),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["appliedOperations"],
        message: "Applied operation IDs must be unique.",
      });
    }
  });
export type CanvasDocument = z.infer<typeof CanvasDocumentSchema>;

const operationBase = {
  schemaVersion: SchemaVersionSchema,
  id: OperationIdSchema,
  documentId: CanvasDocumentIdSchema,
  actorId: z.string().trim().min(1),
  occurredAt: IsoTimestampSchema,
  actionDigest: ContentHashSchema,
  expectedBeforeHash: ContentHashSchema,
  resultingHash: ContentHashSchema,
};

const NodeCreateOperationSchema = z.strictObject({
  ...operationBase,
  type: z.literal("node.create"),
  payload: z.strictObject({
    node: CanvasNodeSchema,
  }),
});

const NodeMoveOperationSchema = z.strictObject({
  ...operationBase,
  type: z.literal("node.move"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    from: PointSchema,
    to: PointSchema,
  }),
});

const NodeDeleteOperationSchema = z.strictObject({
  ...operationBase,
  type: z.literal("node.delete"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    deletedNodeHash: ContentHashSchema,
  }),
});

export const CanvasOperationSchema = z.discriminatedUnion("type", [
  NodeCreateOperationSchema,
  NodeMoveOperationSchema,
  NodeDeleteOperationSchema,
]);
export type CanvasOperation = z.infer<typeof CanvasOperationSchema>;
