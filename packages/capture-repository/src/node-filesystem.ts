import { createHash } from "node:crypto";
import {
  constants,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  isContained,
  RepositoryBoundaryError,
  throwIfAborted,
} from "./guards.js";
import type {
  RepositoryDirectoryEntry,
  RepositoryEntryKind,
  RepositoryFileSystemPort,
  RepositorySnapshotExclusion,
  RepositorySnapshotExclusionReason,
  RepositoryTreeFingerprint,
} from "./types.js";

const GENERATED_SNAPSHOT_DIRECTORIES = new Set([
  ".build",
  ".cache",
  ".expo",
  ".git",
  ".gradle",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".turbo",
  ".vite",
  "deriveddata",
  "intermediates.noindex",
  "logs",
  "pods",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "xcuserdata",
]);
const PRIVATE_SNAPSHOT_DIRECTORIES = new Set([
  ".claude",
  ".aws",
  ".azure",
  ".credentials",
  ".direnv",
  ".docker",
  ".gnupg",
  ".secrets",
  ".ssh",
  "credentials",
  "secrets",
]);
const CREDENTIAL_FILENAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  "auth.json",
  "credentials.json",
  "credentials.yaml",
  "credentials.yml",
  "service-account-key.json",
  "service-account.json",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
]);
const PRIVATE_KEY_FILENAMES = new Set([
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
]);
const KEY_MATERIAL_EXTENSIONS = new Set([
  ".jks",
  ".key",
  ".keystore",
  ".p8",
  ".pem",
]);
const SIGNING_ARTIFACT_EXTENSIONS = new Set([
  ".cer",
  ".crt",
  ".der",
  ".mobileprovision",
  ".p12",
  ".pfx",
  ".provisionprofile",
]);
const GENERATED_ARTIFACT_EXTENSIONS = new Set([
  ".aab",
  ".apk",
  ".app",
  ".dsym",
  ".ipa",
  ".xcarchive",
]);
const ENVIRONMENT_TEMPLATE_SUFFIXES = new Set([
  "example",
  "sample",
  "template",
]);
const SNAPSHOT_EXCLUSION_POLICY_DESCRIPTOR = Object.freeze({
  credentialFilenames: [...CREDENTIAL_FILENAMES].sort(),
  environmentRule: ".env and .env.* except *.example|*.sample|*.template",
  generatedArtifactExtensions: [...GENERATED_ARTIFACT_EXTENSIONS].sort(),
  generatedDirectories: [...GENERATED_SNAPSHOT_DIRECTORIES].sort(),
  keyMaterialExtensions: [...KEY_MATERIAL_EXTENSIONS].sort(),
  privateDirectories: [...PRIVATE_SNAPSHOT_DIRECTORIES].sort(),
  privateKeyFilenames: [...PRIVATE_KEY_FILENAMES].sort(),
  signingArtifactExtensions: [...SIGNING_ARTIFACT_EXTENSIONS].sort(),
  symlinkRule: "reject-nonexcluded",
  unsafeNameRule: "reject-control-bidi-separator-dot-segments",
  version: 1,
});
const MAX_SNAPSHOT_FILES = 100_000;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024 * 1024;

function sha256Json(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

const SNAPSHOT_POLICY_FINGERPRINT = sha256Json(
  SNAPSHOT_EXCLUSION_POLICY_DESCRIPTOR,
);

function assertSafeSnapshotEntryName(name: string): void {
  const containsUnsafeCodePoint = [...name].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 31 ||
      codePoint === 127 ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    containsUnsafeCodePoint
  ) {
    throw new RepositoryBoundaryError(
      "path-escape",
      "Repository snapshot contains an unsafe entry name.",
    );
  }
}

function extensionOf(name: string): string {
  const marker = name.lastIndexOf(".");
  return marker <= 0 ? "" : name.slice(marker).toLowerCase();
}

function isEnvironmentTemplate(name: string): boolean {
  const suffix = name.toLowerCase().split(".").at(-1) ?? "";
  return ENVIRONMENT_TEMPLATE_SUFFIXES.has(suffix);
}

