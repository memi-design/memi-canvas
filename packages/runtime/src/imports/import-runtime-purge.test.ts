import { mkdtempSync, realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createImportRuntimePurgeAuthority,
  resolveImportRuntimePurgeTargets,
} from "./import-runtime-purge.js";

function temporaryDirectory(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

describe("Memi-owned import purge authority", () => {
  it("refuses destructive purge while an import job holds a storage lock", async () => {
    const appDataRoot = temporaryDirectory("memi-import-purge-");
    const hasActiveJobs = vi.fn(() => true);
    const artifactStore = { purgeUnreferenced: vi.fn() };
    const authority = createImportRuntimePurgeAuthority({
      appDataRoot,
      artifactStore,
      purgeManagedSimulator: vi.fn(),
      activeJobLocks: { hasActiveJobs },
    });

    await authority.inspect();
    await expect(authority.beginPurge()).rejects.toThrow(/active import/iu);
    await expect(authority.purgeArtifacts()).rejects.toThrow(/active import/iu);
    expect(artifactStore.purgeUnreferenced).not.toHaveBeenCalled();
  });

  it("resolves only exact owned children of a canonical app-data root", async () => {
    const root = temporaryDirectory("memi-import-purge-");

    await expect(resolveImportRuntimePurgeTargets(root)).resolves.toEqual({
      appDataRoot: root,
      artifacts: join(root, "capture-artifacts"),
      captureEvidence: join(root, "capture-evidence"),
      jobs: join(root, "import-jobs"),
      managedWorktrees: join(root, "capture-worktrees"),
      nativeAppStaging: join(root, "native-app-staging"),
      purgeMarker: join(root, ".import-purge-v1.json"),
      simulatorAuthority: join(root, "capture-simulator"),
      simulatorOwnedDeviceSet: join(
        root,
        "capture-simulator",
        "device-set",
      ),
      simulatorDeviceSet: join(
        root,
        "sandbox",
        "home",
        "Library",
        "Developer",
        "CoreSimulator",
        "Devices",
      ),
    });
    await expect(
      resolveImportRuntimePurgeTargets("relative"),
    ).rejects.toThrow(/absolute|app-data|directory/u);
  });

  it("uses an explicit Memi-owned external worktree root without broadening purge authority", async () => {
    const root = temporaryDirectory("memi-import-purge-");
    const externalWorktreeRoot = temporaryDirectory("memi-capture-worktrees-");

    await expect(
      resolveImportRuntimePurgeTargets(root, { externalWorktreeRoot }),
    ).resolves.toMatchObject({
      appDataRoot: root,
      managedWorktrees: externalWorktreeRoot,
    });
  });

  it("purges managed copies and unreferenced artifacts without touching a source repository", async () => {
    const parent = temporaryDirectory("memi-import-purge-");
    const appDataRoot = join(parent, "app-data");
    const sourceRepository = join(parent, "source-repository");
    const worktree = join(appDataRoot, "capture-worktrees", "capture-1");
    const evidence = join(appDataRoot, "capture-evidence", "launch-1");
    const jobs = join(appDataRoot, "import-jobs");
    const staging = join(appDataRoot, "native-app-staging", "build-1");
    const sourceFile = join(sourceRepository, "important.ts");
    await Promise.all([
      mkdir(worktree, { recursive: true }),
      mkdir(evidence, { recursive: true }),
      mkdir(jobs, { recursive: true }),
      mkdir(staging, { recursive: true }),
      mkdir(sourceRepository, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(worktree, ".git"), `gitdir: ${sourceRepository}/.git`),
      writeFile(join(worktree, "copy.ts"), "managed copy"),
      writeFile(join(evidence, "hierarchy.json"), "{}"),
      writeFile(join(jobs, "legacy-job.json"), "{}"),
      writeFile(join(staging, "Product.app"), "staged"),
      writeFile(sourceFile, "source truth"),
    ]);
    const artifactStore = {
      purgeUnreferenced: vi.fn(async (references: readonly unknown[]) => {
        expect(references).toEqual([]);
        return 2;
      }),
    };
    const purgeManagedSimulator = vi.fn(async () => false);
    const authority = createImportRuntimePurgeAuthority({
      appDataRoot,
      artifactStore,
      purgeManagedSimulator,
    });

    await authority.inspect();
    await expect(authority.purgeManagedWorktrees()).resolves.toBe(1);
    await expect(authority.purgeArtifacts()).resolves.toBe(4);
    await expect(authority.purgeJobRecords()).resolves.toBe(1);
    await expect(readFile(sourceFile, "utf8")).resolves.toBe("source truth");
    await expect(lstat(worktree)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(evidence)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(jobs)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(staging)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("purges only the configured external managed worktree root", async () => {
    const parent = temporaryDirectory("memi-import-purge-");
    const appDataRoot = join(parent, "app-data");
    const externalWorktreeRoot = temporaryDirectory("memi-capture-worktrees-");
    const sourceRepository = join(parent, "source-repository");
    const worktree = join(externalWorktreeRoot, "capture-1");
    const sourceFile = join(sourceRepository, "important.ts");
    await Promise.all([
      mkdir(appDataRoot, { recursive: true }),
      mkdir(worktree, { recursive: true }),
      mkdir(sourceRepository, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(worktree, "copy.ts"), "managed copy"),
      writeFile(sourceFile, "source truth"),
    ]);
    const authority = createImportRuntimePurgeAuthority({
      appDataRoot,
      externalWorktreeRoot,
      artifactStore: { purgeUnreferenced: vi.fn(async () => 0) },
      purgeManagedSimulator: vi.fn(async () => false),
    });

    await authority.inspect();
    await expect(authority.purgeManagedWorktrees()).resolves.toBe(1);
    await expect(lstat(worktree)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(sourceFile, "utf8")).resolves.toBe("source truth");
  });

  it("fails preflight before deletion when an owned target is a symlink", async () => {
    const parent = temporaryDirectory("memi-import-purge-");
    const appDataRoot = join(parent, "app-data");
    const sourceRepository = join(parent, "source-repository");
    await Promise.all([
      mkdir(appDataRoot, { recursive: true }),
      mkdir(sourceRepository, { recursive: true }),
    ]);
    await symlink(
      sourceRepository,
      join(appDataRoot, "capture-worktrees"),
      "dir",
    );
    const purgeManagedSimulator = vi.fn();
    const authority = createImportRuntimePurgeAuthority({
      appDataRoot,
      artifactStore: { purgeUnreferenced: vi.fn() },
      purgeManagedSimulator,
    });

    await expect(authority.inspect()).rejects.toThrow(/symbolic|canonical/u);
    expect(purgeManagedSimulator).not.toHaveBeenCalled();
    await expect(lstat(sourceRepository)).resolves.toMatchObject({});
  });

  it("deletes only the persisted Memi simulator authority after ownership validation", async () => {
    const parent = temporaryDirectory("memi-import-purge-");
    const appDataRoot = join(parent, "app-data");
    const simulatorAuthority = join(appDataRoot, "capture-simulator");
    const simulatorDeviceSet = join(
      appDataRoot,
      "sandbox",
      "home",
      "Library",
      "Developer",
      "CoreSimulator",
      "Devices",
    );
    await Promise.all([
      mkdir(simulatorAuthority, { recursive: true }),
      mkdir(simulatorDeviceSet, { recursive: true }),
    ]);
    await writeFile(
      join(simulatorAuthority, "authority.json"),
      '{"owned":true}',
    );
    const purgeManagedSimulator = vi.fn(async () => true);
    const authority = createImportRuntimePurgeAuthority({
      appDataRoot,
      artifactStore: { purgeUnreferenced: vi.fn() },
      purgeManagedSimulator,
    });

    await authority.inspect();
    await expect(authority.purgeSimulatorAuthority()).resolves.toBe(1);
    expect(purgeManagedSimulator).toHaveBeenCalledTimes(1);
    await expect(readdir(simulatorAuthority)).resolves.toEqual([]);
    await expect(readdir(simulatorDeviceSet)).resolves.toEqual([]);
  });

  it("accepts only the exact diagnostic device-set symlink and unlinks it after native deletion", async () => {
    const parent = temporaryDirectory("memi-import-purge-");
    const appDataRoot = join(parent, "app-data");
    const simulatorAuthority = join(appDataRoot, "capture-simulator");
    const ownedDeviceSet = join(simulatorAuthority, "device-set");
    const simulatorDeviceSet = join(
      appDataRoot,
      "sandbox",
      "home",
      "Library",
      "Developer",
      "CoreSimulator",
      "Devices",
    );
    await Promise.all([
      mkdir(ownedDeviceSet, { recursive: true }),
      mkdir(join(simulatorDeviceSet, ".."), { recursive: true }),
    ]);
    await writeFile(
      join(simulatorAuthority, "authority.json"),
      '{"owned":true}',
    );
    await symlink(ownedDeviceSet, simulatorDeviceSet, "dir");
    const purgeManagedSimulator = vi.fn(async () => {
      expect((await lstat(simulatorDeviceSet)).isSymbolicLink()).toBe(
        true,
      );
      return true;
    });
    const authority = createImportRuntimePurgeAuthority({
      appDataRoot,
      artifactStore: { purgeUnreferenced: vi.fn() },
      purgeManagedSimulator,
    });

    await authority.inspect();
    await expect(authority.purgeSimulatorAuthority()).resolves.toBe(1);
    expect(purgeManagedSimulator).toHaveBeenCalledTimes(1);
    expect((await lstat(simulatorDeviceSet)).isDirectory()).toBe(true);
    expect((await lstat(simulatorDeviceSet)).isSymbolicLink()).toBe(
      false,
    );
    await expect(readdir(simulatorDeviceSet)).resolves.toEqual([]);
    await expect(readdir(simulatorAuthority)).resolves.toEqual([]);
  });

  it("purges a broken exact diagnostic device-set symlink left by a partial prior reset", async () => {
    const parent = temporaryDirectory("memi-import-purge-");
    const appDataRoot = join(parent, "app-data");
    const simulatorAuthority = join(appDataRoot, "capture-simulator");
    const ownedDeviceSet = join(simulatorAuthority, "device-set");
    const simulatorDeviceSet = join(
      appDataRoot,
      "sandbox",
      "home",
      "Library",
      "Developer",
      "CoreSimulator",
      "Devices",
    );
    await Promise.all([
      mkdir(simulatorAuthority, { recursive: true }),
      mkdir(join(simulatorDeviceSet, ".."), { recursive: true }),
    ]);
    await symlink(ownedDeviceSet, simulatorDeviceSet, "dir");
    const purgeManagedSimulator = vi.fn(async () => false);
    const authority = createImportRuntimePurgeAuthority({
      appDataRoot,
      artifactStore: { purgeUnreferenced: vi.fn() },
      purgeManagedSimulator,
    });

    await authority.inspect();
    await expect(authority.purgeSimulatorAuthority()).resolves.toBe(1);
    expect(purgeManagedSimulator).toHaveBeenCalledTimes(1);
    expect((await lstat(simulatorDeviceSet)).isDirectory()).toBe(true);
    expect((await lstat(simulatorDeviceSet)).isSymbolicLink()).toBe(
      false,
    );
    await expect(readdir(simulatorDeviceSet)).resolves.toEqual([]);
    await expect(readdir(simulatorAuthority)).resolves.toEqual([]);
  });

  it("rejects a diagnostic device-set symlink to any non-owned target", async () => {
    const parent = temporaryDirectory("memi-import-purge-");
    const appDataRoot = join(parent, "app-data");
    const externalDeviceSet = join(parent, "external-device-set");
    const simulatorDeviceSet = join(
      appDataRoot,
      "sandbox",
      "home",
      "Library",
      "Developer",
      "CoreSimulator",
      "Devices",
    );
    await Promise.all([
      mkdir(appDataRoot, { recursive: true }),
      mkdir(externalDeviceSet, { recursive: true }),
      mkdir(join(simulatorDeviceSet, ".."), { recursive: true }),
    ]);
    await symlink(externalDeviceSet, simulatorDeviceSet, "dir");
    const purgeManagedSimulator = vi.fn();
    const authority = createImportRuntimePurgeAuthority({
      appDataRoot,
      artifactStore: { purgeUnreferenced: vi.fn() },
      purgeManagedSimulator,
    });

    await expect(authority.inspect()).rejects.toThrow(
      /symbolic|canonical|owned/u,
    );
    expect(purgeManagedSimulator).not.toHaveBeenCalled();
    await expect(lstat(externalDeviceSet)).resolves.toMatchObject({});
  });

  it("persists a strict purge marker across authority restarts and clears it only on completion", async () => {
    const appDataRoot = temporaryDirectory("memi-import-purge-");
    const create = () =>
      createImportRuntimePurgeAuthority({
        appDataRoot,
        artifactStore: { purgeUnreferenced: vi.fn() },
        purgeManagedSimulator: vi.fn(async () => false),
      });
    const first = create();

    await first.inspect();
    await expect(first.purgeRecoveryPending()).resolves.toBe(false);
    await first.beginPurge();
    await expect(first.purgeRecoveryPending()).resolves.toBe(true);
    await expect(
      readFile(join(appDataRoot, ".import-purge-v1.json"), "utf8"),
    ).resolves.toBe(
      '{"schemaVersion":1,"state":"in-progress"}\n',
    );
    await expect(
      readdir(appDataRoot),
    ).resolves.not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\.tmp$/u),
      ]),
    );

    const restarted = create();
    await expect(restarted.purgeRecoveryPending()).resolves.toBe(true);
    await restarted.inspect();
    await restarted.completePurge();
    await expect(restarted.purgeRecoveryPending()).resolves.toBe(false);
  });

  it("rejects a purge marker symlink before destructive work", async () => {
    const parent = temporaryDirectory("memi-import-purge-");
    const appDataRoot = join(parent, "app-data");
    const externalMarker = join(parent, "external-marker.json");
    await mkdir(appDataRoot, { recursive: true });
    await writeFile(
      externalMarker,
      '{"schemaVersion":1,"state":"in-progress"}\n',
    );
    await symlink(
      externalMarker,
      join(appDataRoot, ".import-purge-v1.json"),
    );
    const authority = createImportRuntimePurgeAuthority({
      appDataRoot,
      artifactStore: { purgeUnreferenced: vi.fn() },
      purgeManagedSimulator: vi.fn(),
    });

    await expect(authority.inspect()).rejects.toThrow(
      /marker|symbolic|canonical/u,
    );
    await expect(authority.beginPurge()).rejects.toThrow(
      /inspection/u,
    );
    await expect(readFile(externalMarker, "utf8")).resolves.toContain(
      "in-progress",
    );
  });
});
