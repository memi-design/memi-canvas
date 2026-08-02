import { z } from "zod";

export const WORKSPACE_PROFILE_KEY = "memi.workspace-profile.v1";

export interface WorkspaceProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WorkspaceProfile {
  readonly kind: "memi-workspace-profile";
  readonly schemaVersion: 1;
  readonly userName: string;
  readonly workspaceName: string;
}

const WorkspaceProfileSchema = z.strictObject({
  kind: z.literal("memi-workspace-profile"),
  schemaVersion: z.literal(1),
  userName: z.string().trim().min(1).max(64),
  workspaceName: z.string().trim().min(1).max(96),
});

export const DEFAULT_WORKSPACE_PROFILE: WorkspaceProfile = Object.freeze({
  kind: "memi-workspace-profile",
  schemaVersion: 1,
  userName: "Designer",
  workspaceName: "Memi Workspace",
});

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function createWorkspaceProfilePersistence(
  storage: WorkspaceProfileStorage,
) {
  return Object.freeze({
    load(): WorkspaceProfile {
      try {
        const raw = storage.getItem(WORKSPACE_PROFILE_KEY);
        if (raw === null || byteLength(raw) > 1_024) {
          return DEFAULT_WORKSPACE_PROFILE;
        }
        return WorkspaceProfileSchema.safeParse(JSON.parse(raw)).data ??
          DEFAULT_WORKSPACE_PROFILE;
      } catch {
        return DEFAULT_WORKSPACE_PROFILE;
      }
    },
    save(profile: WorkspaceProfile): boolean {
      const parsed = WorkspaceProfileSchema.safeParse(profile);
      if (!parsed.success) return false;
      try {
        const serialized = JSON.stringify(parsed.data);
        if (byteLength(serialized) > 1_024) return false;
        storage.setItem(WORKSPACE_PROFILE_KEY, serialized);
        return true;
      } catch {
        return false;
      }
    },
  });
}
