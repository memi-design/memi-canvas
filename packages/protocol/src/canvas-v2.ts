import { z } from "zod";

import {
  ContainedRelativeSourcePathSchema,
  ContentHashSchema,
  IsoTimestampSchema,
  hasUniqueValues,
} from "./common.js";
import {
  CanvasDocumentIdSchema,
  CanvasNodeIdSchema,
  OperationIdSchema,
  ProjectIdSchema,
} from "./ids.js";
import {
  CanvasComponentBindingV2Schema,
  CanvasComponentIdSchema,
  CanvasDetachedProvenanceV2Schema,
  CanvasNodeContentV2Schema,
  CanvasNodeKindV2Schema,
  CanvasReferenceBindingV2Schema,
  CanvasSourceBindingV2Schema,
  NodeComponentActionPayloadV2Schema,
  NodeContentActionPayloadV2Schema,
  NodeDetachActionPayloadV2Schema,
  NodeIdentityActionPayloadV2Schema,
  NodeProvenanceActionPayloadV2Schema,
  type CanvasNodeComponentStateV2,
  type CanvasNodeContentV2,
  type CanvasNodeDetachStateV2,
  type CanvasNodeIdentityV2,
  type CanvasNodeProvenanceStateV2,
} from "./canvas-v2-semantics.js";

export const LegacyCanvasIdKindV2Schema = z.enum([
  "project",
  "document",
  "node",
  "component",
  "operation",
]);
export type LegacyCanvasIdKindV2 = z.infer<
  typeof LegacyCanvasIdKindV2Schema
>;

export const LegacyCanvasIdMappingReceiptV2Schema = z
  .strictObject({
    strategy: z.literal("sha256-crockford-v1"),
    kind: LegacyCanvasIdKindV2Schema,
    legacyId: z.string().min(1).max(2_048),
    canonicalId: z
      .string()
      .regex(/^(?:prj|doc|nod|cmp|opn)_[0-9A-HJKMNP-TV-Z]{26}$/u),
    digest: ContentHashSchema,
  })
  .superRefine((receipt, context) => {
    const prefixByKind = {
      project: "prj_",
      document: "doc_",
      node: "nod_",
      component: "cmp_",
      operation: "opn_",
    } as const;
    if (!receipt.canonicalId.startsWith(prefixByKind[receipt.kind])) {
      context.addIssue({
        code: "custom",
        path: ["canonicalId"],
        message: "Canonical ID prefix must match the mapped legacy ID kind.",
      });
    }
  });
export type LegacyCanvasIdMappingReceiptV2 = z.infer<
  typeof LegacyCanvasIdMappingReceiptV2Schema
>;

const FiniteNumberSchema = z.number().finite();
const NonnegativeFiniteNumberSchema = FiniteNumberSchema.nonnegative();
const IndexSchema = z.number().int().nonnegative();
const SafeKeySchema = z.string().trim().min(1).max(160);

export const CanvasTransformV2Schema = z.strictObject({
  x: FiniteNumberSchema,
  y: FiniteNumberSchema,
  rotation: FiniteNumberSchema,
  scaleX: FiniteNumberSchema,
  scaleY: FiniteNumberSchema,
});
export type CanvasTransformV2 = z.infer<typeof CanvasTransformV2Schema>;

export const CanvasGeometryV2Schema = z.strictObject({
  width: NonnegativeFiniteNumberSchema,
  height: NonnegativeFiniteNumberSchema,
});
export type CanvasGeometryV2 = z.infer<typeof CanvasGeometryV2Schema>;

const CanvasPaintV2Schema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("solid"),
    color: z.string().trim().min(1).max(160),
    tokenId: SafeKeySchema.nullable().optional(),
  }),
  z.strictObject({
    type: z.literal("image"),
    artifactId: z.string().trim().min(1).max(160),
    scaleMode: z.enum(["fill", "fit", "crop", "tile"]),
  }),
]);

