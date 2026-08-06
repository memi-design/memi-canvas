import { execFile as execFileCallback } from "node:child_process";
import {
  access,
  lstat,
  symlink,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { prepareRepositoryCapture } from "./index.js";
import { REPOSITORY_GIT_POLICY } from "./git.js";
import { createNodeRepositoryPorts } from "./node.js";
import {
  createRepositoryGitSandboxProfile,
  resolveTrustedAppleGitAuthority,
} from "./node-process.js";

const execFile = promisify(execFileCallback);
const temporaryRoots: string[] = [];

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFile("git", [...args], {
    cwd,
    encoding: "utf8",
  });
  return result.stdout;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (path) => {
      if (!path.startsWith(tmpdir())) {
        throw new Error("Refusing to clean a non-temporary integration root.");
      }
      await rm(path, { force: true, recursive: true });
    }),
  );
});

describe("Node repository ports", () => {
  it.skipIf(process.platform !== "darwin")(
    "executes a fixed direct Apple Git through the sandbox without the xcode-select shim",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "memi-capture-repository-"));
      temporaryRoots.push(root);
      const source = join(root, "source");
      const managed = join(root, "managed");
      await mkdir(source);
      await mkdir(managed);
      await writeFile(join(source, "README.md"), "fixture\n");
      await git(source, ["init"]);
      await git(source, ["config", "user.email", "capture@example.invalid"]);
      await git(source, ["config", "user.name", "Capture Test"]);
      await git(source, ["add", "."]);
      await git(source, ["commit", "-m", "fixture"]);

      const authority = await resolveTrustedAppleGitAuthority();
      const result = await createNodeRepositoryPorts({
        managedRoot: managed,
      }).process.runGit({
        access: "source-read-only",
        args: ["rev-parse", "HEAD"],
        cwd: source,
        executable: "git",
        policy: REPOSITORY_GIT_POLICY,
        signal: new AbortController().signal,
      });

      expect(authority.executable).not.toBe("/usr/bin/git");
      expect(authority.executable).toMatch(
        /^(?:\/Library\/Developer\/CommandLineTools\/usr\/bin\/git|\/Applications\/Xcode(?:_[0-9.]+(?:_[A-Za-z0-9.-]+)?)?\.app\/Contents\/Developer\/usr\/bin\/git)$/,
      );
      expect(authority.gitCorePath).toContain("/usr/libexec/git-core");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toHaveLength(40);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "denies host reads outside the checkout and managed root while rev-parse still succeeds",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "memi-capture-repository-"));
      temporaryRoots.push(root);
      const source = join(root, "source");
      const managed = join(root, "managed");
      const hostOnlyFile = join(root, "host-only-secret.txt");
      await mkdir(source);
      await mkdir(managed);
      await writeFile(join(source, "README.md"), "fixture\n");
      await writeFile(hostOnlyFile, "must-not-be-readable\n");
      await git(source, ["init"]);
      await git(source, ["config", "user.email", "capture@example.invalid"]);
      await git(source, ["config", "user.name", "Capture Test"]);
      await git(source, ["add", "."]);
      await git(source, ["commit", "-m", "fixture"]);

      const authority = await resolveTrustedAppleGitAuthority();
      const profile = createRepositoryGitSandboxProfile({
        authority,
        managedRoot: managed,
        sourceRoot: source,
      });
      // Reuse the production read rules but substitute the executable solely
      // for this proof: cat is allowed to start and must still be denied the
      // host-only path by the sandbox's file-read policy.
      const catProfile = profile.replace(
        `(allow process-exec (literal "${authority.executable}"))`,
        '(allow process-exec (literal "/bin/cat"))',
      );

      await expect(
        execFile("/usr/bin/sandbox-exec", ["-p", catProfile, "/bin/cat", hostOnlyFile], {
          encoding: "utf8",
        }),
      ).rejects.toMatchObject({
        stderr: expect.not.stringContaining("must-not-be-readable"),
      });

      const result = await createNodeRepositoryPorts({
        managedRoot: managed,
      }).process.runGit({
        access: "source-read-only",
        args: ["rev-parse", "HEAD"],
        cwd: source,
        executable: "git",
        policy: REPOSITORY_GIT_POLICY,
        signal: new AbortController().signal,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toHaveLength(40);
    },
  );

  it("creates a contained clone while leaving the source checkout byte-identical", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-capture-repository-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    const managed = join(root, "managed");
    await mkdir(join(source, "app"), { recursive: true });
    await mkdir(managed);
    await writeFile(
      join(source, "package.json"),
      JSON.stringify({
        name: "fixture",
        main: "expo-router/entry",
        scripts: { start: "expo start --go" },
        dependencies: { expo: "53", "expo-router": "5", react: "19" },
      }),
    );
    await writeFile(
      join(source, "app.json"),
      JSON.stringify({
        expo: {
          ios: { bundleIdentifier: "design.memi.capture.integration" },
          scheme: "memi-capture-integration",
        },
      }),
    );
    await writeFile(
      join(source, "app", "index.tsx"),
      "export default function Home() { return null }\n",
    );
    await writeFile(join(source, ".gitignore"), ".env.local\n");
    await git(source, ["init"]);
    await git(source, ["config", "user.email", "capture@example.invalid"]);
    await git(source, ["config", "user.name", "Capture Test"]);
    await git(source, ["add", "."]);
    await git(source, ["commit", "-m", "fixture"]);
    await writeFile(join(source, ".env.local"), "PRIVATE_FIXTURE=excluded\n");
    const sourcePackageBefore = await readFile(
      join(source, "package.json"),
      "utf8",
    );
    const privateMetadataBefore = await lstat(join(source, ".env.local"));
    const sourceStatusBefore = await git(source, ["status", "--porcelain=v1"]);

    const result = await prepareRepositoryCapture({
      captureId: "fixture-capture",
      managedRoot: managed,
      ports: createNodeRepositoryPorts({ managedRoot: managed }),
      signal: new AbortController().signal,
      sourceRoot: source,
    });

    expect(result.applications[0]?.platform).toBe("expo-ios");
    expect(
      await readFile(join(result.managedCopy.rootPath, "app", "index.tsx"), "utf8"),
    ).toContain("function Home");
    expect(await readFile(join(source, "package.json"), "utf8")).toBe(
      sourcePackageBefore,
    );
    expect(await git(source, ["status", "--porcelain=v1"])).toBe(
      sourceStatusBefore,
    );
    const privateMetadataAfter = await lstat(join(source, ".env.local"));
    expect({
      mode: privateMetadataAfter.mode,
      size: privateMetadataAfter.size,
    }).toEqual({
      mode: privateMetadataBefore.mode,
      size: privateMetadataBefore.size,
    });
    expect(result.snapshotExclusions.entries).toContainEqual({
      path: ".env.local",
      reason: "environment-secret",
    });
    await expect(
      access(join(result.managedCopy.rootPath, ".env.local")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects repository symlinks before materializing a managed copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-capture-repository-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    const managed = join(root, "managed");
    await mkdir(join(source, "app"), { recursive: true });
    await mkdir(managed);
    await writeFile(
      join(source, "package.json"),
      JSON.stringify({
        name: "fixture",
        main: "expo-router/entry",
        scripts: { start: "expo start --go" },
        dependencies: { expo: "53", "expo-router": "5", react: "19" },
      }),
    );
    await writeFile(
      join(source, "app.json"),
      JSON.stringify({
        expo: {
          ios: { bundleIdentifier: "design.memi.capture.symlink" },
          scheme: "memi-capture-symlink",
        },
      }),
    );
    await writeFile(join(source, "outside.tsx"), "export default 1\n");
    await writeFile(
      join(source, "app", "index.tsx"),
      "export default function Home() { return null }\n",
    );
    await symlink(
      join(source, "outside.tsx"),
      join(source, "app", "escape.tsx"),
    );
    await git(source, ["init"]);
    await git(source, ["config", "user.email", "capture@example.invalid"]);
    await git(source, ["config", "user.name", "Capture Test"]);
    await git(source, ["add", "."]);
    await git(source, ["commit", "-m", "fixture"]);
    const ports = createNodeRepositoryPorts({ managedRoot: managed });

    await expect(
      ports.process.runGit({
        access: "source-read-only",
        args: ["config", "--get", "user.email"],
        cwd: source,
        executable: "git",
        policy: REPOSITORY_GIT_POLICY,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "git-failed" });
    await expect(
      ports.process.runGit({
        access: "source-read-only",
        args: ["rev-parse", "HEAD"],
        cwd: "relative",
        executable: "git",
        policy: REPOSITORY_GIT_POLICY,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "git-failed" });
    const cancelled = new AbortController();
    cancelled.abort(new DOMException("Stopped", "AbortError"));
    await expect(
      ports.process.runGit({
        access: "source-read-only",
        args: ["rev-parse", "HEAD"],
        cwd: source,
        executable: "git",
        policy: REPOSITORY_GIT_POLICY,
        signal: cancelled.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      prepareRepositoryCapture({
        captureId: "fixture-capture",
        managedRoot: managed,
        ports,
        signal: new AbortController().signal,
        sourceRoot: source,
      }),
    ).rejects.toMatchObject({ code: "symlink-rejected" });
    await expect(
      readFile(join(managed, "fixture-capture", "package.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
