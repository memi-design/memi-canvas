import { z } from "zod";

import {
  createWorkspaceSessionDraft,
  type WorkspaceSessionRuntimePortV1,
} from "@memi/protocol";

import { CANVAS_AUTOSAVE_MAX_BYTES, canvasAutosaveKey } from "./persistence.js";

const LegacyAutosaveSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("memi-canvas-autosave"),
    documentId: z.string().trim().min(1).max(256),
    sourceFingerprint: z
      .string()
      .regex(/^fnv1a64:[a-f0-9]{16}$/u),
    scene: z
      .strictObject({
        nodes: z
          .array(
            z
              .object({ id: z.string().trim().min(1).max(256) })
              .passthrough(),
          )
          .max(1_000),
        selectedNodeId: z.string().trim().min(1).max(256).nullable(),
        revision: z.number().int().nonnegative(),
        past: z.array(z.unknown()).max(20),
        future: z.array(z.unknown()).max(20),
        nextHistoryId: z.number().int().positive(),
      })
      .superRefine((scene, context) => {
        const ids = scene.nodes.map(({ id }) => id);
        if (new Set(ids).size !== ids.length) {
          context.addIssue({
            code: "custom",
            message: "Legacy canvas node identities must be unique.",
            path: ["nodes"],
          });
        }
        if (
          scene.selectedNodeId !== null &&
          !ids.includes(scene.selectedNodeId)
        ) {
          context.addIssue({
            code: "custom",
            message: "Legacy canvas selection must reference a live node.",
            path: ["selectedNodeId"],
          });
        }
      }),
    trace: z.array(z.unknown()).max(100),
  });

export interface LegacyWorkspaceSessionStorage {
  getItem(key: string): string | null;
}

export interface MigrateLegacyWorkspaceSessionInput {
  readonly projectId: string;
  readonly documentId: string;
  readonly sourceRevision: string | null;
  readonly expectedLegacySourceFingerprint: `fnv1a64:${string}`;
  readonly storage: LegacyWorkspaceSessionStorage;
  readonly runtime: WorkspaceSessionRuntimePortV1;
}

export type LegacyWorkspaceSessionMigrationStatus =
  | "missing"
  | "unavailable"
  | "invalid"
  | "migrated"
  | "already-migrated"
  | "session-exists";

export function workspaceSessionLegacyKey(documentId: string): string {
  return canvasAutosaveKey(documentId);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function fnv1a64(value: string): `fnv1a64:${string}` {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

export async function migrateLegacyWorkspaceSession(
  input: MigrateLegacyWorkspaceSessionInput,
): Promise<LegacyWorkspaceSessionMigrationStatus> {
  const key = workspaceSessionLegacyKey(input.documentId);
  let serialized: string | null;
  try {
    serialized = input.storage.getItem(key);
  } catch {
    return "unavailable";
  }
  if (serialized === null) {
    return "missing";
  }
  if (byteLength(serialized) > CANVAS_AUTOSAVE_MAX_BYTES) {
    return "invalid";
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized) as unknown;
  } catch {
    return "invalid";
  }
  const parsed = LegacyAutosaveSchema.safeParse(candidate);
  if (
    !parsed.success ||
    parsed.data.documentId !== input.documentId ||
    parsed.data.sourceFingerprint !==
      input.expectedLegacySourceFingerprint
  ) {
    return "invalid";
  }

  const session = createWorkspaceSessionDraft({
    projectId: input.projectId,
    documentId: input.documentId,
    documentRevision: parsed.data.scene.revision,
    sourceRevision: input.sourceRevision,
  });
  const selectedId = parsed.data.scene.selectedNodeId;
  const migration = await input.runtime.migrateLegacy({
    migrationKey: `local-storage:${key}`,
    legacyRecordHash: fnv1a64(serialized),
    session:
      selectedId === null
        ? session
        : {
            ...session,
            selection: {
              selectedIds: [selectedId],
              anchorId: selectedId,
              focusedNodeId: selectedId,
              editingNodeId: null,
            },
          },
  });
  return migration.status;
}
