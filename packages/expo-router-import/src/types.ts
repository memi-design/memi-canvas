export type ContentHash = `sha256:${string}`;

export interface ImportBudgets {
  readonly maxFiles: number;
  readonly maxEntries: number;
  readonly maxDepth: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export interface RepositoryAuthority {
  readonly revision: string;
  readonly dirty: boolean;
  readonly dirtyFileFingerprint: string;
}

export interface UnavailableRuntimeCapture {
  readonly kind: "unavailable";
  readonly reason: string;
}

export interface ImportExpoRouterProjectOptions {
  readonly rootDir: string;
  readonly repository: RepositoryAuthority;
  readonly budgets: ImportBudgets;
  readonly runtimeCapture: UnavailableRuntimeCapture;
}

export interface RouteParameter {
  readonly kind: "dynamic" | "catch-all";
  readonly name: string;
}

export interface ExpoScreenRoute {
  readonly routeId: `rte_${string}`;
  readonly kind: "screen";
  readonly sourcePath: string;
  readonly normalizedPath: string;
  readonly groups: readonly string[];
  readonly parameters: readonly RouteParameter[];
}

export type SourceAnchorKind =
  | "screen"
  | "layout"
  | "html-shell"
  | "not-found"
  | "api-route";

export interface SourceAnchor {
  readonly kind: SourceAnchorKind;
  readonly sourcePath: string;
  readonly contentHash: ContentHash;
}

export interface DesignFileEvidence {
  readonly sourcePath: string;
  readonly evidenceKind: "declared-source";
  readonly contentHash: ContentHash;
}

export interface StaticDeclarationAnchor {
  readonly sourcePath: string;
  readonly contentHash: ContentHash;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export type DesignDeclarationConfidence = "high";

export interface ComponentAxisEvidence {
  readonly name: "padding" | "size" | "tone" | "variant";
  readonly values: readonly string[];
  readonly defaultValue?: string;
  readonly confidence: DesignDeclarationConfidence;
  readonly source: StaticDeclarationAnchor;
}

export interface ComponentDeclarationEvidence {
  readonly name: "Badge" | "Button" | "Card" | "Input";
  readonly atomicLevel: "atom";
  readonly confidence: DesignDeclarationConfidence;
  readonly source: StaticDeclarationAnchor;
  readonly axes: readonly ComponentAxisEvidence[];
}

export type StaticTokenValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "null"; readonly value: null }
  | {
      readonly kind: "reference";
      readonly expression: string;
      readonly resolution: "unresolved";
    };

export interface SemanticTokenEntryEvidence {
  readonly path: readonly string[];
  readonly value: StaticTokenValue;
  readonly confidence: DesignDeclarationConfidence;
  readonly source: StaticDeclarationAnchor;
}

export interface SemanticTokenCollectionEvidence {
  readonly name: string;
  readonly collectionKind: "array" | "object";
  readonly confidence: DesignDeclarationConfidence;
  readonly source: StaticDeclarationAnchor;
  readonly entries: readonly SemanticTokenEntryEvidence[];
}

export interface DesignSystemBarrelExportEvidence {
  readonly exportedName: string;
  readonly localName: string;
  readonly moduleSpecifier: string;
  readonly typeOnly: boolean;
  readonly confidence: DesignDeclarationConfidence;
  readonly source: StaticDeclarationAnchor;
}

export interface VisibleNavigationTabEvidence {
  readonly routeName: string;
  readonly title?: string;
  readonly confidence: DesignDeclarationConfidence;
  readonly source: StaticDeclarationAnchor;
}

export interface StaticDesignSystemEvidence {
  readonly schemaVersion: "expo-design-system-static@1";
  readonly analysisMode: "static-ast";
  readonly executedProjectCode: false;
  readonly confidencePolicy: "high-confidence-only";
  readonly components: readonly ComponentDeclarationEvidence[];
  readonly tokenCollections: readonly SemanticTokenCollectionEvidence[];
  readonly barrelExports: readonly DesignSystemBarrelExportEvidence[];
  readonly navigation: {
    readonly visibleTabs: readonly VisibleNavigationTabEvidence[];
  };
  readonly extraction: {
    readonly status: "complete" | "partial";
    readonly omittedAmbiguousDeclarations: number;
  };
}

export interface PlannedViewport {
  readonly name: "mobile";
  readonly width: number;
  readonly height: number;
}

export type ScreenCaptureContext =
  | "public"
  | "signed-out"
  | "guest"
  | "authenticated";

export interface CaptureFixtureRequirement {
  readonly status: "not-required" | "required";
  readonly parameterNames: readonly string[];
}

export interface BlockedCapture {
  readonly status: "blocked";
  readonly reasonCode: "runtime-capture-unavailable";
  readonly reason: string;
}

export interface ResponsiveFramePlan {
  readonly scenarioId: `scn_${string}`;
  readonly routeId: `rte_${string}`;
  readonly routeSourcePath: string;
  readonly normalizedPath: string;
  readonly context: ScreenCaptureContext;
  readonly contextProvenance:
    | "inferred-from-route-group"
    | "inferred-public";
  readonly fixture: CaptureFixtureRequirement;
  readonly viewport: PlannedViewport;
  readonly capture: BlockedCapture;
}

export interface ExpoRouterImportCoverage {
  readonly routeFiles: number;
  readonly normalizedRoutes: number;
  readonly scenarios: number;
  readonly dynamicScenarios: number;
  readonly deviceProfiles: readonly ["ios-mobile"];
  readonly contexts: Readonly<Record<ScreenCaptureContext, number>>;
  readonly capture: {
    readonly planned: number;
    readonly captured: number;
    readonly blocked: number;
    readonly failed: number;
  };
}

export interface ExpoRouterImportResult {
  readonly routes: readonly ExpoScreenRoute[];
  readonly sourceAnchors: readonly SourceAnchor[];
  readonly designEvidence: {
    readonly tokenFiles: readonly DesignFileEvidence[];
    readonly componentFiles: readonly DesignFileEvidence[];
  };
  readonly designSystem: StaticDesignSystemEvidence;
  readonly provenance: {
    readonly adapterVersion: "expo-router-static@1";
    readonly analysisMode: "static-source";
    readonly executedProjectCode: false;
    readonly repository: RepositoryAuthority;
    readonly sourceFingerprint: ContentHash;
  };
  readonly framePlans: readonly ResponsiveFramePlan[];
  readonly coverage: ExpoRouterImportCoverage;
}
