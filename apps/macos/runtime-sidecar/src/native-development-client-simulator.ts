import {
  lstat,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const UUID_PATTERN =
  /^[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}$/u;
const DEFAULT_MAXIMUM_DEVICES = 128;
const DEFAULT_MAXIMUM_APPLICATIONS_PER_DEVICE = 256;
const MAXIMUM_INFO_PLIST_BYTES = 256 * 1024;

export interface FindInstalledSimulatorApplicationOptions {
  readonly bundleId: string;
  readonly coreSimulatorRoot: string;
  readonly maximumApplicationsPerDevice?: number;
  readonly maximumDevices?: number;
}

export interface InstalledSimulatorApplicationCandidate {
  readonly appBundleId: string;
  readonly appContainerId: string;
  readonly appPath: string;
  readonly deviceId: string;
}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return (
    fromRoot === "" ||
    (
      fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot)
    )
  );
}

function positiveInteger(
  value: number | undefined,
  label: string,
  fallback: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return resolved;
}

async function canonicalContainedPath(
  root: string,
  candidate: string,
): Promise<string> {
  const canonicalRoot = await realpath(root);
  const canonicalCandidate = await realpath(candidate);
  if (!isContained(canonicalRoot, canonicalCandidate)) {
    throw new Error("Simulator discovery path escapes the requested CoreSimulator root.");
  }
  return canonicalCandidate;
}

async function containedDirectoryEntries(
  root: string,
  directory: string,
): Promise<readonly string[]> {
  const canonicalDirectory = await canonicalContainedPath(root, directory);
  const stats = await lstat(canonicalDirectory);
  if (!stats.isDirectory()) {
    throw new Error("Simulator discovery requires directories within the requested root.");
  }
  return Object.freeze(await readdir(canonicalDirectory));
}

function plistBundleIdentifier(plist: string): string | null {
  const match = /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/isu.exec(
    plist,
  );
  return match?.[1]?.trim() || null;
}

function includesExactUtf8Sequence(
  contents: Uint8Array,
  value: string,
): boolean {
  return Buffer.from(contents).includes(Buffer.from(value, "utf8"));
}

async function bundleIdentifierFor(
  root: string,
  appPath: string,
  requestedBundleId: string,
): Promise<string | null> {
  const infoPlistPath = join(appPath, "Info.plist");
  try {
    const canonicalInfoPlistPath = await canonicalContainedPath(
      root,
      infoPlistPath,
    );
    const fileHandle = await open(canonicalInfoPlistPath, "r");
    try {
      const contents = Buffer.alloc(MAXIMUM_INFO_PLIST_BYTES);
      const { bytesRead } = await fileHandle.read(
        contents,
        0,
        MAXIMUM_INFO_PLIST_BYTES,
        0,
      );
      const boundedContents = contents.subarray(0, bytesRead);
      const parsedBundleId = plistBundleIdentifier(
        boundedContents.toString("utf8"),
      );
      if (parsedBundleId !== null) {
        return parsedBundleId;
      }
      if (includesExactUtf8Sequence(boundedContents, requestedBundleId)) {
        return requestedBundleId;
      }
      return null;
    } finally {
      await fileHandle.close();
    }
  } catch (error) {
    if (
      error instanceof Error &&
      /enoent|invalid|directory/i.test(error.message)
    ) {
      return null;
    }
    throw error;
  }
}

export async function findInstalledSimulatorApplication(
  options: FindInstalledSimulatorApplicationOptions,
): Promise<InstalledSimulatorApplicationCandidate | null> {
  const bundleId = options.bundleId.trim();
  if (bundleId.length === 0) {
    throw new Error("Simulator bundle id is required.");
  }
  if (!isAbsolute(options.coreSimulatorRoot)) {
    throw new Error("CoreSimulator root must be an absolute path.");
  }
  const maximumDevices = positiveInteger(
    options.maximumDevices,
    "maximumDevices",
    DEFAULT_MAXIMUM_DEVICES,
  );
  const maximumApplicationsPerDevice = positiveInteger(
    options.maximumApplicationsPerDevice,
    "maximumApplicationsPerDevice",
    DEFAULT_MAXIMUM_APPLICATIONS_PER_DEVICE,
  );
  const canonicalRoot = await canonicalContainedPath(
    options.coreSimulatorRoot,
    options.coreSimulatorRoot,
  );
  const devicesPath = join(canonicalRoot, "Devices");
  const deviceEntries = (await containedDirectoryEntries(
    canonicalRoot,
    devicesPath,
  ))
    .filter((entry) => UUID_PATTERN.test(entry))
    .sort()
    .slice(0, maximumDevices);
  for (const deviceId of deviceEntries) {
    const applicationsPath = join(
      devicesPath,
      deviceId,
      "data",
      "Containers",
      "Bundle",
      "Application",
    );
    let applicationEntries: readonly string[];
    try {
      applicationEntries = await containedDirectoryEntries(
        canonicalRoot,
        applicationsPath,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        /enoent/i.test(error.message)
      ) {
        continue;
      }
      throw error;
    }
    const applicationIds = applicationEntries
      .filter((entry) => UUID_PATTERN.test(entry))
      .sort()
      .slice(0, maximumApplicationsPerDevice);
    for (const appContainerId of applicationIds) {
      const applicationPath = join(applicationsPath, appContainerId);
      const appEntries = await containedDirectoryEntries(
        canonicalRoot,
        applicationPath,
      );
      for (const entry of appEntries.filter((candidate) =>
        candidate.endsWith(".app"),
      )) {
        const appPath = join(applicationPath, entry);
        if (
          (await bundleIdentifierFor(canonicalRoot, appPath, bundleId)) !==
          bundleId
        ) {
          continue;
        }
        return Object.freeze({
          appBundleId: bundleId,
          appContainerId,
          appPath: await canonicalContainedPath(canonicalRoot, appPath),
          deviceId,
        });
      }
    }
  }
  return null;
}
