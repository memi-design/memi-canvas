import { z } from "zod";
import type { CanvasDocumentV2 } from "@memi/protocol";

import type {
  ComponentInstanceBinding,
  DesignDocument,
  DocumentNode,
  SelectionState,
  ViewportState,
} from "./model.js";

export const MAX_SELECTION_CONTEXT_BYTES = 65_536;

const HashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "Expected a canonical SHA-256 hash.");
const BoundedIdSchema = z.string().trim().min(1).max(512);
const BoundedLabelSchema = z.string().trim().min(1).max(1_024);
const BoundedLocatorSchema = z.string().trim().min(1).max(4_096);
const FiniteNumberSchema = z.number().finite();

type JsonScalar = boolean | number | string | null;
export type SelectionContextJson =
  | JsonScalar
  | readonly SelectionContextJson[]
  | { readonly [key: string]: SelectionContextJson };

const JsonValueSchema: z.ZodType<SelectionContextJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    FiniteNumberSchema,
    z.string().max(MAX_SELECTION_CONTEXT_BYTES),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const PointSchema = z.strictObject({
  x: FiniteNumberSchema,
  y: FiniteNumberSchema,
});
const SizeSchema = z.strictObject({
  width: FiniteNumberSchema.nonnegative(),
  height: FiniteNumberSchema.nonnegative(),
});
const ViewportSchema = z.strictObject({
  translation: PointSchema,
  zoom: FiniteNumberSchema.positive(),
  viewportSize: SizeSchema,
  pointerMode: z.enum([
    "idle",
    "select",
    "marquee",
    "pan",
    "move",
    "resize",
    "rotate",
    "draw",
  ]),
});

const SemanticNodeSchema = z.strictObject({
  id: BoundedIdSchema,
  kind: z.enum([
    "Frame",
    "Group",
    "Rectangle",
    "Ellipse",
    "Line",
    "Arrow",
    "Vector",
    "Text",
    "Image",
    "Component",
    "Instance",
    "Section",
    "Sticky",
    "Connector",
    "Slice",
    "Comment",
    "ImportedSourceFrame",
  ]),
  name: BoundedLabelSchema,
  parentId: BoundedIdSchema.nullable(),
  childCount: z.number().int().nonnegative(),
  position: PointSchema,
  size: SizeSchema,
  rotation: FiniteNumberSchema,
  opacity: FiniteNumberSchema.min(0).max(1),
  locked: z.boolean(),
  hidden: z.boolean(),
  styles: z.record(z.string(), JsonValueSchema),
  constraints: z.strictObject({
    horizontal: z.enum(["left", "right", "center", "stretch", "scale"]),
    vertical: z.enum(["top", "bottom", "center", "stretch", "scale"]),
  }),
  componentId: BoundedIdSchema.optional(),
});

