import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  approveNativeDependencyPreparationPlan,
  assertNativeDependencyPreparationApproval,
  CaptureExecutionError,
  createNativeDependencyPreparationPlan,
  type NativeCommandPort,
} from "@memi/capture-execution";
import { describe, expect, it, vi } from "vitest";

import { createNativeDependencyPreparationAuthority } from "./native-dependency-preparation.js";

const execFileAsync = promisify(execFile);

const EXPO_COCOAPODS_PROJECT = String.raw`
		AA01 /* [CP-User] Generate app.config for prebuilt Constants.manifest */ = {
			isa = PBXShellScriptBuildPhase;
			name = "[CP-User] Generate app.config for prebuilt Constants.manifest";
			shellScript = "bash -l -c \"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\"";
		};
		AA02 /* [CP-User] Generate updates resources for expo-updates */ = {
			isa = PBXShellScriptBuildPhase;
			name = "[CP-User] Generate updates resources for expo-updates";
			shellScript = "bash -l -c \"$PODS_TARGET_SRCROOT/../scripts/create-updates-resources-ios.sh\"";
		};
`;

const EXPO_HERMES_PHASE = String.raw`
		AA03 /* [CP-User] [Hermes] Replace Hermes for the right configuration, if needed */ = {
			isa = PBXShellScriptBuildPhase;
			name = "[CP-User] [Hermes] Replace Hermes for the right configuration, if needed";
			shellPath = /bin/sh;
			shellScript = "        . \"$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh\"\n\n        CONFIG=\"Release\"\n        if echo $GCC_PREPROCESSOR_DEFINITIONS | grep -q \"DEBUG=1\"; then\n          CONFIG=\"Debug\"\n        fi\n\n        \"$NODE_BINARY\" \"$REACT_NATIVE_PATH/sdks/hermes-engine/utils/replace_hermes_version.js\" -c \"$CONFIG\" -r \"0.81.5\" -p \"$PODS_ROOT\"\n";
		};
`;

const EXPO_HERMES_TARGET_REFERENCE = String.raw`
/* Begin PBXAggregateTarget section */
		BB01 /* hermes-engine */ = {
			isa = PBXAggregateTarget;
			buildPhases = (
				AA03 /* [CP-User] [Hermes] Replace Hermes for the right configuration, if needed */,
			);
		};
/* End PBXAggregateTarget section */
`;

async function executable(path: string, body: string): Promise<string> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, body, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

