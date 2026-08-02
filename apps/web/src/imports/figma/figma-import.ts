import type {
  DesignDocument,
  DocumentNode,
  DocumentNodeKind,
  Point,
} from "../../canvas/model.js";

export const FIGMA_IMPORT_MAX_BYTES = 5_242_880;
export const FIGMA_IMPORT_MAX_NODES = 5_000;
const FIGMA_IMPORT_MAX_DEPTH = 32;
const FIGMA_IMPORT_MAX_COMPONENTS = 2_000;
const FIGMA_IMPORT_MAX_STYLES = 4_000;
const FIGMA_FILE_KEY = /^[A-Za-z0-9_-]{6,128}$/u;
const FIGMA_IMPORT_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const FIGMA_NODE_ID = /^[A-Za-z0-9:_-]{1,256}$/u;

type JsonRecord = Readonly<Record<string, unknown>>;

export interface ParsedFigmaFileUrl {
  readonly fileKey: string;
  readonly fileType: "design" | "figjam";
  readonly nodeId?: string;
  readonly sourceUrl: string;
}

export interface FigmaImportedComponent {
  readonly nodeId: string;
  readonly key?: string;
  readonly name: string;
  readonly description?: string;
}

export interface FigmaImportedToken {
  readonly id: string;
  readonly key?: string;
  readonly name: string;
  readonly type: string;
  readonly description?: string;
}

export interface FigmaImportResult {
  readonly projectName: string;
  readonly document: DesignDocument;
  readonly components: readonly FigmaImportedComponent[];
  readonly tokens: readonly FigmaImportedToken[];
  readonly provenance: {
    readonly authority: "figma-json-export";
    readonly fileKey: string;
    readonly importedAt: string;
    readonly sourceUrl?: string;
  };
}

export interface FigmaImportOptions {
  readonly fileKey: string;
  readonly importedAt?: string;
  readonly sourceUrl?: string;
}

export type FigmaUrlImportPreparation =
  | {
      readonly status: "token-required";
      readonly fileKey: string;
      readonly message: string;
    };

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown, label: string): JsonRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return fail(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function optionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length > maximum) {
    return fail(`${label} must be text no longer than ${maximum} characters.`);
  }
  return value;
}

function requiredText(
  value: unknown,
  label: string,
  maximum: number,
): string {
  const parsed = optionalText(value, label, maximum);
  if (parsed === undefined || parsed.trim() === "") {
    return fail(`${label} is required.`);
  }
  return parsed;
}

function finiteNumber(
  value: unknown,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function boundedEntries(
  value: unknown,
  label: string,
  maximum: number,
): readonly (readonly [string, unknown])[] {
  if (value === undefined) {
    return [];
  }
  const entries = Object.entries(record(value, label));
  if (entries.length > maximum) {
    return fail(`${label} exceeds the ${maximum} item limit.`);
  }
  return entries;
}

function sanitizeIdentity(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/gu, "-");
  return `figma-${safe}`;
}

function boundedJsonClone(
  value: unknown,
  label: string,
  maximumBytes = 262_144,
): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return fail(`${label} is not valid JSON.`);
  }
  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    return fail(`${label} exceeds its import limit.`);
  }
  return JSON.parse(serialized) as unknown;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Readonly<Record<string, unknown>>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function parseNodeId(value: string | null): string | undefined {
  if (value === null || value === "") {
    return undefined;
  }
  const normalized = value.replaceAll("-", ":");
  return FIGMA_NODE_ID.test(normalized) ? normalized : undefined;
}

export function parseFigmaFileUrl(value: string): ParsedFigmaFileUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("Enter a valid Figma file URL.");
  }
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "figma.com" && url.hostname !== "www.figma.com") ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return fail("Only canonical HTTPS figma.com file URLs are supported.");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const route = segments[0];
  const fileKey = segments[1];
  if (
    (route !== "design" && route !== "file" && route !== "board") ||
    fileKey === undefined ||
    !FIGMA_FILE_KEY.test(fileKey)
  ) {
    return fail("The Figma URL must identify a design file or FigJam board.");
  }
  const nodeId = parseNodeId(url.searchParams.get("node-id"));
  if (url.searchParams.has("node-id") && nodeId === undefined) {
    return fail("The Figma node identifier is invalid.");
  }
  return {
    fileKey,
    fileType: route === "board" ? "figjam" : "design",
    ...(nodeId === undefined ? {} : { nodeId }),
    sourceUrl: url.href,
  };
}

export function prepareFigmaUrlImport(
  value: string,
): FigmaUrlImportPreparation {
  const parsed = parseFigmaFileUrl(value);
  return {
    status: "token-required",
    fileKey: parsed.fileKey,
    message:
      "Figma API access requires a personal access token. No token is stored or inferred by Memi.",
  };
}

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function nodeBounds(node: JsonRecord): Bounds | undefined {
  if (node.absoluteBoundingBox === undefined) {
    return undefined;
  }
  const bounds = record(node.absoluteBoundingBox, "Node bounds");
  const width = finiteNumber(bounds.width, 0);
  const height = finiteNumber(bounds.height, 0);
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return {
    x: finiteNumber(bounds.x, 0),
    y: finiteNumber(bounds.y, 0),
    width,
    height,
  };
}

