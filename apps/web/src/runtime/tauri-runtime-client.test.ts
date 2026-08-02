import { describe, expect, it, vi } from "vitest";

import { createTauriRuntimeConnection } from "./tauri-runtime-client.js";

describe("Tauri runtime connection", () => {
  it("keeps the native session token out of RPC payloads and forwards authorization separately", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "runtime_session") {
        return { token: "native-private-token-with-at-least-32-bytes" };
      }
      if (command === "runtime_rpc") {
        const envelope = args?.envelope as {
          requestId: string;
          correlationId: string;
          method: string;
        };
        return {
          schemaVersion: 1,
          requestId: envelope.requestId,
          correlationId: envelope.correlationId,
          method: envelope.method,
          receivedAt: "2026-07-29T12:00:00.000Z",
          ok: true,
          result: {
            plan: {
              token: "ipl_01J00000000000000000000000",
              repository: {
                rootPath: "/tmp/product",
                sourceRevision: "a".repeat(40),
                dirtyFingerprint: null,
              },
              applications: [],
              scenarios: [],
              recipes: [],
              inventory: {
                fileCount: 0,
                screenCount: 0,
                componentCount: 0,
                tokenCount: 0,
                screens: [],
                components: [],
                tokens: [],
                truncated: {
                  screens: false,
                  components: false,
                  tokens: false,
                },
              },
              scenarioCount: 0,
              errors: [],
            },
          },
        };
      }
      return undefined;
    });
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
    const runtime = await createTauriRuntimeConnection(invoke as never);

    await runtime.client.imports.plan({ repositoryPath: "/tmp/product" });

    expect(invoke).toHaveBeenCalledWith(
      "runtime_rpc",
      expect.objectContaining({
        authorization:
          "Bearer native-private-token-with-at-least-32-bytes",
      }),
    );
    const lastCall = invoke.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    if (lastCall === undefined) {
      throw new Error("Expected a runtime RPC invocation.");
    }
    expect(
      JSON.stringify((lastCall[1] as Record<string, unknown>).envelope),
    ).not.toContain("native-private-token-with-at-least-32-bytes");
  });

  it("loads only a content artifact identity through the authenticated native boundary", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "runtime_session") {
        return { token: "native-private-token-with-at-least-32-bytes" };
      }
      if (command === "runtime_artifact") {
        return {
          artifactId: args?.artifactId,
          mimeType: "image/png",
          bytes: [137, 80, 78, 71],
        };
      }
      return undefined;
    });
    const runtime = await createTauriRuntimeConnection(invoke as never);

    await expect(
      runtime.loadArtifact("art_01J00000000000000000000000" as never),
    ).resolves.toEqual({
      artifactId: "art_01J00000000000000000000000",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    expect(invoke).toHaveBeenLastCalledWith("runtime_artifact", {
      authorization:
        "Bearer native-private-token-with-at-least-32-bytes",
      artifactId: "art_01J00000000000000000000000",
    });
  });

  it("authenticates reveal-logs requests instead of exposing an unguarded native command", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "runtime_session") {
        return { token: "native-private-token-with-at-least-32-bytes" };
      }
      return undefined;
    });
    const runtime = await createTauriRuntimeConnection(invoke as never);
    await runtime.revealLogs({
      id: "imp_01J00000000000000000000000",
    } as never);
    expect(invoke).toHaveBeenLastCalledWith("reveal_import_logs", {
      authorization:
        "Bearer native-private-token-with-at-least-32-bytes",
      jobId: "imp_01J00000000000000000000000",
    });
  });
});