const SourceAnchorSchema = z.strictObject({
  nodeId: BoundedIdSchema,
  sourceAnchor: BoundedLocatorSchema,
  repositoryRevision: BoundedIdSchema,
  contentHash: HashSchema.optional(),
  routeId: BoundedIdSchema.optional(),
  stateId: BoundedIdSchema.optional(),
  coverageCellId: BoundedIdSchema.optional(),
  exportName: BoundedLabelSchema.optional(),
  dirtyFingerprint: HashSchema.optional(),
  path: BoundedLocatorSchema.optional(),
  symbol: BoundedLabelSchema.optional(),
  astPath: z.array(BoundedLabelSchema).max(128).optional(),
  range: z
    .strictObject({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .optional(),
  componentIdentity: BoundedLabelSchema.nullable().optional(),
  runtimeEvidenceRefs: z.array(BoundedIdSchema).max(128).optional(),
});

export const SelectionContextTokenSchema = z.strictObject({
  id: BoundedIdSchema,
  name: BoundedLabelSchema,
  value: JsonValueSchema,
  collection: BoundedLabelSchema.optional(),
});

export const SelectionContextComponentSchema = z.strictObject({
  id: BoundedIdSchema,
  name: BoundedLabelSchema,
  sourceAnchor: BoundedLocatorSchema.optional(),
  sourceContentHash: HashSchema.optional(),
  atomicLevel: z
    .enum(["atom", "molecule", "organism", "template", "page"])
    .optional(),
  role: z
    .enum([
      "button",
      "tab-bar",
      "tab-item",
      "card",
      "input",
      "badge",
      "header",
      "screen-shell",
    ])
    .optional(),
  variant: BoundedLabelSchema.optional(),
  rootNodeId: BoundedIdSchema.optional(),
  propertyKeys: z.array(BoundedIdSchema).max(256).optional(),
});

export const SelectionArtifactReferenceSchema = z.strictObject({
  id: BoundedIdSchema,
  kind: z.enum([
    "screenshot",
    "preview",
    "trace",
    "source-diff",
    "other",
  ]),
  contentHash: HashSchema,
  mimeType: z.string().trim().min(1).max(256).optional(),
  locator: BoundedLocatorSchema.optional(),
  label: BoundedLabelSchema.optional(),
});

export const SelectionContextCapsuleV1Schema = z.strictObject({
  version: z.literal(1),
  document: z.strictObject({
    id: BoundedIdSchema,
    revision: z.number().int().nonnegative(),
    sourceRevision: BoundedIdSchema,
  }),
  selectedIds: z.array(BoundedIdSchema).max(1_000),
  selectedNodes: z.array(SemanticNodeSchema).max(1_000),
  sourceAnchors: z.array(SourceAnchorSchema).max(2_000),
  relevantTokens: z.array(SelectionContextTokenSchema).max(2_000),
  relevantComponents: z.array(SelectionContextComponentSchema).max(1_000),
  viewport: ViewportSchema,
  artifactReferences: z.array(SelectionArtifactReferenceSchema).max(1_000),
  selectionSemanticHash: HashSchema,
  contentHash: HashSchema,
});

export type SelectionContextToken = z.infer<
  typeof SelectionContextTokenSchema
>;
export type SelectionContextComponent = z.infer<
  typeof SelectionContextComponentSchema
>;
export type SelectionArtifactReference = z.infer<
  typeof SelectionArtifactReferenceSchema
>;
export type SelectionContextCapsuleV1 = z.infer<
  typeof SelectionContextCapsuleV1Schema
>;

export interface CreateSelectionContextCapsuleInput {
  readonly document: CanvasDocumentV2;
  readonly selectedIds: readonly string[];
  readonly sourceRevision: string;
  readonly viewport: ViewportState;
  readonly relevantTokenIds?: readonly string[];
  readonly artifactReferences?: readonly SelectionArtifactReference[];
}

export interface CreateLegacySelectionContextCapsuleInput {
  readonly document: DesignDocument;
  readonly selection: SelectionState;
  readonly sourceRevision: string;
  readonly viewport: ViewportState;
  readonly tokenCandidates?: readonly SelectionContextToken[];
  readonly componentCandidates?: readonly SelectionContextComponent[];
  readonly artifactReferences?: readonly SelectionArtifactReference[];
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, nested]) => [key, stableJsonValue(nested)]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  throw new TypeError("Canonical context accepts only finite JSON values.");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

export async function hashSelectionContextValue(
  value: unknown,
): Promise<`sha256:${string}`> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("Secure SHA-256 support is unavailable.");
  }
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function selectionContextBytes(value: unknown): number {
  return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function semanticNode(node: DocumentNode): z.infer<typeof SemanticNodeSchema> {
  return SemanticNodeSchema.parse({
    id: node.id,
    kind: node.kind,
    name: node.name,
    parentId: node.parentId,
    childCount: node.childIds.length,
    position: node.position,
    size: node.size,
    rotation: node.rotation,
    opacity: node.opacity,
    locked: node.locked,
    hidden: node.hidden,
    styles: node.styles,
    constraints: node.constraints,
    ...(node.componentBinding === undefined
      ? {}
      : { componentId: node.componentBinding.componentId }),
  });
}

function referencedTokenIds(value: unknown): ReadonlySet<string> {
  const found = new Set<string>();
  const visited = new WeakSet<object>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      if (candidate.startsWith("token:") && candidate.length > 6) {
        found.add(candidate.slice(6));
      }
      return;
    }
    if (candidate === null || typeof candidate !== "object") {
      return;
    }
    if (visited.has(candidate)) {
      throw new TypeError("Selection styles must not contain cycles.");
    }
    visited.add(candidate);
    if (!Array.isArray(candidate)) {
      const tokenId = Object.getOwnPropertyDescriptor(
        candidate,
        "tokenId",
      )?.value;
      if (typeof tokenId === "string" && tokenId.length > 0) {
        found.add(tokenId);
      }
    }
    for (const nested of Object.values(candidate)) {
      visit(nested);
    }
  };
  visit(value);
  return found;
}

