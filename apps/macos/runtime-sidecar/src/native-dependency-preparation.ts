import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, realpath, rm } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  assertNativeDependencyPreparationApproval,
  buildSandboxProfile,
  CaptureExecutionError,
  createNativeDependencyPreparationPlan,
  sandboxProcessRecipe,
  type ExpoNativeDependencyPreparation,
  type NativeCommandPort,
  type NativeDependencyPreparationApproval,
  type NativeDependencyPreparationInput,
  type NativeDependencyPreparationPlan,
  type NativeDependencyPreparationPolicy,
  type ProcessExecutionPolicy,
} from "@memi/capture-execution/core";

import { SANDBOX_EXECUTABLE } from "./native-capture-process.js";
import {
  normalizeManagedExpoCocoaPodsPhases,
} from "./expo-cocoapods-normalization.js";
import {
  GlogCompatibilityError,
  stabilizeManagedReactNativeGlog,
} from "./glog-compatibility.js";

interface PreparationCoordinates {
  readonly managedWorktreeRoot: string;
  readonly platformRoot: string;
  readonly repositoryRevision: string;
  readonly adapterVersion: string;
  readonly workspaceRelativePath: string;
  readonly includeCocoaPods?: boolean | undefined;
}

// These are the only resolver files macOS consults while a lockfile-pinned
// dependency install has its explicitly approved outbound network capability.
// They are configuration, not source or credential locations.
const DNS_RESOLVER_READ_LITERALS = Object.freeze([
  "/etc/hosts",
  "/etc/resolv.conf",
  "/var/run/resolv.conf",
  "/private/etc/hosts",
  "/private/etc/resolv.conf",
  "/private/var/run/resolv.conf",
]);

const DNS_RESOLVER_METADATA_LITERALS = Object.freeze([
  "/etc",
  "/var",
  "/var/run",
  "/private",
  "/private/etc",
  "/private/var",
  "/private/var/run",
  "/etc/ssl",
  "/private/etc/ssl",
]);

const DNS_RESOLVER_MACH_SERVICES = Object.freeze([
  "com.apple.SystemConfiguration.configd",
  "com.apple.mDNSResponder",
  "com.apple.system.config.networkd",
  "com.apple.system.opendirectoryd.libinfo",
]);

// `xcrun` consults this exact Xcode selector while CocoaPods resolves Expo's
// native-module configuration. It is a system-owned selector, not source
// authority, so grant only this file instead of the surrounding directory.
const XCODE_SELECTOR_READ_LITERALS = Object.freeze([
  "/private/var/select/sh",
  "/private/var/select/developer_dir",
  "/var/select/developer_dir",
  "/etc/ssl/cert.pem",
  "/private/etc/ssl/cert.pem",
  "/private/etc/ssl/openssl.cnf",
]);

const APPLE_GIT_EXECUTABLE = "/usr/bin/git";
// CocoaPods resolves its already-installed Git helper and React Native's
// Hermes podspec resolves CMake through PATH. Keep this bounded: the optional
// CMake executable must be a canonical authority supplied by the sidecar.
function dependencyPreparationPath(
  nodeExecutable: string,
  cmakeExecutable?: string,
): string {
  return [
    dirname(nodeExecutable),
    ...(cmakeExecutable === undefined ? [] : [dirname(cmakeExecutable)]),
    "/usr/bin",
    "/bin",
  ].join(":");
}

export interface NativeDependencyPreparationAuthorityOptions {
  readonly appDataRoot: string;
  readonly commandPort: NativeCommandPort;
  readonly nodeExecutable: string;
  readonly npmExecutable: string;
  readonly podExecutable?: string | undefined;
  readonly cmakeExecutable?: string | undefined;
  readonly developerDirectory?: string | undefined;
  readonly sdkRoot?: string | undefined;
}

export interface NativeDependencyPreparationResolvedInput
  extends PreparationCoordinates, NativeDependencyPreparationInput {
  readonly workspaceRelativePath: string;
}

