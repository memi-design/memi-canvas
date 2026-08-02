export type ContentHash = `sha256:${string}`;

export interface RepositoryManifestBudgets {
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxDepth: number;
}

export interface RepositoryManifestEntry {
  readonly path: string;
  readonly content: string;
}

export interface RepositoryManifestInput {
  readonly schemaVersion: 1;
  readonly repository: {
    readonly revision: string;
    readonly dirtyFileFingerprint: ContentHash;
  };
  readonly budgets: RepositoryManifestBudgets;
  readonly entries: readonly RepositoryManifestEntry[];
}

export type CapturePlatform = "expo-ios" | "react-web" | "swiftui";
export type ApplicationStatus = "supported" | "unsupported";

export const CAPTURE_PIPELINE_STAGES = [
  "validate",
  "inventory",
  "plan",
  "prepare-fixtures",
  "build",
  "launch",
  "capture",
  "extract-layers",
  "verify",
  "save",
] as const;

export type CapturePipelineStage = (typeof CAPTURE_PIPELINE_STAGES)[number];

export interface ApprovedBuildRecipe {
  readonly executable: "npm" | "npx" | "xcodebuild";
  readonly args: readonly string[];
  readonly cwd: string;
  readonly purpose: "build" | "launch";
}

export type CaptureDiscoveryErrorCode =
  | "invalid-package-manifest"
  | "unsupported-application"
  | "missing-launch-script"
  | "expo-static-config-invalid"
  | "expo-runtime-target-required"
  | "expo-development-client-required"
  | "expo-native-container-required"
  | "expo-native-container-ambiguous"
  | "expo-native-scheme-required"
  | "expo-native-scheme-ambiguous"
  | "expo-maestro-app-id-mismatch"
  | "expo-maestro-flow-unmapped"
  | "swiftui-shared-scheme-required"
  | "swiftui-container-ambiguous"
  | "swiftui-scheme-ambiguous"
  | "no-capturable-routes";

export interface CaptureDiscoveryError {
  readonly code: CaptureDiscoveryErrorCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
  readonly retryable: boolean;
}

export interface CaptureRouteParameter {
  readonly name: string;
  readonly kind: "dynamic" | "catch-all";
}

export interface CaptureRoutePlan {
  readonly routeId: `rte_${string}`;
  readonly sourcePath: string;
  readonly path: string;
  readonly displayName: string;
  readonly parameters: readonly CaptureRouteParameter[];
  readonly navigation: "deep-link" | "url" | "view";
}

export type CaptureAuthContext =
  | "public"
  | "signed-out"
  | "guest"
  | "authenticated";

export interface CaptureScenarioPlan {
  readonly scenarioId: `scn_${string}`;
  readonly applicationId: `app_${string}`;
  readonly routeId: `rte_${string}`;
  readonly routePath: string;
  readonly state: "default";
  readonly authContext: CaptureAuthContext;
  readonly fixture: {
    readonly status: "not-required" | "required";
    readonly parameterNames: readonly string[];
  };
  readonly viewport: {
    readonly name: "ios-mobile" | "desktop";
    readonly width: number;
    readonly height: number;
    readonly scale: number;
  };
  readonly readiness: {
    readonly strategy: "two-stable-frames";
    readonly stableFrames: 2;
    readonly rejectBlank: true;
    readonly rejectSplash: true;
    readonly rejectErrorBoundary: true;
  };
}

export interface ExpoMaestroFlowConfiguration {
  readonly relativePath: string;
  /** Digest of the exact discovered flow content. The managed copy must match before execution. */
  readonly contentHash: ContentHash;
  readonly appId: string | null;
  readonly deepLink: string | null;
  readonly mapping: "application" | "route";
  readonly routeId: CaptureRoutePlan["routeId"] | null;
  readonly routePath: string | null;
  /**
   * A fail-closed association for an application-level flow. It is populated
   * only when discovery finds one unambiguous route target.
   */
  readonly captureRouteId: CaptureRoutePlan["routeId"] | null;
  readonly captureRoutePath: string | null;
}

export interface ExpoIOSCaptureConfiguration {
  readonly kind: "expo-ios";
  readonly runtime: "standalone" | "expo-go" | "development-client";
  readonly bundleId: string | null;
  readonly appConfigPath: string | null;
  readonly entryPoint: string;
  readonly scheme: string | null;
  readonly nativeBuild: IOSNativeBuildConfiguration | null;
  readonly metro:
    | ExpoGoMetroConfiguration
    | ExpoDevelopmentClientMetroConfiguration
    | null;
  readonly maestroFlowPaths: readonly string[];
  readonly maestroFlows: readonly ExpoMaestroFlowConfiguration[];
}

