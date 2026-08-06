import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultBundleRoot = join(
  root,
  "apps",
  "macos",
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
);

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface ArtifactRecord {
  readonly name: string;
  readonly kind: "dmg" | "app-zip";
  readonly sha256: string;
  readonly sizeBytes: number;
}

function requiredOption(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required option ${name}.`);
  }
  return value.trim();
}

function optionalOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value?.trim() || undefined;
}

export function releaseVersion(tag: string): string {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(tag)) {
    throw new Error(
      `Release tag ${JSON.stringify(tag)} must match vMAJOR.MINOR.PATCH[-prerelease].`,
    );
  }
  return tag.slice(1);
}

async function run(
  executable: string,
  args: readonly string[],
  options: { readonly allowFailure?: boolean } = {},
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(executable, args, {
      cwd: root,
      maxBuffer: 1_000_000,
      encoding: "utf8",
    });
    return { ...result, exitCode: 0 };
  } catch (error) {
    if (options.allowFailure) {
      const failure = error as { stdout?: string; stderr?: string };
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
        exitCode:
          typeof (failure as { status?: unknown }).status === "number"
            ? (failure as { status: number }).status
            : 1,
      };
    }
    throw error;
  }
}

async function findSingle(
  directory: string,
  predicate: (name: string) => boolean,
): Promise<string> {
  const entries = (await readdir(directory)).filter(predicate).sort();
  if (entries.length !== 1) {
    throw new Error(
      `Expected exactly one release bundle in ${directory}; found ${entries.length}.`,
    );
  }
  return join(directory, entries[0]);
}

export async function discoverReleaseBundle(
  bundleBase: string,
): Promise<{ readonly appPath: string; readonly dmgPath: string }> {
  const appPath = await findSingle(join(bundleBase, "macos"), (name) =>
    name.endsWith(".app"),
  );
  const dmgPath = await findSingle(join(bundleBase, "dmg"), (name) =>
    name.endsWith(".dmg"),
  );
  return { appPath, dmgPath };
}

export function artifactFileNames(
  version: string,
  architecture: "arm64",
): {
  readonly dmg: string;
  readonly appZip: string;
  readonly latestDmg: string;
  readonly latestAppZip: string;
} {
  return {
    dmg: `Memi.Canvas-${version}-${architecture}.dmg`,
    appZip: `Memi.Canvas-${version}-${architecture}.app.zip`,
    latestDmg: `Memi.Canvas-latest-${architecture}.dmg`,
    latestAppZip: `Memi.Canvas-latest-${architecture}.app.zip`,
  };
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export function projectSigningState(input: {
  readonly signatureExitCode: number;
  readonly identityDetails: string;
  readonly notarizationExitCode: number | undefined;
}): { readonly signed: boolean; readonly notarized: boolean } {
  const signed =
    input.signatureExitCode === 0 &&
    /Authority=Developer ID Application:/u.test(input.identityDetails);
  return {
    signed,
    notarized: signed && input.notarizationExitCode === 0,
  };
}

export function assertSigningRequirement(input: {
  readonly requireSigned: boolean;
  readonly signed: boolean;
  readonly notarized: boolean;
}): void {
  if (input.requireSigned && (!input.signed || !input.notarized)) {
    throw new Error(
      "Configured public releases must be signed and notarized before packaging.",
    );
  }
}

interface ReleaseManifestInput {
  readonly tag: string;
  readonly architecture: "arm64";
  readonly sourceSha: string;
  readonly repository: string;
  readonly workflowRef: string;
  readonly runId: string;
  readonly runAttempt: string;
  readonly serverUrl: string;
  readonly signed: boolean;
  readonly notarized: boolean;
  readonly artifacts: readonly ArtifactRecord[];
}

export function createReleaseManifest(input: ReleaseManifestInput) {
  const version = releaseVersion(input.tag);
  if (!/^[0-9a-f]{40}$/u.test(input.sourceSha)) {
    throw new Error("Release source SHA must be an immutable 40-character commit SHA.");
  }
  if (!/^[1-9]\d*$/u.test(input.runId)) {
    throw new Error("GitHub Actions run ID must be a positive integer.");
  }
  if (!/^[1-9]\d*$/u.test(input.runAttempt)) {
    throw new Error("GitHub Actions run attempt must be a positive integer.");
  }
  if (!/^[^/\s]+\/[^/\s]+$/u.test(input.repository)) {
    throw new Error("GitHub repository must use owner/name format.");
  }
  if (input.workflowRef.length === 0) {
    throw new Error("GitHub workflow ref is required.");
  }
  const serverUrl = input.serverUrl.replace(/\/+$/u, "");
  if (!serverUrl.startsWith("https://")) {
    throw new Error("GitHub server URL must use HTTPS.");
  }
  const runAttempt = Number(input.runAttempt);
  return {
    schema: "memi.macos-release.v2",
    product: "Memi Canvas",
    tag: input.tag,
    version,
    channel: version.includes("-") ? "preview" : "stable",
    platform: "macOS",
    architecture: input.architecture,
    minimumSystemVersion: "13.0",
    source: {
      sha: input.sourceSha,
    },
    provenance: {
      provider: "github-actions",
      repository: input.repository,
      workflowRef: input.workflowRef,
      runId: input.runId,
      runAttempt,
      runUrl: `${serverUrl}/${input.repository}/actions/runs/${input.runId}/attempts/${runAttempt}`,
    },
    signed: input.signed,
    notarized: input.notarized,
    artifacts: input.artifacts,
  } as const;
}

async function packageRelease(): Promise<void> {
  const tag = requiredOption("--tag");
  const version = releaseVersion(tag);
  const bundleBase = optionalOption("--bundle-base")
    ? resolve(optionalOption("--bundle-base") as string)
    : dirname(defaultBundleRoot);
  const outputDirectory = resolve(
    optionalOption("--output-dir") ?? join(root, "dist", "releases", version),
  );
  const architecture = "arm64" as const;
  if (process.arch !== architecture) {
    throw new Error(
      `macOS release packaging requires arm64; received ${process.arch}.`,
    );
  }

  await mkdir(outputDirectory, { recursive: true });
  const { appPath: sourceApp, dmgPath: sourceDmg } =
    await discoverReleaseBundle(bundleBase);
  const names = artifactFileNames(version, architecture);
  const dmgName = names.dmg;
  const appZipName = names.appZip;
  const latestDmgName = names.latestDmg;
  const latestAppZipName = names.latestAppZip;
  const dmgPath = join(outputDirectory, dmgName);
  const appZipPath = join(outputDirectory, appZipName);

  await run("/usr/bin/ditto", [sourceDmg, dmgPath]);
  await run("/usr/bin/ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    sourceApp,
    appZipPath,
  ]);
  await run("/usr/bin/ditto", [dmgPath, join(outputDirectory, latestDmgName)]);
  await run("/usr/bin/ditto", [
    appZipPath,
    join(outputDirectory, latestAppZipName),
  ]);
  await run("/usr/bin/hdiutil", ["verify", dmgPath]);

  const signature = await run(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", sourceApp],
    { allowFailure: true },
  );
  const identity = await run(
    "/usr/bin/codesign",
    ["--display", "--verbose=4", sourceApp],
    { allowFailure: true },
  );
  const signatureIndicatesDeveloperId =
    signature.exitCode === 0 &&
    /Authority=Developer ID Application:/u.test(
      `${identity.stdout}\n${identity.stderr}`,
    );
  const notarization = signatureIndicatesDeveloperId
    ? await run(
        "/usr/sbin/spctl",
        ["--assess", "--type", "execute", "--verbose=2", sourceApp],
        { allowFailure: true },
      )
    : undefined;
  const { signed, notarized } = projectSigningState({
    signatureExitCode: signature.exitCode,
    identityDetails: `${identity.stdout}\n${identity.stderr}`,
    notarizationExitCode: notarization?.exitCode,
  });
  assertSigningRequirement({
    requireSigned: process.argv.includes("--require-signed"),
    signed,
    notarized,
  });

  const artifactNames = [dmgName, appZipName, latestDmgName, latestAppZipName];
  const artifacts: ArtifactRecord[] = [];
  for (const name of artifactNames) {
    const path = join(outputDirectory, name);
    const fileStats = await stat(path);
    artifacts.push({
      name,
      kind: name.endsWith(".dmg") ? "dmg" : "app-zip",
      sha256: await sha256File(path),
      sizeBytes: fileStats.size,
    });
  }

  const manifest = createReleaseManifest({
    tag,
    architecture,
    sourceSha: requiredOption("--source-sha"),
    repository: requiredOption("--repository"),
    workflowRef: requiredOption("--workflow-ref"),
    runId: requiredOption("--run-id"),
    runAttempt: requiredOption("--run-attempt"),
    serverUrl: requiredOption("--server-url"),
    signed,
    notarized,
    artifacts,
  });
  await writeFile(
    join(outputDirectory, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(outputDirectory, "SHA256SUMS.txt"),
    `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.name}`).join("\n")}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await packageRelease();
}
