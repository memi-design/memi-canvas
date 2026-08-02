import { z } from "zod";

import {
  CanvasDocumentV3Schema,
  CanvasPageIdSchema,
  type CanvasDocumentV3,
  type CanvasPageId,
  type CanvasSingleActionIntentV3,
} from "@memi/protocol";
import { mapLegacyCanvasIdV2 } from "@memi/canvas-document";

import {
  createCanvasPagesState,
  createEmptyCanvasScene,
  IMPORTED_CANVAS_PAGE_ID,
  type CanvasPagesState,
} from "./canvas-pages.js";
import type { CanvasStorage } from "./persistence.js";
import type { SceneState } from "./model.js";

const STORAGE_PREFIX = "memi.canvas.workspace.v1:";
const MAX_WORKSPACE_BYTES = 65_536;
const MAX_LOCAL_PAGES = 100;
const safeId = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9-]*$/u);

const WorkspaceManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("memi-canvas-workspace"),
    workspaceId: z.string().min(1).max(512),
    activePageId: safeId,
    nextLocalPageNumber: z.number().int().positive().max(1_000_000),
    localPages: z
      .array(
        z.strictObject({
          id: safeId,
          name: z.string().trim().min(1).max(256),
        }),
      )
      .max(MAX_LOCAL_PAGES),
  })
  .superRefine((manifest, context) => {
    const ids = manifest.localPages.map(({ id }) => id);
    if (
      new Set(ids).size !== ids.length ||
      ids.includes(IMPORTED_CANVAS_PAGE_ID)
    ) {
      context.addIssue({
        code: "custom",
        message: "Canvas workspace contains colliding page identities.",
        path: ["localPages"],
      });
    }
    const knownIds = new Set([IMPORTED_CANVAS_PAGE_ID, ...ids]);
    if (!knownIds.has(manifest.activePageId)) {
      context.addIssue({
        code: "custom",
        message: "Canvas workspace active page does not exist.",
        path: ["activePageId"],
      });
    }
  });

export interface CanvasWorkspacePersistence {
  load(
    workspaceId: string,
    importedScene: SceneState,
  ): CanvasPagesState | null;
  save(workspaceId: string, state: CanvasPagesState): boolean;
}

export interface LegacyCanvasWorkspaceV3Migration {
  readonly actions: readonly CanvasSingleActionIntentV3[];
  readonly activePageId: CanvasPageId;
  readonly legacyRecordHash: `fnv1a64:${string}`;
  readonly migrationKey: `local-storage:${string}`;
  readonly pageIdsByLegacyId: Readonly<Record<string, CanvasPageId>>;
  readonly strategy: "legacy-workspace-manifest-to-v3-page-operations";
}