function exclusionReason(input: {
  readonly isDirectory: boolean;
  readonly name: string;
  readonly relativePath: string;
}): RepositorySnapshotExclusionReason | null {
  const lowerName = input.name.toLowerCase();
  const lowerPath = input.relativePath.toLowerCase();
  if (input.isDirectory) {
    if (GENERATED_SNAPSHOT_DIRECTORIES.has(lowerName)) {
      return "generated-directory";
    }
    if (PRIVATE_SNAPSHOT_DIRECTORIES.has(lowerName)) {
      return "private-directory";
    }
    if (
      lowerPath === ".config/gcloud" ||
      lowerPath.endsWith("/.config/gcloud")
    ) {
      return "private-directory";
    }
    if (GENERATED_ARTIFACT_EXTENSIONS.has(extensionOf(lowerName))) {
      return "generated-artifact";
    }
    return null;
  }
  if (
    (lowerName === ".env" ||
      lowerName === ".envrc" ||
      lowerName.startsWith(".env.")) &&
    !isEnvironmentTemplate(lowerName)
  ) {
    return "environment-secret";
  }
  if (CREDENTIAL_FILENAMES.has(lowerName)) {
    return "credential-file";
  }
  if (
    PRIVATE_KEY_FILENAMES.has(lowerName) ||
    KEY_MATERIAL_EXTENSIONS.has(extensionOf(lowerName))
  ) {
    return "key-material";
  }
  if (SIGNING_ARTIFACT_EXTENSIONS.has(extensionOf(lowerName))) {
    return "signing-artifact";
  }
  if (GENERATED_ARTIFACT_EXTENSIONS.has(extensionOf(lowerName))) {
    return "generated-artifact";
  }
  return null;
}

async function nodeEntryKind(path: string): Promise<RepositoryEntryKind> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) return "symlink";
    if (metadata.isDirectory()) return "directory";
    if (metadata.isFile()) return "file";
    return "symlink";
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return "missing";
    }
    throw error;
  }
}

async function canonicalManagedRoot(
  configuredManagedRoot: string,
  requestedRoot: string,
): Promise<string> {
  const managedRoot = await realpath(configuredManagedRoot);
  const rootPath = await realpath(requestedRoot);
  if (!isContained(managedRoot, rootPath)) {
    throw new RepositoryBoundaryError(
      "path-escape",
      "Managed operation is outside configured capture storage.",
    );
  }
  return rootPath;
}

async function canonicalManagedTarget(
  configuredManagedRoot: string,
  requestedTarget: string,
): Promise<{
  readonly managedRoot: string;
  readonly target: string;
}> {
  const configured = resolve(configuredManagedRoot);
  const managedRoot = await realpath(configured);
  const requested = resolve(requestedTarget);
  const local = isContained(configured, requested)
    ? relative(configured, requested)
    : isContained(managedRoot, requested)
      ? relative(managedRoot, requested)
      : null;
  if (local === null) {
    throw new RepositoryBoundaryError(
      "path-escape",
      "Managed target escaped configured capture storage.",
    );
  }
  return { managedRoot, target: resolve(managedRoot, local) };
}

async function ensureContainedDirectory(
  rootPath: string,
  targetDirectory: string,
): Promise<void> {
  const local = relative(rootPath, targetDirectory);
  if (local.startsWith("..") || isAbsolute(local)) {
    throw new RepositoryBoundaryError(
      "path-escape",
      "Managed text target escaped its capture root.",
    );
  }
  let cursor = rootPath;
  for (const segment of local.split("/").filter(Boolean)) {
    cursor = resolve(cursor, segment);
    const kind = await nodeEntryKind(cursor);
    if (kind === "missing") {
      await mkdir(cursor);
    } else if (kind !== "directory") {
      throw new RepositoryBoundaryError(
        "symlink-rejected",
        "Managed text target contains a non-directory ancestor.",
      );
    }
    const canonical = await realpath(cursor);
    if (!isContained(rootPath, canonical)) {
      throw new RepositoryBoundaryError(
        "path-escape",
        "Managed text target resolved outside its capture root.",
      );
    }
  }
}