async function fixture(options: {
  readonly withCmake?: boolean;
  readonly developerDirectoryPath?: string;
  readonly nodeExecutablePath?: string;
  readonly npmExecutablePath?: string;
  readonly nodeBody?: string;
  readonly temporaryRoot?: string;
  readonly withXcodeDeveloperDirectory?: boolean;
} = {}) {
  const root = await mkdtemp(
    join(
      options.temporaryRoot ?? tmpdir(),
      "memi-sidecar-native-dependencies-",
    ),
  );
  const appDataRoot = join(root, "app-data");
  const managedWorktreeRoot = join(root, "managed");
  const platformRoot = join(managedWorktreeRoot, "apps", "mobile");
  const iosRoot = join(platformRoot, "ios");
  const toolRoot = join(root, "tools");
  const developerDirectory = options.developerDirectoryPath ??
    (options.withXcodeDeveloperDirectory
      ? join(root, "Xcode.app", "Contents", "Developer")
      : undefined);
  const sdkRoot = developerDirectory === undefined
    ? undefined
    : join(
        developerDirectory,
        "Platforms",
        "MacOSX.platform",
        "Developer",
        "SDKs",
        "MacOSX.sdk",
      );
  await Promise.all([
    mkdir(appDataRoot, { recursive: true }),
    mkdir(iosRoot, { recursive: true }),
    mkdir(join(iosRoot, "Pods", "Pods.xcodeproj"), { recursive: true }),
    mkdir(
      join(platformRoot, "node_modules", "react-native", "scripts"),
      { recursive: true },
    ),
    ...(developerDirectory === undefined ||
      options.developerDirectoryPath !== undefined
      ? []
      : [mkdir(sdkRoot!, { recursive: true })]),
  ]);
  await Promise.all([
    writeFile(
      join(platformRoot, "package.json"),
      JSON.stringify({
        name: "mobile",
        private: true,
        packageManager: "npm@10.9.2",
      }),
    ),
    writeFile(
      join(platformRoot, "package-lock.json"),
      JSON.stringify({
        name: "mobile",
        lockfileVersion: 3,
        packages: {},
      }),
    ),
    writeFile(join(iosRoot, "Podfile"), "platform :ios, '17.0'\n"),
    writeFile(join(iosRoot, "Podfile.lock"), "PODS:\n  - Expo\n"),
    writeFile(
      join(
        platformRoot,
        "node_modules",
        "react-native",
        "scripts",
        "ios-configure-glog.sh",
      ),
      "#!/bin/sh\n./configure --host arm-apple-darwin || true\n",
    ),
    writeFile(
      join(iosRoot, "Pods", "Pods.xcodeproj", "project.pbxproj"),
      EXPO_COCOAPODS_PROJECT,
    ),
  ]);
  const nodeExecutable = options.nodeExecutablePath ?? await executable(
    join(toolRoot, "bin", "node"),
    options.nodeBody ?? "#!/bin/sh\nexit 0\n",
  );
  const npmCliExecutable = options.npmExecutablePath ?? await executable(
    join(
      toolRoot,
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
    "require('../lib/cli.js')\n",
  );
  if (options.npmExecutablePath === undefined) {
    await executable(
      join(toolRoot, "lib", "node_modules", "npm", "lib", "cli.js"),
      "module.exports = () => undefined\n",
    );
  }
  const npmExecutable = options.npmExecutablePath ?? join(toolRoot, "bin", "npm");
  if (options.npmExecutablePath === undefined) {
    await symlink(npmCliExecutable, npmExecutable);
  }
  const podExecutable = await executable(
    join(toolRoot, "bin", "pod"),
    "#!/bin/sh\nexit 0\n",
  );
  const cmakeExecutable = options.withCmake === true
    ? await executable(
        join(appDataRoot, "toolchains", "cmake", "data", "bin", "cmake"),
        "#!/bin/sh\nexit 0\n",
      )
    : undefined;
  const execute = vi.fn(async (
    _recipe: Parameters<NativeCommandPort["execute"]>[0],
    _signal: AbortSignal,
  ) => ({
    stdout: new Uint8Array(),
    stderr: "",
  }));
  const commandPort: NativeCommandPort = { execute };
  const authority = await createNativeDependencyPreparationAuthority({
    appDataRoot,
    commandPort,
    nodeExecutable,
    npmExecutable,
    podExecutable,
    ...(cmakeExecutable === undefined ? {} : { cmakeExecutable }),
    ...(developerDirectory === undefined
      ? {}
      : { developerDirectory: await realpath(developerDirectory) }),
  });
  const input = authority.inputFor({
    managedWorktreeRoot,
    platformRoot,
    repositoryRevision: "a".repeat(40),
    adapterVersion: "1.0.0",
    workspaceRelativePath: "ios/Mobile.xcworkspace",
  });
  const plan = await createNativeDependencyPreparationPlan(input);
  const approval = approveNativeDependencyPreparationPlan(plan, {
    approvedFingerprint: plan.fingerprint,
    approvedBy: "human:repository-import",
    approvedAt: "2026-07-30T12:00:00.000Z",
  });
  return {
    appDataRoot,
    approval,
    authority,
    execute,
    ...(developerDirectory === undefined
      ? {}
      : { developerDirectory: await realpath(developerDirectory) }),
    input,
    managedWorktreeRoot: input.managedWorktreeRoot,
    npmCliExecutable: await realpath(npmExecutable),
    nodeExecutable: await realpath(nodeExecutable),
    plan,
    platformRoot: input.platformRoot,
    podExecutable: await realpath(podExecutable),
    ...(cmakeExecutable === undefined
      ? {}
      : { cmakeExecutable: await realpath(cmakeExecutable) }),
  };
}

describe("native dependency preparation sidecar authority", () => {
  it("renders resolved glog headers instead of running the legacy Autoconf probe", async () => {
    const target = await fixture();
    const hook = target.authority.hookFor({
      ...target.input,
      approval: target.approval,
    });

    await hook.execute(await hook.currentPlan(), new AbortController().signal);

    const script = await readFile(
      join(
        target.platformRoot,
        "node_modules",
        "react-native",
        "scripts",
        "ios-configure-glog.sh",
      ),
      "utf8",
    );
    expect(script).toContain(
      "Memi capture: deterministic glog 0.3.5 headers for iOS Simulator.",
    );
    expect(script).not.toContain("./configure --host arm-apple-darwin || true");
    expect(script).not.toContain("\n+");
    expect(script).toContain("@ac_google_namespace@|google");
    expect(script).toContain(
      "@ac_google_namespace@|google|g' \\\n    \"src/glog/$header.h.in\"",
    );
    expect(script).toContain(
      "#define _START_GOOGLE_NAMESPACE_ namespace google {|' \\\n  src/config.h.in",
    );
    expect(script).toContain("#define GOOGLE_NAMESPACE google");
  });

  it("uses the target simulator environment for the upstream React Native glog hook", async () => {
    const target = await fixture({ withXcodeDeveloperDirectory: true });
    const hook = target.authority.hookFor({
      ...target.input,
      approval: target.approval,
    });

    await hook.execute(await hook.currentPlan(), new AbortController().signal);

    const podRecipe = target.execute.mock.calls[2]![0];
    expect(podRecipe.environment?.PLATFORM_NAME).toBe("iphonesimulator");
    expect(podRecipe.environment?.CURRENT_ARCH).toBe("arm64");
    expect(podRecipe.environment?.PATH).toContain(
      `${dirname(target.nodeExecutable)}:`,
    );
    expect(podRecipe.environment?.PATH).toMatch(/:\/usr\/bin:\/bin$/u);
  });

  it("exposes a managed CMake runtime to locked CocoaPods without broadening PATH", async () => {
    const target = await fixture({ withCmake: true });
    const hook = target.authority.hookFor({
      ...target.input,
      approval: target.approval,
    });

    await hook.execute(await hook.currentPlan(), new AbortController().signal);

    const podRecipe = target.execute.mock.calls[2]![0];
    expect(podRecipe.environment?.PATH).toContain(
      `${dirname(target.nodeExecutable)}:${dirname(target.cmakeExecutable!)}:`,
    );
    expect(podRecipe.environment?.PATH).toMatch(/:\/usr\/bin:\/bin$/u);
    expect(podRecipe.args[1]).toContain(
      `(allow file-read* (subpath "${dirname(dirname(target.cmakeExecutable!))}"))`,
    );
  });

  it("allows CocoaPods to integrate only the managed Xcode project paired with its workspace", async () => {
    const target = await fixture();
    const hook = target.authority.hookFor({
      ...target.input,
      approval: target.approval,
    });

    await hook.execute(await hook.currentPlan(), new AbortController().signal);

    const podRecipe = target.execute.mock.calls[2]![0];
    expect(podRecipe.args[1]).toContain(
      `(allow file-write* (subpath "${join(target.platformRoot, "ios", "Mobile.xcodeproj")}"))`,
    );
    expect(podRecipe.args[1]).toContain(
      `(allow file-write* (literal "${join(target.platformRoot, "ios", "Mobile", "PrivacyInfo.xcprivacy")}"))`,
    );
  });

  it("plans a lockfile-pinned JavaScript install without CocoaPods for a managed development client", async () => {
    const target = await fixture();

    const plan = await createNativeDependencyPreparationPlan({
      ...target.input,
      includeCocoaPods: false,
    });

    expect(plan.commands.map((command) => command.id)).toEqual(["npm-ci"]);
    expect(plan.tools.map((tool) => tool.tool)).toEqual(["node", "npm"]);
    expect(plan.lockfiles.map((lockfile) => lockfile.relativePath)).toEqual([
      "package-lock.json",
    ]);

    const approval = approveNativeDependencyPreparationPlan(plan, {
      approvedFingerprint: plan.fingerprint,
      approvedBy: "human:repository-import",
      approvedAt: "2026-08-01T07:00:00.000Z",
    });
    const current = await target.authority.hookFor({
      ...target.input,
      includeCocoaPods: false,
      approval,
    }).currentPlan();

    expect(current.commands.map((command) => command.id)).toEqual(["npm-ci"]);
  });

  it("sets an approved Xcode developer directory for CocoaPods", async () => {
    const target = await fixture({ withXcodeDeveloperDirectory: true });
    const hook = target.authority.hookFor({
      ...target.input,
      approval: target.approval,
      workspaceRelativePath: "ios/Mobile.xcworkspace",
    });

    await hook.execute(await hook.currentPlan(), new AbortController().signal);

    const podRecipe = target.execute.mock.calls[2]![0];
    expect(podRecipe.environment).toMatchObject({
      DEVELOPER_DIR: target.developerDirectory,
      SDKROOT: join(
        target.developerDirectory!,
        "Platforms",
        "MacOSX.platform",
        "Developer",
        "SDKs",
        "MacOSX.sdk",
      ),
      GIT_CONFIG_NOSYSTEM: "1",
    });
    expect(podRecipe.args[1]).toContain(
      `(allow file-read* (subpath "${dirname(target.developerDirectory!)}"))`,
    );
    expect(podRecipe.args[1]).toContain(
      `(allow file-read-metadata (subpath "${dirname(target.developerDirectory!)}"))`,
    );
    expect(podRecipe.args[1]).toContain(
      '(allow file-read* (literal "/private/var/select/sh"))',
    );
    expect(podRecipe.args[1]).toContain(
      '(allow file-read* (literal "/private/var/select/developer_dir"))',
    );
    expect(podRecipe.args[1]).toContain(
      '(allow file-read* (literal "/var/select/developer_dir"))',
    );
    expect(podRecipe.args[1]).toContain(
      '(allow file-read* (literal "/private/etc/ssl/openssl.cnf"))',
    );
    expect(podRecipe.args[1]).toContain(
      '(allow file-read* (literal "/private/etc/ssl/cert.pem"))',
    );
    expect(podRecipe.args[1]).toContain(
      '(allow file-read-metadata (literal "/private/etc/ssl"))',
    );
    expect(podRecipe.args[1]).toContain(
      '(allow file-read* (subpath "/bin"))',
    );
    expect(podRecipe.args[1]).toContain(
      '(allow file-read-metadata (literal "/"))',
    );
    expect(podRecipe.args[1]).toContain(
      `(allow file-write* (subpath "${join(target.platformRoot, "ios", "build")}"))`,
    );
  });

  it.skipIf(process.platform !== "darwin")(
    "runs Apple Git in the dependency sandbox without administrator changes",
    async () => {
      const selected = await execFileAsync(
        "/usr/bin/xcode-select",
        ["-p"],
      );
      const target = await fixture({
        developerDirectoryPath: selected.stdout.trim(),
      });
      const hook = target.authority.hookFor({
        ...target.input,
        approval: target.approval,
        workspaceRelativePath: "ios/Mobile.xcworkspace",
      });
      await hook.execute(
        await hook.currentPlan(),
        new AbortController().signal,
      );
      const podRecipe = target.execute.mock.calls[1]![0];

      await expect(execFileAsync(
        "/usr/bin/sandbox-exec",
        ["-p", podRecipe.args[1]!, "/usr/bin/git", "--version"],
        {
          cwd: target.platformRoot,
          env: { ...podRecipe.environment },
        },
      )).resolves.toMatchObject({
        stdout: expect.stringMatching(/^git version /u),
      });
    },
  );

  it("executes only the current approved commands in the dedicated sandbox", async () => {
    const target = await fixture();
    const hook = target.authority.hookFor({
      ...target.input,
      approval: target.approval,
      workspaceRelativePath: "ios/Mobile.xcworkspace",
    });
    const currentPlan = await hook.currentPlan();

    assertNativeDependencyPreparationApproval(
      currentPlan,
      hook.approval,
    );
    await hook.execute(currentPlan, new AbortController().signal);

    expect(target.execute).toHaveBeenCalledTimes(3);
    const recipes = target.execute.mock.calls.map(([recipe]) => recipe);
    expect(recipes.map(({ executable }) => executable)).toEqual([
      "/usr/bin/sandbox-exec",
      "/usr/bin/sandbox-exec",
      "/usr/bin/sandbox-exec",
    ]);
    expect(recipes.map(({ args }) => args.slice(2))).toEqual([
      [
        target.nodeExecutable,
        target.npmCliExecutable,
        "ci",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      [
        "/usr/bin/git",
        "--version",
      ],
      [
        target.podExecutable,
        "install",
        "--no-repo-update",
      ],
    ]);
    expect(recipes.map(({ cwd }) => cwd)).toEqual([
      target.platformRoot,
      join(target.platformRoot, "ios"),
      join(target.platformRoot, "ios"),
    ]);
    for (const recipe of recipes) {
      expect(recipe.environment).toMatchObject({
        HOME: expect.stringContaining(
          "/native-dependency-sandbox/",
        ),
        TMPDIR: expect.stringContaining(
          "/native-dependency-sandbox/",
        ),
      });
      expect(recipe.environment?.PATH).toContain(
        `${dirname(target.nodeExecutable)}:`,
      );
      expect(recipe.environment?.PATH).toMatch(/:\/usr\/bin:\/bin$/u);
      expect(recipe.args[1]).toContain("(allow network-outbound)");
      expect(recipe.args[1]).not.toContain(
        `(allow file-write* (subpath "${target.managedWorktreeRoot}"))`,
      );
    }
    expect(recipes[0]!.args[1]).toContain(
      `(allow file-write* (subpath "${join(
        target.platformRoot,
        "node_modules",
      )}"))`,
    );
    expect(recipes[2]!.args[1]).toContain(
      `(allow file-write* (subpath "${join(
        target.platformRoot,
        "ios",
        "Mobile.xcworkspace",
      )}"))`,
    );
    expect(recipes[0]!.args[1]).toContain(
      `(allow file-read* (subpath "${dirname(dirname(target.nodeExecutable))}"))`,
    );
    expect(recipes[0]!.args[1]).toContain(
      `(allow file-read* (subpath "${dirname(dirname(target.npmCliExecutable))}"))`,
    );
    expect(recipes[0]!.args[1]).toContain(
      `(allow file-read-metadata (literal "${dirname(target.nodeExecutable)}"))`,
    );
    expect(recipes[0]!.args[1]).toContain(
      '(allow file-read* (literal "/private/etc/resolv.conf"))',
    );
    expect(recipes[0]!.args[1]).toContain(
      '(allow file-read* (literal "/private/var/run/resolv.conf"))',
    );
    expect(recipes[0]!.args[1]).toContain(
      '(allow file-read* (literal "/etc/resolv.conf"))',
    );
    expect(recipes[0]!.args[1]).toContain(
      '(allow file-read* (literal "/var/run/resolv.conf"))',
    );
    expect(recipes[0]!.args[1]).toContain(
      '(allow file-read-metadata (literal "/var/run"))',
    );
    expect(recipes[0]!.args[1]).toContain(
      '(allow mach-lookup (global-name "com.apple.mDNSResponder"))',
    );
    expect(recipes[0]!.args[1]).toContain(
      '(allow mach-lookup (global-name "com.apple.system.config.networkd"))',
    );
    await expect(readFile(
      join(
        target.platformRoot,
        "ios",
        "Pods",
        "Pods.xcodeproj",
        "project.pbxproj",
      ),
      "utf8",
    )).resolves.toContain(
      String.raw`shellScript = "bash -l -c \"\\\"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\\"\"";`,
    );
    await expect(readFile(
      join(
        target.platformRoot,
        ".memi",
        "capture",
        "native-dependency",
        "cocoapods-phase-normalization.json",
      ),
      "utf8",
    )).resolves.toContain(
      "memi.expo-cocoapods-phase-normalization.v1",
    );

    await hook.execute(currentPlan, new AbortController().signal);
    expect(target.execute).toHaveBeenCalledTimes(3);
  });

  it("selects the approved Hermes release before Xcode and leaves its generated phase quiet", async () => {
    const target = await fixture();
    await Promise.all([
      writeFile(
        join(target.platformRoot, "ios", "Podfile.lock"),
        "PODS:\n  - hermes-engine (0.81.5):\n    - hermes-engine/Pre-built (= 0.81.5)\n",
      ),
      writeFile(
        join(
          target.platformRoot,
          "ios",
          "Pods",
          "Pods.xcodeproj",
          "project.pbxproj",
        ),
        `${EXPO_COCOAPODS_PROJECT}${EXPO_HERMES_PHASE}${EXPO_HERMES_TARGET_REFERENCE}`,
      ),
    ]);
    const provisional = target.authority.hookFor({
      ...target.input,
      approval: target.approval,
      workspaceRelativePath: "ios/Mobile.xcworkspace",
    });
    const plan = await provisional.currentPlan();
    const approval = approveNativeDependencyPreparationPlan(plan, {
      approvedFingerprint: plan.fingerprint,
      approvedBy: "human:repository-import",
      approvedAt: "2026-08-01T22:00:00.000Z",
    });
    const hook = target.authority.hookFor({
      ...target.input,
      approval,
      workspaceRelativePath: "ios/Mobile.xcworkspace",
    });

    await hook.execute(await hook.currentPlan(), new AbortController().signal);

    const recipes = target.execute.mock.calls.map(([recipe]) => recipe);
    expect(recipes).toHaveLength(4);
    expect(recipes[3]!.args.slice(2)).toEqual([
      target.nodeExecutable,
      join(
        target.platformRoot,
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
      "0.81.5",
      "-p",
      join(target.platformRoot, "ios", "Pods"),
    ]);
    await expect(readFile(
      join(
        target.platformRoot,
        "ios",
        "Pods",
        "Pods.xcodeproj",
        "project.pbxproj",
      ),
      "utf8",
    )).resolves.not.toContain(
      "[CP-User] [Hermes] Replace Hermes for the right configuration, if needed",
    );
  });

  it.skipIf(process.platform !== "darwin")(
    "permits resolver ancestry from the managed workspace without exposing it for writes",
    async () => {
      const target = await fixture({
        temporaryRoot: join(homedir(), "Library", "Caches"),
      });
      const hook = target.authority.hookFor({
        ...target.input,
        approval: target.approval,
        workspaceRelativePath: "ios/Mobile.xcworkspace",
      });
      const currentPlan = await hook.currentPlan();

      await hook.execute(currentPlan, new AbortController().signal);
      const firstRecipe = target.execute.mock.calls[0]![0];

      await expect(
        execFileAsync(
          "/usr/bin/sandbox-exec",
          ["-p", firstRecipe.args[1]!, "/usr/bin/stat", "-f", "%N", "/Users"],
          { cwd: target.platformRoot },
        ),
      ).resolves.toBeDefined();
      expect(firstRecipe.args[1]).toContain(
        '(allow file-read-metadata (literal "/Users"))',
      );
      expect(firstRecipe.args[1]).not.toContain(
        '(allow file-write* (subpath "/Users"))',
      );
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "permits the real Node runtime to inspect its user-home ancestry",
    async () => {
      const nodeExecutable = await realpath(process.execPath);
      const npmExecutable = join(dirname(nodeExecutable), "npm");
      await access(npmExecutable);
      const target = await fixture({
        nodeExecutablePath: nodeExecutable,
        npmExecutablePath: npmExecutable,
        temporaryRoot: join(homedir(), "Library", "Caches"),
      });
      const hook = target.authority.hookFor({
        ...target.input,
        approval: target.approval,
      });

      await hook.execute(await hook.currentPlan(), new AbortController().signal);
      const npmRecipe = target.execute.mock.calls[0]![0];

      await expect(
        execFileAsync(
          "/usr/bin/sandbox-exec",
          [
            "-p",
            npmRecipe.args[1]!,
            target.nodeExecutable,
            "-e",
            "require('node:fs').lstatSync('/Users')",
          ],
          {
            cwd: target.platformRoot,
            env: npmRecipe.environment,
          },
        ),
      ).resolves.toBeDefined();
    },
  );

  it("keeps an approval retryable when preparation fails before completion", async () => {
    const target = await fixture();
    const failure = new Error("npm ci exited unsuccessfully (1).");
    target.execute.mockRejectedValueOnce(failure);
    const hook = target.authority.hookFor({
      ...target.input,
      approval: target.approval,
      workspaceRelativePath: "ios/Mobile.xcworkspace",
    });
    const currentPlan = await hook.currentPlan();

    await expect(
      hook.execute(currentPlan, new AbortController().signal),
    ).rejects.toThrow("npm ci exited unsuccessfully");

    await expect(
      hook.execute(currentPlan, new AbortController().signal),
    ).resolves.toBeUndefined();
    expect(target.execute).toHaveBeenCalledTimes(4);
  });

  it("fails before pod install when the sandbox cannot resolve Apple Git", async () => {
    const target = await fixture();
    target.execute.mockResolvedValueOnce({
      stdout: new Uint8Array(),
      stderr: "",
    });
    target.execute.mockRejectedValueOnce(new Error(
      "xcode-select: unable to read /var/select/developer_dir (Operation not permitted)",
    ));
    const hook = target.authority.hookFor({
      ...target.input,
      approval: target.approval,
      workspaceRelativePath: "ios/Mobile.xcworkspace",
    });

    const failure = await hook.execute(
      await hook.currentPlan(),
      new AbortController().signal,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({
      stage: "prepare-fixtures",
      code: "NATIVE_DEPENDENCY_SANDBOX_CONFIGURATION_INVALID",
      retryable: false,
    });
    expect(target.execute).toHaveBeenCalledTimes(2);
    expect(target.execute.mock.calls[1]![0].args.slice(2)).toEqual([
      "/usr/bin/git",
      "--version",
    ]);
  });

  it.each([
    {
      commandIndex: 0,
      message: "npm ci exited unsuccessfully (1).",
      code: "NPM_DEPENDENCY_INSTALL_FAILED",
      retryable: true,
    },
    {
      commandIndex: 1,
      message: "pod install exited unsuccessfully (1).",
      code: "COCOAPODS_DEPENDENCY_INSTALL_FAILED",
      retryable: true,
    },
    {
      commandIndex: 1,
      message:
        "xcode-select: unable to read /var/select/developer_dir (Operation not permitted)",
      code: "NATIVE_DEPENDENCY_SANDBOX_CONFIGURATION_INVALID",
      retryable: false,
      remediation:
        "Update the sidecar sandbox profile; retrying this approved plan will not help.",
    },
    {
      commandIndex: 1,
      message: "xcodebuild: received SIGTERM while preparing Pods",
      code: "COCOAPODS_DEPENDENCY_INSTALL_FAILED",
      retryable: true,
    },
    {
      commandIndex: 1,
      message:
        "xcode-select: error: No developer tools were found and no install could be requested.",
      code: "NATIVE_XCODE_TOOLCHAIN_UNAVAILABLE",
      retryable: false,
      remediation:
        "Select an installed Xcode toolchain outside Memi, then create a new approved plan.",
    },
    {
      commandIndex: 1,
      message:
        "[!] The sandbox is not in sync with the Podfile.lock. Run `pod install` or update your CocoaPods installation.",
      code: "COCOAPODS_LOCKFILE_INVALID",
      retryable: false,
      remediation:
        "Regenerate and commit Podfile.lock in the source project, then create a new approved plan.",
    },
    {
      commandIndex: 1,
      message:
        "[!] There were changes to the podfile in deployment mode:\nR expo-dev-client",
      code: "COCOAPODS_LOCKFILE_INVALID",
      retryable: false,
      remediation:
        "Regenerate and commit Podfile.lock in the source project, then create a new approved plan.",
    },
    {
      commandIndex: 1,
      message:
        "CDN: trunk URL couldn't be downloaded: https://cdn.cocoapods.org/all_pods_versions_1_0_0.txt",
      code: "COCOAPODS_CACHE_UNAVAILABLE",
      retryable: true,
      remediation:
        "Restore access to the locked CocoaPods artifact cache or CDN, then retry preparation once.",
    },
  ])(
    "classifies $code without consuming the approved plan",
    async ({ commandIndex, message, code, retryable, remediation }) => {
      const target = await fixture();
      target.execute.mockImplementationOnce(async () => {
        if (commandIndex === 0) {
          throw new Error(message);
        }
        return { stdout: new Uint8Array(), stderr: "" };
      });
      if (commandIndex === 1) {
        target.execute.mockResolvedValueOnce({
          stdout: new Uint8Array(),
          stderr: "",
        });
        target.execute.mockRejectedValueOnce(new Error(message));
      }
      const hook = target.authority.hookFor({
        ...target.input,
        approval: target.approval,
        workspaceRelativePath: "ios/Mobile.xcworkspace",
      });

      const failure = await hook.execute(
        await hook.currentPlan(),
        new AbortController().signal,
      ).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(CaptureExecutionError);
      expect(failure).toMatchObject({
        stage: "prepare-fixtures",
        code,
        retryable,
      });
      if (remediation !== undefined) {
        expect(failure).toHaveProperty(
          "message",
          expect.stringContaining(remediation),
        );
      }
    },
  );

  it("classifies unavailable dependency tools before planning", async () => {
    const target = await fixture();

    const failure = await createNativeDependencyPreparationAuthority({
      appDataRoot: target.appDataRoot,
      commandPort: { execute: target.execute },
      nodeExecutable: target.nodeExecutable,
      npmExecutable: target.npmCliExecutable,
      podExecutable: join(target.appDataRoot, "missing", "pod"),
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(CaptureExecutionError);
    expect(failure).toMatchObject({
      stage: "validate",
      code: "NATIVE_DEPENDENCY_TOOL_UNAVAILABLE",
      retryable: false,
    });
  });

  it("classifies managed-worktree escapes before execution", async () => {
    const target = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "memi-native-outside-"));

    expect(() => target.authority.inputFor({
      managedWorktreeRoot: target.managedWorktreeRoot,
      platformRoot: outside,
      repositoryRevision: "a".repeat(40),
      adapterVersion: "1.0.0",
      workspaceRelativePath: "ios/Mobile.xcworkspace",
    })).toThrow(expect.objectContaining({
      stage: "validate",
      code: "NATIVE_DEPENDENCY_WORKTREE_INVALID",
      retryable: false,
    }));
  });

  it("reconstructs the plan and invalidates approval after lockfile drift", async () => {
    const target = await fixture();
    const hook = target.authority.hookFor({
      ...target.input,
      approval: target.approval,
      workspaceRelativePath: "ios/Mobile.xcworkspace",
    });
    await writeFile(
      join(target.platformRoot, "package-lock.json"),
      JSON.stringify({
        name: "mobile",
        lockfileVersion: 3,
        packages: {
          "node_modules/react": { version: "19.2.8" },
        },
      }),
    );

    const currentPlan = await hook.currentPlan();

    expect(currentPlan.fingerprint).not.toBe(target.plan.fingerprint);
    expect(() =>
      assertNativeDependencyPreparationApproval(
        currentPlan,
        hook.approval,
      ),
    ).toThrow(/stale/u);
    expect(target.execute).not.toHaveBeenCalled();
  });

  it("fails closed before CocoaPods when a lockfile becomes invalid", async () => {
    const target = await fixture();
    const hook = target.authority.hookFor({
      ...target.input,
      approval: target.approval,
      workspaceRelativePath: "ios/Mobile.xcworkspace",
    });
    await writeFile(join(target.platformRoot, "package-lock.json"), "{");

    const failure = await hook.execute(
      target.plan,
      new AbortController().signal,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({
      stage: "prepare-fixtures",
      code: "NATIVE_DEPENDENCY_LOCKFILE_INVALID",
      retryable: false,
    });
    expect(failure).toHaveProperty(
      "message",
      expect.stringContaining(
        "Regenerate and commit the dependency lockfiles in the source project",
      ),
    );
    expect(target.execute).not.toHaveBeenCalled();
  });
});
