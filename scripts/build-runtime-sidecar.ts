import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
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
const runtimeBundleOutput = join(outputRoot, "memi-canvas-runtime");
const bunBundleOutput = join(outputRoot, "memi-canvas-bun");
const xcuiOutput = join(outputRoot, `memi-xcui-capture-${target}`);
const temporaryRoot = join(root, ".memi-runtime-build");
const temporaryOutput = (destination: string) =>
  join(temporaryRoot, `${basename(destination)}.${randomUUID()}.tmp`);
const runtimeTemporaryOutput = temporaryOutput(output);
const runtimeBundleTemporaryOutput = temporaryOutput(runtimeBundleOutput);
const bunBundleTemporaryOutput = temporaryOutput(bunBundleOutput);
const xcuiTemporaryOutput = temporaryOutput(xcuiOutput);
await rm(temporaryRoot, { force: true, recursive: true });
await mkdir(temporaryRoot, { recursive: true });
try {
  await mkdir(runtimeBundleTemporaryOutput, { recursive: true });
  await capture(bun, [
    "build",
    "--target=bun",
    // Playwright loads Chromium BiDi dynamically only for web capture. The
    // native Expo path does not resolve it during sidecar startup, and Bun's
    // bundler must not reject that optional runtime branch.
    "--external=playwright",
    "--external=chromium-bidi/*",
    "--external=typescript",
    "--outdir",
    runtimeBundleTemporaryOutput,
    entry,
  ]);
  await cp(
    join(root, "node_modules", "typescript"),
    join(runtimeBundleTemporaryOutput, "node_modules", "typescript"),
    { recursive: true },
  );
  const bundledEntry = await readFile(
    join(runtimeBundleTemporaryOutput, "main.js"),
    "utf8",
  );
  for (const forbiddenPath of [root, homedir()]) {
    if (bundledEntry.includes(forbiddenPath)) {
      throw new Error(
        "Packaged runtime sidecar contains a developer-machine path.",
      );
    }
  }
  await copyFile(bun, bunBundleTemporaryOutput);
  await chmod(bunBundleTemporaryOutput, 0o755);
  await signAndVerifyLocalExecutable(bunBundleTemporaryOutput);
  await writeFile(
    runtimeTemporaryOutput,
    [
      "#!/bin/sh",
      "set -eu",
      "directory=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
      "resources=\"$directory/../Resources/runtime\"",
      "if [ ! -x \"$resources/memi-canvas-bun\" ]; then resources=\"$directory\"; fi",
      "exec \"$resources/memi-canvas-bun\" \"$resources/memi-canvas-runtime/main.js\" \"$@\"",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  await chmod(runtimeTemporaryOutput, 0o755);
  await rename(runtimeTemporaryOutput, output);
  await rm(runtimeBundleOutput, { force: true, recursive: true });
  await rename(runtimeBundleTemporaryOutput, runtimeBundleOutput);
  await rename(bunBundleTemporaryOutput, bunBundleOutput);
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
  console.log(`Built packaged runtime sidecar: ${output}`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
