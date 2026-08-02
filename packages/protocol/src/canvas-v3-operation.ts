import { z } from "zod";

import { canonicalJson } from "@memi/canonical-json";

import {
  ContentHashSchema,
  IsoTimestampSchema,
  hasUniqueValues,
} from "./common.js";
import {
  CanvasDocumentIdSchema,
  CanvasNodeIdSchema,
  OperationIdSchema,
  TraceEventIdSchema,
} from "./ids.js";
import { CanvasComponentIdSchema } from "./canvas-v2-semantics.js";
import {
  CanvasGeometryV2Schema,
  CanvasLayoutV2Schema,
  CanvasStyleV2Schema,
  CanvasTextV2Schema,
  CanvasTransformV2Schema,
} from "./canvas-v2.js";
import {
  CanvasAssetIdSchema,
  CanvasAssetV3Schema,
  CanvasComponentDefinitionV3Schema,
  CanvasNodeV3Schema,
  CanvasPageIdSchema,
  CanvasPageV3Schema,
  CanvasVariableCollectionV3Schema,
  CanvasVariableV3Schema,
  EditableReconstructionIdSchema,
  EditableReconstructionV1Schema,
  PrototypeConnectionIdSchema,
  PrototypeConnectionV3Schema,
  RuntimeEvidenceIdSchema,
  RuntimeEvidenceV1Schema,
} from "./canvas-v3-core.js";

const indexSchema = z.number().int().nonnegative();
const safeKey = z.string().trim().min(1).max(160);

function priorNext<Value extends z.ZodType>(value: Value) {
  return z.strictObject({ prior: value, next: value });
}

const NodeCreateActionV3Schema = z.strictObject({
  type: z.literal("node.create"),
  payload: z.strictObject({
    node: CanvasNodeV3Schema,
    parentId: CanvasNodeIdSchema.nullable(),
    index: indexSchema,
  }),
});
const NodeDeleteActionV3Schema = z.strictObject({
  type: z.literal("node.delete"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    prior: z.strictObject({
      node: CanvasNodeV3Schema,
      parentId: CanvasNodeIdSchema.nullable(),
      index: indexSchema,
    }),
  }),
});

function nodeValueAction<const Type extends string, Value extends z.ZodType>(
  type: Type,
  value: Value,
) {
  return z.strictObject({
    type: z.literal(type),
    payload: z.strictObject({
      nodeId: CanvasNodeIdSchema,
      ...priorNext(value).shape,
    }),
  });
}

const NodeTransformActionV3Schema = nodeValueAction(
  "node.transform",
  CanvasTransformV2Schema,
);
const NodeGeometryActionV3Schema = nodeValueAction(
  "node.geometry",
  CanvasGeometryV2Schema,
);
const NodeStyleActionV3Schema = nodeValueAction(
  "node.style",
  CanvasStyleV2Schema,
);
const NodeTextActionV3Schema = nodeValueAction(
  "node.text",
  CanvasTextV2Schema,
);
const NodeLayoutActionV3Schema = nodeValueAction(
  "node.layout",
  CanvasLayoutV2Schema,
);
const NodeReparentActionV3Schema = z.strictObject({
  type: z.literal("node.reparent"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    prior: z.strictObject({
      pageId: CanvasPageIdSchema,
      parentId: CanvasNodeIdSchema.nullable(),
      index: indexSchema,
    }),
    next: z.strictObject({
      pageId: CanvasPageIdSchema,
      parentId: CanvasNodeIdSchema.nullable(),
      index: indexSchema,
    }),
  }),
});
const NodeReorderActionV3Schema = z.strictObject({
  type: z.literal("node.reorder"),
  payload: z.strictObject({
    pageId: CanvasPageIdSchema,
    parentId: CanvasNodeIdSchema.nullable(),
    prior: z.array(CanvasNodeIdSchema),
    next: z.array(CanvasNodeIdSchema),
  }),
});

