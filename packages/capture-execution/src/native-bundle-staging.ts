import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { CaptureExecutionError } from "./executor.js";

const MAXIMUM_BUNDLE_ENTRIES = 100_000;
const MAXIMUM_BUNDLE_BYTES = 4 * 1_024 * 1_024 * 1_024;
const MAXIMUM_FILE_BYTES = 1 * 1_024 * 1_024 * 1_024;
const COPY_BUFFER_BYTES = 1 * 1_024 * 1_024;

export interface StagedNativeBundle {
  readonly appBundlePath: string;
  readonly infoPlistBytes: Uint8Array;
}

interface CopyBudget {
  entries: number;
  bytes: number;
}

function failure(code: string, message: string): CaptureExecutionError {
  return new CaptureExecutionError("build", code, false, message);
}

function contained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot));
}

function safeEntryName(name: string): boolean {
  return name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\0");
}

function sameFile(
  left: Readonly<{ dev: number | bigint; ino: number | bigint }>,
  right: Readonly<{ dev: number | bigint; ino: number | bigint }>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameNames(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((name, index) => name === right[index]);
}

async function digestRegularFile(path: string): Promise<string> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => null);
  if (handle === null) {
    throw failure(
      "APP_BUNDLE_TREE_UNTRUSTED",
      "Application bundle file changed during verification.",
    );
  }
  try {
    const initial = await handle.stat();
    if (!initial.isFile() || initial.size > MAXIMUM_FILE_BYTES) {
      throw failure(
        "APP_BUNDLE_TREE_UNTRUSTED",
        "Application bundle contains an invalid file.",
      );
    }
    const digest = async (): Promise<string> => {
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(
        Math.min(COPY_BUFFER_BYTES, Math.max(1, initial.size)),
      );
      let position = 0;
      while (position < initial.size) {
        const result = await handle.read(
          buffer,
          0,
          Math.min(buffer.byteLength, initial.size - position),
          position,
        );
        if (result.bytesRead <= 0) {
          throw failure(
            "APP_BUNDLE_TREE_UNTRUSTED",
            "Application bundle file changed during verification.",
          );
        }
        hash.update(buffer.subarray(0, result.bytesRead));
        position += result.bytesRead;
      }
      return hash.digest("hex");
    };
    const first = await digest();
    const second = await digest();
    const final = await handle.stat();
    if (
      first !== second ||
      !sameFile(initial, final) ||
      initial.size !== final.size
    ) {
      throw failure(
        "APP_BUNDLE_TREE_UNTRUSTED",
        "Application bundle file changed during verification.",
      );
    }
    return `${(Number(initial.mode) & 0o111) === 0 ? "data" : "exec"}:${first}`;
  } finally {
    await handle.close();
  }
}

async function digestTree(path: string): Promise<string> {
  const initial = await lstat(path).catch(() => null);
  if (
    initial === null ||
    initial.isSymbolicLink() ||
    !initial.isDirectory()
  ) {
    throw failure(
      "APP_BUNDLE_TREE_UNTRUSTED",
      "Application bundle directory changed during verification.",
    );
  }
  const names = (await readdir(path)).sort((left, right) =>
    left.localeCompare(right));
  const hash = createHash("sha256");
  for (const name of names) {
    if (!safeEntryName(name)) {
      throw failure(
        "APP_BUNDLE_TREE_UNTRUSTED",
        "Application bundle contains an invalid entry name.",
      );
    }
    const entry = join(path, name);
    const metadata = await lstat(entry).catch(() => null);
    if (metadata === null || metadata.isSymbolicLink()) {
      throw failure(
        "APP_BUNDLE_TREE_UNTRUSTED",
        "Application bundle contains a symbolic link.",
      );
    }
    const digest = metadata.isDirectory()
      ? await digestTree(entry)
      : metadata.isFile()
      ? await digestRegularFile(entry)
      : null;
    if (digest === null) {
      throw failure(
        "APP_BUNDLE_TREE_UNTRUSTED",
        "Application bundle contains a socket or special file.",
      );
    }
    hash.update(`${Buffer.byteLength(name, "utf8")}:`);
    hash.update(name);
    hash.update(`:${metadata.isDirectory() ? "dir" : "file"}:${digest};`);
  }
  const [final, finalNames] = await Promise.all([
    lstat(path),
    readdir(path).then((entries) =>
      entries.sort((left, right) => left.localeCompare(right))),
  ]);
  if (
    !final.isDirectory() ||
    !sameFile(initial, final) ||
    !sameNames(names, finalNames)
  ) {
    throw failure(
      "APP_BUNDLE_TREE_UNTRUSTED",
      "Application bundle directory changed during verification.",
    );
  }
  return hash.digest("hex");
}

