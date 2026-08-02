import { validateCaptureApplicationConfiguration } from "./capture-configuration.js";
import {
  CAPTURE_PIPELINE_STAGES,
  SWIFTUI_REQUIRED_BUILD_SETTING_KEYS,
  type CaptureApplicationUnit,
  type CaptureDiscoveryError,
  type RepositoryManifestEntry,
  type SwiftUICaptureConfiguration,
} from "./types.js";
import {
  applicationCacheKey,
  entriesForRoot,
  makeRoute,
  relativeToRoot,
  sha256,
  titleFromSegment,
} from "./shared.js";

const PROJECT_SUFFIX = ".xcodeproj/project.pbxproj";
const VIEW_PATTERN =
  /\bstruct\s+([A-Za-z_][A-Za-z0-9_]*View)\s*:\s*View\b/gu;

function projectRoot(path: string): string {
  const prefix = path.slice(0, -PROJECT_SUFFIX.length);
  const slash = prefix.lastIndexOf("/");
  return slash === -1 ? "." : prefix.slice(0, slash);
}

function selectNamedOrOnly(
  entries: readonly RepositoryManifestEntry[],
  expectedBasename: string,
  nameFor: (entry: RepositoryManifestEntry) => string = (entry) =>
    entry.path.split("/").at(-1) ?? "",
): RepositoryManifestEntry | null | "ambiguous" {
  const named = entries.filter(
    (entry) => nameFor(entry) === expectedBasename,
  );
  if (named.length === 1) {
    return named[0]!;
  }
  if (entries.length === 1) {
    return entries[0]!;
  }
  return entries.length === 0 ? null : "ambiguous";
}

export function discoverSwiftUIApplications(input: {
  readonly entries: readonly RepositoryManifestEntry[];
  readonly repositoryFingerprint: `sha256:${string}`;
}): readonly CaptureApplicationUnit[] {
  return input.entries
    .filter((entry) => entry.path.endsWith(PROJECT_SUFFIX))
    .map((projectEntry) =>
      discoverSwiftUIApplication({
        projectEntry,
        root: projectRoot(projectEntry.path),
        entries: input.entries,
        repositoryFingerprint: input.repositoryFingerprint,
      }),
    );
}

