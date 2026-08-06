import { z } from "zod";
import { canonicalJson } from "@memi/canonical-json";
import { mapLegacyCanvasIdV2 } from "@memi/canvas-document";
import { CanvasComponentIdSchema, CanvasLayoutV2Schema } from "@memi/protocol";

import {
  provenanceFromSource,
  type CanvasWorkbenchProject,
  type ComponentInstanceBinding,
  type SceneState,
  type WorkbenchNode,
} from "./model.js";
import { isSafeReferenceSourceUrl } from "./reference-security.js";
import { canvasSourceFingerprint } from "./canvas-source-fingerprint.js";

export { canvasSourceFingerprint } from "./canvas-source-fingerprint.js";

export const CANVAS_AUTOSAVE_MAX_BYTES = 3_145_728;
export const CANVAS_AUTOSAVE_MAX_HISTORY_ENTRIES = 20;
export const CANVAS_AUTOSAVE_MAX_TRACE_ENTRIES = 100;

const MAX_NODES = 1_000;
const STORAGE_PREFIX = "memi.canvas.autosave.v1:";
const safeText = (maximum: number) => z.string().min(1).max(maximum);
const finiteNumber = z.number().finite().min(-1_000_000_000).max(
  1_000_000_000,
);

const PointSchema = z.strictObject({
  x: finiteNumber,
  y: finiteNumber,
});
const SizeSchema = z.strictObject({
  width: finiteNumber.positive(),
  height: finiteNumber.positive(),
});
const SourceSchema = z.strictObject({
  captureState: z.enum(["captured", "placeholder"]).optional(),
  repositoryRevision: safeText(512),
  repositoryDirty: z.boolean().optional(),
  dirtyFileFingerprint: safeText(512).optional(),
  sourceFingerprint: safeText(512).optional(),
  sourceContentHash: safeText(512).optional(),
  routeId: safeText(512),
  stateId: safeText(512),
  coverageCellId: safeText(512),
  sourceAnchor: safeText(4_096),
  viewport: z.strictObject({
    name: z.enum(["desktop", "tablet", "mobile"]),
    width: z.number().int().positive().max(32_768),
    height: z.number().int().positive().max(32_768),
  }),
});
const ProvenanceSchema = z.strictObject({
  captureState: z.enum(["captured", "placeholder"]).optional(),
  repositoryRevision: safeText(512),
  repositoryDirty: z.boolean().optional(),
  dirtyFileFingerprint: safeText(512).optional(),
  sourceFingerprint: safeText(512).optional(),
  sourceContentHash: safeText(512).optional(),
  sourceAnchor: safeText(4_096),
  routeId: safeText(512),
  stateId: safeText(512),
  coverageCellId: safeText(512),
});
const ReferenceSchema = z.strictObject({
  src: z
    .string()
    .min(1)
    .max(4_096)
    .regex(
      /^(?:\/imports\/artifacts\/art_[0-9A-HJKMNP-TV-Z]{26}\.png|memi-artifact:\/\/localhost\/art_[0-9A-HJKMNP-TV-Z]{26})$/u,
    ),
  alt: z.string().trim().min(1).max(2_048),
  authority: z.string().trim().min(1).max(256),
  appVersion: z.string().trim().min(1).max(128),
  capturedAt: z.iso.datetime(),
  sourceUrl: z
    .url()
    .max(8_192)
    .refine(isSafeReferenceSourceUrl),
  captureId: safeText(2_048).optional(),
  contentHash: safeText(512).optional(),
  sourceRevision: safeText(2_048).optional(),
  accessibilitySnapshotRef: safeText(2_048).optional(),
  sourceAnchors: z.array(safeText(2_048)).max(1_024).optional(),
  componentIds: z.array(safeText(2_048)).max(1_024).optional(),
});
const ComponentSourceSchema = z.strictObject({
  repositoryRevision: safeText(512),
  repositoryDirty: z.boolean().optional(),
  sourceAnchor: safeText(4_096),
  sourceContentHash: safeText(512).optional(),
  exportName: safeText(512).optional(),
});
const ComponentPreviewItemSchema = z.strictObject({
  icon: z.string().max(512).optional(),
  label: z.string().max(2_048),
  status: z.string().max(512).optional(),
  supportingText: z.string().max(4_096).optional(),
  value: z.string().max(2_048).optional(),
});