type SourceAnchor = z.infer<typeof SourceAnchorSchema>;

function mergeSourceAnchor(
  anchors: Map<string, SourceAnchor>,
  anchor: SourceAnchor,
): void {
  const key = `${anchor.nodeId}\u0000${anchor.sourceAnchor}`;
  const current = anchors.get(key);
  if (
    current !== undefined &&
    current.repositoryRevision !== anchor.repositoryRevision
  ) {
    throw new Error(
      `Source anchor "${anchor.sourceAnchor}" has conflicting repository revision evidence.`,
    );
  }
  if (
    current?.contentHash !== undefined &&
    anchor.contentHash !== undefined &&
    current.contentHash !== anchor.contentHash
  ) {
    throw new Error(
      `Source anchor "${anchor.sourceAnchor}" has conflicting content hash evidence.`,
    );
  }
  anchors.set(
    key,
    SourceAnchorSchema.parse(
      current === undefined
        ? anchor
        : {
            ...current,
            ...anchor,
            ...(anchor.contentHash === undefined &&
            current.contentHash !== undefined
              ? { contentHash: current.contentHash }
              : {}),
          },
    ),
  );
}

function collectSourceAnchors(
  nodes: readonly DocumentNode[],
): readonly SourceAnchor[] {
  const anchors = new Map<string, SourceAnchor>();
  for (const node of nodes) {
    const source = node.sourceBinding;
    if (source !== undefined) {
      mergeSourceAnchor(anchors, {
        nodeId: node.id,
        sourceAnchor: source.sourceAnchor,
        repositoryRevision: source.repositoryRevision,
        ...(source.sourceContentHash === undefined
          ? {}
          : { contentHash: source.sourceContentHash }),
        routeId: source.routeId,
        stateId: source.stateId,
        coverageCellId: source.coverageCellId,
      });
    }
    const provenance = node.provenance;
    if (provenance !== undefined) {
      mergeSourceAnchor(anchors, {
        nodeId: node.id,
        sourceAnchor: provenance.sourceAnchor,
        repositoryRevision: provenance.repositoryRevision,
        ...(provenance.sourceContentHash === undefined
          ? {}
          : { contentHash: provenance.sourceContentHash }),
        ...(provenance.routeId === null
          ? {}
          : { routeId: provenance.routeId }),
        ...(provenance.stateId === null
          ? {}
          : { stateId: provenance.stateId }),
        ...(provenance.coverageCellId === null
          ? {}
          : { coverageCellId: provenance.coverageCellId }),
      });
    }
    const componentSource = node.componentBinding?.source;
    if (componentSource !== undefined) {
      mergeSourceAnchor(anchors, {
        nodeId: node.id,
        sourceAnchor: componentSource.sourceAnchor,
        repositoryRevision: componentSource.repositoryRevision,
        ...(componentSource.sourceContentHash === undefined
          ? {}
          : { contentHash: componentSource.sourceContentHash }),
        ...(componentSource.exportName === undefined
          ? {}
          : { exportName: componentSource.exportName }),
      });
    }
  }
  return [...anchors.values()].sort(
    (left, right) =>
      compareCodeUnits(left.nodeId, right.nodeId) ||
      compareCodeUnits(left.sourceAnchor, right.sourceAnchor),
  );
}

function componentFromBinding(
  binding: ComponentInstanceBinding,
): SelectionContextComponent {
  return SelectionContextComponentSchema.parse({
    id: binding.componentId,
    name: binding.componentName,
    sourceAnchor: binding.source.sourceAnchor,
    ...(binding.source.sourceContentHash === undefined
      ? {}
      : { sourceContentHash: binding.source.sourceContentHash }),
    atomicLevel: binding.atomicLevel,
    role: binding.role,
    ...(binding.variant === undefined ? {} : { variant: binding.variant }),
  });
}

