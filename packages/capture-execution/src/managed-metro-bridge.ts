import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

interface ManagedMetroBridgeMetadataV1 {
  readonly version: 1;
  readonly projectRoot: string;
  readonly dependencyRoot: string;
  readonly entryPoint: string;
  readonly packagePath: string;
  readonly packageBackupPath: string;
  readonly entryPath: string;
  readonly configPath: string;
  readonly originalPackageHash: `sha256:${string}`;
  readonly patchedPackageHash: `sha256:${string}`;
}

export type PreparedManagedMetroBridge = Readonly<ManagedMetroBridgeMetadataV1>;

const BRIDGE_RELATIVE_ROOT = ".memi/capture/metro-bridge";
const ENTRY_RELATIVE_PATH = `${BRIDGE_RELATIVE_ROOT}/MemiCaptureEntry.js`;

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function contained(root: string, candidate: string): boolean {
  const local = relative(resolve(root), resolve(candidate));
  return local === "" || (
    local !== ".." &&
    !local.startsWith(`..${sep}`) &&
    !isAbsolute(local)
  );
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function regularFile(path: string, label: string): Promise<void> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

function packageFileDependencies(
  manifest: Readonly<Record<string, unknown>>,
  projectRoot: string,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ] as const) {
    const values = manifest[field];
    if (values === null || typeof values !== "object" || Array.isArray(values)) {
      continue;
    }
    for (const [name, value] of Object.entries(values)) {
      if (typeof value !== "string" || !value.startsWith("file:")) continue;
      if (!/^(?:@[-A-Za-z0-9._]+\/)?[-A-Za-z0-9._]+$/u.test(name)) {
        throw new Error("Managed file dependency has an invalid package name.");
      }
      const localPath = value.slice("file:".length);
      const target = resolve(projectRoot, localPath);
      if (!contained(projectRoot, target)) {
        throw new Error(`Managed file dependency escaped the project: ${name}.`);
      }
      result[name] = target;
    }
  }
  return Object.freeze(result);
}

async function verifiedFileDependencies(
  manifest: Readonly<Record<string, unknown>>,
  projectRoot: string,
): Promise<Readonly<Record<string, string>>> {
  const dependencies = packageFileDependencies(manifest, projectRoot);
  for (const [name, target] of Object.entries(dependencies)) {
    const stats = await lstat(target);
    if ((!stats.isDirectory() && !stats.isFile()) || stats.isSymbolicLink()) {
      throw new Error(`Managed file dependency is not a local file or directory: ${name}.`);
    }
    if (!contained(projectRoot, await realpath(target))) {
      throw new Error(`Managed file dependency escaped the project: ${name}.`);
    }
  }
  return dependencies;
}

function metroWrapper(input: Readonly<{
  readonly projectRoot: string;
  readonly dependencyRoot: string;
  readonly baseConfigPath: string | null;
  readonly fileDependencies: Readonly<Record<string, string>>;
}>): string {
  const project = JSON.stringify(input.projectRoot);
  const base = input.baseConfigPath === null
    ? `require("expo/metro-config").getDefaultConfig(${project})`
    : `require(${JSON.stringify(input.baseConfigPath)})`;
  return [
    '"use strict";',
    `const baseConfig = ${base};`,
    `const projectNodeModules = ${JSON.stringify(join(input.projectRoot, "node_modules"))};`,
    `const dependencyRoot = ${JSON.stringify(input.dependencyRoot)};`,
    `const fileDependencies = ${JSON.stringify(input.fileDependencies)};`,
    "const unique = (values) => [...new Set(values)];",
    "module.exports = {",
    "  ...baseConfig,",
    "  watchFolders: unique([...(baseConfig.watchFolders ?? []), dependencyRoot]),",
    "  resolver: {",
    "    ...(baseConfig.resolver ?? {}),",
    "    nodeModulesPaths: unique([projectNodeModules, ...(baseConfig.resolver?.nodeModulesPaths ?? [])]),",
    "    extraNodeModules: { ...(baseConfig.resolver?.extraNodeModules ?? {}), ...fileDependencies },",
    "  },",
    "};",
    "",
  ].join("\n");
}