const ComponentSchema = z
  .strictObject({
    atomicLevel: z.enum([
      "atom",
      "molecule",
      "organism",
      "template",
      "page",
    ]),
    componentId: safeText(512),
    componentName: safeText(512),
    classification: z.enum(["master", "instance"]),
    editable: z.strictObject({
      label: z.boolean(),
      icon: z.boolean(),
      selected: z.boolean(),
      variant: z.boolean(),
    }),
    masterId: safeText(512).optional(),
    props: z.strictObject({
      label: z.string().max(2_048).optional(),
      icon: z.string().max(512).optional(),
      selected: z.boolean().optional(),
      status: z.string().max(512).optional(),
      supportingText: z.string().max(4_096).optional(),
      placeholder: z.string().max(2_048).optional(),
      value: z.string().max(2_048).optional(),
      items: z.array(ComponentPreviewItemSchema).max(100).optional(),
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
    source: ComponentSourceSchema,
    variant: z.string().max(512).optional(),
  })
  .superRefine((component, context) => {
    if (
      component.classification === "master" &&
      component.masterId !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Component masters cannot reference another master.",
        path: ["masterId"],
      });
    }
  });
const EmbeddedPngImageSchema = z.strictObject({
  alt: z.string().trim().min(1).max(4_096),
  byteLength: z.number().int().positive().max(2_097_152),
  height: z.number().int().positive().max(32_768),
  mimeType: z.literal("image/png"),
  src: z
    .string()
    .max(2_796_226)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u),
  width: z.number().int().positive().max(32_768),
});
const NodeSchema = z.strictObject({
  cornerRadii: z
    .tuple([
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
    ])
    .optional(),
  id: safeText(512),
  kind: z.enum([
    "CodeFrame",
    "RoutePlaceholder",
    "ReferenceFrame",
    "DraftFrame",
    "Text",
    "Image",
    "Rectangle",
    "Ellipse",
    "Line",
    "Arrow",
    "Vector",
    "Frame",
    "Group",
    "Section",
    "Slice",
    "Comment",
    "Component",
    "ComponentInstance",
  ]),
  image: EmbeddedPngImageSchema.optional(),
  name: safeText(2_048),
  parentId: safeText(512).nullable(),
  path: z.array(PointSchema).max(100_000).optional(),
  position: PointSchema,
  size: SizeSchema,
  locked: z.boolean(),
  layout: CanvasLayoutV2Schema.optional(),
  hidden: z.boolean(),
  opacity: z.number().finite().min(0).max(1).optional(),
  rotation: z.number().finite().optional(),
  text: z.string().max(65_536).optional(),
  fill: z.string().max(512).optional(),
  stroke: z.string().max(512).optional(),
  strokeAlign: z.enum(["inside", "center", "outside"]).optional(),
  strokeWeight: z.number().finite().nonnegative().optional(),
  source: SourceSchema.optional(),
  provenance: ProvenanceSchema.optional(),
  reference: ReferenceSchema.optional(),
  component: ComponentSchema.optional(),
  frameContent: z.string().max(65_536).optional(),
  semanticBaseline: z.string().max(65_536).optional(),
}).superRefine((node, context) => {
  if (node.kind === "ReferenceFrame" && node.reference === undefined) {
    context.addIssue({
      code: "custom",
      message: "Reference frames require immutable reference evidence.",
      path: ["reference"],
    });
  }
  if (node.kind !== "ReferenceFrame" && node.reference !== undefined) {
    context.addIssue({
      code: "custom",
      message: "Only reference frames can carry reference evidence.",
      path: ["reference"],
    });
  }
  if (node.kind === "Image" && node.image === undefined) {
    context.addIssue({
      code: "custom",
      message: "Image nodes require embedded PNG content.",
      path: ["image"],
    });
  }
  if (node.kind !== "Image" && node.image !== undefined) {
    context.addIssue({
      code: "custom",
      message: "Only Image nodes may carry embedded PNG content.",
      path: ["image"],
    });
  }
  if (
    node.kind === "Image" &&
    node.image !== undefined &&
    (node.size.width !== node.image.width ||
      node.size.height !== node.image.height)
  ) {
    context.addIssue({
      code: "custom",
      message: "Image geometry must match embedded PNG dimensions.",
      path: ["size"],
    });
  }
  if (node.kind === "ComponentInstance" && node.component === undefined) {
    context.addIssue({
      code: "custom",
      message: "Component instances require source-backed component metadata.",
      path: ["component"],
    });
  }
  if (
    node.kind !== "ComponentInstance" &&
    node.kind !== "Component" &&
    node.component !== undefined
  ) {
    context.addIssue({
      code: "custom",
      message: "Only component instances can carry component metadata.",
      path: ["component"],
    });
  }
});
const NodeListSchema = z.array(NodeSchema).max(MAX_NODES);
const SelectionSchema = safeText(512).nullable();
const HistoryEntrySchema = z.strictObject({
  id: z.number().int().positive(),
  label: safeText(2_048),
  before: NodeListSchema,
  after: NodeListSchema,
  beforeSelectedNodeId: SelectionSchema,
  afterSelectedNodeId: SelectionSchema,
  beforeRevision: z.number().int().nonnegative(),
  afterRevision: z.number().int().nonnegative(),
});
const SceneSchema = z.strictObject({
  nodes: NodeListSchema,
  selectedNodeId: SelectionSchema,
  revision: z.number().int().nonnegative(),
  past: z
    .array(HistoryEntrySchema)
    .max(CANVAS_AUTOSAVE_MAX_HISTORY_ENTRIES),
  future: z
    .array(HistoryEntrySchema)
    .max(CANVAS_AUTOSAVE_MAX_HISTORY_ENTRIES),
  nextHistoryId: z.number().int().positive(),
});
const TraceSchema = z.strictObject({
  id: safeText(512),
  action: safeText(8_192),
  targetNodeId: safeText(512),
  harnessId: safeText(512).optional(),
});

