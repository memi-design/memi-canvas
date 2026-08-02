import { validateCaptureApplicationConfiguration } from "./capture-configuration.js";
import {
  CAPTURE_PIPELINE_STAGES,
  type CaptureApplicationUnit,
  type CaptureDiscoveryError,
  type CaptureDiscoveryOptions,
  type CaptureRoutePlan,
  type ExpoIOSCaptureConfiguration,
  type ExpoMaestroFlowConfiguration,
  type IOSNativeBuildConfiguration,
  type RepositoryManifestEntry,
} from "./types.js";
import { SWIFTUI_REQUIRED_BUILD_SETTING_KEYS } from "./types.js";
import {
  applicationCacheKey,
  entriesForRoot,
  joinRoot,
  makeRoute,
  relativeToRoot,
  sha256,
  titleFromSegment,
} from "./shared.js";

interface PackageManifest {
  readonly name?: string;
  readonly main?: string;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

interface ExpoAppConfig {
  readonly expo?: {
    readonly name?: string;
    readonly slug?: string;
    readonly scheme?: string;
    readonly ios?: { readonly bundleIdentifier?: string };
    readonly extra?: {
      readonly memi?: {
        readonly capture?: { readonly mode?: string };
      };
    };
  };
}

const SOURCE_EXTENSION = /\.(?:js|jsx|ts|tsx)$/u;
const MAESTRO_FLOW_PATTERN = /^\.maestro\/.+\.ya?ml$/u;
const SAFE_MAESTRO_FLOW_COMMANDS = new Set([
  "assertNotVisible",
  "assertVisible",
  "back",
  "clearState",
  "eraseText",
  "extendedWaitUntil",
  "hideKeyboard",
  "inputText",
  "launchApp",
  "openLink",
  "pressKey",
  "scroll",
  "scrollUntilVisible",
  "swipe",
  "tapOn",
  "waitForAnimationToEnd",
]);

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readYamlScalar(content: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const linePattern = new RegExp(
    `^\\s*(?:-\\s*)?${escapedKey}\\s*:\\s*(.*?)\\s*$`,
    "u",
  );
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(linePattern);
    if (match === null || match === undefined) {
      continue;
    }
    if (match[1] !== "") {
      return unquote(match[1]!);
    }
    if (key === "openLink") {
      for (
        let nestedIndex = index + 1;
        nestedIndex < Math.min(lines.length, index + 4);
        nestedIndex += 1
      ) {
        const nested = lines[nestedIndex]?.match(
          /^\s+(?:link|uri)\s*:\s*(.+?)\s*$/u,
        );
        if (nested?.[1] !== undefined) {
          return unquote(nested[1]);
        }
      }
    }
  }
  return null;
}

function routeFromDeepLink(deepLink: string): string | null {
  try {
    const url = new URL(deepLink);
    const expoPath = url.pathname.match(/\/--(\/.*)$/u)?.[1];
    if (expoPath !== undefined) {
      return expoPath;
    }
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.pathname || "/";
    }
    const combined = `/${[
      url.hostname,
      ...url.pathname.split("/"),
    ]
      .filter(Boolean)
      .join("/")}`;
    return combined === "/" ? "/" : combined;
  } catch {
    return null;
  }
}

function routeMatches(pattern: string, candidate: string): boolean {
  const patternSegments = pattern.split("/").filter(Boolean);
  const candidateSegments = candidate.split("/").filter(Boolean);
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index]!;
    if (expected.startsWith(":") && expected.endsWith("*")) {
      return candidateSegments.length > index;
    }
    const actual = candidateSegments[index];
    if (actual === undefined) {
      return false;
    }
    if (!expected.startsWith(":") && expected !== actual) {
      return false;
    }
  }
  return patternSegments.length === candidateSegments.length;
}