async function optionalBaseConfig(projectRoot: string): Promise<string | null> {
  for (const name of ["metro.config.js", "metro.config.cjs"]) {
    const candidate = join(projectRoot, name);
    try {
      await regularFile(candidate, "Metro config");
      return candidate;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return null;
}

export function managedMetroConfigPath(projectRoot: string): string {
  return resolve(projectRoot, BRIDGE_RELATIVE_ROOT, "MemiMetroConfig.cjs");
}

export async function prepareManagedMetroBridge(
  input: Readonly<{
    readonly projectRoot: string;
    readonly dependencyRoot: string;
    readonly entryPoint: string;
  }>,
): Promise<PreparedManagedMetroBridge> {
  const projectRoot = await realpath(input.projectRoot);
  const dependencyRoot = await realpath(input.dependencyRoot);
  if (
    input.entryPoint.length === 0 ||
    input.entryPoint.length > 512 ||
    input.entryPoint.includes("\0") ||
    input.entryPoint.includes("\n")
  ) {
    throw new Error("Managed Metro entry point is invalid.");
  }
  const bridgeRoot = resolve(projectRoot, BRIDGE_RELATIVE_ROOT);
  const metadataPath = join(bridgeRoot, "metadata.json");
  try {
    const existing = JSON.parse(
      await readFile(metadataPath, "utf8"),
    ) as ManagedMetroBridgeMetadataV1;
    if (
      existing.version === 1 &&
      existing.projectRoot === projectRoot &&
      existing.dependencyRoot === dependencyRoot &&
      existing.entryPoint === input.entryPoint &&
      hash(await readFile(existing.packagePath, "utf8")) ===
        existing.patchedPackageHash
    ) {
      return Object.freeze(existing);
    }
    throw new Error("Managed Metro bridge authority is stale.");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  const packagePath = join(projectRoot, "package.json");
  const packageBackupPath = join(bridgeRoot, "original-package.json");
  const entryPath = join(projectRoot, ENTRY_RELATIVE_PATH);
  const configPath = managedMetroConfigPath(projectRoot);
  for (const path of [
    bridgeRoot,
    metadataPath,
    packagePath,
    packageBackupPath,
    entryPath,
    configPath,
  ]) {
    if (!contained(projectRoot, path)) {
      throw new Error("Managed Metro bridge escaped the project root.");
    }
  }
  await regularFile(packagePath, "Managed package manifest");
  const originalPackage = await readFile(packagePath, "utf8");
  const manifest = JSON.parse(originalPackage) as Record<string, unknown>;
  const fileDependencies = await verifiedFileDependencies(manifest, projectRoot);
  const patchedPackage = `${JSON.stringify({
    ...manifest,
    main: ENTRY_RELATIVE_PATH,
  }, null, 2)}\n`;
  let packagePatched = false;
  try {
    await atomicWrite(packageBackupPath, originalPackage);
    await atomicWrite(
      entryPath,
      `import ${JSON.stringify(input.entryPoint)};\n`,
    );
    await atomicWrite(
      configPath,
      metroWrapper({
        projectRoot,
        dependencyRoot,
        baseConfigPath: await optionalBaseConfig(projectRoot),
        fileDependencies,
      }),
    );
    await atomicWrite(packagePath, patchedPackage);
    packagePatched = true;
    const prepared: PreparedManagedMetroBridge = Object.freeze({
      version: 1,
      projectRoot,
      dependencyRoot,
      entryPoint: input.entryPoint,
      packagePath,
      packageBackupPath,
      entryPath,
      configPath,
      originalPackageHash: hash(originalPackage),
      patchedPackageHash: hash(patchedPackage),
    });
    await atomicWrite(metadataPath, JSON.stringify(prepared));
    return prepared;
  } catch (error) {
    if (packagePatched) await atomicWrite(packagePath, originalPackage);
    await rm(bridgeRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreManagedMetroBridge(
  prepared: PreparedManagedMetroBridge,
): Promise<void> {
  const [originalPackage, patchedPackage] = await Promise.all([
    readFile(prepared.packageBackupPath, "utf8"),
    readFile(prepared.packagePath, "utf8"),
  ]);
  if (hash(originalPackage) !== prepared.originalPackageHash) {
    throw new Error("Managed package backup no longer matches authority.");
  }
  if (hash(patchedPackage) !== prepared.patchedPackageHash) {
    throw new Error("Managed package changed during capture.");
  }
  await atomicWrite(prepared.packagePath, originalPackage);
  await rm(dirname(prepared.configPath), { recursive: true, force: true });
}