function validateNodeSnapshot(
  nodes: readonly z.infer<typeof NodeSchema>[],
  selectedNodeId: string | null,
  context: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  const nodeIds = nodes.map((node) => node.id);
  if (new Set(nodeIds).size !== nodeIds.length) {
    context.addIssue({
      code: "custom",
      message: "Canvas autosave contains duplicate node identities.",
      path: [...path, "nodes"],
    });
  }
  if (selectedNodeId !== null && !nodeIds.includes(selectedNodeId)) {
    context.addIssue({
      code: "custom",
      message: "Canvas autosave selection does not exist.",
      path: [...path, "selectedNodeId"],
    });
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  nodes.forEach((node, index) => {
    if (node.parentId !== null && !nodeById.has(node.parentId)) {
      context.addIssue({
        code: "custom",
        message: "Canvas autosave contains a dangling parent reference.",
        path: [...path, "nodes", index, "parentId"],
      });
    }
    const masterId = node.component?.masterId;
    if (
      node.component?.classification === "instance" &&
      (masterId === undefined ||
        nodeById.get(masterId)?.component?.classification !== "master")
    ) {
      context.addIssue({
        code: "custom",
        message: "Canvas autosave contains a dangling component master.",
        path: [...path, "nodes", index, "component", "masterId"],
      });
    }
  });
}

const PayloadSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("memi-canvas-autosave"),
    documentId: safeText(512),
    sourceFingerprint: z.string().regex(/^fnv1a64:[a-f0-9]{16}$/u),
    scene: SceneSchema,
    trace: z.array(TraceSchema).max(CANVAS_AUTOSAVE_MAX_TRACE_ENTRIES),
  })
  .superRefine((payload, context) => {
    validateNodeSnapshot(
      payload.scene.nodes,
      payload.scene.selectedNodeId,
      context,
      ["scene"],
    );
    for (const [collectionName, entries] of [
      ["past", payload.scene.past],
      ["future", payload.scene.future],
    ] as const) {
      entries.forEach((entry, index) => {
        validateNodeSnapshot(
          entry.before,
          entry.beforeSelectedNodeId,
          context,
          ["scene", collectionName, index, "before"],
        );
        validateNodeSnapshot(
          entry.after,
          entry.afterSelectedNodeId,
          context,
          ["scene", collectionName, index, "after"],
        );
      });
    }
    const historyIds = [
      ...payload.scene.past,
      ...payload.scene.future,
    ].map((entry) => entry.id);
    if (new Set(historyIds).size !== historyIds.length) {
      context.addIssue({
        code: "custom",
        message: "Canvas autosave contains duplicate history identities.",
        path: ["scene"],
      });
    }
    if (
      historyIds.length > 0 &&
      payload.scene.nextHistoryId <= Math.max(...historyIds)
    ) {
      context.addIssue({
        code: "custom",
        message: "Canvas autosave next history identity is stale.",
        path: ["scene", "nextHistoryId"],
      });
    }
    const traceIds = payload.trace.map((item) => item.id);
    if (new Set(traceIds).size !== traceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Canvas autosave contains duplicate trace identities.",
        path: ["trace"],
      });
    }
    const liveNodeIds = new Set(
      payload.scene.nodes.map((node) => node.id),
    );
    payload.trace.forEach((item, index) => {
      if (!liveNodeIds.has(item.targetNodeId)) {
        context.addIssue({
          code: "custom",
          message: "Canvas autosave trace target does not exist.",
          path: ["trace", index, "targetNodeId"],
        });
      }
    });
  });

