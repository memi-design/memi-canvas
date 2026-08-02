import type {
  ArtifactId,
  CorrelationId,
  ImportJobSnapshotV2,
  ProcessRequestId,
  RuntimePrivateTransportInput,
  RuntimePrivateTransport,
} from "@memi/protocol";
import {
  ArtifactIdSchema,
  CorrelationIdSchema,
  ProcessRequestIdSchema,
} from "@memi/protocol";

import {
  createRuntimeClientV1,
  type RuntimeClientV1,
} from "./runtime-client.js";

type NativeInvoke = <Result>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<Result>;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function sortableBody(random: Uint8Array): string {
  let value = 0n;
  for (const byte of random) value = (value << 8n) | BigInt(byte);
  return Array.from({ length: 26 }, () => {
    const character = CROCKFORD[Number(value & 31n)]!;
    value >>= 5n;
    return character;
  }).reverse().join("");
}

function randomBody(): string {
  const bytes = new Uint8Array(17);
  globalThis.crypto.getRandomValues(bytes);
  return sortableBody(bytes).slice(-26);
}

export interface TauriRuntimeConnection {
  readonly client: RuntimeClientV1;
  loadArtifact(artifactId: ArtifactId): Promise<{
    readonly artifactId: ArtifactId;
    readonly mimeType: "image/png" | "application/json";
    readonly bytes: Uint8Array;
  }>;
  revealLogs(job: ImportJobSnapshotV2): Promise<void>;
}

export async function createTauriRuntimeConnection(
  invokeOverride?: NativeInvoke,
): Promise<TauriRuntimeConnection> {
  if (
    invokeOverride === undefined &&
    !("__TAURI_INTERNALS__" in globalThis)
  ) {
    throw new Error("The authenticated Memi runtime requires the macOS app.");
  }
  const invoke =
    invokeOverride ??
    (await import("@tauri-apps/api/core")).invoke;
  const session = await invoke<{ readonly token: string }>(
    "runtime_session",
  );
  const transport: RuntimePrivateTransport = Object.freeze({
    async exchange(input: RuntimePrivateTransportInput) {
      return invoke("runtime_rpc", {
        authorization: input.authorization,
        envelope: input.envelope,
      });
    },
  });
  const client = createRuntimeClientV1({
    authToken: () => session.token,
    correlationId: () =>
      CorrelationIdSchema.parse(
        `cor_${randomBody()}`,
      ) as CorrelationId,
    now: () => new Date().toISOString(),
    requestId: () =>
      ProcessRequestIdSchema.parse(
        `prq_${randomBody()}`,
      ) as ProcessRequestId,
    transport,
  });
  const connection: TauriRuntimeConnection = {
    client,
    async loadArtifact(artifactId: ArtifactId) {
      const validatedId = ArtifactIdSchema.parse(artifactId);
      const response = await invoke<{
        readonly artifactId: unknown;
        readonly mimeType: unknown;
        readonly bytes: unknown;
      }>("runtime_artifact", {
        authorization: `Bearer ${session.token}`,
        artifactId: validatedId,
      });
      const returnedId = ArtifactIdSchema.parse(response.artifactId);
      if (
        returnedId !== validatedId ||
        !(
          response.mimeType === "image/png" ||
          response.mimeType === "application/json"
        ) ||
        !Array.isArray(response.bytes) ||
        response.bytes.length === 0 ||
        response.bytes.length > 32 * 1024 * 1024 ||
        response.bytes.some(
          (byte) =>
            !Number.isInteger(byte) ||
            Number(byte) < 0 ||
            Number(byte) > 255,
        )
      ) {
        throw new Error("The native runtime returned an invalid artifact.");
      }
      return Object.freeze({
        artifactId: returnedId,
        mimeType: response.mimeType,
        bytes: Uint8Array.from(response.bytes as number[]),
      });
    },
    async revealLogs(job: ImportJobSnapshotV2) {
      await invoke("reveal_import_logs", {
        authorization: `Bearer ${session.token}`,
        jobId: job.id,
      });
    },
  };
  return Object.freeze(connection);
}
