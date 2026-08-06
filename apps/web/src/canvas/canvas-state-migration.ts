import {
  CanvasComponentDefinitionV2Schema,
  CanvasComponentIdSchema,
  CanvasDocumentV2Schema,
  CanvasLayoutV2Schema,
  type CanvasActionIntentV2,
  type CanvasDocumentV2,
  type CanvasNodeV2,
  type LegacyCanvasIdMappingReceiptV2,
} from "@memi/protocol";
import {
  applyCanvasOperationV2,
  createCanvasDocumentV2,
  mapLegacyCanvasIdV2,
  prepareCanvasOperationV2,
} from "@memi/canvas-document";
import { z } from "zod";

import type { SelectionState } from "./model.js";
import {
  canonicalNodeFromLegacy,
  legacyComponentKey,
  legacyNodeKind,
  projectCanonicalDocumentFromLegacy,
} from "./canvas-state-migration-node.js";

export const LEGACY_CANVAS_MAX_BYTES = 3_145_728;
const LEGACY_CANVAS_MAX_NODES = 1_000;
const LEGACY_CANVAS_MAX_HISTORY = 100;
const MIGRATION_TIME = "1970-01-01T00:00:00.000Z";
const MIGRATION_ACTOR = "canvas-state-migration";

const finiteNumber = z
  .number()
  .finite()
  .min(-1_000_000_000)
  .max(1_000_000_000);
const safeText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);
const PointSchema = z.strictObject({ x: finiteNumber, y: finiteNumber });
const SizeSchema = z.strictObject({
  height: finiteNumber.nonnegative(),
  width: finiteNumber.nonnegative(),
});
const JsonRecordSchema = z.record(z.string(), z.json());
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
const LegacyComponentPreviewItemSchema = z.strictObject({
  icon: z.string().max(512).optional(),
  label: z.string().max(2_048),
  status: z.string().max(512).optional(),
  supportingText: z.string().max(4_096).optional(),
  value: z.string().max(2_048).optional(),
});

const LegacyComponentSchema = z
  .strictObject({
    atomicLevel: z.enum([
      "atom",
      "molecule",
      "organism",
      "template",
      "page",
    ]),
    classification: z.enum(["master", "instance"]),
    componentId: safeText(512),
    componentName: safeText(512),
    editable: z.strictObject({
      icon: z.boolean(),
      label: z.boolean(),
      selected: z.boolean(),
      variant: z.boolean(),
    }),
    masterId: safeText(512).optional(),
    props: z.strictObject({
      icon: z.string().max(512).optional(),
      label: z.string().max(2_048).optional(),
      placeholder: z.string().max(2_048).optional(),
      selected: z.boolean().optional(),
      status: z.string().max(512).optional(),
      supportingText: z.string().max(4_096).optional(),
      value: z.string().max(2_048).optional(),
      items: z.array(LegacyComponentPreviewItemSchema).max(100).optional(),
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
    source: JsonRecordSchema,
    variant: z.string().max(512).optional(),
  })
  .superRefine((component, context) => {
    if (
      component.classification === "master" &&
      component.masterId !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Legacy component masters cannot reference a master.",
        path: ["masterId"],
      });
    }
    if (
      component.classification === "instance" &&
      component.masterId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Legacy component instances require a master.",
        path: ["masterId"],
      });
    }
  });

const LegacyNodeSchema = z.strictObject({
  cornerRadii: z
    .tuple([
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
    ])
    .optional(),
  component: LegacyComponentSchema.optional(),
  fill: z.string().max(160).optional(),
  frameContent: z.string().max(1_000_000).optional(),
  hidden: z.boolean(),
  id: safeText(512),
  image: EmbeddedPngImageSchema.optional(),
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
  locked: z.boolean(),
  layout: CanvasLayoutV2Schema.optional(),
  name: safeText(512),
  opacity: z.number().finite().min(0).max(1).optional(),
  parentId: safeText(512).nullable(),
  path: z.array(PointSchema).max(100_000).optional(),
  position: PointSchema,
  provenance: JsonRecordSchema.optional(),
  reference: JsonRecordSchema.optional(),
  rotation: z.number().finite().optional(),
  semanticBaseline: z.string().max(65_536).optional(),
  size: SizeSchema,
  source: JsonRecordSchema.optional(),
  stroke: z.string().max(160).optional(),
  strokeAlign: z.enum(["inside", "center", "outside"]).optional(),
  strokeWeight: z.number().finite().nonnegative().optional(),
  text: z.string().max(1_000_000).optional(),
  fontFamily: safeText(512).optional(),
  fontSize: z.number().finite().positive().max(10_000).optional(),
  fontWeight: z.number().int().min(1).max(900).optional(),
  letterSpacing: z.number().finite().min(-1_000).max(1_000).optional(),
  lineHeight: z.number().finite().positive().max(10_000).optional(),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
}).superRefine((node, context) => {
  if (node.kind === "Image" && node.image === undefined) {
    context.addIssue({
      code: "custom",
      message: "Legacy Image nodes require embedded PNG content.",
      path: ["image"],
    });
  }
  if (node.kind !== "Image" && node.image !== undefined) {
    context.addIssue({
      code: "custom",
      message: "Only legacy Image nodes may carry embedded PNG content.",
      path: ["image"],
    });
  }
  if (
    node.kind === "Image" &&
    node.image !== undefined &&
    (node.size.width !== node.image.width || node.size.height !== node.image.height)
  ) {
    context.addIssue({
      code: "custom",
      message: "Legacy Image geometry must match embedded PNG dimensions.",
      path: ["size"],
    });
  }
});
export type LegacyNode = z.infer<typeof LegacyNodeSchema>;

