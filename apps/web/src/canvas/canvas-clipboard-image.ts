import type { WorkbenchNode } from "./model.js";

export const CANVAS_CLIPBOARD_MAX_IMAGE_BYTES = 2_097_152;
export const CANVAS_CLIPBOARD_MAX_IMAGE_DIMENSION = 32_768;
export const CANVAS_CLIPBOARD_MAX_IMAGE_PIXELS = 16_777_216;

export interface CanvasSystemClipboardItem {
  readonly types: readonly string[];
  getType(type: string): Promise<Blob>;
}

export interface CanvasSystemClipboard {
  read(): Promise<readonly CanvasSystemClipboardItem[]>;
  write(items: readonly CanvasSystemClipboardItem[]): Promise<void>;
}

export interface CanvasSystemClipboardDependencies {
  readonly clipboard?: CanvasSystemClipboard | undefined;
  readonly createItem?:
    | ((items: Readonly<Record<string, Blob>>) => CanvasSystemClipboardItem)
    | undefined;
}

export interface CanvasClipboardPasteItem {
  readonly type: string;
  getAsFile(): Blob | null;
}

export interface CanvasClipboardPasteData {
  readonly items?: ArrayLike<CanvasClipboardPasteItem>;
  readonly types: ArrayLike<string>;
  getData(type: string): string;
}

/** Durable pixels originating from a verified native PNG clipboard entry. */
export interface CanvasClipboardImage {
  readonly alt: string;
  readonly byteLength: number;
  readonly height: number;
  readonly mimeType: "image/png";
  readonly src: string;
  readonly width: number;
}

let sessionImageFallback: CanvasClipboardImage | null = null;

export function browserClipboard(): CanvasSystemClipboard | null {
  if (
    typeof navigator === "undefined" ||
    navigator.clipboard === undefined ||
    typeof navigator.clipboard.read !== "function" ||
    typeof navigator.clipboard.write !== "function"
  ) {
    return null;
  }
  return navigator.clipboard as unknown as CanvasSystemClipboard;
}

export function browserClipboardItem(
  items: Readonly<Record<string, Blob>>,
): CanvasSystemClipboardItem | null {
  if (typeof ClipboardItem !== "function") {
    return null;
  }
  return new ClipboardItem(items) as unknown as CanvasSystemClipboardItem;
}

function pngDimensions(
  bytes: Uint8Array,
): { readonly height: number; readonly width: number } | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.byteLength < 24 ||
    signature.some((value, index) => bytes[index] !== value) ||
    bytes[12] !== 73 ||
    bytes[13] !== 72 ||
    bytes[14] !== 68 ||
    bytes[15] !== 82 ||
    !hasCompletePngStructure(bytes)
  ) {
    return null;
  }
  const dimensions = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const width = dimensions.getUint32(16);
  const height = dimensions.getUint32(20);
  if (
    width === 0 ||
    height === 0 ||
    width > CANVAS_CLIPBOARD_MAX_IMAGE_DIMENSION ||
    height > CANVAS_CLIPBOARD_MAX_IMAGE_DIMENSION
    || width * height > CANVAS_CLIPBOARD_MAX_IMAGE_PIXELS
  ) {
    return null;
  }
  return { height, width };
}

function hasCompletePngStructure(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let sawImageData = false;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.byteLength) {
      return false;
    }
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (offset === 8 && (type !== "IHDR" || length !== 13)) {
      return false;
    }
    if (type === "IDAT") {
      sawImageData = true;
    }
    if (type === "IEND") {
      return length === 0 && sawImageData && end === bytes.byteLength;
    }
    offset = end;
  }
  return false;
}

function bytesFromImageSource(src: string): Uint8Array | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(src);
  if (match?.[1] === undefined || typeof atob !== "function") {
    return null;
  }
  try {
    const binary = atob(match[1]);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function base64FromBytes(bytes: Uint8Array): string | null {
  if (typeof btoa !== "function") {
    return null;
  }
  let binary = "";
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)),
    );
  }
  return btoa(binary);
}

function nativePngBlob(
  clipboardData: CanvasClipboardPasteData | null,
): Blob | null {
  if (clipboardData === null || clipboardData.items === undefined) {
    return null;
  }
  for (const item of Array.from(clipboardData.items)) {
    if (item.type.toLowerCase() !== "image/png") {
      continue;
    }
    const file = item.getAsFile();
    if (file !== null) {
      return file;
    }
  }
  return null;
}

