import { describe, expect, it, vi } from "vitest";

import type { WorkspaceSessionRuntimePortV1 } from "@memi/protocol";

import {
  CANVAS_AUTOSAVE_MAX_BYTES,
} from "./persistence.js";
import {
  migrateLegacyWorkspaceSession,
  workspaceSessionLegacyKey,
} from "./workspace-session-migration.js";

const SOURCE_REVISION = "a".repeat(40);

function legacyRecord() {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "memi-canvas-autosave",
    documentId: "buzzr-mobile",
    sourceFingerprint: "fnv1a64:0123456789abcdef",
    scene: {
      nodes: [{ id: "button-primary" }],
      selectedNodeId: "button-primary",
      revision: 14,
      past: [],
      future: [],
      nextHistoryId: 1,
    },
    trace: [],
  });
}

describe("legacy workspace session migration", () => {
  it("validates and migrates only restorable state while retaining the legacy record", async () => {
    const key = workspaceSessionLegacyKey("buzzr-mobile");
    const records = new Map([[key, legacyRecord()]]);
    const migrateLegacy = vi.fn().mockResolvedValue({
      status: "migrated",
      session: null,
    });
    const port = { migrateLegacy } as unknown as WorkspaceSessionRuntimePortV1;

    const result = await migrateLegacyWorkspaceSession({
      projectId: "project-buzzr",
      documentId: "buzzr-mobile",
      sourceRevision: SOURCE_REVISION,
      expectedLegacySourceFingerprint: "fnv1a64:0123456789abcdef",
      storage: {
        getItem: (storageKey) => records.get(storageKey) ?? null,
      },
      runtime: port,
    });

    expect(result).toBe("migrated");
    expect(migrateLegacy).toHaveBeenCalledWith(
      expect.objectContaining({
        migrationKey: `local-storage:${key}`,
        session: expect.objectContaining({
          documentRevision: 14,
          selection: expect.objectContaining({
            selectedIds: ["button-primary"],
          }),
        }),
      }),
    );
    expect(records.get(key)).toBe(legacyRecord());
  });

  it("fails closed on oversized, malformed, cross-document, and dangling selection records", async () => {
    const migrateLegacy = vi.fn();
    const runtime = {
      migrateLegacy,
    } as unknown as WorkspaceSessionRuntimePortV1;
    const invalidRecords = [
      "{bad",
      "x".repeat(CANVAS_AUTOSAVE_MAX_BYTES + 1),
      legacyRecord().replace('"buzzr-mobile"', '"other-document"'),
      legacyRecord().replace(
        '"selectedNodeId":"button-primary"',
        '"selectedNodeId":"missing"',
      ),
      legacyRecord().replace(
        "fnv1a64:0123456789abcdef",
        "fnv1a64:1111111111111111",
      ),
    ];

    for (const record of invalidRecords) {
      await expect(
        migrateLegacyWorkspaceSession({
          projectId: "project-buzzr",
          documentId: "buzzr-mobile",
          sourceRevision: SOURCE_REVISION,
          expectedLegacySourceFingerprint:
            "fnv1a64:0123456789abcdef",
          storage: { getItem: () => record },
          runtime,
        }),
      ).resolves.toBe("invalid");
    }
    expect(migrateLegacy).not.toHaveBeenCalled();
  });

  it("does nothing when no legacy record exists or storage throws", async () => {
    const runtime = {
      migrateLegacy: vi.fn(),
    } as unknown as WorkspaceSessionRuntimePortV1;
    await expect(
      migrateLegacyWorkspaceSession({
        projectId: "project-buzzr",
        documentId: "buzzr-mobile",
        sourceRevision: null,
        expectedLegacySourceFingerprint: "fnv1a64:0123456789abcdef",
        storage: { getItem: () => null },
        runtime,
      }),
    ).resolves.toBe("missing");
    await expect(
      migrateLegacyWorkspaceSession({
        projectId: "project-buzzr",
        documentId: "buzzr-mobile",
        sourceRevision: null,
        expectedLegacySourceFingerprint: "fnv1a64:0123456789abcdef",
        storage: {
          getItem: () => {
            throw new Error("denied");
          },
        },
        runtime,
      }),
    ).resolves.toBe("unavailable");
  });
});
