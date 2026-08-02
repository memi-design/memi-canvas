import {
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeManagedExpoCocoaPodsPhases,
  prestageManagedExpoHermesXCFramework,
} from "./expo-cocoapods-normalization.js";

const ORIGINAL_PROJECT = String.raw`
/* Begin PBXShellScriptBuildPhase section */
		AA01 /* [CP-User] Generate app.config for prebuilt Constants.manifest */ = {
			isa = PBXShellScriptBuildPhase;
			name = "[CP-User] Generate app.config for prebuilt Constants.manifest";
			shellPath = /bin/sh;
			shellScript = "bash -l -c \"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\"";
		};
		AA02 /* [CP-User] Generate updates resources for expo-updates */ = {
			isa = PBXShellScriptBuildPhase;
			name = "[CP-User] Generate updates resources for expo-updates";
			shellPath = /bin/sh;
			shellScript = "bash -l -c \"$PODS_TARGET_SRCROOT/../scripts/create-updates-resources-ios.sh\"";
		};
/* End PBXShellScriptBuildPhase section */
`;

const HERMES_PHASE = String.raw`
		AA03 /* [CP-User] [Hermes] Replace Hermes for the right configuration, if needed */ = {
			isa = PBXShellScriptBuildPhase;
			name = "[CP-User] [Hermes] Replace Hermes for the right configuration, if needed";
			shellPath = /bin/sh;
			shellScript = "        . \"$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh\"\n\n        CONFIG=\"Release\"\n        if echo $GCC_PREPROCESSOR_DEFINITIONS | grep -q \"DEBUG=1\"; then\n          CONFIG=\"Debug\"\n        fi\n\n        \"$NODE_BINARY\" \"$REACT_NATIVE_PATH/sdks/hermes-engine/utils/replace_hermes_version.js\" -c \"$CONFIG\" -r \"0.81.5\" -p \"$PODS_ROOT\"\n";
		};
`;

const PODS_ROOT = "${PODS_ROOT}";

const HERMES_XCFRAMEWORK_COPY_PHASE = String.raw`
		AA04 /* [CP] Copy XCFrameworks */ = {
			isa = PBXShellScriptBuildPhase;
			name = "[CP] Copy XCFrameworks";
			shellPath = /bin/sh;
			shellScript = "\"${PODS_ROOT}/Target Support Files/hermes-engine/hermes-engine-xcframeworks.sh\"\n";
		};
`;

const SKIA_XCFRAMEWORK_COPY_PHASE = String.raw`
		AA05 /* [CP] Copy XCFrameworks */ = {
			isa = PBXShellScriptBuildPhase;
			name = "[CP] Copy XCFrameworks";
			shellPath = /bin/sh;
			shellScript = "\"${PODS_ROOT}/Target Support Files/react-native-skia/react-native-skia-xcframeworks.sh\"\n";
		};
`;

const PROJECT_WITH_HERMES_PHASE = ORIGINAL_PROJECT.replace(
  "/* End PBXShellScriptBuildPhase section */",
  `${HERMES_PHASE}${HERMES_XCFRAMEWORK_COPY_PHASE}${SKIA_XCFRAMEWORK_COPY_PHASE}/* End PBXShellScriptBuildPhase section */\n/* Begin PBXAggregateTarget section */\n\t\tBB01 /* hermes-engine */ = {\n\t\t\tisa = PBXAggregateTarget;\n\t\t\tbuildPhases = (\n\t\t\t\tAA03 /* [CP-User] [Hermes] Replace Hermes for the right configuration, if needed */,\n\t\t\t\tAA04 /* [CP] Copy XCFrameworks */,\n\t\t\t);\n\t\t\tname = "hermes-engine";\n\t\t};\n\t\tBB02 /* react-native-skia */ = {\n\t\t\tisa = PBXAggregateTarget;\n\t\t\tbuildPhases = (\n\t\t\t\tAA05 /* [CP] Copy XCFrameworks */,\n\t\t\t);\n\t\t\tname = "react-native-skia";\n\t\t};\n/* End PBXAggregateTarget section */`,
);

const PROJECT_WITH_HERMES_CONFIGURATION_NAMES = `${PROJECT_WITH_HERMES_PHASE}
/* Begin XCBuildConfiguration section */
\t\tCC01 /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tname = "hermes-engine";
\t\t};
\t\tCC02 /* Release */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tname = "hermes-engine";
\t\t};
/* End XCBuildConfiguration section */
`;

async function cocoaPodsFixture(project = ORIGINAL_PROJECT) {
  const root = await mkdtemp(
    join(tmpdir(), "memi Application Support expo-pods-"),
  );
  const managedWorktreeRoot = join(root, "capture-worktrees", "job-1");
  const platformRoot = join(managedWorktreeRoot, "mobile");
  const projectPath = join(
    platformRoot,
    "ios",
    "Pods",
    "Pods.xcodeproj",
    "project.pbxproj",
  );
  await mkdir(join(projectPath, ".."), { recursive: true });
  await writeFile(projectPath, project);
  return { managedWorktreeRoot, platformRoot, projectPath };
}

