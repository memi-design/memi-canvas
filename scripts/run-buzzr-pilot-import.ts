import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  resolveBuzzrPilotWorktreeRoot,
  selectBuzzrPilotScenarios,
} from "./buzzr-pilot-contract.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const APP_DATA = join(
  homedir(),
  "Library",
  "Application Support",
  "design.memi.canvas",
);
const REPOSITORY = process.env.MEMI_BUZZR_REPOSITORY;
if (REPOSITORY === undefined || REPOSITORY.trim().length === 0) {
  throw new Error(
    "Set MEMI_BUZZR_REPOSITORY to the local Buzzr checkout before running the pilot.",
  );
}
const MANAGED_WORKTREE_ROOT = resolveBuzzrPilotWorktreeRoot({
  configuredRoot: process.env.MEMI_BUZZR_PILOT_WORKTREE_ROOT,
  defaultRoot: join(
    homedir(),
    "Library",
    "Caches",
    "design.memi.canvas",
    "capture-worktrees",
  ),
  repositoryRoot: REPOSITORY,
});
const PACKAGED_SIDECAR = resolve(
  "apps/macos/src-tauri/binaries/memi-canvas-runtime-aarch64-apple-darwin",
);
const SIDECAR = process.env.MEMI_RUNTIME_EXECUTABLE ?? PACKAGED_SIDECAR;
const RESUME_JOB_ID = process.env.MEMI_BUZZR_PILOT_RESUME_JOB_ID;
const DISCARD_JOB_ID = process.env.MEMI_BUZZR_PILOT_DISCARD_JOB_ID;
if (RESUME_JOB_ID !== undefined && DISCARD_JOB_ID !== undefined) {
  throw new Error("Choose either resume or discard for a Buzzr pilot, not both.");
}
const sourceEntry = process.env.MEMI_RUNTIME_SOURCE_ENTRY;
if (
  sourceEntry !== undefined &&
  (!sourceEntry.startsWith(`${resolve("apps", "macos", "runtime-sidecar")}/`) ||
    !sourceEntry.endsWith(".ts"))
) {
  throw new Error("The development runtime entry must remain inside the sidecar source root.");
}
const SIDECAR_ARGS = sourceEntry === undefined ? [] : [sourceEntry];
const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 25 * 60_000;
const PAUSED_IMPORT_STATES = new Set(["paused", "failed", "cancelled", "committed"]);