const LegacySelectionSchema = safeText(512).nullable();
const LegacyHistoryEntrySchema = z.strictObject({
  after: z.array(LegacyNodeSchema).max(LEGACY_CANVAS_MAX_NODES),
  afterRevision: z.number().int().nonnegative(),
  afterSelectedNodeId: LegacySelectionSchema,
  before: z.array(LegacyNodeSchema).max(LEGACY_CANVAS_MAX_NODES),
  beforeRevision: z.number().int().nonnegative(),
  beforeSelectedNodeId: LegacySelectionSchema,
  id: z.number().int().positive(),
  label: safeText(2_048),
});
const LegacySceneSchema = z.strictObject({
  future: z
    .array(LegacyHistoryEntrySchema)
    .max(LEGACY_CANVAS_MAX_HISTORY),
  nextHistoryId: z.number().int().positive(),
  nodes: z.array(LegacyNodeSchema).max(LEGACY_CANVAS_MAX_NODES),
  past: z
    .array(LegacyHistoryEntrySchema)
    .max(LEGACY_CANVAS_MAX_HISTORY),
  revision: z.number().int().nonnegative(),
  selectedNodeId: LegacySelectionSchema,
});
type LegacyScene = z.infer<typeof LegacySceneSchema>;

const LegacyAutosaveSchema = z.strictObject({
  documentId: safeText(512),
  kind: z.literal("memi-canvas-autosave"),
  schemaVersion: z.literal(1),
  scene: LegacySceneSchema,
  sourceFingerprint: z.string().regex(/^fnv1a64:[a-f0-9]{16}$/u),
  trace: z.array(z.json()).max(100),
});

export interface LegacyCanvasMigrationOptions {
  readonly legacyDocumentId: string;
  readonly legacyProjectId: string;
  readonly actorId?: string;
  readonly occurredAt?: string;
  readonly projectionOnly?: boolean;
}

export interface LegacyNodeMetadata {
  readonly legacyKind?: "Slice";
  readonly source?: Readonly<Record<string, unknown>>;
  readonly provenance?: Readonly<Record<string, unknown>>;
  readonly reference?: Readonly<Record<string, unknown>>;
  readonly component?: Readonly<Record<string, unknown>>;
  readonly frameContent?: string;
  readonly nonTextNodeCharacters?: string;
  readonly semanticBaseline?: string;
}

export interface LegacyCanvasMigrationReceipt {
  readonly sourceKind: "scene-state" | "autosave-v1";
  readonly legacyDocumentId: string;
  readonly legacyProjectId: string;
  readonly legacyRevision: number;
  readonly migratedNodeCount: number;
  readonly preservedPastEntries: number;
  readonly preservedFutureEntries: number;
  readonly historyArchive: {
    readonly status: "preserved-unreplayed";
    readonly nextHistoryId: number;
    readonly past: readonly z.infer<typeof LegacyHistoryEntrySchema>[];
    readonly future: readonly z.infer<typeof LegacyHistoryEntrySchema>[];
  };
  readonly nodeIds: Readonly<Record<string, string>>;
  readonly idMappings: readonly LegacyCanvasIdMappingReceiptV2[];
  readonly legacyMetadataByNodeId: Readonly<
    Record<string, LegacyNodeMetadata>
  >;
}

