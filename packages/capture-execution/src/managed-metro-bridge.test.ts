import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  managedMetroConfigPath,
  prepareManagedMetroBridge,
  restoreManagedMetroBridge,
} from "./managed-metro-bridge.js";

describe("managed Metro bridge", () => {
  it("keeps the entry local, resolves trusted dependencies, and restores exact project files", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-metro-bridge-"));
    const projectRoot = join(root, "managed-project");
    const dependencyRoot = join(root, "source-dependencies");
    await mkdir(join(projectRoot, "modules/widget-bridge"), { recursive: true });
    await mkdir(join(projectRoot, ".memi"), { recursive: true });
    await mkdir(join(dependencyRoot, "expo-router"), { recursive: true });
    const originalPackage = `${JSON.stringify({
      name: "fixture",
      main: "expo-router/entry",
      dependencies: { "widget-bridge": "file:./modules/widget-bridge" },
    }, null, 2)}\n`;
    await writeFile(join(projectRoot, "package.json"), originalPackage);
    await writeFile(join(projectRoot, ".memi/keep.txt"), "project state\n");
    const originalMetroConfig =
      "module.exports = { resolver: { sourceExts: ['js'] } };\n";
    await writeFile(
      join(projectRoot, "metro.config.js"),
      originalMetroConfig,
    );

    const prepared = await prepareManagedMetroBridge({
      projectRoot,
      dependencyRoot,
      entryPoint: "expo-router/entry",
    });

    const patchedPackage = JSON.parse(
      await readFile(join(projectRoot, "package.json"), "utf8"),
    ) as { readonly main: string };
    expect(patchedPackage.main).toBe("./.memi-capture-entry.js");
    await expect(readFile(prepared.entryPath, "utf8")).resolves.toBe(
      'import "expo-router/entry";\n',
    );
    const wrapper = await readFile(prepared.configPath, "utf8");
    const canonicalProjectRoot = await realpath(projectRoot);
    expect(prepared.configPath).toBe(
      join(await realpath(projectRoot), "metro.config.js"),
    );
    expect(managedMetroConfigPath(await realpath(projectRoot))).toBe(
      prepared.configPath,
    );
    expect(wrapper).toContain("original-metro-config.cjs");
    expect(wrapper).toContain(
      JSON.stringify(await realpath(dependencyRoot)),
    );
    expect(wrapper).toContain(
      JSON.stringify(join(canonicalProjectRoot, "modules/widget-bridge")),
    );
    expect(wrapper).toContain(
      JSON.stringify(join(canonicalProjectRoot, "node_modules")),
    );

    await restoreManagedMetroBridge(prepared);

    await expect(readFile(join(projectRoot, "package.json"), "utf8"))
      .resolves.toBe(originalPackage);
    await expect(readFile(join(projectRoot, "metro.config.js"), "utf8"))
      .resolves.toBe(originalMetroConfig);
    await expect(lstat(join(projectRoot, ".memi/capture/metro-bridge")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(projectRoot, ".memi-capture-entry.js")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(projectRoot, ".memi/keep.txt"), "utf8"))
      .resolves.toBe("project state\n");
  });

  it("never overwrites an existing project-root capture entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-metro-collision-"));
    const projectRoot = join(root, "managed-project");
    const dependencyRoot = join(root, "source-dependencies");
    await mkdir(projectRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(
      join(projectRoot, "package.json"),
      '{"main":"expo-router/entry"}\n',
    );
    await writeFile(
      join(projectRoot, ".memi-capture-entry.js"),
      "project owned\n",
    );

    await expect(prepareManagedMetroBridge({
      projectRoot,
      dependencyRoot,
      entryPoint: "expo-router/entry",
    })).rejects.toThrow(/capture entry already exists/i);
    await expect(
      readFile(join(projectRoot, ".memi-capture-entry.js"), "utf8"),
    ).resolves.toBe("project owned\n");
  });

  it("rejects file dependencies that escape the managed project", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-metro-escape-"));
    const projectRoot = join(root, "managed-project");
    const dependencyRoot = join(root, "source-dependencies");
    await mkdir(projectRoot, { recursive: true });
    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({
        main: "expo-router/entry",
        dependencies: { escaped: "file:../outside" },
      }),
    );
    await writeFile(join(projectRoot, "metro.config.js"), "module.exports = {};\n");

    await expect(
      prepareManagedMetroBridge({
        projectRoot,
        dependencyRoot,
        entryPoint: "expo-router/entry",
      }),
    ).rejects.toThrow(/file dependency escaped/i);
    await expect(readFile(join(projectRoot, "package.json"), "utf8"))
      .resolves.toContain('"expo-router/entry"');
  });
});
