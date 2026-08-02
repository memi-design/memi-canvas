import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RUNTIME_ENTRY = resolve("apps/macos/runtime-sidecar/src/main.ts");
const BUN_EXECUTABLE = process.env.MEMI_RUNTIME_BUN ?? join(
  homedir(),
  ".bun",
  "bin",
  "bun",
);
const READY_TIMEOUT_MS = 20_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForSocket(
  socketPath: string,
  child: ReturnType<typeof spawn>,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (exited) {
      throw new Error("Packaged Memi runtime sidecar exited before opening its socket.");
    }
    try {
      if ((await lstat(socketPath)).isSocket()) return;
    } catch {
      // The sidecar has not completed durable startup recovery yet.
    }
    await sleep(100);
  }
  throw new Error("Packaged Memi runtime sidecar did not open its private socket.");
}

async function stop(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolvePromise) => {
    child.once("exit", () => resolvePromise());
  });
  child.kill("SIGTERM");
  await Promise.race([exited, sleep(2_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

await access(BUN_EXECUTABLE);
await access(RUNTIME_ENTRY);
const temporaryAppData = await mkdtemp(
  // Darwin limits Unix-domain socket paths to 104 bytes. Keep the smoke
  // fixture deliberately short so it exercises the packaged binary rather
  // than the operating-system path limit.
  join(tmpdir(), "mcs-"),
);
const appData = await realpath(temporaryAppData);
const managedWorktreeRoot = join(appData, "capture-worktrees");
const runtimeDirectory = join(appData, "r");
const socketPath = join(runtimeDirectory, "s");
const planKey = randomBytes(32).toString("hex");
await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
await writeFile(
  join(runtimeDirectory, "plan-integrity-v1.key"),
  planKey,
  { mode: 0o600 },
);

const child = spawn(BUN_EXECUTABLE, [RUNTIME_ENTRY], {
  env: {
    ...process.env,
    MEMI_RUNTIME_APP_DATA: appData,
    MEMI_RUNTIME_WORKTREE_ROOT: managedWorktreeRoot,
    MEMI_RUNTIME_PLAN_KEY: planKey,
    MEMI_RUNTIME_SOCKET: socketPath,
    MEMI_RUNTIME_TOKEN: randomBytes(32).toString("hex"),
  },
  stdio: ["ignore", "ignore", "pipe"],
});
const stderr: Buffer[] = [];
child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

try {
  await waitForSocket(socketPath, child);
  process.stdout.write(
    `${JSON.stringify({
      appData,
      bunExecutable: BUN_EXECUTABLE,
      runtimeEntry: RUNTIME_ENTRY,
      socketReady: true,
    })}\n`,
  );
} catch (error) {
  const diagnostic = Buffer.concat(stderr).toString("utf8").trim();
  throw new Error(
    diagnostic.length === 0
      ? (error instanceof Error ? error.message : "Runtime sidecar smoke failed.")
      : `${error instanceof Error ? error.message : "Runtime sidecar smoke failed."} ${diagnostic.slice(0, 2_000)}`,
  );
} finally {
  await stop(child);
  await rm(temporaryAppData, { force: true, recursive: true });
}
