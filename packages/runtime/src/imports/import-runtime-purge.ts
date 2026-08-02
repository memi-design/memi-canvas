import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readlink,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

export interface ImportRuntimePurgeTargets {
  readonly appDataRoot: string;
  readonly artifacts: string;
  readonly captureEvidence: string;
  readonly jobs: string;
  readonly managedWorktrees: string;
  readonly nativeAppStaging: string;
  readonly purgeMarker: string;
  readonly simulatorAuthority: string;
  readonly simulatorDeviceSet: string;
  readonly simulatorOwnedDeviceSet: string;
}

export interface ImportRuntimePurgeAuthority {
  beginPurge(): Promise<void>;
  completePurge(): Promise<void>;
  inspect(): Promise<void>;
  purgeRecoveryPending(): Promise<boolean>;
  purgeArtifacts(): Promise<number>;
  purgeJobRecords(): Promise<number>;
  purgeManagedWorktrees(): Promise<number>;
  purgeSimulatorAuthority(): Promise<number>;
}

const PURGE_MARKER_CONTENT =
  '{"schemaVersion":1,"state":"in-progress"}\n';
const MAX_PURGE_MARKER_BYTES = 128;

interface ImportRuntimePurgeAuthorityOptions {
  readonly appDataRoot: string;
  /** A separately rooted, disposable, Memi-owned native build directory. */
  readonly externalWorktreeRoot?: string;
  readonly artifactStore: {
    purgeUnreferenced(references: readonly never[]): Promise<number>;
  };
  readonly purgeManagedSimulator: (
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly activeJobLocks?: {
    hasActiveJobs(): boolean;
  };
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function assertContained(root: string, candidate: string): void {
  const relationship = relative(root, candidate);
  if (
    relationship === "" ||
    relationship === ".." ||
    relationship.startsWith(`..${sep}`) ||
    isAbsolute(relationship)
  ) {
    throw new Error("Import purge target escapes canonical app data.");
  }
}

async function inspectTarget(
  root: string,
  target: string,
  inspectChildren = false,
  allowedSymlinkTarget?: string,
): Promise<void> {
  assertContained(root, target);
  let current = root;
  for (const segment of relative(root, target).split(sep)) {
    current = join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      if (
        current !== target ||
        allowedSymlinkTarget === undefined
      ) {
        throw new Error(
          "Import purge targets must be canonical directories without symbolic links.",
        );
      }
      assertContained(root, allowedSymlinkTarget);
      const declaredTarget = resolve(
        dirname(current),
        await readlink(current),
      );
      if (declaredTarget !== allowedSymlinkTarget) {
        throw new Error(
          "Import purge diagnostic link does not target the owned simulator device set.",
        );
      }
      const expectedMetadata = await lstat(
        allowedSymlinkTarget,
      ).catch((error: unknown) => {
        if (isMissing(error)) {
          return null;
        }
        throw error;
      });
      if (expectedMetadata === null) {
        return;
      }
      if (
        expectedMetadata.isSymbolicLink() ||
        !expectedMetadata.isDirectory() ||
        (await realpath(allowedSymlinkTarget)) !==
          allowedSymlinkTarget ||
        (await realpath(current)) !== allowedSymlinkTarget
      ) {
        throw new Error(
          "Import purge diagnostic link target is not canonical.",
        );
      }
      return;
    }
    if (!metadata.isDirectory()) {
      throw new Error(
        "Import purge targets must be canonical directories without symbolic links.",
      );
    }
    if ((await realpath(current)) !== current) {
      throw new Error("Import purge target is not canonical.");
    }
  }
  if (!inspectChildren) return;
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error(
        "Managed capture worktrees may not be symbolic links.",
      );
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function inspectPurgeMarker(
  root: string,
  marker: string,
): Promise<boolean> {
  assertContained(root, marker);
  let metadata;
  try {
    metadata = await lstat(marker);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size > MAX_PURGE_MARKER_BYTES ||
    (await realpath(marker)) !== marker
  ) {
    throw new Error(
      "Import purge marker must be a bounded canonical file.",
    );
  }
  if ((await readFile(marker, "utf8")) !== PURGE_MARKER_CONTENT) {
    throw new Error("Import purge marker format is invalid.");
  }
  return true;
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function purgeDirectoryChildren(
  root: string,
  target: string,
): Promise<number> {
  await inspectTarget(root, target, true);
  if (!(await exists(target))) return 0;
  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    await rm(join(target, entry.name), {
      force: true,
      recursive: true,
    });
  }
  await rm(target, { force: true, recursive: true });
  return entries.length;
}

async function inspectExternalDirectory(
  target: string,
  inspectChildren = false,
): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    (await realpath(target)) !== target
  ) {
    throw new Error(
      "External managed worktree root must be a canonical directory without symbolic links.",
    );
  }
  if (!inspectChildren) return;
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error(
        "Managed capture worktrees may not be symbolic links.",
      );
    }
  }
}