export interface NativeDependencyPreparationHookInput
  extends NativeDependencyPreparationResolvedInput {
  readonly approval: NativeDependencyPreparationApproval;
}

export interface NativeDependencyPreparationAuthority {
  inputFor(
    coordinates: PreparationCoordinates,
  ): NativeDependencyPreparationResolvedInput;
  hookFor(
    input: NativeDependencyPreparationHookInput,
  ): ExpoNativeDependencyPreparation;
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function validatedSha256(value: string): `sha256:${string}` {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw preparationFailure(
      "NATIVE_DEPENDENCY_PLAN_INVALID",
      false,
      "Native dependency preparation fingerprint is invalid.",
    );
  }
  return value as `sha256:${string}`;
}

function contained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

function workspacePath(
  platformRoot: string,
  workspaceRelativePath: string,
): string {
  if (
    isAbsolute(workspaceRelativePath) ||
    workspaceRelativePath.includes("\0") ||
    !workspaceRelativePath.endsWith(".xcworkspace")
  ) {
    throw new Error(
      "Native dependency workspace authority is invalid.",
    );
  }
  const candidate = resolve(platformRoot, workspaceRelativePath);
  if (!contained(platformRoot, candidate)) {
    throw new Error(
      "Native dependency workspace escapes the managed application.",
    );
  }
  return candidate;
}

function xcodeProjectPath(workspace: string): string {
  if (!workspace.endsWith(".xcworkspace")) {
    throw new Error("Native dependency workspace authority is invalid.");
  }
  return `${workspace.slice(0, -".xcworkspace".length)}.xcodeproj`;
}

function xcodePrivacyManifestPath(xcodeProject: string): string {
  return join(
    dirname(xcodeProject),
    basename(xcodeProject, ".xcodeproj"),
    "PrivacyInfo.xcprivacy",
  );
}

function dependencySandboxRoot(
  appDataRoot: string,
  platformRoot: string,
): string {
  return join(
    appDataRoot,
    "native-dependency-sandbox",
    sha256(platformRoot).slice("sha256:".length, "sha256:".length + 24),
  );
}

function literal(value: string) {
  return Object.freeze({ kind: "literal" as const, value });
}

function safeToken() {
  return Object.freeze({ kind: "safe-token" as const });
}

function toolRoot(executable: string, levels: number): string {
  let root = resolve(executable);
  for (let index = 0; index < levels; index += 1) {
    root = dirname(root);
  }
  return root;
}

function xcodeContentsRoot(
  developerDirectory: string | undefined,
): string | undefined {
  if (developerDirectory === undefined) return undefined;
  const contents = dirname(developerDirectory);
  if (
    basename(developerDirectory) !== "Developer" ||
    basename(contents) !== "Contents" ||
    !basename(dirname(contents)).endsWith(".app")
  ) {
    throw new Error(
      "Xcode developer directory must be the canonical Contents/Developer path.",
    );
  }
  return contents;
}

function metadataAncestors(paths: readonly string[]): readonly string[] {
  const ancestors = new Set<string>();
  for (const path of paths) {
    let current = resolve(path);
    while (current !== "/") {
      ancestors.add(current);
      current = dirname(current);
    }
  }
  return Object.freeze([...ancestors]);
}

