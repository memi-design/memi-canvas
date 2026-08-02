import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileProductImport,
  type ProductImportResult,
} from "@memi/import-compiler";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../test-fixtures/deterministic-product/", import.meta.url),
);

export const FIXED_ACTOR = "memi-import-pipeline";
export const FIXED_TIME = "2026-07-28T12:00:00.000Z";

export async function compileFixture(
  rootDir = FIXTURE_ROOT,
): Promise<ProductImportResult> {
  return compileProductImport({
    rootDir,
    projectId: "prj_01J00000000000000000000000",
    repository: {
      revision: "0123456789abcdef0123456789abcdef01234567",
      dirty: false,
      dirtyFileFingerprint: `sha256:${"d".repeat(64)}`,
    },
    adapterVersion: "vite-react-static@1",
    budgets: {
      maxFileBytes: 64 * 1024,
      maxTotalBytes: 256 * 1024,
    },
  });
}

export async function copyFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memi-product-import-"));
  await cp(FIXTURE_ROOT, root, { recursive: true });
  return root;
}

export async function removeFixtures(roots: readonly string[]): Promise<void> {
  await Promise.all(
    roots.map((root) => rm(root, { force: true, recursive: true })),
  );
}
