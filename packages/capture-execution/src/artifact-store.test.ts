import { access, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ContentAddressedArtifactStore } from "./artifact-store.js";

describe("ContentAddressedArtifactStore", () => {
  it("requires an absolute storage root", () => {
    expect(() => new ContentAddressedArtifactStore("relative")).toThrow(
      /absolute/i,
    );
  });

  it("requires positive safe integer quotas", () => {
    expect(
      () =>
        new ContentAddressedArtifactStore("/tmp/artifacts", {
          maximumArtifactBytes: 0,
        }),
    ).toThrow(/positive safe integer/i);
    expect(
      () =>
        new ContentAddressedArtifactStore("/tmp/artifacts", {
          maximumStoreBytes: Number.MAX_VALUE,
        }),
    ).toThrow(/positive safe integer/i);
  });

  it("persists identical bytes once under a contained hash-derived path", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-artifacts-"));
    const store = new ContentAddressedArtifactStore(root);
    const bytes = new TextEncoder().encode("runtime pixels");

    const first = await store.put(bytes, "png");
    const second = await store.put(bytes, "png");

    expect(second).toEqual(first);
    expect(first.path.startsWith(`${root}/`)).toBe(true);
    expect(first.hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    await expect(readFile(first.path)).resolves.toEqual(Buffer.from(bytes));
  });

  it("rejects unsafe extensions and symbolic-link traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-artifacts-"));
    const outside = await mkdtemp(join(tmpdir(), "memi-outside-"));
    const store = new ContentAddressedArtifactStore(root);

    await expect(
      store.put(new Uint8Array([1]), "../escape"),
    ).rejects.toThrow(/extension/i);

    await store.initialize();
    await symlink(outside, join(root, "sha256"));
    await expect(
      store.put(new Uint8Array([2]), "bin"),
    ).rejects.toThrow(/symbolic link/i);
  });

  it("rejects a user-controlled symbolic-link ancestor", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-parent-"));
    const outside = await mkdtemp(join(tmpdir(), "memi-outside-"));
    const linked = join(parent, "linked");
    await symlink(outside, linked);
    const store = new ContentAddressedArtifactStore(
      join(linked, "artifacts"),
    );

    await expect(store.initialize()).rejects.toThrow(/symbolic link/i);
  });

  it("rejects an oversized artifact before creating artifact storage", async () => {
    const root = join(
      await mkdtemp(join(tmpdir(), "memi-artifact-parent-")),
      "artifacts",
    );
    const store = new ContentAddressedArtifactStore(root, {
      maximumArtifactBytes: 3,
      maximumStoreBytes: 10,
    });

    await expect(
      store.put(new Uint8Array([1, 2, 3, 4]), "png"),
    ).rejects.toThrow(/artifact.*quota/i);
    await expect(access(root)).rejects.toThrow();
  });

  it("rejects before exceeding the total store quota without charging deduplication twice", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-artifacts-"));
    const store = new ContentAddressedArtifactStore(root, {
      maximumArtifactBytes: 4,
      maximumStoreBytes: 5,
    });
    const firstBytes = new Uint8Array([1, 2, 3]);
    const first = await store.put(firstBytes, "png");

    await expect(store.put(firstBytes, "png")).resolves.toEqual(first);
    await expect(
      store.put(new Uint8Array([4, 5, 6]), "json"),
    ).rejects.toThrow(/store.*quota/i);
    await expect(readFile(first.path)).resolves.toEqual(
      Buffer.from(firstBytes),
    );
    await expect(store.purgeAll()).resolves.toBe(1);
  });

  it("serializes concurrent writes against the total store quota", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-artifacts-"));
    const limits = {
      maximumArtifactBytes: 3,
      maximumStoreBytes: 5,
    };
    const firstStore = new ContentAddressedArtifactStore(root, limits);
    const secondStore = new ContentAddressedArtifactStore(root, limits);

    const results = await Promise.allSettled([
      firstStore.put(new Uint8Array([1, 2, 3]), "png"),
      secondStore.put(new Uint8Array([4, 5, 6]), "json"),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expect(firstStore.purgeAll()).resolves.toBe(1);
  });

  it("resolves, reads, and garbage-collects exact references", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-artifacts-"));
    const store = new ContentAddressedArtifactStore(root);
    const kept = await store.put(new Uint8Array([1, 2, 3]), "png");
    const removed = await store.put(new Uint8Array([4, 5, 6]), "json");

    await expect(
      store.read({
        id: kept.id,
        hash: kept.hash,
        extension: "png",
      }),
    ).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(
      store.resolve({
        id: kept.id,
        hash: removed.hash,
        extension: "png",
      }),
    ).rejects.toThrow(/identity/i);
    await expect(
      store.resolve({
        id: kept.id,
        hash: "sha256:not-a-digest" as `sha256:${string}`,
        extension: "png",
      }),
    ).rejects.toThrow(/hash/i);
    await expect(
      store.purgeUnreferenced([
        { id: kept.id, hash: kept.hash, extension: "png" },
      ]),
    ).resolves.toBe(1);
    await expect(readFile(removed.path)).rejects.toThrow();
    await expect(
      store.purgeAll(),
    ).resolves.toBe(1);
    await expect(readFile(kept.path)).rejects.toThrow();
  });

  it("reports immutable quota and usage snapshots for budget preflight", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-artifacts-"));
    const store = new ContentAddressedArtifactStore(root, {
      maximumArtifactBytes: 8,
      maximumStoreBytes: 12,
    });
    await store.put(new Uint8Array([1, 2, 3]), "png");

    await expect(store.inspectUsage()).resolves.toEqual({
      artifactCount: 1,
      totalBytes: 3,
      maximumArtifactBytes: 8,
      maximumStoreBytes: 12,
    });
    const snapshot = await store.inspectUsage();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("enumerates validated references without reading artifact bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-artifacts-"));
    const store = new ContentAddressedArtifactStore(root);
    const png = await store.put(new Uint8Array([1, 2, 3]), "png");
    const json = await store.put(new Uint8Array([4, 5]), "json");
    const expected = [
      { id: png.id, hash: png.hash, extension: "png" },
      { id: json.id, hash: json.hash, extension: "json" },
    ].sort((left, right) => left.id.localeCompare(right.id));

    await expect(store.listReferences()).resolves.toEqual(expected);
  });
});