async function assertSafeTree(
  rootPath: string,
  directory: string,
  signal: AbortSignal,
): Promise<void> {
  const active = new Set<string>();
  const validated = new Set<string>();
  const isInsideTree = (candidate: string): boolean =>
    candidate === rootPath || isContained(rootPath, candidate);

  async function visit(candidate: string): Promise<void> {
    throwIfAborted(signal);
    const canonicalDirectory = await realpath(candidate);
    if (!isInsideTree(canonicalDirectory)) {
      throw new RepositoryBoundaryError(
        "path-escape",
        "Managed capture directory escaped its root.",
      );
    }
    if (active.has(canonicalDirectory)) {
      throw new RepositoryBoundaryError(
        "symlink-rejected",
        `Managed capture tree contains a directory-link cycle: ${relative(rootPath, candidate)}`,
      );
    }
    if (validated.has(canonicalDirectory)) return;
    active.add(canonicalDirectory);
    for (const entry of await readdir(canonicalDirectory, {
      withFileTypes: true,
    })) {
      if (canonicalDirectory === rootPath && entry.name === ".git") continue;
      const path = resolve(canonicalDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        let canonical: string;
        try {
          const linkTarget = await readlink(path, "utf8");
          const lexicalTarget = resolve(dirname(path), linkTarget);
          if (!isInsideTree(lexicalTarget)) {
            throw new RepositoryBoundaryError(
              "path-escape",
              `Managed capture link escaped its root: ${relative(rootPath, path)}`,
            );
          }
          canonical = await realpath(path);
        } catch (error) {
          if (error instanceof RepositoryBoundaryError) throw error;
          throw new RepositoryBoundaryError(
            "symlink-rejected",
            `Managed capture tree contains a dangling or cyclic link: ${relative(rootPath, path)}`,
            { cause: error },
          );
        }
        if (!isInsideTree(canonical)) {
          throw new RepositoryBoundaryError(
            "path-escape",
            `Managed capture link escaped its root: ${relative(rootPath, path)}`,
          );
        }
        const target = await lstat(canonical);
        if (target.isDirectory()) {
          await visit(canonical);
        } else if (!target.isFile()) {
          throw new RepositoryBoundaryError(
            "symlink-rejected",
            `Managed capture link targets a non-regular entry: ${relative(rootPath, path)}`,
          );
        }
        continue;
      }
      if (!entry.isDirectory() && !entry.isFile()) {
        throw new RepositoryBoundaryError(
          "symlink-rejected",
          `Managed capture trees reject non-regular entries: ${relative(rootPath, path)}`,
        );
      }
      if (entry.isDirectory()) {
        await visit(path);
      }
    }
    active.delete(canonicalDirectory);
    validated.add(canonicalDirectory);
  }

  await visit(directory);
}

