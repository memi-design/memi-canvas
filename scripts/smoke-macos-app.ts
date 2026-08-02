import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { access, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  findPackagedRuntimeSidecar,
  formatDirectChildDiagnostic,
  macOsVisibleWindowProbe,
  macOsWindowDiagnosticProbe,
  macOsProcessListArguments,
  type ProcessRow,
} from "./smoke-macos-app-process.js";

const APP_PATH = resolve(
  "apps/macos/src-tauri/target/debug/bundle/macos/Memi Canvas.app",
);
const EXECUTABLE_PATH = resolve(
  APP_PATH,
  "Contents/MacOS/memi-canvas-macos",
);
const RUNTIME_SIDECAR_PATH = resolve(
  APP_PATH,
  "Contents/MacOS/memi-canvas-runtime",
);
const RUNTIME_BUN_PATH = resolve(
  APP_PATH,
  "Contents/Resources/runtime/memi-canvas-bun",
);
const RUNTIME_ENTRY_PATH = resolve(
  APP_PATH,
  "Contents/Resources/runtime/memi-canvas-runtime/main.js",
);
const MAX_ATTEMPTS = 80;
const RPC_PROBE_TIMEOUT_MS = 5_000;
// Must match the native bridge's bounded Unix-domain transport path. The full
// path has a strict length limit on macOS, so storage remains descriptive while
// the private socket address stays compact.
const SOCKET_RELATIVE_PATH = join("r", "s");
function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function commandOutput(
  command: string,
  args: readonly string[],
): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString("utf8"));
      } else {
        reject(
          new Error(
            `${command} failed: ${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
      }
    });
  });
}

async function processRows(): Promise<readonly ProcessRow[]> {
  const stdout = await commandOutput("/bin/ps", macOsProcessListArguments());
  return stdout
    .split("\n")
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
      return match === null
        ? null
        : {
            pid: Number(match[1]),
            parentPid: Number(match[2]),
            command: match[3],
          };
    })
    .filter((row): row is ProcessRow => row !== null);
}

async function waitForWindow(appProcessId: number): Promise<number> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const stdout = await commandOutput("/usr/bin/swift", [
      "-e",
      macOsVisibleWindowProbe(appProcessId),
    ]).catch(() => "0");
    const windowCount = Number(stdout.trim());
    if (Number.isSafeInteger(windowCount) && windowCount > 0) return windowCount;
    await sleep(250);
  }
  const diagnostic = await commandOutput("/usr/bin/swift", [
    "-e",
    macOsWindowDiagnosticProbe(appProcessId),
  ])
    .then((stdout) => stdout.trim().slice(0, 500))
    .catch(() => "windowDiagnostics=unavailable");
  throw new Error(
    `Packaged Memi Canvas launched without a visible native window. ${diagnostic}`,
  );
}

async function waitForPackagedRuntimeSidecar(
  appProcessId: number,
): Promise<ProcessRow> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const sidecar = findPackagedRuntimeSidecar(
      await processRows(),
      appProcessId,
      RUNTIME_BUN_PATH,
      RUNTIME_ENTRY_PATH,
    );
    if (sidecar !== undefined) return sidecar;
    await sleep(250);
  }
  throw new Error(
    "Packaged Memi Canvas did not launch its bundled runtime sidecar. " +
      "A source Bun runtime or a separate smoke process does not satisfy this gate.",
  );
}

async function terminate(child: ReturnType<typeof spawn>): Promise<void> {
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

async function waitForRuntimeSocket(socketPath: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      if ((await lstat(socketPath)).isSocket()) return;
    } catch {
      // Socket may still be starting.
    }
    await sleep(250);
  }
  throw new Error("Packaged Memi Canvas did not expose the runtime socket.");
}

async function probeRuntimeSocket(socketPath: string): Promise<void> {
  const request = JSON.stringify({
    authorization: "Bearer invalid",
    envelope: {
      schemaVersion: 1,
      requestId: "req_01J00000000000000000000000",
      correlationId: "cor_01J00000000000000000000000",
      sentAt: "2026-08-02T16:20:00.000Z",
      method: "imports.list",
      payload: {},
    },
  });
  const response = await new Promise<unknown>((resolvePromise, reject) => {
    const socket = createConnection(socketPath);
    socket.setEncoding("utf8");
    socket.setTimeout(RPC_PROBE_TIMEOUT_MS);
    let frame = "";
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.once("error", fail);
    socket.once("timeout", () => {
      fail(new Error("Packaged runtime socket did not respond before the probe timeout."));
    });
    socket.on("data", (chunk: string) => {
      frame += chunk;
      const newline = frame.indexOf("\n");
      if (newline < 0 || settled) return;
      settled = true;
      socket.end();
      try {
        resolvePromise(JSON.parse(frame.slice(0, newline)));
      } catch {
        reject(new Error("Packaged runtime socket returned malformed JSON."));
      }
    });
    socket.once("connect", () => {
      socket.write(`${request}\n`);
    });
  });
  if (
    response === null ||
    typeof response !== "object" ||
    (response as { readonly error?: { readonly code?: unknown } }).error?.code !==
      "UNAUTHENTICATED"
  ) {
    throw new Error(
      "Packaged runtime socket did not return the expected authentication failure.",
    );
  }
}

await Promise.all([
  access(EXECUTABLE_PATH),
  access(RUNTIME_SIDECAR_PATH),
  access(RUNTIME_BUN_PATH),
  access(RUNTIME_ENTRY_PATH),
]);
const storageRoot = await mkdtemp(join(tmpdir(), "memi-canvas-app-smoke-"));
const runtimeSocketPath = join(storageRoot, SOCKET_RELATIVE_PATH);
const app = spawn(EXECUTABLE_PATH, [], {
  env: {
    ...process.env,
    MEMI_CANVAS_RUNTIME_STORAGE_ROOT: storageRoot,
    MEMI_RUNTIME_DIAGNOSTICS: "stderr",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
const stderr: Buffer[] = [];
app.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

try {
  if (app.pid === undefined) {
    throw new Error("Packaged Memi Canvas did not return a process identifier.");
  }
  const [windowCount, sidecar] = await Promise.all([
    waitForWindow(app.pid),
    waitForPackagedRuntimeSidecar(app.pid),
    waitForRuntimeSocket(runtimeSocketPath),
  ]);
  await probeRuntimeSocket(runtimeSocketPath);
  process.stdout.write(
    `${JSON.stringify({
      appPath: APP_PATH,
      executablePath: EXECUTABLE_PATH,
      packagedRuntimePath: RUNTIME_SIDECAR_PATH,
      runtimeProcessId: sidecar.pid,
      runtimeSocketPath,
      runtimeSocketReady: true,
      runtimeRpcProbe: "UNAUTHENTICATED",
      windowCount,
      authenticatedRuntimeRpc: "imports.list (startup health check)",
    })}\n`,
  );
} catch (error) {
  const diagnostic = Buffer.concat(stderr).toString("utf8").trim();
  const childDiagnostic =
    app.pid === undefined
      ? "appPid=unavailable"
      : formatDirectChildDiagnostic(await processRows().catch(() => []), app.pid);
  const socketDiagnostic = await lstat(runtimeSocketPath)
    .then((metadata) => `socketReady=${metadata.isSocket()}`)
    .catch(() => "socketReady=false");
  const smokeDiagnostic = `${childDiagnostic} ${socketDiagnostic}`;
  throw new Error(
    diagnostic.length === 0
      ? `${error instanceof Error ? error.message : "Packaged macOS smoke failed."} ${smokeDiagnostic}`
      : `${error instanceof Error ? error.message : "Packaged macOS smoke failed."} ${smokeDiagnostic} ${diagnostic.slice(0, 2_000)}`,
  );
} finally {
  await terminate(app);
  await rm(storageRoot, { force: true, recursive: true });
}