export type LegacyCanvasMigrationResult =
  | {
      readonly ok: true;
      readonly document: CanvasDocumentV2;
      readonly selection: SelectionState;
      readonly receipt: LegacyCanvasMigrationReceipt;
      readonly rawSource?: string;
    }
  | {
      readonly ok: false;
      readonly issues: readonly string[];
    };

export interface LegacyCanvasStorage {
  getItem(key: string): string | null;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const object = value as object;
  if (seen.has(object)) {
    return value;
  }
  seen.add(object);
  Object.values(object).forEach((nested) => deepFreeze(nested, seen));
  return Object.freeze(value);
}

function failure(...issues: string[]): LegacyCanvasMigrationResult {
  return deepFreeze({ issues, ok: false });
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function parseInput(
  input: unknown,
  options: LegacyCanvasMigrationOptions,
):
  | {
      readonly scene: LegacyScene;
      readonly sourceKind: "scene-state" | "autosave-v1";
      readonly rawSource?: string;
    }
  | LegacyCanvasMigrationResult {
  let parsedInput = input;
  let rawSource: string | undefined;
  if (typeof input === "string") {
    if (byteLength(input) > LEGACY_CANVAS_MAX_BYTES) {
      return failure(
        `Legacy canvas payload exceeds ${LEGACY_CANVAS_MAX_BYTES} bytes.`,
      );
    }
    rawSource = input;
    try {
      parsedInput = JSON.parse(input) as unknown;
    } catch {
      return failure("Legacy canvas payload is not valid JSON.");
    }
  } else {
    try {
      const serialized = JSON.stringify(input);
      if (byteLength(serialized) > LEGACY_CANVAS_MAX_BYTES) {
        return failure(
          `Legacy canvas payload exceeds ${LEGACY_CANVAS_MAX_BYTES} bytes.`,
        );
      }
    } catch {
      return failure("Legacy canvas state is not serializable JSON.");
    }
  }

  const autosave = LegacyAutosaveSchema.safeParse(parsedInput);
  if (autosave.success) {
    if (autosave.data.documentId !== options.legacyDocumentId) {
      return failure("Legacy autosave targets a different document.");
    }
    return {
      ...(rawSource === undefined ? {} : { rawSource }),
      scene: autosave.data.scene,
      sourceKind: "autosave-v1",
    };
  }
  const scene = LegacySceneSchema.safeParse(parsedInput);
  if (scene.success) {
    return {
      ...(rawSource === undefined ? {} : { rawSource }),
      scene: scene.data,
      sourceKind: "scene-state",
    };
  }
  const issues = [
    ...autosave.error.issues,
    ...scene.error.issues,
  ].map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`);
  return failure(...new Set(issues));
}

function validateScene(scene: LegacyScene): readonly string[] {
  const issues: string[] = [];
  const nodesById = new Map<string, LegacyNode>();
  for (const node of scene.nodes) {
    if (nodesById.has(node.id)) {
      issues.push(`Legacy canvas node identity is duplicated: ${node.id}.`);
    }
    nodesById.set(node.id, node);
  }
  if (
    scene.selectedNodeId !== null &&
    !nodesById.has(scene.selectedNodeId)
  ) {
    issues.push("Legacy canvas selection references a missing node.");
  }
  for (const node of scene.nodes) {
    if (node.parentId !== null && !nodesById.has(node.parentId)) {
      issues.push(`Legacy canvas node ${node.id} has a dangling parent.`);
    }
    const seen = new Set<string>();
    let cursor: LegacyNode | undefined = node;
    while (cursor?.parentId !== null && cursor !== undefined) {
      if (seen.has(cursor.id)) {
        issues.push(`Legacy canvas hierarchy contains a cycle at ${node.id}.`);
        break;
      }
      seen.add(cursor.id);
      cursor = nodesById.get(cursor.parentId);
    }
  }
  const componentMasters = new Map<string, LegacyNode>();
  for (const node of scene.nodes) {
    const component = node.component;
    if (
      component?.classification === "master" &&
      typeof component.componentId === "string"
    ) {
      componentMasters.set(node.id, node);
    }
  }
  for (const node of scene.nodes) {
    const component = node.component;
    if (
      node.kind === "ComponentInstance" &&
      component?.classification === "instance"
    ) {
      const componentId = component.componentId;
      const masterId = component.masterId;
      const master =
        typeof masterId === "string"
          ? componentMasters.get(masterId)
          : undefined;
      if (
        typeof componentId !== "string" ||
        typeof masterId !== "string" ||
        master?.component?.componentId !== componentId
      ) {
        issues.push(
          `Legacy component instance ${node.id} has no valid master ${String(masterId)} for ${String(componentId)}.`,
        );
      }
    }
  }
  return [...new Set(issues)];
}

function sameOrder(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function metadata(node: LegacyNode): LegacyNodeMetadata | null {
  const value = {
    ...(node.kind === "Slice" ? { legacyKind: node.kind } : {}),
    ...(node.component === undefined ? {} : { component: node.component }),
    ...(node.frameContent === undefined
      ? {}
      : { frameContent: node.frameContent }),
    ...(node.kind === "Text" || node.text === undefined
      ? {}
      : { nonTextNodeCharacters: node.text }),
    ...(node.provenance === undefined ? {} : { provenance: node.provenance }),
    ...(node.reference === undefined ? {} : { reference: node.reference }),
    ...(node.semanticBaseline === undefined
      ? {}
      : { semanticBaseline: node.semanticBaseline }),
    ...(node.source === undefined ? {} : { source: node.source }),
  };
  return Object.keys(value).length === 0 ? null : value;
}

export function migrateLegacyCanvasState(
  input: unknown,
  options: LegacyCanvasMigrationOptions,
): LegacyCanvasMigrationResult {
  if (
    options.legacyDocumentId.trim().length === 0 ||
    options.legacyProjectId.trim().length === 0
  ) {
    return failure("Legacy project and document identities are required.");
  }
  const parsed = parseInput(input, options);
  if ("ok" in parsed) {
    return parsed;
  }
  const sceneIssues = validateScene(parsed.scene);
  if (sceneIssues.length > 0) {
    return failure(...sceneIssues);
  }

  try {
    const mappings: LegacyCanvasIdMappingReceiptV2[] = [];
    const map = (
      kind: Parameters<typeof mapLegacyCanvasIdV2>[0],
      legacyId: string,
    ): string => {
      const receipt = mapLegacyCanvasIdV2(kind, legacyId);
      mappings.push(receipt);
      return receipt.canonicalId;
    };
    const projectId = map("project", options.legacyProjectId);
    const documentId = map("document", options.legacyDocumentId);
    const nodeIds = Object.fromEntries(
      parsed.scene.nodes.map((node) => [
        node.id,
        map("node", `${options.legacyDocumentId}:${node.id}`),
      ]),
    );
    const componentKeys = [
      ...new Set(
        parsed.scene.nodes
          .map(legacyComponentKey)
          .filter((value): value is string => value !== null),
      ),
    ];
    const componentIds = Object.fromEntries(
      componentKeys.map((key) => {
        const canonical = CanvasComponentIdSchema.safeParse(key);
        return [
          key,
          canonical.success
            ? canonical.data
            : map("component", `${options.legacyDocumentId}:${key}`),
        ];
      }),
    );
    const legacyById = new Map(
      parsed.scene.nodes.map((node) => [node.id, node] as const),
    );
    const canonicalByLegacyId = new Map(
      parsed.scene.nodes.map((node) => [
        node.id,
        canonicalNodeFromLegacy(node, legacyById, nodeIds, componentIds),
      ]),
    );
    let document = options.projectionOnly
      ? projectCanonicalDocumentFromLegacy(
          parsed.scene.nodes,
          canonicalByLegacyId,
          nodeIds,
          componentIds,
          documentId,
          projectId,
        )
      : createCanvasDocumentV2({ id: documentId, projectId });
    const created = new Set<string>();
    const definedComponents = new Set<string>();
    const actorId = options.actorId ?? MIGRATION_ACTOR;
    const occurredAt = options.occurredAt ?? MIGRATION_TIME;

    const apply = (
      stableKey: string,
      action: CanvasActionIntentV2,
    ): void => {
      const operationId = map(
        "operation",
        `${options.legacyDocumentId}:migration:${stableKey}`,
      );
      document = applyCanvasOperationV2(
        document,
        prepareCanvasOperationV2(document, {
          action,
          actor: "system",
          actorId,
          id: operationId,
          occurredAt,
        }),
      );
    };

    while (
      !options.projectionOnly &&
      created.size < parsed.scene.nodes.length
    ) {
      let progressed = false;
      for (const legacy of parsed.scene.nodes) {
        if (
          created.has(legacy.id) ||
          (legacy.parentId !== null && !created.has(legacy.parentId))
        ) {
          continue;
        }
        const component = legacyComponentKey(legacy);
        if (
          legacyNodeKind(legacy) === "instance" &&
          (component === null || !definedComponents.has(component))
        ) {
          continue;
        }
        const item = canonicalByLegacyId.get(legacy.id) as CanvasNodeV2;
        const parentId =
          legacy.parentId === null ? null : nodeIds[legacy.parentId] ?? null;
        const siblings =
          parentId === null
            ? document.rootIds
            : document.nodesById[parentId]?.childIds ?? [];
        apply(
          `create:${legacy.id}`,
          {
            payload: { index: siblings.length, node: item, parentId },
            type: "node.create",
          },
        );
        created.add(legacy.id);
        progressed = true;
      }

      for (const legacy of parsed.scene.nodes) {
        const component = legacyComponentKey(legacy);
        if (
          component === null ||
          definedComponents.has(component) ||
          !created.has(legacy.id) ||
          legacy.component?.classification !== "master"
        ) {
          continue;
        }
        const definition = CanvasComponentDefinitionV2Schema.parse({
          id: componentIds[component],
          name:
            typeof legacy.component.componentName === "string"
              ? legacy.component.componentName
              : legacy.name,
          propertyKeys: Object.entries(
            legacy.component.editable ?? {},
          )
            .filter(([, value]) => value === true)
            .map(([key]) => key)
            .filter((key) => key.length > 0 && key.length <= 160),
          rootNodeId: nodeIds[legacy.id],
        });
        apply(
          `component:${component}`,
          {
            payload: {
              componentId: definition.id,
              next: definition,
            },
            type: "component.define",
          },
        );
        definedComponents.add(component);
        progressed = true;
      }
      if (!progressed) {
        return failure(
          "Legacy canvas component or hierarchy dependencies cannot be ordered.",
        );
      }
    }

    const reorder = (
      parentLegacyId: string | null,
      desired: readonly string[],
    ): void => {
      const parentId =
        parentLegacyId === null ? null : nodeIds[parentLegacyId] ?? null;
      const current =
        parentId === null
          ? document.rootIds
          : document.nodesById[parentId]?.childIds ?? [];
      if (!sameOrder(current, desired)) {
        apply(
          parentLegacyId === null
            ? "reorder:root-order"
            : `reorder:children:${parentLegacyId}`,
          {
            payload: { nextOrder: desired, parentId },
            type: "node.reorder",
          },
        );
      }
    };
    if (!options.projectionOnly) {
      reorder(
        null,
        parsed.scene.nodes
          .filter((node) => node.parentId === null)
          .map((node) => nodeIds[node.id] as string),
      );
      for (const parent of parsed.scene.nodes) {
        reorder(
          parent.id,
          parsed.scene.nodes
            .filter((node) => node.parentId === parent.id)
            .map((node) => nodeIds[node.id] as string),
        );
      }
    }

    const selectedId =
      parsed.scene.selectedNodeId === null
        ? null
        : nodeIds[parsed.scene.selectedNodeId] ?? null;
    const selection: SelectionState = deepFreeze({
      anchorId: selectedId,
      editingId: null,
      focusedId: selectedId,
      selectedIds: selectedId === null ? [] : [selectedId],
    });
    const legacyMetadataByNodeId = Object.fromEntries(
      parsed.scene.nodes.flatMap((node) => {
        const value = metadata(node);
        return value === null ? [] : [[nodeIds[node.id], value]];
      }),
    );
    const receipt: LegacyCanvasMigrationReceipt = deepFreeze({
      historyArchive: {
        future: parsed.scene.future,
        nextHistoryId: parsed.scene.nextHistoryId,
        past: parsed.scene.past,
        status: "preserved-unreplayed",
      },
      idMappings: mappings,
      legacyDocumentId: options.legacyDocumentId,
      legacyMetadataByNodeId,
      legacyProjectId: options.legacyProjectId,
      legacyRevision: parsed.scene.revision,
      migratedNodeCount: parsed.scene.nodes.length,
      nodeIds,
      preservedFutureEntries: parsed.scene.future.length,
      preservedPastEntries: parsed.scene.past.length,
      sourceKind: parsed.sourceKind,
    });
    return deepFreeze({
      document: CanvasDocumentV2Schema.parse(document),
      ok: true,
      ...(parsed.rawSource === undefined
        ? {}
        : { rawSource: parsed.rawSource }),
      receipt,
      selection,
    });
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Legacy migration failed.",
    );
  }
}

export function readLegacyCanvasState(
  storage: LegacyCanvasStorage,
  key: string,
  options: LegacyCanvasMigrationOptions,
): LegacyCanvasMigrationResult | null {
  const source = storage.getItem(key);
  return source === null
    ? null
    : migrateLegacyCanvasState(source, options);
}