type WorkbenchTrace = CanvasWorkbenchProject["trace"][number];

export interface CanvasStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CanvasRecovery {
  readonly scene: SceneState;
  readonly trace: readonly WorkbenchTrace[];
}

export interface CanvasAutosave {
  load(project: CanvasWorkbenchProject): CanvasRecovery | null;
  save(
    project: CanvasWorkbenchProject,
    scene: SceneState,
    trace: readonly WorkbenchTrace[],
  ): boolean;
}

export function canvasAutosaveKey(documentId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(documentId)}`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validDocumentId(documentId: string): boolean {
  return documentId.length > 0 && documentId.length <= 512;
}

function serializeBounded(
  project: CanvasWorkbenchProject,
  scene: SceneState,
  trace: readonly WorkbenchTrace[],
): string | null {
  let past = structuredClone(
    scene.past.slice(-CANVAS_AUTOSAVE_MAX_HISTORY_ENTRIES),
  );
  let future = structuredClone(
    scene.future.slice(0, CANVAS_AUTOSAVE_MAX_HISTORY_ENTRIES),
  );
  let retainedTrace = structuredClone(
    trace
      .filter((item) =>
        scene.nodes.some((node) => node.id === item.targetNodeId),
      )
      .slice(-CANVAS_AUTOSAVE_MAX_TRACE_ENTRIES),
  );

  while (true) {
    const payload = {
      schemaVersion: 1 as const,
      kind: "memi-canvas-autosave" as const,
      documentId: project.document.id,
      sourceFingerprint: canvasSourceFingerprint(project),
      scene: {
        nodes: structuredClone(scene.nodes),
        selectedNodeId: scene.selectedNodeId,
        revision: scene.revision,
        past,
        future,
        nextHistoryId: scene.nextHistoryId,
      },
      trace: retainedTrace,
    };
    const parsed = PayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return null;
    }
    const serialized = JSON.stringify(parsed.data);
    if (byteLength(serialized) <= CANVAS_AUTOSAVE_MAX_BYTES) {
      return serialized;
    }
    if (past.length > 0) {
      past = past.slice(1);
    } else if (future.length > 0) {
      future = future.slice(0, -1);
    } else if (retainedTrace.length > 0) {
      retainedTrace = retainedTrace.slice(1);
    } else {
      return null;
    }
  }
}

function componentAuthority(
  component: ComponentInstanceBinding | undefined,
  documentId: string,
): unknown {
  if (component === undefined) {
    return undefined;
  }
  const canonicalComponentId = CanvasComponentIdSchema.safeParse(
    component.componentId,
  );
  return {
    atomicLevel: component.atomicLevel,
    componentId: canonicalComponentId.success
      ? canonicalComponentId.data
      : mapLegacyCanvasIdV2(
          "component",
          `${documentId}:${component.componentId}`,
        ).canonicalId,
    componentName: component.componentName,
    classification: component.classification,
    editable: {
      label: component.editable.label,
      icon: component.editable.icon,
      selected: component.editable.selected,
      variant: component.editable.variant,
    },
    masterId: component.masterId,
    role: component.role,
    source: {
      repositoryRevision: component.source.repositoryRevision,
      sourceAnchor: component.source.sourceAnchor,
      ...(component.source.exportName === undefined
        ? {}
        : { exportName: component.source.exportName }),
      ...(component.source.repositoryDirty === undefined
        ? {}
        : { repositoryDirty: component.source.repositoryDirty }),
      ...(component.source.sourceContentHash === undefined
        ? {}
        : { sourceContentHash: component.source.sourceContentHash }),
    },
  };
}

function isAuthorityNode(node: WorkbenchNode): boolean {
  return (
    node.source !== undefined ||
    node.kind === "CodeFrame" ||
    node.kind === "RoutePlaceholder" ||
    node.kind === "ReferenceFrame" ||
    node.component?.classification === "master"
  );
}

function authoritySnapshot(
  node: WorkbenchNode,
  documentId: string,
): unknown {
  const source =
    node.source === undefined
      ? undefined
      : {
          captureState:
            node.source.captureState ??
            (node.kind === "RoutePlaceholder"
              ? "placeholder"
              : "captured"),
          coverageCellId: node.source.coverageCellId,
          dirtyFileFingerprint: node.source.dirtyFileFingerprint,
          repositoryDirty: node.source.repositoryDirty,
          repositoryRevision: node.source.repositoryRevision,
          routeId: node.source.routeId,
          sourceAnchor: node.source.sourceAnchor,
          sourceContentHash: node.source.sourceContentHash,
          sourceFingerprint: node.source.sourceFingerprint,
          stateId: node.source.stateId,
          viewport: node.source.viewport,
        };
  return {
    id: node.id,
    kind:
      node.component?.classification === "master"
        ? "Component"
        : node.source !== undefined
          ? node.source.captureState === "placeholder"
            ? "RoutePlaceholder"
            : "CodeFrame"
        : node.kind,
    source,
    reference: node.reference,
    component: componentAuthority(node.component, documentId),
  };
}

function canonicalAuthoritySnapshot(
  node: WorkbenchNode,
  documentId: string,
): string {
  const json = JSON.stringify(authoritySnapshot(node, documentId));
  if (json === undefined) {
    throw new TypeError("Canvas authority snapshot is not serializable.");
  }
  return canonicalJson(JSON.parse(json) as unknown);
}

function hasCurrentSourceAuthority(
  project: CanvasWorkbenchProject,
  recovered: SceneState,
): boolean {
  const baselineById = new Map(
    project.document.nodes
      .filter(isAuthorityNode)
      .map((node) => [node.id, node] as const),
  );
  for (const node of recovered.nodes) {
    if (!isAuthorityNode(node)) {
      continue;
    }
    const baseline = baselineById.get(node.id);
    if (
      baseline === undefined ||
      canonicalAuthoritySnapshot(node, project.document.id) !==
        canonicalAuthoritySnapshot(baseline, project.document.id)
    ) {
      return false;
    }
  }
  for (const [nodeId, baseline] of baselineById) {
    const recoveredNode = recovered.nodes.find((node) => node.id === nodeId);
    if (recoveredNode === undefined) {
      return false;
    }
    const baselineSource = baseline.source;
    const recoveredProvenance = recoveredNode.provenance;
    if (
      recoveredNode.kind === "DraftFrame" &&
      baselineSource !== undefined &&
      recoveredProvenance !== undefined &&
      JSON.stringify(recoveredProvenance) ===
        JSON.stringify(provenanceFromSource(baselineSource))
    ) {
      continue;
    }
    if (
      canonicalAuthoritySnapshot(recoveredNode, project.document.id) !==
        canonicalAuthoritySnapshot(baseline, project.document.id)
    ) {
      return false;
    }
  }
  return true;
}

export function createCanvasAutosave(
  storage: CanvasStorage,
): CanvasAutosave {
  return Object.freeze({
    load(project: CanvasWorkbenchProject): CanvasRecovery | null {
      const documentId = project.document.id;
      if (!validDocumentId(documentId)) {
        return null;
      }
      try {
        const serialized = storage.getItem(canvasAutosaveKey(documentId));
        if (
          serialized === null ||
          byteLength(serialized) > CANVAS_AUTOSAVE_MAX_BYTES
        ) {
          return null;
        }
        const parsedJson: unknown = JSON.parse(serialized);
        const parsed = PayloadSchema.safeParse(parsedJson);
        if (
          !parsed.success ||
          parsed.data.documentId !== documentId ||
          parsed.data.sourceFingerprint !== canvasSourceFingerprint(project)
        ) {
          return null;
        }
        const scene = structuredClone(parsed.data.scene) as SceneState;
        if (!hasCurrentSourceAuthority(project, scene)) {
          return null;
        }
        return {
          scene,
          trace: parsed.data.trace.map((item) => ({
            id: item.id,
            action: item.action,
            targetNodeId: item.targetNodeId,
            ...(item.harnessId === undefined
              ? {}
              : { harnessId: item.harnessId }),
          })),
        };
      } catch {
        return null;
      }
    },
    save(
      project: CanvasWorkbenchProject,
      scene: SceneState,
      trace: readonly WorkbenchTrace[],
    ): boolean {
      const documentId = project.document.id;
      if (!validDocumentId(documentId)) {
        return false;
      }
      const serialized = serializeBounded(project, scene, trace);
      if (serialized === null) {
        return false;
      }
      try {
        storage.setItem(canvasAutosaveKey(documentId), serialized);
        return true;
      } catch {
        return false;
      }
    },
  });
}