async function purgeExternalDirectoryChildren(
  target: string,
): Promise<number> {
  await inspectExternalDirectory(target, true);
  if (!(await exists(target))) return 0;
  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    await rm(join(target, entry.name), {
      force: true,
      recursive: true,
    });
  }
  return entries.length;
}

export async function resolveImportRuntimePurgeTargets(
  appDataRoot: string,
  options: { readonly externalWorktreeRoot?: string } = {},
): Promise<ImportRuntimePurgeTargets> {
  if (
    appDataRoot.includes("\0") ||
    !isAbsolute(appDataRoot) ||
    resolve(appDataRoot) === parse(resolve(appDataRoot)).root
  ) {
    throw new Error(
      "Import purge app-data root must be a bounded absolute directory.",
    );
  }
  const normalized = resolve(appDataRoot);
  const metadata = await lstat(normalized);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(
      "Import purge app-data root must be a real canonical directory.",
    );
  }
  const canonical = await realpath(normalized);
  if (canonical !== normalized) {
    throw new Error("Import purge app-data root must be canonical.");
  }
  let managedWorktrees = join(canonical, "capture-worktrees");
  if (options.externalWorktreeRoot !== undefined) {
    if (
      !isAbsolute(options.externalWorktreeRoot) ||
      resolve(options.externalWorktreeRoot) ===
        parse(resolve(options.externalWorktreeRoot)).root
    ) {
      throw new Error(
        "External managed worktree root must be a bounded absolute directory.",
      );
    }
    const external = resolve(options.externalWorktreeRoot);
    const metadata = await lstat(external);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(
        "External managed worktree root must be a real canonical directory.",
      );
    }
    const canonicalExternal = await realpath(external);
    if (canonicalExternal !== external) {
      throw new Error(
        "External managed worktree root must be canonical.",
      );
    }
    managedWorktrees = canonicalExternal;
  }
  return Object.freeze({
    appDataRoot: canonical,
    artifacts: join(canonical, "capture-artifacts"),
    captureEvidence: join(canonical, "capture-evidence"),
    jobs: join(canonical, "import-jobs"),
    managedWorktrees,
    nativeAppStaging: join(canonical, "native-app-staging"),
    purgeMarker: join(canonical, ".import-purge-v1.json"),
    simulatorAuthority: join(canonical, "capture-simulator"),
    simulatorOwnedDeviceSet: join(
      canonical,
      "capture-simulator",
      "device-set",
    ),
    simulatorDeviceSet: join(
      canonical,
      "sandbox",
      "home",
      "Library",
      "Developer",
      "CoreSimulator",
      "Devices",
    ),
  });
}

