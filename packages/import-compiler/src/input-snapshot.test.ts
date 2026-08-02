import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readVerifiedInputBatch } from "./input-snapshot.js";

const roots: string[] = [];
const budgets = { maxFileBytes: 1024, maxTotalBytes: 4096 } as const;

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memi-input-snapshot-"));
  roots.push(root);
  await mkdir(join(root, "src/app"), { recursive: true });
  await writeFile(join(root, "src/app/a.txt"), "alpha", "utf8");
  await writeFile(join(root, "src/app/b.txt"), "bravo", "utf8");
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("readVerifiedInputBatch", () => {
  it("rejects final-component replacement between lstat and open", async () => {
    const root = await fixture();
    const path = join(root, "src/app/a.txt");
    await expect(
      readVerifiedInputBatch({
        rootDir: root,
        inputPaths: ["src/app/a.txt"],
        budgets,
        hooks: {
          afterInitialLstat: async () => {
            await rename(path, `${path}.original`);
            await writeFile(path, "omega", "utf8");
          },
        },
      }),
    ).rejects.toThrow(/changed|identity|snapshot/i);
  });

  it("rejects truncate or growth after the bounded read", async () => {
    for (const contents of ["x", "alpha-expanded"]) {
      const root = await fixture();
      await expect(
        readVerifiedInputBatch({
          rootDir: root,
          inputPaths: ["src/app/a.txt"],
          budgets,
          hooks: {
            afterBoundedRead: async ({ candidate }) => {
              await writeFile(candidate, contents, "utf8");
            },
          },
        }),
      ).rejects.toThrow(/changed|identity|snapshot/i);
    }
  });

  it("rejects a hybrid batch when an earlier input changes later", async () => {
    const root = await fixture();
    await expect(
      readVerifiedInputBatch({
        rootDir: root,
        inputPaths: ["src/app/a.txt", "src/app/b.txt"],
        budgets,
        hooks: {
          afterBoundedRead: async ({ relativePath }) => {
            if (relativePath === "src/app/b.txt") {
              await writeFile(join(root, "src/app/a.txt"), "omega", "utf8");
            }
          },
        },
      }),
    ).rejects.toThrow(/changed|identity|snapshot/i);
  });

  it("rejects an ancestor symlink swap before batch revalidation", async () => {
    const root = await fixture();
    const outside = await fixture();
    await expect(
      readVerifiedInputBatch({
        rootDir: root,
        inputPaths: ["src/app/a.txt"],
        budgets,
        hooks: {
          beforeBatchRevalidation: async () => {
            await rename(join(root, "src"), join(root, "src-original"));
            await symlink(join(outside, "src"), join(root, "src"));
          },
        },
      }),
    ).rejects.toThrow(/changed|outside|symbolic|snapshot/i);
  });
});
