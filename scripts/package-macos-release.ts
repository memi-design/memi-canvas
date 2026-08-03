import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
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

interface ArtifactRecord {
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

function releaseVersion(tag: string): string {
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

async function sha256(path: string): Promise<string> {
  const result = await run("/usr/bin/shasum", ["-a", "256", path]);
  const digest = result.stdout.trim().split(/\s+/u)[0];
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`Could not calculate a SHA-256 digest for ${path}.`);
  }
  return digest;
}

async function packageRelease(): Promise<void> {
  const tag = requiredOption("--tag");
  const version = releaseVersion(tag);
  const bundleBase = optionalOption("--bundle-base")
    ? resolve(optionalOption("--bundle-base") as string)
    : dirname(defaultBundleRoot);
  const bundleRoot = join(bundleBase, "macos");
  const dmgRoot = join(bundleBase, "dmg");
  const outputDirectory = resolve(
    optionalOption("--output-dir") ?? join(root, "dist", "releases", version),
  );
  const architecture = process.arch === "arm64" ? "arm64" : process.arch;

  await mkdir(outputDirectory, { recursive: true });
  const sourceDmg = await findSingle(dmgRoot, (name) => name.endsWith(".dmg"));
  const sourceApp = await findSingle(bundleRoot, (name) =>
    name.endsWith(".app"),
  );
  const dmgName = `Memi.Canvas-${version}-${architecture}.dmg`;
  const appZipName = `Memi.Canvas-${version}-${architecture}.app.zip`;
  const latestDmgName = `Memi.Canvas-latest-${architecture}.dmg`;
  const latestAppZipName = `Memi.Canvas-latest-${architecture}.app.zip`;
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
  const signed =
    signature.exitCode === 0 &&
    /Authority=Developer ID Application:/u.test(identity.stderr);
  const notarization = signed
    ? await run(
        "/usr/sbin/spctl",
        ["--assess", "--type", "execute", "--verbose=2", sourceApp],
        { allowFailure: true },
      )
    : undefined;
  const notarized = notarization !== undefined && notarization.exitCode === 0;

  const artifactNames = [dmgName, appZipName, latestDmgName, latestAppZipName];
  const artifacts: ArtifactRecord[] = [];
  for (const name of artifactNames) {
    const path = join(outputDirectory, name);
    const fileStats = await stat(path);
    artifacts.push({
      name,
      kind: name.endsWith(".dmg") ? "dmg" : "app-zip",
      sha256: await sha256(path),
      sizeBytes: fileStats.size,
    });
  }

  const manifest = {
    schema: "memi.macos-release.v1",
    product: "Memi Canvas",
    tag,
    version,
    channel: version.includes("-") ? "preview" : "stable",
    platform: "macOS",
    architecture,
    minimumSystemVersion: "13.0",
    signed,
    notarized,
    artifacts,
  } as const;
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

await packageRelease();
