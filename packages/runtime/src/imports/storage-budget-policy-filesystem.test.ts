import {
  mkdtemp,
  mkdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  availableStorageBytes,
  inspectStorageChildren,
  inspectStorageTree,
  storageEntriesBytes,
  storagePathsOverlap,
} from "./storage-budget-policy-filesystem.js";

describe("storage budget filesystem inspection", () => {
  it("reports missing paths and empty roots without creating them", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-storage-inspection-"));

    await expect(inspectStorageTree(join(root, "missing"))).resolves.toBeNull();
    await expect(
      inspectStorageChildren(join(root, "missing")),
    ).resolves.toEqual([]);
    await expect(inspectStorageChildren(root)).resolves.toEqual([]);
  });

  it("accounts nested regular files and returns immutable entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-storage-inspection-"));
    const nested = join(root, "nested");
    await mkdir(nested);
    await Promise.all([
      writeFile(join(root, "first.bin"), Buffer.alloc(2)),
      writeFile(join(nested, "second.bin"), Buffer.alloc(3)),
    ]);

    const inspected = await inspectStorageTree(root);
    expect(inspected).toMatchObject({ path: root, bytes: 5 });
    expect(Object.isFrozen(inspected)).toBe(true);
    const children = await inspectStorageChildren(root);
    expect(storageEntriesBytes(children)).toBe(5);
    expect(Object.isFrozen(children)).toBe(true);
  });

  it("can count a symlink as an entry but never follows it", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-storage-inspection-"));
    const outside = await mkdtemp(join(tmpdir(), "memi-storage-outside-"));
    const linked = join(root, "linked");
    await writeFile(join(outside, "truth.bin"), Buffer.alloc(20));
    await symlink(outside, linked, "dir");

    await expect(inspectStorageTree(linked)).rejects.toThrow(/symbolic/iu);
    const entry = await inspectStorageTree(linked, "entry");
    expect(entry?.bytes).toBeGreaterThan(0);
    expect(entry?.bytes).not.toBe(20);
    await expect(inspectStorageChildren(root, "entry")).resolves.toHaveLength(1);
  });

  it("rejects a regular file where a child directory is required", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-storage-inspection-"));
    const file = join(root, "file.bin");
    await writeFile(file, "x");

    await expect(inspectStorageChildren(file)).rejects.toThrow(/directory/iu);
  });

  it("recognizes equal, ancestor, and descendant locks but not siblings", () => {
    expect(storagePathsOverlap("/tmp/a", ["/tmp/a"])).toBe(true);
    expect(storagePathsOverlap("/tmp/a", ["/tmp/a/b"])).toBe(true);
    expect(storagePathsOverlap("/tmp/a/b", ["/tmp/a"])).toBe(true);
    expect(storagePathsOverlap("/tmp/a", ["/tmp/b"])).toBe(false);
    expect(storagePathsOverlap("/tmp/a", [])).toBe(false);
  });

  it("measures available bytes without writing to the target", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-storage-inspection-"));
    await expect(availableStorageBytes(root)).resolves.toBeGreaterThan(0);
  });
});