interface RuntimeResponse {
  readonly ok: boolean;
  readonly result?: {
    readonly plan?: ImportPlan;
    readonly job?: ImportJob;
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

interface ImportPlan {
  readonly token: string;
  readonly recipes: readonly { readonly hash: string }[];
  readonly dependencyPreparations?: readonly {
    readonly planFingerprint: string;
  }[];
  readonly scenarios: readonly {
    readonly id: string;
    readonly route: string;
    readonly state: string;
  }[];
}

interface ImportJob {
  readonly id: string;
  readonly revision: number;
  readonly state: string;
  readonly stage: string;
  readonly progress: {
    readonly captured: number;
    readonly failed: number;
    readonly remaining: number;
    readonly total: number;
  };
  readonly failures: readonly unknown[];
  readonly projectId: string | null;
}

function identifier(prefix: "prq" | "cor"): string {
  const bytes = randomBytes(17);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let result = "";
  for (let index = 0; index < 26; index += 1) {
    result = CROCKFORD[Number(value & 31n)]! + result;
    value >>= 5n;
  }
  return `${prefix}_${result}`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForSocket(socketPath: string, child: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("The packaged runtime exited before the import could start.");
    }
    try {
      if ((await lstat(socketPath)).isSocket()) return;
    } catch {
      // The sidecar is completing its durable recovery before opening RPC.
    }
    await sleep(100);
  }
  throw new Error("The packaged runtime did not open its private socket.");
}

function exchange(
  socketPath: string,
  token: string,
  method: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<RuntimeResponse> {
  const envelope = {
    schemaVersion: 1,
    requestId: identifier("prq"),
    correlationId: identifier("cor"),
    method,
    sentAt: new Date().toISOString(),
    payload,
  };
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection(socketPath);
    let received = "";
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.on("data", (chunk: string) => {
      received += chunk;
      const boundary = received.indexOf("\n");
      if (boundary < 0) return;
      socket.end();
      try {
        resolvePromise(JSON.parse(received.slice(0, boundary)) as RuntimeResponse);
      } catch {
        reject(new Error("The packaged runtime returned invalid JSON."));
      }
    });
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ authorization: `Bearer ${token}`, envelope })}\n`);
    });
  });
}

function resultOrThrow(response: RuntimeResponse): NonNullable<RuntimeResponse["result"]> {
  if (response.ok && response.result !== undefined) return response.result;
  throw new Error(
    response.error === undefined
      ? "The packaged runtime returned an invalid import response."
      : `${response.error.code}: ${response.error.message}`,
  );
}

function summary(job: ImportJob): Record<string, unknown> {
  return {
    jobId: job.id,
    projectId: job.projectId,
    state: job.state,
    stage: job.stage,
    progress: job.progress,
    failures: job.failures.length,
  };
}

async function stop(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
  child.kill("SIGTERM");
  await Promise.race([exited, sleep(2_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

const planKey = (await readFile(join(APP_DATA, "runtime", "plan-integrity-v1.key"), "utf8")).trim();
if (!/^[a-f0-9]{64}$/iu.test(planKey)) {
  throw new Error("Memi's local import-plan authority is unavailable.");
}
const socketPath = join(APP_DATA, "runtime", `pilot-${randomBytes(4).toString("hex")}.sock`);
const token = randomBytes(32).toString("hex");
const sidecar = spawn(SIDECAR, SIDECAR_ARGS, {
  env: {
    ...process.env,
    MEMI_RUNTIME_APP_DATA: APP_DATA,
    MEMI_RUNTIME_WORKTREE_ROOT: MANAGED_WORKTREE_ROOT,
    MEMI_RUNTIME_PLAN_KEY: planKey,
    MEMI_RUNTIME_SOCKET: socketPath,
    MEMI_RUNTIME_TOKEN: token,
  },
  stdio: ["ignore", "ignore", "pipe"],
});
const stderr: Buffer[] = [];
sidecar.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
let activeJob: ImportJob | null = null;
let cancellationRequested = false;
let exceededDeadline = false;
const requestCancellation = () => {
  cancellationRequested = true;
};
process.once("SIGINT", requestCancellation);
process.once("SIGTERM", requestCancellation);

async function pauseActiveImport(): Promise<void> {
  if (activeJob === null || PAUSED_IMPORT_STATES.has(activeJob.state)) return;
  const latest = resultOrThrow(
    await exchange(socketPath, token, "imports.get", { jobId: activeJob.id }),
  ).job;
  if (latest === undefined || PAUSED_IMPORT_STATES.has(latest.state)) return;
  const paused = resultOrThrow(
    await exchange(socketPath, token, "imports.cancel", {
      jobId: latest.id,
      expectedRevision: latest.revision,
    }),
  ).job;
  if (paused !== undefined) {
    activeJob = paused;
    process.stdout.write(`${JSON.stringify({ event: "paused", ...summary(paused) })}\n`);
  }
}

try {
  await waitForSocket(socketPath, sidecar);
  if (DISCARD_JOB_ID !== undefined) {
    const current = resultOrThrow(
      await exchange(socketPath, token, "imports.get", { jobId: DISCARD_JOB_ID }),
    ).job;
    if (current === undefined) {
      throw new Error("The requested Buzzr pilot does not exist.");
    }
    const discarded = resultOrThrow(
      await exchange(socketPath, token, "imports.discard", {
        jobId: current.id,
        expectedRevision: current.revision,
      }),
    ).job;
    if (discarded === undefined) {
      throw new Error("The Buzzr pilot did not confirm its managed cleanup.");
    }
    process.stdout.write(`${JSON.stringify({ event: "discarded", ...summary(discarded) })}\n`);
    process.exitCode = 0;
  } else {
  let started: ImportJob | undefined;
  if (RESUME_JOB_ID !== undefined) {
    const current = resultOrThrow(
      await exchange(socketPath, token, "imports.get", { jobId: RESUME_JOB_ID }),
    ).job;
    if (current === undefined || current.state !== "paused") {
      throw new Error("The requested Buzzr pilot is not resumable.");
    }
    started = resultOrThrow(
      await exchange(socketPath, token, "imports.resume", {
        jobId: current.id,
        expectedRevision: current.revision,
      }),
    ).job;
  } else {
    const planned = resultOrThrow(
      await exchange(socketPath, token, "imports.plan", {
        repositoryPath: REPOSITORY,
        expoRuntime: "existing-development-client",
      }),
    ).plan;
    if (planned === undefined) throw new Error("The Buzzr import plan is missing.");
    const pilot = selectBuzzrPilotScenarios(planned.scenarios);
    const approvedRecipeHashes = [
      ...planned.recipes.map((recipe) => recipe.hash),
      ...(planned.dependencyPreparations ?? []).map((preparation) => preparation.planFingerprint),
    ];
    started = resultOrThrow(
      await exchange(socketPath, token, "imports.start", {
        repositoryPath: REPOSITORY,
        projectName: "Buzzr auth flow",
        selectedHarness: null,
        planToken: planned.token,
        approvedRecipeHashes,
        pilotScenarioIds: pilot.map(({ id }) => id),
      }),
    ).job;
  }
  if (started === undefined) throw new Error("The Buzzr pilot did not create a durable job.");
  activeJob = started;
  process.stdout.write(`${JSON.stringify({
    event: RESUME_JOB_ID === undefined ? "started" : "resumed",
    ...summary(started),
  })}\n`);

  const deadline = Date.now() + TIMEOUT_MS;
  let lastRevision = -1;
  while (Date.now() < deadline) {
    const current = resultOrThrow(
      await exchange(socketPath, token, "imports.get", { jobId: started.id }),
    ).job;
    if (current === undefined) throw new Error("The durable Buzzr pilot disappeared.");
    activeJob = current;
    if (current.revision !== lastRevision) {
      lastRevision = current.revision;
      process.stdout.write(`${JSON.stringify({ event: "progress", ...summary(current) })}\n`);
    }
    if (current.state === "ready-to-commit") {
      const committed = resultOrThrow(
        await exchange(socketPath, token, "imports.commit", {
          jobId: current.id,
          expectedRevision: current.revision,
        }),
      ).job;
      if (committed === undefined) {
        throw new Error("The verified Buzzr pilot did not return a committed project.");
      }
      process.stdout.write(`${JSON.stringify({ event: "committed", ...summary(committed) })}\n`);
      process.exitCode = 0;
      break;
    }
    if (cancellationRequested) {
      await pauseActiveImport();
      process.exitCode = 130;
      break;
    }
    if (["committed", "failed", "cancelled", "paused"].includes(current.state)) {
      process.stdout.write(`${JSON.stringify({ event: "terminal", ...summary(current) })}\n`);
      process.exitCode = current.state === "committed" ? 0 : 1;
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  if (Date.now() >= deadline) {
    exceededDeadline = true;
    throw new Error("The Buzzr pilot exceeded its bounded 25 minute window.");
  }
  }
} catch (error) {
  const diagnostic = Buffer.concat(stderr).toString("utf8").trim();
  const message = error instanceof Error ? error.message : "Buzzr pilot failed.";
  throw new Error(diagnostic.length === 0 ? message : `${message} ${diagnostic.slice(0, 2_000)}`);
} finally {
  try {
    if (cancellationRequested || exceededDeadline) {
      await pauseActiveImport();
    }
  } finally {
    process.off("SIGINT", requestCancellation);
    process.off("SIGTERM", requestCancellation);
  }
  await stop(sidecar);
}
