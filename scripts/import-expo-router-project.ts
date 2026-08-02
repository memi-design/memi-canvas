import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  open,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";

import { importExpoRouterProject } from "../packages/expo-router-import/src/index.js";

const IMPORT_BUDGETS = {
  maxFiles: 2_048,
  maxEntries: 20_000,
  maxDepth: 64,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
} as const;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const CLEAN_STATUS_FINGERPRINT =
  `sha256:${"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}`;
const EXPECTED_FLAGS = [
  "--root",
  "--out",
  "--revision",
  "--dirty-fingerprint",
  "--capture-blocker",
] as const;
type ExpectedFlag = (typeof EXPECTED_FLAGS)[number];

interface CliArguments {
  readonly root: string;
  readonly out: string;
  readonly revision: string;
  readonly dirtyFingerprint: `sha256:${string}`;
  readonly captureBlocker: string;
}

function usage(): string {
  return [
    "Usage: vite-node scripts/import-expo-router-project.ts",
    "  --root <absolute repository path>",
    "  --out <absolute .generated.json path outside the repository>",
    "  --revision <40-character Git SHA>",
    "  --dirty-fingerprint <sha256:... of git status --porcelain=v1 -z>",
    "  --capture-blocker <explicit reason runtime capture is unavailable>",
  ].join("\n");
}

function parseFlagPairs(argv: readonly string[]): Readonly<Record<string, string>> {
  if (argv.length !== EXPECTED_FLAGS.length * 2) {
    throw new Error(usage());
  }
  let parsed: Readonly<Record<string, string>> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      !EXPECTED_FLAGS.includes(flag as ExpectedFlag) ||
      value.length === 0 ||
      Object.hasOwn(parsed, flag)
    ) {
      throw new Error(usage());
    }
    parsed = { ...parsed, [flag]: value };
  }
  if (!EXPECTED_FLAGS.every((flag) => Object.hasOwn(parsed, flag))) {
    throw new Error(usage());
  }
  return parsed;
}

function parseArguments(argv: readonly string[]): CliArguments {
  const values = parseFlagPairs(argv);
  const root = values["--root"];
  const out = values["--out"];
  const revision = values["--revision"];
  const dirtyFingerprint = values["--dirty-fingerprint"];
  const captureBlocker = values["--capture-blocker"];
  if (
    root === undefined ||
    out === undefined ||
    revision === undefined ||
    dirtyFingerprint === undefined ||
    captureBlocker === undefined
  ) {
    throw new Error(usage());
  }
  if (!isAbsolute(root) || !isAbsolute(out)) {
    throw new Error("--root and --out must be absolute paths.");
  }
  if (!out.endsWith(".generated.json")) {
    throw new Error("--out must end in .generated.json.");
  }
  if (!/^[a-f0-9]{40}$/iu.test(revision)) {
    throw new Error("--revision must be a 40-character hexadecimal Git SHA.");
  }
  if (!/^sha256:[a-f0-9]{64}$/iu.test(dirtyFingerprint)) {
    throw new Error("--dirty-fingerprint must be a SHA-256 digest.");
  }
  if (captureBlocker.length > 512 || captureBlocker.trim().length === 0) {
    throw new Error("--capture-blocker must contain 1 to 512 meaningful characters.");
  }
  return {
    root,
    out,
    revision,
    dirtyFingerprint: dirtyFingerprint as `sha256:${string}`,
    captureBlocker,
  };
}

function isContained(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

async function validateDestinations(
  root: string,
  out: string,
): Promise<{ readonly canonicalRoot: string; readonly outputPath: string }> {
  const canonicalRoot = await realpath(resolve(root));
  const outputPath = resolve(out);
  if (isContained(canonicalRoot, outputPath)) {
    throw new Error("The generated artifact must be written outside the source repository.");
  }
  const requestedParent = dirname(outputPath);
  const canonicalParent = await realpath(requestedParent);
  if (canonicalParent !== resolve(requestedParent)) {
    throw new Error("The output parent must not resolve through a symbolic link.");
  }
  try {
    const outputStats = await lstat(outputPath);
    if (outputStats.isSymbolicLink() || !outputStats.isFile()) {
      throw new Error("The output path must be absent or an existing regular file.");
    }
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  return { canonicalRoot, outputPath };
}

async function readGitOutput(
  root: string,
  args: readonly string[],
): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", ["-C", root, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let chunks: readonly Buffer[] = [];
    let errors: readonly Buffer[] = [];
    let totalBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_GIT_OUTPUT_BYTES) {
        child.kill();
        rejectPromise(new Error("Git authority output exceeded its byte limit."));
        return;
      }
      chunks = [...chunks, chunk];
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors = [...errors, chunk.subarray(0, 8_192)];
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(
          new Error(
            `Git authority verification failed: ${Buffer.concat(
              errors,
            ).toString("utf8").trim()}`,
          ),
        );
        return;
      }
      resolvePromise(Buffer.concat(chunks));
    });
  });
}

async function verifyRepositoryAuthority(
  root: string,
  declaredRevision: string,
  declaredDirtyFingerprint: string,
): Promise<void> {
  const revision = (
    await readGitOutput(root, ["rev-parse", "--verify", "HEAD"])
  )
    .toString("utf8")
    .trim();
  const status = await readGitOutput(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const dirtyFingerprint = `sha256:${createHash("sha256")
    .update(status)
    .digest("hex")}`;
  if (
    revision !== declaredRevision ||
    dirtyFingerprint !== declaredDirtyFingerprint
  ) {
    throw new Error(
      "Declared repository revision or dirty fingerprint does not match Git.",
    );
  }
}

async function writeAtomicJson(outputPath: string, contents: string): Promise<void> {
  const bytes = Buffer.byteLength(contents);
  if (bytes > MAX_OUTPUT_BYTES) {
    throw new Error("Generated Expo import JSON exceeds the hard output byte limit.");
  }
  const parent = dirname(outputPath);
  const temporaryPath = resolve(
    parent,
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const destinations = await validateDestinations(args.root, args.out);
  await verifyRepositoryAuthority(
    destinations.canonicalRoot,
    args.revision,
    args.dirtyFingerprint,
  );
  const imported = await importExpoRouterProject({
    rootDir: destinations.canonicalRoot,
    repository: {
      revision: args.revision,
      dirty: args.dirtyFingerprint !== CLEAN_STATUS_FINGERPRINT,
      dirtyFileFingerprint: args.dirtyFingerprint,
    },
    budgets: IMPORT_BUDGETS,
    runtimeCapture: {
      kind: "unavailable",
      reason: args.captureBlocker,
    },
  });
  await verifyRepositoryAuthority(
    destinations.canonicalRoot,
    args.revision,
    args.dirtyFingerprint,
  );
  const artifact = {
    schemaVersion: 1,
    executionMode: "deterministic-static",
    modelTokenUsage: 0,
    bounds: {
      ...IMPORT_BUDGETS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    },
    ...imported,
  } as const;
  const contents = `${JSON.stringify(artifact, null, 2)}\n`;
  await writeAtomicJson(destinations.outputPath, contents);
  process.stdout.write(
    `${JSON.stringify({
      outputPath: destinations.outputPath,
      routes: artifact.routes.length,
      framePlans: artifact.framePlans.length,
      tokenFiles: artifact.designEvidence.tokenFiles.length,
      componentFiles: artifact.designEvidence.componentFiles.length,
      outputBytes: Buffer.byteLength(contents),
    })}\n`,
  );
}

await main();