function relevantComponents(
  nodes: readonly DocumentNode[],
  candidates: readonly SelectionContextComponent[],
): readonly SelectionContextComponent[] {
  const components = new Map<string, SelectionContextComponent>();
  for (const node of nodes) {
    const binding = node.componentBinding;
    if (binding !== undefined) {
      components.set(binding.componentId, componentFromBinding(binding));
    }
  }
  const relevantIds = new Set(components.keys());
  for (const candidate of candidates) {
    const parsed = SelectionContextComponentSchema.parse(candidate);
    if (relevantIds.has(parsed.id)) {
      components.set(parsed.id, {
        ...parsed,
        ...components.get(parsed.id),
      });
    }
  }
  return [...components.values()].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  );
}

function relevantTokens(
  nodes: readonly DocumentNode[],
  candidates: readonly SelectionContextToken[],
): readonly SelectionContextToken[] {
  const referenced = new Set<string>();
  for (const node of nodes) {
    for (const id of referencedTokenIds(node.styles)) {
      referenced.add(id);
    }
  }
  const tokens = new Map<string, SelectionContextToken>();
  for (const candidate of candidates) {
    const parsed = SelectionContextTokenSchema.parse(candidate);
    if (referenced.has(parsed.id)) {
      tokens.set(parsed.id, parsed);
    }
  }
  return [...tokens.values()].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  );
}

function semanticMaterial(capsule: {
  readonly document: SelectionContextCapsuleV1["document"];
  readonly selectedIds: SelectionContextCapsuleV1["selectedIds"];
  readonly selectedNodes: SelectionContextCapsuleV1["selectedNodes"];
  readonly sourceAnchors: SelectionContextCapsuleV1["sourceAnchors"];
  readonly relevantTokens: SelectionContextCapsuleV1["relevantTokens"];
  readonly relevantComponents: SelectionContextCapsuleV1["relevantComponents"];
}): unknown {
  return {
    document: capsule.document,
    selectedIds: capsule.selectedIds,
    selectedNodes: capsule.selectedNodes,
    sourceAnchors: capsule.sourceAnchors,
    relevantTokens: capsule.relevantTokens,
    relevantComponents: capsule.relevantComponents,
  };
}

function contentMaterial(capsule: {
  readonly version: 1;
  readonly document: SelectionContextCapsuleV1["document"];
  readonly selectedIds: SelectionContextCapsuleV1["selectedIds"];
  readonly selectedNodes: SelectionContextCapsuleV1["selectedNodes"];
  readonly sourceAnchors: SelectionContextCapsuleV1["sourceAnchors"];
  readonly relevantTokens: SelectionContextCapsuleV1["relevantTokens"];
  readonly relevantComponents: SelectionContextCapsuleV1["relevantComponents"];
  readonly viewport: SelectionContextCapsuleV1["viewport"];
  readonly artifactReferences: SelectionContextCapsuleV1["artifactReferences"];
  readonly selectionSemanticHash: SelectionContextCapsuleV1["selectionSemanticHash"];
}): unknown {
  return {
    version: capsule.version,
    document: capsule.document,
    selectedIds: capsule.selectedIds,
    selectedNodes: capsule.selectedNodes,
    sourceAnchors: capsule.sourceAnchors,
    relevantTokens: capsule.relevantTokens,
    relevantComponents: capsule.relevantComponents,
    viewport: capsule.viewport,
    artifactReferences: capsule.artifactReferences,
    selectionSemanticHash: capsule.selectionSemanticHash,
  };
}

interface FinalizeSelectionContextInput {
  readonly document: SelectionContextCapsuleV1["document"];
  readonly selectedIds: readonly string[];
  readonly selectedNodes: readonly SelectionContextCapsuleV1["selectedNodes"][number][];
  readonly sourceAnchors: readonly SelectionContextCapsuleV1["sourceAnchors"][number][];
  readonly relevantTokens: readonly SelectionContextCapsuleV1["relevantTokens"][number][];
  readonly relevantComponents: readonly SelectionContextCapsuleV1["relevantComponents"][number][];
  readonly viewport: ViewportState;
  readonly artifactReferences: readonly SelectionArtifactReference[];
}