function safeMaestroFlow(content: string): boolean {
  const commands = content
    .split(/^---\s*$/mu)
    .slice(1)
    .flatMap((document) =>
      [...document.matchAll(/^\s*-\s+([A-Za-z][A-Za-z0-9]*)(?:\s*:|\s*$)/gmu)].map(
        (match) => match[1]!,
      ),
    );
  return (
    commands.length > 0 &&
    commands.every((command) => SAFE_MAESTRO_FLOW_COMMANDS.has(command))
  );
}

function normalizedFlowTerm(value: string): string {
  return value.toLowerCase().replace(/s$/u, "");
}

function applicationFlowRoute(
  relativePath: string,
  routes: readonly CaptureRoutePlan[],
): CaptureRoutePlan | null {
  const filename = relativePath.split("/").at(-1) ?? relativePath;
  const terms = filename
    .replace(/\.ya?ml$/u, "")
    .replace(/^\d+[-_]?/u, "")
    .split(/[^A-Za-z0-9]+/u)
    .map(normalizedFlowTerm)
    .filter((term) => term.length >= 3);
  const candidates = routes.filter((route) => {
    const leaf = route.path
      .split("/")
      .reverse()
      .find((segment) => segment.length > 0 && !segment.startsWith(":"));
    return leaf !== undefined && terms.includes(normalizedFlowTerm(leaf));
  });
  return candidates.length === 1 ? candidates[0]! : null;
}

function parseAppConfig(
  entry: RepositoryManifestEntry | undefined,
): {
  readonly config: ExpoAppConfig | null;
  readonly error: CaptureDiscoveryError | null;
} {
  if (entry === undefined) {
    return { config: null, error: null };
  }
  try {
    const value: unknown = JSON.parse(entry.content);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return { config: value as ExpoAppConfig, error: null };
  } catch {
    return {
      config: null,
      error: {
        code: "expo-static-config-invalid",
        path: entry.path,
        message: "Expo app.json is not valid static JSON object data.",
        remediation:
          "Repair app.json. Executable app.config files are not evaluated during discovery.",
        retryable: true,
      },
    };
  }
}

function explicitExpoGo(
  manifest: PackageManifest,
  config: ExpoAppConfig | null,
): boolean {
  return (
    (manifest.scripts?.start !== undefined &&
      /\bexpo(?:\s+start)?\b[^\n]*\s--go(?:\s|$)/u.test(
        manifest.scripts.start,
      )) ||
    config?.expo?.extra?.memi?.capture?.mode === "expo-go"
  );
}

function explicitDevelopmentClient(config: ExpoAppConfig | null): boolean {
  return config?.expo?.extra?.memi?.capture?.mode === "development-client";
}

function hasDevelopmentClient(manifest: PackageManifest): boolean {
  return (
    manifest.dependencies?.["expo-dev-client"] !== undefined ||
    manifest.devDependencies?.["expo-dev-client"] !== undefined
  );
}

/**
 * Expo development clients register their generated `exp+<slug>` scheme for
 * the development launcher. `expo.scheme` is the product deep-link scheme and
 * can point at a different handler, so it must not be used to open Metro.
 *
 * Older projects may not declare a slug. In that case the product scheme is
 * the only stable identifier we can derive without evaluating configuration.
 */
function developmentClientMetroScheme(config: ExpoAppConfig | null): string | null {
  const identifier = config?.expo?.slug ?? config?.expo?.scheme ?? null;
  return identifier === null ? null : `exp+${identifier}`;
}

function hasCheckedInIOSNativeBuild(input: {
  readonly root: string;
  readonly entries: readonly RepositoryManifestEntry[];
}): boolean {
  return entriesForRoot(input.entries, input.root).some((entry) =>
    /^ios\/[^/]+\.xcodeproj\/project\.pbxproj$/u.test(
      relativeToRoot(input.root, entry.path),
    ),
  );
}

function normalizedNativeName(value: string): string {
  return value.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
}