function executionPolicy(input: {
  readonly appDataRoot: string;
  readonly platformRoot: string;
  readonly workspaceRelativePath: string;
  readonly nodeExecutable: string;
  readonly npmCliExecutable: string;
  readonly podExecutable?: string | undefined;
  readonly cmakeExecutable?: string | undefined;
  readonly developerDirectory?: string | undefined;
  readonly sdkRoot?: string | undefined;
}): ProcessExecutionPolicy {
  const iosRoot = join(input.platformRoot, "ios");
  const nodeRuntimeRoot = toolRoot(input.nodeExecutable, 2);
  const npmPackageRoot = toolRoot(input.npmCliExecutable, 2);
  const xcodeContents = xcodeContentsRoot(input.developerDirectory);
  const cmakeRuntimeRoot =
    input.cmakeExecutable === undefined
      ? undefined
      : toolRoot(input.cmakeExecutable, 2);
  const sandboxRoot = dependencySandboxRoot(
    input.appDataRoot,
    input.platformRoot,
  );
  const home = join(sandboxRoot, "home");
  const temporaryDirectory = join(sandboxRoot, "tmp");
  const workspace = workspacePath(
    input.platformRoot,
    input.workspaceRelativePath,
  );
  const xcodeProject = xcodeProjectPath(workspace);
  const xcodePrivacyManifest = xcodePrivacyManifestPath(xcodeProject);
  const commands = [
    Object.freeze({
      executable: input.nodeExecutable,
      arguments: Object.freeze([
        literal(input.npmCliExecutable),
        literal("ci"),
        literal("--ignore-scripts"),
        literal("--no-audit"),
        literal("--no-fund"),
      ]),
    }),
    ...(input.podExecutable === undefined
      ? []
      : [
          Object.freeze({
            executable: APPLE_GIT_EXECUTABLE,
            arguments: Object.freeze([literal("--version")]),
          }),
          Object.freeze({
            executable: input.podExecutable,
            arguments: Object.freeze([
              literal("install"),
              literal("--no-repo-update"),
            ]),
          }),
        ]),
    ...(input.podExecutable === undefined
      ? []
      : [
          Object.freeze({
            executable: input.nodeExecutable,
            arguments: Object.freeze([
              literal(join(
                input.platformRoot,
                "node_modules",
                "react-native",
                "sdks",
                "hermes-engine",
                "utils",
                "replace_hermes_version.js",
              )),
              literal("-c"),
              literal("Release"),
              literal("-r"),
              safeToken(),
              literal("-p"),
              literal(join(iosRoot, "Pods")),
            ]),
          }),
        ]),
  ];
  return Object.freeze({
    allowedCommands: Object.freeze(commands),
    allowedCwdRoots: Object.freeze([
      input.platformRoot,
      iosRoot,
      sandboxRoot,
    ]),
    sandboxEnvironment: Object.freeze({
      home,
      temporaryDirectory,
      path: dependencyPreparationPath(
        input.nodeExecutable,
        input.cmakeExecutable,
      ),
      ...(input.developerDirectory === undefined
        ? {}
        : { developerDirectory: input.developerDirectory }),
      ...(input.sdkRoot === undefined ? {} : { sdkRoot: input.sdkRoot }),
      ...(input.developerDirectory === undefined || input.sdkRoot === undefined
        ? {}
        : {
            autoconfPlatformName: "iphonesimulator" as const,
            autoconfCurrentArchitecture: "arm64" as const,
          }),
      gitConfigNoSystem: true,
    }),
    sandbox: Object.freeze({
      executable: SANDBOX_EXECUTABLE,
      allowedReadRoots: Object.freeze([
        input.platformRoot,
        sandboxRoot,
        nodeRuntimeRoot,
        npmPackageRoot,
        ...(input.podExecutable === undefined
          ? []
          : [dirname(input.podExecutable)]),
        ...(cmakeRuntimeRoot === undefined ? [] : [cmakeRuntimeRoot]),
        ...(xcodeContents === undefined
          ? []
          : [xcodeContents]),
        "/System",
        "/Library",
        "/usr",
        // CocoaPods verifies `bash` and its prepare scripts invoke `mkdir`
        // through their lexical /bin paths. APFS aliases are not covered by a
        // /usr subpath rule during File.file? metadata checks.
        "/bin",
        "/opt/homebrew",
        "/usr/local",
      ]),
      allowedReadMetadataRoots: Object.freeze(
        xcodeContents === undefined ? [] : [xcodeContents],
      ),
      allowedWriteRoots: Object.freeze([
        join(input.platformRoot, "node_modules"),
        join(iosRoot, "Pods"),
        // Expo's `use_native_modules!` creates this deterministic build
        // scratch directory while CocoaPods evaluates the Podfile.
        join(iosRoot, "build"),
        workspace,
        // CocoaPods integrates the checked-in application project in the
        // managed copy. It may not write any other source path.
        xcodeProject,
        home,
        temporaryDirectory,
      ]),
      allowedReadLiterals: Object.freeze([
        "/dev/null",
        "/private/etc/passwd",
        "/private/etc/group",
        ...DNS_RESOLVER_READ_LITERALS,
        ...XCODE_SELECTOR_READ_LITERALS,
      ]),
      // Node resolves its executable ancestry before reading its explicitly
      // allowlisted runtime tree. macOS sandbox-exec does not grant metadata
      // access to those ancestors from a subpath rule, so list the exact
      // known ancestors without granting recursive access to user folders.
      allowedReadMetadataLiterals: metadataAncestors([
        ...DNS_RESOLVER_METADATA_LITERALS,
        input.platformRoot,
        sandboxRoot,
        nodeRuntimeRoot,
        npmPackageRoot,
        ...(input.podExecutable === undefined
          ? []
          : [dirname(input.podExecutable)]),
        ...(cmakeRuntimeRoot === undefined ? [] : [cmakeRuntimeRoot]),
        ...(xcodeContents === undefined
          ? []
          : [xcodeContents]),
      ]),
      allowRootMetadata: true,
      allowedWriteLiterals: Object.freeze([
        "/dev/null",
        join(iosRoot, "Podfile.lock"),
        xcodePrivacyManifest,
      ]),
      allowedMachLookupGlobals: DNS_RESOLVER_MACH_SERVICES,
      network: "outbound" as const,
    }),
  });
}