export interface ExpoGoMetroConfiguration {
  readonly executable: "npx";
  readonly args: readonly ["expo", "start", "--go", "--localhost"];
  readonly appId: "host.exp.Exponent";
  readonly routeAuthority: "expo-go-project-url";
}

export interface ExpoDevelopmentClientMetroConfiguration {
  readonly executable: "npx";
  readonly args: readonly ["expo", "start", "--dev-client", "--localhost"];
  readonly appId: string;
  readonly routeAuthority: "expo-development-client-url";
  readonly scheme: string;
}

export const SWIFTUI_REQUIRED_BUILD_SETTING_KEYS = [
  "PRODUCT_BUNDLE_IDENTIFIER",
  "TARGET_BUILD_DIR",
  "FULL_PRODUCT_NAME",
] as const;

export type SwiftUIRequiredBuildSettingKey =
  (typeof SWIFTUI_REQUIRED_BUILD_SETTING_KEYS)[number];

export interface SwiftUIBuildSettingsResolution {
  readonly executable: "xcodebuild";
  readonly args: readonly string[];
  readonly requiredKeys: readonly SwiftUIRequiredBuildSettingKey[];
}

export interface IOSNativeBuildConfiguration {
  readonly container: {
    readonly kind: "project" | "workspace";
    readonly relativePath: string;
  };
  readonly scheme: string;
  readonly schemePath: string;
  readonly configuration: "Debug" | "Release";
  readonly derivedDataRelativePath: string;
  readonly requiresResolvedBuildSettings: true;
  readonly buildSettingsResolution: SwiftUIBuildSettingsResolution;
}

export interface SwiftUICaptureConfiguration {
  readonly kind: "swiftui";
  readonly container: IOSNativeBuildConfiguration["container"];
  readonly scheme: IOSNativeBuildConfiguration["scheme"];
  readonly schemePath: IOSNativeBuildConfiguration["schemePath"];
  readonly derivedDataRelativePath: IOSNativeBuildConfiguration["derivedDataRelativePath"];
  readonly requiresResolvedBuildSettings: IOSNativeBuildConfiguration["requiresResolvedBuildSettings"];
  readonly buildSettingsResolution: IOSNativeBuildConfiguration["buildSettingsResolution"];
}

export type CaptureApplicationConfiguration =
  | ExpoIOSCaptureConfiguration
  | SwiftUICaptureConfiguration;

export interface CaptureApplicationUnit {
  readonly applicationId: `app_${string}`;
  readonly platform: CapturePlatform;
  readonly root: string;
  readonly displayName: string;
  readonly status: ApplicationStatus;
  readonly pipelineStages: readonly CapturePipelineStage[];
  readonly manifestPaths: readonly string[];
  readonly buildRecipe: ApprovedBuildRecipe | null;
  readonly captureConfiguration?: CaptureApplicationConfiguration | null;
  readonly routes: readonly CaptureRoutePlan[];
  readonly scenarios: readonly CaptureScenarioPlan[];
  readonly cacheKey: ContentHash;
  readonly errors: readonly CaptureDiscoveryError[];
}

export interface CaptureApplicationDiscoveryResult {
  readonly schemaVersion: 1;
  readonly executedProjectCode: false;
  readonly repositoryFingerprint: ContentHash;
  readonly applications: readonly CaptureApplicationUnit[];
  readonly errors: readonly CaptureDiscoveryError[];
}

/**
 * Explicit, caller-owned preferences for static capture discovery.
 *
 * Omitting this object preserves the repository-derived runtime selection.
 */
export interface CaptureDiscoveryOptions {
  /**
   * Use an already installed Expo development client instead of a checked-in
   * native iOS build. Discovery still requires static proof of its package,
   * bundle identifier, and URL scheme.
   */
  readonly expoRuntime?: "existing-development-client";
}

export interface CaptureAdapterPlan {
  readonly platform: CapturePlatform;
  readonly applicationId: `app_${string}`;
  readonly stages: readonly CapturePipelineStage[];
  readonly executedProjectCode: false;
  readonly buildRecipe: ApprovedBuildRecipe;
  readonly scenarios: readonly CaptureScenarioPlan[];
  readonly cacheKey: ContentHash;
}
