import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

const LEASE_FILE = "sidecar-v1.lease";
const MAX_LEASE_BYTES = 512;

interface LeaseRecord {
  readonly schemaVersion: 1;
  readonly pid: number;
  readonly nonce: string;
}

export interface RuntimeLease {
  readonly path: string;
  release(): Promise<void>;
}

export interface RuntimeLeaseOptions {
  readonly appData: string;
  readonly pid?: number;
  readonly nonce?: string;
  readonly processExists?: (pid: number) => boolean;
}

export interface ParentProcessMonitorOptions {
  readonly parentPid: number | null;
  readonly onParentExit: () => void;
  readonly processExists?: (pid: number) => boolean;
  readonly setInterval?: (callback: () => void, milliseconds: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

function validPid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 1;
}

function validNonce(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/iu.test(value);
}

function processIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

function parseLease(value: string): LeaseRecord | null {
  if (Buffer.byteLength(value, "utf8") > MAX_LEASE_BYTES) return null;
  try {
    const candidate = JSON.parse(value) as Record<string, unknown>;
    if (
      Object.keys(candidate).sort().join(",") !== "nonce,pid,schemaVersion" ||
      candidate.schemaVersion !== 1 ||
      !validPid(candidate.pid) ||
      !validNonce(candidate.nonce)
    ) {
      return null;
    }
    return Object.freeze({
      schemaVersion: 1,
      pid: candidate.pid,
      nonce: candidate.nonce.toLowerCase(),
    });
  } catch {
    return null;
  }
}

async function existingLease(path: string): Promise<LeaseRecord | null> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Runtime lease path is unsafe.");
  }
  return parseLease(await readFile(path, "utf8"));
}

export async function acquireRuntimeLease(
  options: RuntimeLeaseOptions,
): Promise<RuntimeLease> {
  const runtimeDirectory = join(options.appData, "runtime");
  const path = join(runtimeDirectory, LEASE_FILE);
  const pid = options.pid ?? process.pid;
  const nonce = (options.nonce ?? randomBytes(16).toString("hex")).toLowerCase();
  const processExists = options.processExists ?? processIsLive;
  if (!validPid(pid) || !validNonce(nonce)) {
    throw new Error("Runtime lease identity is invalid.");
  }
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  const record = JSON.stringify({ schemaVersion: 1, pid, nonce });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(record, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return Object.freeze({
        path,
        async release() {
          try {
            const current = await existingLease(path);
            if (current?.pid === pid && current.nonce === nonce) {
              await rm(path, { force: true });
            }
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
              throw error;
            }
          }
        },
      });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw new Error("Runtime lease could not be created.", { cause: error });
      }
      const current = await existingLease(path);
      if (current !== null && processExists(current.pid)) {
        throw new Error("Another Memi runtime sidecar is already active.");
      }
      await rm(path, { force: false });
    }
  }
  throw new Error("Runtime lease could not be claimed.");
}

export function monitorParentProcess(
  options: ParentProcessMonitorOptions,
): () => void {
  if (options.parentPid === null) return () => undefined;
  const processExists = options.processExists ?? processIsLive;
  const schedule = options.setInterval ?? ((callback, milliseconds) =>
    globalThis.setInterval(callback, milliseconds));
  const cancel = options.clearInterval ?? ((handle: unknown) =>
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>));
  let stopped = false;
  const handle = schedule(() => {
    if (stopped || processExists(options.parentPid!)) return;
    stopped = true;
    cancel(handle);
    options.onParentExit();
  }, 1_000);
  return () => {
    if (!stopped) {
      stopped = true;
      cancel(handle);
    }
  };
}

export function optionalParentPid(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/u.test(value)) return null;
  const pid = Number(value);
  return validPid(pid) ? pid : null;
}