function selectNamedOrOnly(
  entries: readonly RepositoryManifestEntry[],
  preferredNames: readonly string[],
  nameFor: (entry: RepositoryManifestEntry) => string,
): RepositoryManifestEntry | null | "ambiguous" {
  const normalized = new Set(preferredNames.map(normalizedNativeName));
  const named = entries.filter((entry) =>
    normalized.has(normalizedNativeName(nameFor(entry))),
  );
  if (named.length === 1) {
    return named[0]!;
  }
  if (entries.length === 1) {
    return entries[0]!;
  }
  return entries.length === 0 ? null : "ambiguous";
}

function discoverStandaloneNativeBuild(input: {
  readonly root: string;
  readonly entries: readonly RepositoryManifestEntry[];
  readonly applicationId: `app_${string}`;
  readonly preferredNames: readonly string[];
}): {
  readonly configuration: IOSNativeBuildConfiguration | null;
  readonly manifestPaths: readonly string[];
  readonly errors: readonly CaptureDiscoveryError[];
} {
  const rootEntries = entriesForRoot(input.entries, input.root);
  const projects = rootEntries
    .filter((entry) =>
      /^ios\/[^/]+\.xcodeproj\/project\.pbxproj$/u.test(
        relativeToRoot(input.root, entry.path),
      ),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const workspaces = rootEntries
    .filter((entry) =>
      /^ios\/[^/]+\.xcworkspace\/contents\.xcworkspacedata$/u.test(
        relativeToRoot(input.root, entry.path),
      ),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const schemes = rootEntries
    .filter((entry) =>
      /^ios\/[^/]+\.(?:xcodeproj|xcworkspace)\/xcshareddata\/xcschemes\/[^/]+\.xcscheme$/u.test(
        relativeToRoot(input.root, entry.path),
      ),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const selectedProject = selectNamedOrOnly(
    projects,
    input.preferredNames,
    (entry) =>
      entry.path.split("/").at(-2)?.replace(/\.xcodeproj$/u, "") ?? "",
  );
  const selectedWorkspace = selectNamedOrOnly(
    workspaces,
    input.preferredNames,
    (entry) =>
      entry.path.split("/").at(-2)?.replace(/\.xcworkspace$/u, "") ?? "",
  );
  const selectedScheme = selectNamedOrOnly(
    schemes,
    input.preferredNames,
    (entry) =>
      entry.path.split("/").at(-1)?.replace(/\.xcscheme$/u, "") ?? "",
  );
  const errors: CaptureDiscoveryError[] = [];
  if (selectedProject === null) {
    errors.push({
      code: "expo-native-container-required",
      path: joinRoot(input.root, "ios"),
      message:
        "Standalone Expo capture has no checked-in native iOS project.",
      remediation:
        "Commit the generated native iOS project or explicitly use Expo Go mode.",
      retryable: true,
    });
  } else if (selectedProject === "ambiguous") {
    errors.push({
      code: "expo-native-container-ambiguous",
      path: joinRoot(input.root, "ios"),
      message: "Standalone Expo capture has multiple plausible iOS projects.",
      remediation:
        "Keep one app project or name it after expo.name or expo.slug.",
      retryable: true,
    });
  }
  if (selectedWorkspace === "ambiguous") {
    errors.push({
      code: "expo-native-container-ambiguous",
      path: joinRoot(input.root, "ios"),
      message:
        "Standalone Expo capture has multiple plausible iOS workspaces.",
      remediation:
        "Keep one app workspace or name it after expo.name or expo.slug.",
      retryable: true,
    });
  }
  if (
    selectedScheme === null &&
    selectedProject !== null &&
    selectedProject !== "ambiguous"
  ) {
    errors.push({
      code: "expo-native-scheme-required",
      path: joinRoot(input.root, "ios"),
      message: "Standalone Expo capture has no shared native app scheme.",
      remediation:
        "Commit the app's shared xcscheme or explicitly use Expo Go mode.",
      retryable: true,
    });
  } else if (selectedScheme === "ambiguous") {
    errors.push({
      code: "expo-native-scheme-ambiguous",
      path: joinRoot(input.root, "ios"),
      message: "Standalone Expo capture has multiple plausible shared schemes.",
      remediation:
        "Keep one app scheme or name it after expo.name or expo.slug.",
      retryable: true,
    });
  }
  if (
    errors.length > 0 ||
    selectedProject === null ||
    selectedProject === "ambiguous" ||
    selectedWorkspace === "ambiguous" ||
    selectedScheme === null ||
    selectedScheme === "ambiguous"
  ) {
    return {
      configuration: null,
      manifestPaths: [
        ...projects.map(({ path }) => path),
        ...workspaces.map(({ path }) => path),
        ...schemes.map(({ path }) => path),
      ],
      errors,
    };
  }
  const projectPath = relativeToRoot(
    input.root,
    selectedProject.path,
  ).replace(/\/project\.pbxproj$/u, "");
  const workspacePath =
    selectedWorkspace === null
      ? null
      : relativeToRoot(input.root, selectedWorkspace.path).replace(
          /\/contents\.xcworkspacedata$/u,
          "",
        );
  const container =
    workspacePath === null
      ? ({ kind: "project", relativePath: projectPath } as const)
      : ({ kind: "workspace", relativePath: workspacePath } as const);
  const scheme = selectedScheme.path
    .split("/")
    .at(-1)!
    .replace(/\.xcscheme$/u, "");
  const derivedDataRelativePath =
    `.memi/capture/derived-data/${input.applicationId}` as const;
  const buildArgs = [
    container.kind === "project" ? "-project" : "-workspace",
    container.relativePath,
    "-scheme",
    scheme,
    "-configuration",
    "Release",
    "-sdk",
    "iphonesimulator",
    "-jobs",
    "1",
    "-destination",
    "generic/platform=iOS Simulator",
    "-derivedDataPath",
    derivedDataRelativePath,
    "ENABLE_USER_SCRIPT_SANDBOXING=YES",
  ] as const;
  return {
    configuration: {
      container,
      scheme,
      schemePath: relativeToRoot(input.root, selectedScheme.path),
      configuration: "Release",
      derivedDataRelativePath,
      requiresResolvedBuildSettings: true,
      buildSettingsResolution: {
        executable: "xcodebuild",
        args: [...buildArgs, "-showBuildSettings"],
        requiredKeys: SWIFTUI_REQUIRED_BUILD_SETTING_KEYS,
      },
    },
    manifestPaths: [
      ...projects.map(({ path }) => path),
      ...workspaces.map(({ path }) => path),
      ...schemes.map(({ path }) => path),
    ],
    errors,
  };
}

function discoverMaestroFlows(input: {
  readonly root: string;
  readonly entries: readonly RepositoryManifestEntry[];
  readonly routes: readonly CaptureRoutePlan[];
  readonly bundleId: string | null;
  readonly runtime: "standalone" | "expo-go" | "development-client";
}): {
  readonly flows: readonly ExpoMaestroFlowConfiguration[];
  readonly errors: readonly CaptureDiscoveryError[];
} {
  const flowEntries = entriesForRoot(input.entries, input.root)
    .filter((entry) =>
      MAESTRO_FLOW_PATTERN.test(relativeToRoot(input.root, entry.path)),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const expectedAppId =
    input.runtime === "expo-go" ? "host.exp.Exponent" : input.bundleId;
  const errors: CaptureDiscoveryError[] = [];
  const flows: ExpoMaestroFlowConfiguration[] = [];
  for (const entry of flowEntries) {
    const relativePath = relativeToRoot(input.root, entry.path);
    if (!safeMaestroFlow(entry.content)) {
      continue;
    }
    const appId = readYamlScalar(entry.content, "appId");
    if (
      appId !== null &&
      expectedAppId !== null &&
      appId !== expectedAppId
    ) {
      errors.push({
        code: "expo-maestro-app-id-mismatch",
        path: entry.path,
        message: `Maestro flow targets ${appId}, not ${expectedAppId}.`,
        remediation: `Set appId to ${expectedAppId} or remove the stale flow.`,
        retryable: true,
      });
      continue;
    }
    const deepLink = readYamlScalar(entry.content, "openLink");
    if (deepLink === null) {
      const captureRoute = applicationFlowRoute(relativePath, input.routes);
      flows.push({
        relativePath,
        contentHash: sha256(entry.content),
        appId,
        deepLink: null,
        mapping: "application",
        routeId: null,
        routePath: null,
        captureRouteId: captureRoute?.routeId ?? null,
        captureRoutePath: captureRoute?.path ?? null,
      });
      continue;
    }
    const concreteRoute = routeFromDeepLink(deepLink);
    const candidates =
      concreteRoute === null
        ? []
        : input.routes.filter((route) =>
            routeMatches(route.path, concreteRoute),
          );
    if (candidates.length !== 1) {
      errors.push({
        code: "expo-maestro-flow-unmapped",
        path: entry.path,
        message: "Maestro deep link does not map to exactly one Expo route.",
        remediation:
          "Use a concrete deep link matching one statically discovered route.",
        retryable: true,
      });
      continue;
    }
    const route = candidates[0]!;
    flows.push({
      relativePath,
      contentHash: sha256(entry.content),
      appId,
      deepLink,
      mapping: "route",
      routeId: route.routeId,
      routePath: route.path,
      captureRouteId: route.routeId,
      captureRoutePath: route.path,
    });
  }
  return {
    flows: Object.freeze(flows),
    errors: Object.freeze(errors),
  };
}

export function isExpoPackage(manifest: PackageManifest): boolean {
  const dependencies = {
    ...manifest.devDependencies,
    ...manifest.dependencies,
  };
  return (
    manifest.main === "expo-router/entry" ||
    ("expo" in dependencies && "expo-router" in dependencies)
  );
}

function expoWebLaunchScript(manifest: PackageManifest): "start" | null {
  const script = manifest.scripts?.start;
  if (
    script === undefined ||
    !/\bexpo\s+start\b/u.test(script) ||
    /\s--(?:go|ios|android)(?:\s|$)/u.test(script)
  ) {
    return null;
  }
  return "start";
}

export function supportsExpoWebCapture(manifest: PackageManifest): boolean {
  const dependencies = {
    ...manifest.devDependencies,
    ...manifest.dependencies,
  };
  return (
    expoWebLaunchScript(manifest) !== null &&
    "react-dom" in dependencies &&
    "react-native-web" in dependencies
  );
}

function routePath(sourcePath: string, root: string): string {
  const local = relativeToRoot(root, sourcePath)
    .slice("app/".length)
    .replace(SOURCE_EXTENSION, "");
  const segments = local.split("/").flatMap((segment) => {
    if (/^\([^)]+\)$/u.test(segment) || segment === "index") {
      return [];
    }
    const catchAll = segment.match(/^\[\.\.\.([^\]]+)\]$/u)?.[1];
    if (catchAll !== undefined) {
      return [`:${catchAll}*`];
    }
    const dynamic = segment.match(/^\[([^\]]+)\]$/u)?.[1];
    return [dynamic === undefined ? segment : `:${dynamic}`];
  });
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function expoRouteEntries(
  entries: readonly RepositoryManifestEntry[],
  root: string,
): readonly RepositoryManifestEntry[] {
  return entriesForRoot(entries, root).filter((entry) => {
    const local = relativeToRoot(root, entry.path);
    const basename = local.split("/").at(-1) ?? "";
    return (
      local.startsWith("app/") &&
      SOURCE_EXTENSION.test(local) &&
      !basename.startsWith("_") &&
      !basename.startsWith("+") &&
      !basename.includes("+api.")
    );
  });
}

function plannedExpoRoutes(input: {
  readonly applicationId: `app_${string}`;
  readonly entries: readonly RepositoryManifestEntry[];
  readonly root: string;
  readonly platform: CaptureApplicationUnit["platform"];
}): readonly ReturnType<typeof makeRoute>[] {
  return expoRouteEntries(input.entries, input.root)
    .map((entry) => {
      const path = routePath(entry.path, input.root);
      return makeRoute({
        applicationId: input.applicationId,
        sourcePath: entry.path,
        path,
        displayName:
          path === "/"
            ? "Home"
            : titleFromSegment(path.split("/").at(-1) ?? ""),
        navigation: input.platform === "react-web" ? "url" : "deep-link",
        platform: input.platform,
        ...(input.platform === "react-web"
          ? {
              viewport: {
                name: "ios-mobile" as const,
                width: 390,
                height: 844,
                scale: 3,
              },
            }
          : {}),
      });
    })
    .sort((left, right) => left.route.path.localeCompare(right.route.path));
}

export function discoverExpoApplication(input: {
  readonly root: string;
  readonly manifestPath: string;
  readonly manifest: PackageManifest;
  readonly entries: readonly RepositoryManifestEntry[];
  readonly repositoryFingerprint: `sha256:${string}`;
  readonly options?: CaptureDiscoveryOptions;
}): CaptureApplicationUnit {
  const applicationId = `app_${sha256(`expo-ios:${input.root}`).slice(
    "sha256:".length,
    "sha256:".length + 24,
  )}` as const;
  const planned = plannedExpoRoutes({
    applicationId,
    entries: input.entries,
    root: input.root,
    platform: "expo-ios",
  });
  const errors: CaptureDiscoveryError[] =
    planned.length === 0
      ? [
          {
            code: "no-capturable-routes",
            path: joinRoot(input.root, "app"),
            message: "Expo Router application has no capturable screen routes.",
            remediation:
              "Add at least one screen module beneath the app directory.",
            retryable: true,
          },
        ]
      : [];
  const appConfigEntry = input.entries.find(
    (entry) => entry.path === joinRoot(input.root, "app.json"),
  );
  const appConfig = parseAppConfig(appConfigEntry);
  if (appConfig.error !== null) {
    errors.push(appConfig.error);
  }
  const bundleId = appConfig.config?.expo?.ios?.bundleIdentifier ?? null;
  const developmentClientScheme = developmentClientMetroScheme(appConfig.config);
  const checkedInNativeBuild = hasCheckedInIOSNativeBuild({
    root: input.root,
    entries: input.entries,
  });
  const requestedExistingDevelopmentClient =
    input.options?.expoRuntime === "existing-development-client";
  // A dependency merely makes a development client *possible*. It does not
  // prove that the selected simulator has the app installed. A checked-in
  // native project is the deterministic, no-admin capture authority unless a
  // project or the caller explicitly opts into the development-client
  // transport.
  const runtime = requestedExistingDevelopmentClient
    ? "development-client"
    : explicitExpoGo(input.manifest, appConfig.config)
      ? "expo-go"
      : explicitDevelopmentClient(appConfig.config) ||
          (!checkedInNativeBuild && hasDevelopmentClient(input.manifest))
        ? "development-client"
        : "standalone";
  if (
    requestedExistingDevelopmentClient &&
    !hasDevelopmentClient(input.manifest)
  ) {
    errors.push({
      code: "expo-development-client-required",
      path: input.manifestPath,
      message:
        "Explicit existing development-client capture requires the expo-dev-client package.",
      remediation:
        "Add expo-dev-client to package.json, rebuild and install the development client, or omit the explicit runtime preference.",
      retryable: true,
    });
  }
  if (
    (runtime === "standalone" || runtime === "development-client") &&
    bundleId === null
  ) {
    errors.push({
      code: "expo-runtime-target-required",
      path: appConfigEntry?.path ?? input.manifestPath,
      message:
        requestedExistingDevelopmentClient
          ? "Explicit existing development-client capture requires an Expo iOS bundle identifier."
          : "Expo iOS capture has neither a bundle identifier nor explicit Expo Go mode.",
      remediation:
        requestedExistingDevelopmentClient
          ? "Set expo.ios.bundleIdentifier in app.json before selecting an existing development client."
          : "Set expo.ios.bundleIdentifier in app.json or explicitly select Expo Go with `expo start --go` or expo.extra.memi.capture.mode.",
      retryable: true,
    });
  }
  if (runtime === "development-client" && developmentClientScheme === null) {
    errors.push({
      code: "expo-runtime-target-required",
      path: appConfigEntry?.path ?? input.manifestPath,
      message: "Expo development-client capture requires a URL scheme.",
      remediation:
        "Set expo.scheme in app.json before capturing through an installed development client.",
      retryable: true,
    });
  }
  const nativeBuild =
    runtime === "standalone" && bundleId !== null
      ? discoverStandaloneNativeBuild({
          root: input.root,
          entries: input.entries,
          applicationId,
          preferredNames: [
            appConfig.config?.expo?.name ?? "",
            appConfig.config?.expo?.slug ?? "",
            input.manifest.name ?? "",
          ].filter(Boolean),
        })
      : { configuration: null, manifestPaths: [], errors: [] };
  errors.push(...nativeBuild.errors);
  const maestro = discoverMaestroFlows({
    root: input.root,
    entries: input.entries,
    routes: planned.map(({ route }) => route),
    bundleId,
    runtime,
  });
  errors.push(...maestro.errors);
  let captureConfiguration: ExpoIOSCaptureConfiguration | null = null;
  if (errors.length === 0) {
    try {
      captureConfiguration = validateCaptureApplicationConfiguration({
        kind: "expo-ios",
        runtime,
        bundleId: runtime === "expo-go" ? null : bundleId,
        appConfigPath:
          appConfigEntry === undefined
            ? null
            : relativeToRoot(input.root, appConfigEntry.path),
        entryPoint: input.manifest.main ?? "expo-router/entry",
        scheme:
          runtime === "development-client"
            ? developmentClientScheme
            : appConfig.config?.expo?.scheme ?? null,
        nativeBuild: nativeBuild.configuration,
        metro:
          runtime === "expo-go"
            ? {
                executable: "npx",
                args: ["expo", "start", "--go", "--localhost"],
                appId: "host.exp.Exponent",
                routeAuthority: "expo-go-project-url",
              }
            : runtime === "development-client"
              ? {
                  executable: "npx",
                  args: ["expo", "start", "--dev-client", "--localhost"],
                  appId: bundleId!,
                  routeAuthority: "expo-development-client-url",
                  scheme: developmentClientScheme ?? "",
                }
              : null,
        maestroFlowPaths: maestro.flows.map(({ relativePath }) => relativePath),
        maestroFlows: maestro.flows,
      }) as ExpoIOSCaptureConfiguration;
    } catch (error) {
      errors.push({
        code: "expo-static-config-invalid",
        path: appConfigEntry?.path ?? input.manifestPath,
        message:
          error instanceof Error
            ? error.message
            : "Expo capture configuration is invalid.",
        remediation:
          "Use a valid bundle identifier, URL scheme, entry point, and contained Maestro paths.",
        retryable: true,
      });
    }
  }
  const flowManifestPaths = entriesForRoot(input.entries, input.root)
    .filter((entry) =>
      MAESTRO_FLOW_PATTERN.test(relativeToRoot(input.root, entry.path)),
    )
    .map(({ path }) => path);

  return {
    applicationId,
    platform: "expo-ios",
    root: input.root,
    displayName:
      input.manifest.name ?? input.root.split("/").at(-1) ?? "Expo app",
    status: errors.length === 0 ? "supported" : "unsupported",
    pipelineStages: CAPTURE_PIPELINE_STAGES,
    manifestPaths: [
      input.manifestPath,
      ...(appConfigEntry === undefined ? [] : [appConfigEntry.path]),
      ...flowManifestPaths,
      ...nativeBuild.manifestPaths,
    ],
    buildRecipe:
      errors.length === 0
        ? runtime === "expo-go"
          ? {
              executable: "npx",
              args: ["expo", "start", "--go", "--localhost"],
              cwd: input.root,
              purpose: "launch",
            }
          : runtime === "development-client"
            ? {
                executable: "npx",
                args: ["expo", "start", "--dev-client", "--localhost"],
                cwd: input.root,
                purpose: "launch",
              }
            : {
              executable: "xcodebuild",
              args: [
                ...nativeBuild.configuration!.buildSettingsResolution.args.slice(
                  0,
                  -1,
                ),
                "build",
              ],
              cwd: input.root,
              purpose: "build",
            }
        : null,
    captureConfiguration: errors.length === 0 ? captureConfiguration : null,
    routes: planned.map(({ route }) => route),
    scenarios: planned.map(({ scenario }) => scenario),
    cacheKey: applicationCacheKey({
      repositoryFingerprint: input.repositoryFingerprint,
      adapterVersion: requestedExistingDevelopmentClient
        ? "expo-router-capture-plan@2:existing-development-client"
        : "expo-router-capture-plan@2",
      root: input.root,
      entries: entriesForRoot(input.entries, input.root),
    }),
    errors,
  };
}

export function discoverExpoWebApplication(input: {
  readonly root: string;
  readonly manifestPath: string;
  readonly manifest: PackageManifest;
  readonly entries: readonly RepositoryManifestEntry[];
  readonly repositoryFingerprint: `sha256:${string}`;
}): CaptureApplicationUnit | null {
  const script = expoWebLaunchScript(input.manifest);
  if (script === null || !supportsExpoWebCapture(input.manifest)) {
    return null;
  }
  const applicationId = `app_${sha256(`expo-web:${input.root}`).slice(
    "sha256:".length,
    "sha256:".length + 24,
  )}` as const;
  const planned = plannedExpoRoutes({
    applicationId,
    entries: input.entries,
    root: input.root,
    platform: "react-web",
  });
  const errors: CaptureDiscoveryError[] =
    planned.length === 0
      ? [
          {
            code: "no-capturable-routes",
            path: joinRoot(input.root, "app"),
            message: "Expo Router application has no capturable screen routes.",
            remediation:
              "Add at least one screen module beneath the app directory.",
            retryable: true,
          },
        ]
      : [];

  return {
    applicationId,
    platform: "react-web",
    root: input.root,
    displayName: `${input.manifest.name ?? input.root.split("/").at(-1) ?? "Expo app"} web`,
    status: errors.length === 0 ? "supported" : "unsupported",
    pipelineStages: CAPTURE_PIPELINE_STAGES,
    manifestPaths: [input.manifestPath],
    buildRecipe:
      errors.length === 0
        ? {
            executable: "npm",
            args: [
              "run",
              script,
              "--",
              "--web",
              "--localhost",
              "--port",
              "{leasedPort}",
            ],
            cwd: input.root,
            purpose: "launch",
          }
        : null,
    routes: planned.map(({ route }) => route),
    scenarios: planned.map(({ scenario }) => scenario),
    cacheKey: applicationCacheKey({
      repositoryFingerprint: input.repositoryFingerprint,
      adapterVersion: "expo-web-capture-plan@1",
      root: input.root,
      entries: entriesForRoot(input.entries, input.root),
    }),
    errors,
  };
}

export type { PackageManifest };
