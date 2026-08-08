import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
    await mkdir(join(dependencyRoot, "expo-router"), { recursive: true });
    const originalPackage = `${JSON.stringify({
      name: "fixture",
      main: "expo-router/entry",
      dependencies: { "widget-bridge": "file:./modules/widget-bridge" },
    }, null, 2)}\n`;
    await writeFile(join(projectRoot, "package.json"), originalPackage);
    await writeFile(
      join(projectRoot, "metro.config.js"),
      "module.exports = { resolver: { sourceExts: ['js'] } };\n",
    );

    const prepared = await prepareManagedMetroBridge({
      projectRoot,
      dependencyRoot,
      entryPoint: "expo-router/entry",
    });

    const patchedPackage = JSON.parse(
      await readFile(join(projectRoot, "package.json"), "utf8"),
    ) as { readonly main: string };
    expect(patchedPackage.main).toBe(
      ".memi/capture/metro-bridge/MemiCaptureEntry.js",
    );
    await expect(readFile(prepared.entryPath, "utf8")).resolves.toBe(
      'import "expo-router/entry";\n',
    );
    const wrapper = await readFile(prepared.configPath, "utf8");
    expect(prepared.configPath).toBe(managedMetroConfigPath(projectRoot));
    expect(wrapper).toContain(JSON.stringify(dependencyRoot));
    expect(wrapper).toContain(
      JSON.stringify(join(projectRoot, "modules/widget-bridge")),
    );
    expect(wrapper).toContain(JSON.stringify(join(projectRoot, "node_modules")));

    await restoreManagedMetroBridge(prepared);

    await expect(readFile(join(projectRoot, "package.json"), "utf8"))
      .resolves.toBe(originalPackage);
    await expect(lstat(join(projectRoot, ".memi/capture/metro-bridge")))
      .rejects.toMatchObject({ code: "ENOENT" });
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