function localPosition(
  bounds: Bounds | undefined,
  parentBounds: Bounds | undefined,
): Point {
  if (bounds === undefined) {
    return { x: 0, y: 0 };
  }
  return {
    x: bounds.x - (parentBounds?.x ?? 0),
    y: bounds.y - (parentBounds?.y ?? 0),
  };
}

function documentKind(type: string): DocumentNodeKind {
  const kindByFigmaType: Readonly<Record<string, DocumentNodeKind>> = {
    ARROW: "Arrow",
    CANVAS: "Section",
    COMPONENT: "Component",
    COMPONENT_SET: "Component",
    ELLIPSE: "Ellipse",
    FRAME: "Frame",
    GROUP: "Group",
    INSTANCE: "Instance",
    LINE: "Line",
    RECTANGLE: "Rectangle",
    SECTION: "Section",
    STICKY: "Sticky",
    TEXT: "Text",
    VECTOR: "Vector",
  };
  return kindByFigmaType[type] ?? "ImportedSourceFrame";
}

function nodeStyles(node: JsonRecord): Readonly<Record<string, unknown>> {
  const styles: Record<string, unknown> = {};
  for (const [sourceKey, targetKey] of [
    ["fills", "fills"],
    ["strokes", "strokes"],
    ["effects", "effects"],
    ["cornerRadius", "cornerRadius"],
    ["opacity", "sourceOpacity"],
    ["blendMode", "blendMode"],
    ["constraints", "sourceConstraints"],
    ["layoutMode", "layoutMode"],
    ["itemSpacing", "itemSpacing"],
    ["paddingLeft", "paddingLeft"],
    ["paddingRight", "paddingRight"],
    ["paddingTop", "paddingTop"],
    ["paddingBottom", "paddingBottom"],
    ["componentId", "componentId"],
  ] as const) {
    if (node[sourceKey] !== undefined) {
      styles[targetKey] = boundedJsonClone(
        node[sourceKey],
        `Figma node ${sourceKey}`,
      );
    }
  }
  const text = optionalText(node.characters, "Figma text", 65_536);
  if (text !== undefined) {
    styles.text = text;
  }
  if (node.style !== undefined) {
    styles.textStyle = boundedJsonClone(node.style, "Figma text style");
  }
  return styles;
}

interface NormalizationContext {
  readonly fileKey: string;
  readonly importedAt: string;
  readonly sourceUrl?: string;
  readonly nodes: DocumentNode[];
  readonly nodeIds: Set<string>;
  readonly originalNodeIds: Set<string>;
}

function normalizeNode(
  input: unknown,
  parentId: string | null,
  parentBounds: Bounds | undefined,
  pageId: string,
  depth: number,
  context: NormalizationContext,
): string {
  if (depth > FIGMA_IMPORT_MAX_DEPTH) {
    return fail(`Figma document depth exceeds ${FIGMA_IMPORT_MAX_DEPTH}.`);
  }
  if (context.nodes.length >= FIGMA_IMPORT_MAX_NODES) {
    return fail(`Figma document exceeds ${FIGMA_IMPORT_MAX_NODES} nodes.`);
  }
  const node = record(input, "Figma node");
  const sourceId = requiredText(node.id, "Figma node id", 256);
  if (!FIGMA_NODE_ID.test(sourceId)) {
    return fail(`Figma node id "${sourceId}" is invalid.`);
  }
  if (context.originalNodeIds.has(sourceId)) {
    return fail(`Figma export contains duplicate node id "${sourceId}".`);
  }
  context.originalNodeIds.add(sourceId);
  const id = sanitizeIdentity(sourceId);
  if (context.nodeIds.has(id)) {
    return fail(`Figma node identities collide after normalization.`);
  }
  context.nodeIds.add(id);

  const type = requiredText(node.type, "Figma node type", 128).toUpperCase();
  const name = requiredText(node.name, "Figma node name", 2_048);
  const bounds = nodeBounds(node);
  const childrenValue = node.children;
  if (childrenValue !== undefined && !Array.isArray(childrenValue)) {
    return fail(`Figma node "${name}" children must be an array.`);
  }
  const children = (childrenValue ?? []) as readonly unknown[];
  if (children.length > FIGMA_IMPORT_MAX_NODES) {
    return fail(`Figma node "${name}" has too many children.`);
  }

  const childIds = children.map((child) =>
    normalizeNode(
      child,
      id,
      bounds ?? parentBounds,
      type === "CANVAS" ? sourceId : pageId,
      depth + 1,
      context,
    ),
  );
  const styles = nodeStyles(node);
  const opacity = finiteNumber(node.opacity, 1);
  const nextNode: DocumentNode = {
    id,
    kind: documentKind(type),
    name,
    parentId,
    childIds,
    position: localPosition(bounds, parentBounds),
    size: {
      width: bounds?.width ?? 1_200,
      height: bounds?.height ?? 900,
    },
    rotation: finiteNumber(node.rotation, 0),
    opacity: Math.max(0, Math.min(1, opacity)),
    locked: node.locked === true,
    hidden: node.visible === false,
    styles: {
      ...styles,
      figma: {
        fileKey: context.fileKey,
        nodeId: sourceId,
        originalType: type,
        ...(context.sourceUrl === undefined
          ? {}
          : { sourceUrl: context.sourceUrl }),
      },
    },
    constraints: {
      horizontal: "left",
      vertical: "top",
    },
    provenance: {
      repositoryRevision: `figma:${context.fileKey}`,
      sourceAnchor: `figma://file/${context.fileKey}/node/${sourceId}`,
      routeId: `figma-page:${pageId}`,
      stateId: `imported:${context.importedAt}`,
      coverageCellId: `figma-node:${sourceId}`,
    },
  };
  context.nodes.push(nextNode);
  return id;
}

