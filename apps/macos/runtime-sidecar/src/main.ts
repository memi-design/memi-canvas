import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { randomBytes } from "node:crypto";

import { ContentAddressedArtifactStore } from "@memi/capture-execution/core";
import {
  CaptureScenarioIdSchema,
  ImportJobIdSchema,
  projectIdForImportJob,
  WorktreeIdSchema,
} from "@memi/protocol";
import {
  BunSqliteImportJobStore,
  BunSqliteImportPlanStore,
  BunSqliteCommittedImportedProjectStore,
  BunSqliteCanvasDocumentV3PersistencePort,
  ImportCoordinator,
  createCaptureRepositoryPort,
  createImportRuntimePurgeAuthority,
  createImportRuntimeStorageBudgetAuthority,
  createImportRuntimeService,
  importRuntimeStoragePaths,
} from "@memi/runtime/bun-import-stores";

import { createNativeCapturePorts } from "./native-capture-ports.js";
import {
  createPendingResponseFrame,
  flushPendingResponseFrame,
  type PendingResponseFrame,
} from "./framed-response.js";
import { createSidecarRpcHandler } from "./rpc.js";
import { createCanvasDocumentJournalRpcService } from "./canvas-document-journal-service.js";
import {
  garbageCollectRuntimeAtStartup,
  recoverRuntimeBeforeServing,
} from "./runtime-startup-recovery.js";
import { estimateImportStorage } from "./runtime-storage-estimate.js";
import {
  acquireRuntimeLease,
  monitorParentProcess,
  optionalParentPid,
} from "./runtime-lease.js";

const MAX_MESSAGE_BYTES = 262_144;

interface RuntimeSocket<Data> {
  data: Data;
  write(data: Uint8Array): number;
  end(): void;
}

declare const Bun: {
  listen<Data>(options: {
    readonly unix: string;
    readonly socket: {
      open(socket: RuntimeSocket<Data>): void;
      data(socket: RuntimeSocket<Data>, chunk: Uint8Array): void;
      drain(socket: RuntimeSocket<Data>): void;
      error(socket: RuntimeSocket<Data>, error: Error): void;
    };
  }): {
    stop(force?: boolean): void;
  };
};

interface RuntimeSocketData {
  readonly buffer: Uint8Array;
  readonly response: PendingResponseFrame | null;
}

function flushResponse(socket: RuntimeSocket<RuntimeSocketData>): void {
  const response = socket.data.response;
  if (response === null) return;
  const pending = flushPendingResponseFrame(response, socket);
  socket.data = {
    buffer: socket.data.buffer,
    response: pending,
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0 || value.includes("\0")) {
    throw new Error(`Missing required runtime setting ${name}.`);
  }
  return value;
}

function containedSocketPath(appData: string, socketPath: string): string {
  if (!isAbsolute(appData) || !isAbsolute(socketPath)) {
    throw new Error("Runtime storage paths must be absolute.");
  }
  const root = resolve(appData);
  const candidate = resolve(socketPath);
  if (
    root === "/" ||
    candidate === root ||
    !candidate.startsWith(`${root}/`)
  ) {
    throw new Error("Runtime socket must remain inside Memi app data.");
  }
  return candidate;
}

function identifier<Prefix extends string>(
  prefix: Prefix,
): `${Prefix}_${string}` {
  return `${prefix}_${randomBytes(13).toString("hex").toUpperCase()}`;
}

