import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  open,
  realpath,
  stat,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { readBoundedBytes } from "./filesystem.js";

const HARD_MAX_IMPORT_FILE_BYTES = 64 * 1024 * 1024;

export interface InputSnapshotBudgets {
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export interface InputSnapshotContext<Path extends string> {
  readonly relativePath: Path;
  readonly candidate: string;
}

export interface InputSnapshotHooks<Path extends string> {
  readonly afterInitialLstat?: (
    context: InputSnapshotContext<Path>,
  ) => Promise<void>;
  readonly afterBoundedRead?: (
    context: InputSnapshotContext<Path>,
  ) => Promise<void>;
  readonly beforeBatchRevalidation?: (context: {
    readonly root: string;
  }) => Promise<void>;
}

export interface VerifiedInput<Path extends string> {
  readonly path: Path;
  readonly bytes: Buffer;
  readonly fingerprint: string;
}

export interface ReadVerifiedInputBatchOptions<Path extends string> {
  readonly rootDir: string;
  readonly inputPaths: readonly Path[];
  readonly budgets: InputSnapshotBudgets;
  readonly hooks?: InputSnapshotHooks<Path>;
}

interface SnapshotRecord<Path extends string> extends VerifiedInput<Path> {
  readonly candidate: string;
  readonly identity: FileIdentity;
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly nlink: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function identity(stats: BigIntStats): FileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    nlink: stats.nlink,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function assertSameIdentity(
  expected: FileIdentity,
  actual: BigIntStats,
  path: string,
): void {
  if (!actual.isFile() || !sameIdentity(expected, identity(actual))) {
    throw new Error(`Import input changed during snapshot: ${path}`);
  }
}

function assertBudgets(budgets: InputSnapshotBudgets): void {
  if (
    !Number.isSafeInteger(budgets.maxFileBytes) ||
    budgets.maxFileBytes <= 0 ||
    budgets.maxFileBytes > HARD_MAX_IMPORT_FILE_BYTES ||
    !Number.isSafeInteger(budgets.maxTotalBytes) ||
    budgets.maxTotalBytes < budgets.maxFileBytes
  ) {
    throw new Error("Import byte budgets must be positive safe integers.");
  }
}

function isContained(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

async function assertCanonicalPath(
  root: string,
  candidate: string,
  path: string,
): Promise<void> {
  const canonical = await realpath(candidate);
  if (!isContained(root, canonical) || canonical !== candidate) {
    throw new Error(
      `Import input resolves through a symbolic link or outside the project: ${path}`,
    );
  }
}

async function readOne<Path extends string>(
  root: string,
  path: Path,
  budgets: InputSnapshotBudgets,
  hooks: InputSnapshotHooks<Path>,
): Promise<SnapshotRecord<Path>> {
  const candidate = resolve(root, path);
  if (!isContained(root, candidate)) {
    throw new Error(`Required import input escapes the project root: ${path}`);
  }
  const initialStats = await lstat(candidate, { bigint: true });
  if (initialStats.isSymbolicLink()) {
    throw new Error(`Required import input is a symbolic link: ${path}`);
  }
  if (!initialStats.isFile()) {
    throw new Error(`Required import input is not a regular file: ${path}`);
  }
  if (initialStats.nlink !== 1n) {
    throw new Error(`Required import input is hard-linked: ${path}`);
  }
  await assertCanonicalPath(root, candidate, path);
  const initialIdentity = identity(initialStats);
  await hooks.afterInitialLstat?.({ relativePath: path, candidate });

  const handle = await open(
    candidate,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    assertSameIdentity(
      initialIdentity,
      await handle.stat({ bigint: true }),
      path,
    );
    if (initialStats.size > BigInt(budgets.maxFileBytes)) {
      throw new Error(`Import file byte budget exceeded: ${path}`);
    }
    const bytes = await readBoundedBytes(handle, budgets.maxFileBytes);
    await hooks.afterBoundedRead?.({ relativePath: path, candidate });
    assertSameIdentity(
      initialIdentity,
      await handle.stat({ bigint: true }),
      path,
    );
    return {
      path,
      candidate,
      bytes,
      fingerprint: sha256(bytes),
      identity: initialIdentity,
    };
  } finally {
    await handle.close();
  }
}

async function revalidate<Path extends string>(
  root: string,
  record: SnapshotRecord<Path>,
  maxFileBytes: number,
): Promise<void> {
  assertSameIdentity(
    record.identity,
    await lstat(record.candidate, { bigint: true }),
    record.path,
  );
  await assertCanonicalPath(root, record.candidate, record.path);
  assertSameIdentity(
    record.identity,
    await stat(record.candidate, { bigint: true }),
    record.path,
  );
  const handle = await open(
    record.candidate,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    assertSameIdentity(
      record.identity,
      await handle.stat({ bigint: true }),
      record.path,
    );
    const bytes = await readBoundedBytes(handle, maxFileBytes);
    assertSameIdentity(
      record.identity,
      await handle.stat({ bigint: true }),
      record.path,
    );
    if (sha256(bytes) !== record.fingerprint) {
      throw new Error(`Import input content changed during snapshot: ${record.path}`);
    }
  } finally {
    await handle.close();
  }
}

export async function readVerifiedInputBatch<const Path extends string>(
  options: ReadVerifiedInputBatchOptions<Path>,
): Promise<{
  readonly root: string;
  readonly inputs: readonly VerifiedInput<Path>[];
}> {
  assertBudgets(options.budgets);
  const root = await realpath(resolve(options.rootDir));
  const hooks = options.hooks ?? {};
  let records: readonly SnapshotRecord<Path>[] = [];
  let totalBytes = 0;
  for (const path of options.inputPaths) {
    const record = await readOne(root, path, options.budgets, hooks);
    totalBytes += record.bytes.byteLength;
    if (totalBytes > options.budgets.maxTotalBytes) {
      throw new Error("Import total byte budget exceeded.");
    }
    records = [...records, record];
  }
  await hooks.beforeBatchRevalidation?.({ root });
  for (const record of records) {
    await revalidate(root, record, options.budgets.maxFileBytes);
  }
  return {
    root,
    inputs: records.map(({ path, bytes, fingerprint }) => ({
      path,
      bytes,
      fingerprint,
    })),
  };
}
