import { describe, expect, it, vi } from "vitest";

import { OperationIdSchema } from "@memi/protocol";
import { createCanvasDocumentV3 } from "@memi/canvas-document";
import { CanvasPageIdSchema } from "@memi/protocol";

import {
  canonicalizeWorkbenchSelectionIdsV3,
  createCanvasOperationId,
  createRecoveredSerialQueue,
} from "./workbench-v3-session-bridge.js";
import { canonicalWorkbenchNodeIdV3 } from "./workbench-v3-intents.js";

describe("V3 workbench session bridge queue", () => {
  it("canonicalizes post-commit legacy selections, including additive new nodes", () => {
    const pageId = CanvasPageIdSchema.parse("pag_01J00000000000000000000000");
    const document = createCanvasDocumentV3({
      id: "doc_01J00000000000000000000000",
      initialPage: { id: pageId, kind: "design", name: "Canvas" },
      projectId: "prj_01J00000000000000000000000",
    });
    const selectedIds = ["existing-card", "new-paste", "existing-card", "new-copy"];

    expect(canonicalizeWorkbenchSelectionIdsV3({ document, pageId, selectedIds })).toEqual([
      canonicalWorkbenchNodeIdV3(document, pageId, "existing-card"),
      canonicalWorkbenchNodeIdV3(document, pageId, "new-paste"),
      canonicalWorkbenchNodeIdV3(document, pageId, "new-copy"),
    ]);
  });

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

  it("propagates a durable receipt failure while recovering the serial queue", async () => {
    const failures = vi.fn();
    const enqueue = createRecoveredSerialQueue(failures, {
      propagateFailure: true,
    });
    const later = vi.fn();
    const failed = enqueue(async () => {
      throw new Error("persistence receipt mismatch");
    });
    const recovered = enqueue(async () => later());

    await expect(failed).rejects.toThrow("persistence receipt mismatch");
    await expect(recovered).resolves.toBeUndefined();
    expect(later).toHaveBeenCalledOnce();
    expect(failures).toHaveBeenCalledWith("persistence receipt mismatch");
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