export function canvasWorkspaceKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(workspaceId)}`;
}

function validWorkspaceId(workspaceId: string): boolean {
  return workspaceId.length > 0 && workspaceId.length <= 512;
}

function fnv1a64(value: string): `fnv1a64:${string}` {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function migratedPageId(workspaceId: string, legacyPageId: string): CanvasPageId {
  const mapped = mapLegacyCanvasIdV2(
    "document",
    `${workspaceId}:workspace-page:${legacyPageId}`,
  ).canonicalId;
  return CanvasPageIdSchema.parse(`pag_${mapped.slice(4)}`);
}

/**
 * Reads the former localStorage page manifest as a one-time migration source.
 * The result contains semantic page intents only; legacy scenes and snapshots
 * never cross into the V3 journal.
 */
export function readLegacyCanvasWorkspaceV3Migration(
  storage: Pick<CanvasStorage, "getItem">,
  workspaceId: string,
  untrustedDocument: CanvasDocumentV3,
): LegacyCanvasWorkspaceV3Migration | null {
  if (!validWorkspaceId(workspaceId)) {
    return null;
  }
  const key = canvasWorkspaceKey(workspaceId);
  try {
    const serialized = storage.getItem(key);
    if (
      serialized === null ||
      new TextEncoder().encode(serialized).byteLength > MAX_WORKSPACE_BYTES
    ) {
      return null;
    }
    const parsed = WorkspaceManifestSchema.safeParse(JSON.parse(serialized));
    const document = CanvasDocumentV3Schema.safeParse(untrustedDocument);
    if (
      !parsed.success ||
      parsed.data.workspaceId !== workspaceId ||
      !document.success
    ) {
      return null;
    }
    const importedPageId =
      document.data.pageIds.find(
        (pageId) => document.data.pagesById[pageId]?.kind === "imported",
      ) ?? document.data.pageIds[0];
    if (importedPageId === undefined) {
      return null;
    }
    const localIds = Object.fromEntries(
      parsed.data.localPages.map(({ id }) => [
        id,
        migratedPageId(workspaceId, id),
      ]),
    ) as Readonly<Record<string, CanvasPageId>>;
    const pageIdsByLegacyId: Readonly<Record<string, CanvasPageId>> = Object.freeze({
      [IMPORTED_CANVAS_PAGE_ID]: importedPageId,
      ...localIds,
    });
    const activePageId = pageIdsByLegacyId[parsed.data.activePageId];
    if (activePageId === undefined) {
      return null;
    }
    const actions = Object.freeze(
      parsed.data.localPages.map(({ id, name }): CanvasSingleActionIntentV3 => {
        const pageId = pageIdsByLegacyId[id];
        if (pageId === undefined) {
          throw new Error("Legacy workspace page mapping is incomplete.");
        }
        return {
          type: "page.define" as const,
          payload: {
            pageId,
            next: {
              id: pageId,
              kind: "design" as const,
              name,
              rootIds: [],
            },
          },
        };
      }),
    );
    return Object.freeze({
      actions,
      activePageId,
      legacyRecordHash: fnv1a64(serialized),
      migrationKey: `local-storage:${key}`,
      pageIdsByLegacyId,
      strategy: "legacy-workspace-manifest-to-v3-page-operations",
    });
  } catch {
    return null;
  }
}

/** @deprecated Migration-only localStorage adapter. */
export function createCanvasWorkspacePersistence(
  storage: CanvasStorage,
): CanvasWorkspacePersistence {
  return {
    load(workspaceId, importedScene) {
      if (!validWorkspaceId(workspaceId)) {
        return null;
      }
      try {
        const serialized = storage.getItem(canvasWorkspaceKey(workspaceId));
        if (
          serialized === null ||
          new TextEncoder().encode(serialized).byteLength >
            MAX_WORKSPACE_BYTES
        ) {
          return null;
        }
        const parsed = WorkspaceManifestSchema.safeParse(
          JSON.parse(serialized),
        );
        if (
          !parsed.success ||
          parsed.data.workspaceId !== workspaceId
        ) {
          return null;
        }
        const initial = createCanvasPagesState(importedScene);
        return {
          pages: [
            ...initial.pages,
            ...parsed.data.localPages.map((page) => ({
              ...page,
              kind: "local" as const,
              scene: createEmptyCanvasScene(),
            })),
          ],
          activePageId: parsed.data.activePageId,
          nextLocalPageNumber: parsed.data.nextLocalPageNumber,
        };
      } catch {
        return null;
      }
    },
    save(workspaceId, state) {
      if (!validWorkspaceId(workspaceId)) {
        return false;
      }
      try {
        const payload = {
          schemaVersion: 1 as const,
          kind: "memi-canvas-workspace" as const,
          workspaceId,
          activePageId: state.activePageId,
          nextLocalPageNumber: state.nextLocalPageNumber,
          localPages: state.pages
            .filter(({ kind }) => kind === "local")
            .map(({ id, name }) => ({ id, name })),
        };
        const parsed = WorkspaceManifestSchema.safeParse(payload);
        if (!parsed.success) {
          return false;
        }
        const serialized = JSON.stringify(parsed.data);
        if (
          new TextEncoder().encode(serialized).byteLength >
          MAX_WORKSPACE_BYTES
        ) {
          return false;
        }
        storage.setItem(canvasWorkspaceKey(workspaceId), serialized);
        return true;
      } catch {
        return false;
      }
    },
  };
}
