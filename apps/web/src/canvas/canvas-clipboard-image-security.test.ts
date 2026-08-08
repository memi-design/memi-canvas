import { describe, expect, it } from "vitest";

import { isValidCanvasClipboardImage } from "./canvas-clipboard-image.js";

function imageSource(width: number, height: number, complete: boolean): Uint8Array {
  const bytes = new Uint8Array(complete ? 57 : 24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  if (complete) {
    bytes.set([8, 6, 0, 0, 0], 24);
    view.setUint32(33, 0);
    bytes.set([73, 68, 65, 84], 37);
    view.setUint32(45, 0);
    bytes.set([73, 69, 78, 68], 49);
  }
  return bytes;
}

function source(bytes: Uint8Array): string {
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}

describe("canvas clipboard PNG security", () => {
  it("rejects header-only and excessive decoded pixel payloads", () => {
    const truncated = imageSource(1, 1, false);
    expect(isValidCanvasClipboardImage({
      alt: "Truncated",
      byteLength: truncated.byteLength,
      height: 1,
      mimeType: "image/png",
      src: source(truncated),
      width: 1,
    })).toBe(false);

    const bomb = imageSource(8_192, 8_192, true);
    expect(isValidCanvasClipboardImage({
      alt: "Compressed bomb",
      byteLength: bomb.byteLength,
      height: 8_192,
      mimeType: "image/png",
      src: source(bomb),
      width: 8_192,
    })).toBe(false);
  });
});