const PageDefineActionV3Schema = z.strictObject({
  type: z.literal("page.define"),
  payload: z.strictObject({
    pageId: CanvasPageIdSchema,
    prior: CanvasPageV3Schema.nullable(),
    next: CanvasPageV3Schema.nullable(),
  }),
});
const ComponentDefineActionV3Schema = z.strictObject({
  type: z.literal("component.define"),
  payload: z.strictObject({
    componentId: CanvasComponentIdSchema,
    prior: CanvasComponentDefinitionV3Schema.nullable(),
    next: CanvasComponentDefinitionV3Schema.nullable(),
  }),
});
const VariableCollectionDefineActionV3Schema = z.strictObject({
  type: z.literal("variable-collection.define"),
  payload: z.strictObject({
    collectionId: safeKey,
    prior: CanvasVariableCollectionV3Schema.nullable(),
    next: CanvasVariableCollectionV3Schema.nullable(),
  }),
});
const VariableDefineActionV3Schema = z.strictObject({
  type: z.literal("variable.define"),
  payload: z.strictObject({
    variableId: safeKey,
    prior: CanvasVariableV3Schema.nullable(),
    next: CanvasVariableV3Schema.nullable(),
  }),
});
const AssetDefineActionV3Schema = z.strictObject({
  type: z.literal("asset.define"),
  payload: z.strictObject({
    assetId: CanvasAssetIdSchema,
    prior: CanvasAssetV3Schema.nullable(),
    next: CanvasAssetV3Schema.nullable(),
  }),
});
const PrototypeDefineActionV3Schema = z.strictObject({
  type: z.literal("prototype.define"),
  payload: z.strictObject({
    connectionId: PrototypeConnectionIdSchema,
    prior: PrototypeConnectionV3Schema.nullable(),
    next: PrototypeConnectionV3Schema.nullable(),
  }),
});
const EvidenceDefineActionV3Schema = z.strictObject({
  type: z.literal("evidence.define"),
  payload: z.strictObject({
    evidenceId: RuntimeEvidenceIdSchema,
    prior: RuntimeEvidenceV1Schema.nullable(),
    next: RuntimeEvidenceV1Schema.nullable(),
  }),
});
const ReconstructionDefineActionV3Schema = z.strictObject({
  type: z.literal("reconstruction.define"),
  payload: z.strictObject({
    reconstructionId: EditableReconstructionIdSchema,
    prior: EditableReconstructionV1Schema.nullable(),
    next: EditableReconstructionV1Schema.nullable(),
  }),
});
const InstanceOverrideActionV3Schema = z.strictObject({
  type: z.literal("instance.override"),
  payload: z.strictObject({
    nodeId: CanvasNodeIdSchema,
    key: safeKey,
    prior: z.json().nullable(),
    next: z.json().nullable(),
  }),
});

const singleActions = [
  NodeCreateActionV3Schema,
  NodeDeleteActionV3Schema,
  NodeTransformActionV3Schema,
  NodeGeometryActionV3Schema,
  NodeStyleActionV3Schema,
  NodeTextActionV3Schema,
  NodeLayoutActionV3Schema,
  NodeReparentActionV3Schema,
  NodeReorderActionV3Schema,
  PageDefineActionV3Schema,
  ComponentDefineActionV3Schema,
  InstanceOverrideActionV3Schema,
  VariableCollectionDefineActionV3Schema,
  VariableDefineActionV3Schema,
  AssetDefineActionV3Schema,
  PrototypeDefineActionV3Schema,
  EvidenceDefineActionV3Schema,
  ReconstructionDefineActionV3Schema,
] as const;

export const CanvasSingleActionV3Schema = z.discriminatedUnion(
  "type",
  singleActions,
);
export type CanvasSingleActionV3 = z.infer<
  typeof CanvasSingleActionV3Schema
>;

const AtomicBatchActionV3Schema = z.strictObject({
  type: z.literal("atomic.batch"),
  payload: z.strictObject({
    actions: z.array(CanvasSingleActionV3Schema).min(1).max(1_000),
  }),
});

export const CanvasActionV3Schema = z.discriminatedUnion("type", [
  ...singleActions,
  AtomicBatchActionV3Schema,
]);
export type CanvasActionV3 = z.infer<typeof CanvasActionV3Schema>;

export const CanvasActionTypeV3Schema = z.enum([
  "node.create",
  "node.delete",
  "node.transform",
  "node.geometry",
  "node.style",
  "node.text",
  "node.layout",
  "node.reparent",
  "node.reorder",
  "page.define",
  "component.define",
  "instance.override",
  "variable-collection.define",
  "variable.define",
  "asset.define",
  "prototype.define",
  "evidence.define",
  "reconstruction.define",
  "atomic.batch",
]);
export type CanvasActionTypeV3 = z.infer<typeof CanvasActionTypeV3Schema>;

function exactInverseAction(
  action: CanvasActionV3,
): CanvasActionV3 {
  if (action.type === "atomic.batch") {
    return CanvasActionV3Schema.parse({
      type: "atomic.batch",
      payload: {
        actions: [...action.payload.actions].reverse().map(exactInverseAction),
      },
    });
  }
  if (action.type === "node.create") {
    return CanvasActionV3Schema.parse({
      type: "node.delete",
      payload: {
        nodeId: action.payload.node.id,
        prior: action.payload,
      },
    });
  }
  if (action.type === "node.delete") {
    return CanvasActionV3Schema.parse({
      type: "node.create",
      payload: action.payload.prior,
    });
  }
  return CanvasSingleActionV3Schema.parse({
    ...action,
    payload: {
      ...action.payload,
      prior: action.payload.next,
      next: action.payload.prior,
    },
  });
}

function hasExactInverseAction(
  action: CanvasActionV3,
  inverseAction: CanvasActionV3,
): boolean {
  return canonicalJson(exactInverseAction(action)) === canonicalJson(inverseAction);
}

