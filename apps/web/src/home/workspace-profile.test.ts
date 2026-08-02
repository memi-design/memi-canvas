import { describe, expect, it } from "vitest";

import {
  createWorkspaceProfilePersistence,
  DEFAULT_WORKSPACE_PROFILE,
} from "./workspace-profile.js";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("workspace profile persistence", () => {
  it("persists a compact local identity without accepting malformed data", () => {
    const storage = createStorage();
    const persistence = createWorkspaceProfilePersistence(storage);

    expect(persistence.load()).toEqual(DEFAULT_WORKSPACE_PROFILE);
    expect(
      persistence.save({
        kind: "memi-workspace-profile",
        schemaVersion: 1,
        userName: "Sarvesh",
        workspaceName: "Memi Studio",
      }),
    ).toBe(true);
    expect(persistence.load()).toMatchObject({
      userName: "Sarvesh",
      workspaceName: "Memi Studio",
    });

    storage.setItem(
      "memi.workspace-profile.v1",
      JSON.stringify({ userName: "Untrusted" }),
    );
    expect(persistence.load()).toEqual(DEFAULT_WORKSPACE_PROFILE);
  });
});