export const CanvasStyleV2Schema = z.strictObject({
  opacity: z.number().finite().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  fills: z.array(CanvasPaintV2Schema).max(32),
  strokes: z.array(CanvasPaintV2Schema).max(32),
  strokeWeight: NonnegativeFiniteNumberSchema.optional(),
  strokeAlign: z.enum(["inside", "center", "outside"]).optional(),
  cornerRadii: z.tuple([
    NonnegativeFiniteNumberSchema,
    NonnegativeFiniteNumberSchema,
    NonnegativeFiniteNumberSchema,
    NonnegativeFiniteNumberSchema,
  ]),
});
export type CanvasStyleV2 = z.infer<typeof CanvasStyleV2Schema>;

const CanvasPaddingV2Schema = z.strictObject({
  top: NonnegativeFiniteNumberSchema,
  right: NonnegativeFiniteNumberSchema,
  bottom: NonnegativeFiniteNumberSchema,
  left: NonnegativeFiniteNumberSchema,
});

export const CanvasLayoutV2Schema = z.strictObject({
  mode: z.enum(["none", "horizontal", "vertical", "grid"]),
  gap: NonnegativeFiniteNumberSchema,
  padding: CanvasPaddingV2Schema,
  alignPrimary: z.enum(["start", "center", "end", "space-between"]),
  alignCounter: z.enum(["start", "center", "end", "stretch"]),
  wrap: z.boolean(),
  sizingHorizontal: z.enum(["fixed", "hug", "fill"]),
  sizingVertical: z.enum(["fixed", "hug", "fill"]),
});
export type CanvasLayoutV2 = z.infer<typeof CanvasLayoutV2Schema>;

export const CanvasTextV2Schema = z.strictObject({
  characters: z.string().max(1_000_000),
  autoResize: z.enum(["none", "width-height", "height"]),
});
export type CanvasTextV2 = z.infer<typeof CanvasTextV2Schema>;

const SourceRangeV2Schema = z.strictObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export const SourceAnchorV2Schema = z
  .strictObject({
    path: ContainedRelativeSourcePathSchema,
    symbol: z.string().trim().min(1).max(512),
    astPath: z.array(z.string().trim().min(1).max(256)).max(128),
    range: SourceRangeV2Schema,
    contentHash: ContentHashSchema,
    sourceRevision: z.string().trim().min(1).max(256),
    dirtyFingerprint: ContentHashSchema,
    componentIdentity: z.string().trim().min(1).max(512).nullable(),
    runtimeEvidenceRefs: z.array(z.string().trim().min(1).max(256)).max(128),
  })
  .superRefine((anchor, context) => {
    if (anchor.range.end < anchor.range.start) {
      context.addIssue({
        code: "custom",
        path: ["range", "end"],
        message: "Source range end must not precede its start.",
      });
    }
  });
export type SourceAnchorV2 = z.infer<typeof SourceAnchorV2Schema>;

