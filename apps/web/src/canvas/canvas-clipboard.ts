import { z } from "zod";
import { CanvasEffectV2Schema } from "@memi/protocol";

import type { Point, WorkbenchNode } from "./model.js";
import {
  browserClipboard,
  browserClipboardItem,
  CANVAS_CLIPBOARD_MAX_IMAGE_BYTES,
  CANVAS_CLIPBOARD_MAX_IMAGE_DIMENSION,
  clearCanvasSessionImage,
  isValidCanvasClipboardImage,
  type CanvasClipboardPasteData,
  type CanvasSystemClipboardDependencies,
} from "./canvas-clipboard-image.js";
import { pasteValidatedCanvasClipboard } from "./canvas-clipboard-paste.js";
import { canvasClipboardComponentBindingSchema } from "./canvas-clipboard-component-schema.js";
import { canvasReferenceBindingSchema } from "./reference-binding-schema.js";

export {
  CANVAS_CLIPBOARD_MAX_IMAGE_BYTES,
  CANVAS_CLIPBOARD_MAX_IMAGE_DIMENSION,
  createCanvasImageNodeAtPoint,
  hasCanvasImageInPasteData,
  isValidCanvasClipboardImage,
  readCanvasImageFromPasteData,
  readCanvasImageFromSystem,
  readCanvasSessionImage,
  storeCanvasSessionImage,
} from "./canvas-clipboard-image.js";
export type {
  CanvasClipboardImage,
  CanvasClipboardPasteData,
  CanvasClipboardPasteItem,
  CanvasSystemClipboard,
  CanvasSystemClipboardDependencies,
  CanvasSystemClipboardItem,
} from "./canvas-clipboard-image.js";

export const MEMI_CANVAS_CLIPBOARD_MIME =
  "application/x-memi-canvas+json" as const;
export const CANVAS_CLIPBOARD_VERSION = 1 as const;
export const CANVAS_CLIPBOARD_OFFSET = 24;
export const CANVAS_CLIPBOARD_MAX_NODES = 1_000;
export const CANVAS_CLIPBOARD_MAX_DEPTH = 32;
export const CANVAS_CLIPBOARD_MAX_BYTES = 3_145_728;

const safeText = (maximum: number) => z.string().min(1).max(maximum);
const idSchema = safeText(512);
const finiteNumberSchema = z
  .number()
  .finite()
  .min(-1_000_000_000)
  .max(1_000_000_000);
const pointSchema = z
  .object({
    x: finiteNumberSchema,
    y: finiteNumberSchema,
  })
  .strict();
const sizeSchema = z
  .object({
    width: finiteNumberSchema.positive(),
    height: finiteNumberSchema.positive(),
  })
  .strict();
const layoutSchema = z
  .object({
    alignCounter: z.enum(["start", "center", "end", "stretch"]),
    alignPrimary: z.enum(["start", "center", "end", "space-between"]),
    gap: finiteNumberSchema.nonnegative(),
    mode: z.enum(["none", "horizontal", "vertical", "grid"]),
    padding: z
      .object({
        top: finiteNumberSchema.nonnegative(),
        right: finiteNumberSchema.nonnegative(),
        bottom: finiteNumberSchema.nonnegative(),
        left: finiteNumberSchema.nonnegative(),
      })
      .strict(),
    sizingHorizontal: z.enum(["fixed", "hug", "fill"]),
    sizingVertical: z.enum(["fixed", "hug", "fill"]),
    wrap: z.boolean(),
  })
  .strict();
const sourceProvenanceSchema = z
  .object({
    captureState: z.enum(["captured", "placeholder"]).optional(),
    repositoryRevision: safeText(512),
    repositoryDirty: z.boolean().optional(),
    dirtyFileFingerprint: safeText(512).optional(),
    sourceFingerprint: safeText(512).optional(),
    sourceContentHash: safeText(512).optional(),
    sourceAnchor: safeText(4_096),
    routeId: safeText(512).nullable(),
    stateId: safeText(512).nullable(),
    coverageCellId: safeText(512).nullable(),
  })
  .strict();
const sourceBindingSchema = sourceProvenanceSchema
  .extend({
    routeId: safeText(512),
    stateId: safeText(512),
    coverageCellId: safeText(512),
    viewport: z
      .object({
        name: z.enum(["desktop", "tablet", "mobile"]),
        width: z.number().int().positive().max(32_768),
        height: z.number().int().positive().max(32_768),
      })
      .strict(),
  })
  .strict();
