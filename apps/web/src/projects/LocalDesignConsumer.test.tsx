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
import { createEphemeralCanvasDocumentPersistence } from "../runtime/runtime-client-canvas-document-persistence.js";
import { LocalDesignConsumer } from "./LocalDesignConsumer.js";
import type { ProjectRecord } from "./project-library.js";

type CanvasDocumentsClient = RuntimeClientV1["canvasDocuments"];
type CanvasDocumentOpenPayload = Parameters<CanvasDocumentsClient["open"]>[0];
type CanvasDocumentLoadPayload = Parameters<CanvasDocumentsClient["load"]>[0];
type CanvasDocumentInitializePayload = Parameters<CanvasDocumentsClient["initialize"]>[0];
type CanvasDocumentAppendPayload = Parameters<CanvasDocumentsClient["append"]>[0];
type CanvasDocumentCheckpointPayload = Parameters<CanvasDocumentsClient["checkpoint"]>[0];

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
  it("uses an explicit temporary V3 boundary in browser-only mode", async () => {
    const storage = createStorage();
    render(
      <LocalDesignConsumer
        onExit={() => {}}
        project={project}
        storage={storage}
      />,
    );

    expect(await screen.findByText(/changes are temporary/u)).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Infinite canvas" })).toBeTruthy();
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
    const canvasPersistence = createEphemeralCanvasDocumentPersistence();
    const requireJournal = async (
      identity: CanvasDocumentLoadPayload["identity"],
    ) => {
      const journal = await canvasPersistence.load(identity);
      if (journal === null) {
        throw new Error("Expected the test canvas journal to exist.");
      }
      return journal;
    };
    const runtimeClient: Pick<
      RuntimeClientV1,
      "sessions" | "canvasDocuments"
    > = {
      canvasDocuments: {
        open: vi.fn(async ({ snapshot }: CanvasDocumentOpenPayload) => {
          const existing = await canvasPersistence.load(snapshot.identity);
          if (existing !== null) {
            return { initialized: false, journal: existing };
          }
          await canvasPersistence.initialize(snapshot);
          return {
            initialized: true,
            journal: await requireJournal(snapshot.identity),
          };
        }),
        load: vi.fn(async ({ identity }: CanvasDocumentLoadPayload) => ({
          journal: await canvasPersistence.load(identity),
        })),
        initialize: vi.fn(async ({ snapshot }: CanvasDocumentInitializePayload) => {
          await canvasPersistence.initialize(snapshot);
          return { journal: await requireJournal(snapshot.identity) };
        }),
        append: vi.fn(async ({ append }: CanvasDocumentAppendPayload) => ({
          receipt: await canvasPersistence.append(append),
        })),
        checkpoint: vi.fn(async ({ snapshot }: CanvasDocumentCheckpointPayload) => {
          await canvasPersistence.checkpoint(snapshot);
          return { journal: await requireJournal(snapshot.identity) };
        }),
      },
      sessions: { migrateLegacy, restore, save },
    };
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
      documentId: expect.stringMatching(/^doc_/u),
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
      documentId: expect.stringMatching(/^doc_/u),
      session: {
        documentRevision: 2,
      },
    });
  });
});