function exactPolicy(
  processPolicy: ProcessExecutionPolicy,
): NativeDependencyPreparationPolicy {
  return Object.freeze({
    contract: "memi.native-dependency-preparation-policy.v1",
    network: "locked-dependency-downloads",
    npmLifecycleScripts: "disabled",
    cocoapodsHooks: "enabled",
    requireLockfiles: true,
    sandboxProfileFingerprint: sha256(
      buildSandboxProfile(processPolicy),
    ),
  });
}

function planInput(
  input: NativeDependencyPreparationHookInput,
): NativeDependencyPreparationInput {
  return Object.freeze({
    managedWorktreeRoot: input.managedWorktreeRoot,
    platformRoot: input.platformRoot,
    repositoryRevision: input.repositoryRevision,
    adapterVersion: input.adapterVersion,
    nodeExecutable: input.nodeExecutable,
    npmExecutable: input.npmExecutable,
    ...(input.podExecutable === undefined
      ? {}
      : { podExecutable: input.podExecutable }),
    ...(input.includeCocoaPods === false
      ? { includeCocoaPods: false as const }
      : {}),
    policy: input.policy,
  });
}

function preparationFailure(
  code: string,
  retryable: boolean,
  cause: unknown,
): CaptureExecutionError {
  return new CaptureExecutionError(
    "prepare-fixtures",
    code,
    retryable,
    cause,
  );
}

function boundedRemediation(
  remediation: string,
  cause: unknown,
): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(`${remediation} ${message}`, { cause });
}

function planFailure(error: unknown): CaptureExecutionError {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(?:package-lock\.json|Podfile(?:\.lock)?)\b|lockfile/iu.test(message)) {
    return preparationFailure(
      "NATIVE_DEPENDENCY_LOCKFILE_INVALID",
      false,
      boundedRemediation(
        "Regenerate and commit the dependency lockfiles in the source project, then create a new approved plan.",
        error,
      ),
    );
  }
  if (/\b(?:node|npm|pod) executable\b|npm runtime tree/iu.test(message)) {
    return preparationFailure(
      "NATIVE_DEPENDENCY_TOOL_UNAVAILABLE",
      false,
      boundedRemediation(
        "Restore the pinned Node, npm, or CocoaPods tool outside Memi, then create a new approved plan.",
        error,
      ),
    );
  }
  return preparationFailure(
    "NATIVE_DEPENDENCY_PLAN_INVALID",
    false,
    error,
  );
}

