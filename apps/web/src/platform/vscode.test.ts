import { describe, expect, it, vi } from "vitest";

import { openSourceInVSCode } from "./vscode.js";

describe("VS Code desktop bridge", () => {
  it("opens a validated source path inside its local workspace", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);

    await expect(
      openSourceInVSCode("components/ui/Button.tsx", {
        __TAURI_INTERNALS__: { invoke },
      }),
    ).resolves.toEqual({ status: "opened" });
    expect(invoke).toHaveBeenCalledWith("open_in_vscode", {
      sourcePath: "components/ui/Button.tsx",
    });
  });

  it("rejects traversal, absolute sources, and ordinary web builds", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);

    await expect(
      openSourceInVSCode("../Secrets.txt", {
        __TAURI_INTERNALS__: { invoke },
      }),
    ).resolves.toMatchObject({ status: "rejected" });
    await expect(
      openSourceInVSCode("/etc/passwd", {
        __TAURI_INTERNALS__: { invoke },
      }),
    ).resolves.toMatchObject({ status: "rejected" });
    expect(invoke).not.toHaveBeenCalled();

    await expect(
      openSourceInVSCode("components/ui/Button.tsx", {}),
    ).resolves.toEqual({
      status: "unavailable",
      message: "Open in VS Code is available in the Memi macOS app.",
    });
  });
});
