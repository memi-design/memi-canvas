import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WorktreeIdSchema } from "@memi/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  prepareRepositoryCapture,
  createNodeRepositoryPorts,
} = vi.hoisted(() => ({
  prepareRepositoryCapture: vi.fn(),
  createNodeRepositoryPorts: vi.fn(() => ({
    fileSystem: {},
    process: {},
  })),
}));

vi.mock("@memi/capture-repository", () => ({
  prepareRepositoryCapture,
}));
vi.mock("@memi/capture-repository/node", () => ({
  createNodeRepositoryPorts,
}));

import { createCaptureRepositoryPort } from "./capture-repository-port.js";

const directories: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("capture repository port", () => {
  it("maps a protected managed snapshot into coordinator authority", async () => {
    const managedRoot = mkdtempSync(
      join(tmpdir(), "memi-capture-worktrees-"),
    );
    directories.push(managedRoot);
    const hash = `sha256:${"a".repeat(64)}` as const;
    prepareRepositoryCapture.mockResolvedValue({
      source: {
        rootPath: "/tmp/source",
        headRevision: "a".repeat(40),
        dirtyFingerprint: hash,
      },
      inventory: {
        schemaVersion: 1,
        repository: {
          revision: "a".repeat(40),
          dirtyFileFingerprint: hash,
        },
        budgets: {
          maxEntries: 1,
          maxFileBytes: 1,
          maxTotalBytes: 1,
          maxDepth: 1,
        },
        entries: [],
      },
      managedCopy: {
        rootPath: join(managedRoot, "capture-1"),
      },
      snapshotExclusions: {
        schemaVersion: 1,
        entries: [],
        fingerprint: hash,
        policyFingerprint: hash,
      },
      applications: [],
    });
    const worktreeId = WorktreeIdSchema.parse(
      "wrk_01J00000000000000000000000",
    );
    const port = createCaptureRepositoryPort({
      managedRoot,
      createCaptureId: () => "capture-1",
      createWorktreeId: () => worktreeId,
    });

    await expect(
      port.inspect(
        "/tmp/source",
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      authority: {
        rootPath: "/tmp/source",
        sourceRevision: "a".repeat(40),
        dirtyFingerprint: hash,
        managedWorktreeId: worktreeId,
        managedRootPath: join(managedRoot, "capture-1"),
      },
      manifest: expect.any(Object),
      applications: [],
      snapshotExclusions: {
        schemaVersion: 1,
        entries: [],
        fingerprint: hash,
        policyFingerprint: hash,
      },
    });
    expect(createNodeRepositoryPorts).toHaveBeenCalledWith({
      managedRoot,
    });
    expect(prepareRepositoryCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRoot: "/tmp/source",
        managedRoot,
        captureId: "capture-1",
      }),
    );
  });

  it("rejects a managed copy outside the configured capture authority", async () => {
    const managedRoot = mkdtempSync(
      join(tmpdir(), "memi-capture-worktrees-"),
    );
    directories.push(managedRoot);
    prepareRepositoryCapture.mockResolvedValue({
      source: {
        rootPath: "/tmp/source",
        headRevision: "a".repeat(40),
        dirtyFingerprint: `sha256:${"a".repeat(64)}`,
      },
      inventory: {
        schemaVersion: 1,
        repository: {
          revision: "a".repeat(40),
          dirtyFileFingerprint: `sha256:${"a".repeat(64)}`,
        },
        budgets: {
          maxEntries: 1,
          maxFileBytes: 1,
          maxTotalBytes: 1,
          maxDepth: 1,
        },
        entries: [],
      },
      managedCopy: {
        rootPath: join(managedRoot, "..", "escape"),
      },
      snapshotExclusions: {
        schemaVersion: 1,
        entries: [],
        fingerprint: `sha256:${"a".repeat(64)}`,
        policyFingerprint: `sha256:${"a".repeat(64)}`,
      },
      applications: [],
    });
    const port = createCaptureRepositoryPort({
      managedRoot,
      createCaptureId: () => "capture-1",
      createWorktreeId: () =>
        WorktreeIdSchema.parse(
          "wrk_01J00000000000000000000000",
        ),
    });

    await expect(
      port.inspect(
        "/tmp/source",
        new AbortController().signal,
      ),
    ).rejects.toThrow(/managed capture root/u);
  });

  it("rejects a filesystem root as the configured managed authority", async () => {
    prepareRepositoryCapture.mockResolvedValue({
      source: {
        rootPath: "/tmp/source",
        headRevision: "a".repeat(40),
        dirtyFingerprint: `sha256:${"a".repeat(64)}`,
      },
      inventory: {
        schemaVersion: 1,
        repository: {
          revision: "a".repeat(40),
          dirtyFileFingerprint: `sha256:${"a".repeat(64)}`,
        },
        budgets: {
          maxEntries: 1,
          maxFileBytes: 1,
          maxTotalBytes: 1,
          maxDepth: 1,
        },
        entries: [],
      },
      managedCopy: { rootPath: "/capture-1" },
      snapshotExclusions: {
        schemaVersion: 1,
        entries: [],
        fingerprint: `sha256:${"a".repeat(64)}`,
        policyFingerprint: `sha256:${"a".repeat(64)}`,
      },
      applications: [],
    });
    const port = createCaptureRepositoryPort({
      managedRoot: "/",
      createCaptureId: () => "capture-1",
      createWorktreeId: () =>
        WorktreeIdSchema.parse(
          "wrk_01J00000000000000000000000",
        ),
    });

    await expect(
      port.inspect(
        "/tmp/source",
        new AbortController().signal,
      ),
    ).rejects.toThrow(/managed capture root/u);
  });
});
