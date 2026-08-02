import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export interface StoredArtifact {
  readonly id: `art_${string}`;
  readonly hash: `sha256:${string}`;
  readonly path: string;
  readonly size: number;
}

export interface ArtifactReference {
  readonly id: `art_${string}`;
  readonly hash: `sha256:${string}`;
  readonly extension: string;
}

export interface ArtifactStoreLimits {
  readonly maximumArtifactBytes: number;
  readonly maximumStoreBytes: number;
}

export interface ArtifactStoreUsage {
  readonly artifactCount: number;
  readonly totalBytes: number;
  readonly maximumArtifactBytes: number;
  readonly maximumStoreBytes: number;
}

export const DEFAULT_ARTIFACT_STORE_LIMITS: ArtifactStoreLimits =
  Object.freeze({
    maximumArtifactBytes: 64 * 1_024 * 1_024,
    maximumStoreBytes: 2 * 1_024 * 1_024 * 1_024,
  });

function validateLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function artifactId(digest: string): `art_${string}` {
  return `art_${digest.slice(0, 26).toUpperCase()}`;
}

function digestFromHash(hash: string): string {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(hash);
  if (!match?.[1]) {
    throw new Error("Artifact hash is invalid.");
  }
  return match[1];
}

function validateExtension(extension: string): string {
  if (!/^[a-z0-9]{1,12}$/u.test(extension)) {
    throw new Error("Artifact extension must be a safe lowercase identifier.");
  }
  return extension;
}

function assertContained(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    resolve(candidate) !== candidate
  ) {
    throw new Error("Artifact path escapes the content-addressed store.");
  }
}

const ALLOWED_SYSTEM_PATH_ALIASES = new Set(["/var", "/tmp", "/etc"]);
const STORE_MUTATION_TAILS = new Map<string, Promise<void>>();

async function assertNoSymlinkAncestors(path: string): Promise<void> {
  const segments = resolve(path).split(sep).filter(Boolean);
  let current: string = sep;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (
        metadata.isSymbolicLink() &&
        !ALLOWED_SYSTEM_PATH_ALIASES.has(current)
      ) {
        throw new Error(
          "Artifact storage root may not traverse a symbolic link.",
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  }
}

async function assertNoSymbolicLinks(
  root: string,
  candidateDirectory: string,
): Promise<void> {
  const segments = relative(root, candidateDirectory)
    .split(sep)
    .filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new Error(
          "Artifact storage may not traverse a symbolic link.",
        );
      }
      if (!metadata.isDirectory()) {
        throw new Error("Artifact storage parent must be a directory.");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        try {
          await mkdir(current);
        } catch (mkdirError) {
          if (
            !(
              mkdirError instanceof Error &&
              "code" in mkdirError &&
              mkdirError.code === "EEXIST"
            )
          ) {
            throw mkdirError;
          }
          const metadata = await lstat(current);
          if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
            throw new Error(
              "Artifact storage may not traverse a symbolic link.",
            );
          }
        }
        continue;
      }
      throw error;
    }
  }
}

export class ContentAddressedArtifactStore {
  readonly #root: string;
  readonly #limits: ArtifactStoreLimits;

