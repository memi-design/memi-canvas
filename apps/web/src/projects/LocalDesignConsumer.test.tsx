import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ProjectIdSchema,
  WorkspaceSessionSnapshotSchemaV1,
} from "@memi/protocol";

import type { RuntimeClientV1 } from "../runtime/runtime-client.js";
import { LocalDesignConsumer } from "./LocalDesignConsumer.js";
import type { ProjectRecord } from "./project-library.js";

const project: ProjectRecord = {
  id: "local-design",
  name: "Local design",
  kind: "design",
  documentRef: "canvas:local-design",
  source: { kind: "local", label: "Local file" },
  updatedAt: "2026-07-29T12:00:00.000Z",
  lastOpenedAt: "2026-07-29T12:00:00.000Z",
  archived: false,
};

function createStorage() {
  const records = new Map<string, string>();
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
  };
}

describe("LocalDesignConsumer workspace session", () => {
  it("uses an explicit temporary V3 boundary in browser-only mode", () => {
    const storage = createStorage();
    render(
      <LocalDesignConsumer
        onExit={() => {}}
        project={project}
        storage={storage}
      />,
    );

    expect(screen.getByText(/changes are temporary/u)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Infinite canvas" })).toBeTruthy();
  });

  it("restores and persists session metadata through the injected runtime while document recovery stays separate", async () => {
    const restore = vi.fn(async () => ({ session: null }));
    const save = vi.fn(async (payload) => ({
      session: WorkspaceSessionSnapshotSchemaV1.parse({
        ...payload.session,
        sessionRevision: 1,
        updatedAt: "2026-07-29T12:00:01.000Z",
      }),
    }));
    const migrateLegacy = vi.fn(async () => ({
      status: "already-migrated" as const,
      session: null,
    }));
    const runtimeClient = {
      canvasDocuments: {} as RuntimeClientV1["canvasDocuments"],
      sessions: { migrateLegacy, restore, save },
    } as Pick<RuntimeClientV1, "sessions" | "canvasDocuments">;
    const runtimeProjectId = ProjectIdSchema.parse(
      "prj_01J00000000000000000000000",
    );

    render(
      <LocalDesignConsumer
        onExit={() => {}}
        project={project}
        runtimeClient={runtimeClient}
        runtimeProjectId={runtimeProjectId}
        storage={createStorage()}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Restoring workspace session" }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Frame tool" })).toBeTruthy();
    });
    expect(restore).toHaveBeenCalledWith({
      projectId: runtimeProjectId,
      documentId: "document-local-local-design",
    });

    fireEvent.click(screen.getByRole("button", { name: "Frame tool" }));
    fireEvent.click(
      screen.getByRole("region", { name: "Infinite canvas" }),
      { clientX: 480, clientY: 300 },
    );
    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({
      expected: {
        documentRevision: 2,
        sessionRevision: null,
        sourceRevision: null,
      },
      projectId: runtimeProjectId,
      documentId: "document-local-local-design",
      session: {
        documentRevision: 2,
      },
    });
  });
});
