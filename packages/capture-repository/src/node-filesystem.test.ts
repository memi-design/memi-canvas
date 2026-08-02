import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
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

describe("Node repository filesystem containment", () => {
  it("fingerprints regular files, ignores generated trees, and rejects snapshot reuse", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-repository-fs-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    const managed = join(root, "managed");
    const target = join(managed, "capture");
    await mkdir(join(source, "nested"), { recursive: true });
    await mkdir(join(source, "node_modules"), { recursive: true });
    await mkdir(managed);
    await writeFile(join(source, "nested", "screen.tsx"), "export default 1");
    await writeFile(join(source, "node_modules", "ignored.js"), "ignored");
    const fileSystem = new NodeRepositoryFileSystem(managed);
    const signal = new AbortController().signal;

    const sourceFingerprint = await fileSystem.fingerprintSourceTree({
      rootPath: source,
      signal,
    });
    const copiedFingerprint = await fileSystem.createManagedSnapshot({
      sourceRoot: source,
      targetRoot: target,
      signal,
    });

    expect(copiedFingerprint).toEqual(sourceFingerprint);
    expect(copiedFingerprint.fileCount).toBe(1);
    expect(await readFile(join(target, "nested", "screen.tsx"), "utf8")).toBe(
      "export default 1",
    );
    await expect(
      fileSystem.createManagedSnapshot({
        sourceRoot: source,
        targetRoot: target,
        signal,
      }),
    ).rejects.toMatchObject({ code: "path-escape" });
  });

  it("rejects contained symlinks instead of granting link authority to a managed snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-repository-fs-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    const managed = join(root, "managed");
    const target = join(managed, "capture");
    await mkdir(join(source, "actual"), { recursive: true });
    await mkdir(managed);
    await writeFile(join(source, "actual", "screen.tsx"), "export default 1");
    await symlink("actual", join(source, "alias"));
    await symlink(
      "actual/screen.tsx",
      join(source, "screen-alias.tsx"),
    );
    const fileSystem = new NodeRepositoryFileSystem(managed);
    const signal = new AbortController().signal;

    await expect(
      fileSystem.fingerprintSourceTree({
        rootPath: source,
        signal,
      }),
    ).rejects.toMatchObject({ code: "symlink-rejected" });
    await expect(
      fileSystem.createManagedSnapshot({
        sourceRoot: source,
        targetRoot: target,
        signal,
      }),
    ).rejects.toMatchObject({ code: "symlink-rejected" });
    expect(await fileSystem.entryKind(target)).toBe("missing");
  });

  it("rejects cycles in the contained directory-link graph", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-repository-fs-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    const managed = join(root, "managed");
    const target = join(managed, "capture");
    await mkdir(join(source, "a"), { recursive: true });
    await mkdir(join(source, "b"), { recursive: true });
    await mkdir(managed);
    await symlink("../b", join(source, "a", "to-b"));
    await symlink("../a", join(source, "b", "to-a"));
    const fileSystem = new NodeRepositoryFileSystem(managed);
    const signal = new AbortController().signal;

    await expect(
      fileSystem.createManagedSnapshot({
        sourceRoot: source,
        targetRoot: target,
        signal,
      }),
    ).rejects.toMatchObject({ code: "symlink-rejected" });
  });

  it("preserves executable mode from the descriptor-bound source file", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-repository-fs-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    const managed = join(root, "managed");
    const target = join(managed, "capture");
    await mkdir(source);
    await mkdir(managed);
    const executable = join(source, "capture.sh");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    const fileSystem = new NodeRepositoryFileSystem(managed);
    await chmod(executable, 0o640);
    const nonExecutable = await fileSystem.fingerprintSourceTree({
      rootPath: source,
      signal: new AbortController().signal,
    });
    await chmod(executable, 0o750);
    const executableFingerprint = await fileSystem.fingerprintSourceTree({
      rootPath: source,
      signal: new AbortController().signal,
    });

    expect(executableFingerprint.contentFingerprint).not.toBe(
      nonExecutable.contentFingerprint,
    );

    await fileSystem.createManagedSnapshot({
      sourceRoot: source,
      targetRoot: target,
      signal: new AbortController().signal,
    });

    expect((await stat(join(target, "capture.sh"))).mode & 0o777).toBe(0o750);
  });

  it("rejects escaping managed symlinks and only removes real contained targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-repository-fs-"));
    temporaryRoots.push(root);
    const managed = join(root, "managed");
    const target = join(managed, "capture");
    const fileTarget = join(managed, "file-target");
    const outside = join(root, "outside");
    await mkdir(join(target, "nested"), { recursive: true });
    await mkdir(outside);
    await writeFile(fileTarget, "not a managed directory");
    await symlink(outside, join(target, "nested", "escape"));
    const fileSystem = new NodeRepositoryFileSystem(managed);
    const signal = new AbortController().signal;

    expect(await fileSystem.entryKind(join(target, "missing"))).toBe("missing");
    expect(await fileSystem.entryKind(target)).toBe("directory");
    expect(await fileSystem.entryKind(fileTarget)).toBe("file");
    expect(await fileSystem.entryKind(join(target, "nested", "escape"))).toBe(
      "symlink",
    );
    await expect(
      fileSystem.assertManagedTreeSafe({ rootPath: target, signal }),
    ).rejects.toMatchObject({ code: "path-escape" });
    await expect(
      fileSystem.removeManagedTree({ rootPath: outside, signal }),
    ).rejects.toMatchObject({ code: "path-escape" });
    await expect(
      fileSystem.removeManagedTree({ rootPath: fileTarget, signal }),
    ).rejects.toMatchObject({ code: "symlink-rejected" });

    await unlink(join(target, "nested", "escape"));
    await fileSystem.assertManagedTreeSafe({ rootPath: target, signal });
    await fileSystem.removeManagedTree({ rootPath: target, signal });
    await fileSystem.removeManagedTree({ rootPath: target, signal });
    expect(await fileSystem.entryKind(target)).toBe("missing");
  });
});
