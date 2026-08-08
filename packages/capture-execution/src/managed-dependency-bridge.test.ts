import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  prepareManagedDependencyBridge,
  restoreManagedDependencyBridge,
} from "./managed-dependency-bridge.js";

describe("managed dependency bridge", () => {
  it("links a read-only dependency tree into a managed snapshot and removes only its link", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-managed-bridge-"));
    const projectRoot = join(root, "managed-project");
    const dependencyRoot = join(root, "source-dependencies");
    await mkdir(join(dependencyRoot, "expo-router"), { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(dependencyRoot, "expo-router", "entry.js"), "export {};\n");

    const prepared = await prepareManagedDependencyBridge({
      projectRoot,
      dependencyRoot,
    });

    const bridgePath = join(projectRoot, "node_modules");
    expect((await lstat(bridgePath)).isSymbolicLink()).toBe(true);
    await expect(realpath(bridgePath)).resolves.toBe(await realpath(dependencyRoot));

    await restoreManagedDependencyBridge(prepared);

    await expect(lstat(bridgePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(dependencyRoot, "expo-router", "entry.js"), "utf8"),
    ).resolves.toBe("export {};\n");
  });

  it("preserves a project-owned dependency directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-local-dependencies-"));
    const projectRoot = join(root, "managed-project");
    const dependencyRoot = join(projectRoot, "node_modules");
    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(join(dependencyRoot, "sentinel"), "local\n");

    const prepared = await prepareManagedDependencyBridge({
      projectRoot,
      dependencyRoot,
    });
    await restoreManagedDependencyBridge(prepared);

    expect(prepared.created).toBe(false);
    await expect(readFile(join(dependencyRoot, "sentinel"), "utf8"))
      .resolves.toBe("local\n");
  });

  it("rejects a conflicting dependency link instead of replacing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-conflicting-bridge-"));
    const projectRoot = join(root, "managed-project");
    const dependencyRoot = join(root, "source-dependencies");
    const conflictingRoot = join(root, "other-dependencies");
    await mkdir(projectRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await mkdir(conflictingRoot, { recursive: true });
    await symlink(conflictingRoot, join(projectRoot, "node_modules"), "dir");

    await expect(
      prepareManagedDependencyBridge({ projectRoot, dependencyRoot }),
    ).rejects.toThrow(/different dependency tree/i);
    await expect(realpath(join(projectRoot, "node_modules")))
      .resolves.toBe(await realpath(conflictingRoot));
  });
});