async function finalizeSelectionContextCapsule(
  input: FinalizeSelectionContextInput,
): Promise<SelectionContextCapsuleV1> {
  const artifacts = input.artifactReferences
    .map((reference) => SelectionArtifactReferenceSchema.parse(reference))
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  const base = {
    version: 1 as const,
    document: {
      id: BoundedIdSchema.parse(input.document.id),
      revision: z.number().int().nonnegative().parse(input.document.revision),
      sourceRevision: BoundedIdSchema.parse(input.document.sourceRevision),
    },
    selectedIds: [...input.selectedIds],
    selectedNodes: [...input.selectedNodes],
    sourceAnchors: [...input.sourceAnchors],
    relevantTokens: [...input.relevantTokens],
    relevantComponents: [...input.relevantComponents],
    viewport: ViewportSchema.parse(input.viewport),
    artifactReferences: artifacts,
  };
  const selectionSemanticHash = await hashSelectionContextValue(
    semanticMaterial(base),
  );
  const withSemanticHash = { ...base, selectionSemanticHash };
  const contentHash = await hashSelectionContextValue(
    contentMaterial(withSemanticHash),
  );
  const parsed = SelectionContextCapsuleV1Schema.parse({
    ...withSemanticHash,
    contentHash,
  });
  const bytes = selectionContextBytes(parsed);
  if (bytes > MAX_SELECTION_CONTEXT_BYTES) {
    throw new RangeError(
      `Selection context exceeds the ${MAX_SELECTION_CONTEXT_BYTES.toLocaleString(
        "en-US",
      )}-byte limit (${bytes.toLocaleString("en-US")} bytes).`,
    );
  }
  return deepFreeze(parsed);
}

export async function createSelectionContextCapsuleFromLegacyDocument(
  input: CreateLegacySelectionContextCapsuleInput,
): Promise<SelectionContextCapsuleV1> {
  const sourceRevision = BoundedIdSchema.parse(input.sourceRevision);
  if (
    new Set(input.selection.selectedIds).size !==
    input.selection.selectedIds.length
  ) {
    throw new Error("Selection context contains duplicate selected node IDs.");
  }
  const nodesById = new Map(input.document.nodes.map((node) => [node.id, node]));
  const selectedNodes = input.selection.selectedIds.map((id) => {
    const selected = nodesById.get(id);
    if (selected === undefined) {
      throw new Error(`Selected node "${id}" does not exist in the document.`);
    }
    return selected;
  });
  return finalizeSelectionContextCapsule({
    document: {
      id: input.document.id,
      revision: input.document.revision,
      sourceRevision,
    },
    selectedIds: input.selection.selectedIds,
    selectedNodes: selectedNodes.map(semanticNode),
    sourceAnchors: collectSourceAnchors(selectedNodes),
    relevantTokens: relevantTokens(
      selectedNodes,
      input.tokenCandidates ?? [],
    ),
    relevantComponents: relevantComponents(
      selectedNodes,
      input.componentCandidates ?? [],
    ),
    viewport: input.viewport,
    artifactReferences: input.artifactReferences ?? [],
  });
}

const V2_KIND_TO_CAPSULE_KIND = {
  frame: "Frame",
  group: "Group",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  vector: "Vector",
  text: "Text",
  image: "Image",
  component: "Component",
  instance: "Instance",
  section: "Section",
  sticky: "Sticky",
  connector: "Connector",
  "imported-source-frame": "ImportedSourceFrame",
} as const;