function importedComponents(value: unknown): readonly FigmaImportedComponent[] {
  return boundedEntries(
    value,
    "Figma components",
    FIGMA_IMPORT_MAX_COMPONENTS,
  ).map(([nodeId, raw]) => {
    const component = record(raw, `Figma component ${nodeId}`);
    return {
      nodeId,
      name: requiredText(component.name, "Figma component name", 2_048),
      ...(optionalText(component.key, "Figma component key", 512) === undefined
        ? {}
        : { key: component.key as string }),
      ...(optionalText(
        component.description,
        "Figma component description",
        8_192,
      ) === undefined
        ? {}
        : { description: component.description as string }),
    };
  });
}

function importedTokens(value: unknown): readonly FigmaImportedToken[] {
  return boundedEntries(value, "Figma styles", FIGMA_IMPORT_MAX_STYLES).map(
    ([id, raw]) => {
      const token = record(raw, `Figma style ${id}`);
      return {
        id,
        name: requiredText(token.name, "Figma style name", 2_048),
        type: requiredText(token.styleType, "Figma style type", 128),
        ...(optionalText(token.key, "Figma style key", 512) === undefined
          ? {}
          : { key: token.key as string }),
        ...(optionalText(
          token.description,
          "Figma style description",
          8_192,
        ) === undefined
          ? {}
          : { description: token.description as string }),
      };
    },
  );
}

function documentOrder(
  nodes: readonly DocumentNode[],
  rootIds: readonly string[],
): readonly DocumentNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const ordered: DocumentNode[] = [];
  const visited = new Set<string>();
  function visit(id: string) {
    if (visited.has(id)) {
      return;
    }
    const node = byId.get(id);
    if (node === undefined) {
      return fail(`Figma import contains a dangling node "${id}".`);
    }
    visited.add(id);
    ordered.push(node);
    node.childIds.forEach(visit);
  }
  rootIds.forEach(visit);
  if (visited.size !== nodes.length) {
    return fail("Figma import contains an unreachable node.");
  }
  return ordered;
}

export function normalizeFigmaJsonExport(
  serialized: string,
  options: FigmaImportOptions,
): FigmaImportResult {
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > FIGMA_IMPORT_MAX_BYTES) {
    return fail(
      `Figma JSON export exceeds the ${FIGMA_IMPORT_MAX_BYTES} byte size limit.`,
    );
  }
  if (!FIGMA_IMPORT_KEY.test(options.fileKey)) {
    return fail("The Figma import identity is invalid.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch {
    return fail("The Figma JSON export is malformed.");
  }
  const file = record(decoded, "Figma export");
  const projectName = requiredText(file.name, "Figma file name", 256);
  const document = record(file.document, "Figma document");
  if (
    requiredText(document.type, "Figma document type", 128).toUpperCase() !==
    "DOCUMENT"
  ) {
    return fail("Figma document root must have type DOCUMENT.");
  }
  if (!Array.isArray(document.children)) {
    return fail("Figma document pages must be an array.");
  }
  const importedAt =
    options.importedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(importedAt))) {
    return fail("The Figma import timestamp is invalid.");
  }
  const context: NormalizationContext = {
    fileKey: options.fileKey,
    importedAt,
    ...(options.sourceUrl === undefined
      ? {}
      : { sourceUrl: parseFigmaFileUrl(options.sourceUrl).sourceUrl }),
    nodes: [],
    nodeIds: new Set(),
    originalNodeIds: new Set(),
  };
  const rootIds = document.children.map((page) => {
    const candidate = record(page, "Figma page");
    const pageId = requiredText(candidate.id, "Figma page id", 256);
    return normalizeNode(page, null, undefined, pageId, 1, context);
  });
  const result: FigmaImportResult = {
    projectName,
    document: {
      id: `figma-document-${options.fileKey}`,
      revision: 1,
      nodes: documentOrder(context.nodes, rootIds),
      rootIds,
    },
    components: importedComponents(file.components),
    tokens: importedTokens(file.styles),
    provenance: {
      authority: "figma-json-export",
      fileKey: options.fileKey,
      importedAt,
      ...(options.sourceUrl === undefined
        ? {}
        : { sourceUrl: context.sourceUrl as string }),
    },
  };
  return deepFreeze(result);
}