export async function readRegularFileNoFollow(
  path: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => null);
  if (handle === null) {
    throw failure(
      "APP_INFO_PLIST_UNTRUSTED",
      "Application Info.plist cannot be opened without following links.",
    );
  }
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size < 8 ||
      metadata.size > maximumBytes
    ) {
      throw failure(
        "APP_INFO_PLIST_UNTRUSTED",
        "Application Info.plist is not a bounded regular file.",
      );
    }
    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close();
  }
}

async function copyRegularFile(
  source: string,
  destination: string,
  sourceMetadata: Awaited<ReturnType<typeof lstat>>,
  budget: CopyBudget,
): Promise<void> {
  const sourceHandle = await open(
    source,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => null);
  if (sourceHandle === null) {
    throw failure(
      "APP_BUNDLE_TREE_UNTRUSTED",
      "Application bundle file changed during staging.",
    );
  }
  let destinationHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const openedMetadata = await sourceHandle.stat();
    if (
      !openedMetadata.isFile() ||
      !sameFile(openedMetadata, sourceMetadata) ||
      openedMetadata.size !== sourceMetadata.size ||
      openedMetadata.size > MAXIMUM_FILE_BYTES ||
      budget.bytes + openedMetadata.size > MAXIMUM_BUNDLE_BYTES
    ) {
      throw failure(
        "APP_BUNDLE_TREE_UNTRUSTED",
        "Application bundle contains an invalid or oversized file.",
      );
    }
    destinationHandle = await open(
      destination,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    const buffer = Buffer.allocUnsafe(
      Math.min(COPY_BUFFER_BYTES, Math.max(1, openedMetadata.size)),
    );
    let position = 0;
    while (position < openedMetadata.size) {
      const requested = Math.min(
        buffer.byteLength,
        openedMetadata.size - position,
      );
      const read = await sourceHandle.read(
        buffer,
        0,
        requested,
        position,
      );
      if (read.bytesRead <= 0) {
        throw failure(
          "APP_BUNDLE_TREE_UNTRUSTED",
          "Application bundle file changed during staging.",
        );
      }
      let written = 0;
      while (written < read.bytesRead) {
        const result = await destinationHandle.write(
          buffer,
          written,
          read.bytesRead - written,
          position + written,
        );
        if (result.bytesWritten <= 0) {
          throw failure(
            "APP_BUNDLE_STAGING_FAILED",
            "Application bundle could not be staged.",
          );
        }
        written += result.bytesWritten;
      }
      position += read.bytesRead;
    }
    const finalMetadata = await sourceHandle.stat();
    if (
      !sameFile(finalMetadata, sourceMetadata) ||
      finalMetadata.size !== sourceMetadata.size
    ) {
      throw failure(
        "APP_BUNDLE_TREE_UNTRUSTED",
        "Application bundle changed during staging.",
      );
    }
    await destinationHandle.sync();
    budget.bytes += openedMetadata.size;
    await destinationHandle.chmod(
      (Number(sourceMetadata.mode) & 0o111) === 0 ? 0o400 : 0o500,
    );
  } finally {
    await destinationHandle?.close();
    await sourceHandle.close();
  }
}

