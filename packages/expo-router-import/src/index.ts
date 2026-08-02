import { createHash } from "node:crypto";

import { readStaticSources } from "./filesystem.js";
import { extractStaticDesignSystem } from "./design-system.js";
import { compileRoutes } from "./routes.js";
import type {
  BlockedCapture,
  DesignFileEvidence,
  ExpoRouterImportCoverage,
  ExpoRouterImportResult,
  ImportExpoRouterProjectOptions,
  PlannedViewport,
  RepositoryAuthority,
  ResponsiveFramePlan,
  ScreenCaptureContext,
} from "./types.js";

export type {
  BlockedCapture,
  ComponentAxisEvidence,
  ComponentDeclarationEvidence,
  ContentHash,
  DesignDeclarationConfidence,
  DesignFileEvidence,
  DesignSystemBarrelExportEvidence,
  ExpoRouterImportCoverage,
  ExpoRouterImportResult,
  ExpoScreenRoute,
  ImportBudgets,
  ImportExpoRouterProjectOptions,
  PlannedViewport,
  RepositoryAuthority,
  ResponsiveFramePlan,
  RouteParameter,
  ScreenCaptureContext,
  SemanticTokenCollectionEvidence,
  SemanticTokenEntryEvidence,
  SourceAnchor,
  SourceAnchorKind,
  StaticDeclarationAnchor,
  StaticDesignSystemEvidence,
  StaticTokenValue,
  UnavailableRuntimeCapture,
  VisibleNavigationTabEvidence,
} from "./types.js";

const VIEWPORTS: readonly PlannedViewport[] = [
  { name: "mobile", width: 390, height: 844 },
];

function captureContexts(
  groups: readonly string[],
): readonly ScreenCaptureContext[] {
  if (groups.includes("auth")) {
    return ["signed-out"];
  }
  if (groups.includes("protected")) {
    return ["guest", "authenticated"];
  }
  return ["public"];
}

function scenarioId(
  routeId: `rte_${string}`,
  context: ScreenCaptureContext,
  viewport: PlannedViewport,
): `scn_${string}` {
  const digest = createHash("sha256")
    .update(`${routeId}\0${context}\0${viewport.name}\0${viewport.width}x${viewport.height}`)
    .digest("hex");
  return `scn_${digest.slice(0, 24)}`;
}

function planFrames(
  routes: ExpoRouterImportResult["routes"],
  capture: BlockedCapture,
): readonly ResponsiveFramePlan[] {
  return routes.flatMap((route) =>
    captureContexts(route.groups).flatMap((context) =>
      VIEWPORTS.map((viewport) => ({
        scenarioId: scenarioId(route.routeId, context, viewport),
        routeId: route.routeId,
        routeSourcePath: route.sourcePath,
        normalizedPath: route.normalizedPath,
        context,
        contextProvenance: route.groups.some(
          (group) => group === "auth" || group === "protected",
        )
          ? "inferred-from-route-group" as const
          : "inferred-public" as const,
        fixture: {
          status: route.parameters.length === 0
            ? "not-required" as const
            : "required" as const,
          parameterNames: route.parameters.map((parameter) => parameter.name),
        },
        viewport: { ...viewport },
        capture: { ...capture },
      })),
    ),
  );
}

function summarizeCoverage(
  routes: ExpoRouterImportResult["routes"],
  frames: readonly ResponsiveFramePlan[],
): ExpoRouterImportCoverage {
  const countContext = (context: ScreenCaptureContext): number =>
    frames.filter((frame) => frame.context === context).length;
  return {
    routeFiles: routes.length,
    normalizedRoutes: new Set(
      routes.map((route) => route.normalizedPath),
    ).size,
    scenarios: frames.length,
    dynamicScenarios: frames.filter(
      (frame) => frame.fixture.status === "required",
    ).length,
    deviceProfiles: ["ios-mobile"],
    contexts: {
      public: countContext("public"),
      "signed-out": countContext("signed-out"),
      guest: countContext("guest"),
      authenticated: countContext("authenticated"),
    },
    capture: {
      planned: 0,
      captured: 0,
      blocked: frames.length,
      failed: 0,
    },
  };
}

function validateRepository(repository: RepositoryAuthority): void {
  if (!/^[a-f0-9]{40}$/iu.test(repository.revision)) {
    throw new Error("Repository revision must be a 40-character hexadecimal Git SHA.");
  }
  if (!/^sha256:[a-f0-9]{64}$/iu.test(repository.dirtyFileFingerprint)) {
    throw new Error("Repository dirty file fingerprint must be a SHA-256 digest.");
  }
}

function evidence(
  files: Awaited<ReturnType<typeof readStaticSources>>["files"],
  role: "token" | "component",
): readonly DesignFileEvidence[] {
  return files
    .filter((file) => file.role === role)
    .map((file) => ({
      sourcePath: file.sourcePath,
      evidenceKind: "declared-source",
      contentHash: file.contentHash,
    }));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export async function importExpoRouterProject(
  options: ImportExpoRouterProjectOptions,
): Promise<ExpoRouterImportResult> {
  validateRepository(options.repository);
  if (
    options.runtimeCapture.kind !== "unavailable" ||
    options.runtimeCapture.reason.trim().length === 0
  ) {
    throw new Error("Static Expo import requires an explicit capture blocker.");
  }
  const snapshot = await readStaticSources(options.rootDir, options.budgets);
  const compiled = compileRoutes(snapshot.files);
  if (compiled.routes.length === 0) {
    throw new Error("No Expo Router screens were discovered.");
  }
  const capture: BlockedCapture = {
    status: "blocked",
    reasonCode: "runtime-capture-unavailable",
    reason: options.runtimeCapture.reason,
  };
  const framePlans = planFrames(compiled.routes, capture);
  const result: ExpoRouterImportResult = {
    routes: compiled.routes,
    sourceAnchors: compiled.sourceAnchors,
    designEvidence: {
      tokenFiles: evidence(snapshot.files, "token"),
      componentFiles: evidence(snapshot.files, "component"),
    },
    designSystem: extractStaticDesignSystem(snapshot.files),
    provenance: {
      adapterVersion: "expo-router-static@1",
      analysisMode: "static-source",
      executedProjectCode: false,
      repository: { ...options.repository },
      sourceFingerprint: snapshot.sourceFingerprint,
    },
    framePlans,
    coverage: summarizeCoverage(compiled.routes, framePlans),
  };
  return deepFreeze(result);
}