const embeddedImageSchema = z
  .object({
    alt: z.string().trim().min(1).max(4_096),
    byteLength: z.number().int().positive().max(CANVAS_CLIPBOARD_MAX_IMAGE_BYTES),
    height: z.number().int().positive().max(CANVAS_CLIPBOARD_MAX_IMAGE_DIMENSION),
    mimeType: z.literal("image/png"),
    src: z
      .string()
      .max(2_796_226)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u),
    width: z.number().int().positive().max(CANVAS_CLIPBOARD_MAX_IMAGE_DIMENSION),
  })
  .strict();
const workbenchNodeSchema = z
  .object({
    cornerRadii: z
      .tuple([
        z.number().finite().nonnegative(),
        z.number().finite().nonnegative(),
        z.number().finite().nonnegative(),
        z.number().finite().nonnegative(),
    ])
      .optional(),
    effects: z.array(CanvasEffectV2Schema).max(32).optional(),
    id: idSchema,
    image: embeddedImageSchema.optional(),
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
    name: safeText(2_048),
    parentId: idSchema.nullable(),
    path: z.array(pointSchema).max(100_000).optional(),
    position: pointSchema,
    size: sizeSchema,
    layout: layoutSchema.optional(),
    locked: z.boolean(),
    hidden: z.boolean(),
    opacity: z.number().finite().min(0).max(1).optional(),
    rotation: z.number().finite().optional(),
    text: z.string().max(65_536).optional(),
    fontFamily: safeText(512).optional(),
    fontSize: z.number().finite().positive().max(10_000).optional(),
    fontWeight: z.number().int().min(1).max(900).optional(),
    letterSpacing: z.number().finite().min(-1_000).max(1_000).optional(),
    lineHeight: z.number().finite().positive().max(10_000).optional(),
    textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
    textAutoResize: z.enum(["none", "width-height", "height"]).optional(),
    fill: z.string().max(512).optional(),
    stroke: z.string().max(512).optional(),
    strokeAlign: z.enum(["inside", "center", "outside"]).optional(),
    strokeWeight: z.number().finite().nonnegative().optional(),
    source: sourceBindingSchema.optional(),
    provenance: sourceProvenanceSchema.optional(),
    reference: canvasReferenceBindingSchema.optional(),
    component: canvasClipboardComponentBindingSchema.optional(),
    frameContent: z.string().max(65_536).optional(),
    semanticBaseline: z.string().max(65_536).optional(),
  })
  .strict()
  .superRefine((node, context) => {
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
    if (
      node.kind === "Image" &&
      node.image !== undefined &&
      !isValidCanvasClipboardImage(node.image)
    ) {
      context.addIssue({
        code: "custom",
        message: "Image metadata must match verified PNG content.",
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
        message: "Component instances require component metadata.",
        path: ["component"],
      });
    }
    if (node.kind === "Component" && node.component === undefined) {
      context.addIssue({
        code: "custom",
        message: "Component masters require component metadata.",
        path: ["component"],
      });
    }
    if (
      node.kind === "Component" &&
      node.component?.classification !== "master"
    ) {
      context.addIssue({
        code: "custom",
        message: "Component nodes require master metadata.",
        path: ["component", "classification"],
      });
    }
    if (
      node.kind === "ComponentInstance" &&
      node.component?.classification !== "instance"
    ) {
      context.addIssue({
        code: "custom",
        message: "Component instance nodes require instance metadata.",
        path: ["component", "classification"],
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
const canvasClipboardPayloadSchema = z
  .object({
    mime: z.literal(MEMI_CANVAS_CLIPBOARD_MIME),
    version: z.literal(CANVAS_CLIPBOARD_VERSION),
    sourceDocumentId: idSchema,
    rootIds: z.array(idSchema).min(1).max(CANVAS_CLIPBOARD_MAX_NODES),
    nodes: z
      .array(workbenchNodeSchema)
      .min(1)
      .max(CANVAS_CLIPBOARD_MAX_NODES),
  })
  .strict();

export interface CanvasClipboardPayload {
  readonly mime: typeof MEMI_CANVAS_CLIPBOARD_MIME;
  readonly version: typeof CANVAS_CLIPBOARD_VERSION;
  readonly sourceDocumentId: string;
  readonly rootIds: readonly string[];
  readonly nodes: readonly WorkbenchNode[];
}

export interface CanvasClipboardInput {
  readonly documentId: string;
  readonly nodes: readonly WorkbenchNode[];
  readonly selectedIds: readonly string[];
}

export interface CanvasClipboardPasteResult {
  readonly nodes: readonly WorkbenchNode[];
  readonly pastedNodes: readonly WorkbenchNode[];
  readonly selectedIds: readonly string[];
}

export interface CanvasClipboardCutResult {
  readonly deletedIds: readonly string[];
  readonly nodes: readonly WorkbenchNode[];
  readonly payload: CanvasClipboardPayload;
}

export type CanvasClipboardPlacement =
  | { readonly kind: "offset"; readonly offset?: number }
  | { readonly kind: "cursor"; readonly point: Point };

let sessionClipboardFallback: string | null = null;

function serializedByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function hasValidHierarchy(payload: CanvasClipboardPayload): boolean {
  const nodesById = new Map<string, WorkbenchNode>();
  for (const node of payload.nodes) {
    if (nodesById.has(node.id)) {
      return false;
    }
    nodesById.set(node.id, node);
  }

  if (new Set(payload.rootIds).size !== payload.rootIds.length) {
    return false;
  }
  const rootIds = new Set(payload.rootIds);
  if (
    payload.rootIds.some((id) => nodesById.get(id)?.parentId !== null) ||
    payload.nodes.some(
      (node) =>
        (node.parentId === null && !rootIds.has(node.id)) ||
        (node.parentId !== null && !nodesById.has(node.parentId)),
    )
  ) {
    return false;
  }

  for (const node of payload.nodes) {
    const component = node.component;
    if (
      component?.classification === "instance" &&
      component.masterId !== undefined
    ) {
      const includedMaster = nodesById.get(component.masterId);
      if (
        includedMaster !== undefined &&
        (includedMaster.kind !== "Component" ||
          includedMaster.component?.classification !== "master" ||
          includedMaster.component.componentId !== component.componentId)
      ) {
        return false;
      }
    }
  }

  for (const node of payload.nodes) {
    const visited = new Set<string>();
    let current: WorkbenchNode | undefined = node;
    let depth = 0;
    while (current !== undefined && current.parentId !== null) {
      if (
        visited.has(current.id) ||
        depth >= CANVAS_CLIPBOARD_MAX_DEPTH - 1
      ) {
        return false;
      }
      visited.add(current.id);
      current = nodesById.get(current.parentId);
      depth += 1;
    }
    if (current === undefined || !rootIds.has(current.id)) {
      return false;
    }
  }
  return true;
}

function validatedPayload(value: unknown): CanvasClipboardPayload | null {
  if (serializedByteLength(value) > CANVAS_CLIPBOARD_MAX_BYTES) {
    return null;
  }
  const result = canvasClipboardPayloadSchema.safeParse(value);
  if (!result.success) {
    return null;
  }
  const payload = result.data as CanvasClipboardPayload;
  return hasValidHierarchy(payload) ? structuredClone(payload) : null;
}

function selectedHierarchy(
  nodes: readonly WorkbenchNode[],
  selectedIds: readonly string[],
): {
  readonly nodes: readonly WorkbenchNode[];
  readonly rootIds: readonly string[];
} | null {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const selected = new Set(
    selectedIds.filter(
      (id, index) =>
        selectedIds.indexOf(id) === index && nodesById.has(id),
    ),
  );
  if (selected.size === 0) {
    return null;
  }
  const rootIds = [...selected].filter((id) => {
    const visited = new Set<string>();
    let parentId = nodesById.get(id)?.parentId ?? null;
    while (parentId !== null) {
      if (visited.has(parentId)) {
        return false;
      }
      visited.add(parentId);
      if (selected.has(parentId)) {
        return false;
      }
      parentId = nodesById.get(parentId)?.parentId ?? null;
    }
    return true;
  });

  let includedIds = new Set(rootIds);
  let changed = true;
  while (changed && includedIds.size <= CANVAS_CLIPBOARD_MAX_NODES) {
    changed = false;
    for (const node of nodes) {
      if (
        node.parentId !== null &&
        includedIds.has(node.parentId) &&
        !includedIds.has(node.id)
      ) {
        includedIds = new Set([...includedIds, node.id]);
        changed = true;
      }
    }
  }
  if (includedIds.size > CANVAS_CLIPBOARD_MAX_NODES) {
    return null;
  }

  return {
    rootIds,
    nodes: nodes
      .filter((node) => includedIds.has(node.id))
      .map((node) => ({
        ...structuredClone(node),
        parentId:
          node.parentId !== null && includedIds.has(node.parentId)
            ? node.parentId
            : null,
      })),
  };
}

export function createCanvasClipboardPayload(
  input: CanvasClipboardInput,
): CanvasClipboardPayload | null {
  const hierarchy = selectedHierarchy(input.nodes, input.selectedIds);
  if (hierarchy === null) {
    return null;
  }
  return validatedPayload({
    mime: MEMI_CANVAS_CLIPBOARD_MIME,
    version: CANVAS_CLIPBOARD_VERSION,
    sourceDocumentId: input.documentId,
    rootIds: hierarchy.rootIds,
    nodes: hierarchy.nodes,
  });
}

export function serializeCanvasClipboardFallback(
  payload: CanvasClipboardPayload,
): string {
  const validated = validatedPayload(payload);
  if (validated === null) {
    throw new TypeError("Cannot serialize an invalid Memi canvas clipboard.");
  }
  return JSON.stringify(validated);
}

export function parseCanvasClipboardFallback(
  fallback: string,
): CanvasClipboardPayload | null {
  if (
    new TextEncoder().encode(fallback).byteLength >
    CANVAS_CLIPBOARD_MAX_BYTES
  ) {
    return null;
  }
  try {
    return validatedPayload(JSON.parse(fallback) as unknown);
  } catch {
    return null;
  }
}

export function readCanvasClipboardFromPasteData(
  clipboardData: CanvasClipboardPasteData | null,
): CanvasClipboardPayload | null {
  if (
    clipboardData === null ||
    !Array.from(clipboardData.types).includes(MEMI_CANVAS_CLIPBOARD_MIME)
  ) {
    return null;
  }
  try {
    return parseCanvasClipboardFallback(
      clipboardData.getData(MEMI_CANVAS_CLIPBOARD_MIME),
    );
  } catch {
    return null;
  }
}

export function storeCanvasSessionClipboard(
  payload: CanvasClipboardPayload,
): boolean {
  const validated = validatedPayload(payload);
  if (validated === null) {
    return false;
  }
  sessionClipboardFallback = JSON.stringify(validated);
  clearCanvasSessionImage();
  return true;
}

export function copyCanvasSelection(
  input: CanvasClipboardInput,
): CanvasClipboardPayload | null {
  const payload = createCanvasClipboardPayload(input);
  if (payload === null || !storeCanvasSessionClipboard(payload)) {
    return null;
  }
  return structuredClone(payload);
}

export function canReadCanvasSystemClipboard(): boolean {
  return browserClipboard() !== null;
}

export async function writeCanvasClipboardToSystem(
  payload: CanvasClipboardPayload,
  dependencies: CanvasSystemClipboardDependencies = {},
): Promise<boolean> {
  const validated = validatedPayload(payload);
  if (validated !== null) {
    storeCanvasSessionClipboard(validated);
  }
  const clipboard = dependencies.clipboard ?? browserClipboard();
  const createItem = dependencies.createItem ?? browserClipboardItem;
  if (validated === null || clipboard === null) {
    return false;
  }
  try {
    const item = createItem({
      [MEMI_CANVAS_CLIPBOARD_MIME]: new Blob(
        [serializeCanvasClipboardFallback(validated)],
        { type: MEMI_CANVAS_CLIPBOARD_MIME },
      ),
    });
    if (item === null) {
      return false;
    }
    await clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

export async function readCanvasClipboardFromSystem(
  dependencies: CanvasSystemClipboardDependencies = {},
): Promise<CanvasClipboardPayload | null> {
  const clipboard = dependencies.clipboard ?? browserClipboard();
  if (clipboard === null) {
    return readCanvasSessionClipboard();
  }
  try {
    const items = await clipboard.read();
    for (const item of items) {
      if (!item.types.includes(MEMI_CANVAS_CLIPBOARD_MIME)) {
        continue;
      }
      const blob = await item.getType(MEMI_CANVAS_CLIPBOARD_MIME);
      if (blob.size > CANVAS_CLIPBOARD_MAX_BYTES) {
        continue;
      }
      const payload = parseCanvasClipboardFallback(await blob.text());
      if (payload !== null) {
        return payload;
      }
    }
  } catch {
    // The in-session payload remains the reliable fallback for browsers that
    // deny Clipboard read/write permission or custom MIME formats.
  }
  return readCanvasSessionClipboard();
}

export function readCanvasSessionClipboard(): CanvasClipboardPayload | null {
  return sessionClipboardFallback === null
    ? null
    : parseCanvasClipboardFallback(sessionClipboardFallback);
}

export function hasCanvasSessionClipboard(): boolean {
  return readCanvasSessionClipboard() !== null;
}

export function clearCanvasSessionClipboard(): void {
  sessionClipboardFallback = null;
  clearCanvasSessionImage();
}

export function pasteCanvasClipboard(
  nodes: readonly WorkbenchNode[],
  payload: CanvasClipboardPayload | null = readCanvasSessionClipboard(),
  placement: CanvasClipboardPlacement = { kind: "offset" },
): CanvasClipboardPasteResult | null {
  const validated = payload === null ? null : validatedPayload(payload);
  if (validated === null) {
    return null;
  }
  const translation = canvasClipboardTranslation(validated, placement);
  if (translation === null) {
    return null;
  }
  return pasteValidatedCanvasClipboard(
    nodes,
    validated,
    translation,
  );
}

function canvasClipboardTranslation(
  payload: CanvasClipboardPayload,
  placement: CanvasClipboardPlacement,
): Point | null {
  if (placement.kind === "offset") {
    const offset = placement.offset ?? CANVAS_CLIPBOARD_OFFSET;
    return Number.isFinite(offset) ? { x: offset, y: offset } : null;
  }
  if (!Number.isFinite(placement.point.x) || !Number.isFinite(placement.point.y)) {
    return null;
  }
  const roots = payload.rootIds.flatMap((id) => {
    const node = payload.nodes.find((candidate) => candidate.id === id);
    return node === undefined ? [] : [node];
  });
  const left = Math.min(...roots.map(({ position }) => position.x));
  const top = Math.min(...roots.map(({ position }) => position.y));
  const right = Math.max(...roots.map((node) => node.position.x + node.size.width));
  const bottom = Math.max(...roots.map((node) => node.position.y + node.size.height));
  return {
    x: placement.point.x - (left + right) / 2,
    y: placement.point.y - (top + bottom) / 2,
  };
}

export function isCanvasNodeDeletable(node: WorkbenchNode): boolean {
  return (
    node.kind !== "CodeFrame" &&
    node.kind !== "RoutePlaceholder" &&
    node.kind !== "ReferenceFrame"
  );
}

export function cutCanvasSelection(
  input: CanvasClipboardInput,
): CanvasClipboardCutResult | null {
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
  let deletedIds = new Set(
    input.selectedIds.filter((id) => {
      const node = nodesById.get(id);
      return node !== undefined && isCanvasNodeDeletable(node);
    }),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of input.nodes) {
      if (
        node.parentId !== null &&
        deletedIds.has(node.parentId) &&
        !deletedIds.has(node.id) &&
        isCanvasNodeDeletable(node)
      ) {
        deletedIds = new Set([...deletedIds, node.id]);
        changed = true;
      }
    }
  }
  if (deletedIds.size === 0) {
    return null;
  }

  const deletedNodes = input.nodes.filter((node) => deletedIds.has(node.id));
  const payload = copyCanvasSelection({
    documentId: input.documentId,
    nodes: deletedNodes,
    selectedIds: deletedNodes.map((node) => node.id),
  });
  if (payload === null) {
    return null;
  }

  const remaining = input.nodes
    .filter((node) => !deletedIds.has(node.id))
    .map((node) =>
      node.parentId !== null && deletedIds.has(node.parentId)
        ? { ...node, parentId: null }
        : node,
    );
  return {
    deletedIds: input.nodes
      .filter((node) => deletedIds.has(node.id))
      .map((node) => node.id),
    nodes: remaining,
    payload,
  };
}