async function copyDirectory(
  source: string,
  destination: string,
  budget: CopyBudget,
): Promise<void> {
  const sourceMetadata = await lstat(source).catch(() => null);
  if (
    sourceMetadata === null ||
    sourceMetadata.isSymbolicLink() ||
    !sourceMetadata.isDirectory()
  ) {
    throw failure(
      "APP_BUNDLE_TREE_UNTRUSTED",
      "Application bundle contains an unsafe directory.",
    );
  }
  await mkdir(destination, { mode: 0o700 });
  const names = (await readdir(source)).sort((left, right) =>
    left.localeCompare(right));
  for (const name of names) {
    budget.entries += 1;
    if (
      budget.entries > MAXIMUM_BUNDLE_ENTRIES ||
      !safeEntryName(name)
    ) {
      throw failure(
        "APP_BUNDLE_TREE_UNTRUSTED",
        "Application bundle exceeds its safe tree bounds.",
      );
    }
    const sourceEntry = join(source, name);
    const destinationEntry = join(destination, name);
    const metadata = await lstat(sourceEntry).catch(() => null);
    if (metadata === null || metadata.isSymbolicLink()) {
      throw failure(
        "APP_BUNDLE_TREE_UNTRUSTED",
        "Application bundle contains a symbolic link.",
      );
    }
    if (metadata.isDirectory()) {
      await copyDirectory(sourceEntry, destinationEntry, budget);
    } else if (metadata.isFile()) {
      await copyRegularFile(
        sourceEntry,
        destinationEntry,
        metadata,
        budget,
      );
    } else {
      throw failure(
        "APP_BUNDLE_TREE_UNTRUSTED",
        "Application bundle contains a socket or special file.",
      );
    }
    const finalEntry = await lstat(sourceEntry).catch(() => null);
    if (
      finalEntry === null ||
      !sameFile(metadata, finalEntry) ||
      metadata.isDirectory() !== finalEntry.isDirectory() ||
      metadata.isFile() !== finalEntry.isFile()
    ) {
      throw failure(
        "APP_BUNDLE_TREE_UNTRUSTED",
        "Application bundle entry changed during staging.",
      );
    }
  }
  const [finalMetadata, finalNames] = await Promise.all([
    lstat(source),
    readdir(source).then((entries) =>
      entries.sort((left, right) => left.localeCompare(right))),
  ]);
  if (
    !finalMetadata.isDirectory() ||
    !sameFile(finalMetadata, sourceMetadata) ||
    !sameNames(names, finalNames)
  ) {
    throw failure(
      "APP_BUNDLE_TREE_UNTRUSTED",
      "Application bundle directory changed during staging.",
    );
  }
  await chmod(destination, 0o500);
}

export async function stageNativeBundle(
  sourceAppBundlePath: string,
  stagingRoot: string,
): Promise<StagedNativeBundle> {
  if (
    !isAbsolute(sourceAppBundlePath) ||
    !isAbsolute(stagingRoot) ||
    resolve(stagingRoot) === "/"
  ) {
    throw failure(
      "APP_BUNDLE_STAGING_FAILED",
      "Application bundle staging authority is invalid.",
    );
  }
  const stagingMetadata = await lstat(stagingRoot).catch(() => null);
  if (
    stagingMetadata === null ||
    stagingMetadata.isSymbolicLink() ||
    !stagingMetadata.isDirectory()
  ) {
    throw failure(
      "APP_BUNDLE_STAGING_FAILED",
      "Application bundle staging root must be a real directory.",
    );
  }
  const [canonicalSource, canonicalStaging] = await Promise.all([
    realpath(sourceAppBundlePath),
    realpath(stagingRoot),
  ]);
  if (
    contained(canonicalSource, canonicalStaging) ||
    contained(canonicalStaging, canonicalSource)
  ) {
    throw failure(
      "APP_BUNDLE_STAGING_FAILED",
      "Application bundle staging root overlaps the build output.",
    );
  }
  const bundleName = basename(canonicalSource);
  if (!/^[A-Za-z0-9._ -]{1,200}\.app$/u.test(bundleName)) {
    throw failure(
      "APP_BUNDLE_STAGING_FAILED",
      "Application bundle name is invalid.",
    );
  }
  const stage = await mkdtemp(join(canonicalStaging, "native-app-"));
  const destination = join(stage, bundleName);
  try {
    await copyDirectory(
      canonicalSource,
      destination,
      { entries: 0, bytes: 0 },
    );
    const [sourceDigest, stagedDigest] = await Promise.all([
      digestTree(canonicalSource),
      digestTree(destination),
    ]);
    if (sourceDigest !== stagedDigest) {
      throw failure(
        "APP_BUNDLE_TREE_UNTRUSTED",
        "Application bundle changed while its sealed snapshot was created.",
      );
    }
    const infoPlistBytes = await readRegularFileNoFollow(
      join(destination, "Info.plist"),
      4 * 1_024 * 1_024,
    );
    await chmod(stage, 0o500);
    return Object.freeze({
      appBundlePath: destination,
      infoPlistBytes,
    });
  } catch (error) {
    await chmod(stage, 0o700).catch(() => undefined);
    await rm(stage, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }
}
