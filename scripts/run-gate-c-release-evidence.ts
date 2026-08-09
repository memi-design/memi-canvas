import { spawn } from "node:child_process";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import { parseGateCReleasePilotEvents } from "./gate-c-release-evidence.js";
import { packageGateCReleaseEvidence } from "./package-gate-c-release-evidence.js";

const MAX_PILOT_STDOUT_BYTES = 1_048_576;
const MAX_PILOT_STDERR_BYTES = 65_536;
const ALLOWED_SYSTEM_PATH_ALIASES = new Set(["/var", "/tmp", "/etc"]);

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Gate C release evidence requires ${name}.`);
  }
  return value;
}

function absoluteEnvironmentPath(name: string): string {
  const value = requiredEnvironment(name);
  if (!isAbsolute(value) || value.trim() !== value || value.includes("\0")) {
    throw new Error(`${name} must be a clean absolute path.`);
  }
  return resolve(value);
}

async function collectPilotEvents(): Promise<string> {
  const child = spawn(
    process.execPath,
    [resolve("scripts/run-buzzr-pilot-import.ts")],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdout: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let exceededBudget = false;
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > MAX_PILOT_STDOUT_BYTES) {
      exceededBudget = true;
      child.kill("SIGTERM");
      return;
    }
    stdout.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes > MAX_PILOT_STDERR_BYTES) {
      exceededBudget = true;
      child.kill("SIGTERM");
    }
  });
  const exitCode = await new Promise<number | null>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise(code));
  });
  if (exceededBudget) {
    throw new Error("Gate C pilot output exceeded its release-evidence budget.");
  }
  if (exitCode !== 0) {
    throw new Error(
      "Gate C pilot did not commit; inspect its protected local app data for retryable diagnostics.",
    );
  }
  return Buffer.concat(stdout).toString("utf8");
}

async function assertNoSymlinkAncestors(path: string): Promise<void> {
  const segments = resolve(path).split(sep).filter(Boolean);
  let current = sep;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (
        metadata.isSymbolicLink() &&
        !ALLOWED_SYSTEM_PATH_ALIASES.has(current)
      ) {
        throw new Error("Gate C evidence paths may not traverse a symbolic link.");
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function writeExclusive(path: string, contents: string): Promise<void> {
  await assertNoSymlinkAncestors(dirname(path));
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await assertNoSymlinkAncestors(dirname(path));
  const parent = await lstat(dirname(path));
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw new Error("Gate C evidence output parent must be a real directory.");
  }
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

try {
  const root = absoluteEnvironmentPath("MEMI_BUZZR_PILOT_APP_DATA");
  const eventPath = absoluteEnvironmentPath("MEMI_GATE_C_PILOT_EVENTS");
  const outputPath = absoluteEnvironmentPath("MEMI_GATE_C_EVIDENCE_OUTPUT");
  const expectedSourceRevision = requiredEnvironment(
    "EXPECTED_SOURCE_REVISION",
  );
  const events = await collectPilotEvents();
  const committed = parseGateCReleasePilotEvents(events);
  await writeExclusive(eventPath, events);
  const manifest = await packageGateCReleaseEvidence({
    expectedJobId: committed.jobId,
    expectedSourceRevision,
    outputPath,
    projectId: committed.projectId,
    root,
  });
  console.log("GATE_C_RELEASE_EVIDENCE_LANE_OK", {
    artifacts: manifest.artifacts.length,
    captureAuthorityHash: manifest.captureAuthorityHash,
  });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Gate C release evidence failed.",
  );
  process.exitCode = 1;
}