  constructor(
    root: string,
    limits: Partial<ArtifactStoreLimits> = {},
  ) {
    if (!root.startsWith(sep)) {
      throw new Error("Artifact store root must be absolute.");
    }
    this.#root = resolve(root);
    this.#limits = Object.freeze({
      maximumArtifactBytes: validateLimit(
        limits.maximumArtifactBytes ??
          DEFAULT_ARTIFACT_STORE_LIMITS.maximumArtifactBytes,
        "Maximum artifact byte quota",
      ),
      maximumStoreBytes: validateLimit(
        limits.maximumStoreBytes ??
          DEFAULT_ARTIFACT_STORE_LIMITS.maximumStoreBytes,
        "Maximum artifact store byte quota",
      ),
    });
  }

  async initialize(): Promise<void> {
    await assertNoSymlinkAncestors(this.#root);
    await mkdir(this.#root, { recursive: true });
    const metadata = await lstat(this.#root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Artifact store root must be a real directory.");
    }
  }

  async put(
    bytes: Uint8Array,
    requestedExtension: string,
  ): Promise<StoredArtifact> {
    return this.#withMutationLock(() =>
      this.#put(bytes, requestedExtension),
    );
  }

  async #put(
    bytes: Uint8Array,
    requestedExtension: string,
  ): Promise<StoredArtifact> {
    const extension = validateExtension(requestedExtension);
    if (bytes.byteLength > this.#limits.maximumArtifactBytes) {
      throw new Error(
        "Artifact exceeds the configured per-artifact byte quota.",
      );
    }
    await this.initialize();
    const digest = sha256(bytes);
    const destination = resolve(
      this.#root,
      "sha256",
      digest.slice(0, 2),
      `${digest}.${extension}`,
    );
    assertContained(this.#root, destination);
    await assertNoSymbolicLinks(this.#root, dirname(destination));

    try {
      const existing = await readFile(destination);
      if (existing.equals(Buffer.from(bytes))) {
        return Object.freeze({
          id: artifactId(digest),
          hash: `sha256:${digest}`,
          path: destination,
          size: bytes.byteLength,
        });
      }
      throw new Error("Artifact digest collision detected.");
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
      ) {
        throw error;
      }
    }

    const currentStoreBytes = await this.#storeBytes();
    if (
      currentStoreBytes >
      this.#limits.maximumStoreBytes - bytes.byteLength
    ) {
      throw new Error(
        "Artifact store exceeds the configured total byte quota.",
      );
    }
    await assertNoSymbolicLinks(this.#root, dirname(destination));
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    assertContained(this.#root, temporary);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }

    return Object.freeze({
      id: artifactId(digest),
      hash: `sha256:${digest}`,
      path: destination,
      size: bytes.byteLength,
    });
  }

  async resolve(reference: ArtifactReference): Promise<string> {
    const extension = validateExtension(reference.extension);
    const digest = digestFromHash(reference.hash);
    if (reference.id !== artifactId(digest)) {
      throw new Error("Artifact identity does not match its content hash.");
    }
    await this.initialize();
    const path = resolve(
      this.#root,
      "sha256",
      digest.slice(0, 2),
      `${digest}.${extension}`,
    );
    assertContained(this.#root, path);
    await assertNoSymbolicLinks(this.#root, dirname(path));
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Artifact reference is not a regular file.");
    }
    return path;
  }

  async read(reference: ArtifactReference): Promise<Buffer> {
    return readFile(await this.resolve(reference));
  }

  async #artifactFiles(): Promise<readonly string[]> {
    await this.initialize();
    const hashRoot = join(this.#root, "sha256");
    try {
      const rootMetadata = await lstat(hashRoot);
      if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
        throw new Error("Artifact hash root must be a real directory.");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
    const files: string[] = [];
    for (const bucket of await readdir(hashRoot, {
      withFileTypes: true,
    })) {
      if (bucket.isSymbolicLink() || !bucket.isDirectory()) {
        throw new Error("Artifact bucket must be a real directory.");
      }
      const bucketPath = join(hashRoot, bucket.name);
      for (const entry of await readdir(bucketPath, {
        withFileTypes: true,
      })) {
        if (entry.isSymbolicLink() || !entry.isFile()) {
          throw new Error("Artifact entry must be a regular file.");
        }
        files.push(join(bucketPath, entry.name));
      }
    }
    return Object.freeze(files);
  }

  async #storeBytes(): Promise<number> {
    let total = 0;
    for (const path of await this.#artifactFiles()) {
      const metadata = await stat(path);
      total += metadata.size;
      if (!Number.isSafeInteger(total)) {
        throw new Error("Artifact store byte accounting overflowed.");
      }
    }
    return total;
  }

  async inspectUsage(): Promise<ArtifactStoreUsage> {
    const files = await this.#artifactFiles();
    let totalBytes = 0;
    for (const path of files) {
      totalBytes += (await stat(path)).size;
      if (!Number.isSafeInteger(totalBytes)) {
        throw new Error("Artifact store byte accounting overflowed.");
      }
    }
    return Object.freeze({
      artifactCount: files.length,
      totalBytes,
      maximumArtifactBytes: this.#limits.maximumArtifactBytes,
      maximumStoreBytes: this.#limits.maximumStoreBytes,
    });
  }

  async listReferences(): Promise<readonly ArtifactReference[]> {
    const references = (await this.#artifactFiles()).map((path) => {
      const match = /^([a-f0-9]{64})\.([a-z0-9]{1,12})$/u.exec(
        basename(path),
      );
      if (match?.[1] === undefined || match[2] === undefined) {
        throw new Error("Artifact entry name is invalid.");
      }
      return Object.freeze({
        id: artifactId(match[1]),
        hash: `sha256:${match[1]}` as `sha256:${string}`,
        extension: validateExtension(match[2]),
      });
    });
    references.sort((left, right) => left.id.localeCompare(right.id));
    return Object.freeze(references);
  }

  async #withMutationLock<Value>(
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const precedingMutation =
      STORE_MUTATION_TAILS.get(this.#root) ?? Promise.resolve();
    let release!: () => void;
    const currentMutation = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    STORE_MUTATION_TAILS.set(this.#root, currentMutation);
    await precedingMutation;
    try {
      return await operation();
    } finally {
      release();
      if (STORE_MUTATION_TAILS.get(this.#root) === currentMutation) {
        STORE_MUTATION_TAILS.delete(this.#root);
      }
    }
  }

  async purgeUnreferenced(
    references: readonly ArtifactReference[],
  ): Promise<number> {
    return this.#withMutationLock(async () => {
      const retained = new Set(
        await Promise.all(
          references.map((reference) => this.resolve(reference)),
        ),
      );
      let removed = 0;
      for (const path of await this.#artifactFiles()) {
        if (!retained.has(path)) {
          await unlink(path);
          removed += 1;
        }
      }
      return removed;
    });
  }

  async purgeAll(): Promise<number> {
    return this.#withMutationLock(async () => {
      const files = await this.#artifactFiles();
      for (const path of files) {
        await unlink(path);
      }
      await rm(join(this.#root, "sha256"), {
        recursive: true,
        force: true,
      });
      return files.length;
    });
  }
}
