import { describe, expect, it, vi } from "vitest";

import {
  createPendingResponseFrame,
  flushPendingResponseFrame,
  type PendingResponseFrame,
} from "./framed-response.js";

describe("packaged runtime framed responses", () => {
  it("drains a response larger than the socket buffer before ending", () => {
    const payload = JSON.stringify({ inventory: "x".repeat(44_000) });
    let pending: PendingResponseFrame | null =
      createPendingResponseFrame(payload, 262_144);
    const written: Uint8Array[] = [];
    const end = vi.fn();
    const port = {
      write(bytes: Uint8Array) {
        const accepted = bytes.slice(0, 8_192);
        written.push(accepted);
        return accepted.byteLength;
      },
      end,
    };

    while (pending !== null) {
      pending = flushPendingResponseFrame(pending, port);
      if (pending !== null) {
        expect(end).not.toHaveBeenCalled();
      }
    }

    expect(end).toHaveBeenCalledOnce();
    expect(
      new TextDecoder().decode(
        Uint8Array.from(written.flatMap((chunk) => [...chunk])),
      ),
    ).toBe(`${payload}\n`);
  });

  it("waits for drain when the socket accepts no bytes", () => {
    const pending = createPendingResponseFrame('{"ok":true}', 262_144);
    const end = vi.fn();

    expect(
      flushPendingResponseFrame(pending, {
        write: () => 0,
        end,
      }),
    ).toBe(pending);
    expect(end).not.toHaveBeenCalled();
  });

  it("rejects a response that exceeds the broker frame limit", () => {
    expect(
      createPendingResponseFrame("x".repeat(15), 16).bytes,
    ).toHaveLength(16);
    expect(() =>
      createPendingResponseFrame("x".repeat(32), 16),
    ).toThrow("Runtime response exceeds its payload limit.");
  });

  it("fails closed when the socket reports an invalid write", () => {
    const pending = createPendingResponseFrame('{"ok":true}', 262_144);
    const end = vi.fn();

    expect(() =>
      flushPendingResponseFrame(pending, {
        write: () => -1,
        end,
      }),
    ).toThrow("Runtime response transport reported an invalid write.");
    expect(end).not.toHaveBeenCalled();
  });
});
