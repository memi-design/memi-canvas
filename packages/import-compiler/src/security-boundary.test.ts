import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileProductImport } from "./index.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../test-fixtures/deterministic-product/", import.meta.url),
);
const roots: string[] = [];

async function copyFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memi-import-security-"));
  roots.push(root);
  await cp(FIXTURE_ROOT, root, { recursive: true });
  return root;
}

const budgets = {
  maxFileBytes: 64 * 1024,
  maxTotalBytes: 256 * 1024,
} as const;
const authority = {
  projectId: "prj_01J00000000000000000000000",
  repository: {
    revision: "0123456789abcdef0123456789abcdef01234567",
    dirty: false,
    dirtyFileFingerprint: `sha256:${"d".repeat(64)}`,
  },
  adapterVersion: "vite-react-static@1",
} as const;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("import filesystem boundary", () => {
  it("rejects a required input that is a symlink", async () => {
    const root = await copyFixture();
    const tokenPath = join(root, "src/styles/tokens.css");
    await rm(tokenPath);
    await symlink("/etc/hosts", tokenPath);

    await expect(
      compileProductImport({ ...authority, rootDir: root, budgets }),
    ).rejects.toThrow(/symbolic link|symlink/i);
  });

  it("rejects a declared flow input that is a symlink", async () => {
    const root = await copyFixture();
    const flowPath = join(root, "src/app/flows.ts");
    await rm(flowPath);
    await symlink("/etc/hosts", flowPath);

    await expect(
      compileProductImport({ ...authority, rootDir: root, budgets }),
    ).rejects.toThrow(/symbolic link|symlink/i);
  });

  it("enforces the explicit per-file byte budget", async () => {
    const root = await copyFixture();
    await writeFile(
      join(root, "src/styles/tokens.css"),
      `:root { --oversized: "${"x".repeat(2048)}"; }`,
      "utf8",
    );

    await expect(
      compileProductImport({
        ...authority,
        rootDir: root,
        budgets: { maxFileBytes: 1024, maxTotalBytes: 4096 },
      }),
    ).rejects.toThrow(/file byte budget/i);
  });

  it("enforces the explicit aggregate byte budget", async () => {
    const root = await copyFixture();

    await expect(
      compileProductImport({
        ...authority,
        rootDir: root,
        budgets: { maxFileBytes: 64 * 1024, maxTotalBytes: 10 },
      }),
    ).rejects.toThrow(/total byte budget/i);
  });
});