async function start(): Promise<void> {
  const authToken = requiredEnvironment("MEMI_RUNTIME_TOKEN");
  const appData = requiredEnvironment("MEMI_RUNTIME_APP_DATA");
  const managedWorktreeRoot = requiredEnvironment(
    "MEMI_RUNTIME_WORKTREE_ROOT",
  );
  const planKeyHex = requiredEnvironment("MEMI_RUNTIME_PLAN_KEY");
  if (!/^[a-f0-9]{64}$/iu.test(planKeyHex)) {
    throw new Error("Runtime plan integrity authority is invalid.");
  }
  const socketPath = containedSocketPath(
    appData,
    requiredEnvironment("MEMI_RUNTIME_SOCKET"),
  );
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  const lease = await acquireRuntimeLease({ appData });
  try {
  await rm(socketPath, { force: true });
  const paths = importRuntimeStoragePaths(appData, {
    managedWorktreeRoot,
  });
  await mkdir(paths.worktrees, { recursive: true, mode: 0o700 });
  const artifactStore = new ContentAddressedArtifactStore(paths.artifacts);
  const storageBudgetAuthority =
    createImportRuntimeStorageBudgetAuthority({
      paths,
      artifactStore,
    });
  const native = await createNativeCapturePorts({
    appDataRoot: appData,
    artifactStore,
    managedWorktreeRoot: paths.worktrees,
  });
  const purgeAuthority = createImportRuntimePurgeAuthority({
    appDataRoot: appData,
    externalWorktreeRoot: paths.worktrees,
    artifactStore,
    purgeManagedSimulator: native.purgeManagedSimulator,
    activeJobLocks: storageBudgetAuthority,
  });
  const coordinator = new ImportCoordinator({
    store: new BunSqliteImportJobStore(paths.database),
    planStore: new BunSqliteImportPlanStore(
      paths.database,
      Buffer.from(planKeyHex, "hex"),
    ),
    committedProjectStore: new BunSqliteCommittedImportedProjectStore(
      paths.database,
    ),
    artifactStore,
    storageBudgetAuthority,
    storageBudgetEstimateFor: estimateImportStorage,
    purgeAuthority,
    repository: createCaptureRepositoryPort({
      managedRoot: paths.worktrees,
      createCaptureId: () => `capture-${randomBytes(13).toString("hex")}`,
      createWorktreeId: () =>
        WorktreeIdSchema.parse(identifier("wrk")),
    }),
    adapterFor: native.adapterFor,
    approvalAuthority: native.approvalAuthority,
    nativeDependencyPreparationFor:
      native.nativeDependencyPreparationFor,
    createJobId: () => ImportJobIdSchema.parse(identifier("imp")),
    createScenarioId: () =>
      CaptureScenarioIdSchema.parse(identifier("csc")),
    createProjectId: (job) => projectIdForImportJob(job.id),
    ...(native.resolveFixture === undefined
      ? {}
      : { resolveFixture: native.resolveFixture }),
  });
  const startupRecovery = {
    purgeAuthority,
    coordinator,
    storageBudgetAuthority,
  } as const;
  await recoverRuntimeBeforeServing(startupRecovery);
  const imports = createImportRuntimeService(coordinator);
  const canvasDocumentPort = new BunSqliteCanvasDocumentV3PersistencePort(
    paths.database,
  );
  const canvasDocuments = createCanvasDocumentJournalRpcService({
    port: canvasDocumentPort,
  });
  const handle = createSidecarRpcHandler({
    authToken,
    imports,
    canvasDocuments,
  });
  const server = Bun.listen<RuntimeSocketData>({
    unix: socketPath,
    socket: {
      open(socket) {
        socket.data = {
          buffer: new Uint8Array(),
          response: null,
        };
      },
      data(socket, chunk) {
        if (socket.data.response !== null) return;
        const combined = new Uint8Array(
          socket.data.buffer.byteLength + chunk.byteLength,
        );
        combined.set(socket.data.buffer);
        combined.set(chunk, socket.data.buffer.byteLength);
        socket.data = {
          buffer: combined,
          response: null,
        };
        if (combined.byteLength > MAX_MESSAGE_BYTES + 1) {
          socket.end();
          return;
        }
        const newline = combined.indexOf(10);
        if (newline < 0) return;
        const frame = combined.slice(0, newline);
        socket.data = {
          buffer: combined.slice(newline + 1),
          response: null,
        };
        void (async () => {
          try {
            const input = JSON.parse(new TextDecoder().decode(frame)) as {
              readonly authorization: unknown;
              readonly envelope: unknown;
            };
            const response = await handle(input);
            socket.data = {
              buffer: socket.data.buffer,
              response: createPendingResponseFrame(
                JSON.stringify(response),
                MAX_MESSAGE_BYTES,
              ),
            };
            flushResponse(socket);
          } catch {
            socket.end();
          }
        })();
      },
      drain(socket) {
        try {
          flushResponse(socket);
        } catch {
          socket.end();
        }
      },
      error() {
        // The Rust broker owns public error reporting and never exposes raw IO.
      },
    },
  });
  await chmod(socketPath, 0o600);
  void garbageCollectRuntimeAtStartup(startupRecovery).catch(() => {
    // Cleanup is intentionally best-effort after durable recovery. A later
    // launch retries it; the private RPC must not be held behind file scans.
  });
  const stop = (): void => {
    server.stop(true);
    canvasDocumentPort.close();
    void rm(socketPath, { force: true });
    void lease.release();
  };
  const stopMonitoringParent = monitorParentProcess({
    parentPid: optionalParentPid(process.env.MEMI_RUNTIME_PARENT_PID),
    onParentExit: stop,
  });
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.once("exit", stopMonitoringParent);
  } catch (error) {
    await lease.release();
    throw error;
  }
}

await start();