export const CanvasNodeV2Schema = z
  .strictObject({
    id: CanvasNodeIdSchema,
    kind: CanvasNodeKindV2Schema,
    name: z.string().trim().min(1).max(512),
    parentId: CanvasNodeIdSchema.nullable(),
    childIds: z.array(CanvasNodeIdSchema),
    transform: CanvasTransformV2Schema,
    geometry: CanvasGeometryV2Schema,
    style: CanvasStyleV2Schema,
    layout: CanvasLayoutV2Schema,
    text: CanvasTextV2Schema.nullable(),
    content: CanvasNodeContentV2Schema.nullable(),
    componentId: CanvasComponentIdSchema.nullable(),
    instanceOverrides: z.record(SafeKeySchema, z.json()),
    componentBinding: CanvasComponentBindingV2Schema.nullable(),
    provenance: CanvasDetachedProvenanceV2Schema.nullable(),
    referenceBinding: CanvasReferenceBindingV2Schema.nullable(),
    sourceAnchor: SourceAnchorV2Schema.nullable(),
    sourceBinding: CanvasSourceBindingV2Schema.nullable(),
  })
  .superRefine((node, context) => {
    if (!hasUniqueValues(node.childIds)) {
      context.addIssue({
        code: "custom",
        path: ["childIds"],
        message: "Child IDs must be unique.",
      });
    }
    if (node.kind === "text" && node.text === null) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Text nodes require text content.",
      });
    }
    if (node.kind !== "text" && node.text !== null) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Only text nodes may carry text content.",
      });
    }
    if (node.kind === "instance" && node.componentId === null) {
      context.addIssue({
        code: "custom",
        path: ["componentId"],
        message: "Instances require a component.",
      });
    }
    if (node.kind !== "instance" && node.componentId !== null) {
      context.addIssue({
        code: "custom",
        path: ["componentId"],
        message: "Only instances may reference a component.",
      });
    }
    if (
      node.kind !== "instance" &&
      Object.keys(node.instanceOverrides).length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["instanceOverrides"],
        message: "Only instances may carry overrides.",
      });
    }
    const allowedContentKinds = {
      frame: [
        "frame",
        "group",
        "component",
        "section",
        "imported-source-frame",
      ],
      note: ["sticky"],
      image: ["image"],
      vector: ["vector", "line", "arrow", "connector"],
    } as const;
    if (
      node.content !== null &&
      !(allowedContentKinds[node.content.type] as readonly string[]).includes(
        node.kind,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: `${node.content.type} content is incompatible with ${node.kind}.`,
      });
    }
    if (
      node.sourceBinding !== null &&
      node.kind !== "imported-source-frame"
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceBinding"],
        message: "Live source bindings require an imported source frame.",
      });
    }
    if (node.sourceBinding !== null && node.provenance !== null) {
      context.addIssue({
        code: "custom",
        path: ["provenance"],
        message: "Live source and detached provenance are mutually exclusive.",
      });
    }
    if (
      node.componentBinding?.classification === "master" &&
      node.kind !== "component"
    ) {
      context.addIssue({
        code: "custom",
        path: ["componentBinding"],
        message: "Component master metadata requires a component node.",
      });
    }
    if (
      node.componentBinding?.classification === "instance" &&
      (node.kind !== "instance" ||
        node.componentId !== node.componentBinding.componentId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["componentBinding"],
        message: "Instance metadata must match the instance component.",
      });
    }
  });
export type CanvasNodeV2 = z.infer<typeof CanvasNodeV2Schema>;
export type CanvasNodeV2Input = z.input<typeof CanvasNodeV2Schema>;

export const CanvasComponentDefinitionV2Schema = z.strictObject({
  id: CanvasComponentIdSchema,
  name: z.string().trim().min(1).max(512),
  rootNodeId: CanvasNodeIdSchema,
  propertyKeys: z.array(SafeKeySchema).max(256),
});
export type CanvasComponentDefinitionV2 = z.infer<
  typeof CanvasComponentDefinitionV2Schema
>;
export type CanvasComponentDefinitionV2Input = z.input<
  typeof CanvasComponentDefinitionV2Schema
>;

export const CanvasTokenV2Schema = z.strictObject({
  id: SafeKeySchema,
  name: z.string().trim().min(1).max(512),
  type: z.enum(["color", "number", "string", "boolean"]),
  value: z.union([z.string(), z.number().finite(), z.boolean()]),
});
export type CanvasTokenV2 = z.infer<typeof CanvasTokenV2Schema>;