export const CanvasOperationV3Schema = z
  .strictObject({
    schemaVersion: z.literal(3),
    id: OperationIdSchema,
    documentId: CanvasDocumentIdSchema,
    actor: z.enum(["human", "agent", "system"]),
    actorId: z.string().trim().min(1).max(256),
    occurredAt: IsoTimestampSchema,
    label: z.string().trim().min(1).max(256),
    targetIds: z.array(z.string().trim().min(1).max(256)).max(100_000),
    undoOf: OperationIdSchema.nullable(),
    traceId: TraceEventIdSchema.nullable(),
    expectedRevision: z.number().int().nonnegative(),
    previousOperationCursor: OperationIdSchema.nullable(),
    expectedBeforeHash: ContentHashSchema,
    resultingHash: ContentHashSchema,
    actionDigest: ContentHashSchema,
    type: CanvasActionTypeV3Schema,
    action: CanvasActionV3Schema,
    inverseAction: CanvasActionV3Schema,
  })
  .superRefine((operation, context) => {
    if (operation.type !== operation.action.type) {
      context.addIssue({
        code: "custom",
        path: ["type"],
        message: "Operation type must match its forward action type.",
      });
    }
    if (!hasExactInverseAction(operation.action, operation.inverseAction)) {
      context.addIssue({
        code: "custom",
        path: ["inverseAction"],
        message: "Operation inverse action must exactly reverse the forward action.",
      });
    }
    if (!hasUniqueValues(operation.targetIds)) {
      context.addIssue({
        code: "custom",
        path: ["targetIds"],
        message: "Operation targets must be unique.",
      });
    }
  });
export type CanvasOperationV3 = z.infer<typeof CanvasOperationV3Schema>;

type NodeValueIntentV3<
  Type extends
    | "node.transform"
    | "node.geometry"
    | "node.style"
    | "node.text"
    | "node.layout",
  Value,
> = {
  readonly type: Type;
  readonly payload: { readonly nodeId: string; readonly next: Value };
};

type EntityDefineIntentV3<Type extends string, IdKey extends string, Value> = {
  readonly type: Type;
  readonly payload: Readonly<Record<IdKey, string>> & {
    readonly next: Value | null;
  };
};

export type CanvasSingleActionIntentV3 =
  | {
      readonly type: "node.create";
      readonly payload: {
        readonly node: z.input<typeof CanvasNodeV3Schema>;
        readonly parentId: string | null;
        readonly index: number;
      };
    }
  | {
      readonly type: "node.delete";
      readonly payload: { readonly nodeId: string };
    }
  | NodeValueIntentV3<"node.transform", z.infer<typeof CanvasTransformV2Schema>>
  | NodeValueIntentV3<"node.geometry", z.infer<typeof CanvasGeometryV2Schema>>
  | NodeValueIntentV3<"node.style", z.infer<typeof CanvasStyleV2Schema>>
  | NodeValueIntentV3<"node.text", z.infer<typeof CanvasTextV2Schema>>
  | NodeValueIntentV3<"node.layout", z.infer<typeof CanvasLayoutV2Schema>>
  | {
      readonly type: "node.reparent";
      readonly payload: {
        readonly nodeId: string;
        readonly nextPageId: string;
        readonly nextParentId: string | null;
        readonly nextIndex: number;
      };
    }
  | {
      readonly type: "node.reorder";
      readonly payload: {
        readonly pageId: string;
        readonly parentId: string | null;
        readonly nextOrder: readonly string[];
      };
    }
  | EntityDefineIntentV3<"page.define", "pageId", z.input<typeof CanvasPageV3Schema>>
  | EntityDefineIntentV3<
      "component.define",
      "componentId",
      z.input<typeof CanvasComponentDefinitionV3Schema>
    >
  | {
      readonly type: "instance.override";
      readonly payload: {
        readonly nodeId: string;
        readonly key: string;
        readonly next: z.infer<ReturnType<typeof z.json>> | null;
      };
    }
  | EntityDefineIntentV3<
      "variable-collection.define",
      "collectionId",
      z.input<typeof CanvasVariableCollectionV3Schema>
    >
  | EntityDefineIntentV3<
      "variable.define",
      "variableId",
      z.input<typeof CanvasVariableV3Schema>
    >
  | EntityDefineIntentV3<"asset.define", "assetId", z.input<typeof CanvasAssetV3Schema>>
  | EntityDefineIntentV3<
      "prototype.define",
      "connectionId",
      z.input<typeof PrototypeConnectionV3Schema>
    >
  | EntityDefineIntentV3<
      "evidence.define",
      "evidenceId",
      z.input<typeof RuntimeEvidenceV1Schema>
    >
  | EntityDefineIntentV3<
      "reconstruction.define",
      "reconstructionId",
      z.input<typeof EditableReconstructionV1Schema>
    >;

export type CanvasActionIntentV3 =
  | CanvasSingleActionIntentV3
  | {
      readonly type: "atomic.batch";
      readonly payload: {
        readonly actions: readonly CanvasSingleActionIntentV3[];
      };
    };