async function readCanvasImageFromPngBlob(
  blob: Blob | null,
): Promise<CanvasClipboardImage | null> {
  if (
    blob === null ||
    blob.size === 0 ||
    blob.size > CANVAS_CLIPBOARD_MAX_IMAGE_BYTES
  ) {
    return null;
  }
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > CANVAS_CLIPBOARD_MAX_IMAGE_BYTES
    ) {
      return null;
    }
    const dimensions = pngDimensions(bytes);
    const base64 = dimensions === null ? null : base64FromBytes(bytes);
    if (dimensions === null || base64 === null) {
      return null;
    }
    return {
      alt: "Pasted image",
      byteLength: bytes.byteLength,
      height: dimensions.height,
      mimeType: "image/png",
      src: `data:image/png;base64,${base64}`,
      width: dimensions.width,
    };
  } catch {
    return null;
  }
}

export function isValidCanvasClipboardImage(
  image: CanvasClipboardImage,
): boolean {
  if (
    image.mimeType !== "image/png" ||
    !Number.isInteger(image.byteLength) ||
    image.byteLength <= 0 ||
    image.byteLength > CANVAS_CLIPBOARD_MAX_IMAGE_BYTES ||
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    image.width > CANVAS_CLIPBOARD_MAX_IMAGE_DIMENSION ||
    image.height > CANVAS_CLIPBOARD_MAX_IMAGE_DIMENSION ||
    image.alt.trim().length === 0 ||
    image.alt.length > 4_096
  ) {
    return false;
  }
  const bytes = bytesFromImageSource(image.src);
  const dimensions = bytes === null ? null : pngDimensions(bytes);
  return (
    bytes !== null &&
    bytes.byteLength === image.byteLength &&
    dimensions?.width === image.width &&
    dimensions.height === image.height
  );
}

export function storeCanvasSessionImage(
  image: CanvasClipboardImage,
): boolean {
  if (!isValidCanvasClipboardImage(image)) {
    return false;
  }
  sessionImageFallback = structuredClone(image);
  return true;
}

export function readCanvasSessionImage(): CanvasClipboardImage | null {
  return sessionImageFallback === null
    ? null
    : structuredClone(sessionImageFallback);
}

export function clearCanvasSessionImage(): void {
  sessionImageFallback = null;
}

export function hasCanvasImageInPasteData(
  clipboardData: CanvasClipboardPasteData | null,
): boolean {
  return nativePngBlob(clipboardData) !== null;
}

export async function readCanvasImageFromPasteData(
  clipboardData: CanvasClipboardPasteData | null,
): Promise<CanvasClipboardImage | null> {
  return readCanvasImageFromPngBlob(nativePngBlob(clipboardData));
}

export async function readCanvasImageFromSystem(
  dependencies: CanvasSystemClipboardDependencies = {},
): Promise<CanvasClipboardImage | null> {
  const clipboard = dependencies.clipboard ?? browserClipboard();
  if (clipboard === null) {
    return readCanvasSessionImage();
  }
  try {
    const items = await clipboard.read();
    for (const item of items) {
      if (!item.types.includes("image/png")) {
        continue;
      }
      const image = await readCanvasImageFromPngBlob(
        await item.getType("image/png"),
      );
      if (image !== null) {
        return image;
      }
    }
    return null;
  } catch {
    return readCanvasSessionImage();
  }
}

export function createCanvasImageNodeAtPoint(input: {
  readonly cursor: { readonly x: number; readonly y: number };
  readonly image: CanvasClipboardImage;
  readonly nodes: readonly WorkbenchNode[];
  readonly parentId: string | null;
}): WorkbenchNode | null {
  if (
    !isValidCanvasClipboardImage(input.image) ||
    !Number.isFinite(input.cursor.x) ||
    !Number.isFinite(input.cursor.y) ||
    Math.abs(input.cursor.x) > 1_000_000_000 ||
    Math.abs(input.cursor.y) > 1_000_000_000 ||
    (input.parentId !== null &&
      !input.nodes.some(({ id }) => id === input.parentId))
  ) {
    return null;
  }
  const knownIds = new Set(input.nodes.map(({ id }) => id));
  let suffix = 1;
  while (knownIds.has(`image-${suffix}`)) {
    suffix += 1;
  }
  const image = structuredClone(input.image);
  return {
    hidden: false,
    id: `image-${suffix}`,
    image,
    kind: "Image",
    locked: false,
    name: image.alt.trim(),
    parentId: input.parentId,
    position: { ...input.cursor },
    size: { height: image.height, width: image.width },
  };
}
