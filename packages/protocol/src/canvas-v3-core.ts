import { z } from "zod";

import {
  ContentHashSchema,
  IsoTimestampSchema,
  hasUniqueValues,
} from "./common.js";
import {
  ArtifactIdSchema,
  CanvasDocumentIdSchema,
  CanvasNodeIdSchema,
  OperationIdSchema,
  ProjectIdSchema,
} from "./ids.js";
import {
  CanvasComponentIdSchema,
} from "./canvas-v2-semantics.js";
import {
  CanvasNodeV2Schema,
} from "./canvas-v2.js";

const sortableId = "[0-9A-HJKMNP-TV-Z]{26}";
const finiteNumber = z.number().finite();
const positiveFiniteNumber = finiteNumber.positive();
const safeKey = z.string().trim().min(1).max(160);
const safeText = z.string().trim().min(1).max(2_048);

function v3Id<const Brand extends string>(prefix: string) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_${sortableId}$`, "u"))
    .brand<Brand>();
}

export const CanvasPageIdSchema = v3Id<"CanvasPageId">("pag");
export const CanvasAssetIdSchema = v3Id<"CanvasAssetId">("ast");
export const PrototypeConnectionIdSchema =
  v3Id<"PrototypeConnectionId">("ptc");
export const RuntimeEvidenceIdSchema = v3Id<"RuntimeEvidenceId">("evd");
export const EditableReconstructionIdSchema =
  v3Id<"EditableReconstructionId">("rec");

export type CanvasPageId = z.infer<typeof CanvasPageIdSchema>;
export type CanvasAssetId = z.infer<typeof CanvasAssetIdSchema>;
export type PrototypeConnectionId = z.infer<
  typeof PrototypeConnectionIdSchema
>;
export type RuntimeEvidenceId = z.infer<typeof RuntimeEvidenceIdSchema>;
export type EditableReconstructionId = z.infer<
  typeof EditableReconstructionIdSchema
>;

export const CanvasPageV3Schema = z.strictObject({
  id: CanvasPageIdSchema,
  kind: z.enum(["design", "imported", "whiteboard", "library"]),
  name: z.string().trim().min(1).max(512),
  rootIds: z.array(CanvasNodeIdSchema).max(100_000),
});
export type CanvasPageV3 = z.infer<typeof CanvasPageV3Schema>;

export const CanvasNodeV3Schema = CanvasNodeV2Schema.safeExtend({
  pageId: CanvasPageIdSchema,
});
export type CanvasNodeV3 = z.infer<typeof CanvasNodeV3Schema>;
export type CanvasNodeV3Input = z.input<typeof CanvasNodeV3Schema>;

const ComponentPropertyV3Schema = z.strictObject({
  type: z.enum(["text", "boolean", "instance-swap", "variant", "unknown"]),
  defaultValue: z.json(),
  allowedValues: z.array(z.json()).max(1_000).optional(),
});

export const CanvasComponentDefinitionV3Schema = z.strictObject({
  id: CanvasComponentIdSchema,
  name: z.string().trim().min(1).max(512),
  rootNodeId: CanvasNodeIdSchema,
  propertyDefinitions: z.record(safeKey, ComponentPropertyV3Schema),
  variantAxes: z.record(safeKey, z.array(safeText).min(1).max(256)),
});
export type CanvasComponentDefinitionV3 = z.infer<
  typeof CanvasComponentDefinitionV3Schema
>;

export const CanvasVariableCollectionV3Schema = z
  .strictObject({
    id: safeKey,
    name: z.string().trim().min(1).max(512),
    modeIds: z.array(safeKey).min(1).max(256),
    defaultModeId: safeKey,
  })
  .superRefine((collection, context) => {
    if (!hasUniqueValues(collection.modeIds)) {
      context.addIssue({
        code: "custom",
        path: ["modeIds"],
        message: "Variable collection mode IDs must be unique.",
      });
    }
    if (!collection.modeIds.includes(collection.defaultModeId)) {
      context.addIssue({
        code: "custom",
        path: ["defaultModeId"],
        message: "Default mode must belong to the collection.",
      });
    }
  });
export type CanvasVariableCollectionV3 = z.infer<
  typeof CanvasVariableCollectionV3Schema
>;

export const CanvasVariableV3Schema = z.strictObject({
  id: safeKey,
  collectionId: safeKey,
  name: z.string().trim().min(1).max(512),
  type: z.enum(["color", "number", "string", "boolean"]),
  valuesByMode: z.record(
    safeKey,
    z.union([z.string(), finiteNumber, z.boolean()]),
  ),
});
export type CanvasVariableV3 = z.infer<typeof CanvasVariableV3Schema>;

export const CanvasAssetV3Schema = z.strictObject({
  id: CanvasAssetIdSchema,
  name: z.string().trim().min(1).max(512),
  kind: z.enum(["image", "vector", "font", "binary"]),
  artifactId: ArtifactIdSchema,
  contentHash: ContentHashSchema,
  mimeType: z.string().trim().min(1).max(256),
  width: positiveFiniteNumber.nullable(),
  height: positiveFiniteNumber.nullable(),
});
export type CanvasAssetV3 = z.infer<typeof CanvasAssetV3Schema>;

export const PrototypeConnectionV3Schema = z
  .strictObject({
    id: PrototypeConnectionIdSchema,
    sourceNodeId: CanvasNodeIdSchema,
    trigger: z.enum(["click", "hover", "press", "drag", "after-delay"]),
    action: z.enum([
      "navigate",
      "open-overlay",
      "close-overlay",
      "back",
      "scroll-to",
      "open-url",
    ]),
    destinationNodeId: CanvasNodeIdSchema.nullable(),
    url: z.string().url().max(8_192).nullable(),
    transition: z.enum(["instant", "dissolve", "slide", "smart-animate"]),
    durationMs: z.number().int().nonnegative().max(60_000),
  })
  .superRefine((connection, context) => {
    const needsDestination = [
      "navigate",
      "open-overlay",
      "scroll-to",
    ].includes(connection.action);
    if (needsDestination !== (connection.destinationNodeId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["destinationNodeId"],
        message: "Prototype destination does not match the action.",
      });
    }
    if ((connection.action === "open-url") !== (connection.url !== null)) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "Only open-url actions may carry a URL.",
      });
    }
  });
export type PrototypeConnectionV3 = z.infer<
  typeof PrototypeConnectionV3Schema
>;

export const RuntimeEvidenceV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: RuntimeEvidenceIdSchema,
    applicationId: safeText,
    scenarioId: safeText,
    route: z.string().trim().min(1).max(8_192),
    state: safeText,
    sourceRevision: safeText,
    fixtureFingerprint: ContentHashSchema,
    screenshotArtifactId: ArtifactIdSchema,
    hierarchyArtifactId: ArtifactIdSchema,
    geometryArtifactId: ArtifactIdSchema,
    reconstructionArtifactId: ArtifactIdSchema.nullable().default(null),
    capturedAt: IsoTimestampSchema,
    viewport: z.strictObject({
      name: safeText,
      logicalWidth: positiveFiniteNumber,
      logicalHeight: positiveFiniteNumber,
      pixelWidth: z.number().int().positive(),
      pixelHeight: z.number().int().positive(),
      scale: positiveFiniteNumber,
    }),
    verification: z.strictObject({
      status: z.enum(["captured", "verified", "rejected"]),
      stableFrameHashes: z.tuple([ContentHashSchema, ContentHashSchema]),
      rejectionReasons: z.array(safeText).max(256),
    }),
  })
  .superRefine((evidence, context) => {
    const { status, stableFrameHashes, rejectionReasons } =
      evidence.verification;
    if (
      status === "verified" &&
      stableFrameHashes[0] !== stableFrameHashes[1]
    ) {
      context.addIssue({
        code: "custom",
        path: ["verification", "stableFrameHashes"],
        message: "Verified evidence requires two identical stable frames.",
      });
    }
    if (status === "verified" && rejectionReasons.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["verification", "rejectionReasons"],
        message: "Verified evidence cannot carry rejection reasons.",
      });
    }
    if (status === "rejected" && rejectionReasons.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["verification", "rejectionReasons"],
        message: "Rejected evidence requires a reason.",
      });
    }
    if (
      evidence.viewport.pixelWidth !==
        evidence.viewport.logicalWidth * evidence.viewport.scale ||
      evidence.viewport.pixelHeight !==
        evidence.viewport.logicalHeight * evidence.viewport.scale
    ) {
      context.addIssue({
        code: "custom",
        path: ["viewport"],
        message: "Runtime pixel dimensions must match logical size and scale.",
      });
    }
  });
export type RuntimeEvidenceV1 = z.infer<typeof RuntimeEvidenceV1Schema>;

const ReconstructionConfidenceV1Schema = z.strictObject({
  score: z.number().finite().min(0).max(1),
  basis: z
    .array(
      z.enum([
        "runtime-geometry",
        "runtime-hierarchy",
        "computed-style",
        "source-anchor",
        "inferred",
      ]),
    )
    .min(1)
    .max(16),
});

export const EditableReconstructionV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: EditableReconstructionIdSchema,
    pageId: CanvasPageIdSchema,
    evidenceId: RuntimeEvidenceIdSchema,
    editableRootIds: z.array(CanvasNodeIdSchema).min(1).max(100_000),
    confidenceByNodeId: z.record(
      CanvasNodeIdSchema,
      ReconstructionConfidenceV1Schema,
    ),
    fidelity: z.strictObject({
      status: z.enum(["pending", "verified", "needs-review"]),
      ssim: z.number().finite().min(0).max(1).nullable(),
      maximumGeometryDelta: z.number().finite().nonnegative().nullable(),
      diffArtifactId: ArtifactIdSchema.nullable(),
    }),
  })
  .superRefine((reconstruction, context) => {
    if (!hasUniqueValues(reconstruction.editableRootIds)) {
      context.addIssue({
        code: "custom",
        path: ["editableRootIds"],
        message: "Editable reconstruction roots must be unique.",
      });
    }
    for (const rootId of reconstruction.editableRootIds) {
      if (reconstruction.confidenceByNodeId[rootId] === undefined) {
        context.addIssue({
          code: "custom",
          path: ["confidenceByNodeId", rootId],
          message: "Every editable root requires confidence evidence.",
        });
      }
    }
    const { status, ssim, maximumGeometryDelta, diffArtifactId } =
      reconstruction.fidelity;
    if (
      status === "verified" &&
      (ssim === null || ssim < 0.985)
    ) {
      context.addIssue({
        code: "custom",
        path: ["fidelity", "ssim"],
        message: "Verified reconstruction SSIM must be at least 0.985.",
      });
    }
    if (
      status === "verified" &&
      (maximumGeometryDelta === null || maximumGeometryDelta > 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["fidelity", "maximumGeometryDelta"],
        message: "Verified geometry delta cannot exceed one logical point.",
      });
    }
    if (status === "verified" && diffArtifactId === null) {
      context.addIssue({
        code: "custom",
        path: ["fidelity", "diffArtifactId"],
        message: "Verified reconstruction requires a difference artifact.",
      });
    }
    if (
      status === "pending" &&
      (ssim !== null || maximumGeometryDelta !== null || diffArtifactId !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["fidelity"],
        message: "Pending reconstruction cannot claim fidelity evidence.",
      });
    }
  });
export type EditableReconstructionV1 = z.infer<
  typeof EditableReconstructionV1Schema
>;

export const InteractionSessionStateSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    documentId: CanvasDocumentIdSchema,
    documentRevision: z.number().int().nonnegative(),
    selection: z.strictObject({
      selectedIds: z.array(CanvasNodeIdSchema).max(100_000),
      anchorId: CanvasNodeIdSchema.nullable(),
      focusedNodeId: CanvasNodeIdSchema.nullable(),
      editingNodeId: CanvasNodeIdSchema.nullable(),
    }),
    viewport: z.strictObject({
      translation: z.strictObject({ x: finiteNumber, y: finiteNumber }),
      zoom: finiteNumber.min(0.02).max(8),
      width: positiveFiniteNumber,
      height: positiveFiniteNumber,
      pointerMode: z.enum([
        "select",
        "pan",
        "frame",
        "shape",
        "text",
        "vector",
        "connector",
      ]),
    }),
    hover: z.strictObject({ nodeId: CanvasNodeIdSchema.nullable() }),
    gesture: z
      .strictObject({
        kind: z.enum([
          "create",
          "move",
          "resize",
          "rotate",
          "marquee",
          "pan",
          "reparent",
        ]),
        pointerId: z.number().int().nonnegative(),
        origin: z.strictObject({ x: finiteNumber, y: finiteNumber }),
        current: z.strictObject({ x: finiteNumber, y: finiteNumber }),
      })
      .nullable(),
  })
  .superRefine((session, context) => {
    const selected = session.selection.selectedIds;
    if (!hasUniqueValues(selected)) {
      context.addIssue({
        code: "custom",
        path: ["selection", "selectedIds"],
        message: "Selected node IDs must be unique.",
      });
    }
    for (const [field, value] of [
      ["anchorId", session.selection.anchorId],
      ["focusedNodeId", session.selection.focusedNodeId],
      ["editingNodeId", session.selection.editingNodeId],
    ] as const) {
      if (value !== null && !selected.includes(value)) {
        context.addIssue({
          code: "custom",
          path: ["selection", field],
          message: `${field} must belong to the current selection.`,
        });
      }
    }
  });
export type InteractionSessionState = z.infer<
  typeof InteractionSessionStateSchema
>;

export const CanvasDocumentV3Schema = z
  .strictObject({
    schemaVersion: z.literal(3),
    id: CanvasDocumentIdSchema,
    projectId: ProjectIdSchema,
    revision: z.number().int().nonnegative(),
    stateHash: ContentHashSchema,
    operationCursor: OperationIdSchema.nullable(),
    pageIds: z.array(CanvasPageIdSchema).min(1).max(10_000),
    pagesById: z.record(z.string(), CanvasPageV3Schema),
    nodesById: z.record(z.string(), CanvasNodeV3Schema),
    componentsById: z.record(z.string(), CanvasComponentDefinitionV3Schema),
    variableCollectionsById: z.record(
      safeKey,
      CanvasVariableCollectionV3Schema,
    ),
    variablesById: z.record(safeKey, CanvasVariableV3Schema),
    assetsById: z.record(z.string(), CanvasAssetV3Schema),
    prototypeConnectionsById: z.record(z.string(), PrototypeConnectionV3Schema),
    evidenceById: z.record(z.string(), RuntimeEvidenceV1Schema),
    reconstructionsById: z.record(z.string(), EditableReconstructionV1Schema),
  })
  .superRefine((document, context) => {
    if (
      !hasUniqueValues(document.pageIds) ||
      document.pageIds.length !== Object.keys(document.pagesById).length
    ) {
      context.addIssue({
        code: "custom",
        path: ["pageIds"],
        message: "Page order must name every page exactly once.",
      });
    }
    for (const [pageId, page] of Object.entries(document.pagesById)) {
      if (pageId !== page.id || !document.pageIds.includes(page.id)) {
        context.addIssue({
          code: "custom",
          path: ["pagesById", pageId],
          message: "Page map keys and page order must match page IDs.",
        });
      }
      if (!hasUniqueValues(page.rootIds)) {
        context.addIssue({
          code: "custom",
          path: ["pagesById", pageId, "rootIds"],
          message: "Page root IDs must be unique.",
        });
      }
      for (const rootId of page.rootIds) {
        const root = document.nodesById[rootId];
        if (root === undefined || root.parentId !== null || root.pageId !== page.id) {
          context.addIssue({
            code: "custom",
            path: ["pagesById", pageId, "rootIds"],
            message: "Every page root must name a parentless node on that page.",
          });
        }
      }
    }
    for (const [nodeId, node] of Object.entries(document.nodesById)) {
      if (nodeId !== node.id || document.pagesById[node.pageId] === undefined) {
        context.addIssue({
          code: "custom",
          path: ["nodesById", nodeId],
          message: "Node map key and page must be valid.",
        });
      }
      if (node.parentId === null) {
        if (!document.pagesById[node.pageId]?.rootIds.includes(node.id)) {
          context.addIssue({
            code: "custom",
            path: ["nodesById", nodeId, "parentId"],
            message: "Parentless nodes must appear in their page root order.",
          });
        }
      } else {
        const parent = document.nodesById[node.parentId];
        if (
          parent === undefined ||
          parent.pageId !== node.pageId ||
          !parent.childIds.includes(node.id)
        ) {
          context.addIssue({
            code: "custom",
            path: ["nodesById", nodeId, "parentId"],
            message: "Child and parent relationships must stay on one page.",
          });
        }
      }
      for (const childId of node.childIds) {
        const child = document.nodesById[childId];
        if (child === undefined || child.parentId !== node.id) {
          context.addIssue({
            code: "custom",
            path: ["nodesById", nodeId, "childIds"],
            message: "Every child ID must reference a child of this node.",
          });
        }
      }
      const seen = new Set<string>();
      let current: CanvasNodeV3 | undefined = node;
      while (current !== undefined && current.parentId !== null) {
        if (seen.has(current.id)) {
          context.addIssue({
            code: "custom",
            path: ["nodesById", nodeId, "parentId"],
            message: "Canvas hierarchy cannot contain a cycle.",
          });
          break;
        }
        seen.add(current.id);
        current = document.nodesById[current.parentId];
      }
    }
    for (const [componentId, component] of Object.entries(
      document.componentsById,
    )) {
      const root = document.nodesById[component.rootNodeId];
      if (
        componentId !== component.id ||
        root === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["componentsById", componentId],
          message: "Component definitions require an existing root node.",
        });
      }
    }
    for (const [collectionId, collection] of Object.entries(
      document.variableCollectionsById,
    )) {
      if (collectionId !== collection.id) {
        context.addIssue({
          code: "custom",
          path: ["variableCollectionsById", collectionId],
          message: "Variable collection map key must match its ID.",
        });
      }
    }
    for (const [variableId, variable] of Object.entries(document.variablesById)) {
      const collection = document.variableCollectionsById[variable.collectionId];
      if (
        variableId !== variable.id ||
        collection === undefined ||
        Object.keys(variable.valuesByMode).some(
          (modeId) => !collection.modeIds.includes(modeId),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["variablesById", variableId],
          message: "Variable key, collection, and modes must be valid.",
        });
      }
    }
    for (const [connectionId, connection] of Object.entries(
      document.prototypeConnectionsById,
    )) {
      if (
        connectionId !== connection.id ||
        document.nodesById[connection.sourceNodeId] === undefined ||
        (connection.destinationNodeId !== null &&
          document.nodesById[connection.destinationNodeId] === undefined)
      ) {
        context.addIssue({
          code: "custom",
          path: ["prototypeConnectionsById", connectionId],
          message: "Prototype connection nodes must exist.",
        });
      }
    }
    for (const [evidenceId, evidence] of Object.entries(document.evidenceById)) {
      if (evidenceId !== evidence.id) {
        context.addIssue({
          code: "custom",
          path: ["evidenceById", evidenceId],
          message: "Runtime evidence map key must match its ID.",
        });
      }
    }
    for (const [reconstructionId, reconstruction] of Object.entries(
      document.reconstructionsById,
    )) {
      if (
        reconstructionId !== reconstruction.id ||
        document.pagesById[reconstruction.pageId]?.kind !== "imported" ||
        document.evidenceById[reconstruction.evidenceId] === undefined ||
        reconstruction.editableRootIds.some(
          (nodeId) =>
            document.nodesById[nodeId]?.pageId !== reconstruction.pageId,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["reconstructionsById", reconstructionId],
          message: "Reconstruction evidence, page, and editable roots must exist.",
        });
      }
    }
  });
export type CanvasDocumentV3 = z.infer<typeof CanvasDocumentV3Schema>;