function discoverSwiftUIApplication(input: {
  readonly projectEntry: RepositoryManifestEntry;
  readonly root: string;
  readonly entries: readonly RepositoryManifestEntry[];
  readonly repositoryFingerprint: `sha256:${string}`;
}): CaptureApplicationUnit {
  const projectName = input.projectEntry.path
    .split("/")
    .at(-2)!
    .replace(/\.xcodeproj$/u, "");
  const applicationId = `app_${sha256(
    `swiftui:${input.root}:${projectName}`,
  ).slice(
    "sha256:".length,
    "sha256:".length + 24,
  )}` as const;
  const rootEntries = entriesForRoot(input.entries, input.root);
  const schemeEntries = rootEntries
    .filter((entry) =>
      /\/xcshareddata\/xcschemes\/[^/]+\.xcscheme$/u.test(entry.path),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const workspaceEntries = rootEntries
    .filter((entry) =>
      entry.path.endsWith(".xcworkspace/contents.xcworkspacedata") &&
      !entry.path.includes(".xcodeproj/project.xcworkspace/"),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const selectedScheme = selectNamedOrOnly(
    schemeEntries,
    `${projectName}.xcscheme`,
  );
  const selectedWorkspace = selectNamedOrOnly(
    workspaceEntries,
    `${projectName}.xcworkspace`,
    (entry) => entry.path.split("/").at(-2) ?? "",
  );
  const swiftFiles = rootEntries.filter((entry) =>
    entry.path.endsWith(".swift"),
  );
  const planned = swiftFiles
    .flatMap((entry) => {
      VIEW_PATTERN.lastIndex = 0;
      return [...entry.content.matchAll(VIEW_PATTERN)].map((match) => {
        const viewName = match[1]!;
        return makeRoute({
          applicationId,
          sourcePath: entry.path,
          path: `view://${viewName}`,
          displayName: titleFromSegment(viewName),
          navigation: "view",
          platform: "swiftui",
        });
      });
    })
    .sort((left, right) =>
      left.route.displayName.localeCompare(right.route.displayName),
    );
  const errors: CaptureDiscoveryError[] = [];
  if (selectedWorkspace === "ambiguous") {
    errors.push({
      code: "swiftui-container-ambiguous",
      path: input.projectEntry.path,
      message: "SwiftUI application has multiple plausible Xcode workspaces.",
      remediation:
        "Keep one workspace for this application or name it after the Xcode project.",
      retryable: true,
    });
  }
  if (selectedScheme === "ambiguous") {
    errors.push({
      code: "swiftui-scheme-ambiguous",
      path: input.projectEntry.path,
      message: "SwiftUI application has multiple plausible shared schemes.",
      remediation:
        "Keep one shared scheme or commit a shared scheme named after the Xcode project.",
      retryable: true,
    });
  } else if (selectedScheme === null) {
    errors.push({
      code: "swiftui-shared-scheme-required",
      path: input.projectEntry.path,
      message: "SwiftUI application has no discoverable shared Xcode scheme.",
      remediation:
        "Create and commit a shared scheme in Xcode, including its xcscheme file.",
      retryable: true,
    });
  }
  if (planned.length === 0) {
    errors.push({
      code: "no-capturable-routes",
      path: input.projectEntry.path,
      message: "SwiftUI application has no statically discoverable View types.",
      remediation:
        "Add SwiftUI View declarations or an explicit capture flow manifest.",
      retryable: true,
    });
  }

  const scheme =
    selectedScheme === null || selectedScheme === "ambiguous"
      ? null
      : selectedScheme.path.split("/").at(-1)!.replace(/\.xcscheme$/u, "");
  const workspace =
    selectedWorkspace === null || selectedWorkspace === "ambiguous"
      ? null
      : relativeToRoot(input.root, selectedWorkspace.path).replace(
          /\/contents\.xcworkspacedata$/u,
          "",
        );
  const project = relativeToRoot(input.root, input.projectEntry.path).replace(
    /\/project\.pbxproj$/u,
    "",
  );
  const container =
    workspace === null
      ? ({ kind: "project", relativePath: project } as const)
      : ({ kind: "workspace", relativePath: workspace } as const);
  const derivedDataRelativePath =
    `.memi/capture/derived-data/${applicationId}` as const;
  const containerArgs = [
    container.kind === "project" ? "-project" : "-workspace",
    container.relativePath,
  ] as const;
  const buildArgs =
    scheme === null
      ? []
      : [
          ...containerArgs,
          "-scheme",
          scheme,
          "-configuration",
          "Debug",
    "-sdk",
    "iphonesimulator",
    "-jobs",
    "1",
    "-destination",
          "generic/platform=iOS Simulator",
          "-derivedDataPath",
          derivedDataRelativePath,
          "ENABLE_USER_SCRIPT_SANDBOXING=YES",
        ];
  let captureConfiguration: SwiftUICaptureConfiguration | null = null;
  if (
    errors.length === 0 &&
    scheme !== null &&
    selectedScheme !== null &&
    selectedScheme !== "ambiguous"
  ) {
    captureConfiguration = validateCaptureApplicationConfiguration({
      kind: "swiftui",
      container,
      scheme,
      schemePath: relativeToRoot(input.root, selectedScheme.path),
      derivedDataRelativePath,
      requiresResolvedBuildSettings: true,
      buildSettingsResolution: {
        executable: "xcodebuild",
        args: [...buildArgs, "-showBuildSettings"],
        requiredKeys: SWIFTUI_REQUIRED_BUILD_SETTING_KEYS,
      },
    }) as SwiftUICaptureConfiguration;
  }

  return {
    applicationId,
    platform: "swiftui",
    root: input.root,
    displayName: scheme ?? projectName,
    status: errors.length === 0 ? "supported" : "unsupported",
    pipelineStages: CAPTURE_PIPELINE_STAGES,
    manifestPaths: [
      input.projectEntry.path,
      ...workspaceEntries.map(({ path }) => path),
      ...schemeEntries.map(({ path }) => path),
    ],
    buildRecipe:
      errors.length === 0 && scheme !== null
        ? {
            executable: "xcodebuild",
            args: [...buildArgs, "build"],
            cwd: input.root,
            purpose: "build",
          }
        : null,
    captureConfiguration:
      errors.length === 0 ? captureConfiguration : null,
    routes: planned.map(({ route }) => route),
    scenarios: planned.map(({ scenario }) => scenario),
    cacheKey: applicationCacheKey({
      repositoryFingerprint: input.repositoryFingerprint,
      adapterVersion: "swiftui-capture-plan@2",
      root: input.root,
      entries: rootEntries,
    }),
    errors,
  };
}