export const CanvasDocumentV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    id: CanvasDocumentIdSchema,
    projectId: ProjectIdSchema,
    revision: z.number().int().nonnegative(),
    stateHash: ContentHashSchema,
    operationCursor: OperationIdSchema.nullable(),
    rootIds: z.array(CanvasNodeIdSchema),
    nodesById: z.record(z.string(), CanvasNodeV2Schema),
    componentsById: z.record(
      z.string(),
      CanvasComponentDefinitionV2Schema,
    ),
    tokensById: z.record(SafeKeySchema, CanvasTokenV2Schema),
  })
  .superRefine((document, context) => {
    if (!hasUniqueValues(document.rootIds)) {
      context.addIssue({
        code: "custom",
        path: ["rootIds"],
        message: "Root IDs must be unique.",
      });
    }
    const nodes = Object.values(document.nodesById);
    for (const [key, node] of Object.entries(document.nodesById)) {
      if (key !== node.id) {
        context.addIssue({
          code: "custom",
          path: ["nodesById", key, "id"],
          message: "Node map key must equal node ID.",
        });
      }
    }
    for (const rootId of document.rootIds) {
      const root = document.nodesById[rootId];
      if (root === undefined || root.parentId !== null) {
        context.addIssue({
          code: "custom",
          path: ["rootIds"],
          message: "Every root ID must name a parentless node.",
        });
      }
    }
    for (const node of nodes) {
      if (node.parentId === null) {
        if (!document.rootIds.includes(node.id)) {
          context.addIssue({
            code: "custom",
            path: ["nodesById", node.id, "parentId"],
            message: "Every parentless node must appear in root order.",
          });
        }
      } else {
        const parent = document.nodesById[node.parentId];
        if (parent === undefined || !parent.childIds.includes(node.id)) {
          context.addIssue({
            code: "custom",
            path: ["nodesById", node.id, "parentId"],
            message: "Every child must appear in its parent's child order.",
          });
        }
      }
      for (const childId of node.childIds) {
        const child = document.nodesById[childId];
        if (child === undefined || child.parentId !== node.id) {
          context.addIssue({
            code: "custom",
            path: ["nodesById", node.id, "childIds"],
            message: "Every child ID must name a node parented by this node.",
          });
        }
      }
      if (
        node.kind === "instance" &&
        node.componentId !== null &&
        document.componentsById[node.componentId] === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["nodesById", node.id, "componentId"],
          message: "Instance component must exist.",
        });
      }
    }

    for (const node of nodes) {
      const seen = new Set<string>();
      let current: CanvasNodeV2 | undefined = node;
      while (current?.parentId !== null && current !== undefined) {
        if (seen.has(current.id)) {
          context.addIssue({
            code: "custom",
            path: ["nodesById", node.id, "parentId"],
            message: "Canvas hierarchy cannot contain a cycle.",
          });
          break;
        }
        seen.add(current.id);
        current = document.nodesById[current.parentId];
      }
    }

    for (const [key, component] of Object.entries(document.componentsById)) {
      if (
        key !== component.id ||
        document.nodesById[component.rootNodeId] === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["componentsById", key],
          message: "Component key and root node must be valid.",
        });
      }
    }
    for (const [key, token] of Object.entries(document.tokensById)) {
      if (key !== token.id) {
        context.addIssue({
          code: "custom",
          path: ["tokensById", key, "id"],
          message: "Token map key must equal token ID.",
        });
      }
    }
  });
export type CanvasDocumentV2 = z.infer<typeof CanvasDocumentV2Schema>;