function commandFailure(
  command: NativeDependencyPreparationPlan["commands"][number],
  error: unknown,
  signal: AbortSignal,
): CaptureExecutionError {
  if (error instanceof CaptureExecutionError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(?:EPERM|EACCES)\b|operation not permitted|sandbox(?:-exec)?[^\n]*deny/iu.test(message)) {
    return preparationFailure(
      "NATIVE_DEPENDENCY_SANDBOX_CONFIGURATION_INVALID",
      false,
      boundedRemediation(
        "Update the sidecar sandbox profile; retrying this approved plan will not help.",
        error,
      ),
    );
  }
  // Process output may quote SIGTERM or cancellation while reporting an
  // unrelated CocoaPods/Xcode failure. Only the controller establishes a
  // truthful cancellation state.
  if (signal.aborted) {
    return preparationFailure(
      "NATIVE_DEPENDENCY_PREPARATION_CANCELLED",
      true,
      error,
    );
  }
  if (
    command.id === "pod-install" &&
    /xcode-select:\s*error:\s*no developer tools|developer tools were found|failed to locate ['"]?git|failed to determine realpath.*sdk/iu.test(message)
  ) {
    return preparationFailure(
      "NATIVE_XCODE_TOOLCHAIN_UNAVAILABLE",
      false,
      boundedRemediation(
        "Select an installed Xcode toolchain outside Memi, then create a new approved plan.",
        error,
      ),
    );
  }
  if (
    command.id === "pod-install" &&
    /\b(?:Podfile\.lock|lockfile)\b|sandbox is not in sync|there were changes to the podfile in deployment mode/iu.test(message)
  ) {
    return preparationFailure(
      "COCOAPODS_LOCKFILE_INVALID",
      false,
      boundedRemediation(
        "Regenerate and commit Podfile.lock in the source project, then create a new approved plan.",
        error,
      ),
    );
  }
  if (
    command.id === "pod-install" &&
    /\bCDN:|couldn['’]t be downloaded|unable to add a source|could not find a spec(?:ification)?/iu.test(message)
  ) {
    return preparationFailure(
      "COCOAPODS_CACHE_UNAVAILABLE",
      true,
      boundedRemediation(
        "Restore access to the locked CocoaPods artifact cache or CDN, then retry preparation once.",
        error,
      ),
    );
  }
  return preparationFailure(
    command.id === "npm-ci"
      ? "NPM_DEPENDENCY_INSTALL_FAILED"
      : "COCOAPODS_DEPENDENCY_INSTALL_FAILED",
    true,
    error,
  );
}

async function canonicalAuthorityPath(
  path: string,
  code: string,
): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    throw new CaptureExecutionError("validate", code, false, error);
  }
}

