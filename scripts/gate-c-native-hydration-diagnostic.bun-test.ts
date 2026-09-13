import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ContentAddressedArtifactStore } from "@memi/capture-execution";

import {
  MAX_GATE_C_RECONSTRUCTION_BYTES,
  createGateCReconstructionLoader,
  openReadOnlyGateCImportDatabase,
  parseGateCNativeHydrationArguments,
  resolveGateCNativeHydrationRoot,
  summarizeGateCNativeHydration,
} from "./gate-c-native-hydration-diagnostic.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function recoveryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memi-gate-c-hydration-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "capture-artifacts", "sha256"), {
    recursive: true,
  });
  return root;
}

describe("Gate C native hydration diagnostic", () => {
  it("requires the exact recovered project authority", () => {
    const root = "/Users/designer/Library/Application Support/design.memi.canvas";
    const projectId = "prj_42282B5031D972E2FD80970761";

    expect(parseGateCNativeHydrationArguments([root, projectId])).toEqual({
      projectId,
      root,
    });
    expect(() => parseGateCNativeHydrationArguments([root])).toThrow(
      /root and project ID/u,
    );
    expect(() =>
      parseGateCNativeHydrationArguments([root, "prj_not-valid"]),
    ).toThrow(/project ID/u);
  });

  it("summarizes hydrated artifact authority without seed node counts", () => {
    expect(
      summarizeGateCNativeHydration({
        artifacts: 3,
        components: 2,
        projectId: "prj_42282B5031D972E2FD80970761",
        screens: 3,
      }),
    ).toEqual({
      artifacts: 3,
      components: 2,
      projectId: "prj_42282B5031D972E2FD80970761",
      screens: 3,
    });
  });

  it("rejects a missing import database without creating recovery state", async () => {
    const root = await recoveryRoot();

    await expect(resolveGateCNativeHydrationRoot(root)).rejects.toThrow(
      /imports\.sqlite.*regular file/u,
    );
    await expect(lstat(join(root, "imports.sqlite"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("opens the recovered import database read-only", async () => {
    const root = await recoveryRoot();
    const databasePath = join(root, "imports.sqlite");
    const writable = new Database(databasePath, {
      create: true,
      readwrite: true,
      strict: true,
    });
    writable.exec("CREATE TABLE recovery_fixture (value TEXT NOT NULL) STRICT");
    writable.close();
    const filesBefore = (await readdir(root)).sort();

    const resolved = await resolveGateCNativeHydrationRoot(root);
    const readonly = openReadOnlyGateCImportDatabase(resolved.databasePath);
    try {
      expect(
        readonly.query<{ readonly count: number }>(
          "SELECT count(*) AS count FROM recovery_fixture",
        ).get(),
      ).toEqual({ count: 0 });
      expect(() =>
        readonly.exec("CREATE TABLE forbidden_recovery_write (id INTEGER)"),
      ).toThrow(/read.?only/u);
    } finally {
      readonly.close();
    }
    expect((await readdir(root)).sort()).toEqual(filesBefore);
  });

  it("loads only the exact content-addressed reconstruction artifact", async () => {
    const root = await recoveryRoot();
    const store = new ContentAddressedArtifactStore(
      join(root, "capture-artifacts"),
    );
    const payload = { schemaVersion: 1, kind: "reconstruction-fixture" };
    const stored = await store.put(
      new TextEncoder().encode(JSON.stringify(payload)),
      "json",
    );
    const reference = Object.freeze({
      id: stored.id,
      hash: stored.hash,
      extension: "json",
    });
    const loader = createGateCReconstructionLoader(
      join(root, "capture-artifacts"),
      [reference],
    );

    await expect(loader(reference.id)).resolves.toEqual(payload);
    await expect(
      loader("art_00000000000000000000000000"),
    ).rejects.toThrow(/not retained in committed evidence/u);
  });

  it("rejects oversized reconstruction JSON before reading it", async () => {
    const root = await recoveryRoot();
    const store = new ContentAddressedArtifactStore(
      join(root, "capture-artifacts"),
    );
    const stored = await store.put(
      new Uint8Array(MAX_GATE_C_RECONSTRUCTION_BYTES + 1).fill(0x78),
      "json",
    );
    const reference = Object.freeze({
      id: stored.id,
      hash: stored.hash,
      extension: "json",
    });
    const loader = createGateCReconstructionLoader(
      join(root, "capture-artifacts"),
      [reference],
    );

    await expect(loader(reference.id)).rejects.toThrow(/byte budget/u);
  });
});
