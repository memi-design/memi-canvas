import { describe, expect, it } from "vitest";

import { readBoundedBytes } from "./filesystem.js";

function readerFor(bytes: Buffer) {
  return {
    async read(
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) {
      const available = Math.min(length, bytes.length - position);
      if (available <= 0) {
        return { bytesRead: 0 };
      }
      bytes.copy(buffer, offset, position, position + available);
      return { bytesRead: available };
    },
  };
}

describe("readBoundedBytes", () => {
  it("reads an exact-budget regular-file snapshot", async () => {
    await expect(
      readBoundedBytes(readerFor(Buffer.from("1234")), 4),
    ).resolves.toEqual(Buffer.from("1234"));
  });

  it("detects one overflow byte without allocating the growing file", async () => {
    await expect(
      readBoundedBytes(readerFor(Buffer.from("12345")), 4),
    ).rejects.toThrow(/file byte budget/i);
  });
});
