import { describe, expect, it, vi } from "vitest";

import { OperationIdSchema } from "@memi/protocol";

import {
  createCanvasOperationId,
  createRecoveredSerialQueue,
} from "./workbench-v3-session-bridge.js";

describe("V3 workbench session bridge queue", () => {
  it("creates protocol-valid sortable operation identities", () => {
    const earlier = createCanvasOperationId({
      now: 1_786_000_000_000,
      randomBytes: () => new Uint8Array(10),
    });
    const later = createCanvasOperationId({
      now: 1_786_000_000_001,
      randomBytes: () => new Uint8Array(10),
    });

    expect(OperationIdSchema.parse(earlier)).toBe(earlier);
    expect(OperationIdSchema.parse(later)).toBe(later);
    expect(earlier < later).toBe(true);
  });

  it("does not reuse operation identities within one timestamp", () => {
    const ids = Array.from({ length: 128 }, () =>
      createCanvasOperationId({ now: 1_786_000_000_000 }),
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runs rapid receipts in order and recovers after a rejected operation", async () => {
    const failures = vi.fn();
    const enqueue = createRecoveredSerialQueue(failures);
    const events: string[] = [];
    const first = enqueue(async () => {
      events.push("first");
      throw new Error("durable write failed");
    });
    const second = enqueue(async () => { events.push("second"); });

    await Promise.all([first, second]);

    expect(events).toEqual(["first", "second"]);
    expect(failures).toHaveBeenCalledWith("durable write failed");
  });

  it("contains unavailable-authority failures without returning a rejection", async () => {
    const failures = vi.fn();
    const enqueue = createRecoveredSerialQueue(failures);

    await expect(enqueue(async () => {
      throw new Error("Canvas V3 is still opening; mutation was not accepted.");
    })).resolves.toBeUndefined();

    expect(failures).toHaveBeenCalledOnce();
  });

  it("recovers after a rejected history task so later traversal can run", async () => {
    const failures = vi.fn();
    const enqueue = createRecoveredSerialQueue(failures);
    const traversed = vi.fn();

    await enqueue(async () => { throw new Error("undo durable write failed"); });
    await enqueue(async () => { traversed(); });

    expect(failures).toHaveBeenCalledWith("undo durable write failed");
    expect(traversed).toHaveBeenCalledOnce();
  });
});
