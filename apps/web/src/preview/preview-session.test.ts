import { describe, expect, it } from "vitest";

import {
  createPreviewSession,
  previewSessionReducer,
} from "./preview-session.js";

describe("preview session", () => {
  it("keeps address drafts separate from a connecting preview", () => {
    const initial = createPreviewSession("http://127.0.0.1:5173", {
      documentRevision: 7,
      projectId: "buzzr-ios-2-1",
    });
    const edited = previewSessionReducer(initial, {
      type: "edit-address",
      address: "http://localhost:4174/account",
    });

    expect(edited.address).toBe("http://localhost:4174/account");
    expect(edited.url).toBe("");
    expect(edited.status).toBe("stopped");

    const connecting = previewSessionReducer(edited, {
      type: "navigate",
      sessionId: "preview-session-1",
      url: edited.address,
    });
    expect(connecting.url).toBe(edited.address);
    expect(connecting.status).toBe("connecting");
    expect(connecting.lastGood).toBeNull();
  });

  it("requires project, revision, and session evidence before becoming ready", () => {
    const connecting = previewSessionReducer(
      createPreviewSession("http://localhost:4174", {
        documentRevision: 7,
        projectId: "buzzr-ios-2-1",
      }),
      {
        type: "navigate",
        sessionId: "preview-session-1",
        url: "http://localhost:4174",
      },
    );
    const wrongRevision = previewSessionReducer(connecting, {
      type: "ready",
      documentRevision: 8,
      projectId: "buzzr-ios-2-1",
      sessionId: "preview-session-1",
      verifiedAt: "2026-07-29T06:30:00.000Z",
    });
    expect(wrongRevision.status).toBe("connecting");

    const ready = previewSessionReducer(connecting, {
      type: "ready",
      documentRevision: 7,
      projectId: "buzzr-ios-2-1",
      sessionId: "preview-session-1",
      verifiedAt: "2026-07-29T06:30:00.000Z",
    });
    expect(ready.status).toBe("ready");
    expect(ready.lastGood).toEqual({
      documentRevision: 7,
      sessionId: "preview-session-1",
      url: "http://localhost:4174",
      verifiedAt: "2026-07-29T06:30:00.000Z",
    });
  });

  it("reloads into connecting without discarding the last good preview", () => {
    const connecting = previewSessionReducer(
      createPreviewSession("http://localhost:4174", {
        documentRevision: 7,
        projectId: "buzzr-ios-2-1",
      }),
      {
        type: "navigate",
        sessionId: "preview-session-1",
        url: "http://localhost:4174",
      },
    );
    const ready = previewSessionReducer(connecting, {
      type: "ready",
      documentRevision: 7,
      projectId: "buzzr-ios-2-1",
      sessionId: "preview-session-1",
      verifiedAt: "2026-07-29T06:30:00.000Z",
    });
    const reloaded = previewSessionReducer(ready, {
      type: "reload",
      sessionId: "preview-session-2",
    });

    expect(reloaded.navigationRevision).toBe(
      ready.navigationRevision + 1,
    );
    expect(reloaded.url).toBe(ready.url);
    expect(reloaded.status).toBe("connecting");
    expect(reloaded.lastGood).toBe(ready.lastGood);

    const stopped = previewSessionReducer(reloaded, { type: "stop" });
    expect(stopped.status).toBe("stopped");
    expect(stopped.url).toBe("");
    expect(stopped.address).toBe("http://localhost:4174");
  });

  it("ignores reload while no preview is running", () => {
    const initial = createPreviewSession("http://localhost:4174", {
      documentRevision: 7,
      projectId: "buzzr-ios-2-1",
    });
    expect(
      previewSessionReducer(initial, {
        type: "reload",
        sessionId: "preview-session-1",
      }),
    ).toEqual(initial);
  });

  it("preserves last-good evidence when the preview becomes stale or fails", () => {
    const connecting = previewSessionReducer(
      createPreviewSession("http://localhost:4174", {
        documentRevision: 7,
        projectId: "buzzr-ios-2-1",
      }),
      {
        type: "navigate",
        sessionId: "preview-session-1",
        url: "http://localhost:4174",
      },
    );
    const ready = previewSessionReducer(connecting, {
      type: "ready",
      documentRevision: 7,
      projectId: "buzzr-ios-2-1",
      sessionId: "preview-session-1",
      verifiedAt: "2026-07-29T06:30:00.000Z",
    });
    const stale = previewSessionReducer(ready, {
      type: "stale",
      reason: "Document revision changed.",
    });
    expect(stale.status).toBe("stale");
    expect(stale.reason).toBe("Document revision changed.");
    expect(stale.lastGood).toBe(ready.lastGood);

    const failed = previewSessionReducer(stale, {
      type: "error",
      reason: "Connection refused.",
      sessionId: "preview-session-1",
    });
    expect(failed.status).toBe("error");
    expect(failed.lastGood).toBe(ready.lastGood);
  });
});