export async function createNativeDependencyPreparationAuthority(
  options: NativeDependencyPreparationAuthorityOptions,
): Promise<NativeDependencyPreparationAuthority> {
  const [
    appDataRoot,
    nodeExecutable,
    npmCliExecutable,
    podExecutable,
    cmakeExecutable,
    developerDirectory,
  ] = await Promise.all([
    canonicalAuthorityPath(
      options.appDataRoot,
      "NATIVE_DEPENDENCY_STORAGE_INVALID",
    ),
    canonicalAuthorityPath(
      options.nodeExecutable,
      "NATIVE_DEPENDENCY_TOOL_UNAVAILABLE",
    ),
    canonicalAuthorityPath(
      options.npmExecutable,
      "NATIVE_DEPENDENCY_TOOL_UNAVAILABLE",
    ),
    options.podExecutable === undefined
      ? Promise.resolve(undefined)
      : canonicalAuthorityPath(
          options.podExecutable,
          "NATIVE_DEPENDENCY_TOOL_UNAVAILABLE",
        ),
    options.cmakeExecutable === undefined
      ? Promise.resolve(undefined)
      : canonicalAuthorityPath(
          options.cmakeExecutable,
          "NATIVE_DEPENDENCY_TOOL_UNAVAILABLE",
        ),
    options.developerDirectory === undefined
      ? Promise.resolve(undefined)
      : canonicalAuthorityPath(
          options.developerDirectory,
          "NATIVE_XCODE_TOOLCHAIN_UNAVAILABLE",
        ),
  ]);
  const sdkRoot = developerDirectory === undefined
    ? undefined
    : await canonicalAuthorityPath(
        join(
          developerDirectory,
          "Platforms",
          "MacOSX.platform",
          "Developer",
          "SDKs",
          "MacOSX.sdk",
        ),
        "NATIVE_XCODE_TOOLCHAIN_UNAVAILABLE",
      );
  const completedPlans = new Set<string>();

  const inputFor = (
    coordinates: PreparationCoordinates,
  ): NativeDependencyPreparationResolvedInput => {
    let managedWorktreeRoot: string;
    let platformRoot: string;
    try {
      managedWorktreeRoot = realpathSync.native(
        coordinates.managedWorktreeRoot,
      );
      platformRoot = realpathSync.native(coordinates.platformRoot);
    } catch (error) {
      throw new CaptureExecutionError(
        "validate",
        "NATIVE_DEPENDENCY_WORKTREE_INVALID",
        false,
        error,
      );
    }
    if (!contained(managedWorktreeRoot, platformRoot)) {
      throw new CaptureExecutionError(
        "validate",
        "NATIVE_DEPENDENCY_WORKTREE_INVALID",
        false,
        "Native dependency platform escapes the managed worktree.",
      );
    }
    const canonicalCoordinates = Object.freeze({
      ...coordinates,
      managedWorktreeRoot,
      platformRoot,
    });
    let processPolicy: ProcessExecutionPolicy;
    try {
      processPolicy = executionPolicy({
        appDataRoot,
        platformRoot,
        workspaceRelativePath: coordinates.workspaceRelativePath,
        nodeExecutable,
        npmCliExecutable,
        ...(coordinates.includeCocoaPods === false || podExecutable === undefined
          ? {}
          : { podExecutable }),
        ...(cmakeExecutable === undefined ? {} : { cmakeExecutable }),
        ...(developerDirectory === undefined ? {} : { developerDirectory }),
        ...(sdkRoot === undefined ? {} : { sdkRoot }),
      });
    } catch (error) {
      throw new CaptureExecutionError(
        "validate",
        "NATIVE_DEPENDENCY_WORKTREE_INVALID",
        false,
        error,
      );
    }
    return Object.freeze({
      ...canonicalCoordinates,
      nodeExecutable: options.nodeExecutable,
      npmExecutable: options.npmExecutable,
      ...(coordinates.includeCocoaPods === false || options.podExecutable === undefined
        ? {}
        : { podExecutable: options.podExecutable }),
      ...(coordinates.includeCocoaPods === false
        ? { includeCocoaPods: false as const }
        : {}),
      policy: exactPolicy(processPolicy),
    });
  };

  return Object.freeze({
    inputFor,
    hookFor(input: NativeDependencyPreparationHookInput) {
      const processPolicy = executionPolicy({
        appDataRoot,
        platformRoot: input.platformRoot,
        workspaceRelativePath: input.workspaceRelativePath,
        nodeExecutable,
        npmCliExecutable,
        ...(input.includeCocoaPods === false || podExecutable === undefined
          ? {}
          : { podExecutable }),
        ...(cmakeExecutable === undefined ? {} : { cmakeExecutable }),
        ...(developerDirectory === undefined ? {} : { developerDirectory }),
        ...(sdkRoot === undefined ? {} : { sdkRoot }),
      });
      const currentPlan = async () => {
        try {
          return await createNativeDependencyPreparationPlan(
            planInput(input),
          );
        } catch (error) {
          throw planFailure(error);
        }
      };
      return Object.freeze({
        approval: input.approval,
        currentPlan,
        async execute(
          suppliedPlan: NativeDependencyPreparationPlan,
          signal: AbortSignal,
        ) {
          const rebuiltPlan = await currentPlan();
          if (rebuiltPlan.fingerprint !== suppliedPlan.fingerprint) {
            throw preparationFailure(
              "NATIVE_DEPENDENCY_PLAN_CHANGED",
              false,
              "Native dependency preparation changed before execution.",
            );
          }
          try {
            assertNativeDependencyPreparationApproval(
              rebuiltPlan,
              input.approval,
            );
          } catch (error) {
            throw preparationFailure(
              "NATIVE_DEPENDENCY_APPROVAL_INVALID",
              false,
              error,
            );
          }
          const completionKey =
            `${input.platformRoot}:${rebuiltPlan.fingerprint}`;
          if (completedPlans.has(completionKey)) {
            return;
          }
          const sandboxRoot = dependencySandboxRoot(
            appDataRoot,
            input.platformRoot,
          );
          await Promise.all([
            mkdir(join(sandboxRoot, "home"), {
              recursive: true,
              mode: 0o700,
            }),
            mkdir(join(sandboxRoot, "tmp"), {
              recursive: true,
              mode: 0o700,
            }),
          ]);
          if (input.includeCocoaPods !== false && podExecutable !== undefined) {
            // React Native's glog script patches this generated cache in place.
            // A cancelled run leaves that patch behind and a retry blocks waiting
            // for patch input. Reset only the generated glog cache before the
            // approved pod command; source and all other cached pods remain intact.
            await rm(
              join(
                sandboxRoot,
                "home",
                "Library",
                "Caches",
                "CocoaPods",
                "Pods",
                "External",
                "glog",
              ),
              { recursive: true, force: true },
            );
          }
          let normalizedHermesRelease: string | null = null;
          for (const command of rebuiltPlan.commands) {
            if (command.id === "hermes-release-selection") {
              const plannedRelease = command.args[4];
              if (
                normalizedHermesRelease === null ||
                plannedRelease === undefined ||
                plannedRelease !== normalizedHermesRelease
              ) {
                throw preparationFailure(
                  "HERMES_RELEASE_SELECTION_INVALID",
                  false,
                  "The approved Hermes release does not match the generated CocoaPods phase.",
                );
              }
            }
            if (command.id === "pod-install") {
              try {
                await options.commandPort.execute(
                  sandboxProcessRecipe(
                    {
                      executable: APPLE_GIT_EXECUTABLE,
                      args: ["--version"],
                      cwd: command.cwd,
                    },
                    processPolicy,
                  ),
                  signal,
                );
              } catch (error) {
                throw commandFailure(command, error, signal);
              }
            }
            try {
              await options.commandPort.execute(
                sandboxProcessRecipe(
                  {
                    executable: command.executable,
                    args: command.args,
                    cwd: command.cwd,
                  },
                  processPolicy,
                ),
                signal,
              );
            } catch (error) {
              throw commandFailure(command, error, signal);
            }
            if (
              command.id === "npm-ci" &&
              input.includeCocoaPods !== false &&
              podExecutable !== undefined
            ) {
              try {
                await stabilizeManagedReactNativeGlog(input.platformRoot);
              } catch (error) {
                if (error instanceof GlogCompatibilityError) {
                  throw preparationFailure(
                    error.code,
                    error.retryable,
                    error.message,
                  );
                }
                throw error;
              }
            }
            if (
              command.id === "pod-install" &&
              input.includeCocoaPods !== false &&
              podExecutable !== undefined
            ) {
              const normalization = await normalizeManagedExpoCocoaPodsPhases({
                managedWorktreeRoot: input.managedWorktreeRoot,
                platformRoot: input.platformRoot,
                repositoryRevision: input.repositoryRevision,
                preparationFingerprint: validatedSha256(
                  rebuiltPlan.fingerprint,
                ),
              });
              normalizedHermesRelease = normalization.hermesReleaseVersion;
            }
          }
          completedPlans.add(completionKey);
        },
      });
    },
  });
}
