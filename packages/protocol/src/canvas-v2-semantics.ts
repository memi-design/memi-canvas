import { z } from "zod";

import { CanvasNodeIdSchema } from "./ids.js";

const SafeMetadataTextSchema = z.string().trim().min(1).max(2_048);
const SafeMetadataKeySchema = z.string().trim().min(1).max(160);
const CanvasImageDataUriSchema = z
  .string()
  .max(2_796_226)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u);
const RepositoryFingerprintV2Schema = z.string().regex(
  /^(?:sha256:[a-f0-9]{64}|fnv1a64:[a-f0-9]{16})$/u,
);

export const CanvasCaptureStateV2Schema = z.enum([
  "captured",
  "placeholder",
]);
export type CanvasCaptureStateV2 = z.infer<
  typeof CanvasCaptureStateV2Schema
>;

export const CanvasComponentIdSchema = z
  .string()
  .regex(/^cmp_[0-9A-HJKMNP-TV-Z]{26}$/u)
  .brand<"CanvasComponentId">();
export type CanvasComponentId = z.infer<typeof CanvasComponentIdSchema>;

export const CanvasNodeKindV2Schema = z.enum([
  "frame",
  "group",
  "rectangle",
  "ellipse",
  "line",
  "arrow",
  "vector",
  "text",
  "image",
  "component",
  "instance",
  "section",
  "sticky",
  "connector",
  "imported-source-frame",
]);
export type CanvasNodeKindV2 = z.infer<typeof CanvasNodeKindV2Schema>;

export const CanvasNodeIdentityV2Schema = z.strictObject({
  name: z.string().trim().min(1).max(512),
  kind: CanvasNodeKindV2Schema,
});
export type CanvasNodeIdentityV2 = z.infer<
  typeof CanvasNodeIdentityV2Schema
>;

export const CanvasNodeContentV2Schema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("frame"),
    format: z.enum(["plain-text", "html", "tsx-preview"]),
    value: z.string().max(1_000_000),
  }),
  z.strictObject({
    type: z.literal("note"),
    body: z.string().max(1_000_000),
  }),
  z.strictObject({
    type: z.literal("image"),
    artifactId: SafeMetadataTextSchema.optional(),
    byteLength: z.number().int().positive().max(2_097_152).optional(),
    dataUri: CanvasImageDataUriSchema.optional(),
    alt: z.string().max(4_096),
    height: z.number().int().positive().max(32_768).optional(),
    width: z.number().int().positive().max(32_768).optional(),
  }).superRefine((content, context) => {
    if ((content.artifactId === undefined) === (content.dataUri === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Image content requires exactly one durable artifact or embedded PNG data URI.",
      });
    }
    if (
      content.dataUri !== undefined &&
      (content.byteLength === undefined ||
        content.width === undefined ||
        content.height === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Embedded PNG data requires byte length and intrinsic dimensions.",
      });
    }
    if (
      content.dataUri === undefined &&
      (content.byteLength !== undefined ||
        content.width !== undefined ||
        content.height !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Artifact-backed images cannot claim embedded PNG dimensions.",
      });
    }
  }),
  z.strictObject({
    type: z.literal("vector"),
    pathData: z.string().max(1_000_000),
  }),
]);
export type CanvasNodeContentV2 = z.infer<
  typeof CanvasNodeContentV2Schema
>;

const CanvasRepositoryProvenanceFieldsV2 = {
  repositoryRevision: SafeMetadataTextSchema,
  repositoryDirty: z.boolean().nullable(),
  dirtyFileFingerprint: RepositoryFingerprintV2Schema.nullable(),
  sourceFingerprint: RepositoryFingerprintV2Schema.nullable(),
  sourceContentHash: RepositoryFingerprintV2Schema.nullable(),
  sourceAnchor: SafeMetadataTextSchema,
} as const;

export const CanvasDetachedProvenanceV2Schema = z.strictObject({
  ...CanvasRepositoryProvenanceFieldsV2,
  captureState: CanvasCaptureStateV2Schema.nullable(),
  routeId: SafeMetadataTextSchema.nullable(),
  stateId: SafeMetadataTextSchema.nullable(),
  coverageCellId: SafeMetadataTextSchema.nullable(),
});
export type CanvasDetachedProvenanceV2 = z.infer<
  typeof CanvasDetachedProvenanceV2Schema
>;

export const CanvasSourceBindingV2Schema = z.strictObject({
  ...CanvasRepositoryProvenanceFieldsV2,
  captureState: CanvasCaptureStateV2Schema,
  routeId: SafeMetadataTextSchema,
  stateId: SafeMetadataTextSchema,
  coverageCellId: SafeMetadataTextSchema,
  viewport: z.strictObject({
    name: z.enum(["desktop", "tablet", "mobile"]),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  }),
});
export type CanvasSourceBindingV2 = z.infer<
  typeof CanvasSourceBindingV2Schema
>;

export const CanvasReferenceBindingV2Schema = z.strictObject({
  src: z.string().trim().min(1).max(8_192),
  alt: z.string().max(4_096),
  authority: SafeMetadataTextSchema,
  appVersion: SafeMetadataTextSchema,
  capturedAt: z.iso.datetime({ offset: true }),
  sourceUrl: z.string().trim().min(1).max(8_192),
  captureId: SafeMetadataTextSchema.optional(),
  contentHash: RepositoryFingerprintV2Schema.optional(),
  sourceRevision: SafeMetadataTextSchema.optional(),
  accessibilitySnapshotRef: SafeMetadataTextSchema.optional(),
  sourceAnchors: z.array(SafeMetadataTextSchema).max(1_024).optional(),
  componentIds: z.array(SafeMetadataTextSchema).max(1_024).optional(),
});
export type CanvasReferenceBindingV2 = z.infer<
  typeof CanvasReferenceBindingV2Schema
