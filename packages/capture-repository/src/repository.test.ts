import { describe, expect, it } from "vitest";

import {
  RepositoryBoundaryError,
  prepareRepositoryCapture,
} from "./index.js";
import {
  baseEntries,
  gitPort,
  MemoryFileSystem,
  prepare,
  ScriptedGit,
} from "./repository-test-support.js";

describe("repository capture boundary", () => {
  it("rejects relative and filesystem-root source paths before Git runs", async () => {
    const process = gitPort();
    const fileSystem = new MemoryFileSystem(baseEntries());
    for (const sourceRoot of ["source", "/"]) {
      await expect(
        prepareRepositoryCapture({
          captureId: "capture-1",
          managedRoot: "/managed",
          sourceRoot,
          ports: { fileSystem, process },
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: "invalid-source-root" });
    }
    expect(process.calls).toEqual([]);
  });

  it("rejects overlapping storage, existing targets, and unsafe budgets", async () => {
    const process = gitPort();
    await expect(
      prepareRepositoryCapture({
        captureId: "capture-1",
        managedRoot: "/source/managed",
        sourceRoot: "/source",
        ports: {
          fileSystem: new MemoryFileSystem({
            ...baseEntries(),
            "/source/managed": { kind: "directory" },
          }),
          process,
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "managed-root-overlap" });
    await expect(
      prepare({
        fileSystem: new MemoryFileSystem({
          ...baseEntries(),
          "/managed/capture-1": { kind: "directory" },
        }),
        process,
      }),
    ).rejects.toMatchObject({ code: "managed-target-exists" });
    await expect(
      prepareRepositoryCapture({
        budgets: { maxEntries: 0 },
        captureId: "capture-1",
        managedRoot: "/managed",
        sourceRoot: "/source",
        ports: {
          fileSystem: new MemoryFileSystem(baseEntries()),
          process: gitPort(),
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "budget-exceeded" });
    await expect(
      prepareRepositoryCapture({
        budgets: { maxEntries: 4_097 },
        captureId: "capture-1",
        managedRoot: "/managed",
        sourceRoot: "/source",
        ports: {
          fileSystem: new MemoryFileSystem(baseEntries()),
          process: gitPort(),
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "budget-exceeded" });
  });

  it("discovers a mixed Expo and React repository and scopes recipes to the managed clone", async () => {
    const fileSystem = new MemoryFileSystem(baseEntries());
    const process = gitPort();

    const result = await prepare({ fileSystem, process });

    expect(result.source).toMatchObject({
      rootPath: "/source",
      headRevision: "0123456789abcdef0123456789abcdef01234567",
      dirty: false,
    });
    expect(result.managedCopy).toEqual({
      rootPath: "/managed/capture-1",
      revision: "0123456789abcdef0123456789abcdef01234567",
      sourceProtected: true,
      strategy: "filesystem-snapshot",
    });
    expect(result.applications.map(({ platform }) => platform)).toEqual([
      "expo-ios",
      "react-web",
    ]);
    expect(result.applications.map(({ buildRecipe }) => buildRecipe?.cwd)).toEqual([
      "/managed/capture-1/apps/expo",
      "/managed/capture-1/apps/web",
    ]);
    expect(
      result.applications.every(
        ({ recipePlan }) =>
          recipePlan?.recipeHash.startsWith("sha256:") === true &&
          recipePlan.schemaVersion === 2 &&
          recipePlan.snapshotExclusionFingerprint ===
            result.snapshotExclusions.fingerprint &&
          recipePlan.snapshotPolicyFingerprint ===
            result.snapshotExclusions.policyFingerprint,
      ),
    ).toBe(true);
    expect(fileSystem.managedSnapshots).toEqual([
      { sourceRoot: "/source", targetRoot: "/managed/capture-1" },
    ]);
    expect(fileSystem.managedSafetyChecks).toEqual(["/managed/capture-1"]);
    expect(
      process.calls.filter(({ access }) => access === "managed-target-write"),
    ).toHaveLength(0);
    expect(
      process.calls
        .filter(({ access }) => access === "source-read-only")
        .every(({ cwd }) => cwd === "/source"),
    ).toBe(true);
    expect(
      process.calls
        .filter(({ args }) => args[0] === "diff")
        .map(({ args }) => args),
    ).toEqual([
      [
        "diff",
        "--name-status",
        "-z",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "HEAD",
        "--",
      ],
      [
        "diff",
        "--name-status",
        "-z",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "HEAD",
        "--",
      ],
      [
        "diff",
        "--name-status",
        "-z",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "HEAD",
        "--",
      ],
      [
        "diff",
        "--name-status",
        "-z",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "HEAD",
        "--",
      ],
      [
        "diff",
        "--name-status",
        "-z",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "HEAD",
        "--",
      ],
      [
        "diff",
        "--name-status",
        "-z",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "HEAD",
        "--",
      ],
    ]);
  });

  it("maps a repository-root application recipe to the managed target root", async () => {
    const fileSystem = new MemoryFileSystem({
      "/source": { kind: "directory" },
      "/managed": { kind: "directory" },
      "/source/app": { kind: "directory" },
      "/source/app/index.tsx": {
        kind: "file",
        content: "export default function Home() { return null }",
      },
      "/source/app.json": {
        kind: "file",
        content: JSON.stringify({
          expo: {
            ios: { bundleIdentifier: "design.memi.capture.root-fixture" },
            scheme: "memi-capture-root-fixture",
          },
        }),
      },
      "/source/package.json": {
        kind: "file",
        content: JSON.stringify({
          name: "root-mobile",
          main: "expo-router/entry",
          scripts: { start: "expo start --go" },
          dependencies: { expo: "53", "expo-router": "5", react: "19" },
        }),
      },
    });

    const result = await prepare({ fileSystem });

    expect(result.applications[0]?.buildRecipe?.cwd).toBe(
      "/managed/capture-1",
    );
  });

  it("ignores symlinks during deterministic source inventory", async () => {
    const fileSystem = new MemoryFileSystem(
      baseEntries({
        "/source/apps/web/src/escape.tsx": {
          kind: "symlink",
          target: "/outside/secret.tsx",
        },
      }),
    );
    const process = gitPort();

    const result = await prepare({ fileSystem, process });

    expect(result.applications).toHaveLength(2);
    expect(fileSystem.managedSnapshots).toEqual([
      { sourceRoot: "/source", targetRoot: "/managed/capture-1" },
    ]);
  });

  it("rejects unknown applications before managed-copy creation", async () => {
    const fileSystem = new MemoryFileSystem({
      "/source": { kind: "directory" },
      "/managed": { kind: "directory" },
      "/source/package.json": {
        kind: "file",
        content: JSON.stringify({
          name: "api",
          scripts: { start: "node server.js" },
        }),
      },
    });
    const process = gitPort();

    await expect(prepare({ fileSystem, process })).rejects.toMatchObject({
      code: "unsupported-application",
    });

    expect(
      process.calls.some(({ access }) => access === "managed-target-write"),
    ).toBe(false);
  });

  it("stops on cancellation before a managed write", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Stopped", "AbortError"));
    const fileSystem = new MemoryFileSystem(baseEntries());
    const process = gitPort();

    await expect(
      prepare({ fileSystem, process, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(process.calls).toEqual([]);
    expect(fileSystem.managedSnapshots).toEqual([]);
  });

  it("changes cache identity when the read-only dirty snapshot changes", async () => {
    const clean = await prepare();
    const dirty = await prepare({
      process: gitPort({
        status: " M apps/web/src/pages/index.tsx\u0000",
        diff: "diff --git a/apps/web/src/pages/index.tsx b/apps/web/src/pages/index.tsx",
      }),
    });

    expect(clean.source.dirty).toBe(false);
    expect(dirty.source.dirty).toBe(true);
    expect(dirty.source.dirtyFingerprint).not.toBe(
      clean.source.dirtyFingerprint,
    );
    expect(dirty.cacheFingerprint).not.toBe(clean.cacheFingerprint);
  });

  it("removes the managed target when source authority changes during cloning", async () => {
    let statusCalls = 0;
    const process = new ScriptedGit((request) => {
      const args = request.args.join(" ");
      if (args === "rev-parse --show-toplevel") {
        return { exitCode: 0, stdout: "/source\n" };
      }
      if (args === "rev-parse HEAD") {
        return {
          exitCode: 0,
          stdout: "0123456789abcdef0123456789abcdef01234567\n",
        };
      }
      if (args.includes("status --porcelain=v1")) {
        statusCalls += 1;
        return {
          exitCode: 0,
          stdout:
            statusCalls >= 3
              ? " M apps/web/src/pages/index.tsx\u0000"
              : "",
        };
      }
      return { exitCode: 0 };
    });
    const fileSystem = new MemoryFileSystem(baseEntries());

    await expect(prepare({ fileSystem, process })).rejects.toMatchObject({
      code: "source-changed",
    });

    expect(fileSystem.managedRemovals).toEqual(["/managed/capture-1"]);
  });

  it("uses immutable results and rejects process-policy violations", async () => {
    const failing = new ScriptedGit(() => ({
      exitCode: 1,
      stderr: "unsafe repository",
    }));
    await expect(prepare({ process: failing })).rejects.toBeInstanceOf(
      RepositoryBoundaryError,
    );

    const result = await prepare();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.applications)).toBe(true);
    expect(() => {
      (result.applications as unknown as unknown[]).push("mutated");
    }).toThrow();
  });
});