const NodeCreateActionV2Schema = z.strictObject({
  type: z.literal("node.create"),
  payload: z.strictObject({
    node: CanvasNodeV2Schema,
    parentId: CanvasNodeIdSchema.nullable(),
    index: IndexSchema,
  }),
});
const NodeDeleteActionV2Schema = z.strictObject({
  type: z.literal("node.delete"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    prior: z.strictObject({
      node: CanvasNodeV2Schema,
      parentId: CanvasNodeIdSchema.nullable(),
      index: IndexSchema,
    }),
  }),
});
const NodeTransformActionV2Schema = z.strictObject({
  type: z.literal("node.transform"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    prior: CanvasTransformV2Schema,
    next: CanvasTransformV2Schema,
  }),
});
const NodeGeometryActionV2Schema = z.strictObject({
  type: z.literal("node.geometry"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    prior: CanvasGeometryV2Schema,
    next: CanvasGeometryV2Schema,
  }),
});
const NodeStyleActionV2Schema = z.strictObject({
  type: z.literal("node.style"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    prior: CanvasStyleV2Schema,
    next: CanvasStyleV2Schema,
  }),
});
const NodeTextActionV2Schema = z.strictObject({
  type: z.literal("node.text"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    prior: CanvasTextV2Schema,
    next: CanvasTextV2Schema,
  }),
});
const NodeLayoutActionV2Schema = z.strictObject({
  type: z.literal("node.layout"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    prior: CanvasLayoutV2Schema,
    next: CanvasLayoutV2Schema,
  }),
});
const NodeReparentActionV2Schema = z.strictObject({
  type: z.literal("node.reparent"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    prior: z.strictObject({
      parentId: CanvasNodeIdSchema.nullable(),
      index: IndexSchema,
    }),
    next: z.strictObject({
      parentId: CanvasNodeIdSchema.nullable(),
      index: IndexSchema,
    }),
  }),
});
const NodeReorderActionV2Schema = z.strictObject({
  type: z.literal("node.reorder"),
  payload: z.strictObject({
    parentId: CanvasNodeIdSchema.nullable(),
    prior: z.array(CanvasNodeIdSchema),
    next: z.array(CanvasNodeIdSchema),
  }),
});
const ComponentDefineActionV2Schema = z.strictObject({
  type: z.literal("component.define"),
  payload: z.strictObject({
    componentId: CanvasComponentIdSchema,
    prior: CanvasComponentDefinitionV2Schema.nullable(),
    next: CanvasComponentDefinitionV2Schema.nullable(),
  }),
});
const InstanceOverrideActionV2Schema = z.strictObject({
  type: z.literal("instance.override"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    key: SafeKeySchema,
    prior: z.json().nullable(),
    next: z.json().nullable(),
  }),
});
const NodeIdentityActionV2Schema = z.strictObject({
  type: z.literal("node.identity"),
  payload: NodeIdentityActionPayloadV2Schema,
});
const NodeContentActionV2Schema = z.strictObject({
  type: z.literal("node.content"),
  payload: NodeContentActionPayloadV2Schema,
});
const NodeProvenanceActionV2Schema = z.strictObject({
  type: z.literal("node.provenance"),
  payload: NodeProvenanceActionPayloadV2Schema,
});
const NodeComponentActionV2Schema = z.strictObject({
  type: z.literal("node.component"),
  payload: NodeComponentActionPayloadV2Schema,
});
const NodeDetachActionV2Schema = z.strictObject({
  type: z.literal("node.detach"),
  payload: NodeDetachActionPayloadV2Schema,
});

export const CanvasActionV2Schema = z.discriminatedUnion("type", [
  NodeCreateActionV2Schema,
  NodeDeleteActionV2Schema,
  NodeTransformActionV2Schema,
  NodeGeometryActionV2Schema,
  NodeStyleActionV2Schema,
  NodeTextActionV2Schema,
  NodeLayoutActionV2Schema,
  NodeReparentActionV2Schema,
  NodeReorderActionV2Schema,
  ComponentDefineActionV2Schema,
  InstanceOverrideActionV2Schema,
  NodeIdentityActionV2Schema,
  NodeContentActionV2Schema,
  NodeProvenanceActionV2Schema,
  NodeComponentActionV2Schema,
  NodeDetachActionV2Schema,
]);
export type CanvasActionV2 = z.infer<typeof CanvasActionV2Schema>;

const AtomicBatchActionV2Schema = z.strictObject({
  type: z.literal("atomic.batch"),
  payload: z.strictObject({
    actions: z.array(CanvasActionV2Schema).min(1).max(1_000),
  }),
});
export type AtomicBatchActionV2 = z.infer<typeof AtomicBatchActionV2Schema>;

const operationBase = {
  schemaVersion: z.literal(2),
  id: OperationIdSchema,
  documentId: CanvasDocumentIdSchema,
  actor: z.enum(["human", "agent", "system"]),
  actorId: z.string().trim().min(1).max(256),
  occurredAt: IsoTimestampSchema,
  label: z.string().trim().min(1).max(256),
  targetIds: z.array(
    z.union([CanvasNodeIdSchema, CanvasComponentIdSchema]),
  ),
  undoOf: OperationIdSchema.nullable(),
  actionDigest: ContentHashSchema,
  expectedBeforeHash: ContentHashSchema,
  resultingHash: ContentHashSchema,
  previousOperationCursor: OperationIdSchema.nullable(),
};

function operationSchema<
  const Type extends CanvasActionV2["type"] | "atomic.batch",
  Payload extends z.ZodType,
>(type: Type, payload: Payload) {
  return z.strictObject({
    ...operationBase,
    type: z.literal(type),
    payload,
  });
}

