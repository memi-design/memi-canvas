import { describe, expect, it, vi } from "vitest";

import { chooseRepositoryFolder } from "./repository-folder.js";

describe("native repository folder picker", () => {
  it("returns only one user-selected directory", async () => {
    const open = vi.fn().mockResolvedValue("/Projects/northstar");

    await expect(chooseRepositoryFolder(open)).resolves.toBe(
      "/Projects/northstar",
    );
    expect(open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Choose a product repository",
    });
  });

  it("treats cancellation and multi-selection as no selection", async () => {
    await expect(
      chooseRepositoryFolder(vi.fn().mockResolvedValue(null)),
    ).resolves.toBeNull();
    await expect(
      chooseRepositoryFolder(
        vi.fn().mockResolvedValue(["/Projects/one", "/Projects/two"]),
      ),
    ).resolves.toBeNull();
  });
});