export function createImportRuntimePurgeAuthority(
  options: ImportRuntimePurgeAuthorityOptions,
): ImportRuntimePurgeAuthority {
  let inspectedTargets: ImportRuntimePurgeTargets | null = null;
  const worktreeRootOptions =
    options.externalWorktreeRoot === undefined
      ? {}
      : { externalWorktreeRoot: options.externalWorktreeRoot };
  const requireNoActiveJobs = (): void => {
    if (options.activeJobLocks?.hasActiveJobs() === true) {
      throw new Error(
        "Import purge is blocked while an active import job holds storage.",
      );
    }
  };
  const requireInspected = async (): Promise<ImportRuntimePurgeTargets> => {
    if (inspectedTargets === null) {
      throw new Error("Import purge authority requires preflight inspection.");
    }
    const current = await resolveImportRuntimePurgeTargets(
      options.appDataRoot,
      worktreeRootOptions,
    );
    if (JSON.stringify(inspectedTargets) !== JSON.stringify(current)) {
      throw new Error("Import purge authority changed after inspection.");
    }
    return current;
  };
  return Object.freeze({
    async beginPurge() {
      requireNoActiveJobs();
      const target = await requireInspected();
      if (
        await inspectPurgeMarker(
          target.appDataRoot,
          target.purgeMarker,
        )
      ) {
        return;
      }
      const temporaryMarker = join(
        target.appDataRoot,
        `.import-purge-v1-${randomUUID()}.tmp`,
      );
      let handle: Awaited<ReturnType<typeof open>> | null = null;
      try {
        handle = await open(temporaryMarker, "wx", 0o600);
        await handle.writeFile(PURGE_MARKER_CONTENT, "utf8");
        await handle.sync();
        await handle.close();
        handle = null;
        if (
          await inspectPurgeMarker(
            target.appDataRoot,
            target.purgeMarker,
          )
        ) {
          await unlink(temporaryMarker);
          return;
        }
        await rename(temporaryMarker, target.purgeMarker);
        await syncDirectory(target.appDataRoot);
      } catch (error) {
        await handle?.close().catch(() => undefined);
        await unlink(temporaryMarker).catch(
          (cleanupError: unknown) => {
            if (!isMissing(cleanupError)) throw cleanupError;
          },
        );
        throw error;
      }
    },
    async completePurge() {
      const target = await requireInspected();
      if (
        !(await inspectPurgeMarker(
          target.appDataRoot,
          target.purgeMarker,
        ))
      ) {
        throw new Error("Import purge marker is missing.");
      }
      await unlink(target.purgeMarker);
      await syncDirectory(target.appDataRoot);
    },
    async inspect() {
      const target = await resolveImportRuntimePurgeTargets(
        options.appDataRoot,
        worktreeRootOptions,
      );
      await Promise.all([
        inspectTarget(target.appDataRoot, target.artifacts),
        inspectTarget(target.appDataRoot, target.captureEvidence),
        inspectTarget(target.appDataRoot, target.jobs),
        options.externalWorktreeRoot === undefined
          ? inspectTarget(
              target.appDataRoot,
              target.managedWorktrees,
              true,
            )
          : inspectExternalDirectory(target.managedWorktrees, true),
        inspectTarget(target.appDataRoot, target.simulatorAuthority),
        inspectTarget(
          target.appDataRoot,
          target.simulatorDeviceSet,
          false,
          target.simulatorOwnedDeviceSet,
        ),
        inspectTarget(target.appDataRoot, target.nativeAppStaging),
        inspectPurgeMarker(
          target.appDataRoot,
          target.purgeMarker,
        ),
      ]);
      inspectedTargets = target;
    },
    async purgeRecoveryPending() {
      const target = await resolveImportRuntimePurgeTargets(
        options.appDataRoot,
        worktreeRootOptions,
      );
      return inspectPurgeMarker(
        target.appDataRoot,
        target.purgeMarker,
      );
    },
    async purgeArtifacts() {
      requireNoActiveJobs();
      const target = await requireInspected();
      await Promise.all([
        inspectTarget(target.appDataRoot, target.artifacts),
        inspectTarget(target.appDataRoot, target.captureEvidence),
        inspectTarget(target.appDataRoot, target.nativeAppStaging),
      ]);
      const [stored, evidence, staging] = await Promise.all([
        options.artifactStore.purgeUnreferenced([]),
        purgeDirectoryChildren(
          target.appDataRoot,
          target.captureEvidence,
        ),
        purgeDirectoryChildren(
          target.appDataRoot,
          target.nativeAppStaging,
        ),
      ]);
      return stored + evidence + staging;
    },
    async purgeManagedWorktrees() {
      requireNoActiveJobs();
      const target = await requireInspected();
      return options.externalWorktreeRoot === undefined
        ? purgeDirectoryChildren(
            target.appDataRoot,
            target.managedWorktrees,
          )
        : purgeExternalDirectoryChildren(target.managedWorktrees);
    },
    async purgeJobRecords() {
      requireNoActiveJobs();
      const target = await requireInspected();
      return purgeDirectoryChildren(
        target.appDataRoot,
        target.jobs,
      );
    },
    async purgeSimulatorAuthority() {
      requireNoActiveJobs();
      const target = await requireInspected();
      await Promise.all([
        inspectTarget(target.appDataRoot, target.simulatorAuthority),
        inspectTarget(
          target.appDataRoot,
          target.simulatorDeviceSet,
          false,
          target.simulatorOwnedDeviceSet,
        ),
      ]);
      const hadFilesystemAuthority =
        (await exists(target.simulatorAuthority)) ||
        (await exists(target.simulatorDeviceSet));
      const removedDevice = await options.purgeManagedSimulator(
        new AbortController().signal,
      );
      const deviceSetMetadata = await lstat(
        target.simulatorDeviceSet,
      ).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (deviceSetMetadata?.isSymbolicLink() === true) {
        await unlink(target.simulatorDeviceSet);
      } else if (deviceSetMetadata !== null) {
        await rm(target.simulatorDeviceSet, {
          force: true,
          recursive: true,
        });
      }
      await rm(target.simulatorAuthority, {
        force: true,
        recursive: true,
      });
      await Promise.all([
        mkdir(target.simulatorAuthority, {
          recursive: true,
          mode: 0o700,
        }),
        mkdir(target.simulatorDeviceSet, {
          recursive: true,
          mode: 0o700,
        }),
      ]);
      return removedDevice || hadFilesystemAuthority ? 1 : 0;
    },
  });
}