export const CanvasOperationV2Schema = z.discriminatedUnion("type", [
  operationSchema("node.create", NodeCreateActionV2Schema.shape.payload),
  operationSchema("node.delete", NodeDeleteActionV2Schema.shape.payload),
  operationSchema("node.transform", NodeTransformActionV2Schema.shape.payload),
  operationSchema("node.geometry", NodeGeometryActionV2Schema.shape.payload),
  operationSchema("node.style", NodeStyleActionV2Schema.shape.payload),
  operationSchema("node.text", NodeTextActionV2Schema.shape.payload),
  operationSchema("node.layout", NodeLayoutActionV2Schema.shape.payload),
  operationSchema("node.reparent", NodeReparentActionV2Schema.shape.payload),
  operationSchema("node.reorder", NodeReorderActionV2Schema.shape.payload),
  operationSchema(
    "component.define",
    ComponentDefineActionV2Schema.shape.payload,
  ),
  operationSchema(
    "instance.override",
    InstanceOverrideActionV2Schema.shape.payload,
  ),
  operationSchema("node.identity", NodeIdentityActionPayloadV2Schema),
  operationSchema("node.content", NodeContentActionPayloadV2Schema),
  operationSchema("node.provenance", NodeProvenanceActionPayloadV2Schema),
  operationSchema("node.component", NodeComponentActionPayloadV2Schema),
  operationSchema("node.detach", NodeDetachActionPayloadV2Schema),
  operationSchema("atomic.batch", AtomicBatchActionV2Schema.shape.payload),
]);
export type CanvasOperationV2 = z.infer<typeof CanvasOperationV2Schema>;

type NodeValueIntentV2<
  Type extends
    | "node.transform"
    | "node.geometry"
    | "node.style"
    | "node.text"
    | "node.layout"
    | "node.identity"
    | "node.content"
    | "node.provenance"
    | "node.component"
    | "node.detach",
  Value,
> = {
  readonly type: Type;
  readonly payload: {
    readonly nodeId: string;
    readonly next: Value;
  };
};

export type CanvasActionIntentV2 =
  | {
      readonly type: "node.create";
      readonly payload: {
        readonly node: CanvasNodeV2Input;
        readonly parentId: string | null;
        readonly index: number;
      };
    }
  | {
      readonly type: "node.delete";
      readonly payload: { readonly nodeId: string };
    }
  | NodeValueIntentV2<"node.transform", CanvasTransformV2>
  | NodeValueIntentV2<"node.geometry", CanvasGeometryV2>
  | NodeValueIntentV2<"node.style", CanvasStyleV2>
  | NodeValueIntentV2<"node.text", CanvasTextV2>
  | NodeValueIntentV2<"node.layout", CanvasLayoutV2>
  | {
      readonly type: "node.reparent";
      readonly payload: {
        readonly nodeId: string;
        readonly nextParentId: string | null;
        readonly nextIndex: number;
      };
    }
  | {
      readonly type: "node.reorder";
      readonly payload: {
        readonly parentId: string | null;
        readonly nextOrder: readonly string[];
      };
    }
  | {
      readonly type: "component.define";
      readonly payload: {
        readonly componentId: string;
        readonly next: CanvasComponentDefinitionV2Input | null;
      };
    }
  | {
      readonly type: "instance.override";
      readonly payload: {
        readonly nodeId: string;
        readonly key: string;
        readonly next: z.infer<ReturnType<typeof z.json>> | null;
      };
    }
  | NodeValueIntentV2<"node.identity", CanvasNodeIdentityV2>
  | NodeValueIntentV2<"node.content", CanvasNodeContentV2 | null>
  | NodeValueIntentV2<"node.provenance", CanvasNodeProvenanceStateV2>
  | NodeValueIntentV2<"node.component", CanvasNodeComponentStateV2>
  | NodeValueIntentV2<"node.detach", CanvasNodeDetachStateV2>
  | {
      readonly type: "atomic.batch";
      readonly payload: {
        readonly actions: readonly Exclude<
          CanvasActionIntentV2,
          { readonly type: "atomic.batch" }
        >[];
      };
    };
