import {
  SWIFTUI_REQUIRED_BUILD_SETTING_KEYS,
  type CaptureApplicationConfiguration,
  type IOSNativeBuildConfiguration,
} from "./types.js";

function assertContainedRelativePath(path: string, label: string): void {
  const segments = path.split("/");
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(path) ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`${label} must be a contained relative path.`);
  }
}

function assertIdentifier(
  value: string,
  pattern: RegExp,
  label: string,
): void {
  if (!pattern.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function validateNativeBuild(
  configuration: IOSNativeBuildConfiguration,
): IOSNativeBuildConfiguration {
  assertContainedRelativePath(
    configuration.container.relativePath,
    "iOS project container",
  );
  assertContainedRelativePath(
    configuration.schemePath,
    "iOS shared scheme path",
  );
  assertContainedRelativePath(
    configuration.derivedDataRelativePath,
    "iOS DerivedData path",
  );
  if (
    !configuration.derivedDataRelativePath.startsWith(
      ".memi/capture/derived-data/",
    )
  ) {
    throw new Error("iOS DerivedData must use the managed capture path.");
  }
  assertIdentifier(
    configuration.scheme,
    /^[A-Za-z0-9._-]{1,160}$/u,
    "iOS scheme",
  );
  const expectedBuildSettingsArgs = [
    configuration.container.kind === "project"
      ? "-project"
      : "-workspace",
    configuration.container.relativePath,
    "-scheme",
    configuration.scheme,
    "-configuration",
    configuration.configuration,
    "-sdk",
    "iphonesimulator",
    "-jobs",
    "1",
    "-destination",
    "generic/platform=iOS Simulator",
    "-derivedDataPath",
    configuration.derivedDataRelativePath,
    "ENABLE_USER_SCRIPT_SANDBOXING=YES",
    "-showBuildSettings",
  ];
  if (
    configuration.buildSettingsResolution.executable !== "xcodebuild" ||
    configuration.buildSettingsResolution.args.join("\0") !==
      expectedBuildSettingsArgs.join("\0") ||
    configuration.buildSettingsResolution.requiredKeys.length !==
      SWIFTUI_REQUIRED_BUILD_SETTING_KEYS.length ||
    SWIFTUI_REQUIRED_BUILD_SETTING_KEYS.some(
      (key, index) =>
        configuration.buildSettingsResolution.requiredKeys[index] !== key,
    )
  ) {
    throw new Error(
      "iOS capture build settings recipe or required keys are invalid.",
    );
  }
  return Object.freeze({
    ...configuration,
    container: Object.freeze({ ...configuration.container }),
    buildSettingsResolution: Object.freeze({
      ...configuration.buildSettingsResolution,
      args: Object.freeze([
        ...configuration.buildSettingsResolution.args,
      ]),
      requiredKeys: SWIFTUI_REQUIRED_BUILD_SETTING_KEYS,
    }),
  });
}

export function validateCaptureApplicationConfiguration(
  configuration: CaptureApplicationConfiguration,
): CaptureApplicationConfiguration {
  if (configuration.kind === "expo-ios") {
    if (
      configuration.runtime === "standalone" &&
      configuration.bundleId === null
    ) {
      throw new Error("Standalone Expo capture requires a bundle identifier.");
    }
    if (
      configuration.runtime === "expo-go" &&
      configuration.bundleId !== null
    ) {
      throw new Error("Expo Go capture must not claim an application bundle.");
    }
    if (
      configuration.runtime === "development-client" &&
      (configuration.bundleId === null || configuration.scheme === null)
    ) {
      throw new Error(
        "Development-client capture requires a bundle identifier and URL scheme.",
      );
    }
    if (
      configuration.runtime === "standalone" &&
      (configuration.nativeBuild === null || configuration.metro !== null)
    ) {
      throw new Error(
        "Standalone Expo capture requires native build authority only.",
      );
    }
    if (
      configuration.runtime === "expo-go" &&
      (configuration.nativeBuild !== null ||
        configuration.metro === null ||
        configuration.metro.executable !== "npx" ||
        configuration.metro.args.join("\0") !==
          ["expo", "start", "--go", "--localhost"].join("\0") ||
        configuration.metro.appId !== "host.exp.Exponent" ||
        configuration.metro.routeAuthority !== "expo-go-project-url")
    ) {
      throw new Error(
        "Expo Go capture requires Metro and Expo Go route authority.",
      );
    }
    if (
      configuration.runtime === "development-client" &&
      (configuration.nativeBuild !== null ||
        configuration.metro === null ||
        configuration.metro.executable !== "npx" ||
        configuration.metro.args.join("\0") !==
          ["expo", "start", "--dev-client", "--localhost"].join("\0") ||
        configuration.metro.appId !== configuration.bundleId ||
        configuration.metro.routeAuthority !==
          "expo-development-client-url")
    ) {
      throw new Error(
        "Development-client capture requires declared Metro and client route authority.",
      );
    }
    if (configuration.bundleId !== null) {
      assertIdentifier(
        configuration.bundleId,
        /^(?=.{3,255}$)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u,
        "Expo bundle identifier",
      );
    }
    if (configuration.appConfigPath !== null) {
      assertContainedRelativePath(
        configuration.appConfigPath,
        "Expo app config path",
      );
    }
    assertContainedRelativePath(configuration.entryPoint, "Expo entry point");
    if (configuration.scheme !== null) {
      assertIdentifier(
        configuration.scheme,
        /^[A-Za-z][A-Za-z0-9+.-]{0,127}$/u,
        "Expo URL scheme",
      );
    }
    const flowPaths = new Set<string>();
    for (const flow of configuration.maestroFlows) {
      assertContainedRelativePath(flow.relativePath, "Maestro flow path");
      if (!/^sha256:[a-f0-9]{64}$/u.test(flow.contentHash)) {
        throw new Error("Maestro flow content hash is invalid.");
      }
      if (flowPaths.has(flow.relativePath)) {
        throw new Error("Maestro flow paths must be unique.");
      }
      flowPaths.add(flow.relativePath);
      if (
        flow.mapping === "route" &&
        (flow.routeId === null || flow.routePath === null)
      ) {
        throw new Error("Route-mapped Maestro flows require a route target.");
      }
      if (
        flow.mapping === "application" &&
        (flow.routeId !== null || flow.routePath !== null)
      ) {
        throw new Error(
          "Application-level Maestro flows cannot claim a route target.",
        );
      }
      if (
        (flow.captureRouteId === null) !==
        (flow.captureRoutePath === null)
      ) {
        throw new Error(
          "Maestro flow capture-route association must include both route ID and path.",
        );
      }
      if (
        flow.mapping === "route" &&
        (flow.captureRouteId !== flow.routeId ||
          flow.captureRoutePath !== flow.routePath)
      ) {
        throw new Error(
          "Route-mapped Maestro flow capture-route association must match its route target.",
        );
      }
    }
    const indexedPaths = new Set(configuration.maestroFlowPaths);
    if (
      configuration.maestroFlowPaths.length !== flowPaths.size ||
      indexedPaths.size !== flowPaths.size ||
      configuration.maestroFlowPaths.some((path) => !flowPaths.has(path))
    ) {
      throw new Error("Maestro flow path index does not match flow metadata.");
    }
    return Object.freeze({
      ...configuration,
      nativeBuild:
        configuration.nativeBuild === null
          ? null
          : validateNativeBuild(configuration.nativeBuild),
      metro:
        configuration.metro === null
          ? null
          : configuration.metro.routeAuthority === "expo-go-project-url"
            ? Object.freeze({
                ...configuration.metro,
                args: Object.freeze([
                  "expo",
                  "start",
                  "--go",
                  "--localhost",
                ] as const),
              })
            : Object.freeze({
                ...configuration.metro,
                args: Object.freeze([
                  "expo",
                  "start",
                  "--dev-client",
                  "--localhost",
                ] as const),
              }),
      maestroFlowPaths: Object.freeze([...configuration.maestroFlowPaths]),
      maestroFlows: Object.freeze(
        configuration.maestroFlows.map((flow) => Object.freeze({ ...flow })),
      ),
    });
  }

  const native = validateNativeBuild({
    container: configuration.container,
    scheme: configuration.scheme,
    schemePath: configuration.schemePath,
    configuration: "Debug",
    derivedDataRelativePath: configuration.derivedDataRelativePath,
    requiresResolvedBuildSettings: true,
    buildSettingsResolution: configuration.buildSettingsResolution,
  });
  return Object.freeze({
    ...configuration,
    container: native.container,
    buildSettingsResolution: native.buildSettingsResolution,
  });
}
