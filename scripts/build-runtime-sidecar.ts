import {
  access,
  chmod,
  copyFile,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifestRoot = join(root, "apps", "macos", "src-tauri");
const outputRoot = join(manifestRoot, "binaries");
const entry = join(
  root,
  "apps",
  "macos",
  "runtime-sidecar",
  "src",
  "main.ts",
);
const xcuiCaptureRoot = join(root, "apps", "macos", "xcui-capture");

function quotedShellArgument(value: string): string {
  if (value.length === 0 || value.includes("\0") || /[\r\n]/u.test(value)) {
    throw new Error("Runtime launcher path is invalid.");
  }
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function developmentRuntimeLauncher(
  bunExecutable: string,
  sourceEntry: string,
): string {
  return [
    "#!/bin/sh",
    "set -eu",
    `exec ${quotedShellArgument(bunExecutable)} ${quotedShellArgument(sourceEntry)} "$@"`,
    "",
  ].join("\n");
}

async function executable(candidates: readonly string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the bounded build-time candidates.
    }
  }
  throw new Error(
    "Bun is required to compile the standalone Memi runtime sidecar.",
  );
}

function capture(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveOutput(Buffer.concat(chunks).toString("utf8"));
      } else {
        reject(new Error(`${command} exited with status ${String(code)}.`));
      }
    });
  });
}

async function signAndVerifyLocalExecutable(path: string): Promise<void> {
  await capture("codesign", [
    "--force",
    "--sign",
    "-",
    "--timestamp=none",
    path,
  ]);
  await capture("codesign", ["--verify", "--strict", "--verbose=4", path]);
}

const bun = await executable([
  process.env.BUN_BINARY ?? "",
  join(root, "node_modules", ".bin", "bun"),
  join(homedir(), ".bun", "bin", "bun"),
].filter(Boolean));
const version = await capture("rustc", ["-vV"]);
const target = version
  .split("\n")
  .find((line) => line.startsWith("host: "))
  ?.slice("host: ".length)
  .trim();
if (target === undefined || !/^[a-z0-9_.-]+$/u.test(target)) {
  throw new Error("The Rust host target could not be determined.");
}
await mkdir(outputRoot, { recursive: true });
const output = join(outputRoot, `memi-canvas-runtime-${target}`);
const xcuiOutput = join(outputRoot, `memi-xcui-capture-${target}`);
const temporaryRoot = join(root, ".memi-runtime-build");
const temporaryOutput = (destination: string) =>
  join(temporaryRoot, `${basename(destination)}.${randomUUID()}.tmp`);
const runtimeTemporaryOutput = temporaryOutput(output);
const xcuiTemporaryOutput = temporaryOutput(xcuiOutput);
await rm(temporaryRoot, { force: true, recursive: true });
await mkdir(temporaryRoot, { recursive: true });
try {
  // Bun 1.3.11 on this macOS host can launch its interpreter normally but
  // leaves every `bun build --compile` Mach-O stalled in dyld before any
  // application code runs. Keep the dev sidecar as an executable launcher for
  // the known-working interpreter and its checked-in source entrypoint. This
  // keeps the native shell usable for the Expo import vertical slice without
  // claiming that the launcher is a redistributable production artifact.
  await writeFile(
    runtimeTemporaryOutput,
    developmentRuntimeLauncher(resolve(bun), entry),
    { mode: 0o755 },
  );
  await chmod(runtimeTemporaryOutput, 0o755);
  await rename(runtimeTemporaryOutput, output);
  if (process.env.MEMI_BUILD_XCUI === "1") {
    await capture("swift", [
      "build",
      "--package-path",
      xcuiCaptureRoot,
      "--configuration",
      "release",
      "--product",
      "memi-xcui-capture",
    ]);
    const swiftBinRoot = (await capture("swift", [
      "build",
      "--package-path",
      xcuiCaptureRoot,
      "--configuration",
      "release",
      "--show-bin-path",
    ])).trim();
    const xcuiSource = join(swiftBinRoot, "memi-xcui-capture");
    await access(xcuiSource);
    await copyFile(xcuiSource, xcuiTemporaryOutput);
    await chmod(xcuiTemporaryOutput, 0o755);
    await signAndVerifyLocalExecutable(xcuiTemporaryOutput);
    await rename(xcuiTemporaryOutput, xcuiOutput);
    console.log(`Built standalone XCUITest helper: ${xcuiOutput}`);
  }
  console.log(`Built development runtime launcher: ${output}`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