describe("managed Expo CocoaPods phase normalization", () => {
  it("moves the exact Hermes replacement into approved preparation and removes its Xcode phase", async () => {
    const target = await cocoaPodsFixture(PROJECT_WITH_HERMES_PHASE);
    const input = {
      managedWorktreeRoot: target.managedWorktreeRoot,
      platformRoot: target.platformRoot,
      repositoryRevision: "a".repeat(40),
      preparationFingerprint: `sha256:${"b".repeat(64)}` as const,
    };

    const first = await normalizeManagedExpoCocoaPodsPhases(input);
    const normalized = await readFile(target.projectPath, "utf8");

    expect(normalized).not.toContain(
      "[CP-User] [Hermes] Replace Hermes for the right configuration, if needed",
    );
    expect(normalized).not.toContain("hermes-engine-xcframeworks.sh");
    expect(normalized).toContain("react-native-skia-xcframeworks.sh");
    expect(first.phases).toContainEqual({
      id: "hermes-engine-release-configuration",
      status: "normalized",
    });
    expect(first.phases).toContainEqual({
      id: "hermes-engine-xcframework-copy",
      status: "normalized",
    });
    expect(first.hermesReleaseVersion).toBe("0.81.5");

    const second = await normalizeManagedExpoCocoaPodsPhases(input);
    expect(second.changed).toBe(false);
    expect(second.phases).toContainEqual({
      id: "hermes-engine-release-configuration",
      status: "absent",
    });
    expect(second.phases).toContainEqual({
      id: "hermes-engine-xcframework-copy",
      status: "absent",
    });
    expect(second.hermesReleaseVersion).toBeNull();
  });

  it("identifies the Hermes aggregate target when build configurations reuse its name", async () => {
    const target = await cocoaPodsFixture(PROJECT_WITH_HERMES_CONFIGURATION_NAMES);

    await expect(normalizeManagedExpoCocoaPodsPhases({
      managedWorktreeRoot: target.managedWorktreeRoot,
      platformRoot: target.platformRoot,
      repositoryRevision: "a".repeat(40),
      preparationFingerprint: `sha256:${"b".repeat(64)}`,
    })).resolves.toMatchObject({
      phases: expect.arrayContaining([
        { id: "hermes-engine-xcframework-copy", status: "normalized" },
      ]),
    });
  });

  it("pre-stages the normalized Hermes XCFramework into the resolved build output", async () => {
    const target = await cocoaPodsFixture(PROJECT_WITH_HERMES_PHASE);
    const input = {
      managedWorktreeRoot: target.managedWorktreeRoot,
      platformRoot: target.platformRoot,
      repositoryRevision: "a".repeat(40),
      preparationFingerprint: `sha256:${"b".repeat(64)}` as const,
    };
    await normalizeManagedExpoCocoaPodsPhases(input);
    const sourceRoot = join(
      target.platformRoot,
      "ios",
      "Pods",
      "hermes-engine",
      "destroot",
      "Library",
      "Frameworks",
      "universal",
      "hermes.xcframework",
      "ios-arm64_x86_64-simulator",
    );
    await mkdir(join(sourceRoot, "hermes.framework"), { recursive: true });
    await Promise.all([
      writeFile(join(sourceRoot, "hermes.framework", "hermes"), "verified-hermes"),
      // CocoaPods keeps XCFramework metadata at the XCFramework root; the
      // selected platform slice contains only the framework payload.
      writeFile(join(dirname(sourceRoot), "Info.plist"), "<plist />"),
    ]);
    const xcframeworksBuildDirectory = join(
      target.platformRoot,
      ".memi",
      "DerivedData",
      "Build",
      "Products",
      "Release-iphonesimulator",
      "XCFrameworkIntermediates",
    );

    const result = await prestageManagedExpoHermesXCFramework({
      ...input,
      xcframeworksBuildDirectory,
    });

    const destinationRoot = join(
      xcframeworksBuildDirectory,
      "hermes-engine",
      "Pre-built",
    );
    await expect(readFile(
      join(destinationRoot, "hermes.framework", "hermes"),
      "utf8",
    )).resolves.toBe("verified-hermes");
    expect(result).toMatchObject({
      contract: "memi.expo-hermes-xcframework-prestage.v1",
      sourceRelativePath: "mobile/ios/Pods/hermes-engine/destroot/Library/Frameworks/universal/hermes.xcframework/ios-arm64_x86_64-simulator",
      destinationRelativePath: "mobile/.memi/DerivedData/Build/Products/Release-iphonesimulator/XCFrameworkIntermediates/hermes-engine/Pre-built",
    });
    expect(result.sourceHash).toBe(result.destinationHash);
  });

  it("fails closed when the named Hermes phase does not match the approved form", async () => {
    const target = await cocoaPodsFixture(
      PROJECT_WITH_HERMES_PHASE.replace(
        "replace_hermes_version.js",
        "unexpected-hermes-script",
      ),
    );

    await expect(normalizeManagedExpoCocoaPodsPhases({
      managedWorktreeRoot: target.managedWorktreeRoot,
      platformRoot: target.platformRoot,
      repositoryRevision: "a".repeat(40),
      preparationFingerprint: `sha256:${"b".repeat(64)}`,
    })).rejects.toMatchObject({
      code: "COCOAPODS_PHASE_NORMALIZATION_INVALID",
      retryable: false,
      stage: "prepare-fixtures",
    });
  });

  it("quotes both exact Expo phase paths and records provenance", async () => {
    const target = await cocoaPodsFixture();

    const result = await normalizeManagedExpoCocoaPodsPhases({
      managedWorktreeRoot: target.managedWorktreeRoot,
      platformRoot: target.platformRoot,
      repositoryRevision: "a".repeat(40),
      preparationFingerprint: `sha256:${"b".repeat(64)}`,
    });

    const normalized = await readFile(target.projectPath, "utf8");
    expect(normalized).toContain(
      String.raw`shellScript = "bash -l -c \"\\\"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\\"\"";`,
    );
    expect(normalized).toContain(
      String.raw`shellScript = "bash -l -c \"\\\"$PODS_TARGET_SRCROOT/../scripts/create-updates-resources-ios.sh\\\"\"";`,
    );
    expect(result).toMatchObject({
      contract: "memi.expo-cocoapods-phase-normalization.v1",
      changed: true,
      projectRelativePath: "mobile/ios/Pods/Pods.xcodeproj/project.pbxproj",
      phases: [
        { id: "expo-constants-app-config", status: "normalized" },
        { id: "expo-updates-resources", status: "normalized" },
        { id: "hermes-engine-release-configuration", status: "absent" },
        { id: "hermes-engine-xcframework-copy", status: "absent" },
      ],
    });
    expect(result.beforeHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.afterHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.afterHash).not.toBe(result.beforeHash);

    const provenance = JSON.parse(await readFile(
      join(
        target.platformRoot,
        ".memi",
        "capture",
        "native-dependency",
        "cocoapods-phase-normalization.json",
      ),
      "utf8",
    )) as Record<string, unknown>;
    expect(provenance).toEqual(result);
  });

  it("is idempotent after an exact normalization", async () => {
    const target = await cocoaPodsFixture();
    const input = {
      managedWorktreeRoot: target.managedWorktreeRoot,
      platformRoot: target.platformRoot,
      repositoryRevision: "a".repeat(40),
      preparationFingerprint: `sha256:${"b".repeat(64)}` as const,
    };

    const first = await normalizeManagedExpoCocoaPodsPhases(input);
    const second = await normalizeManagedExpoCocoaPodsPhases(input);

    expect(second).toMatchObject({
      changed: false,
      beforeHash: first.afterHash,
      afterHash: first.afterHash,
      phases: [
        { id: "expo-constants-app-config", status: "already-normalized" },
        { id: "expo-updates-resources", status: "already-normalized" },
        { id: "hermes-engine-release-configuration", status: "absent" },
        { id: "hermes-engine-xcframework-copy", status: "absent" },
      ],
    });
  });

  it("fails closed when a named phase has an unexpected script", async () => {
    const target = await cocoaPodsFixture(
      ORIGINAL_PROJECT.replace(
        String.raw`shellScript = "bash -l -c \"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\"";`,
        String.raw`shellScript = "bash -l -c \"unexpected-command\"";`,
      ),
    );

    await expect(normalizeManagedExpoCocoaPodsPhases({
      managedWorktreeRoot: target.managedWorktreeRoot,
      platformRoot: target.platformRoot,
      repositoryRevision: "a".repeat(40),
      preparationFingerprint: `sha256:${"b".repeat(64)}`,
    })).rejects.toMatchObject({
      code: "COCOAPODS_PHASE_NORMALIZATION_INVALID",
      retryable: false,
      stage: "prepare-fixtures",
    });

    await expect(readFile(target.projectPath, "utf8")).resolves.toBe(
      ORIGINAL_PROJECT.replace(
        String.raw`shellScript = "bash -l -c \"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\"";`,
        String.raw`shellScript = "bash -l -c \"unexpected-command\"";`,
      ),
    );
  });

  it("rejects a project outside the managed worktree or behind a symlink", async () => {
    const target = await cocoaPodsFixture();
    const outside = await cocoaPodsFixture();

    await expect(normalizeManagedExpoCocoaPodsPhases({
      managedWorktreeRoot: target.managedWorktreeRoot,
      platformRoot: outside.platformRoot,
      repositoryRevision: "a".repeat(40),
      preparationFingerprint: `sha256:${"b".repeat(64)}`,
    })).rejects.toMatchObject({
      code: "COCOAPODS_PHASE_NORMALIZATION_INVALID",
    });

    const linkedPlatform = join(target.managedWorktreeRoot, "linked-mobile");
    await symlink(outside.platformRoot, linkedPlatform);
    await expect(normalizeManagedExpoCocoaPodsPhases({
      managedWorktreeRoot: target.managedWorktreeRoot,
      platformRoot: linkedPlatform,
      repositoryRevision: "a".repeat(40),
      preparationFingerprint: `sha256:${"b".repeat(64)}`,
    })).rejects.toMatchObject({
      code: "COCOAPODS_PHASE_NORMALIZATION_INVALID",
    });
  });
});