>;

const CanvasComponentSourceV2Schema = z.strictObject({
  repositoryRevision: SafeMetadataTextSchema,
  repositoryDirty: z.boolean().nullable(),
  sourceAnchor: SafeMetadataTextSchema,
  sourceContentHash: RepositoryFingerprintV2Schema.nullable(),
  exportName: z.string().trim().min(1).max(512).nullable(),
});

export const CanvasComponentPreviewItemV2Schema = z.strictObject({
  icon: z.string().max(512).optional(),
  label: z.string().max(2_048),
  status: z.string().max(512).optional(),
  supportingText: z.string().max(4_096).optional(),
  value: z.string().max(2_048).optional(),
});

export const CanvasComponentBindingV2Schema = z
  .strictObject({
    atomicLevel: z.enum([
      "atom",
      "molecule",
      "organism",
      "template",
      "page",
    ]),
    componentId: CanvasComponentIdSchema,
    componentName: z.string().trim().min(1).max(512),
    classification: z.enum(["master", "instance"]),
    editable: z.strictObject({
      label: z.boolean(),
      icon: z.boolean(),
      selected: z.boolean(),
      variant: z.boolean(),
    }),
    masterNodeId: CanvasNodeIdSchema.nullable(),
    props: z.strictObject({
      label: z.string().max(2_048).optional(),
      icon: z.string().max(512).optional(),
      selected: z.boolean().optional(),
      status: z.string().max(512).optional(),
      supportingText: z.string().max(4_096).optional(),
      placeholder: z.string().max(2_048).optional(),
      value: z.string().max(2_048).optional(),
      items: z
        .array(CanvasComponentPreviewItemV2Schema)
        .max(100)
        .optional(),
    }),
    role: z.enum([
      "button",
      "tab-bar",
      "tab-item",
      "card",
      "input",
      "badge",
      "header",
      "screen-shell",
    ]),
    source: CanvasComponentSourceV2Schema,
    variant: z.string().max(512).nullable(),
  })
  .superRefine((binding, context) => {
    if (
      binding.classification === "master" &&
      binding.masterNodeId !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["masterNodeId"],
        message: "Component masters cannot reference another master.",
      });
    }
    if (
      binding.classification === "instance" &&
      binding.masterNodeId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["masterNodeId"],
        message: "Component instances require a master node.",
      });
    }
  });
export type CanvasComponentBindingV2 = z.infer<
  typeof CanvasComponentBindingV2Schema
>;

export const CanvasNodeProvenanceStateV2Schema = z.strictObject({
  provenance: CanvasDetachedProvenanceV2Schema.nullable(),
  referenceBinding: CanvasReferenceBindingV2Schema.nullable(),
  sourceBinding: CanvasSourceBindingV2Schema.nullable(),
});
export type CanvasNodeProvenanceStateV2 = z.infer<
  typeof CanvasNodeProvenanceStateV2Schema
>;

export const CanvasNodeComponentStateV2Schema = z.strictObject({
  componentId: CanvasComponentIdSchema.nullable(),
  instanceOverrides: z.record(SafeMetadataKeySchema, z.json()),
  componentBinding: CanvasComponentBindingV2Schema.nullable(),
});
export type CanvasNodeComponentStateV2 = z.infer<
  typeof CanvasNodeComponentStateV2Schema
>;

export const CanvasNodeDetachStateV2Schema = z.strictObject({
  identity: CanvasNodeIdentityV2Schema,
  content: CanvasNodeContentV2Schema.nullable(),
  provenance: CanvasNodeProvenanceStateV2Schema,
  component: CanvasNodeComponentStateV2Schema,
});
export type CanvasNodeDetachStateV2 = z.infer<
  typeof CanvasNodeDetachStateV2Schema
>;

export const NodeIdentityActionPayloadV2Schema = z.strictObject({
  nodeId: CanvasNodeIdSchema,
  prior: CanvasNodeIdentityV2Schema,
  next: CanvasNodeIdentityV2Schema,
});
export const NodeContentActionPayloadV2Schema = z.strictObject({
  nodeId: CanvasNodeIdSchema,
  prior: CanvasNodeContentV2Schema.nullable(),
  next: CanvasNodeContentV2Schema.nullable(),
});
export const NodeProvenanceActionPayloadV2Schema = z.strictObject({
  nodeId: CanvasNodeIdSchema,
  prior: CanvasNodeProvenanceStateV2Schema,
  next: CanvasNodeProvenanceStateV2Schema,
});
export const NodeComponentActionPayloadV2Schema = z.strictObject({
  nodeId: CanvasNodeIdSchema,
  prior: CanvasNodeComponentStateV2Schema,
  next: CanvasNodeComponentStateV2Schema,
});
export const NodeDetachActionPayloadV2Schema = z.strictObject({
  nodeId: CanvasNodeIdSchema,
  prior: CanvasNodeDetachStateV2Schema,
  next: CanvasNodeDetachStateV2Schema,
});