async function readRegularFileNoFollow(path: string): Promise<{
  readonly bytes: Uint8Array;
  readonly mode: number;
}> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
    );
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new RepositoryBoundaryError(
        "symlink-rejected",
        "Repository snapshots only read regular files.",
      );
    }
    return {
      bytes: await handle.readFile(),
      mode: metadata.mode & 0o777,
    };
  } catch (error) {
    if (error instanceof RepositoryBoundaryError) throw error;
    throw new RepositoryBoundaryError(
      "symlink-rejected",
      "Repository snapshot entry changed or became unsafe before it could be read.",
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

async function writeManagedFileNoFollow(
  path: string,
  bytes: Uint8Array,
  mode: number,
): Promise<void> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      mode,
    );
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new RepositoryBoundaryError(
        "symlink-rejected",
        "Managed snapshots only create regular files.",
      );
    }
    await handle.writeFile(bytes);
    await handle.chmod(mode);
  } catch (error) {
    if (error instanceof RepositoryBoundaryError) throw error;
    throw new RepositoryBoundaryError(
      "symlink-rejected",
      "Managed snapshot target changed or became unsafe before it could be written.",
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

async function inspectTree(input: {
  readonly onFile?: (
    sourcePath: string,
    relativePath: string,
    bytes: Uint8Array,
    mode: number,
  ) => Promise<void>;
  readonly rootPath: string;
  readonly signal: AbortSignal;
}): Promise<RepositoryTreeFingerprint> {
  const digest = createHash("sha256");
  const exclusions: RepositorySnapshotExclusion[] = [];
  let fileCount = 0;
  let totalBytes = 0;

  async function visit(directory: string): Promise<void> {
    throwIfAborted(input.signal);
    const children = [...await readdir(directory, { withFileTypes: true })].sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of children) {
      throwIfAborted(input.signal);
      assertSafeSnapshotEntryName(entry.name);
      const lexicalPath = resolve(directory, entry.name);
      const local = relative(input.rootPath, lexicalPath).replaceAll("\\", "/");
      const reason = exclusionReason({
        isDirectory: entry.isDirectory(),
        name: entry.name,
        relativePath: local,
      });
      if (reason !== null) {
        exclusions.push({ path: local, reason });
        continue;
      }
      if (entry.isSymbolicLink()) {
        throw new RepositoryBoundaryError(
          "symlink-rejected",
          "Repository snapshots reject symbolic links outside excluded paths.",
        );
      }
      if (!entry.isDirectory() && !entry.isFile()) {
        throw new RepositoryBoundaryError(
          "symlink-rejected",
          `Repository snapshots reject non-regular entries: ${relative(input.rootPath, lexicalPath)}`,
        );
      }
      const canonical = await realpath(lexicalPath);
      if (!isContained(input.rootPath, canonical)) {
        throw new RepositoryBoundaryError(
          "path-escape",
          "Repository snapshot entry escaped its root.",
        );
      }
      if (entry.isDirectory()) {
        await visit(canonical);
        continue;
      }
      const file = await readRegularFileNoFollow(lexicalPath);
      const { bytes } = file;
      fileCount += 1;
      totalBytes += bytes.byteLength;
      if (
        fileCount > MAX_SNAPSHOT_FILES ||
        totalBytes > MAX_SNAPSHOT_BYTES
      ) {
        throw new RepositoryBoundaryError(
          "budget-exceeded",
          "Repository snapshot exceeded its file or byte safety budget.",
        );
      }
      digest.update(local);
      digest.update("\0file\0");
      digest.update(file.mode.toString(8));
      digest.update("\0");
      digest.update(bytes);
      await input.onFile?.(lexicalPath, local, bytes, file.mode);
    }
  }

  await visit(input.rootPath);
  const entries = exclusions.sort((left, right) =>
    left.path.localeCompare(right.path) ||
    left.reason.localeCompare(right.reason),
  );
  const exclusionFingerprint = sha256Json({
    entries,
    policyFingerprint: SNAPSHOT_POLICY_FINGERPRINT,
    schemaVersion: 1,
  });
  digest.update("\0snapshot-policy\0");
  digest.update(SNAPSHOT_POLICY_FINGERPRINT);
  digest.update("\0snapshot-exclusions\0");
  digest.update(exclusionFingerprint);
  return {
    contentFingerprint: `sha256:${digest.digest("hex")}`,
    exclusionManifest: {
      entries,
      fingerprint: exclusionFingerprint,
      policyFingerprint: SNAPSHOT_POLICY_FINGERPRINT,
      schemaVersion: 1,
    },
    fileCount,
    totalBytes,
  };
}

export class NodeRepositoryFileSystem implements RepositoryFileSystemPort {
  constructor(private readonly configuredManagedRoot: string) {}

  entryKind = nodeEntryKind;
  readFile = async (path: string): Promise<Uint8Array> =>
    (await readRegularFileNoFollow(path)).bytes;
  realpath = realpath;

  async readDirectory(path: string): Promise<readonly RepositoryDirectoryEntry[]> {
    return (await readdir(path, { withFileTypes: true })).map((entry) => ({
      kind: entry.isSymbolicLink()
        ? "symlink"
        : entry.isDirectory()
          ? "directory"
          : entry.isFile()
            ? "file"
            : "symlink",
      name: entry.name,
    }));
  }

  async createManagedSnapshot(input: {
    readonly sourceRoot: string;
    readonly targetRoot: string;
    readonly signal: AbortSignal;
  }): Promise<RepositoryTreeFingerprint> {
    throwIfAborted(input.signal);
    const sourceRoot = await realpath(input.sourceRoot);
    const { managedRoot, target: targetRoot } =
      await canonicalManagedTarget(
        this.configuredManagedRoot,
        input.targetRoot,
      );
    if (
      !isContained(managedRoot, targetRoot) ||
      (await nodeEntryKind(targetRoot)) !== "missing"
    ) {
      throw new RepositoryBoundaryError(
        "path-escape",
        "Managed snapshot target must be a new contained directory.",
      );
    }
    await mkdir(targetRoot);
    try {
      return await inspectTree({
        rootPath: sourceRoot,
        signal: input.signal,
        onFile: async (_sourcePath, relativePath, bytes, mode) => {
          const targetPath = resolve(targetRoot, relativePath);
          await ensureContainedDirectory(targetRoot, dirname(targetPath));
          await writeManagedFileNoFollow(targetPath, bytes, mode);
        },
      });
    } catch (error) {
      await rm(targetRoot, { force: true, recursive: true });
      throw error;
    }
  }

  async fingerprintSourceTree(input: {
    readonly rootPath: string;
    readonly signal: AbortSignal;
  }): Promise<RepositoryTreeFingerprint> {
    return inspectTree({
      rootPath: await realpath(input.rootPath),
      signal: input.signal,
    });
  }

  async assertManagedTreeSafe(input: {
    readonly rootPath: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const rootPath = await canonicalManagedRoot(
      this.configuredManagedRoot,
      input.rootPath,
    );
    await assertSafeTree(rootPath, rootPath, input.signal);
  }

  async removeManagedTree(input: {
    readonly rootPath: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    throwIfAborted(input.signal);
    const { managedRoot, target: requested } =
      await canonicalManagedTarget(
        this.configuredManagedRoot,
        input.rootPath,
      );
    const kind = await nodeEntryKind(requested);
    if (kind === "missing") return;
    if (kind !== "directory") {
      throw new RepositoryBoundaryError(
        "symlink-rejected",
        "Managed cleanup target must be a real directory.",
      );
    }
    const canonical = await realpath(requested);
    if (!isContained(managedRoot, canonical)) {
      throw new RepositoryBoundaryError(
        "path-escape",
        "Managed cleanup target resolved outside capture storage.",
      );
    }
    await rm(canonical, { force: true, recursive: true });
  }

}
