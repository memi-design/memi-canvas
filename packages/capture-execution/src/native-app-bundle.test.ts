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
import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import { resolveBuiltApplication } from "./native-app-bundle.js";

const binaryInfoPlist =
  "YnBsaXN0MDDRAQJfEBJDRkJ1bmRsZUlkZW50aWZpZXJfEBJkZXNpZ24ubWVtaS5iaW5hcnkICyAAAAAAAAABAQAAAAAAAAADAAAAAAAAAAAAAAAAAAAANQ==";

describe("native application bundle authority", () => {
  it("verifies an exact CFBundleIdentifier from a binary Info.plist", async () => {
    const managedWorktreeRoot = await mkdtemp(
      join(tmpdir(), "memi-native-bundle-"),
    );
    const derivedDataPath = join(managedWorktreeRoot, ".memi/DerivedData");
    const targetBuildDirectory = join(
      derivedDataPath,
      "Build/Products/Debug-iphonesimulator",
    );
    const stagingRoot = join(managedWorktreeRoot, ".memi/staged-apps");
    const appBundlePath = join(targetBuildDirectory, "Fixture.app");
    await mkdir(appBundlePath, { recursive: true });
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(
      join(appBundlePath, "Info.plist"),
      Buffer.from(binaryInfoPlist, "base64"),
    );

    await expect(resolveBuiltApplication({
      managedWorktreeRoot,
      stagingRoot,
      nativeBuild: {
        container: {
          kind: "project",
          path: join(managedWorktreeRoot, "Fixture.xcodeproj"),
        },
        scheme: "Fixture",
        configuration: "Debug",
        derivedDataPath,
        expectedBundleId: "design.memi.binary",
      },
      buildSettingsOutput: new TextEncoder().encode([
        "PRODUCT_BUNDLE_IDENTIFIER = design.memi.binary",
        `TARGET_BUILD_DIR = ${targetBuildDirectory}`,
        "FULL_PRODUCT_NAME = Fixture.app",
      ].join("\n")),
    })).resolves.toEqual({
      appBundlePath: expect.stringMatching(
        /\/staged-apps\/native-app-[^/]+\/Fixture\.app$/u,
      ),
      bundleId: "design.memi.binary",
    });
  });

  it("selects the expected app from multi-target build settings", async () => {
    const managedWorktreeRoot = await mkdtemp(
      join(tmpdir(), "memi-native-multitarget-"),
    );
    const derivedDataPath = join(managedWorktreeRoot, "DerivedData");
    const stagingRoot = join(managedWorktreeRoot, "MemiOwned/staged-apps");
    const targetBuildDirectory = join(
      derivedDataPath,
      "Build/Products/Debug-iphonesimulator",
    );
    const source = join(targetBuildDirectory, "Fixture.app");
    await mkdir(source, { recursive: true });
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(
      join(source, "Info.plist"),
      Buffer.from(binaryInfoPlist, "base64"),
    );

    await expect(resolveBuiltApplication({
      managedWorktreeRoot,
      stagingRoot,
      nativeBuild: {
        container: {
          kind: "project",
          path: join(managedWorktreeRoot, "Fixture.xcodeproj"),
        },
        scheme: "Fixture",
        configuration: "Debug",
        derivedDataPath,
        expectedBundleId: "design.memi.binary",
      },
      buildSettingsOutput: new TextEncoder().encode([
        "Build settings for action build and target FixtureTests:",
        "PRODUCT_BUNDLE_IDENTIFIER = design.memi.binary.tests",
        `TARGET_BUILD_DIR = ${targetBuildDirectory}`,
        "FULL_PRODUCT_NAME = FixtureTests.xctest",
        "Build settings for action build and target Fixture:",
        "PRODUCT_BUNDLE_IDENTIFIER = design.memi.binary",
        `TARGET_BUILD_DIR = ${targetBuildDirectory}`,
        "FULL_PRODUCT_NAME = Fixture.app",
      ].join("\n")),
    })).resolves.toMatchObject({
      appBundlePath: expect.stringMatching(/\/Fixture\.app$/u),
      bundleId: "design.memi.binary",
    });
  });

  it("copies a regular bundle into a sealed staging directory", async () => {
    const managedWorktreeRoot = await mkdtemp(
      join(tmpdir(), "memi-native-stage-"),
    );
    const derivedDataPath = join(managedWorktreeRoot, "DerivedData");
    const stagingRoot = join(managedWorktreeRoot, "MemiOwned/staged-apps");
    const targetBuildDirectory = join(
      derivedDataPath,
      "Build/Products/Debug-iphonesimulator",
    );
    const source = join(targetBuildDirectory, "Fixture.app");
    await mkdir(join(source, "Frameworks"), { recursive: true });
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(
      join(source, "Info.plist"),
      Buffer.from(binaryInfoPlist, "base64"),
    );
    await writeFile(join(source, "Fixture"), "native executable", {
      mode: 0o755,
    });
    await writeFile(join(source, "Frameworks/library.bin"), "library");

    const resolved = await resolveBuiltApplication({
      managedWorktreeRoot,
      stagingRoot,
      nativeBuild: {
        container: {
          kind: "project",
          path: join(managedWorktreeRoot, "Fixture.xcodeproj"),
        },
        scheme: "Fixture",
        configuration: "Debug",
        derivedDataPath,
        expectedBundleId: "design.memi.binary",
      },
      buildSettingsOutput: new TextEncoder().encode([
        "PRODUCT_BUNDLE_IDENTIFIER = design.memi.binary",
        `TARGET_BUILD_DIR = ${targetBuildDirectory}`,
        "FULL_PRODUCT_NAME = Fixture.app",
      ].join("\n")),
    });

    expect(resolved.appBundlePath).not.toBe(await realpath(source));
    expect(
      await readFile(join(resolved.appBundlePath, "Frameworks/library.bin"), "utf8"),
    ).toBe("library");
    expect((await lstat(resolved.appBundlePath)).mode & 0o222).toBe(0);
    expect((await lstat(join(resolved.appBundlePath, "Fixture"))).mode & 0o111)
      .toBeGreaterThan(0);
    await expect(
      writeFile(join(resolved.appBundlePath, "tamper"), "blocked"),
    ).rejects.toBeDefined();
  });

  it.each([
    ["external", "../outside"],
    ["dangling", "missing"],
    ["cyclic", "Loop"],
  ])("rejects %s symbolic links anywhere in the bundle", async (
    _kind,
    destination,
  ) => {
    const managedWorktreeRoot = await mkdtemp(
      join(tmpdir(), "memi-native-tree-"),
    );
    const derivedDataPath = join(managedWorktreeRoot, "DerivedData");
    const stagingRoot = join(managedWorktreeRoot, "MemiOwned/staged-apps");
    const targetBuildDirectory = join(
      derivedDataPath,
      "Build/Products/Debug-iphonesimulator",
    );
    const source = join(targetBuildDirectory, "Fixture.app");
    await mkdir(source, { recursive: true });
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(
      join(source, "Info.plist"),
      Buffer.from(binaryInfoPlist, "base64"),
    );
    await symlink(destination, join(source, "Loop"));

    await expect(resolveBuiltApplication({
      managedWorktreeRoot,
      stagingRoot,
      nativeBuild: {
        container: {
          kind: "project",
          path: join(managedWorktreeRoot, "Fixture.xcodeproj"),
        },
        scheme: "Fixture",
        configuration: "Debug",
        derivedDataPath,
        expectedBundleId: "design.memi.binary",
      },
      buildSettingsOutput: new TextEncoder().encode([
        "PRODUCT_BUNDLE_IDENTIFIER = design.memi.binary",
        `TARGET_BUILD_DIR = ${targetBuildDirectory}`,
        "FULL_PRODUCT_NAME = Fixture.app",
      ].join("\n")),
    })).rejects.toMatchObject({ code: "APP_BUNDLE_TREE_UNTRUSTED" });
  });

  it("rejects sockets and other special entries in the bundle", async () => {
    const managedWorktreeRoot = await mkdtemp(
      "/tmp/memi-native-special-",
    );
    const derivedDataPath = join(managedWorktreeRoot, "DerivedData");
    const stagingRoot = join(managedWorktreeRoot, "MemiOwned/staged-apps");
    const targetBuildDirectory = join(
      derivedDataPath,
      "Build/Products/Debug-iphonesimulator",
    );
    const source = join(targetBuildDirectory, "Fixture.app");
    const socketPath = join(source, "build-writer.sock");
    await mkdir(source, { recursive: true });
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(
      join(source, "Info.plist"),
      Buffer.from(binaryInfoPlist, "base64"),
    );
    const server = createServer();
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolvePromise);
    });
    try {
      await expect(resolveBuiltApplication({
        managedWorktreeRoot,
        stagingRoot,
        nativeBuild: {
          container: {
            kind: "project",
            path: join(managedWorktreeRoot, "Fixture.xcodeproj"),
          },
          scheme: "Fixture",
          configuration: "Debug",
          derivedDataPath,
          expectedBundleId: "design.memi.binary",
        },
        buildSettingsOutput: new TextEncoder().encode([
          "PRODUCT_BUNDLE_IDENTIFIER = design.memi.binary",
          `TARGET_BUILD_DIR = ${targetBuildDirectory}`,
          "FULL_PRODUCT_NAME = Fixture.app",
        ].join("\n")),
      })).rejects.toMatchObject({ code: "APP_BUNDLE_TREE_UNTRUSTED" });
    } finally {
      await new Promise<void>((resolvePromise) =>
        server.close(() => resolvePromise()));
    }
  });
});
