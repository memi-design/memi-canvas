import { describe, expect, it, vi } from "vitest";

import { openLocalPreviewInHelium } from "./helium.js";

describe("Helium desktop bridge", () => {
  it("invokes only the native localhost opener", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);

    await expect(
      openLocalPreviewInHelium("http://127.0.0.1:4173/dashboard", {
        __TAURI_INTERNALS__: { invoke },
      }),
    ).resolves.toEqual({ status: "opened" });
    expect(invoke).toHaveBeenCalledWith("open_in_helium", {
      url: "http://127.0.0.1:4173/dashboard",
    });
  });

  it("fails closed for external URLs and ordinary web builds", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);

    await expect(
      openLocalPreviewInHelium("https://example.com", {
        __TAURI_INTERNALS__: { invoke },
      }),
    ).resolves.toEqual({
      status: "rejected",
      message: "Helium can open only explicit HTTP localhost preview ports.",
    });
    expect(invoke).not.toHaveBeenCalled();

    await expect(
      openLocalPreviewInHelium("http://localhost:5173", {}),
    ).resolves.toEqual({
      status: "unavailable",
      message: "Open in Helium is available in the Memi macOS app.",
    });
  });

  it("returns a useful native failure without throwing into the editor", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("Helium is missing"));

    await expect(
      openLocalPreviewInHelium("http://localhost:5173", {
        __TAURI_INTERNALS__: { invoke },
      }),
    ).resolves.toEqual({
      status: "failed",
      message: "Helium is missing",
    });
  });
});