export async function createSelectionContextCapsule(
  input: CreateSelectionContextCapsuleInput,
): Promise<SelectionContextCapsuleV1> {
  if (new Set(input.selectedIds).size !== input.selectedIds.length) {
    throw new Error("Selection context contains duplicate selected node IDs.");
  }
  const selectedNodes = input.selectedIds.map((id) => {
    const node = input.document.nodesById[id];
    if (node === undefined) {
      throw new Error(`Selected node "${id}" does not exist in the document.`);
    }
    return node;
  });
  const sourceAnchors = selectedNodes
    .flatMap((node): SourceAnchor[] => {
      const anchor = node.sourceAnchor;
      if (anchor === null) {
        return [];
      }
      return [
        SourceAnchorSchema.parse({
          nodeId: node.id,
          sourceAnchor: `${anchor.path}#${anchor.symbol}`,
          repositoryRevision: anchor.sourceRevision,
          contentHash: anchor.contentHash,
          dirtyFingerprint: anchor.dirtyFingerprint,
          path: anchor.path,
          symbol: anchor.symbol,
          astPath: anchor.astPath,
          range: anchor.range,
          componentIdentity: anchor.componentIdentity,
          runtimeEvidenceRefs: anchor.runtimeEvidenceRefs,
        }),
      ];
    })
    .sort(
      (left, right) =>
        compareCodeUnits(left.nodeId, right.nodeId) ||
        compareCodeUnits(left.sourceAnchor, right.sourceAnchor),
    );
  const referencedTokenIdsFromSelection = new Set<string>();
  for (const node of selectedNodes) {
    for (const tokenId of referencedTokenIds({
      style: node.style,
      layout: node.layout,
      text: node.text,
      instanceOverrides: node.instanceOverrides,
    })) {
      referencedTokenIdsFromSelection.add(tokenId);
    }
  }
  const relevantTokenIds = new Set(
    input.relevantTokenIds ?? referencedTokenIdsFromSelection,
  );
  for (const tokenId of relevantTokenIds) {
    if (!referencedTokenIdsFromSelection.has(tokenId)) {
      throw new Error(
        `Token "${tokenId}" is not referenced by the selected node semantics.`,
      );
    }
    if (input.document.tokensById[tokenId] === undefined) {
      throw new Error(
        `Token "${tokenId}" is referenced by the selection but missing from the document.`,
      );
    }
  }
  const tokens = Object.values(input.document.tokensById)
    .filter(({ id }) => relevantTokenIds.has(id))
    .map(({ id, name, value }) =>
      SelectionContextTokenSchema.parse({ id, name, value }),
    )
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  const selectedComponentIds = new Set(
    selectedNodes.flatMap(({ componentId }) =>
      componentId === null ? [] : [componentId],
    ),
  );
  const components = Object.values(input.document.componentsById)
    .filter(({ id }) => selectedComponentIds.has(id))
    .map((component) =>
      SelectionContextComponentSchema.parse({
        id: component.id,
        name: component.name,
        rootNodeId: component.rootNodeId,
        propertyKeys: component.propertyKeys,
      }),
    )
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  return finalizeSelectionContextCapsule({
    document: {
      id: input.document.id,
      revision: input.document.revision,
      sourceRevision: input.sourceRevision,
    },
    selectedIds: input.selectedIds,
    selectedNodes: selectedNodes.map((node) =>
      SemanticNodeSchema.parse({
        id: node.id,
        kind: V2_KIND_TO_CAPSULE_KIND[node.kind],
        name: node.name,
        parentId: node.parentId,
        childCount: node.childIds.length,
        position: { x: node.transform.x, y: node.transform.y },
        size: node.geometry,
        rotation: node.transform.rotation,
        opacity: node.style.opacity,
        locked: node.style.locked,
        hidden: !node.style.visible,
        styles: {
          style: node.style,
          layout: node.layout,
          scale: { x: node.transform.scaleX, y: node.transform.scaleY },
          ...(node.text === null ? {} : { text: node.text }),
          ...(Object.keys(node.instanceOverrides).length === 0
            ? {}
            : { instanceOverrides: node.instanceOverrides }),
        },
        constraints: {
          horizontal:
            node.layout.sizingHorizontal === "fill" ? "stretch" : "left",
          vertical:
            node.layout.sizingVertical === "fill" ? "stretch" : "top",
        },
        ...(node.componentId === null ? {} : { componentId: node.componentId }),
      }),
    ),
    sourceAnchors,
    relevantTokens: tokens,
    relevantComponents: components,
    viewport: input.viewport,
    artifactReferences: input.artifactReferences ?? [],
  });
}

export async function verifySelectionContextCapsule(
  value: unknown,
): Promise<boolean> {
  const parsed = SelectionContextCapsuleV1Schema.safeParse(value);
  if (!parsed.success || selectionContextBytes(parsed.data) > MAX_SELECTION_CONTEXT_BYTES) {
    return false;
  }
  const expectedSemanticHash = await hashSelectionContextValue(
    semanticMaterial(parsed.data),
  );
  if (expectedSemanticHash !== parsed.data.selectionSemanticHash) {
    return false;
  }
  const expectedContentHash = await hashSelectionContextValue(
    contentMaterial(parsed.data),
  );
  return expectedContentHash === parsed.data.contentHash;
}
