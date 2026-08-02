import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  readdir,
  readFile,
  readlink,
  realpath,
  stat,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  sep,
} from "node:path";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const GIT_REVISION_PATTERN = /^[a-f0-9]{40,64}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,159}$/u;

export interface NativeDependencyPreparationPolicy {
  readonly contract: "memi.native-dependency-preparation-policy.v1";
  readonly network: "locked-dependency-downloads";
  readonly npmLifecycleScripts: "disabled";
  readonly cocoapodsHooks: "enabled";
  readonly requireLockfiles: true;
  readonly sandboxProfileFingerprint: string;
}

export interface NativeDependencyPreparationInput {
  readonly managedWorktreeRoot: string;
  readonly platformRoot: string;
  readonly repositoryRevision: string;
  readonly adapterVersion: string;
  readonly nodeExecutable: string;
  readonly npmExecutable: string;
  readonly podExecutable?: string | undefined;
  /** Development-client Metro only needs JavaScript dependencies. */
  readonly includeCocoaPods?: boolean | undefined;
  readonly policy: NativeDependencyPreparationPolicy;
}

export interface NativeDependencyLockfile {
  readonly relativePath: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface NativeDependencyManifest {
  readonly relativePath: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface NativeDependencyToolEvidence {
  readonly tool: "node" | "npm" | "pod";
  readonly requestedPath: string;
  readonly canonicalPath: string;
  readonly requestedPathMetadataSha256: string;
  readonly runtimeTreeSha256?: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface NativeDependencyPreparationCommand {
  readonly id: "npm-ci" | "pod-install" | "hermes-release-selection";
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly lockfileRelativePaths: readonly string[];
  readonly risk: Readonly<{
    network:
      | "downloads-lockfile-pinned-packages"
      | "may-download-lockfile-pinned-pod-artifacts"
      | "none";
    scripts:
      | "npm-lifecycle-scripts-disabled"
      | "cocoapods-hooks-and-podspec-code-enabled"
      | "deterministic-hermes-release-selection";
    writes: readonly string[];
  }>;
}

export interface NativeDependencyPreparationPlan {
  readonly contract: "memi.native-dependency-preparation-plan.v1";
  readonly managedWorktreeRoot: string;
  readonly platformRoot: string;
  readonly repositoryRevision: string;
  readonly adapterVersion: string;
  readonly policy: NativeDependencyPreparationPolicy;
  readonly tools: readonly NativeDependencyToolEvidence[];
  readonly manifests: readonly NativeDependencyManifest[];
  readonly lockfiles: readonly NativeDependencyLockfile[];
  readonly commands: readonly NativeDependencyPreparationCommand[];
  readonly fingerprint: string;
  readonly approval: Readonly<{
    status: "pending";
    requiresExplicitApproval: true;
  }>;
}

export interface NativeDependencyPreparationApprovalRequest {
  readonly approvedFingerprint: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export interface NativeDependencyPreparationApproval {
  readonly contract: "memi.native-dependency-preparation-approval.v1";
  readonly planFingerprint: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

interface FileEvidence {
  readonly bytes: Uint8Array;
  readonly relativePath: string;
  readonly sha256: string;
  readonly byteLength: number;
}

interface ValidatedTool {
  readonly executable: string;
  readonly evidence: NativeDependencyToolEvidence;
}

const HERMES_ENGINE_RELEASE = /^\s*-\s+hermes-engine \((\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\):\s*$/gmu;

async function hashNpmRuntimeTree(
  npmCliExecutable: string,
): Promise<string> {
  const npmRoot = dirname(dirname(npmCliExecutable));
  const digest = createHash("sha256");
  let entryCount = 0;
  let totalBytes = 0;
  async function visit(
    directory: string,
    relativeDirectory: string,
  ): Promise<void> {
    const entries = (await readdir(directory, {
      withFileTypes: true,
    })).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > 10_000) {
        throw new Error("The npm runtime tree has too many entries.");
      }
      const relativePath =
        relativeDirectory === ""
          ? entry.name
          : `${relativeDirectory}/${entry.name}`;
      const absolutePath = join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw new Error(
          "The npm runtime tree must not contain symbolic links.",
        );
      }
      if (metadata.isDirectory()) {
        digest.update(
          `${JSON.stringify({
            kind: "directory",
            path: relativePath,
            mode: metadata.mode,
          })}\0`,
        );
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error(
          "The npm runtime tree contains an unsupported entry.",
        );
      }
      totalBytes += metadata.size;
      if (totalBytes > 128 * 1_024 * 1_024) {
        throw new Error("The npm runtime tree is too large.");
      }
      digest.update(
        `${JSON.stringify({
          kind: "file",
          path: relativePath,
          mode: metadata.mode,
          size: metadata.size,
        })}\0`,
      );
      digest.update(await readFile(absolutePath));
      digest.update("\0");
    }
  }
  await visit(npmRoot, "");
  return `sha256:${digest.digest("hex")}`;
}

function immutableArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isContained(candidate: string, root: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

async function canonicalContainedDirectory(
  candidate: string,
  managedRoot: string,
): Promise<string> {
  if (!isAbsolute(candidate)) {
    throw new Error("The platform root must be an absolute path.");
  }
  const canonicalCandidate = await realpath(candidate);
  if (!isContained(canonicalCandidate, managedRoot)) {
    throw new Error(
      "The platform root is outside the managed worktree.",
    );
  }
  const metadata = await stat(canonicalCandidate);
  if (!metadata.isDirectory()) {
    throw new Error("The platform root must be a directory.");
  }
  return canonicalCandidate;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function readContainedFile(
  platformRoot: string,
  relativePath: string,
): Promise<FileEvidence> {
  const requestedPath = join(platformRoot, relativePath);
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(requestedPath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error(`Required ${relativePath} is missing.`);
    }
    throw error;
  }
  if (!isContained(canonicalPath, platformRoot)) {
    throw new Error(
      `${relativePath} escapes the managed worktree through a symlink.`,
    );
  }
  const metadata = await stat(canonicalPath);
  if (!metadata.isFile()) {
    throw new Error(`Required ${relativePath} is not a regular file.`);
  }
  const bytes = await readFile(canonicalPath);
  if (bytes.byteLength === 0) {
    throw new Error(`Required ${relativePath} is empty.`);
  }
  return Object.freeze({
    bytes,
    relativePath,
    sha256: sha256(bytes),
    byteLength: bytes.byteLength,
  });
}

function parsePackageManifest(evidence: FileEvidence): void {
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(evidence.bytes));
  } catch {
    throw new Error("package.json is not valid JSON.");
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest)
  ) {
    throw new Error("package.json must contain an object.");
  }
  const packageManager = Reflect.get(manifest, "packageManager");
  if (
    packageManager !== undefined &&
    (typeof packageManager !== "string" ||
      !/^npm@[0-9][a-zA-Z0-9.+-]{0,63}$/u.test(packageManager))
  ) {
    throw new Error(
      "Native dependency preparation requires the npm package manager.",
    );
  }
}

function parsePackageLock(evidence: FileEvidence): void {
  let lockfile: unknown;
  try {
    lockfile = JSON.parse(new TextDecoder().decode(evidence.bytes));
  } catch {
    throw new Error("package-lock.json is not valid JSON.");
  }
  if (
    typeof lockfile !== "object" ||
    lockfile === null ||
    Array.isArray(lockfile)
  ) {
    throw new Error("package-lock.json must contain an object.");
  }
  const lockfileVersion = Reflect.get(lockfile, "lockfileVersion");
  if (
    typeof lockfileVersion !== "number" ||
    !Number.isInteger(lockfileVersion) ||
    lockfileVersion < 1 ||
    lockfileVersion > 3
  ) {
    throw new Error(
      "package-lock.json has an unsupported lockfile version.",
    );
  }
}

async function validateTool(
  executable: string,
  tool: "node" | "npm" | "pod",
): Promise<ValidatedTool> {
  if (
    !isAbsolute(executable) ||
    executable.includes("\0") ||
    basename(executable) !== tool
  ) {
    throw new Error(
      `The ${tool} executable must be an absolute path to ${tool}.`,
    );
  }
  let canonicalExecutable: string;
  let bytes: Uint8Array;
  let requestedPathMetadataSha256: string;
  try {
    const requestedMetadata = await lstat(executable);
    canonicalExecutable = await realpath(executable);
    const metadata = await stat(canonicalExecutable);
    await access(canonicalExecutable, constants.X_OK);
    const canonicalName = basename(canonicalExecutable);
    const isNpmCliShim =
      tool === "npm" &&
      requestedMetadata.isSymbolicLink() &&
      canonicalName === "npm-cli.js" &&
      canonicalExecutable.endsWith(
        "/lib/node_modules/npm/bin/npm-cli.js",
      );
    const hasExpectedIdentity =
      tool === "npm"
        ? isNpmCliShim
        : canonicalName === tool;
    const maximumBytes =
      tool === "node" ? 256 * 1_024 * 1_024 : 8 * 1_024 * 1_024;
    if (
      !metadata.isFile() ||
      metadata.size > maximumBytes ||
      !hasExpectedIdentity
    ) {
      throw new Error("wrong executable identity");
    }
    const requestedLinkTarget = requestedMetadata.isSymbolicLink()
      ? await readlink(executable)
      : null;
    requestedPathMetadataSha256 = sha256(
      JSON.stringify({
        kind: requestedMetadata.isSymbolicLink()
          ? "symbolic-link"
          : "regular-file",
        mode: requestedMetadata.mode,
        size: requestedMetadata.size,
        linkTarget: requestedLinkTarget,
      }),
    );
    bytes = await readFile(canonicalExecutable);
  } catch {
    throw new Error(
      `The ${tool} executable must resolve to an executable regular ${tool} file.`,
    );
  }
  const runtimeTreeSha256 =
    tool === "npm"
      ? await hashNpmRuntimeTree(canonicalExecutable)
      : undefined;
  return Object.freeze({
    executable: canonicalExecutable,
    evidence: Object.freeze({
      tool,
      requestedPath: executable,
      canonicalPath: canonicalExecutable,
      requestedPathMetadataSha256,
      ...(runtimeTreeSha256 === undefined
        ? {}
        : { runtimeTreeSha256 }),
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
    }),
  });
}

function validatePolicy(
  policy: NativeDependencyPreparationPolicy,
): NativeDependencyPreparationPolicy {
  if (
    policy.contract !==
      "memi.native-dependency-preparation-policy.v1" ||
    policy.network !== "locked-dependency-downloads" ||
    policy.npmLifecycleScripts !== "disabled" ||
    policy.cocoapodsHooks !== "enabled" ||
    policy.requireLockfiles !== true ||
    !SHA256_PATTERN.test(policy.sandboxProfileFingerprint)
  ) {
    throw new Error(
      "Native dependency preparation policy is unsupported or incomplete.",
    );
  }
  return Object.freeze({
    contract: "memi.native-dependency-preparation-policy.v1",
    network: "locked-dependency-downloads",
    npmLifecycleScripts: "disabled",
    cocoapodsHooks: "enabled",
    requireLockfiles: true,
    sandboxProfileFingerprint: policy.sandboxProfileFingerprint,
  });
}

function fileProjection(
  evidence: FileEvidence,
): NativeDependencyLockfile {
  return Object.freeze({
    relativePath: evidence.relativePath,
    sha256: evidence.sha256,
    byteLength: evidence.byteLength,
  });
}

function npmCommand(
  nodeExecutable: string,
  npmCliExecutable: string,
  cwd: string,
): NativeDependencyPreparationCommand {
  return Object.freeze({
    id: "npm-ci",
    executable: nodeExecutable,
    args: immutableArray([
      npmCliExecutable,
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]),
    cwd,
    lockfileRelativePaths: immutableArray(["package-lock.json"]),
    risk: Object.freeze({
      network: "downloads-lockfile-pinned-packages",
      scripts: "npm-lifecycle-scripts-disabled",
      writes: immutableArray([
        "node_modules/**",
        "$SANDBOX_HOME/.npm/**",
      ]),
    }),
  });
}

function podCommand(
  executable: string,
  platformRoot: string,
): NativeDependencyPreparationCommand {
  return Object.freeze({
    id: "pod-install",
    executable,
    args: immutableArray([
      "install",
      "--no-repo-update",
    ]),
    cwd: join(platformRoot, "ios"),
    lockfileRelativePaths: immutableArray(["ios/Podfile.lock"]),
    risk: Object.freeze({
      network: "may-download-lockfile-pinned-pod-artifacts",
      scripts: "cocoapods-hooks-and-podspec-code-enabled",
      writes: immutableArray([
        "ios/Pods/**",
        "ios/*.xcworkspace/**",
        "ios/Podfile.lock",
        "$SANDBOX_HOME/.cocoapods/**",
        "$SANDBOX_HOME/Library/Caches/CocoaPods/**",
      ]),
    }),
  });
}

function hermesReleaseFromPodfileLock(lockfile: FileEvidence): string | null {
  const text = new TextDecoder().decode(lockfile.bytes);
  const releases = new Set<string>();
  for (const match of text.matchAll(HERMES_ENGINE_RELEASE)) {
    releases.add(match[1]!);
  }
  if (releases.size === 0) return null;
  if (releases.size !== 1) {
    throw new Error("Podfile.lock contains ambiguous hermes-engine releases.");
  }
  return [...releases][0]!;
}

function hermesReleaseCommand(
  nodeExecutable: string,
  platformRoot: string,
  release: string,
): NativeDependencyPreparationCommand {
  return Object.freeze({
    id: "hermes-release-selection",
    executable: nodeExecutable,
    args: immutableArray([
      join(
        platformRoot,
        "node_modules",
        "react-native",
        "sdks",
        "hermes-engine",
        "utils",
        "replace_hermes_version.js",
      ),
      "-c",
      "Release",
      "-r",
      release,
      "-p",
      join(platformRoot, "ios", "Pods"),
    ]),
    // React Native's helper creates a relative `hermes-engine` directory.
    // Running from Pods keeps that write inside the exact approved target.
    cwd: join(platformRoot, "ios", "Pods"),
    lockfileRelativePaths: immutableArray(["ios/Podfile.lock"]),
    risk: Object.freeze({
      network: "none",
      scripts: "deterministic-hermes-release-selection",
      writes: immutableArray(["ios/Pods/hermes-engine/**"]),
    }),
  });
}

function planFingerprint(
  plan: Omit<
    NativeDependencyPreparationPlan,
    "fingerprint" | "approval"
  >,
): string {
  return sha256(JSON.stringify(plan));
}

export async function createNativeDependencyPreparationPlan(
  input: NativeDependencyPreparationInput,
): Promise<NativeDependencyPreparationPlan> {
  if (!isAbsolute(input.managedWorktreeRoot)) {
    throw new Error("The managed worktree root must be absolute.");
  }
  const managedWorktreeRoot = await realpath(input.managedWorktreeRoot);
  const platformRoot = await canonicalContainedDirectory(
    input.platformRoot,
    managedWorktreeRoot,
  );
  if (!GIT_REVISION_PATTERN.test(input.repositoryRevision)) {
    throw new Error("Repository revision must be a full Git revision.");
  }
  if (!SAFE_IDENTIFIER_PATTERN.test(input.adapterVersion)) {
    throw new Error("Capture adapter version is invalid.");
  }
  const policy = validatePolicy(input.policy);
  const nodeTool = await validateTool(
    input.nodeExecutable,
    "node",
  );
  const npmTool = await validateTool(
    input.npmExecutable,
    "npm",
  );
  const packageManifest = await readContainedFile(
    platformRoot,
    "package.json",
  );
  parsePackageManifest(packageManifest);
  const packageLock = await readContainedFile(
    platformRoot,
    "package-lock.json",
  );
  parsePackageLock(packageLock);

  const includeCocoaPods = input.includeCocoaPods !== false;
  const podfilePath = join(platformRoot, "ios", "Podfile");
  const podLockPath = join(platformRoot, "ios", "Podfile.lock");
  const hasPodfile = includeCocoaPods && await pathExists(podfilePath);
  const hasPodLock = includeCocoaPods && await pathExists(podLockPath);
  if (includeCocoaPods && hasPodfile !== hasPodLock) {
    throw new Error(
      "Podfile and Podfile.lock must both exist for locked CocoaPods preparation.",
    );
  }

  const lockfiles: NativeDependencyLockfile[] = [
    fileProjection(packageLock),
  ];
  const manifests: NativeDependencyManifest[] = [
    fileProjection(packageManifest),
  ];
  const commands: NativeDependencyPreparationCommand[] = [
    npmCommand(
      nodeTool.executable,
      npmTool.executable,
      platformRoot,
    ),
  ];
  const tools: NativeDependencyToolEvidence[] = [
    nodeTool.evidence,
    npmTool.evidence,
  ];
  if (hasPodfile) {
    if (input.podExecutable === undefined) {
      throw new Error(
        "An absolute pod executable is required for Podfile.lock.",
      );
    }
    const [podfile, podLock] = await Promise.all([
      readContainedFile(platformRoot, "ios/Podfile"),
      readContainedFile(platformRoot, "ios/Podfile.lock"),
    ]);
    manifests.push(fileProjection(podfile));
    lockfiles.push(fileProjection(podLock));
    const podTool = await validateTool(input.podExecutable, "pod");
    tools.push(podTool.evidence);
    commands.push(podCommand(podTool.executable, platformRoot));
    const hermesRelease = hermesReleaseFromPodfileLock(podLock);
    if (hermesRelease !== null) {
      commands.push(
        hermesReleaseCommand(nodeTool.executable, platformRoot, hermesRelease),
      );
    }
  }

  const basePlan = Object.freeze({
    contract: "memi.native-dependency-preparation-plan.v1" as const,
    managedWorktreeRoot,
    platformRoot,
    repositoryRevision: input.repositoryRevision,
    adapterVersion: input.adapterVersion,
    policy,
    tools: immutableArray(tools),
    manifests: immutableArray(manifests),
    lockfiles: immutableArray(lockfiles),
    commands: immutableArray(commands),
  });
  return Object.freeze({
    ...basePlan,
    fingerprint: planFingerprint(basePlan),
    approval: Object.freeze({
      status: "pending" as const,
      requiresExplicitApproval: true as const,
    }),
  });
}

export function approveNativeDependencyPreparationPlan(
  plan: NativeDependencyPreparationPlan,
  request: NativeDependencyPreparationApprovalRequest,
): NativeDependencyPreparationApproval {
  if (
    !SHA256_PATTERN.test(request.approvedFingerprint) ||
    request.approvedFingerprint !== plan.fingerprint
  ) {
    throw new Error(
      "Approval fingerprint does not match the dependency preparation plan.",
    );
  }
  return validateApproval({
    contract: "memi.native-dependency-preparation-approval.v1",
    planFingerprint: plan.fingerprint,
    approvedBy: request.approvedBy,
    approvedAt: request.approvedAt,
  });
}

function validateApproval(
  approval: NativeDependencyPreparationApproval,
): NativeDependencyPreparationApproval {
  const approvedDate = new Date(approval.approvedAt);
  if (
    approval.contract !==
      "memi.native-dependency-preparation-approval.v1" ||
    !SHA256_PATTERN.test(approval.planFingerprint) ||
    !SAFE_IDENTIFIER_PATTERN.test(approval.approvedBy) ||
    !Number.isFinite(approvedDate.getTime()) ||
    approvedDate.toISOString() !== approval.approvedAt
  ) {
    throw new Error(
      "Native dependency preparation approval is invalid.",
    );
  }
  return Object.freeze({ ...approval });
}

export function assertNativeDependencyPreparationApproval(
  currentPlan: NativeDependencyPreparationPlan,
  approval: NativeDependencyPreparationApproval | undefined,
): NativeDependencyPreparationApproval {
  if (approval === undefined) {
    throw new Error(
      "Native dependency preparation requires explicit approval.",
    );
  }
  const validatedApproval = validateApproval(approval);
  if (
    validatedApproval.planFingerprint !== currentPlan.fingerprint
  ) {
    throw new Error(
      "Native dependency preparation approval is stale.",
    );
  }
  return validatedApproval;
}
