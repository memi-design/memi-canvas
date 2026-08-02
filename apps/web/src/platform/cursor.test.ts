import { describe, expect, it, vi } from "vitest";

import { openSourceInCursor } from "./cursor.js";

describe("openSourceInCursor", () => {
  it("rejects source paths outside the connected project", async () => {
    const invoke = vi.fn();

    await expect(
      openSourceInCursor("../Secrets.txt", {
        __TAURI_INTERNALS__: { invoke },
      }),
    ).resolves.toEqual({
      status: "rejected",
      message: "Cursor can open only contained project source paths.",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("opens a contained source through the native shell", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);

    await expect(
      openSourceInCursor("components/ui/Button.tsx", {
        __TAURI_INTERNALS__: { invoke },
      }),
    ).resolves.toEqual({ status: "opened" });
    expect(invoke).toHaveBeenCalledWith("open_in_cursor", {
      sourcePath: "components/ui/Button.tsx",
    });
  });

  it("reports that Cursor launching is native-only", async () => {
    await expect(
      openSourceInCursor("components/ui/Button.tsx", {}),
    ).resolves.toEqual({
      status: "unavailable",
      message: "Open in Cursor is available in the Memi macOS app.",
    });
  });
});
