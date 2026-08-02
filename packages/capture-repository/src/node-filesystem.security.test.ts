import { constants } from "node:fs";
import {
  chmod,
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NodeRepositoryFileSystem } from "./node-filesystem.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

async function roots() {
  const root = await mkdtemp(join(tmpdir(), "memi-repository-security-"));
  temporaryRoots.push(root);
  const source = join(root, "source");
  const managed = join(root, "managed");
  const target = join(managed, "capture");
  await mkdir(source);
  await mkdir(managed);
  return {
    fileSystem: new NodeRepositoryFileSystem(managed),
    managed,
    root,
    source,
    target,
  };
}

describe("Node repository snapshot security", () => {
  it("rejects every repository symlink before copying its metadata or target", async () => {
    const state = await roots();
    const outside = join(state.root, "outside-private.txt");
    const link = join(state.source, "external");
    await writeFile(outside, "outside fixture");
    await symlink("../outside-private.txt", link);
    await chmod(outside, 0o000);
    const signal = new AbortController().signal;

    await expect(
      state.fileSystem.fingerprintSourceTree({
        rootPath: state.source,
        signal,
      }),
    ).rejects.toMatchObject({ code: "symlink-rejected" });
    await expect(
      state.fileSystem.createManagedSnapshot({
        sourceRoot: state.source,
        targetRoot: state.target,
        signal,
      }),
    ).rejects.toMatchObject({ code: "symlink-rejected" });
    await expect(access(state.target)).rejects.toMatchObject({ code: "ENOENT" });
    await chmod(outside, 0o600);
    expect(await readlink(link)).toBe("../outside-private.txt");
  });

  it("does not resolve a symlink that is excluded from the snapshot", async () => {
    const state = await roots();
    const outside = join(state.root, "outside-private.txt");
    await writeFile(outside, "outside fixture");
    await symlink("../outside-private.txt", join(state.source, ".env.local"));

    const fingerprint = await state.fileSystem.createManagedSnapshot({
      sourceRoot: state.source,
      targetRoot: state.target,
      signal: new AbortController().signal,
    });

    expect(fingerprint.exclusionManifest.entries).toContainEqual({
      path: ".env.local",
      reason: "environment-secret",
    });
    await expect(access(join(state.target, ".env.local"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readlink(join(state.source, ".env.local"))).toBe(
      "../outside-private.txt",
    );
  });

  it("skips installed dependency symlinks without resolving their targets", async () => {
    const state = await roots();
    const outside = join(state.root, "outside-private.txt");
    await writeFile(outside, "outside fixture");
    await mkdir(join(state.source, "node_modules", ".bin"), {
      recursive: true,
    });
    await symlink(
      "../../../outside-private.txt",
      join(state.source, "node_modules", ".bin", "tool"),
    );

    const fingerprint = await state.fileSystem.createManagedSnapshot({
      sourceRoot: state.source,
      targetRoot: state.target,
      signal: new AbortController().signal,
    });

    expect(fingerprint.exclusionManifest.entries).toContainEqual({
      path: "node_modules",
      reason: "generated-directory",
    });
    await expect(access(join(state.target, "node_modules"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("skips local agent configuration without resolving its links", async () => {
    const state = await roots();
    const outside = join(state.root, "outside-private.txt");
    await writeFile(outside, "outside fixture");
    await mkdir(join(state.source, ".claude", "skills"), {
      recursive: true,
    });
    await symlink(
      "../../../outside-private.txt",
      join(state.source, ".claude", "skills", "local-skill"),
    );

    const fingerprint = await state.fileSystem.createManagedSnapshot({
      sourceRoot: state.source,
      targetRoot: state.target,
      signal: new AbortController().signal,
    });

    expect(fingerprint.exclusionManifest.entries).toContainEqual({
      path: ".claude",
      reason: "private-directory",
    });
    await expect(access(join(state.target, ".claude"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("excludes private material and generated output while retaining required manifests and environment templates", async () => {
    const state = await roots();
    await mkdir(join(state.source, "apps", "mobile", "config", "Secrets"), {
      recursive: true,
    });
    await mkdir(join(state.source, ".ssh"), { recursive: true });
    await mkdir(join(state.source, "signing"), { recursive: true });
    await mkdir(join(state.source, "config"), { recursive: true });
    await mkdir(join(state.source, "node_modules", "fixture"), {
      recursive: true,
    });
    await mkdir(join(state.source, "ios", "Pods", "Fixture"), {
      recursive: true,
    });
    await mkdir(join(state.source, "ios", "build"), { recursive: true });
    await writeFile(join(state.source, "package.json"), "{\"name\":\"fixture\"}");
    await writeFile(join(state.source, "package-lock.json"), "{\"lockfileVersion\":3}");
    await writeFile(join(state.source, "app.json"), "{\"expo\":{}}");
    await writeFile(join(state.source, "ios", "Podfile.lock"), "PODS:");
    await writeFile(join(state.source, ".env.local"), "PRIVATE_FIXTURE=excluded");
    await writeFile(join(state.source, ".npmrc"), "registry-auth=excluded");
    await writeFile(
      join(state.source, "apps", "mobile", ".env.production"),
      "PRIVATE_FIXTURE=excluded",
    );
    await writeFile(
      join(state.source, "apps", "mobile", "config", "Secrets", "credentials.json"),
      "{}",
    );
    await writeFile(join(state.source, ".ssh", "id_ed25519"), "private fixture");
    await writeFile(join(state.source, "config", "credentials.json"), "{}");
    await writeFile(join(state.source, "signing", "distribution.p12"), "fixture");
    await writeFile(
      join(state.source, "node_modules", "fixture", "index.js"),
      "generated",
    );
    await writeFile(join(state.source, "ios", "Pods", "Fixture", "pod.m"), "generated");
    await writeFile(join(state.source, "ios", "build", "Fixture.app"), "generated");
    await writeFile(
      join(state.source, ".env.example"),
      "PUBLIC_API_ORIGIN=https://example.invalid",
    );
    await writeFile(
      join(state.source, "apps", "mobile", ".env.local.template"),
      "PUBLIC_API_ORIGIN=",
    );

    const signal = new AbortController().signal;
    const fingerprint = await state.fileSystem.fingerprintSourceTree({
      rootPath: state.source,
      signal,
    });
    const copied = await state.fileSystem.createManagedSnapshot({
      sourceRoot: state.source,
      targetRoot: state.target,
      signal,
    });

    expect(copied).toEqual(fingerprint);
    expect(copied.exclusionManifest).toEqual({
      entries: [
        { path: ".env.local", reason: "environment-secret" },
        { path: ".npmrc", reason: "credential-file" },
        { path: ".ssh", reason: "private-directory" },
        {
          path: "apps/mobile/.env.production",
          reason: "environment-secret",
        },
        {
          path: "apps/mobile/config/Secrets",
          reason: "private-directory",
        },
        { path: "config/credentials.json", reason: "credential-file" },
        { path: "ios/build", reason: "generated-directory" },
        { path: "ios/Pods", reason: "generated-directory" },
        { path: "node_modules", reason: "generated-directory" },
        { path: "signing/distribution.p12", reason: "signing-artifact" },
      ],
      fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      policyFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      schemaVersion: 1,
    });
    await expect(access(join(state.target, ".env.local"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(state.target, ".ssh"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      access(join(state.target, "apps", "mobile", "config", "Secrets")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(state.target, "signing", "distribution.p12"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(state.target, "package.json"), "utf8")).toBe(
      "{\"name\":\"fixture\"}",
    );
    expect(await readFile(join(state.target, "package-lock.json"), "utf8")).toBe(
      "{\"lockfileVersion\":3}",
    );
    expect(await readFile(join(state.target, "ios", "Podfile.lock"), "utf8")).toBe(
      "PODS:",
    );
    expect(await readFile(join(state.target, ".env.example"), "utf8")).toBe(
      "PUBLIC_API_ORIGIN=https://example.invalid",
    );
    expect(
      await readFile(
        join(state.target, "apps", "mobile", ".env.local.template"),
        "utf8",
      ),
    ).toBe("PUBLIC_API_ORIGIN=");
  });

  it("does not bind excluded file contents into either snapshot fingerprint", async () => {
    const state = await roots();
    await writeFile(join(state.source, "package.json"), "{\"name\":\"fixture\"}");
    await writeFile(join(state.source, ".env.local"), "PRIVATE_FIXTURE=first");
    const signal = new AbortController().signal;
    const first = await state.fileSystem.fingerprintSourceTree({
      rootPath: state.source,
      signal,
    });

    await writeFile(join(state.source, ".env.local"), "PRIVATE_FIXTURE=second");
    const second = await state.fileSystem.fingerprintSourceTree({
      rootPath: state.source,
      signal,
    });

    expect(second).toEqual(first);
  });

  it("fails closed on control and bidirectional characters in repository names", async () => {
    const state = await roots();
    await writeFile(join(state.source, "screen\n.env.example"), "fixture");

    await expect(
      state.fileSystem.createManagedSnapshot({
        sourceRoot: state.source,
        targetRoot: state.target,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "path-escape" });
    await expect(access(state.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps inventory reads descriptor-bound and refuses symlinks", async () => {
    const state = await roots();
    const outside = join(state.root, "outside-inventory.json");
    const link = join(state.source, "package.json");
    await writeFile(outside, "{\"secret\":true}");
    await symlink("../outside-inventory.json", link);

    await expect(state.fileSystem.readFile(link)).rejects.toMatchObject({
      code: "symlink-rejected",
    });
  });

  it("rejects a directory-symlink graph cycle before execution", async () => {
    const state = await roots();
    await mkdir(join(state.source, "a"));
    await mkdir(join(state.source, "b"));
    await symlink("../b", join(state.source, "a", "to-b"));
    await symlink("../a", join(state.source, "b", "to-a"));
    const signal = new AbortController().signal;

    await expect(
      state.fileSystem.createManagedSnapshot({
        sourceRoot: state.source,
        targetRoot: state.target,
        signal,
      }),
    ).rejects.toMatchObject({ code: "symlink-rejected" });
    await expect(access(state.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves safe executable authority without mutating the source", async () => {
    const state = await roots();
    const sourceScript = join(state.source, "capture-tool");
    await writeFile(sourceScript, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await chmod(sourceScript, 0o755);
    const before = await lstat(sourceScript);
    const sourceBytes = await readFile(sourceScript);

    await state.fileSystem.createManagedSnapshot({
      sourceRoot: state.source,
      targetRoot: state.target,
      signal: new AbortController().signal,
    });

    const after = await lstat(sourceScript);
    const copied = await lstat(join(state.target, "capture-tool"));
    expect(after.mode & 0o777).toBe(before.mode & 0o777);
    expect(await readFile(sourceScript)).toEqual(sourceBytes);
    expect(copied.mode & constants.S_IXUSR).toBe(constants.S_IXUSR);
  });

  it("includes executable mode in the source fingerprint", async () => {
    const state = await roots();
    const sourceScript = join(state.source, "capture-tool");
    await writeFile(sourceScript, "#!/bin/sh\nexit 0\n", { mode: 0o600 });
    await chmod(sourceScript, 0o600);
    const signal = new AbortController().signal;
    const nonExecutable = await state.fileSystem.fingerprintSourceTree({
      rootPath: state.source,
      signal,
    });

    await chmod(sourceScript, 0o700);
    const executable = await state.fileSystem.fingerprintSourceTree({
      rootPath: state.source,
      signal,
    });

    expect(executable.contentFingerprint).not.toBe(
      nonExecutable.contentFingerprint,
    );
  });

  it("rejects socket entries without reading or copying them", async () => {
    const state = await roots();
    const socketPath = join(state.source, "capture.sock");
    const server = createServer();
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolvePromise);
    });
    try {
      await expect(
        state.fileSystem.fingerprintSourceTree({
          rootPath: state.source,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: "symlink-rejected" });
      expect(await state.fileSystem.entryKind(state.target)).toBe("missing");
    } finally {
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
      });
    }
  });
});
